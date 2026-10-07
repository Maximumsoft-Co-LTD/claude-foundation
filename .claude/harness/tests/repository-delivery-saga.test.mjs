import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  copyBaselineState, createRepositoryDeliverySaga, repositoryDeliveryOrder, targetOverwrites
} from "../runtime/workflow/repository-delivery-saga.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const stableHash = (value) => digest(JSON.stringify(value));
const git = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8" });

function createRepository(base, id) {
  const target = join(base, id);
  const sandbox = join(base, `${id}-sandbox`);
  mkdirSync(target, { recursive: true });
  git(["init", "-q"], target);
  git(["config", "user.email", "test@example.test"], target);
  git(["config", "user.name", "Test"], target);
  writeFileSync(join(target, "app.txt"), `${id}:base\n`);
  git(["add", "app.txt"], target);
  git(["commit", "-q", "-m", "base"], target);
  const head = git(["rev-parse", "HEAD"], target).stdout.trim();
  git(["worktree", "add", "--detach", sandbox, head], target);
  writeFileSync(join(sandbox, "app.txt"), `${id}:delivered\n`);
  writeFileSync(join(sandbox, "new.txt"), `${id}:new\n`);
  return { id, target, sandbox, head };
}

function fileDigest(path) {
  const stat = lstatSync(path);
  return stat.isSymbolicLink()
    ? digest(readlinkSync(path)) : digest(readFileSync(path));
}

function directoryHash(path) {
  return stableHash(path);
}

function fixture(repositoryCount = 1, options = {}) {
  const base = mkdtempSync(join(tmpdir(), "repository-delivery-"));
  const repositories = Array.from({ length: repositoryCount }, (_, index) =>
    createRepository(base, `repo-${index + 1}`));
  const state = {
    id: "change-a", status: "proven", repositories: Object.fromEntries(
      repositories.map((repository) => [repository.id, {
        mode: "worktree", access: "write", path: repository.sandbox,
        targetPath: repository.target, baseHead: repository.head
      }]))
  };
  const selected = repositories.map((repository, index) => ({
    id: repository.id,
    type: "git",
    mode: "write",
    path: repository.target,
    dependsOn: index === 0 ? [] : [repositories[index - 1].id]
  }));
  let runtimeState = structuredClone(state);
  const proofPath = join(base, "proof.json");
  writeFileSync(proofPath, JSON.stringify({ proofRunId: "proof-a" }));
  const readJson = (path, fallback) => {
    try { return JSON.parse(readFileSync(path, "utf8")); }
    catch { return fallback; }
  };
  const writeJson = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  };
  const saga = createRepositoryDeliverySaga({
    root: base,
    transactions: join(base, "transactions"),
    loadRuntime: () => structuredClone(runtimeState),
    saveRuntime: (value) => { runtimeState = structuredClone(value); },
    selectedRepositories: () => selected,
    git,
    gitHead: (path) => git(["rev-parse", "HEAD"], path).stdout.trim(),
    fileDigest,
    directoryHash,
    pathInside: (root, path) => {
      const rel = relative(root, path);
      return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." &&
        !isAbsolute(rel));
    },
    readJson,
    writeJson,
    stableHash,
    proofPath: () => proofPath,
    now: () => "2026-09-05T00:00:00.000Z",
    prepareRoot: () => assert.fail("root is not selected"),
    executeRoot: () => assert.fail("root is not selected"),
    verifyRoot: () => ({ valid: true }),
    cleanupRoot: () => {},
    fail: (message) => { throw new Error(message); },
    checkpoint: options.checkpoint
  });
  return {
    base, repositories, selected, saga,
    state: () => structuredClone(runtimeState),
    cleanup: () => {
      for (const repository of repositories)
        git(["worktree", "remove", "--force", repository.sandbox], repository.target);
      rmSync(base, { recursive: true, force: true });
    }
  };
}

