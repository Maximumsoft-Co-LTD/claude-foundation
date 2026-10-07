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
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { createAbandonRuntime } from "../runtime/workflow/abandon-runtime.mjs";
import {
  createLandJournal, transactionJournals
} from "../runtime/workflow/land-journal.mjs";
import {
  LAND_PROJECTION_MISSING, assertLandedProjection, landedProjectionFindings
} from "../runtime/workflow/land-verification.mjs";
import { createSandboxCleanup } from "../runtime/workflow/sandbox-cleanup.mjs";

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
function superproject(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "foundation-data-loss-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const upstream = join(base, "sub-upstream");
  mkdirSync(upstream);
  git(["init", "-q"], upstream);
  write(join(upstream, "handler.go"), "package hook\n");
  git(["add", "."], upstream);
  git(["commit", "-qm", "sub base"], upstream);

  const root = join(base, "parent");
  mkdirSync(root);
  git(["init", "-q"], root);
  write(join(root, "README.md"), "parent\n");
  write(join(root, ".gitignore"), ".foundation/\n");
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

test("(a) an uninitialized submodule target is a binding failure, not a landed repository", (t) => {
  const fixture = superproject(t);
  git(["submodule", "deinit", "-q", "-f", SUBMODULE], fixture.root);
  assert.deepEqual(readdirSync(fixture.target), []);
  const findings = landedProjectionFindings({ root: fixture.root, id: ID, state: fixture.state });
  assert.equal(findings[0].repositoryId, "sub");
  assert.equal(findings[0].reason, "target-binding");
  assert.match(findings[0].detail, /uninitialized submodule resolves to its superproject/);
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
