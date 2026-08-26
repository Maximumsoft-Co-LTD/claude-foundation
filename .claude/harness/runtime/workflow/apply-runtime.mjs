import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { verifySpecSync } from "./spec-sync-verify.mjs";
import {
  projectionCounts, targetHeadMovedDecision, undeclaredDeletions
} from "./apply-recovery.mjs";
import {
  nestedRepositoryPathMatcher, sandboxCodePathspec
} from "../core/workspace-surface.mjs";

// Whether an empty root diff is an acceptable apply outcome rather than an
// error: true when the change selected any non-root repository, because the
// child apply path is then the delivery vehicle and the root may legitimately
// carry nothing — including when exactly one child repository holds the entire
// diff. Requiring a second repository here forced a manual apply for
// single-child changes.
export function emptyRootDiffPermitted(state) {
  return Object.keys(state?.repositories || {})
    .some((repositoryId) => repositoryId !== "root");
}

export function telemetryLandIssue(policy, telemetry) {
  if (!policy?.telemetry?.requireUsage || !telemetry ||
      ["measured", "no-usage"].includes(telemetry.classification)) return null;
  const recovery = (telemetry.recoveryActions || [])
    .map((action) => action.command).join("; ") || "import host usage events";
  return `Land requires measured model usage, but telemetry is '${
    telemetry.classification}'. Recover with: ${recovery}`;
}

export function assertLocalApply(initialState, options, fail) {
  if (initialState.repositories && Object.keys(initialState.repositories).length > 1 &&
      !options.controlPlane)
    fail("multi-repository sandboxes do not apply as one local transaction; use land plan/record/resume");
}

export function projectionHash(stableHash, entries) {
  return stableHash(entries.map(({ path, after, afterMode }) =>
    ({ path, after, afterMode })));
}

export function reapplyProjection({
  id,
  state,
  verifyAppliedProjection,
  buildReapplyEntries,
  stableHash,
  fail
}) {
  if (!state.workspace?.applied) return { prepared: null, resumed: false };
  const verification = verifyAppliedProjection(state);
  if (!verification.valid) fail(`applied projection is invalid: ${verification.reason}`);
  const prepared = buildReapplyEntries(id, state, verification.journal);
  const desired = projectionHash(stableHash, prepared);
  if (desired !== state.workspace.apply.projectionHash)
    return { prepared, resumed: false };
  console.log(`APPLIED ${id}\n  resumed: ${state.workspace.apply.transactionId}`);
  return { prepared, resumed: true };
}

export function projectionMismatch(entries, {
  safeRootPath,
  pathIdentity,
  pathMode
}, phase) {
  const identityField = phase === "before" ? "before" : "after";
  const modeField = phase === "before" ? "beforeMode" : "afterMode";
  return entries.find((entry) =>
    pathIdentity(safeRootPath(entry.path)) !== entry[identityField] ||
    pathMode(safeRootPath(entry.path)) !== entry[modeField]);
}

export function beginApplyJournal({
  id,
  journal,
  safeRootPath,
  pathIdentity,
  pathMode,
  saveApplyJournal,
  now,
  fail
}) {
  const changed = projectionMismatch(journal.entries, {
    safeRootPath, pathIdentity, pathMode
  }, "before");
  if (changed) {
    journal.status = "aborted";
    journal.failure = `target changed before apply at '${changed.path}'`;
    journal.abortedAt = now();
    saveApplyJournal(journal);
    fail(journal.failure);
  }
  journal.status = "applying";
  saveApplyJournal(journal);
  const counts = projectionCounts(journal.entries);
  console.log(`PROJECTION ${id}\n  update: ${counts.update}; create: ${
    counts.create}; delete: ${counts.delete}`);
}

export function appliedRuntimeState(state, root, journal) {
  state.workspace = {
    ...state.workspace,
    applied: true,
    sandboxPath: state.workspace.path,
    targetPath: root,
    apply: {
      transactionId: journal.transactionId,
      status: "verified",
      projectionHash: journal.projectionHash,
      touchedPaths: journal.entries.map((entry) => entry.path)
    }
  };
  state.status = "applied";
  return state;
}

