import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync
} from "node:fs";
import { constants as fsConstants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

export function createSandboxRuntime({
  root, excludedWorkspaceDirs, hostAttestation, loadRuntime, saveRuntime,
  canonicalPath, workspaceManifest, directoryHash, changePath, gitHead, git,
  selectedRepositories, cleanupRepositorySandboxes, cleanupAppliedSandbox,
  clearSnapshotCache, validate, repositorySelectionIdsAt, contractFingerprint,
  executionFingerprint, taskBlocks, proofPath, relevantHash, fail
}) {
  function createCopy(id, state, reason) {
    const path = canonicalPath(mkdtempSync(join(tmpdir(), `foundation-${id}-`)));
    cpSync(root, path, {
      recursive: true,
      mode: fsConstants.COPYFILE_FICLONE,
      filter: (source) => {
        const rel = relative(root, source).replaceAll("\\", "/");
        return (rel === "" && source === root) ||
          !rel.split("/").some((segment) => excludedWorkspaceDirs.has(segment));
      }
    });
    state.workspace = {
      mode: "copy", path, applied: false, reason,
      baseline: workspaceManifest(root, id, true),
      changeSourceHash: directoryHash(changePath(id))
    };
    state.status = "building";
    saveRuntime(state);
    console.log(`SANDBOX ${id}\n  mode: isolated-copy\n  reason: ${reason}\n  path: ${path}`);
  }

  function createChallenge(id) {
    const challenge = hostAttestation.createChallenge(id);
    console.log(JSON.stringify(challenge, null, 2));
    return challenge;
  }

  function directoryExists(path) {
    if (!path || !existsSync(path)) return false;
    try { return statSync(path).isDirectory(); }
    catch { return false; }
  }

  function gitMetadataPresent(workspacePath) {
    if (!directoryExists(workspacePath)) return false;
    const metadataPath = join(workspacePath, ".git");
    if (!existsSync(metadataPath)) return false;
    try {
      const metadata = statSync(metadataPath);
      if (metadata.isDirectory()) return true;
      if (!metadata.isFile() || metadata.size > 4096) return false;
      const match = readFileSync(metadataPath, "utf8").match(/^gitdir:\s*(.+?)\s*$/m);
      return Boolean(match && directoryExists(resolve(dirname(metadataPath), match[1])));
    } catch {
      return false;
    }
  }

  function workspaceInspection(id, state = loadRuntime(id)) {
    const workspace = state.workspace || {};
    const kind = workspace.mode === "worktree" ? "git-worktree" :
      workspace.mode === "copy" ? "filesystem-copy" : "none";
    const identityValid = kind === "git-worktree" ? gitMetadataPresent(workspace.path) :
      kind === "filesystem-copy" ? directoryExists(workspace.path) : true;
    const status = kind === "none" ? "current" : identityValid ? "active" : "missing";
    const repositories = Object.entries(state.repositories || {}).map(([repositoryId, runtime]) => ({
      id: repositoryId,
      access: runtime.access || "write",
      kind: runtime.mode === "worktree" ? "git-worktree" :
        runtime.mode === "copy" ? "filesystem-copy" :
          runtime.mode === "reference" ? "reference" : "none",
      status: runtime.path && existsSync(runtime.path) ? "active" : "missing",
      path: runtime.path || null
    })).sort((left, right) => left.id.localeCompare(right.id));
    return { kind, status, path: workspace.path || root, repositories };
  }

  function inspect(id, flags = {}) {
    const workspaceIsolation = workspaceInspection(id);
    const preflight = hostAttestation.preflight(id, flags);
    return {
      version: 1,
      changeId: id,
      workspaceIsolation,
      securityBoundary: preflight.securityBoundary,
      attestation: preflight.attestation,
      execution: {
        mode: flags.unattended ? "unattended" : "interactive",
        boundaryDetected: preflight.boundaryDetected,
        safeForUnattended: preflight.safeForUnattended,
        decision: !flags.unattended || preflight.safeForUnattended ? "allow" : "block",
        reasons: preflight.reasons
      }
    };
  }

  function showInspection(id, flags = {}) {
    const result = inspect(id, flags);
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`ISOLATION ${id}`);
      console.log(`  workspace isolation: ${result.workspaceIsolation.kind} (${result.workspaceIsolation.status})`);
      console.log(`  security boundary: ${result.securityBoundary.kind} (${result.securityBoundary.status})`);
      console.log(`  safe for unattended: ${result.execution.safeForUnattended ? "yes" : "no"}`);
      for (const reason of result.execution.reasons) console.log(`  reason: ${reason}`);
    }
    if (flags.unattended && !result.execution.safeForUnattended) process.exitCode = 1;
  }

  function createSingle(id) {
    const state = loadRuntime(id);
    if (state.status === "archived") fail(`change '${id}' is already archived`);
    if (["worktree", "copy"].includes(state.workspace?.mode) && existsSync(state.workspace.path))
      fail(`sandbox already exists: ${state.workspace.path}`);
    if (!gitHead(root)) {
      createCopy(id, state, "no-git");
      return;
    }
    const dirty = git(["status", "--porcelain", "--untracked-files=all"], root);
    if (dirty.status !== 0) fail(`cannot inspect target workspace: ${dirty.stderr.trim()}`);
    const allowedPrefix = `openspec/changes/${id}/`;
    const unrelated = dirty.stdout.split("\n").filter(Boolean).filter((line) => {
      const path = line.slice(3).split(" -> ").at(-1);
      return path !== `openspec/changes/${id}` && !path.startsWith(allowedPrefix);
    });
    if (unrelated.length) {
      createCopy(id, state, `dirty-target:${unrelated[0]}`);
      return;
    }
    const requestedPath = join(root, ".foundation", "sandboxes", id);
    mkdirSync(dirname(requestedPath), { recursive: true });
    const result = git(["worktree", "add", "--detach", requestedPath, "HEAD"]);
    if (result.status !== 0) fail(`cannot create sandbox: ${result.stderr.trim()}`);
    const path = canonicalPath(requestedPath);
    cpSync(changePath(id), join(path, "openspec", "changes", id), { recursive: true });
    state.workspace = {
      mode: "worktree", path, baseHead: gitHead(root), applied: false,
      changeSourceHash: directoryHash(changePath(id))
    };
    state.status = "building";
    saveRuntime(state);
    console.log(`SANDBOX ${id}\n  path: ${path}`);
  }

  function create(id, flags = {}) {
    if (flags.unattended) {
      const preflight = hostAttestation.preflight(id, flags, true);
      if (!preflight.safeForUnattended)
        fail(`unattended sandbox creation requires a trusted host-owned security attestation; detected virtualization alone is insufficient: ${preflight.reasons.join("; ")}`);
    }
    const initial = loadRuntime(id);
    const repositories = selectedRepositories(id, initial);
    if (repositories.length === 1 && repositories[0].id === "root" && !flags.all) {
      createSingle(id);
      return;
    }
    createSingle(id);
    const state = loadRuntime(id);
    state.repositories = {};
    try {
      for (const repository of repositories) {
        if (repository.id === "root") {
          state.repositories.root = {
            mode: state.workspace.mode, path: state.workspace.path, targetPath: root,
            baseHead: state.workspace.baseHead || gitHead(root), access: repository.mode
          };
          continue;
        }
        const baseHead = gitHead(repository.path);
        if (!baseHead && repository.mode === "write")
          throw new Error(`repository '${repository.id}' is not an initialized Git repository`);
        if (repository.mode === "read" || repository.type === "external") {
          state.repositories[repository.id] = {
            mode: "reference", path: repository.path, targetPath: repository.path,
            baseHead, access: "read"
          };
          continue;
        }
        const requestedPath = join(root, ".foundation", "repository-sandboxes", id, repository.id);
        if (existsSync(requestedPath)) throw new Error(`repository sandbox already exists: ${requestedPath}`);
        mkdirSync(dirname(requestedPath), { recursive: true });
        const result = git(["worktree", "add", "--detach", requestedPath, baseHead], repository.path);
        if (result.status !== 0)
          throw new Error(`cannot create sandbox for '${repository.id}': ${result.stderr.trim()}`);
        const path = canonicalPath(requestedPath);
        state.repositories[repository.id] = {
          mode: "worktree", path, targetPath: repository.path,
          baseHead, access: "write", applied: false
        };
      }
    } catch (error) {
      cleanupRepositorySandboxes(id, state);
      cleanupAppliedSandbox(id, state);
      state.workspace = { mode: "current", path: root, baseHead: gitHead(root) };
      delete state.repositories;
      state.status = "change";
      saveRuntime(state);
      fail(`${error.message}; created sandboxes rolled back`);
    }
    state.status = "building";
    saveRuntime(state);
    clearSnapshotCache(id);
    console.log(`MULTI-REPOSITORY SANDBOX ${id}`);
    for (const repository of selectedRepositories(id, state))
      console.log(`  ${repository.id}: ${repository.workspacePath}`);
  }

  function mergeTaskProgress(source, sandbox) {
    const completedIds = new Set(taskBlocks(sandbox)
      .filter((task) => task.done && task.id).map((task) => task.id));
    const completedText = new Set(taskBlocks(sandbox)
      .filter((task) => task.done)
      .map((task) => task.text.replace(/\s+/g, " ").trim()));
    return source.split("\n").map((line) => {
      if (!/^\s*-\s*\[\s\]/.test(line)) return line;
      const text = line.replace(/^\s*-\s*\[\s\]\s*/, "").trim();
      const taskId = text.match(/^\*{0,2}(T\d{3,})\*{0,2}\b/i)?.[1]?.toUpperCase();
      return (taskId ? completedIds.has(taskId) : completedText.has(text))
        ? line.replace("[ ]", "[x]") : line;
    }).join("\n");
  }

  function sync(id) {
    validate(id, "root", { quiet: true });
    const state = loadRuntime(id);
    const workspace = state.workspace;
    if (!workspace || !["worktree", "copy"].includes(workspace.mode) ||
        !workspace.path || !existsSync(workspace.path))
      fail(`change '${id}' has no active sandbox`);
    const source = changePath(id);
    const destination = join(workspace.path, "openspec", "changes", id);
    const priorRepositories = repositorySelectionIdsAt(destination);
    const nextRepositories = repositorySelectionIdsAt(source);
    if (JSON.stringify(priorRepositories) !== JSON.stringify(nextRepositories))
      fail("repository scope changed during Build; finish or split the current repository work before creating a topology revision");
    const sourceTasks = readFileSync(join(source, "tasks.md"), "utf8");
    const sandboxTasks = existsSync(join(destination, "tasks.md"))
      ? readFileSync(join(destination, "tasks.md"), "utf8") : "";
    const priorContract = existsSync(destination) ? contractFingerprint(id, destination) : null;
    const priorExecution = existsSync(destination) ? executionFingerprint(id, destination) : null;
    const nextContract = contractFingerprint(id, source);
    const nextExecution = executionFingerprint(id, source);
    const mergedTasks = mergeTaskProgress(sourceTasks, sandboxTasks);
    if (existsSync(destination)) rmSync(destination, { recursive: true });
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true });
    writeFileSync(join(destination, "tasks.md"), mergedTasks);
    state.workspace.changeSourceHash = directoryHash(source);
    state.status = "building";
    state.revision = Number(state.revision || 0) + 1;
    if (priorContract !== nextContract) state.contractRevision = Number(state.contractRevision || 0) + 1;
    if (priorExecution !== nextExecution) state.executionRevision = Number(state.executionRevision || 0) + 1;
    delete state.provenHash;
    if (existsSync(proofPath(id))) rmSync(proofPath(id));
    clearSnapshotCache(id);
    saveRuntime(state);
    console.log(`SYNCED ${id}\n  revision: ${state.revision}\n  workspace: ${relevantHash(id)}`);
  }

  return {
    createChallenge, workspaceInspection, inspect, showInspection,
    createSingle, create, mergeTaskProgress, sync
  };
}
