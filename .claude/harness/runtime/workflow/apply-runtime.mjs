import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync,
  writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { verifySpecSync } from "./spec-sync-verify.mjs";
import {
  projectionCounts, targetHeadMovedDecision, undeclaredDeletions
} from "./apply-recovery.mjs";
import {
  isInvestigationPath, nestedRepositoryPathMatcher, sandboxCodePathspec
} from "../core/workspace-surface.mjs";
import { transitionLifecycleState } from "../core/lifecycle-reducer.mjs";
import { compositeRepositorySelection } from "../core/repository-binding.mjs";
import { createRepositoryDeliverySaga } from "./repository-delivery-saga.mjs";
import { deliveryTreeEntries, assertDeliveryEntries } from "./delivery-integrity.mjs";
import { approvalMatches } from "../core/user-decisions.mjs";
import { emitSignal } from "../core/signals.mjs";
import { legacyRepositoryLandTransaction } from "./land-runtime.mjs";
import { rejectedPaths } from "./sandbox-runtime.mjs";
import {
  landedChangeSyncStop, landedTargetPaths, otherLandedOutput, parseRestoreTargetPaths,
  restorableTargetPaths, targetConflictStop, targetEditCarried
} from "./target-edits.mjs";

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

export function telemetryUsageSatisfied(telemetry) {
  return Boolean(telemetry && (
    ["measured", "no-usage"].includes(telemetry.classification) ||
    Object.values(telemetry.measuredDimensions || {}).some(Boolean)
  ));
}