export function executeApplyJournal({
  id,
  journal,
  root,
  loadRuntime,
  saveRuntime,
  safeRootPath,
  pathIdentity,
  pathMode,
  applyTransactionEntry,
  rollbackApplyTransaction,
  saveApplyJournal,
  now,
  fail
}) {
  const priorTransactionMarker = process.env.FOUNDATION_LAND_TRANSACTION;
  process.env.FOUNDATION_LAND_TRANSACTION = "1";
  try {
    journal.entries.forEach((entry, index) =>
      applyTransactionEntry(journal, entry, index));
    const mismatch = projectionMismatch(journal.entries, {
      safeRootPath, pathIdentity, pathMode
    }, "after");
    if (mismatch) throw new Error(`post-apply projection mismatch at '${mismatch.path}'`);
    const state = appliedRuntimeState(loadRuntime(id), root, journal);
    saveRuntime(state);
    journal.status = "verified";
    journal.verifiedAt = now();
    saveApplyJournal(journal);
    console.log(`APPLIED ${id}\n  mode: ${state.workspace.mode}\n  projection: ${journal.projectionHash}`);
  } catch (error) {
    try {
      rollbackApplyTransaction(journal, error);
    } catch (rollbackError) {
      fail(`${error.message}; ${rollbackError.message}`);
    }
    fail(`${error.message}; transaction rolled back`);
  } finally {
    if (priorTransactionMarker === undefined) delete process.env.FOUNDATION_LAND_TRANSACTION;
    else process.env.FOUNDATION_LAND_TRANSACTION = priorTransactionMarker;
  }
}

export function applySandboxOperation(context, id, options = {}) {
  const initialState = context.loadRuntime(id);
  assertLocalApply(initialState, options, context.fail);
  if (initialState.workspace?.applied && options.refresh)
    context.refreshAppliedProjection(initialState);
  context.recoverPendingApply(id, initialState);
  if (context.landCheck(id).archived) return;
  const state = context.loadRuntime(id);
  const reapply = reapplyProjection({ ...context, id, state });
  if (reapply.resumed) return;
  const journal = context.prepareApplyTransaction(id, state, reapply.prepared);
  beginApplyJournal({ ...context, id, journal });
  executeApplyJournal({ ...context, id, journal });
}

export function sandboxDiffNamesOperation(context, id, sandboxPath, state,
  paths = context.applyPathspec(id, state)) {
  if (!paths.length) return [];
  const names = context.git(["diff", "--name-only", "-z", context.sandboxBase(state), "--",
    ...paths], sandboxPath);
  if (names.status !== 0)
    context.fail(`cannot inspect sandbox paths: ${names.stderr.trim()}`);
  return names.stdout.split("\0").filter(Boolean).sort();
}

export function gitApplyInputsOperation(context, id, sandboxPath) {
  context.git(["add", "-N", "."], sandboxPath);
  const state = context.loadRuntime(id);
  const names = context.sandboxDiffNames(id, sandboxPath, state);
  const pending = names.filter((path) =>
    context.pathIdentity(join(context.root, path)) !==
      context.pathIdentity(join(sandboxPath, path)) ||
    context.pathMode(join(context.root, path)) !== context.pathMode(join(sandboxPath, path)));
  if (!pending.length) return names;
  const directoryPaths = pending.filter((path) =>
    [join(context.root, path), join(sandboxPath, path)].some((candidate) =>
      context.lstat(candidate, { throwIfNoEntry: false })?.isDirectory()));
  if (directoryPaths.length)
    context.fail(`apply encountered nested repository or directory path(s): ${
      directoryPaths.join(", ")}; register nested repositories in openspec/repositories.yaml before creating the sandbox`);
  const diff = context.gitBuffer([
    "diff", "--binary", context.sandboxBase(state), "--", ...pending
  ], sandboxPath);
  if (diff.status !== 0) context.fail("cannot inspect sandbox diff");
  if (!diff.stdout.length) {
    if (emptyRootDiffPermitted(state)) return [];
    context.fail("sandbox has no applicable diff");
  }
  const check = context.spawn("git", ["apply", "--check", "--whitespace=nowarn", "-"], {
    cwd: context.root, input: diff.stdout, encoding: "utf8"
  });
  if (check.status !== 0)
    context.fail(`sandbox diff conflicts with target: ${check.stderr.trim()}`);
  const base = context.sandboxBase(state);
  const workingBlob = (path) => {
    const stats = context.lstat(path, { throwIfNoEntry: false });
    if (!stats) return null;
    return stats.isSymbolicLink()
      ? Buffer.from(context.readlink(path)) : context.readFile(path);
  };
  const clobbered = pending.filter((path) => {
    const target = workingBlob(join(context.root, path));
    if (target === null) return false;
    const sandboxContent = workingBlob(join(sandboxPath, path));
    if (sandboxContent !== null && target.equals(sandboxContent)) return false;
    const shown = context.gitBuffer(["show", `${base}:${path}`], context.root);
    return shown.status !== 0 || !target.equals(shown.stdout);
  });
  if (clobbered.length) {
    const listed = clobbered.slice(0, 10).join(", ") +
      (clobbered.length > 10 ? ", ..." : "");
    context.fail(`apply would overwrite uncommitted target edits at: ${listed} — commit or reconcile the landed work first, then sync the sandbox and prove again`);
  }
  return names;
}

