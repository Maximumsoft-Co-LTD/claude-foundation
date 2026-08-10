import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync
} from "node:fs";
import { constants as fsConstants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { isExcludedPath, trackedPathSet } from "../core/workspace-surface.mjs";

// `cpSync` resolves symlinks by default: a relative link is rewritten as an
// absolute path into the *source* tree. In a sandbox that is not a cosmetic
// difference — anything following the link writes into the real project while
// believing it is isolated, and git inside the copy reports the rewritten link
// as a modification the change never made. `land-journal.mjs` already carries
// these two options for the same reason on the way back out.
const VERBATIM_COPY = { dereference: false, verbatimSymlinks: true };

export function createSandboxRuntime({
  root, excludedWorkspaceDirs, sandboxCopyExcludedDirs, hostAttestation,
  loadRuntime, saveRuntime,
  canonicalPath, workspaceManifest, directoryHash, changePath, gitHead, git,
  selectedRepositories, cleanupRepositorySandboxes, cleanupAppliedSandbox,
  clearSnapshotCache, validate, repositorySelectionIdsAt, contractFingerprint,
  executionFingerprint, taskBlocks, proofPath, relevantHash, fail
}) {
  function sandboxRoot(id) {
    return join(root, ".foundation", "sandboxes", id);
  }

  // A linked worktree or a submodule carries `.git` as a *file* pointing at a
  // gitdir somewhere else. Copying that file would hand the sandbox a pointer
  // straight back into the target's repository, so every commit, checkout, or
  // index write made in isolation would land in the very tree the sandbox
  // exists to leave alone. Only a real directory is safe to carry.
  function gitMetadataIsCarryable() {
    const gitPath = join(root, ".git");
    if (!existsSync(gitPath)) return false;
    try {
      return statSync(gitPath).isDirectory();
    } catch {
      return false;
    }
  }

  // Regenerable build output is pure cost to copy, and at real repository sizes
  // it is a fault rather than an inefficiency: a 79GB Rust `target/` exhausted
  // the disk mid-copy and left a 41GB tree the runtime had never recorded. A
  // fixed list of directory *names* cannot keep up with that — it knew
  // `node_modules` and `coverage` but not `target`, `dist`, `build`, `vendor`,
  // or `.venv`. Git already tracks the distinction the copy actually needs, so
  // ask it. `--others --ignored` never reports a tracked path, so committed
  // content stays carried no matter what it is named, and `--directory`
  // collapses a wholly-ignored tree to one entry the filter can refuse before
  // descending into it.
  function ignoredPathSet(carriesGit) {
    if (!carriesGit) return new Set();
    const listed = git(
      ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"], root);
    if (listed.status !== 0) return new Set();
    return new Set(listed.stdout.split("\0").filter(Boolean)
      .map((path) => (path.endsWith("/") ? path.slice(0, -1) : path)));
  }

  function createCopy(id, state, reason) {
    const requestedPath = sandboxRoot(id);
    if (existsSync(requestedPath))
      fail(`sandbox path already occupied: ${requestedPath}`);
    // `.git` is excluded from every hash and every apply diff by name, so a
    // copy that carries it never projects it back and never hashes it. What it
    // does buy is that the copy stays a git repository: without it `gitHead`
    // returns null, the changed surface degrades from `git diff` to a walk of
    // the whole tree, and `singleRelevantSnapshot` loses its `.gitignore`
    // awareness — so running the evidence wrote build output into the workspace
    // hash and expired the evidence that had just been collected.
    const carriesGit = gitMetadataIsCarryable();
    const copyExcluded = carriesGit ? sandboxCopyExcludedDirs : excludedWorkspaceDirs;
    mkdirSync(requestedPath, { recursive: true });
    // The sandbox lives under `.foundation/`, which is inside the tree being
    // copied. `cpSync(root, dest)` rejects that outright — it checks for a
    // destination inside the source before it ever consults `filter`, so the
    // exclusion that makes the copy terminate is never seen. Copying each
    // top-level entry instead keeps the exclusion authoritative: `.foundation`
    // is dropped at the top level, so nothing recurses into the sandbox itself.
    // What git tracks is content, whatever it is named. Without this the copy
    // silently omitted committed fixtures whose directory name collided with a
    // build-output name, and git inside the sandbox then reported them deleted.
    const listed = carriesGit ? git(["ls-files", "-z"], root) : { status: 1, stdout: "" };
    const tracked = trackedPathSet(
      listed.status === 0 ? listed.stdout.split("\0").filter(Boolean) : []);
    const ignored = ignoredPathSet(carriesGit);
    const excludes = (rel) =>
      ignored.has(rel) ||
      isExcludedPath(rel, { excluded: copyExcluded, tracked: tracked.has(rel) });
    const filter = (source) => !excludes(relative(root, source).replaceAll("\\", "/"));
    // A copy that dies partway leaves a directory the runtime never recorded:
    // `state.workspace` is still whatever it was, so nothing knows the tree
    // exists, while `sandbox path already occupied` blocks every retry. Filling
    // the disk is exactly how that happens, so the failure path has to remove
    // what it wrote before reporting.
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (excludes(entry.name)) continue;
        cpSync(join(root, entry.name), join(requestedPath, entry.name), {
          recursive: true,
          mode: fsConstants.COPYFILE_FICLONE,
          ...VERBATIM_COPY,
          filter
        });
      }
    } catch (error) {
      rmSync(requestedPath, { recursive: true, force: true });
      fail(`cannot create sandbox copy: ${error.message}; partial copy removed`);
    }
    const path = canonicalPath(requestedPath);
    // The copied `.git/worktrees` still names the *target's* linked worktrees by
    // absolute path. Left in place, a `git worktree` command run inside the
    // sandbox would operate on directories outside it.
    if (carriesGit)
      rmSync(join(path, ".git", "worktrees"), { recursive: true, force: true });
    state.workspace = {
      mode: "copy", path, applied: false, reason,
      // Recorded for the same reason the worktree mode records it: without a
      // base commit the changed surface cannot separate what this change did
      // from what the working tree already carried.
      baseHead: carriesGit ? gitHead(root) : null,
      git: carriesGit ? "carried" : "absent",
      baseline: workspaceManifest(root, id, true),
      changeSourceHash: directoryHash(changePath(id))
    };
    state.status = "building";
    saveRuntime(state);
    console.log(`SANDBOX ${id}\n  mode: isolated-copy\n  reason: ${reason}\n  git: ${
      carriesGit ? "carried" : "absent (target has no usable .git directory)"
    }\n  path: ${path}`);
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
    // Dirt the harness produced itself must not cost this change its worktree.
    // Landing a *previous* change moves its packet into `changes/archive/` and
    // leaves that move uncommitted, so the very next `sandbox create` saw a
    // dirty target and fell back to an isolated copy — a mode with strictly
    // lower fidelity — for a reason the operator had no part in. Neither path
    // is ever this change's surface: `.foundation/` is machine state, and
    // `allowed()` in the snapshot drops `changes/archive/` outright, so a
    // worktree taken from HEAD cannot lose work by ignoring them here.
    //
    // Every other change's draft belongs in that same category. The loop keeps
    // drafts uncommitted until Land by design, so a second active change made
    // every later `sandbox create` fall back to a copy — the expensive mode —
    // for state the operator was told to leave uncommitted. Nothing is lost by
    // ignoring it: `singleRelevantSnapshot` drops `openspec/changes/` that is
    // not this change, and the apply diff excludes this change's own directory.
    const harnessOwned = (path) =>
      path.startsWith(".foundation/") || path === ".foundation" ||
      path.startsWith("openspec/changes/") || path === "openspec/changes";
    const unrelated = dirty.stdout.split("\n").filter(Boolean).filter((line) => {
      const path = line.slice(3).split(" -> ").at(-1);
      return path !== `openspec/changes/${id}` && !path.startsWith(allowedPrefix) &&
        !harnessOwned(path);
    });
    if (unrelated.length) {
      createCopy(id, state, `dirty-target:${unrelated[0]}`);
      return;
    }
    const requestedPath = sandboxRoot(id);
    mkdirSync(dirname(requestedPath), { recursive: true });
    const result = git(["worktree", "add", "--detach", requestedPath, "HEAD"]);
    if (result.status !== 0) fail(`cannot create sandbox: ${result.stderr.trim()}`);
    const path = canonicalPath(requestedPath);
    cpSync(changePath(id), join(path, "openspec", "changes", id),
      { recursive: true, ...VERBATIM_COPY });
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
    cpSync(source, destination, { recursive: true, ...VERBATIM_COPY });
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
