import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { gitRepositoryAbsent, resolveGitHead } from "../runtime/core/git-head.mjs";
import { createStateRuntime } from "../runtime/core/state-runtime.mjs";
import {
  openSpecLintInputDigest, probeOpenSpecVersion, recordStrictLintPass, strictLintPassed
} from "../runtime/core/tool-identity.mjs";

// The harness asks "what is HEAD here?" and "is this file unchanged?" thousands
// of times per lifecycle command. These primitives answer without a process or
// a re-read; each test pins the answer to what git or a fresh read reports.

function temp(t, prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    .trim();
}

function realHead(cwd) {
  try { return git(cwd, "rev-parse", "HEAD"); } catch { return null; }
}

function repository(t) {
  const root = temp(t, "foundation-git-head-");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "fixture@example.test");
  git(root, "config", "user.name", "Fixture");
  return root;
}

function commit(root, name) {
  writeFileSync(join(root, name), `${name}\n`);
  git(root, "add", "-A");
  git(root, "commit", "-qm", name);
}

test("HEAD resolves from repository files exactly as git reports it", (t) => {
  const root = repository(t);
  assert.equal(resolveGitHead(root), null, "an unborn branch has no HEAD");
  assert.equal(realHead(root), null);
  commit(root, "a.txt");
  assert.equal(resolveGitHead(root), realHead(root));
  mkdirSync(join(root, "deep/er"), { recursive: true });
  assert.equal(resolveGitHead(join(root, "deep/er")), realHead(root), "found from a subdirectory");
  commit(root, "b.txt");
  git(root, "pack-refs", "--all", "--prune");
  assert.equal(resolveGitHead(root), realHead(root), "packed refs");
  commit(root, "c.txt");
  assert.equal(resolveGitHead(root), realHead(root), "a loose ref overrides the packed one");
  git(root, "checkout", "-q", "--detach", "HEAD~1");
  assert.equal(resolveGitHead(root), realHead(root), "detached HEAD");
  git(root, "checkout", "-q", "main");
  git(root, "symbolic-ref", "refs/heads/alias", "refs/heads/main");
  git(root, "checkout", "-q", "alias");
  assert.equal(resolveGitHead(root), realHead(root), "symbolic ref chain");
});

test("linked worktrees resolve through their own HEAD and the shared refs", (t) => {
  const root = repository(t);
  commit(root, "a.txt");
  const linked = join(temp(t, "foundation-git-head-linked-"), "wt");
  git(root, "worktree", "add", "-q", "-b", "feature", linked);
  commit(linked, "feature.txt");
  assert.equal(resolveGitHead(linked), realHead(linked));
  assert.notEqual(resolveGitHead(linked), resolveGitHead(root));
  assert.equal(resolveGitHead(root), realHead(root));
  git(root, "pack-refs", "--all");
  assert.equal(resolveGitHead(linked), realHead(linked), "packed shared refs");
  git(linked, "checkout", "-q", "--detach");
  assert.equal(resolveGitHead(linked), realHead(linked));
});

test("a directory outside any repository has no HEAD and no repository", (t) => {
  const root = temp(t, "foundation-git-head-plain-");
  mkdirSync(join(root, "a/b"), { recursive: true });
  assert.equal(resolveGitHead(join(root, "a/b")), null);
  assert.equal(gitRepositoryAbsent(join(root, "a/b")), true);
  assert.equal(gitRepositoryAbsent(join(root, "missing")), false, "a missing directory is git's to judge");
  assert.equal(resolveGitHead(join(root, "missing")), undefined);
});

