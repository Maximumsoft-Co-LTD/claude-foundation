// Real-Git regression fixture for three reported data-loss paths in a
// superproject whose code lives in a submodule:
//   (a) Land reported success while the submodule target still sat at its base
//       commit, and archive cleanup then deleted the only copy of the work;
//   (b) abandon deleted a repository sandbox holding a commit the target never
//       received;
//   (c) abandon must never delete an untracked target file the change did not
//       declare and apply.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  statSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { createAbandonRuntime } from "../runtime/workflow/abandon-runtime.mjs";
import { createApplyRuntime } from "../runtime/workflow/apply-runtime.mjs";
import { captureCopyBase, fileSource } from "../runtime/workflow/copy-base.mjs";
import { advanceFailureAction } from "../runtime/workflow/advance-runtime.mjs";
import {
  createLandJournal, transactionJournals
} from "../runtime/workflow/land-journal.mjs";
import {
  LAND_PROJECTION_MISSING, REPOSITORY_POINTER_CHANGE, ROOT_POINTER_MOVED, assertLandedProjection,
  landedProjectionFindings, repositoryPointerStop, rootPointerMoves
} from "../runtime/workflow/land-verification.mjs";
import { createSandboxCleanup } from "../runtime/workflow/sandbox-cleanup.mjs";
import { assessSandbox, guardSandboxRemoval } from "../runtime/workflow/sandbox-preservation.mjs";

const ID = "hook-change";
const SUBMODULE = "services/hook/sub";