export function assertLocalApply(initialState, options, fail) {
  if (emptyRootDiffPermitted(initialState) && !options.controlPlane)
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
  transitionLifecycleState(state, "applied", "projection-verified");
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

// `checkedReadiness` is archive's own landCheck from the same Land pass. That
// check already refused any pending apply, and only the evidence breadcrumb
// was written since, so it is reused instead of recomputed. It is a separate
// positional argument so no CLI flag can ever supply it.
export function applySandboxOperation(context, id, options = {}, checkedReadiness = null) {
  const initialState = context.loadRuntime(id);
  assertLocalApply(initialState, options, context.fail);
  if (initialState.workspace?.applied && options.refresh)
    context.refreshAppliedProjection(initialState);
  context.recoverPendingApply(id, initialState);
  if ((checkedReadiness || context.landCheck(id)).archived) return;
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
  const tracked = context.git(["diff", "--name-only", "-z", context.sandboxBase(state), "--",
    ...paths], sandboxPath);
  if (tracked.status !== 0)
    context.fail(`cannot inspect sandbox paths: ${tracked.stderr.trim()}`);
  // Read untracked names directly. `git add -N .` used to make them visible to
  // diff, but it also mutated the sandbox index during Land and changed the
  // forced workspace snapshot after a passing proof.
  const untracked = context.git([
    "ls-files", "--others", "--exclude-standard", "-z", "--", ...paths
  ], sandboxPath);
  if (untracked.status !== 0)
    context.fail(`cannot inspect untracked sandbox paths: ${untracked.stderr.trim()}`);
  return [...new Set([
    ...tracked.stdout.split("\0"), ...untracked.stdout.split("\0")
  ].filter(Boolean))].sort();
}

// A recorded `--restore-target` returns those target files to the sandbox
// base inside Land, only while each still holds the exact bytes the
// restore was recorded against; a later edit is a new question.
export function restoreAuthorizedTargetPaths(context, state, names) {
  const restore = state.targetRestore;
  if (!restore?.identities) return [];
  const base = context.sandboxBase(state);
  const restored = [];
  for (const path of names) {
    if (!Object.hasOwn(restore.identities, path)) continue;
    const target = join(context.root, path);
    if (context.pathIdentity(target) !== restore.identities[path]) continue;
    const shown = context.gitBuffer(["show", `${base}:${path}`], context.root);
    if (shown.status === 0) context.writeFile(target, shown.stdout);
    else context.removePath(target);
    restored.push(path);
  }
  return restored;
}

function targetSnapshot(state) {
  return state.workspace?.targetDirty || state.workspace?.preexisting || {};
}

// A conflict made only of regenerable artifacts that were clean at isolation
// is a test run in the main checkout, not user work. Land returns them to the
// sandbox base itself, once, instead of handing a restore command back.
function restoreRegenerableConflicts(context, state, paths) {
  if (!paths.length || !context.writeFile || !context.removePath ||
      restorableTargetPaths(paths, targetSnapshot(state)).length !== paths.length ||
      Object.keys(context.landedBy?.(state.id, paths) || {}).length) return false;
  const base = context.sandboxBase(state);
  for (const path of paths) {
    const shown = context.gitBuffer(["show", `${base}:${path}`], context.root);
    if (shown.status === 0) context.writeFile(join(context.root, path), shown.stdout);
    else context.removePath(join(context.root, path));
  }
  return true;
}

function baseBlob(context, state, path) {
  const shown = context.gitBuffer(["show", `${context.sandboxBase(state)}:${path}`], context.root);
  return shown.status === 0 ? shown.stdout : null;
}

// Whether the sandbox replay already wrote the current sandbox bytes for every
// landed path and Land still finds them not carried: another automatic sync
// would change nothing, so the agent reconciles instead of the harness looping.
function landedReplayExhausted(context, state, landedPaths) {
  const replayed = state.workspace?.landedReplay || {};
  return landedPaths.every((path) => Object.hasOwn(replayed, path) &&
    replayed[path] === context.pathIdentity(join(state.workspace.path, path)));
}

function stopForTargetConflict(context, id, state, paths, cause) {
  const snapshot = targetSnapshot(state);
  // Bytes an earlier change landed are part of the target: the harness first
  // replays the sandbox onto them through its own sync, then proves again.
  const landedBy = context.landedBy?.(id, paths) || {};
  const landed = Object.keys(landedBy);
  if (landed.length && context.blockWithDecision && state.workspace?.mode === "worktree" &&
      !landedReplayExhausted(context, state, landed)) {
    const stop = landedChangeSyncStop({ changeId: id, landedBy });
    return context.blockWithDecision(id, stop.code, stop.decision);
  }
  const stop = targetConflictStop({ changeId: id, paths, snapshot, cause, landedBy });
  if (stop.decision && context.blockWithDecision)
    return context.blockWithDecision(id, stop.code, stop.decision);
  if (stop.decision) return context.fail(stop.decision.summary);
  return context.fail(stop.message, 1, stop.details);
}

export function gitApplyInputsOperation(context, id, sandboxPath, { regenerated = false } = {}) {
  const state = context.loadRuntime(id);
  const names = context.sandboxDiffNames(id, sandboxPath, state);
  restoreAuthorizedTargetPaths(context, state, names);
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
  // A target edit the sandbox copy already carries is not overwritten work,
  // nor is landed work the agent merged by hand into these exact bytes after
  // the sandbox replay reported a same-line conflict.
  const resolvedLanded = (path) => {
    const row = state.workspace?.landedResolved?.[path];
    return Boolean(row) && row.target === context.pathIdentity(join(context.root, path)) &&
      row.sandbox === context.pathIdentity(join(sandboxPath, path));
  };
  const carried = (path) => resolvedLanded(path) || targetEditCarried({
    root: context.root, sandboxPath, path, baseBytes: baseBlob(context, state, path) });
  // An untracked-only or mode-only projection has no Git patch, but the
  // transaction below still copies it and binds its bytes/mode. Patch-check
  // only the tracked part; target-clobber checks still cover every path.
  if (diff.stdout.length) {
    const check = context.spawn("git", ["apply", "--check", "--whitespace=nowarn", "-"], {
      cwd: context.root, input: diff.stdout, encoding: "utf8"
    });
    if (check.status !== 0) {
      const rejected = rejectedPaths(check.stderr);
      if (!rejected.length)
        context.fail(`sandbox diff conflicts with target: ${check.stderr.trim()}`);
      const conflicts = rejected.filter((path) => !carried(path));
      if (conflicts.length && !regenerated && restoreRegenerableConflicts(context, state, conflicts))
        return gitApplyInputsOperation(context, id, sandboxPath, { regenerated: true });
      if (conflicts.length)
        stopForTargetConflict(context, id, state, conflicts, "sandbox diff conflicts with target");
    }
  }
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
    return (shown.status !== 0 || !target.equals(shown.stdout)) && !carried(path);
  });
  if (clobbered.length && !regenerated && restoreRegenerableConflicts(context, state, clobbered))
    return gitApplyInputsOperation(context, id, sandboxPath, { regenerated: true });
  if (clobbered.length)
    stopForTargetConflict(context, id, state, clobbered,
      "apply would overwrite uncommitted target edits");
  return names;
}

export function copyApplyCodePaths(context, id, state, sandboxPath) {
  const baseline = state.workspace.baseline || {};
  const target = context.workspaceManifest(context.root, id, true);
  const sandbox = context.workspaceManifest(sandboxPath, id, true);
  const codePaths = context.copyCodePaths(id, state);
  for (const path of codePaths) {
    if ((target[path] ?? null) !== (baseline[path] ?? null) &&
        ((target[path] ?? null) !== (sandbox[path] ?? null) ||
         context.pathMode(join(context.root, path)) !==
           context.pathMode(join(sandboxPath, path))))
      context.fail(`isolated-copy conflict at '${path}'`);
  }
  return codePaths;
}

export function applyCodePaths(context, id, state, sandboxPath) {
  if (state.workspace.mode === "copy")
    return copyApplyCodePaths(context, id, state, sandboxPath);
  if (state.workspace.mode === "worktree") {
    context.assertTargetHeadUnmoved(id, state);
    return context.gitApplyInputs(id, sandboxPath);
  }
  context.fail("change has no isolated sandbox");
}

