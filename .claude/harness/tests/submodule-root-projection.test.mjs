// Real-Git regression for the root sandbox of a superproject whose code lives
// in submodules. The root Build sandbox is a `git worktree` of the superproject
// in which no submodule is initialized, so a root task that requires one
// failed verify with MODULE_NOT_FOUND and had no route but an agreement
// amendment. The harness now projects each declared nested repository into the
// root sandbox: a selected one as a link to its repository sandbox, any other
// one as a checkout of the recorded gitlink commit from local objects.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { createStateRuntime } from "../runtime/core/state-runtime.mjs";
import { EXCLUDED_WORKSPACE_DIRS } from "../runtime/core/workspace-policy.mjs";
import { sandboxCodePathspec } from "../runtime/core/workspace-surface.mjs";
import { rootPointerMoves } from "../runtime/workflow/land-verification.mjs";
import { projectableRepositories } from "../runtime/workflow/repository-projection.mjs";
import { assessSandbox, sandboxDescriptors } from "../runtime/workflow/sandbox-preservation.mjs";
import {
  changeDiffCandidatePlan, changeDiffCandidateRow, createSandboxRuntime, normalizedDiffDigest,
  sandboxCopyPlan
} from "../runtime/workflow/sandbox-runtime.mjs";

const ID = "clamp-change";

