import assert from "node:assert/strict";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  carryableGitMetadata,
  copiedPreexistingDigests,
  copySandboxEntries,
  copyTrackedRootMetadata,
  createSandbox,
  createSandboxRuntime,
  ignoredSandboxPaths,
  inspectSandbox,
  isolateSelectedRepositories,
  reportMultiRepositorySandbox,
  sandboxCopyPlan,
  sandboxCopyWorkspace,
  sandboxCreatePreflight,
  showSandboxInspection,
  setupSelectedRepositories
} from "../runtime/workflow/sandbox-runtime.mjs";

const fail = (message) => { throw new Error(message); };

function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "sandbox-create-phases-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const child = join(root, "child-source");
  mkdirSync(child);
  const state = {
    status: "change",
    workspace: {
      mode: "worktree", path: join(root, "root-worktree"), baseHead: "root-base",
      preexisting: { keep: "digest" }
    }
  };
  const calls = {
    cleanupApplied: 0, cleanupRepositories: 0, cleared: 0,
    created: 0, git: [], saved: [], setup: []
  };
  let repositories = [
    { id: "root", mode: "write", path: root },
    { id: "child", mode: "read", path: child, setupCommand: "npm ci" }
  ];
  const context = {
    root,
    policy: () => ({ sandbox: { setupTimeoutMs: 321 } }),
    hostAttestation: { preflight: () => ({ safeForUnattended: true, reasons: [] }) },
    loadRuntime: () => state,
    saveRuntime: (value) => calls.saved.push(structuredClone(value)),
    repositoryCatalog: () => ({ drift: [] }),
    git: (args, path) => {
      calls.git.push({ args, path });
      return { status: 0, stdout: "", stderr: "" };
    },
    gitHead: (path) => path === root ? "root-head" : "child-head",
    canonicalPath: (path) => path,
    porcelainStatusRecords: () => [],
    selectedRepositories: (_id, value) => value?.repositories
      ? Object.entries(value.repositories).map(([id, record]) => ({
        id, workspacePath: record.path
      }))
      : repositories,
    cleanupRepositorySandboxes: () => { calls.cleanupRepositories += 1; },
    cleanupAppliedSandbox: () => { calls.cleanupApplied += 1; },
    clearSnapshotCache: () => { calls.cleared += 1; },
    createSingle: () => { calls.created += 1; },
    runSetupCommand: (record, command, timeout, path, id) => {
      calls.setup.push({ command, timeout, path, id });
      record.setup = { status: "ok" };
    },
    fail,
    ...overrides
  };
  return {
    root, child, state, calls, context,
    repositories: () => repositories,
    setRepositories: (value) => { repositories = value; }
  };
}

function captureConsole(method, run) {
  const prior = console[method];
  const rows = [];
  console[method] = (value) => rows.push(String(value));
  try { return { value: run(), rows }; }
  finally { console[method] = prior; }
}

test("sandbox inspection classifies interactive and unattended execution", () => {
  const workspaceIsolation = {
    kind: "git-worktree", status: "active", drift: "target-moved",
    baseHead: "1234567890", targetHead: "abcdef1234", repositories: []
  };
  const preflight = {
    securityBoundary: { kind: "container", status: "verified" },
    attestation: { issuer: "host" }, boundaryDetected: true,
    safeForUnattended: false, reasons: ["owner mismatch", "attestation stale"]
  };
  const context = {
    workspaceInspection: () => workspaceIsolation,
    hostAttestation: { preflight: () => preflight }
  };
  const interactive = inspectSandbox(context, "change");
  assert.equal(interactive.execution.mode, "interactive");
  assert.equal(interactive.execution.decision, "allow");
  assert.equal(interactive.securityBoundary.kind, "container");
  assert.deepEqual(interactive.attestation, { issuer: "host" });
  const unattended = inspectSandbox(context, "change", { unattended: true });
  assert.equal(unattended.execution.mode, "unattended");
  assert.equal(unattended.execution.decision, "block");
  preflight.safeForUnattended = true;
  assert.equal(inspectSandbox(context, "change", { unattended: true }).execution.decision,
    "allow");
});