export function applyCodeEntry(context, sandboxPath, rel) {
  const source = resolve(sandboxPath, rel);
  const target = context.safeRootPath(rel);
  return {
    path: rel,
    role: "code",
    before: context.pathIdentity(target),
    beforeMode: context.pathMode(target),
    after: context.pathIdentity(source),
    afterMode: context.pathMode(source),
    ...(context.pathIdentity(source)?.startsWith("directory:") ? {
      afterEntries: deliveryTreeEntries(sandboxPath, [rel], context.pathIdentity)
    } : {})
  };
}

export function changeArtifactApplyEntry(context, id, sandboxPath) {
  const changeRel = context.currentChangeRelativePath(id);
  return {
    path: changeRel,
    role: "change-artifacts",
    before: context.pathIdentity(context.changePath(id)),
    beforeMode: context.pathMode(context.changePath(id)),
    after: context.pathIdentity(join(sandboxPath, changeRel)),
    afterMode: context.pathMode(join(sandboxPath, changeRel))
  };
}

export function buildApplyEntriesOperation(context, id, state) {
  const sandboxPath = state.workspace.path;
  const entries = [];
  for (const rel of applyCodePaths(context, id, state, sandboxPath))
    entries.push(applyCodeEntry(context, sandboxPath, rel));
  entries.push(changeArtifactApplyEntry(context, id, sandboxPath));
  return entries;
}

export function buildReapplyEntriesOperation(context, id, state, priorJournal) {
  const sandboxPath = state.workspace.path;
  const projected = new Map((priorJournal.entries || [])
    .map((entry) => [entry.path, entry]));
  const changeRel = context.currentChangeRelativePath(id);
  const paths = [...new Set([
    ...projected.keys(), ...context.reapplyCodePaths(id, state), changeRel
  ])].sort();
  return paths.map((rel) => {
    const prior = projected.get(rel);
    return {
      path: rel,
      role: prior?.role || (rel === changeRel ? "change-artifacts" : "code"),
      before: prior ? prior.after : context.pathIdentity(context.safeRootPath(rel)),
      beforeMode: prior && Object.prototype.hasOwnProperty.call(prior, "afterMode")
        ? prior.afterMode : context.pathMode(context.safeRootPath(rel)),
      after: context.pathIdentity(resolve(sandboxPath, rel)),
      afterMode: context.pathMode(resolve(sandboxPath, rel))
    };
  });
}

export function assertApplySourceUnchanged(context, id, state, prepared) {
  if (!prepared && context.directoryHash(context.changePath(id)) !==
      state.workspace.changeSourceHash)
    context.fail("active change was edited after the last sandbox sync");
}

export function assertNoChildApplyEntries(context, id, state, entries) {
  const nested = context.nestedRepositoryPathMatcher(context.nestedRepositoryPaths(id, state));
  for (const entry of entries) {
    if (entry.role === "code" && nested(entry.path))
      context.fail(`apply entry '${entry.path}' crosses into a child repository`);
  }
}

export function backupApplyEntries(context, transactionRoot, entries) {
  for (const [index, entry] of entries.entries()) {
    entry.backup = `backup/${index}`;
    if (entry.before !== null)
      context.copyPath(context.safeRootPath(entry.path),
        join(transactionRoot, entry.backup));
  }
}

export function prepareApplyTransactionOperation(context, id, state, prepared = null) {
  assertApplySourceUnchanged(context, id, state, prepared);
  const entries = prepared || context.buildApplyEntries(id, state);
  assertNoChildApplyEntries(context, id, state, entries);
  context.assertDeletionsAreDeclared(id, state, entries);
  const transactionId = `apply-${context.dateNow()}-${context.pid}`;
  const transactionRoot = context.applyTransactionRoot(id, transactionId);
  context.makeDirectory(transactionRoot, { recursive: true });
  backupApplyEntries(context, transactionRoot, entries);
  const proof = context.readJson(context.proofPath(id), {});
  const journal = {
    version: 1,
    changeId: id,
    transactionId,
    proofRunId: proof.proofRunId || null,
    mode: state.workspace.mode,
    status: "prepared",
    sandboxPath: state.workspace.path,
    targetPath: context.root,
    projectionHash: projectionHash(context.stableHash, entries),
    entries,
    appliedPaths: [],
    inFlightPaths: [],
    createdAt: context.now()
  };
  context.saveApplyJournal(journal);
  return journal;
}

export function refreshProjectionEntry(context, state, entry) {
  const source = resolve(state.workspace.path, entry.path);
  const expected = context.pathIdentity(source);
  const expectedMode = context.pathMode(source);
  const current = context.pathIdentity(context.safeRootPath(entry.path));
  const currentMode = context.pathMode(context.safeRootPath(entry.path));
  if (current !== expected || currentMode !== expectedMode)
    context.fail(`cannot refresh diverged applied path '${entry.path}'`);
  entry.after = expected;
  entry.afterMode = expectedMode;
}