// An isolated copy's base is its baseline manifest: identity binds content and
// the executable bit, and a path the baseline does not record fails closed.
test("copy-baseline overwrite guard keeps target edits and lets baseline paths land", () => {
  const target = {
    "at-base.txt": ["aaa", 0o644], "edited.txt": ["user", 0o644],
    "chmod.txt": ["ccc", 0o755], "untracked.txt": ["user", 0o644], "own.txt": ["v1", 0o644]
  };
  const files = {
    safeRootPath: (path) => path,
    pathIdentity: (path) => target[path]?.[0] ?? null,
    pathMode: (path) => target[path]?.[1] ?? null
  };
  const baseline = { "at-base.txt": "file:regular:aaa", "edited.txt": "file:regular:eee",
    "chmod.txt": "file:regular:ccc", "own.txt": "file:regular:v0" };
  const entries = Object.keys(target).map((path) =>
    ({ path, role: "code", before: target[path][0], beforeMode: 0o644, after: "new",
      afterMode: 0o644 }));
  const prior = new Map([["own.txt", { path: "own.txt", after: "v1", afterMode: 0o644 }]]);
  const git = () => { throw new Error("a copy baseline never asks Git"); };
  assert.deepEqual(targetOverwrites({ git, files, baseState: copyBaselineState(files, baseline) },
    "/target", null, entries, prior), [
    { path: "edited.txt", untracked: false },
    { path: "chmod.txt", untracked: false },
    { path: "untracked.txt", untracked: true }
  ]);
  assert.deepEqual(targetOverwrites({ git, files, baseState: copyBaselineState(files, undefined) },
    "/target", null, entries.slice(0, 1)), [{ path: "at-base.txt", untracked: true }],
  "no recorded baseline fails closed");
});

test("repository delivery order honors dependencies", () => {
  assert.deepEqual(repositoryDeliveryOrder([
    { id: "consumer", dependsOn: ["producer"] },
    { id: "producer", dependsOn: [] }
  ]).map((row) => row.id), ["producer", "consumer"]);
});

test("one selected non-root repository lands as an uncommitted workspace diff", () => {
  const value = fixture();
  try {
    const repository = value.repositories[0];
    const head = repository.head;
    const indexBefore = git(["diff", "--cached", "--binary"], repository.target).stdout;
    const result = value.saga.apply("change-a");
    assert.equal(result.status, "PASS");
    assert.equal(readFileSync(join(repository.target, "app.txt"), "utf8"),
      `${repository.id}:delivered\n`);
    assert.equal(readFileSync(join(repository.target, "new.txt"), "utf8"),
      `${repository.id}:new\n`);
    assert.equal(git(["rev-parse", "HEAD"], repository.target).stdout.trim(), head);
    assert.equal(git(["diff", "--cached", "--binary"], repository.target).stdout,
      indexBefore);
    assert.match(git(["status", "--short"], repository.target).stdout, /app\.txt/);
    assert.equal(value.state().repositories[repository.id].delivery.status,
      "applied-uncommitted");
    assert.equal(value.saga.apply("change-a").status, "PASS",
      "a completed repository node is verified and not applied twice");
  } finally { value.cleanup(); }
});

test("overlapping target work is preserved as a typed conflict", () => {
  const value = fixture();
  try {
    const repository = value.repositories[0];
    writeFileSync(join(repository.target, "app.txt"), "user edit\n");
    assert.throws(() => value.saga.apply("change-a"),
      /overwrite an uncommitted target edit/);
    assert.equal(readFileSync(join(repository.target, "app.txt"), "utf8"),
      "user edit\n");
  } finally { value.cleanup(); }
});

// `land check` runs the saga's pre-mutation half: it refuses what apply would
// refuse, with the same typed error, and journals, backs up, or writes nothing.
test("delivery preflight raises apply's refusals without writing anything", () => {
  const value = fixture(2);
  try {
    const [first, second] = value.repositories;
    assert.doesNotThrow(() => value.saga.preflight("change-a"));
    writeFileSync(join(second.target, "app.txt"), "user edit\n");
    assert.throws(() => value.saga.preflight("change-a"), (error) =>
      error.code === "REPOSITORY_DELIVERY_FAILED" &&
      /overwrite an uncommitted target edit in 'repo-2'/.test(error.message));
    assert.throws(() => value.saga.apply("change-a"), (error) =>
      error.code === "REPOSITORY_DELIVERY_FAILED" &&
      /overwrite an uncommitted target edit in 'repo-2'/.test(error.message));
    writeFileSync(join(second.target, "app.txt"), `${second.id}:base\n`);
    writeFileSync(join(first.target, "moved.txt"), "moved\n");
    git(["add", "moved.txt"], first.target);
    git(["commit", "-q", "-m", "moved"], first.target);
    const transactions = join(value.base, "transactions");
    const before = spawnSync("find", [transactions], { encoding: "utf8" }).stdout;
    assert.throws(() => value.saga.preflight("change-a"),
      /repository 'repo-1' target HEAD moved after proof/);
    assert.equal(spawnSync("find", [transactions], { encoding: "utf8" }).stdout, before);
    assert.equal(readFileSync(join(second.target, "app.txt"), "utf8"), `${second.id}:base\n`);
    assert.equal(value.state().repositories[second.id].delivery, undefined);
  } finally { value.cleanup(); }
});