test("sandbox inspection output covers text, JSON, drift, reasons, and blocking", () => {
  const result = {
    version: 1, changeId: "change",
    workspaceIsolation: {
      kind: "git-worktree", status: "active", drift: "target-moved",
      baseHead: "1234567890", targetHead: "abcdef1234"
    },
    securityBoundary: { kind: "container", status: "unverified" },
    execution: { safeForUnattended: false, reasons: ["owner mismatch"] }
  };
  const rows = [];
  const runtimeProcess = {};
  let blocked = 0;
  const context = {
    inspect: () => result,
    output: { log: (value) => rows.push(String(value)) },
    markBlocked: () => { blocked += 1; },
    runtimeProcess
  };
  showSandboxInspection(context, "change");
  assert.ok(rows.some((row) => row.includes("target drift: base 12345678")));
  assert.ok(rows.some((row) => row.includes("safe for unattended: no")));
  assert.ok(rows.some((row) => row.includes("reason: owner mismatch")));
  assert.equal(blocked, 0);
  showSandboxInspection(context, "change", { json: true });
  assert.ok(rows.some((row) => row.includes('"changeId": "change"')));
  showSandboxInspection(context, "change", { unattended: true });
  assert.equal(blocked, 1);
  assert.equal(runtimeProcess.exitCode, 1);

  result.workspaceIsolation.drift = "none";
  result.execution.safeForUnattended = true;
  result.execution.reasons = [];
  showSandboxInspection(context, "change", { unattended: true });
  assert.equal(blocked, 1);
});

test("sandbox create preflight accepts safe targets and selects repositories", (t) => {
  const f = fixture(t);
  const result = sandboxCreatePreflight(f.context, "change", { unattended: true });
  assert.equal(result.initial, f.state);
  assert.deepEqual(result.repositories, f.repositories());
  assert.equal(f.calls.git[0].path, f.root);
});

test("sandbox create preflight rejects unsafe hosts and topology drift", (t) => {
  const unsafe = fixture(t, {
    hostAttestation: { preflight: () => ({
      safeForUnattended: false, reasons: ["owner unknown", "attestation stale"]
    }) }
  });
  assert.throws(
    () => sandboxCreatePreflight(unsafe.context, "change", { unattended: true }),
    /owner unknown; attestation stale/
  );

  const drift = fixture(t, {
    repositoryCatalog: () => ({ drift: [{ path: "vendor/unregistered" }] })
  });
  assert.throws(
    () => sandboxCreatePreflight(drift.context, "change"),
    /unregistered submodule.*vendor\/unregistered/s
  );
});

test("sandbox create preflight rejects only untracked investigation notes", (t) => {
  const rows = [
    { status: " M", path: "openspec/investigations/tracked.md" },
    { status: "??", path: "notes/other.md" },
    { status: "??", path: "openspec/investigations/race.md" }
  ];
  const f = fixture(t, { porcelainStatusRecords: () => rows });
  assert.throws(
    () => sandboxCreatePreflight(f.context, "change"),
    /untracked investigation note.*race\.md/s
  );

  const failedStatus = fixture(t, {
    git: () => ({ status: 128, stdout: "ignored", stderr: "not a repository" }),
    porcelainStatusRecords: () => { throw new Error("must not parse"); }
  });
  assert.doesNotThrow(() => sandboxCreatePreflight(failedStatus.context, "change"));
});

test("repository isolation records root and child worktrees", (t) => {
  const f = fixture(t);
  f.state.workspace.baseHead = "";
  isolateSelectedRepositories(f.context, "change", f.state, f.repositories());
  assert.deepEqual(f.state.repositories.root, {
    mode: "worktree", path: f.state.workspace.path, targetPath: f.root,
    baseHead: "root-head", access: "write"
  });
  assert.equal(f.state.repositories.child.baseHead, "child-head");
  assert.equal(f.state.repositories.child.access, "read");
  assert.equal(f.calls.git.at(-1).args[1], "add");
});

test("repository isolation rolls back an uninitialized repository", (t) => {
  const f = fixture(t);
  f.context.gitHead = (path) => path === f.child ? null : "root-head";
  assert.throws(
    () => isolateSelectedRepositories(f.context, "change", f.state, f.repositories()),
    /not an initialized Git repository.*rolled back/
  );
  assert.equal(f.calls.cleanupRepositories, 1);
  assert.equal(f.calls.cleanupApplied, 1);
  assert.deepEqual(f.state.workspace.preexisting, { keep: "digest" });
  assert.equal(f.state.workspace.mode, "current");
  assert.equal(f.state.status, "change");
  assert.equal("repositories" in f.state, false);
  assert.equal(f.calls.saved.length, 1);
});

