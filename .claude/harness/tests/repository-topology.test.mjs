import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import test from "node:test";

import {
  assertSelectedDependencies,
  createRepositoryTopology,
  normalizedSelectionEntry,
  selectRepositories,
  selectedRepository,
  selectedRepositoryRow
} from "../runtime/workflow/repository-topology.mjs";

const fail = (message) => { throw new Error(message); };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "foundation-repository-source-"));
  const sandbox = join(root, ".foundation", "sandboxes", "change");
  const targetChange = join(root, "openspec", "changes", "change");
  const activeChange = join(sandbox, "openspec", "changes", "change");
  for (const path of [targetChange, activeChange, join(root, "child"), join(sandbox, "child")])
    mkdirSync(path, { recursive: true });
  writeFileSync(join(root, "openspec", "repositories.yaml"), JSON.stringify({
    version: 1,
    repositories: [{ id: "child", type: "git", path: "child", mode: "write" }]
  }));
  writeFileSync(join(targetChange, "repositories.yaml"), JSON.stringify({
    version: 1,
    repositories: [
      { id: "root", mode: "write" },
      { id: "child", mode: "write", dependsOn: ["root"] }
    ]
  }));
  writeFileSync(join(activeChange, "repositories.yaml"), JSON.stringify({
    version: 1,
    repositories: [{ id: "root", mode: "write" }]
  }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const state = {
    workspace: { mode: "worktree", path: sandbox },
    repositories: { child: { path: join(sandbox, "child") } }
  };
  const topology = createRepositoryTopology({
    root,
    slugify: (value) => value,
    readJson: (path) => JSON.parse(execFileSync("cat", [path], { encoding: "utf8" })),
    canonicalPath: (path) => resolve(path),
    pathInside: (parent, child) => {
      const rel = relative(parent, child);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    },
    activeChangePath: () => activeChange,
    loadRuntime: () => state,
    git: () => ({ status: 0, stdout: "", stderr: "" }),
    gitHead: () => null,
    fail
  });
  return { root, sandbox, targetChange, state, topology, fail };
}

test("repository selection follows the packet source without changing the default", () => {
  const f = fixture();
  try {
    const active = f.topology.selected("change", f.state);
    assert.deepEqual(active.map((row) => row.id), ["root"]);
    assert.equal(active[0].workspacePath, f.sandbox);

    const target = f.topology.selected("change", f.state, f.fail, {
      changeDir: f.targetChange,
      useTargetPaths: true
    });
    assert.deepEqual(target.map((row) => row.id), ["root", "child"]);
    assert.equal(target[0].workspacePath, f.root);
    assert.equal(target[1].workspacePath, join(f.root, "child"));
    assert.deepEqual(target[1].dependsOn, ["root"]);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("selection entries and catalog lookup retain string and object forms", () => {
  const object = { id: "child", mode: "read" };
  assert.deepEqual(normalizedSelectionEntry("root"), { id: "root" });
  assert.equal(normalizedSelectionEntry(object), object);

  const catalogValue = { repositories: [{ id: "root" }] };
  assert.equal(selectedRepository(catalogValue, "change", { id: "root" }, fail).id,
    "root");
  assert.throws(() => selectedRepository(
    catalogValue, "change", { id: "missing" }, fail
  ), /references unknown repository 'missing'/);
});

test("selected repository rows preserve runtime and target path precedence", () => {
  const heads = [];
  const base = {
    repository: {
      id: "child", path: "/root/child", mode: "write", dependsOn: ["root"]
    },
    entry: { id: "child", mode: "read", dependsOn: [] },
    root: "/root",
    canonicalPath: (path) => `canonical:${path}`,
    gitHead: (path) => { heads.push(path); return "git-head"; }
  };
  const runtime = selectedRepositoryRow({
    ...base,
    state: { repositories: { child: { path: "/sandbox/child", baseHead: "base" } } },
    options: {}
  });
  assert.equal(runtime.mode, "read");
  assert.deepEqual(runtime.dependsOn, []);
  assert.equal(runtime.baseHead, "base");
  assert.equal(runtime.workspacePath, "canonical:/sandbox/child");
  assert.deepEqual(heads, []);

  const target = selectedRepositoryRow({ ...base, state: {}, options: { useTargetPaths: true } });
  assert.equal(target.baseHead, "git-head");
  assert.equal(target.workspacePath, "canonical:/root/child");
  assert.deepEqual(heads, ["/root/child"]);

  const rootRow = selectedRepositoryRow({
    ...base, repository: { id: "root", path: "/root" }, entry: { id: "root" },
    state: { workspace: { path: "/sandbox" } }, options: {}
  });
  assert.equal(rootRow.mode, undefined);
  assert.deepEqual(rootRow.dependsOn, []);
  assert.equal(rootRow.workspacePath, "canonical:/sandbox");
});

test("selection composition defaults to root and rejects duplicates and missing dependencies", () => {
  const repositories = [
    { id: "root", path: "/root", mode: "write", dependsOn: [] },
    { id: "child", path: "/root/child", mode: "write", dependsOn: ["root"] }
  ];
  const input = (selection) => ({
    id: "change", catalogValue: { repositories }, selection, state: {}, options: {},
    root: "/root", canonicalPath: (path) => path, gitHead: () => null,
    reportFailure: fail
  });
  assert.deepEqual(selectRepositories(input(null)).map((row) => row.id), ["root"]);
  assert.deepEqual(selectRepositories(input({ repositories: ["root", "child"] }))
    .map((row) => row.id), ["root", "child"]);
  assert.throws(() => selectRepositories(input({ repositories: ["root", "root"] })),
    /repeats 'root'/);
  assert.throws(() => selectRepositories(input({ repositories: ["child"] })),
    /must select dependency 'root'/);
});

test("dependency validation accepts complete selections and reports the first gap", () => {
  const complete = [
    { id: "root", dependsOn: [] }, { id: "child", dependsOn: ["root"] }
  ];
  assert.doesNotThrow(() => assertSelectedDependencies(complete, "change", fail));
  assert.throws(() => assertSelectedDependencies(
    [{ id: "child", dependsOn: ["missing"] }], "change", fail
  ), /must select dependency 'missing'/);
});
