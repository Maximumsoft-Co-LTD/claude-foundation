import {
  existsSync, mkdirSync, readdirSync, rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export function createApplyRuntime({
  root,
  transactions,
  loadRuntime,
  saveRuntime,
  selectedRepositories,
  workspaceManifest,
  currentChangeRelativePath,
  changePath,
  safeRootPath,
  pathIdentity,
  directoryHash,
  applyTransactionRoot,
  copyPath,
  proofPath,
  readJson,
  stableHash,
  saveApplyJournal,
  transactionJournalPath,
  verifyAppliedProjection,
  rollbackApplyTransaction,
  applyTransactionEntry,
  cleanupApplyTransaction,
  canonicalPath,
  git,
  gitHead,
  landCheck,
  assertMultiRepositoryArchiveReady,
  archivedChangeRelativePath,
  pendingTasks,
  isPinnedOpenSpecVersion,
  proofAudit,
  cleanupChangeLeases,
  now,
  fail
}) {
  function gitApplyInputs(id, sandboxPath) {
    git(["add", "-N", "."], sandboxPath);
    const pathspec = [
      ".",
      `:(exclude)openspec/changes/${id}/**`,
      ":(exclude)coverage/**", ":(exclude)test-results/**",
      ":(exclude)playwright-report/**", ":(exclude).foundation/**"
    ];
    const state = loadRuntime(id);
    for (const repository of selectedRepositories(id, state))
      if (repository.type === "submodule")
        pathspec.push(`:(exclude)${repository.relativePath}`);
    const diff = git(["diff", "--binary", "HEAD", "--", ...pathspec], sandboxPath);
    if (diff.status !== 0) fail("cannot inspect sandbox diff");
    if (!diff.stdout) {
      if (state.repositories && Object.keys(state.repositories).length > 1) return [];
      fail("sandbox has no applicable diff");
    }
    const check = spawnSync("git", ["apply", "--check", "--whitespace=nowarn", "-"], {
      cwd: root, input: diff.stdout, encoding: "utf8"
    });
    if (check.status !== 0)
      fail(`sandbox diff conflicts with target: ${check.stderr.trim()}`);
    const names = git(["diff", "--name-only", "-z", "HEAD", "--", ...pathspec], sandboxPath);
    if (names.status !== 0) fail(`cannot inspect sandbox paths: ${names.stderr.trim()}`);
    return names.stdout.split("\0").filter(Boolean).sort();
  }

  function buildApplyEntries(id, state) {
    const sandboxPath = state.workspace.path;
    let codePaths;
    if (state.workspace.mode === "copy") {
      const baseline = state.workspace.baseline || {};
      const sandbox = workspaceManifest(sandboxPath, id, true);
      const target = workspaceManifest(root, id, true);
      codePaths = [...new Set([...Object.keys(baseline), ...Object.keys(sandbox)])]
        .filter((path) => baseline[path] !== sandbox[path]).sort();
      for (const path of codePaths)
        if ((target[path] ?? null) !== (baseline[path] ?? null))
          fail(`isolated-copy conflict at '${path}'`);
    } else if (state.workspace.mode === "worktree") {
      if (gitHead(root) !== state.workspace.baseHead)
        fail("target HEAD moved since sandbox creation");
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
        after: pathIdentity(source)
      };
    });
    const changeRel = currentChangeRelativePath(id);
    entries.push({
      path: changeRel,
      role: "change-artifacts",
      before: pathIdentity(changePath(id)),
      after: pathIdentity(join(sandboxPath, changeRel))
    });
    return entries;
  }

  function prepareApplyTransaction(id, state) {
    if (directoryHash(changePath(id)) !== state.workspace.changeSourceHash)
      fail("active change was edited after the last sandbox sync");
    const entries = buildApplyEntries(id, state);
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
      projectionHash: stableHash(entries.map(({ path, after }) => ({ path, after }))),
      entries,
      appliedPaths: [],
      inFlightPaths: [],
      createdAt: now()
    };
    saveApplyJournal(journal);
    return journal;
  }

  function recoverPendingApply(id, state) {
    const transactionRoot = join(transactions, id);
    if (!existsSync(transactionRoot)) return;
    for (const entry of readdirSync(transactionRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = transactionJournalPath(id, entry.name);
      if (!existsSync(path)) continue;
      const journal = readJson(path);
      if (!["prepared", "applying"].includes(journal.status)) continue;
      if (state.workspace?.applied &&
          state.workspace.apply?.transactionId === journal.transactionId) {
        const verification = verifyAppliedProjection(state);
        if (!verification.valid)
          fail(`interrupted apply cannot resume: ${verification.reason}`);
        journal.status = "verified";
        journal.verifiedAt = now();
        saveApplyJournal(journal);
      } else {
        try {
          rollbackApplyTransaction(journal, "interrupted apply recovered before retry");
        } catch (error) {
          fail(error.message);
        }
      }
    }
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
      const current = pathIdentity(safeRootPath(entry.path));
      if (current !== expected)
        fail(`cannot refresh diverged applied path '${entry.path}'`);
      entry.after = expected;
    }
    journal.projectionHash = stableHash(
      journal.entries.map(({ path, after }) => ({ path, after }))
    );
    journal.proofRunId = readJson(proofPath(state.id)).proofRunId;
    journal.status = "verified";
    journal.refreshedAt = now();
    saveApplyJournal(journal);
    state.workspace.apply.projectionHash = journal.projectionHash;
    state.workspace.apply.status = "verified";
    saveRuntime(state);
  }

  function applySandbox(id, options = {}) {
    const initialState = loadRuntime(id);
    if (initialState.repositories && Object.keys(initialState.repositories).length > 1 &&
        !options.controlPlane)
      fail("multi-repository sandboxes do not apply as one local transaction; use land plan/record/resume");
    if (initialState.workspace?.applied && options.refresh)
      refreshAppliedProjection(initialState);
    const readiness = landCheck(id);
    if (readiness.archived) return;
    let state = loadRuntime(id);
    recoverPendingApply(id, state);
    state = loadRuntime(id);
    if (state.workspace?.applied) {
      const verification = verifyAppliedProjection(state);
      if (!verification.valid) fail(`applied projection is invalid: ${verification.reason}`);
      console.log(`APPLIED ${id}\n  resumed: ${state.workspace.apply.transactionId}`);
      return;
    }
    const journal = prepareApplyTransaction(id, state);
    journal.status = "applying";
    saveApplyJournal(journal);
    try {
      journal.entries.forEach((entry, index) =>
        applyTransactionEntry(journal, entry, index));
      const mismatch = journal.entries.find((entry) =>
        pathIdentity(safeRootPath(entry.path)) !== entry.after);
      if (mismatch) throw new Error(`post-apply projection mismatch at '${mismatch.path}'`);
      state = loadRuntime(id);
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
    }
  }

  function cleanupAppliedSandbox(id, state) {
    const path = state.workspace?.sandboxPath;
    if (!path || resolve(path) === resolve(root) || !existsSync(path))
      return { status: "not-needed", path: path || null };
    if (state.workspace.mode === "copy") {
      const expectedPrefix = `${canonicalPath(tmpdir())}/foundation-${id}-`;
      if (!canonicalPath(path).startsWith(expectedPrefix))
        return { status: "refused", path, reason: "copy path is outside the Foundation temp prefix" };
      try {
        rmSync(path, { recursive: true });
        return { status: "removed", path };
      } catch (error) {
        return { status: "failed", path, reason: error.message };
      }
    }
    if (state.workspace.mode === "worktree") {
      const expected = resolve(root, ".foundation", "sandboxes", id);
      if (resolve(path) !== expected)
        return { status: "refused", path, reason: "worktree path is outside the expected sandbox location" };
      const removed = git(["worktree", "remove", "--force", path], root);
      if (removed.status !== 0)
        return { status: "failed", path, reason: removed.stderr.trim() };
      git(["worktree", "prune"], root);
      return { status: "removed", path };
    }
    return { status: "not-needed", path };
  }

  function cleanupRepositorySandboxes(id, state) {
    const results = {};
    for (const [repositoryId, runtime] of Object.entries(state.repositories || {})) {
      if (repositoryId === "root" || runtime.mode !== "worktree" ||
          !runtime.path || !existsSync(runtime.path)) {
        results[repositoryId] = { status: "not-needed" };
        continue;
      }
      const expected = resolve(root, ".foundation", "repository-sandboxes", id, repositoryId);
      if (resolve(runtime.path) !== expected) {
        results[repositoryId] = {
          status: "refused", reason: "repository sandbox path is outside the expected location"
        };
        continue;
      }
      const target = runtime.targetPath;
      const removed = git(["worktree", "remove", "--force", runtime.path], target);
      if (removed.status !== 0) {
        results[repositoryId] = { status: "failed", reason: removed.stderr.trim() };
        continue;
      }
      git(["worktree", "prune"], target);
      results[repositoryId] = { status: "removed" };
    }
    return results;
  }

  function archive(id) {
    const initial = loadRuntime(id);
    if (initial.status === "archived") {
      const audit = proofAudit(id, true);
      if (!audit.valid) fail(`archived proof audit failed: ${audit.reason}`);
      let resumed = false;
      if (initial.workspace &&
          !["removed", "not-needed"].includes(initial.workspace.cleanup?.status)) {
        initial.workspace.cleanup = cleanupAppliedSandbox(id, initial);
        initial.land = {
          ...(initial.land || {}),
          status: initial.workspace.cleanup.status === "removed"
            ? "sandbox-cleaned" : "archive-audited",
          resumedAt: now()
        };
        resumed = true;
      }
      if (initial.workspace?.apply &&
          initial.workspace.apply.cleanup?.status !== "committed") {
        initial.workspace.apply.cleanup = cleanupApplyTransaction(initial);
        resumed = true;
      }
      if (initial.repositories && !initial.repositoryCleanup) {
        initial.repositoryCleanup = cleanupRepositorySandboxes(id, initial);
        resumed = true;
      }
      if (resumed) saveRuntime(initial);
      console.log(`ALREADY ARCHIVED ${id}\n  archived: ${initial.archivedAt || "unknown"}`);
      return;
    }
    const recoveredArchive = initial.status !== "archived" &&
      !existsSync(changePath(id)) && archivedChangeRelativePath(id);
    if (recoveredArchive) {
      initial.status = "archived";
      initial.archivedAt ||= now();
      initial.archivedChangePath = recoveredArchive;
      initial.land = {
        ...(initial.land || {}),
        status: "archive-audited",
        recoveredAt: now()
      };
      initial.workspace.cleanup = cleanupAppliedSandbox(id, initial);
      if (initial.repositories)
        initial.repositoryCleanup = cleanupRepositorySandboxes(id, initial);
      if (initial.workspace.apply)
        initial.workspace.apply.cleanup = cleanupApplyTransaction(initial);
      delete initial.workspace.baseline;
      saveRuntime(initial);
      const audit = proofAudit(id, true);
      if (!audit.valid) fail(`recovered archive has invalid proof: ${audit.reason}`);
      console.log(`ARCHIVED ${id}\n  recovered: interrupted archive transaction`);
      return;
    }
    let readiness = landCheck(id);
    if (readiness.archived) return;
    assertMultiRepositoryArchiveReady(id, readiness.state);
    let journal = loadRuntime(id);
    journal.land = {
      ...(journal.land || {}),
      status: "evidence-snapshotted",
      proofRunId: readJson(proofPath(id)).proofRunId,
      updatedAt: now()
    };
    saveRuntime(journal);
    if (["worktree", "copy"].includes(readiness.state.workspace?.mode) &&
        !readiness.state.workspace.applied) {
      applySandbox(id, { controlPlane: true });
      journal = loadRuntime(id);
      journal.land = { ...(journal.land || {}), status: "code-applied", updatedAt: now() };
      saveRuntime(journal);
      readiness = landCheck(id);
    }
    const state = readiness.state;
    const pending = pendingTasks(id);
    if (pending.length) fail(`${pending.length} implementation task(s) remain unchecked`);
    const preArchiveWorkspaceHash = readiness.hash;
    const installed = spawnSync("openspec", ["--version"], { cwd: root, encoding: "utf8" });
    if (installed.error?.code === "ENOENT")
      fail("OpenSpec CLI is required for safe spec sync and archive (@fission-ai/openspec@1.7.0)");
    const installedVersion = `${installed.stdout || ""}${installed.stderr || ""}`;
    if (!isPinnedOpenSpecVersion(installedVersion))
      fail(`OpenSpec version mismatch; required 1.7.0, found '${installedVersion.trim()}'`);
    const cli = spawnSync("openspec", ["archive", id, "--yes"], { cwd: root, encoding: "utf8" });
    if (cli.status !== 0) fail(`OpenSpec archive failed: ${(cli.stderr || cli.stdout).trim()}`);
    state.status = "archived";
    state.archivedAt = now();
    state.preArchiveWorkspaceHash = preArchiveWorkspaceHash;
    state.archivedChangePath = archivedChangeRelativePath(id);
    state.land = { ...(state.land || {}), status: "specs-archived", updatedAt: now() };
    saveRuntime(state);
    const audit = proofAudit(id, true);
    if (!audit.valid) fail(`post-archive proof audit failed: ${audit.reason}`);
    state.land = { ...(state.land || {}), status: "archive-audited", updatedAt: now() };
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
    console.log(cli.stdout.trim());
    console.log(`ARCHIVED ${id}`);
  }

  return {
    gitApplyInputs,
    buildApplyEntries,
    prepareApplyTransaction,
    recoverPendingApply,
    refreshAppliedProjection,
    applySandbox,
    cleanupAppliedSandbox,
    cleanupRepositorySandboxes,
    archive
  };
}