test("layouts only git can answer are left to git", (t) => {
  const root = repository(t);
  commit(root, "a.txt");
  assert.equal(gitRepositoryAbsent(root), false);
  assert.equal(resolveGitHead(root, { ...process.env, GIT_DIR: join(root, ".git") }), undefined);
  assert.equal(gitRepositoryAbsent(root, { ...process.env, GIT_CEILING_DIRECTORIES: root }), false);
  const bare = temp(t, "foundation-git-head-bare-");
  git(bare, "init", "-q", "--bare");
  assert.equal(resolveGitHead(bare), undefined, "a bare repository is ambiguous to discovery");
  assert.equal(gitRepositoryAbsent(bare), false);
  const reftable = join(root, ".git", "reftable");
  mkdirSync(reftable);
  assert.equal(resolveGitHead(root), undefined, "an alternative ref backend");
  const damaged = repository(t);
  commit(damaged, "a.txt");
  writeFileSync(join(damaged, ".git", "HEAD"), "ref: refs/heads/../../escape\n");
  assert.equal(resolveGitHead(damaged), undefined, "a suspicious ref name");
  writeFileSync(join(damaged, ".git", "HEAD"), "garbage\n");
  assert.equal(resolveGitHead(damaged), undefined, "an unreadable HEAD");
});

