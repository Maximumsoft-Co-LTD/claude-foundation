import assert from "node:assert/strict";
import test from "node:test";

import {
  ciRepositoryLandStatus,
  landRepositoryPlanRow,
  readRepositoryLandStatus,
  writeRepositoryLandStatus
} from "../runtime/workflow/land-runtime.mjs";

test("read repository status covers isolation, dirt, drift, and readiness", () => {
  const repository = { baseHead: "base" };
  assert.equal(readRepositoryLandStatus(repository, {}, "base", ""),
    "read-not-isolated");
  assert.equal(readRepositoryLandStatus(repository, { mode: "worktree" }, "base", " M file"),
    "read-sandbox-dirty");
  assert.equal(readRepositoryLandStatus(repository, {
    mode: "worktree", baseHead: "runtime-base"
  }, "other", ""), "read-dependency-drift");
  assert.equal(readRepositoryLandStatus(repository, {
    mode: "worktree", baseHead: "runtime-base"
  }, "runtime-base", ""), "read-only");
});

test("write repository status covers every saga milestone", () => {
  const child = { id: "api", type: "repository" };
  assert.equal(writeRepositoryLandStatus({ id: "root" }, {}, null, false),
    "control-plane-last");
  assert.equal(writeRepositoryLandStatus(child, {}, null, false), "sandbox-missing");
  assert.equal(writeRepositoryLandStatus(child, { path: "/box" }, null, false),
    "awaiting-explicit-commit");
  assert.equal(writeRepositoryLandStatus(child, { path: "/box" }, "commit", false),
    "awaiting-explicit-branch-land");
  const submodule = { ...child, type: "submodule" };
  assert.equal(writeRepositoryLandStatus(
    submodule, { path: "/box" }, "commit", true, "other", "commit"),
  "awaiting-root-pointer");
  assert.equal(writeRepositoryLandStatus(
    submodule, { path: "/box" }, "commit", true, "commit", "other"),
  "awaiting-root-pointer");
  assert.equal(writeRepositoryLandStatus(
    submodule, { path: "/box" }, "commit", true, "commit", "commit"),
  "child-landed");
  assert.equal(writeRepositoryLandStatus(
    child, { path: "/box" }, "commit", true, null, null), "child-landed");
});

test("CI status preserves required-wait precedence over explicit failure", () => {
  assert.equal(ciRepositoryLandStatus("child-landed", { land: { ci: "fail" } }),
    "ci-failed");
  assert.equal(ciRepositoryLandStatus("child-landed", {
    land: { ci: "fail", ciRequired: true }
  }), "awaiting-ci");
  assert.equal(ciRepositoryLandStatus("child-landed", {
    land: { ci: "pass", ciRequired: true }
  }), "child-landed");
  assert.equal(ciRepositoryLandStatus("child-landed", {}), "child-landed");
});

function rowContext(overrides = {}) {
  return {
    root: "/target",
    git: () => ({ stdout: "" }),
    gitHead: (path) => `head:${path}`,
    rootGitlink: (_workspace, repository) => repository.type === "submodule"
      ? "commit" : null,
    repositoryCommitLanded: () => true,
    ...overrides
  };
}

test("land repository row preserves complete child projection", () => {
  const repository = {
    id: "api", type: "submodule", mode: "write", dependsOn: ["db"],
    path: "/target/api", workspacePath: "/workspace/api", baseHead: "repo-base"
  };
  const state = {
    workspace: { path: "/workspace" },
    repositories: { api: {
      path: "/box/api", baseHead: "runtime-base",
      land: { commit: "commit", ci: "pass", ciRequired: true }
    } }
  };
  assert.deepEqual(landRepositoryPlanRow(rowContext(), state, repository), {
    id: "api", type: "submodule", mode: "write", dependsOn: ["db"],
    targetPath: "/target/api", sandboxPath: "/box/api",
    baseHead: "runtime-base", targetHead: "head:/target/api",
    sandboxHead: "head:/box/api", commit: "commit", ci: "pass",
    rootGitlink: "commit", targetRootGitlink: "commit", status: "child-landed"
  });
});

test("land repository row preserves legacy defaults and read dirty inspection", () => {
  const repository = {
    id: "docs", type: "repository", mode: "read",
    path: "/target/docs", workspacePath: "/workspace/docs", baseHead: "base"
  };
  const legacy = landRepositoryPlanRow(rowContext(), {}, repository);
  assert.equal(legacy.status, "read-not-isolated");
  assert.deepEqual(legacy.dependsOn, []);
  assert.equal(legacy.sandboxPath, "/workspace/docs");
  assert.equal(legacy.baseHead, "base");
  assert.equal(legacy.commit, null);
  assert.equal(legacy.ci, null);

  let gitArgs;
  const dirty = landRepositoryPlanRow(rowContext({
    git: (...args) => { gitArgs = args; return { stdout: " M docs.md " }; }
  }), { repositories: { docs: {
    mode: "worktree", path: "/box/docs", baseHead: "head:/target/docs"
  } } }, repository);
  assert.equal(dirty.status, "read-sandbox-dirty");
  assert.deepEqual(gitArgs, [["status", "--porcelain"], "/box/docs"]);
});
