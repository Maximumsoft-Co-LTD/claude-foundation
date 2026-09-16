import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStateRuntime } from "../runtime/core/state-runtime.mjs";
import {
  assertReadOnlyReplayClean,
  commitSandboxReplay,
  createSandboxRuntime,
  manuallyRebasedMovement,
  prepareWorktreeReplay,
  preserveReplayPacket,
  recoverAmendedReplay,
  rejectedPaths,
  replayContext,
  replayStagingCleanup,
  stageReplayWorkspace
} from "../runtime/workflow/sandbox-runtime.mjs";

const fail = (message) => { throw new Error(message); };
const ok = { status: 0, stdout: "", stderr: "" };

test("recovered amendment replay uses B, not A, when the target advances again to C", () => {
  for (const recoveryPoint of ["staged", "moved", "newer-agent-commit"]) {
    const root = mkdtempSync(join(tmpdir(), "amended-replay-base-"));
    const target = join(root, "target");
    const sandbox = join(root, "sandbox");
    const staging = `${sandbox}.rebase`;
    const packet = "openspec/changes/amended";
    const { directoryHash } = createStateRuntime({});
    const git = (args, cwd = target) => spawnSync("git", args, { cwd, encoding: "utf8" });
    const checked = (args, cwd = target) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    const gitHead = (path) => checked(["rev-parse", "HEAD"], path);
    try {
      mkdirSync(target);
      checked(["init", "-q"]);
      checked(["config", "user.name", "Replay Test"]);
      checked(["config", "user.email", "replay@example.invalid"]);
      writeFileSync(join(target, "app.txt"), "original\n");
      writeFileSync(join(target, "upstream.txt"), "A\n");
      checked(["add", "."]); checked(["commit", "-qm", "A"]);
      const baseA = gitHead(target);
      writeFileSync(join(target, "upstream.txt"), "B\n");
      checked(["commit", "-qam", "B"]);
      const baseB = gitHead(target);
      checked(["worktree", "add", "--detach", staging, baseB]);
      writeFileSync(join(staging, "app.txt"), "product edit\n");
      mkdirSync(join(staging, packet), { recursive: true });
      writeFileSync(join(staging, packet, "proposal.md"), "approved amendment\n");
      const packetHash = directoryHash(join(staging, packet));
      let expectedProduct = "product edit\n";
      if (recoveryPoint !== "staged") checked(["worktree", "move", staging, sandbox]);
      if (recoveryPoint === "newer-agent-commit") {
        expectedProduct = "product edit plus later agent work\n";
        writeFileSync(join(sandbox, "app.txt"), expectedProduct);
        checked(["add", "."], sandbox); checked(["commit", "-qm", "retain later work"], sandbox);
      }
      writeFileSync(join(target, "upstream.txt"), "C\n");
      checked(["commit", "-qam", "C"]);
      const state = { status: "proven", workspace: { mode: "worktree", path: sandbox, baseHead: baseA,
        amendmentReplay: { from: baseA, to: baseB, packetHash } },
        specApproval: { identity: "approved-packet", revision: 1 }, lastBaseMove: { movementKey: "old" },
        repositories: { root: { mode: "worktree", path: sandbox, baseHead: baseA, access: "write" } } };
      const proof = join(root, "proof.json");
      const receipt = join(root, "receipt.json");
      writeFileSync(proof, "old aggregate proof\n"); writeFileSync(receipt, "retained provider evidence\n");
      let invalidations = 0;
      const runtime = createSandboxRuntime({ root: target, git, gitHead,
        directoryHash, fail, loadRuntime: () => state, saveRuntime: () => {}, proofPath: () => proof,
        clearSnapshotCache: () => { invalidations++; } });
      runtime.recoverReplay("amended");
      assert.equal(state.workspace.baseHead, baseB);
      assert.equal(state.repositories.root.baseHead, baseB);
      assert.equal(invalidations, 1);
      assert.equal(state.status, "building");
      assert.equal(existsSync(proof), false);
      assert.equal(readFileSync(receipt, "utf8"), "retained provider evidence\n");
      assert.deepEqual(state.specApproval, { identity: "approved-packet", revision: 1 });
      assert.equal(state.lastBaseMove, undefined);
      const replay = prepareWorktreeReplay({ id: "amended", state,
        candidate: { repository: "root", record: state.repositories.root, targetPath: target },
        git, gitHead, selectedRepositories: () => [], fail,
        gitBuffer: (args, cwd) => spawnSync("git", args, { cwd }) });
      assert.deepEqual(replay.movement.conflicts, []);
      assert.equal(readFileSync(join(replay.staging, "upstream.txt"), "utf8"), "C\n");
      assert.equal(readFileSync(join(replay.staging, "app.txt"), "utf8"), expectedProduct);
      assert.equal(directoryHash(join(sandbox, packet)), packetHash);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("amended replay retains a verified packet across replacement failures", () => {
  const root = mkdtempSync(join(tmpdir(), "amended-replay-"));
  const { directoryHash } = createStateRuntime({});
  try {
    const original = join(root, "sandbox");
    const staging = join(root, "sandbox.rebase");
    const packet = "openspec/changes/amended";
    mkdirSync(join(original, packet), { recursive: true });
    mkdirSync(join(staging, packet), { recursive: true });
    writeFileSync(join(original, packet, "proposal.md"), "amended agreement\n");
    writeFileSync(join(original, packet, "tasks.md"), "- [x] T001 completed\n");
    writeFileSync(join(staging, packet, "obsolete.md"), "old target artifact\n");
    const prepared = { record: { path: original, baseHead: "old" }, staging,
      movement: { repository: "root", to: "new" }, targetPath: root, patch: "retained.patch" };
    assert.throws(() => preserveReplayPacket("amended", prepared,
      (path) => path.startsWith(staging) ? "incorrect-copy" : directoryHash(path)),
    /amended packet changed/);
    assert.equal(readFileSync(join(original, packet, "proposal.md"), "utf8"), "amended agreement\n");
    preserveReplayPacket("amended", prepared, directoryHash);
    const expected = directoryHash(join(original, packet));
    assert.equal(directoryHash(join(staging, packet)), expected);
    assert.equal(existsSync(join(staging, packet, "obsolete.md")), false);
    const state = { workspace: { baseHead: "old" } };
    let failure = "remove";
    const context = { fail, directoryHash, carryIgnoredArtifacts: () => {}, selectedRepositories: () => [],
      git: (args) => {
        if (args[1] === failure) return { status: 1, stderr: "injected failure" };
        if (args[1] === "remove") rmSync(original, { recursive: true });
        if (args[1] === "move") renameSync(staging, original);
        return ok;
      } };
    assert.throws(() => commitSandboxReplay(context, "amended", state, prepared), /cannot replace/);
    assert.equal(directoryHash(join(original, packet)), expected);
    failure = "move";
    assert.throws(() => commitSandboxReplay(context, "amended", state, prepared), /replacement could not be moved/);
    assert.equal(existsSync(original), false);
    assert.equal(directoryHash(join(staging, packet)), expected);
    assert.equal(state.workspace.baseHead, "old");
    assert.equal(prepared.record.baseHead, "old");
    state.workspace = { mode: "worktree", path: original, baseHead: "old",
      amendmentReplay: { from: "old", to: "new", packetHash: expected } };
    let saves = 0;
    const recovery = { root, fail, directoryHash, pathExists: existsSync,
      ownsWorktree: () => true, gitHead: () => "new",
      git: () => { renameSync(staging, original); return ok; },
      saveRuntime: () => { saves++; } };
    assert.throws(() => recoverAmendedReplay({ ...recovery, ownsWorktree: () => false },
      "amended", state), /cannot be verified/);
    assert.equal(recoverAmendedReplay(recovery, "amended", state), true);
    assert.equal(directoryHash(join(original, packet)), expected);
    assert.equal(state.workspace.baseHead, "new", "the restored replay must use its verified base");
    assert.equal(state.workspace.amendmentReplay, undefined);
    assert.equal(saves, 1);
    assert.equal(recoverAmendedReplay(recovery, "amended", state), false);
    mkdirSync(staging);
    preserveReplayPacket("amended", prepared, directoryHash);
    writeFileSync(join(original, packet, "proposal.md"), "newer amendment\n");
    assert.throws(() => commitSandboxReplay(context, "amended", state, prepared),
      /amended packet changed before sandbox replay/);
    assert.equal(readFileSync(join(original, packet, "proposal.md"), "utf8"), "newer amendment\n");
    state.workspace.amendmentReplay = { from: "old", to: "new", packetHash: expected };
    assert.equal(recoverAmendedReplay({ ...recovery, gitHead: () => "newer-agent-commit", git: () => ok },
      "amended", state), false);
    assert.equal(state.workspace.amendmentReplay, undefined);
    assert.equal(readFileSync(join(original, packet, "proposal.md"), "utf8"), "newer amendment\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rejectedPaths prefers genuine merge conflicts and sorts patch failures", () => {
  assert.deepEqual(rejectedPaths("U z.js\nU a.js\nerror: patch failed: ignored.js:1"),
    ["a.js", "z.js"]);
  assert.deepEqual(rejectedPaths([
    "error: patch failed: b.js:2", "error: a.js: patch does not apply",
    "error: c.js: does not exist in index",
    "error: d.js: already exists in working directory"
  ].join("\n")), ["a.js", "b.js", "c.js", "d.js"]);
  assert.deepEqual(rejectedPaths(null), []);
});

test("read-only replay precheck rejects dirty and unreadable sandboxes", () => {
  assert.doesNotThrow(() => assertReadOnlyReplayClean("api", { access: "write" },
    () => { throw new Error("unused"); }, fail));
  assert.doesNotThrow(() => assertReadOnlyReplayClean("api", { access: "read", path: "/box" },
    () => ok, fail));
  assert.throws(() => assertReadOnlyReplayClean("api", { access: "read", path: "/box" },
    () => ({ status: 0, stdout: " M file.js", stderr: "" }), fail), /M file\.js/);
  assert.throws(() => assertReadOnlyReplayClean("api", { access: "read", path: "/box" },
    () => ({ status: 1, stdout: "", stderr: "broken" }), fail), /broken/);
});

test("replayContext identifies moved bases and root submodule pathspecs", () => {
  const candidate = {
    repository: "root", targetPath: "/target",
    record: { path: "/box", baseHead: "base", access: "write" }
  };
  const context = replayContext({
    id: "c", state: {}, candidate, gitHead: () => "head",
    selectedRepositories: () => [
      { type: "submodule", relativePath: "vendor/api" }, { type: "root" }
    ]
  });
  assert.deepEqual(context.movement, {
    repository: "root", from: "base", to: "head", rebased: false, conflicts: []
  });
  assert.equal(context.staging, "/box.rebase");
  assert.ok(context.pathspec.some((entry) => entry.includes("vendor/api")));
  for (const changed of [
    { ...candidate, targetPath: null },
    { ...candidate, record: { ...candidate.record, baseHead: null } }
  ]) assert.equal(replayContext({
    id: "c", state: {}, candidate: changed, gitHead: () => "head",
    selectedRepositories: () => []
  }), null);
  assert.equal(replayContext({
    id: "c", state: {}, candidate, gitHead: () => "base", selectedRepositories: () => []
  }), null);
});

test("a manually rebased sandbox can advance its recorded base safely", () => {
  const candidate = {
    repository: "root", targetPath: "/target",
    record: { path: "/box", baseHead: "old" }
  };
  const heads = new Map([["/target", "new"], ["/box", "new"]]);
  assert.deepEqual(manuallyRebasedMovement(candidate, (path) => heads.get(path)), {
    repository: "root", from: "old", to: "new", rebased: true,
    conflicts: [], manuallyRebased: true
  });
  heads.set("/box", "other");
  assert.equal(manuallyRebasedMovement(candidate, (path) => heads.get(path)), null);
});

test("staging and cleanup perform the durable worktree lifecycle", () => {
  const calls = [];
  const removed = [];
  const context = {
    repository: "api", record: { access: "write" }, targetPath: "/target",
    currentHead: "head", staging: "/box.rebase", patch: "/box.patch"
  };
  const dependencies = {
    git: (args, cwd) => { calls.push([args, cwd]); return ok; },
    remove: (path, options) => removed.push([path, options]), fail
  };
  stageReplayWorkspace(context, dependencies);
  replayStagingCleanup(context, dependencies)();
  replayStagingCleanup(context, dependencies, false)();
  assert.equal(calls.filter(([args]) => args[0] === "worktree").length, 4);
  assert.ok(removed.some(([path]) => path === "/box.patch"));
  const broken = { ...dependencies, git: (args) => args[1] === "add"
    ? { status: 1, stderr: "cannot add" } : ok };
  assert.throws(() => stageReplayWorkspace(context, broken), /rebase worktree: cannot add/);
  assert.throws(() => stageReplayWorkspace({
    ...context, record: { access: "read" }
  }, broken), /read-only worktree refresh/);
});

function replayFixture({ access = "write", diff = Buffer.from("patch"), apply = ok } = {}) {
  const calls = [];
  const writes = [];
  const options = {
    id: "c", state: {},
    candidate: {
      repository: "api", targetPath: "/target",
      record: { path: "/box", baseHead: "base", access }
    },
    gitHead: () => "head", selectedRepositories: () => [], fail,
    git: (args, cwd) => {
      calls.push([args, cwd]);
      if (args[0] === "apply") return apply;
      return ok;
    },
    gitBuffer: () => ({ status: 0, stdout: diff, stderr: Buffer.from("") }),
    write: (path, value) => writes.push([path, value]),
    remove: () => {}
  };
  return { options, calls, writes };
}

test("prepareWorktreeReplay handles read-only, empty, successful and conflicting diffs", () => {
  const readOnly = replayFixture({ access: "read" });
  const refreshed = prepareWorktreeReplay(readOnly.options);
  assert.equal(refreshed.movement.from, "base");
  refreshed.discardStaging();
  assert.equal(readOnly.calls.some(([args]) => args[0] === "apply"), false);

  const empty = replayFixture({ diff: Buffer.alloc(0) });
  assert.deepEqual(prepareWorktreeReplay(empty.options).movement.conflicts, []);
  assert.equal(empty.writes.length, 0);

  const success = replayFixture();
  assert.deepEqual(prepareWorktreeReplay(success.options).movement.conflicts, []);
  assert.equal(success.writes[0][0], "/box.rebase.patch");

  const conflict = replayFixture({ apply: {
    status: 1, stderr: "error: patch failed: src/a.js:4", stdout: "U src/b.js"
  } });
  assert.deepEqual(prepareWorktreeReplay(conflict.options).movement.conflicts, ["src/b.js"]);
  const unnamed = replayFixture({ apply: { status: 1, stderr: "unknown", stdout: "" } });
  assert.deepEqual(prepareWorktreeReplay(unnamed.options).movement.conflicts, ["."]);
});

test("prepareWorktreeReplay preserves early exits and diff read failures", () => {
  const stationary = replayFixture();
  stationary.options.gitHead = () => "base";
  assert.equal(prepareWorktreeReplay(stationary.options), null);
  const broken = replayFixture();
  broken.options.gitBuffer = () => ({
    status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("bad diff")
  });
  assert.throws(() => prepareWorktreeReplay(broken.options), /bad diff/);
});