function stateFixture(t) {
  const root = temp(t, "foundation-state-cache-");
  const stateRoot = join(root, ".state");
  const dirs = ["runtime", "receipts", "evidence", "snapshots"].map((name) => join(stateRoot, name));
  const changes = join(root, "openspec", "changes");
  for (const path of [...dirs, changes]) mkdirSync(path, { recursive: true });
  const [runtime, receipts, evidenceVault, snapshots] = dirs;
  const state = createStateRuntime({
    root, runtime, changes, receipts, evidenceVault, snapshots,
    excludedWorkspaceDirs: new Set([".git", ".state"]),
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    writeJson: (path, value) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(value)}\n`);
    },
    canonicalPath: (path) => path,
    now: () => "2026-10-07T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });
  return { root, runtime, state };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

test("loadRuntime reuses a settled parse, hands out private copies, and sees every rewrite", async (t) => {
  const { state } = stateFixture(t);
  const id = "change-a";
  const path = state.runtimePath(id);
  writeFileSync(path, JSON.stringify({ id, status: "building", nested: { list: [1] } }));
  await sleep(80); // past the state file's settle window, so the parse is kept
  const first = state.loadRuntime(id);
  first.nested.list.push(2);
  first.status = "mutated";
  assert.deepEqual(state.loadRuntime(id), { id, status: "building", nested: { list: [1] } },
    "a caller's mutation never reaches the next reader");
  assert.deepEqual(state.loadRuntime(id), state.loadRuntime(id));
  // Same size, rewritten in place: the identity changes, so it is re-read.
  writeFileSync(path, JSON.stringify({ id, status: "proving!", nested: { list: [1] } }));
  assert.equal(state.loadRuntime(id).status, "proving!");
  await sleep(80);
  assert.equal(state.loadRuntime(id).status, "proving!");
  state.saveRuntime({ ...state.loadRuntime(id), status: "proven" });
  assert.equal(state.loadRuntime(id).status, "proven", "saveRuntime is visible immediately");
  rmSync(`${path}.prev`, { force: true });
  writeFileSync(path, "{ not json");
  assert.throws(() => state.loadRuntime(id), /invalid JSON/, "an unreadable state is never served from cache");
});

test("fileDigest tracks content, including same-size in-place edits", async (t) => {
  const { root, state } = stateFixture(t);
  const path = join(root, "file.txt");
  writeFileSync(path, "alpha\n");
  await sleep(2100); // past the settle window: the digest is kept
  const first = state.fileDigest(path);
  assert.equal(state.fileDigest(path), first);
  writeFileSync(path, "bravo\n");
  const second = state.fileDigest(path);
  assert.notEqual(second, first, "a same-size edit after a kept digest is seen");
  writeFileSync(path, "charlie\n");
  assert.notEqual(state.fileDigest(path), second, "an edit inside the settle window is seen");
  chmodSync(path, 0o755);
  assert.equal(state.fileDigest(path), state.fileDigest(path));
});

function fakeOpenSpec(t, version = "9.9.9") {
  const bin = temp(t, "foundation-fake-openspec-");
  const executable = join(bin, "openspec");
  writeFileSync(executable, `#!/bin/sh\necho ${version}\n`);
  chmodSync(executable, 0o755);
  return { bin, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}

test("an OpenSpec probe and lint pass persist across processes by content", (t) => {
  const project = temp(t, "foundation-probe-cache-");
  mkdirSync(join(project, ".foundation/sandboxes/change-a"), { recursive: true });
  const { bin, env } = fakeOpenSpec(t);
  // The probe runs the executable the process PATH resolves to.
  const previousPath = process.env.PATH;
  process.env.PATH = env.PATH;
  t.after(() => { process.env.PATH = previousPath; });
  const spawned = [];
  const counting = (...args) => { spawned.push(args); return { status: 0, stdout: "9.9.9\n", stderr: "" }; };
  // A stub spawner is never memoized: injected behavior is not the real tool.
  probeOpenSpecVersion({ cwd: project, env, spawn: counting });
  probeOpenSpecVersion({ cwd: project, env, spawn: counting });
  assert.equal(spawned.length, 2);

  const first = probeOpenSpecVersion({ cwd: project, env });
  assert.equal(first.status, 0);
  assert.ok(first.identity);
  const cacheFile = join(project, ".foundation/cache/tool-probes.json");
  assert.match(readFileSync(cacheFile, "utf8"), /version:/);
  // A new executable byte changes the identity, so the stored probe no longer applies.
  writeFileSync(join(bin, "openspec"), "#!/bin/sh\necho 10.0.0\n");
  const changed = probeOpenSpecVersion({ cwd: project, env });
  assert.notEqual(changed.identity, first.identity);
  assert.equal(changed.stdout.trim(), "10.0.0");

  const key = "lint-key";
  assert.equal(strictLintPassed(key, project), false);
  recordStrictLintPass(key, project);
  assert.equal(strictLintPassed(key, project), true);
  assert.equal(strictLintPassed(key, join(project, ".foundation/sandboxes/change-a")), true,
    "a sandbox shares its target's cache");
  assert.equal(strictLintPassed("other-key", project), false);
  assert.equal(strictLintPassed(null, project), false);
});

test("the lint digest ignores ticked task boxes and the checkout location, not content", (t) => {
  const make = () => {
    const project = temp(t, "foundation-lint-digest-");
    mkdirSync(join(project, "openspec/changes/c/specs/s"), { recursive: true });
    writeFileSync(join(project, "openspec/changes/c/proposal.md"), "## Why\nx\n");
    writeFileSync(join(project, "openspec/changes/c/specs/s/spec.md"), "## ADDED Requirements\n");
    writeFileSync(join(project, "openspec/changes/c/tasks.md"), "- [ ] 1.1 do it\n- [ ] 1.2 more\n");
    return project;
  };
  const a = make();
  const b = make();
  const base = openSpecLintInputDigest(a, "c");
  assert.equal(openSpecLintInputDigest(b, "c"), base, "identical bytes elsewhere lint the same");
  writeFileSync(join(a, "openspec/changes/c/tasks.md"), "- [x] 1.1 do it\n- [X] 1.2 more\n");
  assert.equal(openSpecLintInputDigest(a, "c"), base, "ticking boxes is progress");
  writeFileSync(join(a, "openspec/changes/c/tasks.md"), "- [x] 1.1 do something else\n- [ ] 1.2 more\n");
  assert.notEqual(openSpecLintInputDigest(a, "c"), base, "task text is still an input");
  writeFileSync(join(b, "openspec/changes/c/specs/s/spec.md"), "## ADDED Requirements\nchanged\n");
  assert.notEqual(openSpecLintInputDigest(b, "c"), base, "spec bytes are still an input");
});