export function createApplyRuntime({
  root,
  transactions,
  loadRuntime,
  saveRuntime,
  selectedRepositories,
  workspaceManifest,
  declaredSurfaceMatcher,
  currentChangeRelativePath,
  changePath,
  safeRootPath,
  pathIdentity,
  pathMode,
  directoryHash,
  applyTransactionRoot,
  copyPath,
  proofPath,
  readJson,
  stableHash,
  syncClaudeTelemetry,
  modelUsageRecorded,
  telemetryReadiness = null,
  foundationPolicy = () => ({ telemetry: { requireUsage: false } }),
  saveApplyJournal,
  transactionJournalPath,
  verifyAppliedProjection,
  rollbackApplyTransaction,
  applyTransactionEntry,
  cleanupApplyTransaction,
  git,
  gitBuffer,
  gitHead,
  cleanupAppliedSandbox,
  cleanupRepositorySandboxes,
  recoverPendingApply,
  landCheck,
  assertMultiRepositoryArchiveReady,
  archivedChangeRelativePath,
  pendingTasks,
  assertOpenSpecCli,
  proofAudit,
  cleanupChangeLeases,
  now,
  blockWithDecision,
  fail
}) {
  function nestedRepositoryPaths(id, state) {
    return selectedRepositories(id, state)
      .filter((repository) => repository.id !== "root" &&
        repository.relativePath && repository.relativePath !== "." &&
        !repository.relativePath.startsWith("../"))
      .map((repository) => repository.relativePath);
  }

  function applyPathspec(id, state) {
    return sandboxCodePathspec(id, nestedRepositoryPaths(id, state));
  }

  function copyCodePaths(id, state) {
    const baseline = state.workspace.baseline || {};
    if (state.workspace?.mode === "copy" && Object.values(baseline)
      .some((identity) => /^[0-9a-f]{64}$/i.test(String(identity))))
      fail(`copy sandbox '${id}' uses the legacy content-only identity format; recreate the sandbox and prove once before Land so executable modes and symlinks are bound safely`);
    const sandbox = workspaceManifest(state.workspace.path, id, true);
    const nested = nestedRepositoryPathMatcher(nestedRepositoryPaths(id, state));
    return [...new Set([...Object.keys(baseline), ...Object.keys(sandbox)])]
      .filter((path) => baseline[path] !== sandbox[path] && !nested(path)).sort();
  }

  // Against the base the sandbox branched from, not its HEAD: an agent that
  // commits inside the sandbox moves HEAD, and a HEAD-relative diff would
  // silently omit every committed change while proof — which hashes the
  // sandbox index — still counts it. That lands a partial change as a success.
  function sandboxBase(state) {
    return state.workspace?.baseHead || "HEAD";
  }

  const sandboxDiffNames = sandboxDiffNamesOperation.bind(null, {
    applyPathspec,
    git,
    sandboxBase,
    fail
  });

  const gitApplyInputs = gitApplyInputsOperation.bind(null, {
    root,
    git,
    loadRuntime,
    sandboxDiffNames,
    pathIdentity,
    pathMode,
    lstat: lstatSync,
    gitBuffer,
    sandboxBase,
    spawn: spawnSync,
    readlink: readlinkSync,
    readFile: readFileSync,
    fail
  });

  function assertTargetHeadUnmoved(id, state) {
    const currentHead = gitHead(root);
    if (currentHead === state.workspace.baseHead) return;
    blockWithDecision(id, "control-head-moved", targetHeadMovedDecision({
      changeId: id,
      recordedBase: state.workspace.baseHead,
      currentHead,
      multiRepository: Object.keys(state.repositories || {}).length > 1,
      action: "Applying"
    }));
  }

  function buildApplyEntries(id, state) {
    const sandboxPath = state.workspace.path;
    let codePaths;
    if (state.workspace.mode === "copy") {
      const baseline = state.workspace.baseline || {};
      const target = workspaceManifest(root, id, true);
      const sandbox = workspaceManifest(sandboxPath, id, true);
      codePaths = copyCodePaths(id, state);
      for (const path of codePaths) {
        if ((target[path] ?? null) !== (baseline[path] ?? null) &&
            ((target[path] ?? null) !== (sandbox[path] ?? null) ||
             pathMode(join(root, path)) !== pathMode(join(sandboxPath, path))))
          fail(`isolated-copy conflict at '${path}'`);
      }
    } else if (state.workspace.mode === "worktree") {
      assertTargetHeadUnmoved(id, state);
      codePaths = gitApplyInputs(id, sandboxPath);
    } else {
      fail("change has no isolated sandbox");
    }
    const entries = codePaths.map((rel) => {
      const source = resolve(sandboxPath, rel);
      const target = safeRootPath(rel);
      return {
        path: rel,
        role: "code",
        before: pathIdentity(target),
        beforeMode: pathMode(target),
        after: pathIdentity(source),
        afterMode: pathMode(source)
      };
    });
    const changeRel = currentChangeRelativePath(id);
    entries.push({
      path: changeRel,
      role: "change-artifacts",
      before: pathIdentity(changePath(id)),
      beforeMode: pathMode(changePath(id)),
      after: pathIdentity(join(sandboxPath, changeRel)),
      afterMode: pathMode(join(sandboxPath, changeRel))
    });
    return entries;
  }

  // Paths the sandbox still wants to project once the target already carries a
  // prior projection. The virgin-target conflict guards in buildApplyEntries
  // cannot run here: after a first apply the target legitimately differs from
  // the baseline. Divergence is caught instead by matching each entry's
  // 'before' against what the previous transaction actually projected.
  function reapplyCodePaths(id, state) {
    const sandboxPath = state.workspace.path;
    if (state.workspace.mode === "copy") {
      return copyCodePaths(id, state);
    }
    if (state.workspace.mode !== "worktree") fail("change has no isolated sandbox");
    assertTargetHeadUnmoved(id, state);
    git(["add", "-N", "."], sandboxPath);
    return sandboxDiffNames(id, sandboxPath, state);
  }

  // The full projection, not just the delta, so verifyAppliedProjection keeps
  // covering every path the change owns.
  function buildReapplyEntries(id, state, priorJournal) {
    const sandboxPath = state.workspace.path;
    const projected = new Map((priorJournal.entries || [])
      .map((entry) => [entry.path, entry]));
    const changeRel = currentChangeRelativePath(id);
    const paths = [...new Set([
      ...projected.keys(), ...reapplyCodePaths(id, state), changeRel
    ])].sort();
    return paths.map((rel) => {
      const prior = projected.get(rel);
      return {
        path: rel,
        role: prior?.role || (rel === changeRel ? "change-artifacts" : "code"),
        before: prior ? prior.after : pathIdentity(safeRootPath(rel)),
        beforeMode: prior && Object.prototype.hasOwnProperty.call(prior, "afterMode")
          ? prior.afterMode : pathMode(safeRootPath(rel)),
        after: pathIdentity(resolve(sandboxPath, rel)),
        afterMode: pathMode(resolve(sandboxPath, rel))
      };
    });
  }

  function assertDeletionsAreDeclared(id, state, entries) {
    const undeclared = undeclaredDeletions(entries, declaredSurfaceMatcher(id, state));
    if (!undeclared.length) return;
    const preview = undeclared.slice(0, 10).map((entry) => entry.path);
    fail(`apply would delete ${undeclared.length} path(s) no task declares: ${
      preview.join(", ")}${undeclared.length > preview.length ? ", ..." : ""
    }. A deletion has to come from a removal observed inside the sandbox, not ` +
      "from a path missing from its manifest; declare the path in tasks.md " +
      "`[paths:]` if the change really owns it.");
  }

  function prepareApplyTransaction(id, state, prepared = null) {
    // The recorded baseline only describes a sandbox that has not been
    // projected yet. Once it has, the control-plane change directory *is* the
    // projection, and verifyAppliedProjection — already run to build `prepared`
    // — is what guards it against an edit outside the sandbox.
    if (!prepared &&
        directoryHash(changePath(id)) !== state.workspace.changeSourceHash)
      fail("active change was edited after the last sandbox sync");
    const entries = prepared || buildApplyEntries(id, state);
    const nested = nestedRepositoryPathMatcher(nestedRepositoryPaths(id, state));
    const childEntry = entries.find((entry) => entry.role === "code" && nested(entry.path));
    if (childEntry)
      fail(`apply entry '${childEntry.path}' crosses into a child repository`);
    assertDeletionsAreDeclared(id, state, entries);
    const transactionId = `apply-${Date.now()}-${process.pid}`;
    const transactionRoot = applyTransactionRoot(id, transactionId);
    mkdirSync(transactionRoot, { recursive: true });
    entries.forEach((entry, index) => {
      entry.backup = `backup/${index}`;
      if (entry.before !== null)
        copyPath(safeRootPath(entry.path), join(transactionRoot, entry.backup));
    });
    const proof = readJson(proofPath(id));
    const journal = {
      version: 1,
      changeId: id,
      transactionId,
      proofRunId: proof.proofRunId,
      mode: state.workspace.mode,
      status: "prepared",
      sandboxPath: state.workspace.path,
      targetPath: root,
      projectionHash: stableHash(entries.map(({ path, after, afterMode }) =>
        ({ path, after, afterMode }))),
      entries,
      appliedPaths: [],
      inFlightPaths: [],
      createdAt: now()
    };
    saveApplyJournal(journal);
    return journal;
  }

  function refreshAppliedProjection(state) {
    const transactionId = state.workspace?.apply?.transactionId;
    const journalPath = transactionJournalPath(state.id, transactionId);
    if (!transactionId || !existsSync(journalPath))
      fail("cannot refresh an applied projection without its transaction journal");
    const journal = readJson(journalPath);
    for (const entry of journal.entries) {
      const source = resolve(state.workspace.path, entry.path);
      const expected = pathIdentity(source);
      const expectedMode = pathMode(source);
      const current = pathIdentity(safeRootPath(entry.path));
      const currentMode = pathMode(safeRootPath(entry.path));
      if (current !== expected || currentMode !== expectedMode)
        fail(`cannot refresh diverged applied path '${entry.path}'`);
      entry.after = expected;
      entry.afterMode = expectedMode;
    }
    journal.projectionHash = stableHash(
      journal.entries.map(({ path, after, afterMode }) => ({ path, after, afterMode }))
    );
    journal.proofRunId = readJson(proofPath(state.id)).proofRunId;
    journal.status = "verified";
    journal.refreshedAt = now();
    saveApplyJournal(journal);
    state.workspace.apply.projectionHash = journal.projectionHash;
    state.workspace.apply.status = "verified";
    saveRuntime(state);
  }

  const applySandbox = applySandboxOperation.bind(null, {
    root,
    loadRuntime,
    saveRuntime,
    refreshAppliedProjection,
    recoverPendingApply,
    landCheck,
    verifyAppliedProjection,
    buildReapplyEntries,
    stableHash,
    prepareApplyTransaction,
    safeRootPath,
    pathIdentity,
    pathMode,
    saveApplyJournal,
    applyTransactionEntry,
    rollbackApplyTransaction,
    now,
    fail
  });

  function currentSpecText(capability) {
    const path = join(root, "openspec", "specs", capability, "spec.md");
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }

  function captureSpecSyncInputs(id) {
    const dir = join(changePath(id), "specs");
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() &&
        existsSync(join(dir, entry.name, "spec.md")))
      .map((entry) => ({
        capability: entry.name,
        delta: readFileSync(join(dir, entry.name, "spec.md"), "utf8"),
        before: currentSpecText(entry.name)
      }));
  }

  function verifyArchivedSpecs(captured) {
    return captured.flatMap(({ capability, delta, before }) =>
      verifySpecSync({ before, after: currentSpecText(capability), delta })
        .violations.map((violation) => ({ capability, ...violation })));
  }

  function failSpecSync(violations) {
    fail(`archived specs do not match the change delta:\n${violations
      .map((violation) => `  ${violation.capability}/${violation.requirement || "-"}: ${
        violation.detail}`).join("\n")}`);
  }

  // The gate can only fire once the change is already recorded archived, so a
  // retry would otherwise take the early return and land the corrupted specs.
  // Re-verifying from the inputs captured before the merge means a repaired spec
  // tree clears the block on its own, with no one hand-editing runtime state.
  function outstandingSpecSync(state) {
    if (!state.specSyncViolations?.length) return [];
    const captured = state.specSyncInputs;
    return Array.isArray(captured) && captured.length
      ? verifyArchivedSpecs(captured) : state.specSyncViolations;
  }

  function assertRecoveredArchiveReady(id, state, archivedPath) {
    const audit = proofAudit(id, true);
    if (!audit.valid) fail(`recovered archive has invalid proof: ${audit.reason}`);
    assertMultiRepositoryArchiveReady(id, state);
    if (["worktree", "copy"].includes(state.workspace?.mode)) {
      // Specs moved but no code did. Calling that archived would report a land
      // that never happened and then delete the sandbox holding the work.
      if (!state.workspace.applied)
        fail(`the interrupted archive never projected the sandbox into the target; ` +
          `restore 'openspec/changes/${id}' from '${archivedPath}' and land again`);
      const verification = verifyAppliedProjection(state);
      if (!verification.valid)
        fail(`recovered archive has an invalid applied projection: ${verification.reason}`);
    }
    const pending = pendingTasks(id, resolve(root, archivedPath));
    if (pending.length)
      fail(`${pending.length} implementation task(s) remain unchecked`);
  }

  function resumeArchivedChange(id, state) {
    const outstanding = outstandingSpecSync(state);
    if (outstanding.length) failSpecSync(outstanding);
    if (state.specSyncViolations) {
      delete state.specSyncViolations;
      delete state.specSyncInputs;
      saveRuntime(state);
    }
    const audit = proofAudit(id, true);
    if (!audit.valid) fail(`archived proof audit failed: ${audit.reason}`);
    let resumed = false;
    if (state.workspace &&
        !["removed", "not-needed"].includes(state.workspace.cleanup?.status)) {
      state.workspace.cleanup = cleanupAppliedSandbox(id, state);
      state.land = {
        ...(state.land || {}),
        status: state.workspace.cleanup.status === "removed"
          ? "sandbox-cleaned" : "archive-audited",
        resumedAt: now()
      };
      resumed = true;
    }
    if (state.workspace?.apply &&
        state.workspace.apply.cleanup?.status !== "committed") {
      state.workspace.apply.cleanup = cleanupApplyTransaction(state);
      resumed = true;
    }
    if (state.repositories && !state.repositoryCleanup) {
      state.repositoryCleanup = cleanupRepositorySandboxes(id, state);
      resumed = true;
    }
    if (resumed) saveRuntime(state);
    console.log(`ALREADY ARCHIVED ${id}\n  archived: ${state.archivedAt || "unknown"}`);
  }

  function recoverInterruptedArchive(id, state, archivedPath) {
    // Recovery cannot tell "succeeded then crashed" from "moved then failed",
    // so it is not an exemption from the Land guards. Everything still
    // checkable once the change directory has moved is checked here, before
    // any state is written: a refusal has to leave the change recoverable.
    assertRecoveredArchiveReady(id, state, archivedPath);
    state.status = "archived";
    state.archivedAt ||= now();
    state.archivedChangePath = archivedPath;
    state.land = {
      ...(state.land || {}),
      status: "archive-audited",
      recoveredAt: now()
    };
    state.workspace.cleanup = cleanupAppliedSandbox(id, state);
    if (state.repositories)
      state.repositoryCleanup = cleanupRepositorySandboxes(id, state);
    if (state.workspace.apply)
      state.workspace.apply.cleanup = cleanupApplyTransaction(state);
    delete state.workspace.baseline;
    saveRuntime(state);
    // The merge already ran and the pre-merge spec text died with the
    // interrupted transaction, so spec sync cannot be checked here: without
    // 'before', a removal and a preserved requirement are indistinguishable
    // from a bad merge. Say so rather than let the silence read as verified.
    console.error(
      `WARNING: spec sync was not verified for ${id}; the interrupted archive left no pre-merge specs to compare against`);
    console.log(`ARCHIVED ${id}\n  recovered: interrupted archive transaction`);
  }

  function snapshotArchiveEvidence(id) {
    const journal = loadRuntime(id);
    journal.land = {
      ...(journal.land || {}),
      status: "evidence-snapshotted",
      proofRunId: readJson(proofPath(id)).proofRunId,
      updatedAt: now()
    };
    saveRuntime(journal);
  }

  function applyArchiveWorkspace(id, readiness) {
    if (!["worktree", "copy"].includes(readiness.state.workspace?.mode))
      return readiness;
    applySandbox(id, { controlPlane: true });
    const journal = loadRuntime(id);
    journal.land = { ...journal.land, status: "code-applied", updatedAt: now() };
    saveRuntime(journal);
    return landCheck(id);
  }

  function recordArchiveTelemetry(id, state) {
    const telemetry = telemetryReadiness?.(id) || null;
    state.land = {
      ...(state.land || {}),
      telemetry: telemetry ? {
        classification: telemetry.classification,
        reason: telemetry.reason,
        correlatedHosts: telemetry.correlatedHosts
      } : null,
      updatedAt: now()
    };
    saveRuntime(state);
    if (telemetry && !["measured", "no-usage"].includes(telemetry.classification)) {
      console.error(telemetry.classification === "not-ingested"
        ? "WARNING: no model usage was imported for this change; cost and token columns stay empty — telemetry not-ingested"
        : `WARNING: telemetry ${telemetry.classification}; cost and token columns may stay empty`);
      for (const action of telemetry.recoveryActions || [])
        console.error(`  recovery: ${action.command}`);
      const telemetryIssue = telemetryLandIssue(foundationPolicy(), telemetry);
      if (telemetryIssue) fail(telemetryIssue);
    }
    return telemetry;
  }

  function runOpenSpecArchive(id, state, readiness) {
    const preArchiveWorkspaceHash = readiness.hash;
    // 'openspec archive' moves the change out of openspec/changes and rewrites
    // openspec/specs in one step, so the delta and the pre-merge spec text can
    // only be read now.
    const specSyncInputs = captureSpecSyncInputs(id);
    // landCheck already gated this; repeated here because it is the last point
    // before the destructive step and the CLI can disappear in between.
    assertOpenSpecCli(root, fail);
    const cli = spawnSync("openspec", ["archive", id, "--yes"], { cwd: root, encoding: "utf8" });
    if (cli.status !== 0) fail(`OpenSpec archive failed: ${(cli.stderr || cli.stdout).trim()}`);
    state.status = "archived";
    state.archivedAt = now();
    state.preArchiveWorkspaceHash = preArchiveWorkspaceHash;
    state.archivedChangePath = archivedChangeRelativePath(id);
    // `land.status` is a breadcrumb, not the saga's position. Resume branches on
    // `workspace.cleanup?.status` and `repositoryCleanup` — never on this — so
    // reading it to work out where a Land stopped will give a confident wrong
    // answer. Named here because it reads exactly like a checkpoint.
    state.land = { ...state.land, status: "specs-archived", updatedAt: now() };
    saveRuntime(state);
    // A merge that silently drops or rewrites a requirement still exits 0, and
    // openspec/specs is durable, so the exit code is not evidence.
    const specViolations = verifyArchivedSpecs(specSyncInputs);
    if (specViolations.length) {
      state.specSyncViolations = specViolations;
      // Only retained on failure: the retry guard needs the pre-merge text to
      // re-verify, and carrying it on the happy path would bloat every state file.
      state.specSyncInputs = specSyncInputs;
      saveRuntime(state);
      failSpecSync(specViolations);
    }
    return cli;
  }

  function finalizeArchivedChange(id, state, telemetry, cli) {
    const audit = proofAudit(id, true);
    if (!audit.valid) fail(`post-archive proof audit failed: ${audit.reason}`);
    state.land = { ...state.land, status: "archive-audited", updatedAt: now() };
    state.workspace.cleanup = cleanupAppliedSandbox(id, state);
    if (state.repositories)
      state.repositoryCleanup = cleanupRepositorySandboxes(id, state);
    cleanupChangeLeases(id);
    if (state.workspace.apply)
      state.workspace.apply.cleanup = cleanupApplyTransaction(state);
    delete state.workspace.baseline;
    state.land.status = "sandbox-cleaned";
    saveRuntime(state);
    if (!state.archivedChangePath)
      console.error("WARNING: OpenSpec reported success but the archived change directory was not found");
    if (["failed", "refused"].includes(state.workspace.cleanup.status))
      console.error(`WARNING: sandbox cleanup ${state.workspace.cleanup.status}: ${state.workspace.cleanup.reason}`);
    if (!telemetry && !modelUsageRecorded(id))
      console.error(`WARNING: no model usage was imported for this change; cost and token columns stay empty — claude-foundation telemetry sync ${id} [transcript.jsonl]`);
    console.log(cli.stdout.trim());
    console.log(`ARCHIVED ${id}`);
  }

  function archive(id) {
    const initial = loadRuntime(id);
    if (initial.status === "archived") {
      resumeArchivedChange(id, initial);
      return;
    }
    const recoveredArchive = !existsSync(changePath(id)) &&
      archivedChangeRelativePath(id);
    if (recoveredArchive) {
      recoverInterruptedArchive(id, initial, recoveredArchive);
      return;
    }
    // Drain before the first readiness report so archive cannot print
    // `telemetry: not-ingested` and then ingest the missing rows moments later.
    // Telemetry stays advisory: an absent or unreadable transcript never gates
    // Land.
    try { syncClaudeTelemetry(id, { quiet: true }); } catch { /* warned below */ }
    let readiness = landCheck(id);
    if (readiness.archived) return;
    assertMultiRepositoryArchiveReady(id, readiness.state);
    snapshotArchiveEvidence(id);
    // Unconditional, including when the sandbox is already applied: work done
    // after the first projection is proven and would otherwise archive as a
    // success while the target still holds the earlier code. applySandbox
    // returns early by itself when the projection is already current.
    readiness = applyArchiveWorkspace(id, readiness);
    // Re-read rather than reuse readiness.state: on the no-sandbox path that
    // object predates the journal write above, and saving it below would
    // silently erase land.proofRunId from the record.
    const state = loadRuntime(id);
    const pending = pendingTasks(id);
    if (pending.length) fail(`${pending.length} implementation task(s) remain unchecked`);
    const telemetry = recordArchiveTelemetry(id, state);
    const cli = runOpenSpecArchive(id, state, readiness);
    finalizeArchivedChange(id, state, telemetry, cli);
  }

  return {
    gitApplyInputs,
    buildApplyEntries,
    prepareApplyTransaction,
    refreshAppliedProjection,
    applySandbox,
    archive
  };
}
