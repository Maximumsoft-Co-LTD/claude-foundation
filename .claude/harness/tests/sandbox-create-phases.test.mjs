import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  createSandbox,
  isolateSelectedRepositories,
  reportMultiRepositorySandbox,
  sandboxCreatePreflight,
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