test("repository isolation rolls back existing paths and failed worktree adds", (t) => {
  const existing = fixture(t);
  mkdirSync(join(existing.root, ".foundation", "repository-sandboxes", "change", "child"), {
    recursive: true
  });
  assert.throws(
    () => isolateSelectedRepositories(
      existing.context, "change", existing.state, existing.repositories()),
    /repository sandbox already exists.*rolled back/
  );

  const failed = fixture(t);
  failed.context.git = (args) => args[1] === "add"
    ? { status: 1, stdout: "", stderr: "permission denied" }
    : { status: 0, stdout: "", stderr: "" };
  assert.throws(
    () => isolateSelectedRepositories(failed.context, "other", failed.state, failed.repositories()),
    /cannot create sandbox for 'child': permission denied.*rolled back/
  );
});

test("repository setup skips inapplicable records and runs write setup", (t) => {
  const f = fixture(t);
  f.state.repositories = {
    root: { mode: "current", access: "write", path: f.root },
    write: { mode: "worktree", access: "write", path: f.child }
  };
  setupSelectedRepositories(f.context, f.state, [
    { id: "none" },
    { id: "missing", setupCommand: "skip" },
    { id: "root", setupCommand: "skip" },
    { id: "write", setupCommand: "build" }
  ]);
  assert.deepEqual(f.calls.setup, [{
    command: "build", timeout: 321, path: f.child, id: "write"
  }]);
  assert.equal(f.calls.git.length, 0);
});

test("read-only setup reports dirty output and git failures", (t) => {
  const dirty = fixture(t);
  dirty.state.repositories = {
    child: { mode: "worktree", access: "read", path: dirty.child }
  };
  dirty.context.git = () => ({ status: 0, stdout: " M lockfile\n", stderr: "" });
  const first = captureConsole("error", () => setupSelectedRepositories(
    dirty.context, dirty.state, [{ id: "child", setupCommand: "install" }]
  ));
  assert.match(first.rows[0], /M lockfile/);
  assert.deepEqual(dirty.state.repositories.child.setup, {
    status: "failed", reason: "setup modified a read-only repository"
  });

  const failed = fixture(t);
  failed.state.repositories = {
    child: { mode: "worktree", access: "read", path: failed.child }
  };
  failed.context.git = () => ({ status: 1, stdout: "", stderr: "" });
  const second = captureConsole("error", () => setupSelectedRepositories(
    failed.context, failed.state, [{ id: "child", setupCommand: "install" }]
  ));
  assert.match(second.rows[0], /git status failed/);
});

test("multi-repository report resolves workspace paths at call time", (t) => {
  const f = fixture(t);
  f.state.repositories = {
    root: { path: "/sandbox/root" }, child: { path: "/sandbox/child" }
  };
  const output = captureConsole("log", () =>
    reportMultiRepositorySandbox(f.context, "change", f.state));
  assert.deepEqual(output.rows, [
    "MULTI-REPOSITORY SANDBOX change",
    "  root: /sandbox/root",
    "  child: /sandbox/child"
  ]);
});

test("create sandbox keeps the root-only fast path", (t) => {
  const f = fixture(t);
  f.setRepositories([{ id: "root", mode: "write", path: f.root }]);
  createSandbox(f.context, "change");
  assert.equal(f.calls.created, 1);
  assert.equal(f.calls.saved.length, 0);
  assert.equal(f.calls.cleared, 0);
});

test("create sandbox completes the multi-repository lifecycle", (t) => {
  const f = fixture(t);
  const output = captureConsole("log", () => createSandbox(f.context, "change"));
  assert.equal(f.calls.created, 1);
  assert.equal(f.calls.setup.length, 1);
  assert.equal(f.calls.saved.at(-1).status, "building");
  assert.equal(f.calls.cleared, 1);
  assert.match(output.rows[0], /MULTI-REPOSITORY SANDBOX change/);

  const all = fixture(t);
  all.setRepositories([{ id: "root", mode: "write", path: all.root }]);
  captureConsole("log", () => createSandbox(all.context, "change", { all: true }));
  assert.equal(all.calls.saved.at(-1).status, "building");
});

