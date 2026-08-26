import assert from "node:assert/strict";
import test from "node:test";
import {
  addChangedSurfaceSource,
  changedSurfaceRows,
  createChangePolicy,
  repositoryBaseHead,
  sortChangedSurface
} from "../runtime/workflow/change-policy.mjs";

test("changed-surface helpers normalize, exclude, merge and sort rows", () => {
  const sources = new Map();
  const add = (path, source, repositoryId = "root") => addChangedSurfaceSource({
    sources, path, source, repositoryId, changeId: "c",
    excludedWorkspaceDirs: new Set([".foundation"]),
    isCurrentChangePath: (candidate) => candidate === "changes/c/state.json"
  });
  add("", "dirty");
  add(".foundation/cache", "dirty");
  add("changes/c/state.json", "dirty");
  add("openspec/changes/c/tasks.md", "dirty");
  add("src\\index.js", "dirty");
  add("src/index.js", "committed");
  assert.deepEqual(changedSurfaceRows("root", sources), [{
    repositoryId: "root", path: "src/index.js", sources: ["committed", "dirty"]
  }]);
  assert.deepEqual(sortChangedSurface([
    { repositoryId: "root", path: "z" },
    { repositoryId: "api", path: "z" },
    { repositoryId: "root", path: "a" }
  ]).map((row) => `${row.repositoryId}/${row.path}`), ["api/z", "root/a", "root/z"]);
  assert.equal(repositoryBaseHead({ id: "root" }, {
    repositories: { root: { baseHead: "repo-base" } }, workspace: { baseHead: "workspace-base" }
  }), "repo-base");
  assert.equal(repositoryBaseHead({ id: "root" }, { workspace: { baseHead: "workspace-base" } }),
    "workspace-base");
  assert.equal(repositoryBaseHead({ id: "api" }, { repositories: {} }), null);
});

function policyFixture({ heads, diffStatus = 0, workspaceManifest = () => ({}) }) {
  const state = {
    workspace: { path: "/root", baseHead: "base-root" },
    repositories: { api: { baseHead: "head-api" } }
  };
  const repositories = [
    { id: "root", workspacePath: "/root" },
    { id: "api", workspacePath: "/api" }
  ];
  const policy = createChangePolicy({
    root: "/root", excludedWorkspaceDirs: new Set([".foundation"]), providers: {},
    gitHead: (workspace) => heads[workspace] || null,
    git: (args, workspace) => {
      if (args[0] === "diff")
        return { status: diffStatus, stdout: "src/both.js\0src/committed.js\0" };
      return { status: 0, stdout: workspace === "/root" ? "dirty-root" : "dirty-api" };
    },
    porcelainStatusRecords: (output) => output === "dirty-root"
      ? [
          { path: "src\\dirty.js" }, { path: ".foundation/cache" },
          { path: "openspec/changes/c/tasks.md" }, { path: "src/both.js" }
        ]
      : [{ path: "lib/api.js", origPath: "lib/old-api.js" }],
    workspaceManifest, loadRuntime: () => state,
    selectedRepositories: () => repositories,
    isCurrentChangePath: () => false,
    readJson: () => ({}), fileDigest: () => "digest",
    fail: (message) => { throw new Error(message); }
  });
  return { policy, state };
}

test("canonicalChangedSurface combines committed and dirty repository paths", () => {
  const { policy } = policyFixture({ heads: { "/root": "head-root", "/api": "head-api" } });
  assert.deepEqual(policy.canonicalChangedSurface("c"), [
    { repositoryId: "api", path: "lib/api.js", sources: ["dirty"] },
    { repositoryId: "api", path: "lib/old-api.js", sources: ["dirty"] },
    { repositoryId: "root", path: "src/both.js", sources: ["committed", "dirty"] },
    { repositoryId: "root", path: "src/committed.js", sources: ["committed"] },
    { repositoryId: "root", path: "src/dirty.js", sources: ["dirty"] }
  ]);
});

test("canonicalChangedSurface rejects missing and unreadable base comparisons", () => {
  const missing = policyFixture({ heads: { "/root": "head-root", "/api": "head-api" } });
  missing.state.workspace.baseHead = null;
  assert.throws(() => missing.policy.canonicalChangedSurface("c", missing.state), /missing baseHead/);
  const unreadable = policyFixture({
    heads: { "/root": "head-root", "/api": "head-api" }, diffStatus: 1
  });
  assert.throws(() => unreadable.policy.canonicalChangedSurface("c"), /from base base-root/);
});

test("canonicalChangedSurface compares manifests for a headless root copy", () => {
  const { policy, state } = policyFixture({
    heads: {}, workspaceManifest: () => ({ "same.js": "a", "new.js": "b" })
  });
  state.workspace.mode = "copy";
  state.workspace.baseline = { "same.js": "a", "old.js": "c" };
  state.repositories = {};
  assert.deepEqual(policy.canonicalChangedSurface("c", state), [
    { repositoryId: "root", path: "new.js", sources: ["dirty"] },
    { repositoryId: "root", path: "old.js", sources: ["dirty"] }
  ]);
});