export function refreshAppliedProjectionOperation(context, state) {
  const transactionId = state.workspace?.apply?.transactionId;
  const journalPath = context.transactionJournalPath(state.id, transactionId);
  if (!transactionId || !context.pathExists(journalPath))
    context.fail("cannot refresh an applied projection without its transaction journal");
  const journal = context.readJson(journalPath);
  for (const entry of journal.entries) refreshProjectionEntry(context, state, entry);
  journal.projectionHash = projectionHash(context.stableHash, journal.entries);
  journal.proofRunId = context.readJson(context.proofPath(state.id), {}).proofRunId || null;
  journal.status = "verified";
  journal.refreshedAt = context.now();
  context.saveApplyJournal(journal);
  state.workspace.apply.projectionHash = journal.projectionHash;
  state.workspace.apply.status = "verified";
  context.saveRuntime(state);
}

export function assertRecoveredProjection(context, id, state, archivedPath) {
  if (!["worktree", "copy"].includes(state.workspace?.mode)) return;
  if (!state.workspace.applied)
    context.fail(`the interrupted archive never projected the sandbox into the target; ` +
      `restore 'openspec/changes/${id}' from '${archivedPath}' and land again`);
  const verification = context.verifyAppliedProjection(state, { archivedChangePath: archivedPath });
  if (!verification.valid)
    context.fail(`recovered archive has an invalid applied projection: ${verification.reason}`);
}

export function assertRecoveredArchiveReadyOperation(context, id, state, archivedPath) {
  context.assertMultiRepositoryArchiveReady(id, state);
  assertRecoveredProjection(context, id, state, archivedPath);
}

