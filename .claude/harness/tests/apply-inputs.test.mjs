import assert from "node:assert/strict";
import test from "node:test";

import {
  gitApplyInputsOperation,
  sandboxDiffNamesOperation
} from "../runtime/workflow/apply-runtime.mjs";

const fail = (message) => { throw new Error(message); };

test("sandbox diff names handles empty scopes, git failures, and sorted NUL output", () => {
  assert.deepEqual(sandboxDiffNamesOperation({
    applyPathspec: () => [], git: assert.fail, sandboxBase: () => "base", fail
  }, "change", "/sandbox", {}), []);

  assert.throws(() => sandboxDiffNamesOperation({
    applyPathspec: () => [":(exclude).foundation"],
    git: () => ({ status: 1, stdout: "", stderr: "bad revision" }),
    sandboxBase: () => "base",
    fail
  }, "change", "/sandbox", {}), /cannot inspect sandbox paths: bad revision/);

  const calls = [];
  assert.deepEqual(sandboxDiffNamesOperation({
    applyPathspec: assert.fail,
    git: (args, cwd) => {
      calls.push([args, cwd]);
      return { status: 0, stdout: "z.js\0a.js\0", stderr: "" };
    },
    sandboxBase: () => "base",
    fail
  }, "change", "/sandbox", {}, ["src/**"]), ["a.js", "z.js"]);
  assert.deepEqual(calls[0], [[
    "diff", "--name-only", "-z", "base", "--", "src/**"
  ], "/sandbox"]);
});

function applyContext(overrides = {}) {
  const identities = new Map();
  const modes = new Map();
  const blobs = new Map();
  const kinds = new Map();
  const calls = { git: [], buffers: [], spawn: [] };
  const state = { workspace: { baseHead: "base" }, repositories: {} };
  const context = {
    root: "/target",
    git: (args, cwd) => { calls.git.push([args, cwd]); return { status: 0 }; },
    loadRuntime: () => state,
    sandboxDiffNames: () => ["file.js"],
    pathIdentity: (path) => identities.get(path) ??
      (path.startsWith("/sandbox/") ? "sandbox" : "target"),
    pathMode: (path) => modes.get(path) ?? null,
    lstat: (path) => kinds.has(path) ? {
      isDirectory: () => kinds.get(path) === "directory",
      isSymbolicLink: () => kinds.get(path) === "symlink"
    } : null,
    gitBuffer: (args, cwd) => {
      calls.buffers.push([args, cwd]);
      if (args[0] === "show") return { status: 0, stdout: Buffer.from("base") };
      return { status: 0, stdout: Buffer.from("patch") };
    },
    sandboxBase: () => "base",
    spawn: (...args) => { calls.spawn.push(args); return { status: 0, stderr: "" }; },
    readlink: (path) => blobs.get(path).toString(),
    readFile: (path) => blobs.get(path),
    fail,
    ...overrides
  };
  return { context, identities, modes, blobs, kinds, calls, state };
}

test("git apply inputs accepts paths already projected byte-for-byte", () => {
  const fixture = applyContext();
  fixture.identities.set("/target/file.js", "same");
  fixture.identities.set("/sandbox/file.js", "same");
  fixture.modes.set("/target/file.js", "100644");
  fixture.modes.set("/sandbox/file.js", "100644");

  assert.deepEqual(gitApplyInputsOperation(fixture.context, "change", "/sandbox"),
    ["file.js"]);
  assert.equal(fixture.calls.buffers.length, 0);
  assert.deepEqual(fixture.calls.git[0], [["add", "-N", "."], "/sandbox"]);
});

test("git apply inputs rejects directories and unreadable or empty root diffs", () => {
  const directory = applyContext();
  directory.kinds.set("/sandbox/file.js", "directory");
  assert.throws(() => gitApplyInputsOperation(directory.context, "change", "/sandbox"),
    /nested repository or directory path\(s\): file\.js/);

  const unreadable = applyContext({
    gitBuffer: () => ({ status: 1, stdout: Buffer.alloc(0) })
  });
  assert.throws(() => gitApplyInputsOperation(unreadable.context, "change", "/sandbox"),
    /cannot inspect sandbox diff/);

  const empty = applyContext({
    gitBuffer: () => ({ status: 0, stdout: Buffer.alloc(0) })
  });
  assert.throws(() => gitApplyInputsOperation(empty.context, "change", "/sandbox"),
    /sandbox has no applicable diff/);
  empty.state.repositories.api = {};
  assert.deepEqual(gitApplyInputsOperation(empty.context, "change", "/sandbox"), []);
});

test("git apply inputs reports textual conflicts before inspecting target blobs", () => {
  const fixture = applyContext({
    spawn: () => ({ status: 1, stderr: "patch does not apply" })
  });
  assert.throws(() => gitApplyInputsOperation(fixture.context, "change", "/sandbox"),
    /sandbox diff conflicts with target: patch does not apply/);
});

test("git apply inputs preserves missing, equal, base-matching, and symlink paths", () => {
  const fixture = applyContext({
    sandboxDiffNames: () => ["missing.js", "equal.js", "base.js", "link.js"]
  });
  fixture.kinds.set("/sandbox/missing.js", "file");
  fixture.blobs.set("/sandbox/missing.js", Buffer.from("new"));

  for (const name of ["equal.js", "base.js"]) {
    fixture.kinds.set(`/target/${name}`, "file");
    fixture.kinds.set(`/sandbox/${name}`, "file");
  }
  fixture.blobs.set("/target/equal.js", Buffer.from("same"));
  fixture.blobs.set("/sandbox/equal.js", Buffer.from("same"));
  fixture.blobs.set("/target/base.js", Buffer.from("base"));
  fixture.blobs.set("/sandbox/base.js", Buffer.from("new"));

  fixture.kinds.set("/target/link.js", "symlink");
  fixture.kinds.set("/sandbox/link.js", "symlink");
  fixture.blobs.set("/target/link.js", Buffer.from("destination"));
  fixture.blobs.set("/sandbox/link.js", Buffer.from("destination"));

  assert.deepEqual(gitApplyInputsOperation(fixture.context, "change", "/sandbox"),
    ["missing.js", "equal.js", "base.js", "link.js"]);
  assert.equal(fixture.calls.spawn.length, 1);
});

test("git apply inputs refuses target edits absent from the sandbox base", () => {
  const fixture = applyContext();
  fixture.kinds.set("/target/file.js", "file");
  fixture.kinds.set("/sandbox/file.js", "file");
  fixture.blobs.set("/target/file.js", Buffer.from("local edit"));
  fixture.blobs.set("/sandbox/file.js", Buffer.from("new"));
  fixture.context.gitBuffer = (args) => args[0] === "show"
    ? { status: 1, stdout: Buffer.alloc(0) }
    : { status: 0, stdout: Buffer.from("patch") };

  assert.throws(() => gitApplyInputsOperation(fixture.context, "change", "/sandbox"),
    /overwrite uncommitted target edits at: file\.js/);
});
