// Land keeps a user's uncommitted target edits and owns two routes around
// them: an edit on other lines than the change is merged into the sandbox by
// the harness and proved again (only same-line edits are a decision), and an
// archived Land whose diff is still uncommitted is undone through `advance`.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "..", "..", "..");

function project(t) {
  const root = mkdtempSync(join(tmpdir(), "land-carry-undo-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
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
    '  if [ -n "${FIXTURE_ARCHIVE_FAILS:-}" ]; then echo "archive unavailable" >&2; exit 1; fi',
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
      CLAUDE_FOUNDATION_PROJECT: projectValue.root,
      FIXTURE_ARCHIVE_FAILS: projectValue.archiveFails ? "1" : ""
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

// Fixture evidence is recorded receipts, so "prove again" is recording them
// against the replayed sandbox and resuming the same Land route.
function reprove(fixture, id, file) {
  cli(fixture, "receipt", id, "test", "pass",
    "--observed", "fixture test evidence", "--source", "harness-test", "--artifact", file);
  cli(fixture, "receipt", id, "discovery", "pass",
    "--discovered", "1", "--minimum", "1", "--observed", "1 test discovered",
    "--source", "harness-test", "--artifact", file);
}

function landed(fixture, id) {
  const result = cli(fixture, "advance", id, "--through", "archived");
  const value = JSON.parse(result.stdout);
  return { ...value, status: result.status, stderr: result.stderr };
}

function head(fixture) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
}

function archivedPackets(fixture) {
  return readdirSync(join(fixture.root, "openspec", "changes", "archive")).sort();
}

// A user's uncommitted target edit on other lines than the change is merged
// by the harness into the sandbox copy and proved again; only same-line edits
// become a decision. The target keeps the user's bytes until Land applies.
test("a user's target edit on other lines is merged into the change and lands", (t) => {
  const fixture = project(t);
  const base = head(fixture);
  const change = provenEdit(fixture, "Carry probe", "carry-probe", "app.txt",
    editedLine(fixture, "app.txt", 18, "change edit"));
  const userContent = editedLine(fixture, "app.txt", 2, "user edit");
  writeFileSync(join(fixture.root, "app.txt"), userContent);

  const carried = landed(fixture, "carry-probe");
  assert.notEqual(carried.action, "DONE");
  assert.doesNotMatch(JSON.stringify(carried), /target-edit-conflict|restore-target/,
    "a non-overlapping user edit is not a question");
  const merged = userContent.split("\n");
  merged[17] = "change edit";
  assert.equal(readFileSync(join(change.workspace.path, "app.txt"), "utf8"), merged.join("\n"),
    "the harness merged the user's edit into the sandbox copy");
  assert.equal(readFileSync(join(fixture.root, "app.txt"), "utf8"), userContent,
    "the target keeps the user's bytes until Land applies");

  reprove(fixture, "carry-probe", "app.txt");
  const done = landed(fixture, "carry-probe");
  assert.equal(done.action, "DONE", JSON.stringify(done));
  assert.equal(readFileSync(join(fixture.root, "app.txt"), "utf8"), merged.join("\n"));
  assert.equal(head(fixture), base, "Land never commits");
});

test("a user's same-line target edit stays a decision and is never merged or discarded", (t) => {
  const fixture = project(t);
  const change = provenEdit(fixture, "Clash probe", "clash-probe", "app.txt",
    editedLine(fixture, "app.txt", 2, "change edit"));
  const sandboxContent = readFileSync(join(change.workspace.path, "app.txt"), "utf8");
  const userContent = editedLine(fixture, "app.txt", 2, "user edit");
  writeFileSync(join(fixture.root, "app.txt"), userContent);

  const conflict = landed(fixture, "clash-probe");
  assert.equal(conflict.action, "REPAIR");
  assert.equal(conflict.legacyAction, "RECONCILE_TARGET_EDITS");
  assert.equal(conflict.decision.kind, "target-edit-conflict");
  assert.equal(conflict.decision.recommended, "keep-target");
  assert.deepEqual(conflict.paths, ["app.txt"]);
  assert.equal(readFileSync(join(fixture.root, "app.txt"), "utf8"), userContent);
  assert.equal(readFileSync(join(change.workspace.path, "app.txt"), "utf8"), sandboxContent);
});

// A Land that applied but did not archive leaves its projection in the target.
// Sandbox work proven after it re-applies; a path that first apply never wrote
// and the user has since edited is merged into the sandbox, never overwritten.
test("re-apply after an interrupted Land merges a user's edit on a newly touched path", (t) => {
  const fixture = project(t);
  const base = head(fixture);
  const changed = editedLine(fixture, "app.txt", 18, "change edit");
  const change = provenEdit(fixture, "Reapply probe", "reapply-probe", "app.txt", changed);
  fixture.archiveFails = true;
  const interrupted = landed(fixture, "reapply-probe");
  fixture.archiveFails = false;
  assert.notEqual(interrupted.action, "DONE", JSON.stringify(interrupted));
  assert.equal(readFileSync(join(fixture.root, "app.txt"), "utf8"), changed,
    "the first apply projected the change");
  const runtime = JSON.parse(readFileSync(
    join(fixture.root, ".foundation", "runtime", "reapply-probe.json"), "utf8"));
  assert.equal(runtime.workspace.applied, true, JSON.stringify(interrupted));

  // The user edits lib.txt in the target; a repair then touches it in the sandbox.
  writeFileSync(join(fixture.root, "lib.txt"), "user top\nlib base\n");
  writeFileSync(join(change.workspace.path, "lib.txt"), "lib base\nchange bottom\n");
  reprove(fixture, "reapply-probe", "lib.txt");
  const carried = landed(fixture, "reapply-probe");
  assert.notEqual(carried.action, "DONE", JSON.stringify(carried));
  assert.doesNotMatch(JSON.stringify(carried), /target-edit-conflict|restore-target/,
    "a non-overlapping user edit is not a question");
  assert.equal(readFileSync(join(fixture.root, "lib.txt"), "utf8"), "user top\nlib base\n",
    "the user's edit is not overwritten");
  assert.equal(readFileSync(join(change.workspace.path, "lib.txt"), "utf8"),
    "user top\nlib base\nchange bottom\n", "the harness merged the user's edit into the sandbox");

  reprove(fixture, "reapply-probe", "lib.txt");
  const done = landed(fixture, "reapply-probe");
  assert.equal(done.action, "DONE", JSON.stringify(done));
  assert.equal(readFileSync(join(fixture.root, "lib.txt"), "utf8"),
    "user top\nlib base\nchange bottom\n");
  assert.equal(readFileSync(join(fixture.root, "app.txt"), "utf8"), changed);
  assert.equal(head(fixture), base, "Land never commits");
});

// Undo of an archived Land whose diff is still uncommitted goes through
// `advance`: the harness restores the pre-Land bytes from the Land journal and
// retires the change, preserving what it landed. No manual `git restore`.
function undo(fixture, id, ...extra) {
  return cli(fixture, "advance", id, "--undo-land", ...extra);
}

test("an archived, uncommitted Land is undone through advance and its landed bytes are kept", (t) => {
  const fixture = project(t);
  const base = head(fixture);
  const original = readFileSync(join(fixture.root, "app.txt"), "utf8");
  const changed = editedLine(fixture, "app.txt", 18, "change edit");
  provenEdit(fixture, "Undo probe", "undo-probe", "app.txt", changed);
  assert.equal(landed(fixture, "undo-probe").action, "DONE");
  assert.equal(readFileSync(join(fixture.root, "app.txt"), "utf8"), changed);

  const undecided = undo(fixture, "undo-probe");
  assert.notEqual(undecided.status, 0);
  assert.match(undecided.stderr, /--decision-ref <user-decision>/);
  assert.equal(readFileSync(join(fixture.root, "app.txt"), "utf8"), changed);

  const undone = undo(fixture, "undo-probe", "--decision-ref", "fixture://user-undoes");
  assert.equal(undone.status, 0, undone.stderr);
  assert.match(undone.stdout, /LAND UNDONE undo-probe/);
  assert.equal(readFileSync(join(fixture.root, "app.txt"), "utf8"), original);
  assert.deepEqual(archivedPackets(fixture), [], "the archived packet is retired with the change");
  const recovery = join(fixture.root, ".foundation", "recovery", "land-undone", "undo-probe");
  assert.equal(readFileSync(join(recovery, "landed", "app.txt"), "utf8"), changed,
    "the landed bytes are preserved, never discarded");
  assert(existsSync(join(recovery, "change")), "the archived packet is preserved");
  assert(existsSync(join(recovery, "runtime.json")));
  assert.equal(existsSync(join(fixture.root, ".foundation", "runtime", "undo-probe.json")), false);
  assert.equal(head(fixture), base, "undo never commits");
});

test("a repeated Land undo of the same id sets the earlier undo's evidence aside", (t) => {
  const fixture = project(t);
  const recovery = join(fixture.root, ".foundation", "recovery", "land-undone", "redo-probe");
  const first = editedLine(fixture, "app.txt", 18, "first edit");
  provenEdit(fixture, "Redo probe", "redo-probe", "app.txt", first);
  assert.equal(landed(fixture, "redo-probe").action, "DONE");
  const once = undo(fixture, "redo-probe", "--decision-ref", "fixture://first-undo");
  assert.equal(once.status, 0, once.stderr);

  const second = editedLine(fixture, "app.txt", 18, "second edit");
  provenEdit(fixture, "Redo probe", "redo-probe", "app.txt", second);
  assert.equal(landed(fixture, "redo-probe").action, "DONE");
  const twice = undo(fixture, "redo-probe", "--decision-ref", "fixture://second-undo");
  assert.equal(twice.status, 0, twice.stderr);

  assert.equal(readFileSync(join(recovery, "landed", "app.txt"), "utf8"), second);
  assert.match(readFileSync(join(recovery, "undo.json"), "utf8"), /fixture:\/\/second-undo/);
  const entries = readdirSync(recovery);
  const previous = (name) => entries.filter((entry) => entry.startsWith(`${name}.previous-`));
  for (const name of ["landed", "change", "runtime.json", "undo.json"])
    assert.equal(previous(name).length, 1, `${name} of the first undo is set aside: ${entries}`);
  assert.equal(readFileSync(join(recovery, previous("landed")[0], "app.txt"), "utf8"), first,
    "the first undo's landed bytes survive the second undo");
  assert.match(readFileSync(join(recovery, previous("undo.json")[0]), "utf8"),
    /fixture:\/\/first-undo/);
});

test("Land undo restores a user's edit that Land had carried, from the retained backup", (t) => {
  const fixture = project(t);
  provenEdit(fixture, "Undo carry probe", "undo-carry-probe", "app.txt",
    editedLine(fixture, "app.txt", 18, "change edit"));
  const userContent = editedLine(fixture, "app.txt", 2, "user edit");
  writeFileSync(join(fixture.root, "app.txt"), userContent);
  assert.notEqual(landed(fixture, "undo-carry-probe").action, "DONE");
  reprove(fixture, "undo-carry-probe", "app.txt");
  assert.equal(landed(fixture, "undo-carry-probe").action, "DONE");

  const undone = undo(fixture, "undo-carry-probe", "--decision-ref", "fixture://user-undoes");
  assert.equal(undone.status, 0, undone.stderr);
  assert.equal(readFileSync(join(fixture.root, "app.txt"), "utf8"), userContent,
    "the user's pre-Land edit is back, not the committed base");
});

test("Land undo refuses without writing when the target moved past Land", (t) => {
  const fixture = project(t);
  const changed = editedLine(fixture, "app.txt", 18, "change edit");
  provenEdit(fixture, "Edited probe", "edited-probe", "app.txt", changed);
  provenEdit(fixture, "Committed probe", "committed-probe", "lib.txt", "lib edit\n");
  assert.equal(landed(fixture, "edited-probe").action, "DONE");

  // A later user edit of a path Land wrote is never clobbered.
  const later = editedLine(fixture, "app.txt", 5, "later user edit");
  writeFileSync(join(fixture.root, "app.txt"), later);
  const edited = undo(fixture, "edited-probe", "--decision-ref", "fixture://user-undoes");
  assert.notEqual(edited.status, 0);
  assert.match(edited.stderr, /changed after Land at: app\.txt/);
  assert.match(edited.stderr, /Nothing was changed/);
  assert.equal(readFileSync(join(fixture.root, "app.txt"), "utf8"), later);
  assert.equal(JSON.parse(readFileSync(join(fixture.root, ".foundation", "runtime",
    "edited-probe.json"), "utf8")).status, "archived");

  // A committed Land is Git history, not an uncommitted projection.
  assert.equal(landed(fixture, "committed-probe").action, "DONE");
  execFileSync("git", ["add", "lib.txt"], { cwd: fixture.root });
  const staged = undo(fixture, "committed-probe", "--decision-ref", "fixture://user-undoes");
  assert.notEqual(staged.status, 0);
  assert.match(staged.stderr, /staged in the Git index: lib\.txt/);
  execFileSync("git", ["commit", "-qm", "user commits the landed diff"], { cwd: fixture.root });
  const committed = undo(fixture, "committed-probe", "--decision-ref", "fixture://user-undoes");
  assert.notEqual(committed.status, 0);
  assert.match(committed.stderr, /HEAD moved since Land/);
  assert.equal(readFileSync(join(fixture.root, "lib.txt"), "utf8"), "lib edit\n");
});