export function createApplyRuntime({
  root,
  transactions,
  loadRuntime,
  saveRuntime,
  selectedRepositories = (_id, state) => [{
    id: "root", type: "git", mode: "write", path: root,
    dependsOn: [], workspacePath: state?.workspace?.path || root
  }],
  workspaceManifest,
  declaredSurfaceMatcher,
  currentChangeRelativePath,
  changePath,
  safeRootPath,
  pathIdentity,
  pathMode,
  directoryHash,
  fileDigest,
  pathInside,
  applyTransactionRoot,
  copyPath,
  proofPath,
  readJson,
  writeJson,
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
  archiveCheckpoint = () => {},
  measure = (_stage, operation) => operation(),
  assertLandGrant = () => {},
  consumeLandGrant = () => {},
  blockWithDecision,
  fail,
  // Every repository the topology declares under root, selected or not: its
  // gitlink is its own pointer, never root projection content.
  declaredRepositoryPaths = () => []
}) {
  function nestedRepositoryPaths(id, state) {
    return [...new Set([...selectedRepositories(id, state)
      .filter((repository) => repository.id !== "root" &&
        repository.relativePath && repository.relativePath !== "." &&
        !repository.relativePath.startsWith("../"))
      .map((repository) => repository.relativePath),
    ...declaredRepositoryPaths()])];
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
      .filter((path) => baseline[path] !== sandbox[path] && !nested(path) &&
        !isInvestigationPath(path)).sort();
  }

  // Against the base the sandbox branched from, not its HEAD: an agent that
  // commits inside the sandbox moves HEAD, and a HEAD-relative diff would
  // silently omit every committed change while proof — which hashes the
  // sandbox index — still counts it. That lands a partial change as a success.
  function sandboxBase(state) {
    return state.workspace?.baseHead || "HEAD";
  }

  // Paths whose target bytes are still another change's landed, uncommitted
  // projection: path -> landing change id.
  function landedBy(id, paths) {
    if (!paths.length || !transactions) return {};
    return landedTargetPaths({ root, paths, identity: pathIdentity,
      landed: otherLandedOutput({ transactions, changeId: id, readJson }) });
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
    writeFile: writeFileSync,
    removePath: (path) => rmSync(path, { force: true }),
    landedBy,
    blockWithDecision,
    fail
  });

  // Records the `--restore-target` authorization Land consumes. Regenerable
  // artifacts clean at isolation need none; any other path needs the user's
  // decision reference, because restoring discards target bytes.
  function recordTargetRestore(id, value, decisionRef = null) {
    const state = loadRuntime(id);
    if (state.status === "archived") fail(`change '${id}' is already archived`);
    if (state.workspace?.mode !== "worktree")
      fail(`change '${id}' has no worktree sandbox whose target files Land could restore`);
    const paths = parseRestoreTargetPaths(value);
    if (!paths.length) fail("--restore-target requires comma-separated target paths");
    for (const path of paths) {
      try { safeRootPath(path); } catch (error) { fail(error.message); }
    }
    const landed = landedBy(id, paths);
    if (Object.keys(landed).length)
      fail(`--restore-target would discard the landed, uncommitted work of ${
        [...new Set(Object.values(landed))].sort().join(", ")} at: ${Object.keys(landed).sort()
        .join(", ")}; Land never overwrites an earlier landed change. Resume with ` +
        `'claude-foundation advance ${id} --through archived' and it merges that work instead.`);
    const snapshot = state.workspace.targetDirty || state.workspace.preexisting || {};
    const needsDecision = paths.filter((path) =>
      !restorableTargetPaths([path], snapshot).length);
    const ref = String(decisionRef || "").trim() || null;
    if (needsDecision.length && !ref)
      fail(`--restore-target would discard target edits that may be user work at: ${
        needsDecision.join(", ")}; ask the user, then pass --decision-ref <user-decision>`);
    state.targetRestore = {
      paths,
      identities: Object.fromEntries(paths.map((path) =>
        [path, pathIdentity(safeRootPath(path))])),
      decisionRef: ref,
      recordedAt: now()
    };
    saveRuntime(state);
    return state.targetRestore;
  }

  function assertTargetHeadUnmoved(id, state) {
    const currentHead = gitHead(root);
    if (currentHead === state.workspace.baseHead) return;
    blockWithDecision(id, "control-head-moved", targetHeadMovedDecision({
      changeId: id,
      recordedBase: state.workspace.baseHead,
      currentHead,
      multiRepository: compositeRepositorySelection(selectedRepositories(id, state)),
      action: "Applying"
    }));
  }

  const buildApplyEntries = buildApplyEntriesOperation.bind(null, {
    root,
    workspaceManifest,
    copyCodePaths,
    pathMode,
    assertTargetHeadUnmoved,
    gitApplyInputs,
    safeRootPath,
    pathIdentity,
    currentChangeRelativePath,
    changePath,
    fail
  });

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
    return sandboxDiffNames(id, sandboxPath, state);
  }

  // The full projection, not just the delta, so verifyAppliedProjection keeps
  // covering every path the change owns.
  const buildReapplyEntries = buildReapplyEntriesOperation.bind(null, {
    currentChangeRelativePath,
    reapplyCodePaths,
    pathIdentity,
    safeRootPath,
    pathMode
  });

  function assertDeletionsAreDeclared(id, state, entries) {
    // Apply projects the root workspace; child repositories land by commit.
    const undeclared = undeclaredDeletions(entries,
      declaredSurfaceMatcher(id, state, "root"));
    if (!undeclared.length) return;
    const preview = undeclared.slice(0, 10).map((entry) => entry.path);
    fail(`apply would delete ${undeclared.length} path(s) no task declares: ${
      preview.join(", ")}${undeclared.length > preview.length ? ", ..." : ""
    }. A deletion has to come from a removal observed inside the sandbox, not ` +
      "from a path missing from its manifest; declare the path in tasks.md " +
      "`[paths:]` if the change really owns it.");
  }

  const prepareApplyTransaction = prepareApplyTransactionOperation.bind(null, {
    root,
    directoryHash,
    changePath,
    buildApplyEntries,
    nestedRepositoryPathMatcher,
    nestedRepositoryPaths,
    assertDeletionsAreDeclared,
    dateNow: Date.now,
    pid: process.pid,
    applyTransactionRoot,
    makeDirectory: mkdirSync,
    copyPath,
    safeRootPath,
    readJson,
    proofPath,
    stableHash,
    now,
    saveApplyJournal,
    fail
  });

  const refreshAppliedProjection = refreshAppliedProjectionOperation.bind(null, {
    transactionJournalPath,
    pathExists: existsSync,
    readJson,
    pathIdentity,
    pathMode,
    safeRootPath,
    stableHash,
    proofPath,
    now,
    saveApplyJournal,
    saveRuntime,
    fail
  });

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

  // The multi-repository delivery saga is only needed when a non-root
  // repository is selected; single-repository Apply never constructs it.
  let repositoryDeliverySaga = null;
  const repositoryDelivery = () => repositoryDeliverySaga ||= createRepositoryDeliverySaga({
    root,
    transactions,
    loadRuntime,
    saveRuntime,
    selectedRepositories,
    git,
    gitHead,
    fileDigest,
    directoryHash,
    pathInside,
    readJson,
    writeJson,
    stableHash,
    proofPath,
    now,
    prepareRoot: prepareApplyTransaction,
    executeRoot: (id, journal) => {
      beginApplyJournal({
        id, journal, safeRootPath, pathIdentity, pathMode,
        saveApplyJournal, now, fail
      });
      executeApplyJournal({
        id, journal, root, loadRuntime, saveRuntime, safeRootPath,
        pathIdentity, pathMode, applyTransactionEntry,
        rollbackApplyTransaction, saveApplyJournal, now, fail
      });
    },
    verifyRoot: verifyAppliedProjection,
    cleanupRoot: cleanupApplyTransaction,
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

  function recordDeliveryIntegrity(state, archivedPath, captured = [], modeBound = true) {
    if (typeof pathIdentity !== "function" || !archivedPath) return;
    const paths = [archivedPath, ...captured.map(({ capability }) =>
      `openspec/specs/${capability}/spec.md`)];
    state.deliveryIntegrity = {
      version: modeBound ? 2 : 1,
      createdAt: now(),
      entries: deliveryTreeEntries(root, [...new Set(paths)], pathIdentity)
    };
  }

  // Not a dead end: the inputs are retained, so after the agent repairs the
  // listed openspec/specs files, `advance --through archived` re-verifies the
  // merge from them and finishes the archive.
  function failSpecSync(violations) {
    fail(`archived specs do not match the change delta:\n${violations
      .map((violation) => `  ${violation.capability}/${violation.requirement || "-"}: ${
        violation.detail}`).join("\n")}\nRepair each listed openspec/specs/<capability>/spec.md so ` +
      "it carries the change delta; Land re-verifies the merge from the retained inputs.",
    1, { owner: "agent", boundary: "spec-sync", code: "SPEC_SYNC_VIOLATION" });
  }

  // The gate can only fire once the change is already recorded archived, so a
  // retry would otherwise take the early return and land the corrupted specs.
  // Re-verifying from the inputs captured before the merge means a repaired spec
  // tree clears the block on its own, with no one hand-editing runtime state.
  function outstandingSpecSync(state) {
    const captured = state.specSyncInputs;
    return Array.isArray(captured) && captured.length
      ? verifyArchivedSpecs(captured) : state.specSyncViolations || [];
  }

  const assertRecoveredArchiveReady = assertRecoveredArchiveReadyOperation.bind(null, {
    root,
    assertMultiRepositoryArchiveReady,
    verifyAppliedProjection,
    fail
  });

  // OpenSpec already moved the packet and merged the specs, but the merge was
  // not yet verified (a crash, or a violation the user is repairing).
  function specSyncPending(id, state = loadRuntime(id)) {
    return state.status !== "archived" && state.land?.status === "specs-archived" &&
      !existsSync(changePath(id));
  }

  // The change becomes `archived` only here, once the merged specs verify;
  // cleanup then resumes exactly as for any archived change.
  function completeSpecSync(id, state) {
    const outstanding = outstandingSpecSync(state);
    if (outstanding.length) {
      state.specSyncViolations = outstanding;
      saveRuntime(state);
      failSpecSync(outstanding);
    }
    transitionLifecycleState(state, "archived", "openspec-archive-complete");
    state.archivedAt ||= now();
    state.archivedChangePath ||= archivedChangeRelativePath(id);
    saveRuntime(state);
    resumeArchivedChange(id, state);
  }

  function resumeArchivedChange(id, state) {
    const outstanding = outstandingSpecSync(state);
    if (outstanding.length) {
      state.specSyncViolations = outstanding;
      saveRuntime(state);
      failSpecSync(outstanding);
    }
    if (!state.deliveryIntegrity && Array.isArray(state.specSyncInputs) &&
        typeof pathIdentity === "function") {
      const archivedPath = state.archivedChangePath || archivedChangeRelativePath(id);
      if (archivedPath) {
        assertRetainedArchiveIntegrity(id, state, archivedPath);
        recordDeliveryIntegrity(state, archivedPath, state.specSyncInputs,
          Array.isArray(state.land?.archivePacketEntries));
        saveRuntime(state);
      }
    }
    if (state.specSyncViolations || Array.isArray(state.specSyncInputs)) {
      delete state.specSyncViolations;
      delete state.specSyncInputs;
      saveRuntime(state);
    }
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
    cleanupChangeLeases(id);
    consumeLandGrant(id);
    // Quiet under `advance`, so the envelope carries it as a signal too.
    emitSignal("already-archived", `ALREADY ARCHIVED ${id}\n  archived: ${state.archivedAt || "unknown"}`,
      (line) => console.log(line));
  }

  function recoverInterruptedArchive(id, state, archivedPath) {
    // Recovery cannot tell "succeeded then crashed" from "moved then failed",
    // so it is not an exemption from the Land guards. Everything still
    // checkable once the change directory has moved is checked here, before
    // any state is written: a refusal has to leave the change recoverable.
    assertRecoveredArchiveReady(id, state, archivedPath);
    assertRetainedArchiveIntegrity(id, state, archivedPath);
    const outstanding = outstandingSpecSync(state);
    if (outstanding.length) {
      state.specSyncViolations = outstanding;
      saveRuntime(state);
      failSpecSync(outstanding);
    }
    transitionLifecycleState(state, "archived", "interrupted-archive-recovered");
    state.archivedAt ||= now();
    state.archivedChangePath = archivedPath;
    state.land = {
      ...(state.land || {}),
      status: "archive-audited",
      recoveredAt: now()
    };
    recordDeliveryIntegrity(state, archivedPath,
      Array.isArray(state.specSyncInputs) ? state.specSyncInputs : [],
      Array.isArray(state.land.archivePacketEntries));
    state.workspace.cleanup = cleanupAppliedSandbox(id, state);
    if (state.repositories)
      state.repositoryCleanup = cleanupRepositorySandboxes(id, state);
    if (state.workspace.apply)
      state.workspace.apply.cleanup = cleanupApplyTransaction(state);
    cleanupChangeLeases(id);
    delete state.workspace.baseline;
    delete state.specSyncInputs;
    delete state.specSyncViolations;
    saveRuntime(state);
    consumeLandGrant(id);
    console.log(`ARCHIVED ${id}\n  recovered: interrupted archive transaction`);
  }

  function assertRetainedArchiveIntegrity(id, state, archivedPath) {
    if (state.specApproval?.required &&
        (state.specApproval.revision !== Number(state.contractRevision || 0) ||
        !approvalMatches(state.specApproval.identity, root,
          archivedPath.slice("openspec/changes/".length))))
      fail("interrupted archive no longer matches the approved agreement; preserve both versions and restore the approved packet before retrying Land");
    if (state.land?.archivePacketEntries) {
      const active = `openspec/changes/${id}`;
      assertDeliveryEntries(root, state.land.archivePacketEntries.map((entry) => ({
        ...entry, path: archivedPath + entry.path.slice(active.length)
      })), pathIdentity);
    }
  }

  function archiveRecoveryReady(id) {
    const state = loadRuntime(id);
    // Only verification remains; completeSpecSync re-checks it before archiving.
    if (specSyncPending(id, state)) return true;
    if (state.status === "archived" || state.land?.status !== "archive-prepared" ||
        existsSync(changePath(id))) return false;
    const archivedPath = archivedChangeRelativePath(id);
    if (!archivedPath) return false;
    assertRecoveredArchiveReady(id, state, archivedPath);
    assertRetainedArchiveIntegrity(id, state, archivedPath);
    const outstanding = outstandingSpecSync(state);
    if (outstanding.length) failSpecSync(outstanding);
    return true;
  }

  function recoverArchive(id, authorizeLand) {
    if (loadRuntime(id).status === "archived" || specSyncPending(id)) {
      archive(id);
      return true;
    }
    if (!archiveRecoveryReady(id)) return false;
    authorizeLand(id);
    archive(id);
    return true;
  }

  function snapshotArchiveEvidence(id, readiness) {
    const journal = loadRuntime(id);
    const proof = readJson(proofPath(id), {});
    journal.land = {
      ...(journal.land || {}),
      status: "evidence-snapshotted",
      proofRunId: proof.proofRunId || null,
      assurance: readiness.assurance,
      updatedAt: now()
    };
    saveRuntime(journal);
  }

  function applyArchiveWorkspace(id, readiness) {
    if (!["worktree", "copy"].includes(readiness.state.workspace?.mode))
      return readiness;
    measure("land.apply", () => {
      if (compositeRepositorySelection(selectedRepositories(id, readiness.state))) {
        // Legacy repository Land records already name commits applied by the
        // user. Their root gitlinks are staged by resumeLand; replaying the
        // workspace-uncommitted delivery saga would misclassify those expected
        // child HEADs as target drift.
        if (!legacyRepositoryLandTransaction(readiness.state)) repositoryDelivery().apply(id);
      }
      else applySandbox(id, { controlPlane: true }, readiness);
    });
    const journal = loadRuntime(id);
    journal.land = { ...journal.land, status: "code-applied", updatedAt: now() };
    saveRuntime(journal);
    // Post-apply readiness binds the hash recorded before the destructive
    // OpenSpec archive; it is never reused.
    return measure("land.check", () => landCheck(id));
  }

  function recordArchiveTelemetry(id, state) {
    const telemetry = telemetryReadiness?.(id) || null;
    state.land = {
      ...(state.land || {}),
      telemetry: telemetry ? {
        classification: telemetry.classification,
        reason: telemetry.reason,
        correlatedHosts: telemetry.correlatedHosts,
        measuredDimensions: telemetry.measuredDimensions
      } : null,
      updatedAt: now()
    };
    saveRuntime(state);
    if (telemetry && !["measured", "no-usage"].includes(telemetry.classification)) {
      console.error(telemetry.classification === "not-ingested"
        ? "WARNING: no model usage was imported for this change; cost and token columns stay empty — telemetry not-ingested"
        : telemetryUsageSatisfied(telemetry)
          ? `WARNING: telemetry ${telemetry.classification}; unavailable dimensions remain empty`
          : `WARNING: telemetry ${telemetry.classification}; cost and token columns may stay empty`);
    }
    return telemetry;
  }

  function runOpenSpecArchive(id, state, readiness) {
    const preArchiveWorkspaceHash = readiness.hash;
    // 'openspec archive' moves the change out of openspec/changes and rewrites
    // openspec/specs in one step, so the delta and the pre-merge spec text can
    // only be read now.
    const specSyncInputs = captureSpecSyncInputs(id);
    // This is the recovery record for the destructive OpenSpec move. Persist it
    // before the command so a crash after the move can still verify the merge.
    state.specSyncInputs = specSyncInputs;
    state.preArchiveWorkspaceHash = preArchiveWorkspaceHash;
    state.land = { ...state.land, status: "archive-prepared", updatedAt: now(),
      ...(typeof pathIdentity === "function" ? {
        archivePacketEntries: deliveryTreeEntries(root, [`openspec/changes/${id}`], pathIdentity)
      } : {}) };
    saveRuntime(state);
    // landCheck already gated this; repeated here because it is the last point
    // before the destructive step and the CLI can disappear in between.
    assertOpenSpecCli(root, fail);
    archiveCheckpoint("before-archive-command", state);
    const cli = spawnSync("openspec", ["archive", id, "--yes"], { cwd: root, encoding: "utf8" });
    if (cli.status !== 0) fail(`OpenSpec archive failed: ${(cli.stderr || cli.stdout).trim()}`);
    archiveCheckpoint("after-archive-command", state);
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
    archiveCheckpoint("before-spec-sync-verification", state);
    const specViolations = verifyArchivedSpecs(specSyncInputs);
    if (specViolations.length) {
      state.specSyncViolations = specViolations;
      // Only retained on failure: the retry guard needs the pre-merge text to
      // re-verify, and carrying it on the happy path would bloat every state file.
      state.specSyncInputs = specSyncInputs;
      saveRuntime(state);
      failSpecSync(specViolations);
    }
    // `archived` is reported only once the merged specs verify; a crash or a
    // violation before this resumes through interrupted-archive recovery,
    // which re-verifies from the retained inputs.
    transitionLifecycleState(state, "archived", "openspec-archive-complete");
    state.archivedAt = now();
    recordDeliveryIntegrity(state, state.archivedChangePath, specSyncInputs);
    delete state.specSyncInputs;
    delete state.specSyncViolations;
    saveRuntime(state);
    archiveCheckpoint("after-spec-sync-verification", state);
    return cli;
  }

  function finalizeArchivedChange(id, state, telemetry, cli) {
    archiveCheckpoint("before-final-audit", state);
    archiveCheckpoint("after-final-audit", state);
    state.land = { ...state.land, status: "archive-audited", updatedAt: now() };
    archiveCheckpoint("before-cleanup", state);
    state.workspace.cleanup = cleanupAppliedSandbox(id, state);
    if (state.repositories &&
        compositeRepositorySelection(selectedRepositories(id, state)))
      repositoryDelivery().cleanup(id, state);
    if (state.repositories)
      state.repositoryCleanup = cleanupRepositorySandboxes(id, state);
    cleanupChangeLeases(id);
    if (state.workspace.apply)
      state.workspace.apply.cleanup = cleanupApplyTransaction(state);
    delete state.workspace.baseline;
    state.land.status = "sandbox-cleaned";
    saveRuntime(state);
    consumeLandGrant(id);
    archiveCheckpoint("after-cleanup", state);
    if (!state.archivedChangePath)
      console.error("WARNING: OpenSpec reported success but the archived change directory was not found");
    if (["failed", "refused"].includes(state.workspace.cleanup.status))
      console.error(`WARNING: sandbox cleanup ${state.workspace.cleanup.status}: ${state.workspace.cleanup.reason}`);
    if (!telemetry && !modelUsageRecorded(id))
      console.error(`WARNING: no model usage was imported for this change; cost and token columns stay empty — claude-foundation telemetry sync ${id} [transcript.jsonl]`);
    console.log(cli.stdout.trim());
    const assurance = state.land?.assurance?.status || "legacy-unknown";
    console.log(`${assurance === "passed" ? "LANDED" :
      ["failed", "inconclusive"].includes(assurance)
        ? "LANDED_WITH_RISK" : "LANDED_UNPROVEN"} ${id}\n  assurance: ${assurance}\n  lifecycle: archived`);
  }

  function archive(id) {
    const initial = loadRuntime(id);
    if (initial.status === "archived") {
      resumeArchivedChange(id, initial);
      return;
    }
    if (specSyncPending(id, initial)) {
      completeSpecSync(id, initial);
      return;
    }
    assertLandGrant(id);
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
    archiveCheckpoint("before-telemetry-drain", initial);
    try { syncClaudeTelemetry(id, { quiet: true }); } catch { /* warned below */ }
    archiveCheckpoint("after-telemetry-drain", initial);
    // Explicit Land authority may recover an interrupted mechanical apply.
    // Prepared/applying journals are rolled back safely; only a divergent
    // manual-recovery journal becomes a user work decision.
    recoverPendingApply(id, initial);
    let readiness = measure("land.check", () => landCheck(id));
    if (readiness.archived) return;
    archiveCheckpoint("before-evidence-snapshot", readiness.state);
    snapshotArchiveEvidence(id, readiness);
    archiveCheckpoint("after-evidence-snapshot", readiness.state);
    // Unconditional, including when the sandbox is already applied: work done
    // after the first projection is proven and would otherwise archive as a
    // success while the target still holds the earlier code. applySandbox
    // returns early by itself when the projection is already current.
    archiveCheckpoint("before-code-apply", readiness.state);
    readiness = applyArchiveWorkspace(id, readiness);
    assertMultiRepositoryArchiveReady(id, readiness.state);
    archiveCheckpoint("after-code-apply", readiness.state);
    // Re-read rather than reuse readiness.state: on the no-sandbox path that
    // object predates the journal write above, and saving it below would
    // silently erase land.proofRunId from the record.
    const state = loadRuntime(id);
    const telemetry = recordArchiveTelemetry(id, state);
    const cli = measure("land.archive", () => runOpenSpecArchive(id, state, readiness));
    measure("land.cleanup", () => finalizeArchivedChange(id, state, telemetry, cli));
  }

  return {
    gitApplyInputs,
    recordTargetRestore,
    buildApplyEntries,
    prepareApplyTransaction,
    refreshAppliedProjection,
    applySandbox,
    archiveRecoveryReady,
    recoverArchive,
    archive
  };
}
