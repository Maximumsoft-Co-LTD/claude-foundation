import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
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
  // The real guard backs up a plain (non-Git) copy's unlanded files before
  // removing it, and never removes a worktree it cannot inspect.
  const guarded = createSandboxCleanup({ root, canonicalPath, git, now: () => "t1" });
  writeFileSync(join(expected, "work.txt"), "unlanded\n");
  const backedUp = guarded.cleanupAppliedSandbox("c", state("copy", expected));
  assert.equal(backedUp.status, "removed");
  assert.equal(readFileSync(join(root, backedUp.backup, "files", "work.txt"), "utf8"),
    "unlanded\n");
  const unverifiable = join(root, ".foundation", "repository-sandboxes", "c", "plain");
  mkdirSync(unverifiable, { recursive: true });
  const kept = guarded.cleanupRepositorySandboxes("c", { repositories: {
    plain: { mode: "worktree", path: unverifiable, targetPath: root, baseHead: "a".repeat(40) }
  } }).plain;
  assert.equal(kept.status, "refused");
  assert.match(kept.reason, /cannot verify sandbox content before removal/);
  assert.equal(existsSync(unverifiable), true);
  rmSync(unverifiable, { recursive: true });
  mkdirSync(expected, { recursive: true });
  // The removal mechanics below are exercised with an inspected, clean guard.
  const cleanup = createSandboxCleanup({
    root, canonicalPath, git, guard: () => ({ proceed: true, backup: null })
  });
  assert.deepEqual(cleanup.cleanupAppliedSandbox("c", state("copy", expected)), {
    status: "removed",
    path: expected
  });
  assert.equal(existsSync(expected), false);

  assert.deepEqual(cleanup.cleanupRepositorySandboxes("c", {}), {});
  const repositoryRoot = join(root, ".foundation", "repository-sandboxes", "c");
  const outside = join(root, "outside-repository-worktree");
  const api = join(repositoryRoot, "api");
  const failed = join(repositoryRoot, "failed");
  mkdirSync(outside, { recursive: true });
  mkdirSync(api, { recursive: true });
  mkdirSync(failed, { recursive: true });
  const repositories = {
    root: { mode: "worktree", path: root, targetPath: root },
    copy: { mode: "copy", path: outside, targetPath: root },
    missing: { mode: "worktree", path: join(root, "missing"), targetPath: root },
    outside: { mode: "worktree", path: outside, targetPath: root },
    api: { mode: "worktree", path: api, targetPath: join(root, "api-source") }
  };
  calls.length = 0;
  assert.deepEqual(cleanup.cleanupRepositorySandboxes("c", { repositories }), {
    root: { status: "not-needed" },
    copy: { status: "not-needed" },
    missing: { status: "not-needed" },
    outside: {
      status: "refused",
      reason: "repository sandbox path is outside the expected location"
    },
    api: { status: "removed" }
  });
  assert.deepEqual(calls, [
    { args: ["worktree", "remove", "--force", api], cwd: join(root, "api-source") },
    { args: ["worktree", "prune"], cwd: join(root, "api-source") }
  ]);
  const failingCleanup = createSandboxCleanup({
    root, canonicalPath,
    git: () => ({ status: 1, stderr: "repository locked\n" }),
    guard: () => ({ proceed: true, backup: null })
  });
  assert.deepEqual(failingCleanup.cleanupRepositorySandboxes("c", {
    repositories: {
      failed: { mode: "worktree", path: failed, targetPath: join(root, "failed-source") }
    }
  }), { failed: { status: "failed", reason: "repository locked" } });
} finally {
  rmSync(root, { recursive: true, force: true });
}