test("copy planning recognizes carryable Git metadata and ignored paths", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sandbox-copy-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(carryableGitMetadata(root), false);
  writeFileSync(join(root, ".git"), "gitdir: elsewhere\n");
  assert.equal(carryableGitMetadata(root), false);
  rmSync(join(root, ".git"));
  mkdirSync(join(root, ".git"));
  assert.equal(carryableGitMetadata(root), true);

  let calls = 0;
  assert.deepEqual([...ignoredSandboxPaths(false, root, () => { calls += 1; })], []);
  assert.equal(calls, 0);
  const ignored = ignoredSandboxPaths(true, root, () => ({
    status: 0, stdout: "coverage/\0dist/file.js\0\0"
  }));
  assert.deepEqual([...ignored], ["coverage", "dist/file.js"]);
  assert.deepEqual([...ignoredSandboxPaths(true, root, () => ({ status: 1 }))], []);

  const git = (args) => args.includes("--others")
    ? { status: 0, stdout: "ignored/\0" }
    : { status: 0, stdout: "node_modules/fixture.txt\0src/app.mjs\0" };
  const plan = sandboxCopyPlan({
    root, carriesGit: true, git,
    sandboxCopyExcludedDirs: new Set(["node_modules"]),
    excludedWorkspaceDirs: new Set([".git", "node_modules"])
  });
  assert.equal(plan.excludes("ignored"), true);
  assert.equal(plan.excludes("node_modules"), false);
  assert.equal(plan.excludes("node_modules/fixture.txt"), false);
  assert.equal(plan.excludes("node_modules/untracked.txt"), true);
  assert.equal(plan.excludes("src/app.mjs"), false);

  const noGit = sandboxCopyPlan({
    root, carriesGit: false, git: () => { throw new Error("not called"); },
    sandboxCopyExcludedDirs: new Set(),
    excludedWorkspaceDirs: new Set([".git", "node_modules"])
  });
  assert.deepEqual(noGit.listedPaths, []);
  assert.equal(noGit.excludes(".git/config"), true);
});

test("sandbox tree copy preserves links and removes partial output on failure", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sandbox-copy-tree-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "source.txt"), "content\n");
  symlinkSync("source.txt", join(root, "source-link"));
  mkdirSync(join(root, "skip"));
  writeFileSync(join(root, "skip", "ignored.txt"), "ignored\n");
  const destination = join(root, ".foundation", "sandboxes", "ok");
  mkdirSync(destination, { recursive: true });
  copySandboxEntries({
    root, requestedPath: destination,
    plan: {
      excludes: (rel) => rel === ".foundation" || rel === "skip",
      filter: () => true
    }, fail
  });
  assert.equal(readFileSync(join(destination, "source.txt"), "utf8"), "content\n");
  assert.equal(readFileSync(join(destination, "source-link"), "utf8"), "content\n");
  assert.equal(existsSync(join(destination, "skip")), false);

  const failed = join(root, ".foundation", "sandboxes", "failed");
  mkdirSync(failed, { recursive: true });
  assert.throws(() => copySandboxEntries({
    root, requestedPath: failed,
    plan: {
      excludes: (rel) => rel === ".foundation" || rel === "skip",
      filter: () => { throw new Error("disk full"); }
    }, fail
  }), /disk full; partial copy removed/);
  assert.equal(existsSync(failed), false);
});

test("tracked root metadata and preexisting digests carry only existing allowed files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sandbox-copy-metadata-"));
  const destination = join(root, "destination");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".foundation"));
  writeFileSync(join(root, ".foundation", "shipped.txt"), "ship\n");
  writeFileSync(join(root, "ordinary.txt"), "ordinary\n");
  copyTrackedRootMetadata(root, destination, [
    ".foundation/shipped.txt", ".workflow/missing.txt", "ordinary.txt"
  ]);
  assert.equal(readFileSync(join(destination, ".foundation", "shipped.txt"), "utf8"),
    "ship\n");
  assert.equal(existsSync(join(destination, "ordinary.txt")), false);

  writeFileSync(join(destination, "good.txt"), "good\n");
  writeFileSync(join(destination, "bad.txt"), "bad\n");
  const digests = copiedPreexistingDigests(destination, {
    "good.txt": "old", "bad.txt": "old", "missing.txt": "old"
  }, (path) => {
    if (path.endsWith("bad.txt")) throw new Error("unreadable");
    return `digest:${readFileSync(path, "utf8").trim()}`;
  });
  assert.deepEqual(digests, { "good.txt": "digest:good" });
  assert.deepEqual(copiedPreexistingDigests(destination, null, () => "digest"), {});
});

