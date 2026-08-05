import { existsSync } from "node:fs";
import { join } from "node:path";

export function createLandRuntime({
  root,
  transactions,
  loadRuntime,
  saveRuntime,
  recoverPendingApply,
  assertNoDroppedScenarios,
  proofAudit,
  proofPath,
  readJson,
  writeJson,
  clearSnapshotCache,
  relevantHash,
  requiredProviders,
  receiptValidity,
  fileDigest,
  receiptPath,
  verifyAppliedProjection,
  selectedRepositories,
  repositoryById,
  git,
  gitHead,
  now,
  fail
}) {
  function landCheck(id) {
    let state = loadRuntime(id);
    recoverPendingApply(id, state);
    state = loadRuntime(id);
    if (state.status === "archived") {
      const audit = proofAudit(id, true);
      if (!audit.valid) fail(`archived proof audit failed: ${audit.reason}`);
      console.log(`ALREADY ARCHIVED ${id}\n  archived: ${state.archivedAt || "unknown"}`);
      return { archived: true, state };
    }
    // Before any projection: a spec delta that silently drops a scenario only
    // fails inside 'openspec archive', by which point the code has landed and
    // the change is stuck half-applied.
    assertNoDroppedScenarios(id);
    const proof = existsSync(proofPath(id)) ? readJson(proofPath(id)) : null;
    if (!proof || proof.status !== "pass") fail(`change '${id}' has no passing proof`);
    const audit = proofAudit(id, true);
    if (!audit.valid) fail(`proof audit failed: ${audit.reason}`);
    clearSnapshotCache(id);
    const hash = relevantHash(id, null, true);
    if (proof.workspaceHash !== hash)
      fail(`proof is stale (${proof.workspaceHash.slice(0, 8)} != ${hash.slice(0, 8)})`);
    for (const provider of requiredProviders(id)) {
      const check = receiptValidity(id, provider, hash);
      if (check.validity !== "valid") fail(`${provider} evidence is ${check.validity}`);
      const manifestEntry = (proof.receipts || []).find((entry) => entry.provider === provider);
      if (!manifestEntry || fileDigest(receiptPath(id, provider)) !== manifestEntry.sha256)
        fail(`${provider} live receipt differs from the proven receipt manifest`);
    }
    if (state.workspace?.applied) {
      const applied = verifyAppliedProjection(state);
      if (!applied.valid) fail(`applied projection is invalid: ${applied.reason}`);
    }
    const multiRepository = state.repositories && Object.keys(state.repositories).length > 1;
    console.log(`LAND READY ${id}\n  workspace: ${hash}\n  next: claude-foundation land ${
      multiRepository ? "resume" : "archive"} ${id}`);
    return { archived: false, state, hash };
  }

  function orderedRepositories(id, state = loadRuntime(id)) {
    const repositories = selectedRepositories(id, state);
    const byId = new Map(repositories.map((repository) => [repository.id, repository]));
    const visiting = new Set();
    const visited = new Set();
    const ordered = [];
    function visit(repository) {
      if (visiting.has(repository.id))
        fail(`repository dependency cycle at '${repository.id}'`);
      if (visited.has(repository.id)) return;
      visiting.add(repository.id);
      for (const dependency of repository.dependsOn || []) {
        const target = byId.get(dependency);
        if (target) visit(target);
      }
      visiting.delete(repository.id);
      visited.add(repository.id);
      ordered.push(repository);
    }
    repositories.forEach(visit);
    ordered.sort((left, right) => {
      if (left.id === "root") return 1;
      if (right.id === "root") return -1;
      return 0;
    });
    return ordered;
  }

  function repositoryCommitLanded(repository, commit) {
    if (!commit || !gitHead(repository.path)) return false;
    const result = git(["merge-base", "--is-ancestor", commit, "HEAD"], repository.path);
    return result.status === 0;
  }

  function rootGitlink(workspace, repository) {
    if (repository.type !== "submodule") return null;
    const result = git(["ls-files", "-s", "--", repository.relativePath], workspace);
    if (result.status !== 0) return null;
    return result.stdout.trim().match(/^160000\s+([0-9a-f]+)/)?.[1] || null;
  }

  function landPlanValue(id) {
    const state = loadRuntime(id);
    const proof = existsSync(proofPath(id)) ? readJson(proofPath(id), {}) : null;
    const repositories = orderedRepositories(id, state).map((repository) => {
      const runtime = state.repositories?.[repository.id] || {};
      const commit = runtime.land?.commit || null;
      const landed = repository.id === "root" ? false :
        repositoryCommitLanded(repository, commit);
      const sandboxGitlink = rootGitlink(state.workspace?.path || root, repository);
      const targetGitlink = rootGitlink(root, repository);
      let status = repository.mode === "read" ? "read-only" :
        repository.id === "root" ? "control-plane-last" :
        !runtime.path ? "sandbox-missing" :
        !commit ? "awaiting-explicit-commit" :
        !landed ? "awaiting-explicit-branch-land" :
        repository.type === "submodule" &&
          (sandboxGitlink !== commit || targetGitlink !== commit)
          ? "awaiting-root-pointer" : "child-landed";
      if (runtime.land?.ci === "fail") status = "ci-failed";
      if (runtime.land?.ciRequired && runtime.land?.ci !== "pass")
        status = "awaiting-ci";
      return {
        id: repository.id,
        type: repository.type,
        mode: repository.mode,
        dependsOn: repository.dependsOn || [],
        targetPath: repository.path,
        sandboxPath: runtime.path || repository.workspacePath,
        baseHead: runtime.baseHead || repository.baseHead,
        targetHead: gitHead(repository.path),
        sandboxHead: gitHead(runtime.path || repository.workspacePath),
        commit,
        ci: runtime.land?.ci || null,
        rootGitlink: sandboxGitlink,
        targetRootGitlink: targetGitlink,
        status
      };
    });
    return {
      version: 1,
      changeId: id,
      proofRunId: proof?.proofRunId || null,
      proofStatus: proof?.status || "missing",
      workspaceHash: relevantHash(id),
      strategy: "ordered-resumable-saga",
      repositories,
      readyToArchive: repositories.every((repository) =>
        ["read-only", "child-landed", "control-plane-last"].includes(repository.status)),
      updatedAt: now()
    };
  }

  function showLandPlan(id) {
    const plan = landPlanValue(id);
    writeJson(join(transactions, id, "multi-repo-land.json"), plan);
    console.log(JSON.stringify(plan, null, 2));
  }

  function recordRepositoryLand(id, flags) {
    const repositoryId = flags.repo;
    const commit = flags.commit;
    if (!repositoryId || !commit)
      fail("land record requires --repo <id> --commit <sha>");
    const decisionRef = String(flags["decision-ref"] || "").trim();
    if (!decisionRef)
      fail("land record requires --decision-ref <host-user-decision>; ask the user to authorize binding this child commit before recording it");
    landCheck(id);
    const state = loadRuntime(id);
    const repository = repositoryById(id, repositoryId, state);
    if (repository.id === "root" || repository.mode !== "write")
      fail(`repository '${repositoryId}' is not a writable child repository`);
    const runtime = state.repositories?.[repositoryId];
    if (!runtime?.path) fail(`repository '${repositoryId}' has no sandbox`);
    const resolved = git(["rev-parse", `${commit}^{commit}`], runtime.path);
    if (resolved.status !== 0)
      fail(`commit '${commit}' is not available in repository '${repositoryId}'`);
    const normalizedCommit = resolved.stdout.trim();
    const sandboxHead = gitHead(runtime.path);
    if (sandboxHead !== normalizedCommit)
      fail(`repository '${repositoryId}' sandbox HEAD must equal the recorded commit`);
    const dirty = git(["status", "--porcelain"], runtime.path);
    if (dirty.status !== 0 || dirty.stdout.trim())
      fail(`repository '${repositoryId}' sandbox must be clean before recording Land`);
    const ci = flags.ci || null;
    if (ci && !["pass", "fail", "pending"].includes(ci))
      fail("land record --ci must be pass|fail|pending");
    state.repositories[repositoryId].land = {
      commit: normalizedCommit,
      ci,
      ciRequired: Boolean(flags["ci-required"]),
      recordedAt: now(),
      authority: { kind: "host-user-decision", reference: decisionRef }
    };
    saveRuntime(state);
    console.log(`LAND RECORDED ${id}/${repositoryId}\n  commit: ${normalizedCommit}\n  ci: ${ci || "unknown"}`);
  }

  function stageRootPointers(id) {
    landCheck(id);
    const state = loadRuntime(id);
    if (!state.repositories || Object.keys(state.repositories).length <= 1)
      fail(`change '${id}' is not multi-repository`);
    if (gitHead(root) !== state.workspace?.baseHead)
      fail("control repository HEAD moved since sandbox creation");
    const entries = orderedRepositories(id, state)
      .filter((repository) => repository.type === "submodule" &&
        repository.mode === "write")
      .map((repository) => {
        const runtime = state.repositories[repository.id];
        const commit = runtime?.land?.commit;
        if (!commit || !repositoryCommitLanded(repository, commit))
          fail(`repository '${repository.id}' commit has not landed`);
        if (runtime.land.ciRequired && runtime.land.ci !== "pass")
          fail(`repository '${repository.id}' required CI has not passed`);
        const sandboxBefore = rootGitlink(state.workspace.path, repository);
        const targetBefore = rootGitlink(root, repository);
        if (![runtime.baseHead, commit].includes(sandboxBefore) ||
            ![runtime.baseHead, commit].includes(targetBefore))
          fail(`repository '${repository.id}' root pointer changed outside the Land plan`);
        return { repository, commit, sandboxBefore, targetBefore };
      });
    if (!entries.length) {
      console.log(`ROOT POINTERS ${id}: no submodule pointers required`);
      return;
    }
    const applied = [];
    try {
      for (const entry of entries) {
        const sandboxResult = git([
          "update-index", "--cacheinfo",
          `160000,${entry.commit},${entry.repository.relativePath}`
        ], state.workspace.path);
        if (sandboxResult.status !== 0)
          throw new Error(`cannot update ${entry.repository.id} sandbox pointer: ${sandboxResult.stderr.trim()}`);
        const targetResult = git([
          "update-index", "--cacheinfo",
          `160000,${entry.commit},${entry.repository.relativePath}`
        ], root);
        if (targetResult.status !== 0) {
          git(["update-index", "--cacheinfo",
            `160000,${entry.sandboxBefore},${entry.repository.relativePath}`],
          state.workspace.path);
          throw new Error(`cannot update ${entry.repository.id} target pointer: ${targetResult.stderr.trim()}`);
        }
        applied.push(entry);
      }
    } catch (error) {
      for (const entry of applied.reverse()) {
        git(["update-index", "--cacheinfo",
          `160000,${entry.sandboxBefore},${entry.repository.relativePath}`],
        state.workspace.path);
        git(["update-index", "--cacheinfo",
          `160000,${entry.targetBefore},${entry.repository.relativePath}`], root);
      }
      fail(`${error.message}; root pointers rolled back`);
    }
    state.land = {
      ...(state.land || {}),
      strategy: "ordered-resumable-saga",
      status: "root-pointers-staged",
      pointers: Object.fromEntries(entries.map((entry) =>
        [entry.repository.id, entry.commit])),
      pointersStagedAt: now()
    };
    state.status = "building";
    delete state.provenHash;
    clearSnapshotCache(id);
    saveRuntime(state);
    console.log(`ROOT POINTERS STAGED ${id}\n  proof is stale; run /prove ${id}`);
  }

  function resumeLand(id) {
    landCheck(id);
    const state = loadRuntime(id);
    for (const repository of orderedRepositories(id, state)) {
      if (repository.id === "root" || repository.mode !== "write") continue;
      const runtime = state.repositories?.[repository.id];
      if (!runtime?.land?.commit) continue;
      runtime.land.status = repositoryCommitLanded(repository, runtime.land.commit)
        ? "child-landed" : "awaiting-explicit-branch-land";
      runtime.land.checkedAt = now();
    }
    state.land = {
      ...(state.land || {}),
      strategy: "ordered-resumable-saga",
      status: "children-inspected",
      resumedAt: now()
    };
    saveRuntime(state);
    const plan = landPlanValue(id);
    if (plan.repositories.some((repository) => repository.status === "awaiting-root-pointer")) {
      stageRootPointers(id);
      return;
    }
    showLandPlan(id);
  }

  function assertMultiRepositoryArchiveReady(id, state) {
    if (!state.repositories || Object.keys(state.repositories).length <= 1) return;
    const plan = landPlanValue(id);
    const blocked = plan.repositories.filter((repository) =>
      !["read-only", "child-landed", "control-plane-last"].includes(repository.status));
    if (blocked.length)
      fail(`multi-repository Land is incomplete: ${blocked.map((repository) =>
        `${repository.id}:${repository.status}`).join(", ")}`);
  }

  return {
    landCheck,
    orderedRepositories,
    repositoryCommitLanded,
    rootGitlink,
    landPlanValue,
    showLandPlan,
    recordRepositoryLand,
    stageRootPointers,
    resumeLand,
    assertMultiRepositoryArchiveReady
  };
}
