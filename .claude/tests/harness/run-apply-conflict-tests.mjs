// Worktree apply refuses to overwrite uncommitted target edits.
//
// The defect this pins: `apply --check` validates the patch textually but
// application copies whole files, so two changes landed sequentially over the
// same file silently lost the first one's work — last writer wins. The apply
// must refuse and name the paths, exactly as the isolated-copy path does.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync
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
function provenEdit(fixture, title, id, file, content) {
  cli(fixture, "new", title, "--rapid");
  cli(fixture, "resolve", id, "--impact", "low", "--coupling", "isolated");
  cli(fixture, "sandbox", "create", id);
  const runtime = JSON.parse(readFileSync(
    join(fixture.root, ".foundation", "runtime", `${id}.json`), "utf8"));
  assert.equal(runtime.workspace.mode, "worktree", "fixture expects a worktree sandbox");
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
  assert.match(second.stderr, /commit or reconcile the landed work first/);
  assert.equal(readFileSync(join(fixture.root, "app.txt"), "utf8"), firstContent,
    "the refused land must leave the first land's work untouched");
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