test("copy workspace state binds source and sandbox snapshots for Git and no-Git modes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "sandbox-copy-state-"));
  const path = join(root, "copy");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path);
  writeFileSync(join(path, "pre.txt"), "pre\n");
  const calls = [];
  const input = {
    id: "change", root, path, reason: "dirty", carriesGit: true,
    preexisting: { "pre.txt": "prior" }, gitHead: () => "head",
    workspaceManifest: (workspacePath, id, includeDirty) => {
      calls.push([workspacePath, id, includeDirty]);
      return { workspacePath };
    },
    fileDigest: () => "copied-digest", directoryHash: () => "change-hash",
    changePath: () => join(root, "openspec", "changes", "change"),
    packetManifest: (packet) => ({ packet })
  };
  const carried = sandboxCopyWorkspace(input);
  assert.equal(carried.baseHead, "head");
  assert.equal(carried.git, "carried");
  assert.deepEqual(carried.sandboxPreexisting, { "pre.txt": "copied-digest" });
  assert.equal(carried.changeSourceHash, "change-hash");
  assert.equal(calls.length, 2);
  const absent = sandboxCopyWorkspace({ ...input, carriesGit: false, preexisting: {} });
  assert.equal(absent.baseHead, null);
  assert.equal(absent.git, "absent");
});

function copyRuntimeFixture(t, { carriesGit = false, setup = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sandbox-copy-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packet = join(root, "openspec", "changes", "change");
  mkdirSync(packet, { recursive: true });
  writeFileSync(join(packet, "tasks.md"), "- [ ] task\n");
  writeFileSync(join(root, "source.txt"), "source\n");
  if (carriesGit) {
    mkdirSync(join(root, ".git", "worktrees", "outside"), { recursive: true });
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  }
  const state = { status: "change", workspace: {
    mode: "current", path: root, preexisting: { "source.txt": "old" }
  } };
  const saved = [];
  const git = (args) => {
    if (args[0] === "status") return { status: 0, stdout: "?? outside.txt\0", stderr: "" };
    if (args.includes("--others")) return { status: 0, stdout: "ignored/\0" };
    if (args[0] === "ls-files")
      return { status: 0, stdout: ".git/HEAD\0openspec/changes/change/tasks.md\0source.txt\0" };
    return { status: 0, stdout: "", stderr: "" };
  };
  const runtime = createSandboxRuntime({
    root,
    policy: () => ({ sandbox: setup ? { setupCommand: "true", setupTimeoutMs: 1000 } : {} }),
    excludedWorkspaceDirs: new Set([".git", "node_modules", "ignored"]),
    sandboxCopyExcludedDirs: new Set(["node_modules", "ignored"]),
    hostAttestation: { createChallenge: () => ({}) },
    loadRuntime: () => state, saveRuntime: (value) => saved.push(structuredClone(value)),
    canonicalPath: (value) => value,
    workspaceManifest: (value) => ({ root: value }),
    directoryHash: () => "change-hash",
    fileDigest: (value) => `digest:${readFileSync(value, "utf8").length}`,
    changePath: () => packet,
    gitHead: () => carriesGit ? "head" : null,
    git, gitBuffer: () => ({ status: 0 }),
    porcelainStatusRecords: () => [{ status: "??", path: "outside.txt" }],
    selectedRepositories: () => [], cleanupRepositorySandboxes: () => {},
    cleanupAppliedSandbox: () => {}, repositoryCatalog: () => ({ drift: [] }),
    clearSnapshotCache: () => {}, validate: () => {},
    repositorySelectionIdsAt: () => [], contractFingerprint: () => "contract",
    executionFingerprint: () => "execution", taskBlocks: () => [],
    proofPath: () => join(root, "proof.json"), relevantHash: () => "hash",
    now: () => "now", fail
  });
  return { root, state, saved, runtime };
}

test("createSingle records isolated copies with and without carried Git metadata", (t) => {
  const noGit = copyRuntimeFixture(t);
  const first = captureConsole("log", () => noGit.runtime.createSingle("change"));
  assert.equal(noGit.state.workspace.mode, "copy");
  assert.equal(noGit.state.workspace.git, "absent");
  assert.equal(noGit.state.status, "building");
  assert.match(first.rows[0], /git: absent/);
  assert.equal(noGit.saved.length, 1);
  assert.throws(() => noGit.runtime.createSingle("change"), /sandbox already exists/);

  const carried = copyRuntimeFixture(t, { carriesGit: true, setup: true });
  const second = captureConsole("log", () => carried.runtime.createSingle("change"));
  assert.equal(carried.state.workspace.git, "carried");
  assert.equal(carried.state.workspace.baseHead, "head");
  assert.equal(existsSync(join(carried.state.workspace.path, ".git", "worktrees")), false);
  assert.equal(carried.saved.length, 2);
  assert.match(second.rows[0], /setup: ok/);
});