function git(args, cwd) {
  const result = spawnSync("git", [
    "-c", "user.name=Foundation Test", "-c", "user.email=foundation@example.invalid",
    "-c", "protocol.file.allow=always", "-c", "init.defaultBranch=main",
    "-c", "commit.gpgsign=false", ...args
  ], { cwd, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`);
  return result.stdout.trim();
}

function tryGit(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// A superproject with one registered submodule and the two sandboxes the
// harness creates for a change selecting it: the shared control-plane worktree
// (where the submodule is an empty gitlink placeholder) and the submodule's own
// repository worktree.
function superproject(t, { files = {} } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "foundation-data-loss-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const upstream = join(base, "sub-upstream");
  mkdirSync(upstream);
  git(["init", "-q"], upstream);
  write(join(upstream, "handler.go"), "package hook\n");
  // The submodule's own ignore rules. `tracked.counter` was committed before
  // `*.counter` was ignored, so it is tracked content all the same.
  write(join(upstream, "tracked.counter"), "0\n");
  write(join(upstream, ".gitignore"), "*.counter\n.autoharness-counter\n");
  git(["add", "-f", "."], upstream);
  git(["commit", "-qm", "sub base"], upstream);

  const root = join(base, "parent");
  mkdirSync(root);
  git(["init", "-q"], root);
  write(join(root, "README.md"), "parent\n");
  write(join(root, ".gitignore"), ".foundation/\n.root-counter\n");
  for (const [path, content] of Object.entries(files)) write(join(root, path), content);
  git(["submodule", "add", "-q", upstream, SUBMODULE], root);
  git(["add", "."], root);
  git(["commit", "-qm", "parent base"], root);

  const target = join(root, SUBMODULE);
  const rootBase = git(["rev-parse", "HEAD"], root);
  const subBase = git(["rev-parse", "HEAD"], target);
  const shared = join(root, ".foundation", "sandboxes", ID);
  mkdirSync(dirname(shared), { recursive: true });
  git(["worktree", "add", "-q", "--detach", shared, rootBase], root);
  const repository = join(root, ".foundation", "repository-sandboxes", ID, "sub");
  mkdirSync(dirname(repository), { recursive: true });
  git(["worktree", "add", "-q", "--detach", repository, subBase], target);

  const state = {
    id: ID,
    status: "proven",
    workspace: { mode: "worktree", path: shared, baseHead: rootBase },
    repositories: {
      root: { mode: "worktree", path: shared, targetPath: root, baseHead: rootBase,
        access: "write" },
      sub: { mode: "worktree", path: repository, targetPath: target, baseHead: subBase,
        access: "write", applied: false }
    }
  };
  return { base, root, target, shared, repository, rootBase, subBase, state };
}

// The reported change: 681 lines committed inside the repository sandbox, plus
// an uncommitted edit and an untracked file the agent had not committed yet.
function buildInRepositorySandbox(fixture) {
  const lines = Array.from({ length: 681 }, (_, index) => `// line ${index + 1}`).join("\n");
  write(join(fixture.repository, "dispatch.go"), `package hook\n${lines}\n`);
  git(["add", "dispatch.go"], fixture.repository);
  git(["commit", "-qm", "dispatch rewrite"], fixture.repository);
  write(join(fixture.repository, "handler.go"), "package hook\n// edited\n");
  write(join(fixture.repository, "notes/retry.md"), "untracked agent note\n");
  return git(["rev-parse", "HEAD"], fixture.repository);
}

function failCapture(message, code, details) {
  const error = new Error(message);
  error.exitCode = code;
  Object.assign(error, details);
  throw error;
}

function backupsOf(root) {
  const directory = join(root, ".foundation", "backups", ID);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).map((stamp) => join(directory, stamp));
}

test("(a) Land cannot report success while the submodule target lacks the proven work", (t) => {
  const fixture = superproject(t);
  buildInRepositorySandbox(fixture);
  // Exactly the reported state: the delivery record claims success, the target
  // submodule is still at its base commit with nothing applied.
  fixture.state.repositories.sub.delivery = { status: "applied-uncommitted",
    transactionId: "repo-sub-1" };
  assert.equal(git(["rev-parse", "HEAD"], fixture.target), fixture.subBase);
  assert.equal(existsSync(join(fixture.target, "dispatch.go")), false);

  const findings = landedProjectionFindings({ root: fixture.root, id: ID, state: fixture.state });
  assert.deepEqual(findings.map(({ repositoryId, reason }) => [repositoryId, reason]),
    [["sub", "not-landed"]]);
  assert.deepEqual(findings[0].paths, ["dispatch.go", "handler.go", "notes/retry.md"]);
  assert.throws(() => assertLandedProjection({
    root: fixture.root, id: ID, state: fixture.state,
    fail: failCapture
  }), (error) => error.code === LAND_PROJECTION_MISSING &&
    error.boundary === "land-verification" &&
    /sub: the proven sandbox content is not in the target checkout: dispatch\.go/.test(error.message) &&
    /no sandbox was removed/.test(error.message) &&
    new RegExp(`advance ${ID} --through archived`).test(error.message));

  // Archive cleanup of that state keeps every sandbox: nothing verified landed.
  const cleanup = createSandboxCleanup({ root: fixture.root, canonicalPath: realpathSync,
    git: (args, cwd) => tryGit(args, cwd), now: () => "2026-10-07T00:00:00.000Z" });
  const archived = { ...fixture.state, status: "archived" };
  const repositoryResult = cleanup.cleanupRepositorySandboxes(ID, archived).sub;
  assert.equal(repositoryResult.status, "refused");
  assert.match(repositoryResult.reason, /target does not hold 3 sandbox path\(s\)/);
  assert.equal(existsSync(join(fixture.repository, "dispatch.go")), true);
});

test("(a) work written into the shared sandbox's empty submodule placeholder never lands silently", (t) => {
  const fixture = superproject(t);
  // The shared sandbox holds the submodule only as an empty gitlink directory.
  assert.deepEqual(readdirSync(join(fixture.shared, SUBMODULE)), []);
  write(join(fixture.shared, SUBMODULE, "dispatch.go"), "package hook\n// lost\n");
  const findings = landedProjectionFindings({ root: fixture.root, id: ID, state: fixture.state });
  assert.deepEqual(findings.map(({ repositoryId, reason, paths }) => [repositoryId, reason, paths]),
    [["root", "placeholder", [`${SUBMODULE}/dispatch.go`]]]);

  const cleanup = createSandboxCleanup({ root: fixture.root, canonicalPath: realpathSync,
    git: (args, cwd) => tryGit(args, cwd), now: () => "2026-10-07T00:00:00.000Z" });
  const result = cleanup.cleanupAppliedSandbox(ID, { ...fixture.state, status: "archived" });
  assert.equal(result.status, "refused");
  assert.equal(existsSync(join(fixture.shared, SUBMODULE, "dispatch.go")), true);
});

// A tool that rewrites a git-ignored counter on every run, in the target and in
// every sandbox, left Land reporting it as unlanded work and refusing cleanup.
// Each repository's own ignore rules decide; tracked content stays compared.
test("(a) git-ignored files are never unlanded work, under each repository's own rules", (t) => {
  const fixture = superproject(t);
  buildInRepositorySandbox(fixture);
  for (const path of ["dispatch.go", "handler.go", "notes/retry.md"])
    write(join(fixture.target, path), readFileSync(join(fixture.repository, path)));
  let run = 0;
  const tool = () => {
    run += 1;
    write(join(fixture.target, ".autoharness-counter"), `${run}\n`);
    write(join(fixture.repository, ".autoharness-counter"), `${run + 100}\n`);
    write(join(fixture.repository, "cache/run.counter"), `${run}\n`);
    write(join(fixture.shared, SUBMODULE, ".autoharness-counter"), `${run + 200}\n`);
    write(join(fixture.root, ".root-counter"), `${run}\n`);
    write(join(fixture.shared, ".root-counter"), `${run + 300}\n`);
  };
  tool();
  tool();
  assert.deepEqual(landedProjectionFindings({ root: fixture.root, id: ID, state: fixture.state }),
    []);
  const cleanup = createSandboxCleanup({ root: fixture.root, canonicalPath: realpathSync,
    git: (args, cwd) => tryGit(args, cwd), now: () => "2026-10-07T00:00:00.000Z" });
  assert.equal(cleanup.cleanupRepositorySandboxes(ID,
    { ...fixture.state, status: "archived" }).sub.status, "removed");

  // A tracked file that also matches `*.counter` is content: still compared.
  const again = superproject(t);
  write(join(again.repository, "tracked.counter"), "1\n");
  write(join(again.shared, SUBMODULE, "tracked.counter"), "2\n");
  const findings = landedProjectionFindings({ root: again.root, id: ID, state: again.state });
  assert.deepEqual(findings.map(({ repositoryId, reason, paths }) => [repositoryId, reason, paths]),
    [["root", "placeholder", [`${SUBMODULE}/tracked.counter`]],
      ["sub", "not-landed", ["tracked.counter"]]]);
});

test("(a) a plain-copy sandbox compares only what its target repository does not ignore", (t) => {
  const fixture = superproject(t);
  const copy = join(fixture.base, "copy-sandbox");
  for (const path of ["handler.go", "tracked.counter", ".gitignore"])
    write(join(copy, path), readFileSync(join(fixture.target, path)));
  write(join(copy, ".autoharness-counter"), "sandbox run\n");
  write(join(copy, "logs/tool.counter"), "sandbox run\n");
  write(join(fixture.target, ".autoharness-counter"), "target run\n");
  const descriptor = { repositoryId: "sub", label: "repository-sub", changeId: ID,
    kind: "repository", mode: "copy", access: "write", sandboxPath: copy,
    targetPath: fixture.target, baseHead: fixture.subBase, pathspec: ["."], nestedPaths: [] };
  const clean = assessSandbox(descriptor);
  assert.equal(clean.plain, true);
  assert.deepEqual(clean.unlanded, []);
  assert.equal(guardSandboxRemoval({ root: fixture.root, id: ID, descriptor,
    purpose: "archive", now: () => "2026-10-07T00:00:00.000Z" }).proceed, true);

  write(join(copy, "tracked.counter"), "edited\n");
  write(join(copy, "dispatch.go"), "package hook\n");
  assert.deepEqual(assessSandbox(descriptor).unlanded, ["dispatch.go", "tracked.counter"]);
});

test("(a) an uninitialized submodule target is a binding failure, not a landed repository", (t) => {
  const fixture = superproject(t);
  git(["submodule", "deinit", "-q", "-f", SUBMODULE], fixture.root);
  assert.deepEqual(readdirSync(fixture.target), []);
  const findings = landedProjectionFindings({ root: fixture.root, id: ID, state: fixture.state });
  assert.equal(findings[0].repositoryId, "sub");
  assert.equal(findings[0].reason, "target-binding");
  assert.match(findings[0].detail, /uninitialized submodule resolves to its superproject/);
});

// `land check` and Land's own preflight run this check before Apply: a broken
// binding or placeholder work stops with LAND_PROJECTION_MISSING before
// anything is written, while "not landed yet" is only meaningful after Apply.
test("(a) Land's preflight reports the binding and placeholder stops before Apply", (t) => {
  const fixture = superproject(t);
  buildInRepositorySandbox(fixture);
  assert.deepEqual(landedProjectionFindings({
    root: fixture.root, id: ID, state: fixture.state, preflight: true
  }), [], "unapplied work is not a preflight finding");
  assert.doesNotThrow(() => assertLandedProjection({
    root: fixture.root, id: ID, state: fixture.state, fail: failCapture, preflight: true
  }));

  write(join(fixture.shared, SUBMODULE, "dispatch.go"), "package hook\n// lost\n");
  git(["submodule", "deinit", "-q", "-f", SUBMODULE], fixture.root);
  assert.throws(() => assertLandedProjection({
    root: fixture.root, id: ID, state: fixture.state, fail: failCapture, preflight: true
  }), (error) => error.code === LAND_PROJECTION_MISSING &&
    error.boundary === "land-verification" &&
    /Land cannot deliver every selected repository; nothing was applied/.test(error.message) &&
    /sub: target .* uninitialized submodule/.test(error.message) &&
    new RegExp(`root: .*placeholder.*${SUBMODULE}/dispatch\\.go`).test(error.message) &&
    new RegExp(`advance ${ID} --through archived`).test(error.message));
});

test("(a) a landed projection verifies, and archive cleanup backs up unreachable commits before removal", (t) => {
  const fixture = superproject(t);
  const head = buildInRepositorySandbox(fixture);
  for (const path of ["dispatch.go", "handler.go", "notes/retry.md"])
    write(join(fixture.target, path), readFileSync(join(fixture.repository, path)));
  assert.deepEqual(landedProjectionFindings({ root: fixture.root, id: ID, state: fixture.state }),
    []);
  assert.doesNotThrow(() => assertLandedProjection({
    root: fixture.root, id: ID, state: fixture.state,
    fail: failCapture
  }));

  const cleanup = createSandboxCleanup({ root: fixture.root, canonicalPath: realpathSync,
    git: (args, cwd) => tryGit(args, cwd), now: () => "2026-10-07T00:00:00.000Z" });
  const result = cleanup.cleanupRepositorySandboxes(ID, { ...fixture.state, status: "archived" }).sub;
  assert.equal(result.status, "removed");
  assert.equal(existsSync(fixture.repository), false);
  // Uncommitted Land leaves the sandbox commit unreferenced; its history is kept.
  const bundle = join(fixture.root, result.backup, "commits.bundle");
  assert.equal(existsSync(bundle), true);
  git(["fetch", "-q", bundle, "HEAD"], fixture.target);
  assert.equal(git(["rev-parse", "FETCH_HEAD"], fixture.target), head);
});

function abandonFixture(fixture, state) {
  const paths = Object.fromEntries([
    "recovery", "logs", "runtime", "receipts", "evidenceVault", "transactions", "plans",
    "handoffs", "snapshots"
  ].map((name) => [name, join(fixture.root, ".foundation", name)]));
  paths.changes = join(fixture.root, "openspec", "changes");
  write(join(paths.changes, ID, "tasks.md"), "# Tasks\n");
  const readJson = (path, fallback) => existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8")) : fallback;
  const writeJson = (path, value) => write(path, `${JSON.stringify(value, null, 2)}\n`);
  const now = () => "2026-10-07T00:00:00.000Z";
  const journal = createLandJournal({
    root: fixture.root, transactions: paths.transactions,
    fileDigest: (path) => createHash("sha256").update(readFileSync(path)).digest("hex"),
    directoryHash: (path) => readdirSync(path).sort().join(","),
    pathInside: (parent, child) => child.startsWith(`${parent}/`),
    readJson, writeJson, now
  });
  const cleanup = createSandboxCleanup({ root: fixture.root, canonicalPath: realpathSync,
    git: (args, cwd) => tryGit(args, cwd), now });
  const output = [];
  const runtime = createAbandonRuntime({
    root: fixture.root, paths,
    loadRuntime: () => state,
    cleanupChangeLeases: () => {},
    cleanupAppliedSandbox: cleanup.cleanupAppliedSandbox,
    cleanupRepositorySandboxes: cleanup.cleanupRepositorySandboxes,
    transactionJournals: (id) => transactionJournals(paths.transactions, id, readJson),
    rollbackApplyTransaction: (value, reason) => journal.rollback(value, reason),
    readJson, writeJson, now,
    blockWithDecision: (_id, code) => { throw new Error(code); },
    fail: (message) => { throw new Error(message); }
  });
  return { runtime, journal, paths, output };
}

function quietly(operation) {
  const log = console.log;
  const error = console.error;
  const lines = [];
  console.log = (value) => lines.push(String(value));
  console.error = (value) => lines.push(String(value));
  try { operation(); } finally { console.log = log; console.error = error; }
  return lines.join("\n");
}

test("(b) abandon never destroys a sandbox commit the target never received", (t) => {
  const fixture = superproject(t);
  const head = buildInRepositorySandbox(fixture);
  write(join(fixture.shared, "docs/plan.md"), "shared sandbox work\n");
  const { runtime } = abandonFixture(fixture, fixture.state);
  const output = quietly(() => runtime.abandonChange(ID, {
    reason: "wrong approach", "decision-ref": "host://user/abandon", applied: "keep"
  }));
  assert.equal(existsSync(fixture.repository), false);
  const record = JSON.parse(readFileSync(join(fixture.root, ".foundation", "recovery",
    "abandoned", ID, "abandon.json"), "utf8"));
  assert.equal(record.repositoryCleanup.sub.status, "removed");
  const [stamp] = backupsOf(fixture.root);
  const repositoryBackup = join(stamp, "repository-sub");
  assert.match(output, new RegExp(`sandbox backup: \\.foundation/backups/${ID}/`));
  assert.deepEqual(record.sandboxBackups.sort(), [
    `.foundation/backups/${ID}/${stamp.split("/").at(-1)}/repository-sub`,
    `.foundation/backups/${ID}/${stamp.split("/").at(-1)}/root`
  ]);
  // The 681-line commit is recoverable from the bundle...
  git(["fetch", "-q", join(repositoryBackup, "commits.bundle"), "HEAD"], fixture.target);
  assert.equal(git(["rev-parse", "FETCH_HEAD"], fixture.target), head);
  assert.equal(git(["show", "FETCH_HEAD:dispatch.go"], fixture.target).split("\n").length, 682);
  // ...the uncommitted and untracked work from the patch and verbatim copies.
  assert.equal(readFileSync(join(repositoryBackup, "files", "handler.go"), "utf8"),
    "package hook\n// edited\n");
  assert.equal(readFileSync(join(repositoryBackup, "files", "notes/retry.md"), "utf8"),
    "untracked agent note\n");
  const patch = join(repositoryBackup, "changes.patch");
  assert.equal(tryGit(["apply", "--check", patch], fixture.target).status, 0);
  assert.equal(readFileSync(join(stamp, "root", "files", "docs/plan.md"), "utf8"),
    "shared sandbox work\n");
});

test("(b) a sandbox whose content cannot be verified is kept, not deleted", (t) => {
  const fixture = superproject(t);
  buildInRepositorySandbox(fixture);
  fixture.state.repositories.sub.baseHead = "0".repeat(40);
  const { runtime } = abandonFixture(fixture, fixture.state);
  const output = quietly(() => runtime.abandonChange(ID, {
    reason: "retire", "decision-ref": "host://user/abandon", applied: "keep"
  }));
  assert.equal(existsSync(join(fixture.repository, "dispatch.go")), true);
  assert.match(output, /repository 'sub' sandbox cleanup refused: cannot verify sandbox content/);
});

test("(c) abandon removes only paths the change owns and never untracked user files", (t) => {
  const fixture = superproject(t);
  buildInRepositorySandbox(fixture);
  // User files the change never declared or applied, in both repositories.
  write(join(fixture.root, "docs/defects/draft-defect-report.md"), "my draft\n");
  write(join(fixture.target, "scratch/todo.md"), "user scratch\n");
  // One path the change did apply to the root target through its journal.
  write(join(fixture.shared, "src/app.txt"), "applied by Land\n");
  const state = structuredClone(fixture.state);
  const { runtime, journal, paths } = abandonFixture(fixture, state);
  write(join(fixture.root, "src/app.txt"), "applied by Land\n");
  const entry = {
    path: "src/app.txt", role: "code", before: null, beforeMode: null,
    after: journal.pathIdentity(join(fixture.root, "src/app.txt")),
    afterMode: journal.pathMode(join(fixture.root, "src/app.txt")), backup: "backup/0"
  };
  journal.save({
    version: 1, changeId: ID, transactionId: "apply-1", status: "committed",
    sandboxPath: fixture.shared, entries: [entry], appliedPaths: ["src/app.txt"],
    inFlightPaths: []
  });
  state.workspace.applied = true;
  state.workspace.apply = { transactionId: "apply-1", touchedPaths: ["src/app.txt"] };
  quietly(() => runtime.abandonChange(ID, {
    reason: "retire", "decision-ref": "host://user/abandon", applied: "revert"
  }));
  assert.equal(existsSync(join(fixture.root, "src/app.txt")), false,
    "the journal-recorded path the change applied is reverted");
  assert.equal(readFileSync(join(fixture.root, "docs/defects/draft-defect-report.md"), "utf8"),
    "my draft\n");
  assert.equal(readFileSync(join(fixture.target, "scratch/todo.md"), "utf8"), "user scratch\n");
  assert.equal(readFileSync(join(fixture.root, "README.md"), "utf8"), "parent\n");
  assert.equal(git(["rev-parse", "HEAD"], fixture.target), fixture.subBase);
  // The packet is quarantined, not deleted; a second abandonment keeps the first.
  assert.equal(existsSync(join(paths.recovery, "abandoned", ID, "change", "tasks.md")), true);
  write(join(paths.changes, ID, "tasks.md"), "# Tasks v2\n");
  const second = { status: "change" };
  const { runtime: again } = abandonFixture(fixture, second);
  quietly(() => again.abandonChange(ID, {
    reason: "retire again", "decision-ref": "host://user/abandon-2"
  }));
  const quarantined = readdirSync(join(paths.recovery, "abandoned", ID));
  assert.ok(quarantined.some((name) => name.startsWith("change.previous-")),
    `an earlier quarantine is set aside, not deleted: ${quarantined.join(", ")}`);
});

// (d) A multi-repository Land that stopped after its first projection (a
// later check failed, a repair followed, or Deliver resumed it) must deliver
// work the root sandbox gained since, the same way repository sandboxes do.
function directoryDigest(path) {
  const hash = createHash("sha256");
  const walk = (directory, prefix) => {
    for (const name of readdirSync(directory).sort()) {
      const full = join(directory, name);
      const rel = `${prefix}${name}`;
      if (statSync(full).isDirectory()) { hash.update(`d:${rel}\n`); walk(full, `${rel}/`); }
      else hash.update(`f:${rel}:${createHash("sha256").update(readFileSync(full)).digest("hex")}\n`);
    }
  };
  walk(path, "");
  return hash.digest("hex");
}

const STOP_AFTER_APPLY = "stop-after-code-apply";

function landFixture(fixture, {
  selected = ["root", "sub"], workspace = null, workspaceManifest = undefined
} = {}) {
  const transactions = join(fixture.root, ".foundation", "transactions");
  const readJson = (path, fallback) => existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8")) : fallback;
  const writeJson = (path, value) => write(path, `${JSON.stringify(value, null, 2)}\n`);
  const now = () => "2026-10-07T00:00:00.000Z";
  const fileDigest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const pathInside = (parent, child) => child === parent || child.startsWith(`${parent}/`);
  const journal = createLandJournal({ root: fixture.root, transactions, fileDigest,
    directoryHash: directoryDigest, pathInside, readJson, writeJson, now });
  for (const workspace of [fixture.root, fixture.shared])
    write(join(workspace, "openspec", "changes", ID, "tasks.md"), "# Tasks\n");
  const proofPath = join(fixture.root, ".foundation", "proof", `${ID}.json`);
  writeJson(proofPath, { proofRunId: "proof-1" });
  const rows = {
    root: { id: "root", type: "root", mode: "write", path: fixture.root, relativePath: ".",
      dependsOn: [], workspacePath: fixture.shared },
    sub: { id: "sub", type: "submodule", mode: "write", path: fixture.target,
      relativePath: SUBMODULE, dependsOn: [], workspacePath: fixture.repository }
  };
  let state = structuredClone(fixture.state);
  if (workspace) state.workspace = structuredClone(workspace);
  state.workspace.changeSourceHash = directoryDigest(join(fixture.root, "openspec", "changes", ID));
  state.repositories = Object.fromEntries(selected.map((id) => [id, state.repositories[id]]));
  const loadRuntime = () => structuredClone(state);
  const runtime = createApplyRuntime({
    root: fixture.root, transactions, loadRuntime,
    saveRuntime: (value) => { state = structuredClone(value); },
    selectedRepositories: () => selected.map((id) => rows[id]),
    workspaceManifest,
    declaredSurfaceMatcher: () => () => true,
    currentChangeRelativePath: (id) => `openspec/changes/${id}`,
    changePath: (id) => join(fixture.root, "openspec", "changes", id),
    safeRootPath: journal.safeRootPath, pathIdentity: journal.pathIdentity,
    pathMode: journal.pathMode, directoryHash: directoryDigest, fileDigest, pathInside,
    applyTransactionRoot: journal.transactionRoot, copyPath: journal.copyPath,
    proofPath: () => proofPath, readJson, writeJson,
    stableHash: (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex"),
    syncClaudeTelemetry: () => {}, modelUsageRecorded: () => true,
    saveApplyJournal: journal.save, transactionJournalPath: journal.journalPath,
    verifyAppliedProjection: journal.verify, rollbackApplyTransaction: journal.rollback,
    applyTransactionEntry: journal.applyEntry, cleanupApplyTransaction: journal.cleanup,
    git: (args, cwd) => tryGit(args, cwd),
    gitBuffer: (args, cwd) => spawnSync("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 }),
    gitHead: (cwd) => {
      const head = tryGit(["rev-parse", "HEAD"], cwd);
      return head.status === 0 ? head.stdout.trim() : null;
    },
    recoverPendingApply: () => {},
    landCheck: () => ({ archived: false, state: loadRuntime(), hash: "workspace-hash",
      assurance: { status: "passed" } }),
    // The production composition: records and target must agree.
    assertMultiRepositoryArchiveReady: (id, value) => assertLandedProjection({
      root: fixture.root, id, state: value, fail: failCapture }),
    archiveCheckpoint: (name) => {
      if (name === "after-code-apply") throw new Error(STOP_AFTER_APPLY);
    },
    blockWithDecision: (_id, code, decision) => {
      const error = new Error(`${decision.summary} [${code}]`);
      Object.assign(error, { code, decision });
      throw error;
    },
    fail: failCapture,
    declaredRepositoryPaths: () => [SUBMODULE],
    now
  });
  return { runtime, state: () => structuredClone(state) };
}

function landUntilArchive(land) {
  let thrown = null;
  quietly(() => { try { land.runtime.archive(ID); } catch (error) { thrown = error; } });
  return thrown;
}

test("(d) root sandbox work after an earlier multi-repository Land is projected again", (t) => {
  const fixture = superproject(t);
  write(join(fixture.shared, "README.md"), "parent v1\n");
  write(join(fixture.repository, "handler.go"), "package hook\n// v1\n");
  const land = landFixture(fixture);
  assert.equal(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
  assert.equal(readFileSync(join(fixture.root, "README.md"), "utf8"), "parent v1\n");
  assert.equal(readFileSync(join(fixture.target, "handler.go"), "utf8"), "package hook\n// v1\n");

  // A repair after that first projection: committed and untracked root work,
  // and nothing new in the submodule repository.
  write(join(fixture.shared, "README.md"), "parent v2\n");
  git(["add", "README.md"], fixture.shared);
  git(["commit", "-qm", "repair"], fixture.shared);
  write(join(fixture.shared, "docs/later.md"), "follow-up\n");
  const second = landUntilArchive(land);
  assert.equal(second?.message, STOP_AFTER_APPLY,
    `root growth is landed, not stopped as missing: ${second?.message}`);
  assert.equal(readFileSync(join(fixture.root, "README.md"), "utf8"), "parent v2\n");
  assert.equal(readFileSync(join(fixture.root, "docs/later.md"), "utf8"), "follow-up\n");
  assert.equal(readFileSync(join(fixture.target, "handler.go"), "utf8"), "package hook\n// v1\n");
  assert.equal(git(["rev-parse", "HEAD"], fixture.root), fixture.rootBase);
  assert.equal(git(["diff", "--cached", "--name-only"], fixture.root), "");
  const record = land.state().repositories.root.delivery;
  assert.equal(record.status, "applied-uncommitted");
  assert.deepEqual(record.touchedPaths.filter((path) => !path.startsWith("openspec/")),
    ["README.md", "docs/later.md"]);
  assert.deepEqual(landedProjectionFindings({ root: fixture.root, id: ID, state: land.state() }),
    []);
  // A further pass has nothing new to project and still verifies.
  assert.equal(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
});

test("(d) root growth never overwrites a target edit made after the first Land", (t) => {
  const fixture = superproject(t);
  write(join(fixture.shared, "README.md"), "parent v1\n");
  write(join(fixture.repository, "handler.go"), "package hook\n// v1\n");
  const land = landFixture(fixture);
  assert.equal(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
  write(join(fixture.root, "notes.md"), "user notes\n");
  write(join(fixture.shared, "notes.md"), "sandbox notes\n");
  const stopped = landUntilArchive(land);
  assert.match(stopped?.message || "",
    /overwrite an uncommitted target (path|edit) in 'root': notes\.md/);
  assert.equal(readFileSync(join(fixture.root, "notes.md"), "utf8"), "user notes\n");
});

// Single-repository Land: a path the first apply never wrote is held to the
// same overwrite guard as root re-delivery of a composite change, and a
// conflicting target edit takes the target-edit route instead of being lost.
const GUIDE = "one\ntwo\nthree\nfour\nfive\n";

function landedOnce(t) {
  const fixture = superproject(t, { files: { "guide.md": GUIDE } });
  write(join(fixture.shared, "README.md"), "parent v1\n");
  const land = landFixture(fixture, { selected: ["root"] });
  assert.equal(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
  assert.equal(readFileSync(join(fixture.root, "README.md"), "utf8"), "parent v1\n");
  return { fixture, land };
}

test("(f) single-repository re-apply merges a target edit on a newly touched path, never overwrites it", (t) => {
  const { fixture, land } = landedOnce(t);
  write(join(fixture.root, "guide.md"), GUIDE.replace("one", "ONE (user)"));
  write(join(fixture.shared, "guide.md"), GUIDE.replace("five", "FIVE (change)"));
  const stopped = landUntilArchive(land);
  assert.equal(stopped?.code, "target-edit-sync", stopped?.message);
  assert.deepEqual(stopped.decision.paths, ["guide.md"]);
  assert.equal(readFileSync(join(fixture.root, "guide.md"), "utf8"),
    GUIDE.replace("one", "ONE (user)"), "the target edit is not overwritten");
  assert.ok(land.state().workspace.targetCarry?.["guide.md"], "the carry is recorded for sync");

  // The sandbox sync merges the recorded edit into the sandbox copy; the
  // merged, re-proven file then lands with both edits.
  const merged = GUIDE.replace("one", "ONE (user)").replace("five", "FIVE (change)");
  write(join(fixture.shared, "guide.md"), merged);
  assert.equal(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
  assert.equal(readFileSync(join(fixture.root, "guide.md"), "utf8"), merged);
  assert.equal(readFileSync(join(fixture.root, "README.md"), "utf8"), "parent v1\n");
});

test("(f) single-repository re-apply stops on a same-line or new-file target edit", (t) => {
  const { fixture, land } = landedOnce(t);
  write(join(fixture.root, "guide.md"), GUIDE.replace("three", "THREE (user)"));
  write(join(fixture.shared, "guide.md"), GUIDE.replace("three", "THREE (change)"));
  write(join(fixture.root, "notes.md"), "user notes\n");
  write(join(fixture.shared, "notes.md"), "sandbox notes\n");
  const stopped = landUntilArchive(land);
  assert.equal(stopped?.code, "target-edit-conflict", stopped?.message);
  assert.deepEqual(stopped.decision.paths, ["guide.md", "notes.md"]);
  assert.equal(readFileSync(join(fixture.root, "guide.md"), "utf8"),
    GUIDE.replace("three", "THREE (user)"));
  assert.equal(readFileSync(join(fixture.root, "notes.md"), "utf8"), "user notes\n");
});

test("(f) single-repository re-apply never drops a target mode edit on a newly touched path", (t) => {
  const { fixture, land } = landedOnce(t);
  // The user only marks the file executable; the sandbox changes its bytes.
  // The bytes are carried, the mode is not, so re-apply must not overwrite it.
  chmodSync(join(fixture.root, "guide.md"), 0o755);
  write(join(fixture.shared, "guide.md"), GUIDE.replace("two", "TWO (change)"));
  const stopped = landUntilArchive(land);
  assert.notEqual(stopped?.message, STOP_AFTER_APPLY, "re-apply stops instead of overwriting");
  assert.equal(statSync(join(fixture.root, "guide.md")).mode & 0o777, 0o755,
    "the user's mode edit survives");
  assert.equal(readFileSync(join(fixture.root, "guide.md"), "utf8"), GUIDE);
});

test("(f) single-repository re-apply lands a newly touched path still at base", (t) => {
  const { fixture, land } = landedOnce(t);
  write(join(fixture.shared, "guide.md"), GUIDE.replace("two", "TWO (change)"));
  write(join(fixture.shared, "docs/later.md"), "follow-up\n");
  assert.equal(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
  assert.equal(readFileSync(join(fixture.root, "guide.md"), "utf8"),
    GUIDE.replace("two", "TWO (change)"));
  assert.equal(readFileSync(join(fixture.root, "docs/later.md"), "utf8"), "follow-up\n");
});

test("(f) single-repository re-apply keeps re-delivering a path the first apply wrote", (t) => {
  const { fixture, land } = landedOnce(t);
  write(join(fixture.shared, "README.md"), "parent v2\n");
  assert.equal(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
  assert.equal(readFileSync(join(fixture.root, "README.md"), "utf8"), "parent v2\n");
  // A further pass has nothing new to project and still verifies.
  assert.equal(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
});

// The same re-apply guard for an isolated copy: its baseline manifest, the
// target identities recorded when the copy was made, is the base. A path the
// baseline does not record is held to the strictest rule (fail closed).
function copyManifest(directory) {
  const manifest = {};
  const walk = (path, prefix) => {
    for (const name of readdirSync(path).sort()) {
      if ([".git", ".foundation"].includes(name)) continue;
      const rel = `${prefix}${name}`;
      if (rel === "openspec/changes") continue;
      const full = join(path, name);
      const stats = statSync(full);
      if (stats.isDirectory()) { walk(full, `${rel}/`); continue; }
      manifest[rel] = `file:${stats.mode & 0o111 ? "executable" : "regular"}:${
        createHash("sha256").update(readFileSync(full)).digest("hex")}`;
    }
  };
  walk(directory, "");
  return manifest;
}

const COVERAGE = "coverage/report.txt";

function copyLandedOnce(t, { gitBase = true, captured = [] } = {}) {
  const fixture = superproject(t, { files: { "guide.md": GUIDE, [COVERAGE]: "covered 1\n" } });
  const copy = join(fixture.base, "copy-sandbox");
  for (const path of ["README.md", "guide.md", ".gitignore", COVERAGE])
    write(join(copy, path), readFileSync(join(fixture.root, path)));
  const workspace = { mode: "copy", path: copy, applied: false,
    baseHead: gitBase ? fixture.rootBase : null, git: gitBase ? "carried" : "absent",
    baseline: copyManifest(fixture.root), targetDirty: {} };
  // What the eager declared-surface capture stores when the copy is made.
  for (const path of captured)
    assert.equal(captureCopyBase({ root: fixture.root, baseline: workspace.baseline, path,
      sources: [fileSource(join(fixture.root, path))] }), true);
  write(join(copy, "README.md"), "parent v1\n");
  const copied = { ...fixture, shared: copy };
  const land = landFixture(copied, { selected: ["root"], workspace,
    workspaceManifest: (directory) => copyManifest(directory) });
  assert.equal(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
  assert.equal(readFileSync(join(fixture.root, "README.md"), "utf8"), "parent v1\n");
  return { fixture: copied, land };
}

for (const [label, options] of [
  ["the base commit", {}],
  ["captured base bytes", { gitBase: false, captured: ["guide.md"] }]
]) {
  test(`(g) copy-sandbox re-apply merges a clean target edit through the harness from ${label}`, (t) => {
    const { fixture, land } = copyLandedOnce(t, options);
    write(join(fixture.root, "guide.md"), GUIDE.replace("one", "ONE (user)"));
    write(join(fixture.shared, "guide.md"), GUIDE.replace("five", "FIVE (change)"));
    const stopped = landUntilArchive(land);
    assert.equal(stopped?.code, "target-edit-sync", stopped?.message);
    assert.deepEqual(stopped.decision.paths, ["guide.md"]);
    assert.ok(land.state().workspace.targetCarry?.["guide.md"], "the carry is recorded for sync");
    assert.equal(readFileSync(join(fixture.root, "guide.md"), "utf8"),
      GUIDE.replace("one", "ONE (user)"), "the target edit is not overwritten");

    // The agent edits the copy without merging the target edit: never landed.
    write(join(fixture.shared, "guide.md"), GUIDE.replace("five", "FIVE (change, again)"));
    assert.notEqual(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
    assert.equal(readFileSync(join(fixture.root, "guide.md"), "utf8"),
      GUIDE.replace("one", "ONE (user)"));

    // keep-target is provable: the merged copy lands with both edits.
    const merged = GUIDE.replace("one", "ONE (user)").replace("five", "FIVE (change)");
    write(join(fixture.shared, "guide.md"), merged);
    assert.equal(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
    assert.equal(readFileSync(join(fixture.root, "guide.md"), "utf8"), merged);
  });
}

test("(g) copy-sandbox restore-target restores the captured base bytes, and refuses without them", (t) => {
  const { fixture, land } = copyLandedOnce(t, { gitBase: false, captured: ["guide.md"] });
  write(join(fixture.root, "guide.md"), GUIDE.replace("three", "THREE (user)"));
  write(join(fixture.shared, "guide.md"), GUIDE.replace("three", "THREE (change)"));
  const stopped = landUntilArchive(land);
  assert.equal(stopped?.code, "target-edit-conflict", stopped?.message);
  assert.ok(stopped.decision.options.some((option) => option.id === "restore-target"));
  quietly(() => land.runtime.recordTargetRestore(ID, "guide.md", "user-decision-1"));
  assert.equal(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
  assert.equal(readFileSync(join(fixture.root, "guide.md"), "utf8"),
    GUIDE.replace("three", "THREE (change)"));

  // Neither side holds the base any more and nothing captured it: unprovable.
  const other = copyLandedOnce(t, { gitBase: false });
  write(join(other.fixture.root, "guide.md"), GUIDE.replace("three", "THREE (user)"));
  write(join(other.fixture.shared, "guide.md"), GUIDE.replace("three", "THREE (change)"));
  assert.throws(() => other.land.runtime.recordTargetRestore(ID, "guide.md", "user-decision-1"),
    /no recorded base bytes/);
});

test("(g) copy-sandbox re-apply restores a regenerated artifact from its captured base", (t) => {
  const { fixture, land } = copyLandedOnce(t, { gitBase: false, captured: [COVERAGE] });
  write(join(fixture.root, COVERAGE), "covered by a target test run\n");
  write(join(fixture.shared, COVERAGE), "covered 2\n");
  assert.equal(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
  assert.equal(readFileSync(join(fixture.root, COVERAGE), "utf8"), "covered 2\n");

  const other = copyLandedOnce(t, { gitBase: false });
  write(join(other.fixture.root, COVERAGE), "covered by a target test run\n");
  write(join(other.fixture.shared, COVERAGE), "covered 2\n");
  assert.notEqual(landUntilArchive(other.land)?.message, STOP_AFTER_APPLY,
    "without base bytes nothing is restored");
  assert.equal(readFileSync(join(other.fixture.root, COVERAGE), "utf8"),
    "covered by a target test run\n");
});

test("(g) copy-sandbox re-apply without a base commit stops on any target edit the baseline does not hold", (t) => {
  const { fixture, land } = copyLandedOnce(t, { gitBase: false });
  write(join(fixture.root, "guide.md"), GUIDE.replace("one", "ONE (user)"));
  write(join(fixture.shared, "guide.md"), GUIDE.replace("five", "FIVE (change)"));
  write(join(fixture.root, "notes.md"), "user notes\n");
  write(join(fixture.shared, "notes.md"), "sandbox notes\n");
  const stopped = landUntilArchive(land);
  assert.equal(stopped?.code, "target-edit-conflict", stopped?.message);
  assert.deepEqual(stopped.decision.paths, ["guide.md", "notes.md"]);
  assert.equal(readFileSync(join(fixture.root, "guide.md"), "utf8"),
    GUIDE.replace("one", "ONE (user)"));
  assert.equal(readFileSync(join(fixture.root, "notes.md"), "utf8"), "user notes\n");
});

test("(g) copy-sandbox re-apply lands a newly touched path still at the baseline", (t) => {
  const { fixture, land } = copyLandedOnce(t);
  write(join(fixture.shared, "guide.md"), GUIDE.replace("two", "TWO (change)"));
  write(join(fixture.shared, "docs/later.md"), "follow-up\n");
  assert.equal(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
  assert.equal(readFileSync(join(fixture.root, "guide.md"), "utf8"),
    GUIDE.replace("two", "TWO (change)"));
  assert.equal(readFileSync(join(fixture.root, "docs/later.md"), "utf8"), "follow-up\n");
});

test("(g) copy-sandbox re-apply keeps re-delivering a path the first apply wrote", (t) => {
  const { fixture, land } = copyLandedOnce(t);
  write(join(fixture.shared, "README.md"), "parent v2\n");
  assert.equal(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
  assert.equal(readFileSync(join(fixture.root, "README.md"), "utf8"), "parent v2\n");
  assert.equal(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
});

test("(g) copy-sandbox re-apply never drops a target mode edit on a newly touched path", (t) => {
  const { fixture, land } = copyLandedOnce(t);
  chmodSync(join(fixture.root, "guide.md"), 0o755);
  write(join(fixture.shared, "guide.md"), GUIDE.replace("two", "TWO (change)"));
  const stopped = landUntilArchive(land);
  assert.equal(stopped?.code, "target-edit-conflict", stopped?.message);
  assert.deepEqual(stopped.decision.paths, ["guide.md"]);
  assert.equal(statSync(join(fixture.root, "guide.md")).mode & 0o777, 0o755,
    "the user's mode edit survives");
  assert.equal(readFileSync(join(fixture.root, "guide.md"), "utf8"), GUIDE);
});

test("(e) a submodule pointer moved in a root-only change is a decision, never a silent drop", (t) => {
  const fixture = superproject(t);
  write(join(fixture.target, "next.go"), "package hook\n");
  git(["add", "next.go"], fixture.target);
  git(["commit", "-qm", "ahead"], fixture.target);
  const ahead = git(["rev-parse", "HEAD"], fixture.target);
  git(["reset", "-q", "--hard", fixture.subBase], fixture.target);
  write(join(fixture.shared, "README.md"), "parent bumped\n");
  git(["update-index", "--cacheinfo", `160000,${ahead},${SUBMODULE}`], fixture.shared);
  git(["commit", "-qam", "bump"], fixture.shared);
  const land = landFixture(fixture, { selected: ["root"] });

  const stopped = landUntilArchive(land);
  assert.equal(stopped?.code, REPOSITORY_POINTER_CHANGE, stopped?.message);
  assert.deepEqual(stopped.decision.moves, [{ path: SUBMODULE, from: fixture.subBase, to: ahead }]);
  assert.equal(stopped.decision.recommended, "deliver-through-repository");
  assert.ok(stopped.decision.options.some((option) => option.id === "pause"));
  assert.equal(readFileSync(join(fixture.root, "README.md"), "utf8"), "parent\n",
    "nothing is written before the decision");
  assert.equal(git(["ls-files", "-s", SUBMODULE], fixture.root).split(/\s+/)[1], fixture.subBase);

  // The restore-pointer outcome: the pointer returns to its base and the
  // remaining root work lands.
  git(["update-index", "--cacheinfo", `160000,${fixture.subBase},${SUBMODULE}`], fixture.shared);
  git(["commit", "-qm", "restore pointer"], fixture.shared);
  assert.equal(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
  assert.equal(readFileSync(join(fixture.root, "README.md"), "utf8"), "parent bumped\n");
});

test("(e) a pointer of a selected submodule is an agent repair route, not a user question", (t) => {
  const fixture = superproject(t);
  write(join(fixture.target, "next.go"), "package hook\n");
  git(["add", "next.go"], fixture.target);
  git(["commit", "-qm", "ahead"], fixture.target);
  const ahead = git(["rev-parse", "HEAD"], fixture.target);
  git(["reset", "-q", "--hard", fixture.subBase], fixture.target);
  write(join(fixture.shared, "README.md"), "parent bumped\n");
  git(["update-index", "--cacheinfo", `160000,${ahead},${SUBMODULE}`], fixture.shared);
  git(["commit", "-qam", "bump"], fixture.shared);
  const land = landFixture(fixture);

  const stopped = landUntilArchive(land);
  assert.equal(stopped?.code, ROOT_POINTER_MOVED, stopped?.message);
  assert.equal(stopped.owner, "agent");
  assert.equal(stopped.decision, undefined, "no user decision is raised");
  assert.match(stopped.message, new RegExp(`in ${fixture.repository} run 'git merge --ff-only ${ahead}'`));
  assert.match(stopped.message,
    new RegExp(`git update-index --cacheinfo 160000,${fixture.subBase},${SUBMODULE}`));
  assert.equal(readFileSync(join(fixture.root, "README.md"), "utf8"), "parent\n",
    "nothing is written before the repair");
  const route = advanceFailureAction(ID, stopped, { stage: "land" });
  assert.equal(route.action, "REPAIR");
  assert.equal(route.actor, "agent");
  assert.equal(route.decision ?? null, null);

  // The agent performs exactly the named steps, then Land resumes.
  git(["merge", "-q", "--ff-only", ahead], fixture.repository);
  git(["update-index", "--cacheinfo", `160000,${fixture.subBase},${SUBMODULE}`], fixture.shared);
  assert.equal(landUntilArchive(land)?.message, STOP_AFTER_APPLY);
  assert.equal(readFileSync(join(fixture.root, "README.md"), "utf8"), "parent bumped\n");
  assert.equal(readFileSync(join(fixture.target, "next.go"), "utf8"), "package hook\n");
  assert.equal(git(["rev-parse", "HEAD"], fixture.target), fixture.subBase);
});

test("(e) only a moved gitlink is a pointer change, not a removed placeholder", () => {
  const a = "a".repeat(40);
  const b = "b".repeat(40);
  const zero = "0".repeat(40);
  const raw = [
    `:160000 160000 ${a} ${b} M`, "services/a",
    `:160000 000000 ${a} ${zero} D`, "services/b",
    `:000000 160000 ${zero} ${b} A`, "services/c"
  ].join("\0") + "\0";
  assert.deepEqual(rootPointerMoves(raw), [
    { path: "services/a", from: a, to: b },
    { path: "services/c", from: null, to: b }
  ]);
  assert.deepEqual(rootPointerMoves(""), []);
  const stop = repositoryPointerStop({ changeId: ID, moves: rootPointerMoves(raw) });
  assert.equal(stop.code, REPOSITORY_POINTER_CHANGE);
  assert.deepEqual(stop.decision.options.map((option) => option.id),
    ["deliver-through-repository", "restore-pointer", "pause"]);
});
