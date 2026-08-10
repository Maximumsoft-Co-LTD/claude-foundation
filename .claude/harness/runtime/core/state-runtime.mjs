import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, readFileSync, readdirSync, readlinkSync
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { isExcludedPath } from "./workspace-surface.mjs";

export function createStateRuntime({
  root,
  runtime,
  changes,
  receipts,
  evidenceVault,
  snapshots,
  excludedWorkspaceDirs,
  readJson,
  writeJson,
  canonicalPath,
  selectedRepositories,
  now,
  fail
}) {
  function runtimePath(id) { return join(runtime, `${id}.json`); }
  function changePath(id) { return join(changes, id); }
  function receiptPath(id, provider) { return join(receipts, id, `${provider}.json`); }
  function proofPath(id) { return join(receipts, id, "proof.json"); }
  function proofRunRoot(id, proofRunId) { return join(evidenceVault, id, proofRunId); }
  function snapshotPath(id) { return join(snapshots, `${id}.json`); }
  function currentChangeRelativePath(id) { return `openspec/changes/${id}`; }

  function isCurrentChangePath(rel, id) {
    const base = currentChangeRelativePath(id);
    return rel === base || rel.startsWith(`${base}/`);
  }

  function activeChangePath(id, state = loadRuntime(id)) {
    if (state.status === "archived" && state.archivedChangePath) {
      const archived = join(root, state.archivedChangePath);
      if (existsSync(archived)) return archived;
    }
    const workspace = state.workspace;
    if (workspace && ["worktree", "copy"].includes(workspace.mode) &&
        workspace.path && existsSync(workspace.path)) {
      const candidate = join(workspace.path, "openspec", "changes", id);
      if (existsSync(candidate)) return candidate;
    }
    return changePath(id);
  }

  function archivedChangeRelativePath(id) {
    const archiveRoot = join(changes, "archive");
    if (!existsSync(archiveRoot)) return null;
    // OpenSpec prefixes the archived directory with a date, so the suffix is
    // how the change is found. Anchor it to that prefix: a bare `-${id}` also
    // matches an unrelated archived change whose own id merely ends this way
    // (`quick-fix-login` for `fix-login`), which both widens the recovered-
    // archive trigger and can record the wrong archivedChangePath.
    const datePrefixed = new RegExp(`^\\d{4}-\\d{2}-\\d{2}(-\\d+)?-${
      id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
    const candidates = readdirSync(archiveRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() &&
        (entry.name === id || datePrefixed.test(entry.name)))
      .map((entry) => entry.name).sort();
    return candidates.length ? `openspec/changes/archive/${candidates.at(-1)}` : null;
  }

  function slugify(value) {
    return value.toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "change";
  }

  // `recoverable` is for the one caller that must work precisely when the
  // state file is gone or unreadable: `change abandon` is the designed exit
  // from a broken change, and gating it on loadRuntime made it the dead end it
  // exists to resolve. A minimal placeholder is enough for abandon to
  // quarantine what is on disk.
  function loadRuntime(id, { recoverable = false } = {}) {
    const path = runtimePath(id);
    const present = existsSync(path);
    if (!present && !recoverable) fail(`unknown change '${id}'`);
    if (!present && !existsSync(changePath(id)))
      fail(`unknown change '${id}'`);
    if (!present)
      return { version: 2, id, status: "unknown", schema: null, recoveredState: "missing" };
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      if (!recoverable)
        fail(`invalid JSON: ${runtimeRelativePath(id)} (${error.message}); ` +
          `retire it with 'claude-foundation change abandon ${id} --reason <reason> --decision-ref <ref>'`);
      return { version: 2, id, status: "unknown", schema: null, recoveredState: "corrupt" };
    }
  }

  function runtimeRelativePath(id) {
    return relative(root, runtimePath(id));
  }

  function saveRuntime(state) {
    state.updatedAt = now();
    writeJson(runtimePath(state.id), state);
  }

  function activeChanges() {
    return readdirSync(changes, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "archive")
      .map((entry) => entry.name).sort();
  }

  function orphanRuntimeChanges() {
    if (!existsSync(runtime)) return [];
    const active = new Set(activeChanges());
    return readdirSync(runtime, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => {
        const id = entry.name.slice(0, -5);
        try {
          const state = JSON.parse(readFileSync(join(runtime, entry.name), "utf8"));
          if (state.status === "archived" || active.has(id)) return null;
          return { id, schema: state.schema || "unknown", reason: "missing-active-change" };
        } catch {
          return { id, schema: "unknown", reason: "invalid-runtime-json" };
        }
      })
      .filter(Boolean)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  function walk(dir, callback) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, callback);
      else if (entry.isFile() || entry.isSymbolicLink()) callback(path);
    }
  }

  function fileDigest(path) {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  }

  function filesystemEntryIdentity(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return `symlink:${readlinkSync(path)}`;
    if (stat.isFile()) return fileDigest(path);
    return `unsupported:${stat.mode}`;
  }

  function directoryHash(dir) {
    const hash = createHash("sha256");
    const files = [];
    walk(dir, (path) => files.push(path));
    files.sort((a, b) => relative(dir, a).localeCompare(relative(dir, b)));
    for (const path of files) {
      hash.update(relative(dir, path).replaceAll("\\", "/"));
      hash.update("\0");
      hash.update(filesystemEntryIdentity(path));
      hash.update("\0");
    }
    return hash.digest("hex");
  }

  function stableHash(value) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  function serializedJson(value, pretty = false) {
    return `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`;
  }

  function compactList(values, limit = 20, project = (value) => value) {
    const projected = values.map(project);
    if (projected.length <= limit) return projected;
    return {
      count: projected.length,
      preview: projected.slice(0, limit),
      digest: stableHash(projected)
    };
  }

  function compactStrings(values, limit = 20) {
    return compactList(values, limit, (value) => String(value));
  }

  // `compactList` returns an array under the limit and `{count, preview, digest}`
  // over it, so every reader has to accept both shapes. Most do, by testing
  // `Array.isArray` at the point of use; `authority status --template` did not,
  // and called `.map` on the compact object — so emitting the response template
  // threw for any review carrying more than twelve claims, at exactly the moment
  // a responder needed the shape. Read compacted fields through this instead of
  // re-deriving the check: it is the half of the pair that was missing.
  //
  // A compacted list is deliberately lossy, so a caller that must not silently
  // work from a prefix should compare `expandList(value).length` against
  // `listCount(value)` and say so.
  function expandList(value) {
    if (Array.isArray(value)) return value;
    return Array.isArray(value?.preview) ? value.preview : [];
  }

  function listCount(value) {
    if (Array.isArray(value)) return value.length;
    return Number.isInteger(value?.count) ? value.count : 0;
  }

  const snapshotCache = new Map();
  const policyCache = new Map();

  function git(args, cwd = root) {
    return spawnSync("git", args, { cwd, encoding: "utf8" });
  }

  function gitHead(cwd) {
    const result = git(["rev-parse", "HEAD"], cwd);
    return result.status === 0 ? result.stdout.trim() : null;
  }

  function singleRelevantSnapshot(id, workspaceOverride = null, force = false) {
    const state = existsSync(runtimePath(id)) ? readJson(runtimePath(id)) : {};
    const workspace = canonicalPath(workspaceOverride || state.workspace?.path || root);
    const cacheKey = `${id}\0${workspace}\0${Number(state.contractRevision || state.revision || 0)}`;
    if (!force && snapshotCache.has(cacheKey)) return snapshotCache.get(cacheKey);
    const hash = createHash("sha256");
    const files = [];
    function allowed(rel, tracked = false) {
      if (isExcludedPath(rel, { excluded: excludedWorkspaceDirs, tracked }))
        return false;
      if (rel.startsWith("openspec/changes/archive/")) return false;
      if (rel.startsWith("openspec/changes/") && !isCurrentChangePath(rel, id))
        return false;
      if (rel === `${currentChangeRelativePath(id)}/execution.yaml`) return false;
      return true;
    }
    function collect(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        const rel = relative(workspace, path).replaceAll("\\", "/");
        if (!allowed(rel)) continue;
        if (entry.isDirectory()) collect(path);
        else if (entry.isFile() || entry.isSymbolicLink()) files.push([rel, path]);
      }
    }
    const gitIndex = git(["ls-files", "-s", "-z"], workspace);
    const gitStatus = git([
      "status", "--porcelain=v1", "-z", "--untracked-files=all"
    ], workspace);
    if (gitIndex.status === 0 && gitStatus.status === 0) {
      const indexed = new Map();
      for (const line of gitIndex.stdout.split("\0").filter(Boolean)) {
        const match = line.match(/^(\d+)\s+([0-9a-f]+)\s+\d+\t(.+)$/);
        if (match) indexed.set(match[3], { mode: match[1], oid: match[2] });
      }
      const dirty = new Set();
      const statusEntries = gitStatus.stdout.split("\0").filter(Boolean);
      for (let index = 0; index < statusEntries.length; index += 1) {
        const line = statusEntries[index];
        dirty.add(line.slice(3));
        if ((/^[RC]/.test(line) || /^[RC]/.test(line.slice(1))) &&
            statusEntries[index + 1])
          dirty.add(statusEntries[++index]);
      }
      // Tracking is per path, so it has to be asked per path: a fixture
      // directory whose name collides with a build-output name is only
      // distinguishable from real build output by whether git carries it.
      const paths = [...new Set([...indexed.keys(), ...dirty])]
        .filter((rel) => allowed(rel, indexed.has(rel))).sort();
      for (const rel of paths) {
        const path = join(workspace, rel);
        const contentIdentity = dirty.has(rel)
          ? (indexed.get(rel)?.mode === "160000"
            ? `gitlink:${indexed.get(rel).oid}`
            : (existsSync(path) ? filesystemEntryIdentity(path) : "deleted"))
          : indexed.get(rel)?.oid;
        files.push([rel, path]);
        hash.update(rel);
        hash.update("\0");
        hash.update(contentIdentity || "missing");
        hash.update("\0");
      }
    } else {
      collect(workspace);
      files.sort(([a], [b]) => a.localeCompare(b));
      for (const [rel, path] of files) {
        hash.update(rel);
        hash.update("\0");
        hash.update(filesystemEntryIdentity(path));
        hash.update("\0");
      }
    }
    hash.update(`foundation-contract-revision:${Number(state.contractRevision || state.revision || 0)}`);
    const workspaceHash = hash.digest("hex");
    const value = {
      version: 1,
      id: `snapshot-${workspaceHash.slice(0, 20)}`,
      changeId: id,
      workspace,
      workspaceHash,
      revision: Number(state.contractRevision || state.revision || 0),
      fileCount: files.length,
      createdAt: now()
    };
    snapshotCache.set(cacheKey, value);
    if (workspace === resolve(state.workspace?.path || root)) writeJson(snapshotPath(id), value);
    return value;
  }

  function relevantSnapshot(id, workspaceOverride = null, force = false) {
    const state = existsSync(runtimePath(id)) ? readJson(runtimePath(id)) : {};
    if (workspaceOverride || !state.repositories ||
        Object.keys(state.repositories).length === 0)
      return singleRelevantSnapshot(id, workspaceOverride, force);
    const control = singleRelevantSnapshot(id, state.workspace?.path || root, force);
    const repositories = {};
    for (const repository of selectedRepositories(id, state)) {
      if (repository.id === "root") {
        repositories.root = {
          id: control.id,
          workspaceHash: control.workspaceHash,
          workspace: control.workspace,
          baseHead: repository.baseHead || gitHead(root)
        };
        continue;
      }
      const workspace = repository.workspacePath || repository.path;
      const snapshot = singleRelevantSnapshot(id, workspace, force);
      repositories[repository.id] = {
        id: snapshot.id,
        workspaceHash: snapshot.workspaceHash,
        workspace: snapshot.workspace,
        baseHead: repository.baseHead || gitHead(repository.path)
      };
    }
    const workspaceHash = stableHash({
      version: 1,
      contractRevision: Number(state.contractRevision || state.revision || 0),
      control: control.workspaceHash,
      repositories: Object.entries(repositories).sort(([left], [right]) =>
        left.localeCompare(right)).map(([repository, value]) => ({
        repository, workspaceHash: value.workspaceHash, baseHead: value.baseHead
      }))
    });
    const value = {
      version: 2,
      id: `snapshot-${workspaceHash.slice(0, 20)}`,
      changeId: id,
      workspace: control.workspace,
      workspaceHash,
      revision: Number(state.contractRevision || state.revision || 0),
      fileCount: control.fileCount,
      control,
      repositories,
      createdAt: now()
    };
    writeJson(snapshotPath(id), value);
    return value;
  }

  function relevantHash(id, workspaceOverride = null, force = false) {
    return relevantSnapshot(id, workspaceOverride, force).workspaceHash;
  }

  function clearSnapshotCache(id = null) {
    for (const key of snapshotCache.keys())
      if (!id || key.startsWith(`${id}\0`)) snapshotCache.delete(key);
    if (id) policyCache.delete(id);
    else policyCache.clear();
  }

  // Git-ignored output is regenerable, so it belongs in no baseline. Walking it
  // is not a small waste: this repository's gitignored `target/` put 906,814 of
  // 909,041 entries into one manifest, cost ~250s of hashing to build, and grew
  // the runtime state file to 156MB — which every later command then had to
  // parse, taking `changes` from 0.09s to 1.96s and `packet` from 0.22s to 9.3s.
  // The copy sandbox already refuses these paths, so including them here would
  // also describe files the sandbox does not have.
  function ignoredPathSet(workspace) {
    const listed = git(
      ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
      workspace);
    if (listed.status !== 0) return new Set();
    return new Set(listed.stdout.split("\0").filter(Boolean)
      .map((path) => (path.endsWith("/") ? path.slice(0, -1) : path)));
  }

  // What the working tree already carried when a change began.
  //
  // The changed surface is derived from `git status`, which cannot tell a file
  // this change wrote from a file that was simply sitting there. A stray
  // untracked `theme.css` therefore counted as change surface and pulled the
  // `accessibility` policy trigger onto a one-line rapid change that had not
  // touched a stylesheet — evidence the author could not honestly produce.
  //
  // Digests, not just paths: a pre-existing file the change later edits is real
  // surface again, and dropping it by name would silently lose it.
  function preexistingDirty(workspace = root) {
    const dirty = git(["status", "--porcelain", "--untracked-files=all"], workspace);
    if (dirty.status !== 0) return {};
    const result = {};
    for (const line of dirty.stdout.split("\n").filter(Boolean)) {
      const rel = line.slice(3).split(" -> ").at(-1);
      if (!rel) continue;
      const path = join(workspace, rel);
      try {
        if (!existsSync(path) || !lstatSync(path).isFile()) continue;
        result[rel] = fileDigest(path);
      } catch {
        // A path that cannot be read now cannot be compared later either.
      }
    }
    return result;
  }

  function workspaceManifest(workspace, id, excludeChange = false) {
    const result = {};
    const ignored = ignoredPathSet(workspace);
    function collect(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (excludedWorkspaceDirs.has(entry.name)) continue;
        const path = join(dir, entry.name);
        const rel = relative(workspace, path).replaceAll("\\", "/");
        if (ignored.has(rel)) continue;
        if (rel.startsWith("openspec/changes/archive/")) continue;
        if (rel.startsWith("openspec/changes/") &&
            (excludeChange || !isCurrentChangePath(rel, id))) continue;
        if (entry.isDirectory()) collect(path);
        else if (entry.isFile() || entry.isSymbolicLink())
          result[rel] = filesystemEntryIdentity(path);
      }
    }
    collect(workspace);
    return result;
  }

  return {
    runtimePath,
    changePath,
    receiptPath,
    proofPath,
    proofRunRoot,
    snapshotPath,
    currentChangeRelativePath,
    isCurrentChangePath,
    activeChangePath,
    archivedChangeRelativePath,
    slugify,
    loadRuntime,
    saveRuntime,
    activeChanges,
    orphanRuntimeChanges,
    walk,
    filesystemEntryIdentity,
    directoryHash,
    stableHash,
    serializedJson,
    compactList,
    compactStrings,
    expandList,
    listCount,
    fileDigest,
    singleRelevantSnapshot,
    relevantSnapshot,
    relevantHash,
    clearSnapshotCache,
    workspaceManifest,
    preexistingDirty,
    git,
    gitHead
  };
}