function run(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function git(args, cwd) {
  const result = spawnSync("git", [
    "-c", "user.name=Foundation Test", "-c", "user.email=foundation@example.invalid",
    "-c", "protocol.file.allow=always", "-c", "init.defaultBranch=main",
    "-c", "commit.gpgsign=false", ...args
  ], { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`);
  return result.stdout.trim();
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function repository(base, name, files) {
  const path = join(base, name);
  mkdirSync(path);
  git(["init", "-q"], path);
  for (const [file, content] of Object.entries(files)) write(join(path, file), content);
  git(["add", "."], path);
  git(["commit", "-qm", `${name} base`], path);
  return path;
}

function node(cwd, source) {
  return spawnSync(process.execPath, ["-e", source], { cwd, encoding: "utf8" });
}

// `app` with three submodules: `lib` (selected, edited by the change),
// `other` (not selected, initialized, with an uncommitted target edit the
// projection must not carry), and `docs` (not selected, never initialized in
// the target and with no absorbed module directory: only its local URL holds
// the commit).
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "foundation-root-projection-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const libUpstream = repository(base, "lib-upstream",
    { "index.js": "exports.add = (a, b) => a + b;\n" });
  const otherUpstream = repository(base, "other-upstream",
    { "index.js": "exports.name = 'other';\n" });
  const docsUpstream = repository(base, "docs-upstream",
    { "index.js": "exports.title = 'docs';\n" });
  const root = join(base, "app");
  mkdirSync(root);
  git(["init", "-q"], root);
  write(join(root, ".gitignore"), ".foundation/\n");
  write(join(root, "main.js"), [
    "'use strict';",
    "const { add } = require('./packages/lib');",
    "module.exports = { total: (values) => values.reduce((sum, value) => add(sum, value), 0) };",
    ""
  ].join("\n"));
  git(["submodule", "add", "-q", libUpstream, "packages/lib"], root);
  git(["submodule", "add", "-q", otherUpstream, "packages/other"], root);
  git(["submodule", "add", "-q", docsUpstream, "packages/docs"], root);
  git(["add", "."], root);
  git(["commit", "-qm", "app base"], root);
  const rootBase = git(["rev-parse", "HEAD"], root);
  const otherCommit = git(["rev-parse", "HEAD:packages/other"], root);
  // Uninitialized target submodule without an absorbed module directory.
  git(["submodule", "deinit", "-q", "-f", "packages/docs"], root);
  rmSync(join(root, ".git", "modules", "packages/docs"), { recursive: true, force: true });
  // A target edit outside the change: never the recorded commit.
  write(join(root, "packages", "other", "index.js"), "exports.name = 'dirty target';\n");

  const shared = join(root, ".foundation", "sandboxes", ID);
  mkdirSync(dirname(shared), { recursive: true });
  git(["worktree", "add", "-q", "--detach", shared, rootBase], root);
  const libTarget = join(root, "packages", "lib");
  const libBase = git(["rev-parse", "HEAD"], libTarget);
  const libSandbox = join(root, ".foundation", "repository-sandboxes", ID, "lib");
  const packet = join(root, "openspec", "changes", ID);
  write(join(packet, "repositories.yaml"),
    `${JSON.stringify({ version: 1, repositories: ["root", "lib"] })}\n`);

  const state = {
    id: ID, status: "building",
    workspace: { mode: "worktree", path: shared, baseHead: rootBase, applied: false },
    repositories: {
      root: { mode: "worktree", path: shared, targetPath: root, baseHead: rootBase, access: "write" }
    }
  };
  const addRepositorySandbox = () => {
    mkdirSync(dirname(libSandbox), { recursive: true });
    git(["worktree", "add", "-q", "--detach", libSandbox, libBase], libTarget);
    state.repositories.lib = { mode: "worktree", path: libSandbox, targetPath: libTarget,
      baseHead: libBase, access: "write", applied: false };
  };
  const catalog = {
    repositories: [
      { id: "root", type: "root", path: root, relativePath: "." },
      { id: "lib", type: "submodule", name: "packages/lib", path: libTarget,
        relativePath: "packages/lib", url: libUpstream },
      { id: "other", type: "submodule", name: "packages/other", path: join(root, "packages/other"),
        relativePath: "packages/other", url: otherUpstream },
      { id: "docs", type: "submodule", name: "packages/docs", path: join(root, "packages/docs"),
        relativePath: "packages/docs", url: docsUpstream }
    ]
  };
  const notices = [];
  const runtime = createSandboxRuntime({
    root,
    git: (args, cwd = root) => run(args, cwd),
    gitHead: (path) => { const head = run(["rev-parse", "HEAD"], path); return head.status ? null : head.stdout.trim(); },
    loadRuntime: () => state,
    saveRuntime: () => {},
    repositoryCatalog: () => catalog,
    repositorySelectionIdsAt: (dir) => JSON.parse(readFileSync(join(dir, "repositories.yaml"), "utf8"))
      .repositories.map(String).sort(),
    changePath: () => packet,
    now: () => "2026-10-07T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });
  const project = () => {
    const prior = console.error;
    console.error = (line) => notices.push(String(line));
    try { return runtime.projectRepositories(ID); } finally { console.error = prior; }
  };
  return {
    base, root, shared, libSandbox, libTarget, libBase, rootBase, otherCommit, state,
    catalog, runtime, project, notices, addRepositorySandbox
  };
}

function editLibrary(f) {
  write(join(f.libSandbox, "index.js"), [
    "exports.add = (a, b) => a + b;",
    "exports.clamp = (value, min, max) => Math.min(max, Math.max(min, value));",
    ""
  ].join("\n"));
}

const consume = "const m = require('./main.js'); const lib = require('./packages/lib');" +
  "process.stdout.write(String(m.total([1, 2])) + ':' + lib.clamp(9, 0, 5));";

test("a root verify that requires the selected submodule sees its uncommitted sandbox work", (t) => {
  const f = fixture(t);
  f.addRepositorySandbox();
  editLibrary(f);
  // The reported defect: the submodule directory of the root worktree is empty.
  assert.deepEqual(readdirSync(join(f.shared, "packages", "lib")), []);
  const before = node(f.shared, consume);
  assert.notEqual(before.status, 0);
  assert.match(before.stderr, /MODULE_NOT_FOUND|Cannot find module/);

  const result = f.project();
  assert.ok(result.linked.includes("packages/lib"));
  assert.ok(lstatSync(join(f.shared, "packages", "lib")).isSymbolicLink());
  assert.equal(realpathSync(join(f.shared, "packages", "lib")), realpathSync(f.libSandbox));
  const after = node(f.shared, consume);
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.stdout, "3:5");

  // The repository sandbox is the single source of truth: a write through the
  // root path lands in it, and nothing diverges.
  write(join(f.shared, "packages", "lib", "extra.js"), "module.exports = 1;\n");
  assert.equal(readFileSync(join(f.libSandbox, "extra.js"), "utf8"), "module.exports = 1;\n");
  assert.match(run(["status", "--porcelain"], f.libSandbox).stdout, /extra\.js/);

  // Idempotent: a second pass changes nothing.
  assert.deepEqual(f.project(), { linked: [], checkedOut: [], preserved: [], unavailable: [] });
});

test("unselected submodules hold the recorded gitlink commit, initialized in the target or not", (t) => {
  const f = fixture(t);
  f.addRepositorySandbox();
  const result = f.project();
  assert.deepEqual(result.checkedOut.sort(), ["packages/docs", "packages/other"]);
  // The recorded commit, never the target checkout's uncommitted edit.
  assert.equal(readFileSync(join(f.shared, "packages", "other", "index.js"), "utf8"),
    "exports.name = 'other';\n");
  assert.equal(git(["rev-parse", "HEAD"], join(f.shared, "packages", "other")), f.otherCommit);
  // Never initialized in the target: populated from local objects all the same.
  assert.equal(readFileSync(join(f.shared, "packages", "docs", "index.js"), "utf8"),
    "exports.title = 'docs';\n");
  assert.deepEqual(readdirSync(join(f.root, "packages", "docs")), []);
  assert.equal(node(f.shared, "process.stdout.write(require('./packages/other').name + require('./packages/docs').title)").stdout,
    "otherdocs");

  // Read-only in spirit: an edit there would make root checks pass on bytes
  // no Land delivers, so the next check refuses until it is reverted.
  write(join(f.shared, "packages", "other", "index.js"), "exports.name = 'edited';\n");
  assert.throws(() => f.project(), /repository 'other' is not selected by change 'clamp-change'.*read-only/);
  git(["checkout", "--", "index.js"], join(f.shared, "packages", "other"));
  assert.deepEqual(f.project().checkedOut, []);
  // The target is untouched: its own edit and its uninitialized submodule stay.
  assert.equal(readFileSync(join(f.root, "packages", "other", "index.js"), "utf8"),
    "exports.name = 'dirty target';\n");
});

test("projected paths are no root change: status, proof hash, diff identity, Land pathspec, pointers", (t) => {
  const f = fixture(t);
  f.addRepositorySandbox();
  const declared = projectableRepositories(f.catalog.repositories).map((row) => row.relativePath);
  const state = createStateRuntime({
    root: f.root, runtime: join(f.base, "runtime"), changes: join(f.root, "openspec", "changes"),
    snapshots: join(f.base, "snapshots"), excludedWorkspaceDirs: EXCLUDED_WORKSPACE_DIRS,
    readJson: (path, fallback) => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback,
    writeJson: () => {}, canonicalPath: realpathSync, now: () => "now", fail: (m) => { throw new Error(m); }
  });
  const rootRow = () => {
    const plan = changeDiffCandidatePlan({
      pathExists: existsSync,
      selectedRepositories: () => [{ id: "root" },
        { id: "lib", type: "submodule", relativePath: "packages/lib" }],
      declaredRepositoryPaths: () => declared,
      codePathspec: sandboxCodePathspec, pid: process.pid, environment: process.env
    }, ID, f.state, { repository: "root", record: f.state.repositories.root });
    return changeDiffCandidateRow({
      remove: rmSync, spawn: spawnSync, diffDigest: normalizedDiffDigest
    }, plan);
  };
  const beforeHash = state.singleRelevantSnapshot(ID, f.shared, true).workspaceHash;
  const beforeRow = rootRow();
  f.project();
  editLibrary(f);
  write(join(f.shared, "packages", "lib", "through-root.js"), "x\n");
  assert.equal(run(["status", "--porcelain", "--untracked-files=all"], f.shared).stdout, "");
  assert.equal(state.singleRelevantSnapshot(ID, f.shared, true).workspaceHash, beforeHash);
  assert.equal(rootRow(), beforeRow);
  // An agent staging everything in the root sandbox stages no projection.
  git(["add", "-A"], f.shared);
  assert.equal(run(["diff", "--cached", "--name-only", f.rootBase, "--",
    ...sandboxCodePathspec(ID, declared)], f.shared).stdout, "");
  assert.deepEqual(rootPointerMoves(run(["diff", "--cached", "--raw", "-z", "--no-abbrev",
    "--no-renames", f.rootBase, "--", ...declared], f.shared).stdout), []);
  // The change itself lives only in the repository sandbox, which Land
  // delivers to the submodule target, and the root target is untouched.
  assert.match(run(["status", "--porcelain"], f.libSandbox).stdout, /index\.js/);
  assert.equal(run(["status", "--porcelain"], f.libTarget).stdout, "");
  assert.equal(readFileSync(join(f.libTarget, "index.js"), "utf8"), "exports.add = (a, b) => a + b;\n");
  // Removal assessment reads the link's work in its repository sandbox, never
  // as unlanded placeholder content of the root sandbox.
  const [rootDescriptor] = sandboxDescriptors(f.root, ID, f.state);
  assert.deepEqual(assessSandbox(rootDescriptor).placeholders, []);
  // Removing the root sandbox never deletes through the link.
  git(["worktree", "remove", "--force", f.shared], f.root);
  assert.ok(existsSync(join(f.libSandbox, "through-root.js")));
});

test("a repository sandbox created after the root sandbox, and a re-created root sandbox, are projected", (t) => {
  const f = fixture(t);
  // Selected, but its sandbox does not exist yet: left alone, never a stand-in.
  const early = f.project();
  assert.ok(!early.linked.includes("packages/lib") && !early.checkedOut.includes("packages/lib"));
  assert.deepEqual(readdirSync(join(f.shared, "packages", "lib")), []);
  f.addRepositorySandbox();
  editLibrary(f);
  assert.deepEqual(f.project().linked, ["packages/lib"]);
  assert.equal(node(f.shared, consume).stdout, "3:5");

  // Re-creation (sync replay, repair) rebuilds an empty root worktree.
  git(["worktree", "remove", "--force", f.shared], f.root);
  git(["worktree", "add", "-q", "--detach", f.shared, f.rootBase], f.root);
  assert.notEqual(node(f.shared, consume).status, 0);
  const again = f.project();
  assert.deepEqual(again.linked, ["packages/lib"]);
  assert.deepEqual(again.checkedOut.sort(), ["packages/docs", "packages/other"]);
  assert.equal(node(f.shared, consume).stdout, "3:5");
});

test("unknown content at a projected path is preserved, never deleted", (t) => {
  const f = fixture(t);
  f.addRepositorySandbox();
  write(join(f.shared, "packages", "lib", "stray.js"), "agent wrote this before the fix\n");
  const result = f.project();
  assert.equal(result.preserved.length, 1);
  assert.equal(readFileSync(join(result.preserved[0], "stray.js"), "utf8"),
    "agent wrote this before the fix\n");
  assert.ok(lstatSync(join(f.shared, "packages", "lib")).isSymbolicLink());
  assert.ok(f.notices.some((line) => /PRESERVED packages\/lib/.test(line)));
});

test("a copy root sandbox leaves nested repository directories for the projection", () => {
  const ok = { status: 0, stdout: "" };
  const plan = sandboxCopyPlan({
    root: "/r", carriesGit: true,
    git: (args) => args[0] === "ls-files" && !args.includes("--others")
      ? { status: 0, stdout: "packages/lib\0main.js\0" } : ok,
    sandboxCopyExcludedDirs: new Set(), excludedWorkspaceDirs: new Set(),
    nestedPaths: ["packages/lib"]
  });
  assert.equal(plan.excludes("packages/lib"), false);
  assert.equal(plan.excludes("packages/lib/index.js"), true);
  assert.equal(plan.excludes("main.js"), false);
});
