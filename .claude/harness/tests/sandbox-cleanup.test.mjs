import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  cleanupAppliedSandboxOperation,
  createSandboxCleanup,
  recognisedCopySandbox
} from "../runtime/workflow/sandbox-cleanup.mjs";

const root = realpathSync(mkdtempSync(join(tmpdir(), "foundation-sandbox-cleanup-")));
const canonicalPath = (path) => resolve(path);
const calls = [];
const git = (args, cwd) => {
  calls.push({ args, cwd });
  return { status: 0, stderr: "" };
};
const dependencies = {
  root,
  canonicalPath,
  git,
  pathExists: () => true,
  removePath: () => {}
};
const state = (mode, path, key = "sandboxPath") => ({
  workspace: { mode, [key]: path }
});

try {
  const expected = join(root, ".foundation", "sandboxes", "c");
  assert.equal(recognisedCopySandbox(root, "c", expected, canonicalPath), true);
  assert.equal(recognisedCopySandbox(root, "c", "/tmp/foundation-c-legacy", canonicalPath), true);
  assert.equal(recognisedCopySandbox(root, "c", join(root, "unrelated"), canonicalPath), false);

  assert.deepEqual(
    cleanupAppliedSandboxOperation(dependencies, "c", { workspace: {} }),
    { status: "not-needed", path: null }
  );
  assert.deepEqual(
    cleanupAppliedSandboxOperation(dependencies, "c", state("copy", root)),
    { status: "not-needed", path: root }
  );
  assert.deepEqual(
    cleanupAppliedSandboxOperation({ ...dependencies, pathExists: () => false }, "c", state("copy", expected)),
    { status: "not-needed", path: expected }
  );
  assert.match(
    cleanupAppliedSandboxOperation(dependencies, "c", state("copy", join(root, "unrelated"))).reason,
    /neither the Foundation sandbox location/
  );
  assert.deepEqual(
    cleanupAppliedSandboxOperation(dependencies, "c", state("copy", expected, "path")),
    { status: "removed", path: expected }
  );
  assert.deepEqual(
    cleanupAppliedSandboxOperation({
      ...dependencies,
      removePath: () => { throw new Error("busy"); }
    }, "c", state("copy", expected)),
    { status: "failed", path: expected, reason: "busy" }
  );

  assert.match(
    cleanupAppliedSandboxOperation(dependencies, "c", state("worktree", join(root, "elsewhere"))).reason,
    /outside the expected sandbox location/
  );
  assert.deepEqual(
    cleanupAppliedSandboxOperation({
      ...dependencies,
      git: () => ({ status: 1, stderr: "locked\n" })
    }, "c", state("worktree", expected)),
    { status: "failed", path: expected, reason: "locked" }
  );
  calls.length = 0;
  assert.deepEqual(
    cleanupAppliedSandboxOperation(dependencies, "c", state("worktree", expected)),
    { status: "removed", path: expected }
  );
  assert.deepEqual(calls, [
    { args: ["worktree", "remove", "--force", expected], cwd: root },
    { args: ["worktree", "prune"], cwd: root }
  ]);
  assert.deepEqual(
    cleanupAppliedSandboxOperation(dependencies, "c", state("external", expected)),
    { status: "not-needed", path: expected }
  );

  mkdirSync(expected, { recursive: true });
  const cleanup = createSandboxCleanup({ root, canonicalPath, git });
  assert.deepEqual(cleanup.cleanupAppliedSandbox("c", state("copy", expected)), {
    status: "removed",
    path: expected
  });
  assert.equal(existsSync(expected), false);
} finally {
  rmSync(root, { recursive: true, force: true });
}
