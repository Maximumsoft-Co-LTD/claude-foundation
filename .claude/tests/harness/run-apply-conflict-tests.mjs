// Worktree apply refuses to overwrite uncommitted target edits.
//
// The defect this pins: `apply --check` validates the patch textually but
// application copies whole files, so two changes landed sequentially over the
// same file silently lost the first one's work — last writer wins. The apply
// must refuse and name the paths, exactly as the isolated-copy path does.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "..", "..", "..");

function project() {
  const root = mkdtempSync(join(tmpdir(), "apply-conflict-"));
  mkdirSync(join(root, ".claude"), { recursive: true });
  mkdirSync(join(root, "openspec"), { recursive: true });
  cpSync(join(SOURCE, ".claude", "harness"), join(root, ".claude", "harness"), { recursive: true });
  cpSync(join(SOURCE, ".claude", "commands"), join(root, ".claude", "commands"), { recursive: true });
  cpSync(join(SOURCE, "openspec", "schemas"), join(root, "openspec", "schemas"), { recursive: true });
  cpSync(join(SOURCE, "openspec", "config.yaml"), join(root, "openspec", "config.yaml"));
  // Long enough that edits to the top and the bottom sit in separate hunks:
  // the textual `apply --check` passes for both changes, and only the
  // whole-file copy semantics would clobber — the exact gap under test.
  const appLines = Array.from({ length: 20 }, (unused, i) => `app line ${i + 1}`);
  writeFileSync(join(root, "app.txt"), appLines.join("\n") + "\n");
  writeFileSync(join(root, "lib.txt"), "lib base\n");
  const bin = join(root, "stub-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "openspec"), [
    "#!/usr/bin/env sh",
    'if [ "${1:-}" = "--version" ]; then echo "1.7.0"; exit 0; fi',
    'if [ "${1:-}" = "archive" ]; then',
    '  mkdir -p "openspec/changes/archive"',
    '  mv "openspec/changes/$2" "openspec/changes/archive/$2"',
    '  echo "archived $2"',
    "  exit 0",
    "fi",
    "exit 0"
  ].join("\n"));
  chmodSync(join(bin, "openspec"), 0o755);
  execFileSync("git", ["init", "-q", "-b", "work"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Foundation Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "foundation@example.invalid"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return { root, bin };
}

function cli(projectValue, ...args) {
  return spawnSync("node", [join(projectValue.root, ".claude", "harness", "foundation.mjs"), ...args], {
    cwd: projectValue.root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${projectValue.bin}:${process.env.PATH}`,
      FOUNDATION_CLAUDE_TRANSCRIPT_PATH: "",
      FOUNDATION_CLAUDE_SESSION_ID: "",
      FOUNDATION_RUN_ID: "",
      FOUNDATION_SESSION_ID: "",
      CODEX_THREAD_ID: "",
      CLAUDE_FOUNDATION_PROJECT: projectValue.root
    }
  });
}

function editedLine(fixture, file, lineNumber, replacement) {
  const lines = readFileSync(join(fixture.root, file), "utf8").split("\n");
  lines[lineNumber - 1] = replacement;
  return lines.join("\n");
}

// A rapid change with a worktree sandbox whose named file gets `content`.
function provenEdit(fixture, title, id, file, content, prepare = () => {}) {
  cli(fixture, "new", title, "--rapid");
  cli(fixture, "resolve", id, "--impact", "low", "--coupling", "isolated");
  cli(fixture, "sandbox", "create", id);
  const runtime = JSON.parse(readFileSync(
    join(fixture.root, ".foundation", "runtime", `${id}.json`), "utf8"));
  assert.equal(runtime.workspace.mode, "worktree", "fixture expects a worktree sandbox");
  writeFileSync(join(runtime.workspace.path, file), content);
  prepare(join(runtime.workspace.path, file));
  const ledger = join(runtime.workspace.path, "openspec", "changes", id, "tasks.md");
  writeFileSync(ledger, readFileSync(ledger, "utf8").replaceAll("- [ ]", "- [x]"));
  cli(fixture, "receipt", id, "test", "pass",
    "--observed", "fixture test evidence", "--source", "harness-test", "--artifact", file);
  cli(fixture, "receipt", id, "discovery", "pass",
    "--discovered", "1", "--minimum", "1", "--observed", "1 test discovered",
    "--source", "harness-test", "--artifact", file);
  const proved = cli(fixture, "prove", id);
  assert.equal(proved.status, 0, proved.stderr);
  return runtime;
}

function provenCopyEdit(fixture, title, id, file, content) {
  cli(fixture, "new", title, "--rapid");
  cli(fixture, "resolve", id, "--impact", "low", "--coupling", "isolated");
  writeFileSync(join(fixture.root, "other-change.txt"), "uncommitted concurrent work\n");
  cli(fixture, "sandbox", "create", id);
  const runtime = JSON.parse(readFileSync(
    join(fixture.root, ".foundation", "runtime", `${id}.json`), "utf8"));
  assert.equal(runtime.workspace.mode, "copy", "dirty fixture expects an isolated copy");
  writeFileSync(join(runtime.workspace.path, file), content);
  const ledger = join(runtime.workspace.path, "openspec", "changes", id, "tasks.md");
  writeFileSync(ledger, readFileSync(ledger, "utf8").replaceAll("- [ ]", "- [x]"));
  cli(fixture, "receipt", id, "test", "pass",
    "--observed", "fixture test evidence", "--source", "harness-test", "--artifact", file);
  cli(fixture, "receipt", id, "discovery", "pass",
    "--discovered", "1", "--minimum", "1", "--observed", "1 test discovered",
    "--source", "harness-test", "--artifact", file);
  const proved = cli(fixture, "prove", id);
  assert.equal(proved.status, 0, proved.stderr);
  return runtime;
}

test("a second land over the same file refuses instead of overwriting", () => {
  const fixture = project();
  // Both sandboxes branch from the same clean base before anything lands, and
  // they edit opposite ends of the file so each patch checks cleanly alone.
  const firstContent = editedLine(fixture, "app.txt", 2, "first edit");
  const secondContent = editedLine(fixture, "app.txt", 18, "second edit");
  provenEdit(fixture, "First probe", "first-probe", "app.txt", firstContent);
  provenEdit(fixture, "Second probe", "second-probe", "app.txt", secondContent);
  const first = cli(fixture, "archive", "first-probe");
  assert.equal(first.status, 0, first.stderr);
  assert.equal(readFileSync(join(fixture.root, "app.txt"), "utf8"), firstContent);
  const second = cli(fixture, "archive", "second-probe");
  assert.notEqual(second.status, 0, "the clobbering land must refuse");
  assert.match(second.stderr, /apply would overwrite uncommitted target edits at: app\.txt/);
  assert.match(second.stderr, /target edits are kept and carried into the sandbox/);
  assert.doesNotMatch(second.stdout + second.stderr, /\bcommit\b/i, "Land never asks for a commit");
  assert.equal(readFileSync(join(fixture.root, "app.txt"), "utf8"), firstContent,
    "the refused land must leave the first land's work untouched");
});

// Keep-target: once the sandbox copy carries the target's uncommitted edit,
// applying it loses nothing, so Land applies it without anyone committing.
test("a sandbox copy that carries the target edit lands over it", () => {
  const fixture = project();
  const firstContent = editedLine(fixture, "app.txt", 2, "first edit");
  const secondContent = editedLine(fixture, "app.txt", 18, "second edit");
  provenEdit(fixture, "First probe", "first-probe", "app.txt", firstContent);
  const second = provenEdit(fixture, "Second probe", "second-probe", "app.txt", secondContent);
  assert.equal(cli(fixture, "archive", "first-probe").status, 0);
  assert.notEqual(cli(fixture, "sandbox", "apply", "second-probe").status, 0);
  const lines = firstContent.split("\n");
  lines[17] = "second edit";
  const merged = lines.join("\n");
  writeFileSync(join(second.workspace.path, "app.txt"), merged);
  const applied = cli(fixture, "sandbox", "apply", "second-probe");
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(readFileSync(join(fixture.root, "app.txt"), "utf8"), merged);
});

test("a land over a different file still passes beside uncommitted work", () => {
  const fixture = project();
  provenEdit(fixture, "First probe", "first-probe", "app.txt", "first edit\n");
  provenEdit(fixture, "Third probe", "third-probe", "lib.txt", "lib edit\n");
  const first = cli(fixture, "archive", "first-probe");
  assert.equal(first.status, 0, first.stderr);
  const third = cli(fixture, "archive", "third-probe");
  assert.equal(third.status, 0, third.stderr);
  assert.equal(readFileSync(join(fixture.root, "app.txt"), "utf8"), "first edit\n");
  assert.equal(readFileSync(join(fixture.root, "lib.txt"), "utf8"), "lib edit\n");
});

test("a byte-identical pre-applied file is accepted without weakening conflict guards", () => {
  const fixture = project();
  const desired = editedLine(fixture, "app.txt", 8, "already applied");
  provenEdit(fixture, "Pre-applied probe", "pre-applied-probe", "app.txt", desired);
  // Simulate a recovery or manual reconciliation that reached the exact
  // proven bytes before the archive transaction was recorded.
  writeFileSync(join(fixture.root, "app.txt"), desired);
  const applied = cli(fixture, "sandbox", "apply", "pre-applied-probe");
  assert.equal(applied.status, 0, applied.stderr);
  const state = JSON.parse(readFileSync(join(fixture.root,
    ".foundation", "runtime", "pre-applied-probe.json"), "utf8"));
  const journal = JSON.parse(readFileSync(join(fixture.root, ".foundation",
    "transactions", "pre-applied-probe", state.workspace.apply.transactionId,
    "journal.json"), "utf8"));
  assert(journal.entries.some((entry) => entry.path === "app.txt" &&
    entry.before === entry.after),
  "the already-equal file remains a no-op projection journal entry");
  rmSync(join(fixture.root, "app.txt"));
  const resumed = cli(fixture, "sandbox", "apply", "pre-applied-probe");
  assert.notEqual(resumed.status, 0);
  assert.match(resumed.stderr, /projection-mismatch:app\.txt/,
    "recovery must detect divergence of a pre-applied path");
});

test("an isolated copy accepts a target that already equals its desired bytes", () => {
  const fixture = project();
  const desired = editedLine(fixture, "app.txt", 9, "copy already applied");
  provenCopyEdit(fixture, "Copy pre-applied probe", "copy-pre-applied-probe",
    "app.txt", desired);
  writeFileSync(join(fixture.root, "app.txt"), desired);
  const applied = cli(fixture, "sandbox", "apply", "copy-pre-applied-probe");
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(readFileSync(join(fixture.root, "app.txt"), "utf8"), desired);
});

test("a mode-only executable change is applied", () => {
  const fixture = project();
  const content = readFileSync(join(fixture.root, "app.txt"), "utf8");
  provenEdit(fixture, "Executable probe", "executable-probe", "app.txt", content,
    (path) => chmodSync(path, 0o755));
  const archived = cli(fixture, "archive", "executable-probe");
  assert.equal(archived.status, 0, archived.stderr);
  assert.equal(statSync(join(fixture.root, "app.txt")).mode & 0o777, 0o755);
});

// R1: a test run in the main checkout rewrote a tracked `__pycache__/*.pyc`,
// Land's patch no longer applied, and the only offered fix was a Git command
// the Land guard blocks. Land now restores regenerable artifacts itself.
function trackedArtifactProject() {
  const fixture = project();
  mkdirSync(join(fixture.root, "__pycache__"), { recursive: true });
  writeFileSync(join(fixture.root, "__pycache__", "app.cpython-312.pyc"), Buffer.from([0, 1, 2, 3]));
  execFileSync("git", ["add", "-A"], { cwd: fixture.root });
  execFileSync("git", ["commit", "-qm", "tracked artifact"], { cwd: fixture.root });
  return fixture;
}

test("a regenerated tracked artifact on the target is restored by Land itself", () => {
  const fixture = trackedArtifactProject();
  const pyc = "__pycache__/app.cpython-312.pyc";
  const proven = Buffer.from([0, 9, 9, 9]);
  provenEdit(fixture, "Artifact probe", "artifact-probe", pyc, proven);
  // A test run in the main checkout after isolation.
  writeFileSync(join(fixture.root, pyc), Buffer.from([0, 7, 7, 7]));
  const applied = cli(fixture, "sandbox", "apply", "artifact-probe");
  assert.equal(applied.status, 0, applied.stderr);
  assert.doesNotMatch(applied.stderr, /--restore-target|git checkout/);
  assert.deepEqual(readFileSync(join(fixture.root, pyc)), proven);
});

test("a generated artifact already dirty at isolation is never restored without the user", () => {
  const fixture = trackedArtifactProject();
  const pyc = "__pycache__/app.cpython-312.pyc";
  const dirty = Buffer.from([0, 5, 5, 5]);
  writeFileSync(join(fixture.root, pyc), dirty);
  provenEdit(fixture, "Artifact probe", "artifact-probe", pyc, Buffer.from([0, 9, 9, 9]));
  writeFileSync(join(fixture.root, pyc), Buffer.from([0, 7, 7, 7]));
  const refused = cli(fixture, "sandbox", "apply", "artifact-probe");
  assert.notEqual(refused.status, 0);
  assert.match(refused.stdout, /"kind": "target-edit-conflict"/);
  assert.deepEqual(readFileSync(join(fixture.root, pyc)), Buffer.from([0, 7, 7, 7]));
});

test("restoring a non-generated target edit requires the user's decision", () => {
  const fixture = project();
  provenEdit(fixture, "Source probe", "source-probe", "lib.txt", "lib proven\n");
  writeFileSync(join(fixture.root, "lib.txt"), "user work\n");
  const refused = cli(fixture, "sandbox", "apply", "source-probe");
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /lib\.txt/);
  assert.match(refused.stdout, /"kind": "target-edit-conflict"/);
  assert.match(refused.stdout, /--restore-target lib\.txt --decision-ref <user-decision>/);
  const undecided = cli(fixture, "advance", "source-probe", "--restore-target", "lib.txt");
  assert.notEqual(undecided.status, 0);
  assert.match(undecided.stderr, /may be user work at: lib\.txt; ask the user/);
  assert.equal(readFileSync(join(fixture.root, "lib.txt"), "utf8"), "user work\n");
  const decided = cli(fixture, "advance", "source-probe", "--restore-target", "lib.txt",
    "--decision-ref", "fixture://user-discards");
  assert.equal(decided.status, 0, decided.stderr);
  const applied = cli(fixture, "sandbox", "apply", "source-probe");
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(readFileSync(join(fixture.root, "lib.txt"), "utf8"), "lib proven\n");
});