test("read-only dependencies have no mutation node", () => {
  const value = fixture(2);
  try {
    value.selected[1].mode = "read";
    const readRepository = value.repositories[1];
    const indexBefore = git(["diff", "--cached", "--binary"],
      readRepository.target).stdout;
    const result = value.saga.apply("change-a");
    assert.deepEqual(result.repositories.map((row) => row.id), ["repo-1"]);
    assert.equal(readFileSync(join(readRepository.target, "app.txt"), "utf8"),
      "repo-2:base\n");
    assert.equal(git(["rev-parse", "HEAD"], readRepository.target).stdout.trim(),
      readRepository.head);
    assert.equal(git(["diff", "--cached", "--binary"],
      readRepository.target).stdout, indexBefore);
  } finally { value.cleanup(); }
});

test("writable submodule targets receive bytes without a child commit", () => {
  const value = fixture();
  try {
    value.selected[0].type = "submodule";
    const repository = value.repositories[0];
    value.saga.apply("change-a");
    assert.equal(readFileSync(join(repository.target, "app.txt"), "utf8"),
      `${repository.id}:delivered\n`);
    assert.equal(git(["rev-parse", "HEAD"], repository.target).stdout.trim(),
      repository.head);
    assert.equal(git(["diff", "--cached", "--quiet"], repository.target).status, 0);
  } finally { value.cleanup(); }
});

test("a crash between repositories resumes without reapplying the completed node", () => {
  let checkpoints = 0;
  const value = fixture(2, {
    checkpoint: () => {
      checkpoints += 1;
      if (checkpoints === 1) throw new Error("simulated process stop");
    }
  });
  try {
    assert.throws(() => value.saga.apply("change-a"), /simulated process stop/);
    const first = value.repositories[0];
    const second = value.repositories[1];
    assert.equal(readFileSync(join(first.target, "app.txt"), "utf8"),
      `${first.id}:delivered\n`);
    assert.equal(readFileSync(join(second.target, "app.txt"), "utf8"),
      `${second.id}:base\n`);
    assert.equal(value.saga.apply("change-a").status, "PASS");
    assert.equal(readFileSync(join(second.target, "app.txt"), "utf8"),
      `${second.id}:delivered\n`);
    assert.equal(value.state().repositories[first.id].delivery.status,
      "applied-uncommitted");
  } finally { value.cleanup(); }
});

test("work committed in a repository sandbox after a first delivery is delivered on resume", () => {
  const value = fixture();
  try {
    const repository = value.repositories[0];
    value.saga.apply("change-a");
    // The sandbox keeps growing after the first Land attempt stopped later on:
    // a commit and a further edit. The earlier delivery record must not count
    // as delivering this newer, proven work.
    writeFileSync(join(repository.sandbox, "later.txt"), "committed later\n");
    git(["add", "later.txt"], repository.sandbox);
    git(["-c", "user.email=test@example.test", "-c", "user.name=Test",
      "commit", "-q", "-m", "later"], repository.sandbox);
    writeFileSync(join(repository.sandbox, "app.txt"), `${repository.id}:revised\n`);
    assert.equal(value.saga.apply("change-a").status, "PASS");
    assert.equal(readFileSync(join(repository.target, "later.txt"), "utf8"),
      "committed later\n");
    assert.equal(readFileSync(join(repository.target, "app.txt"), "utf8"),
      `${repository.id}:revised\n`);
    assert.equal(git(["rev-parse", "HEAD"], repository.target).stdout.trim(), repository.head);
    assert.deepEqual(value.state().repositories[repository.id].delivery.touchedPaths,
      ["app.txt", "later.txt", "new.txt"]);
  } finally { value.cleanup(); }
});

test("a path an earlier delivery wrote that the sandbox dropped stops instead of guessing", () => {
  const value = fixture();
  try {
    const repository = value.repositories[0];
    value.saga.apply("change-a");
    rmSync(join(repository.sandbox, "new.txt"));
    assert.throws(() => value.saga.apply("change-a"),
      /no longer changes path\(s\) an earlier Land attempt wrote into its target \(new\.txt\)/);
    assert.equal(readFileSync(join(repository.target, "new.txt"), "utf8"),
      `${repository.id}:new\n`);
  } finally { value.cleanup(); }
});
