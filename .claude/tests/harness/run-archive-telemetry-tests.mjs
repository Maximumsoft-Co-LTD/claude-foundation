// Archive-time telemetry ingestion.
//
// The defect this pins: `telemetry sync` existed but nothing in the lifecycle
// called it, so changes were archived with empty cost columns unless someone
// remembered the manual command. Archive now drains the bound transcript once
// before the destructive step, warns when the record seals with no usage, and
// never lets telemetry cost the archive.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  statSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "..", "..", "..");

// Isolated consumer project: the harness under test, schemas, config, and a
// stub `openspec` binary so archive's destructive step stays local.
function project() {
  const root = mkdtempSync(join(tmpdir(), "archive-telemetry-"));
  mkdirSync(join(root, ".claude"), { recursive: true });
  mkdirSync(join(root, "openspec"), { recursive: true });
  cpSync(join(SOURCE, ".claude", "harness"), join(root, ".claude", "harness"), { recursive: true });
  cpSync(join(SOURCE, ".claude", "commands"), join(root, ".claude", "commands"), { recursive: true });
  cpSync(join(SOURCE, "openspec", "schemas"), join(root, "openspec", "schemas"), { recursive: true });
  cpSync(join(SOURCE, "openspec", "config.yaml"), join(root, "openspec", "config.yaml"));
  writeFileSync(join(root, "app.txt"), "initial\n");
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
  return { root, bin };
}

function cli(projectValue, env, ...args) {
  return execFileSync("node", [join(projectValue.root, ".claude", "harness", "foundation.mjs"), ...args], {
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
      ...env
    }
  });
}

// Same invocation, but with stderr and exit status visible for warnings.
function cliRaw(projectValue, env, ...args) {
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
      ...env
    }
  });
}

// new → resolve → sandbox → receipts → prove, ready for `land archive`.
function provenChange(projectValue, env = {}) {
  cli(projectValue, env, "new", "Telemetry probe", "--rapid");
  cli(projectValue, env, "resolve", "telemetry-probe", "--impact", "low", "--coupling", "isolated");
  cli(projectValue, env, "sandbox", "create", "telemetry-probe");
  const runtime = JSON.parse(readFileSync(
    join(projectValue.root, ".foundation", "runtime", "telemetry-probe.json"), "utf8"));
  const ledger = join(runtime.workspace.path, "openspec", "changes", "telemetry-probe", "tasks.md");
  writeFileSync(ledger, readFileSync(ledger, "utf8").replaceAll("- [ ]", "- [x]"));
  cli(projectValue, env, "receipt", "telemetry-probe", "test", "pass",
    "--observed", "fixture test evidence", "--source", "harness-test", "--artifact", "app.txt");
  cli(projectValue, env, "receipt", "telemetry-probe", "discovery", "pass",
    "--discovered", "1", "--minimum", "1", "--observed", "1 test discovered",
    "--source", "harness-test", "--artifact", "app.txt");
  cli(projectValue, env, "prove", "telemetry-probe");
}

test("archive without a bound transcript completes and warns once", () => {
  const fixture = project();
  provenChange(fixture);
  const result = cliRaw(fixture, {}, "archive", "telemetry-probe");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ARCHIVED telemetry-probe/);
  assert.match(result.stderr, /WARNING: no model usage was imported/);
  const events = join(fixture.root, ".foundation", "logs", "telemetry-probe", "events.jsonl");
  assert.ok(!existsSync(events) || statSync(events).size === 0);
});

test("archive drains the bound transcript into the change's events", () => {
  const fixture = project();
  const transcript = join(fixture.root, "transcript.jsonl");
  writeFileSync(transcript, "");
  const env = {
    FOUNDATION_CLAUDE_TRANSCRIPT_PATH: transcript,
    FOUNDATION_CLAUDE_SESSION_ID: "archive-telemetry-session"
  };
  provenChange(fixture, env);
  // Usage lands after the session bound its cursor: exactly the final segment
  // that used to be lost, and that archive must now drain.
  appendFileSync(transcript, JSON.stringify({
    type: "assistant", uuid: "row-1", timestamp: "2026-08-14T00:00:00Z",
    sessionId: "archive-telemetry-session",
    message: { role: "assistant", model: "claude-test",
      usage: { input_tokens: 11, output_tokens: 7 } }
  }) + "\n");
  const output = cli(fixture, env, "archive", "telemetry-probe");
  assert.match(output, /ARCHIVED telemetry-probe/);
  assert.match(output, /telemetry: measured/);
  assert.doesNotMatch(output, /telemetry: not-ingested/,
    "archive printed readiness before its final transcript drain");
  const events = join(fixture.root, ".foundation", "logs", "telemetry-probe", "events.jsonl");
  assert.ok(existsSync(events) && statSync(events).size > 0,
    "archive imported no telemetry rows");
});

test("an unreadable telemetry source never gates the archive", () => {
  const fixture = project();
  const env = {
    FOUNDATION_CLAUDE_TRANSCRIPT_PATH: join(fixture.root, "missing-transcript.jsonl"),
    FOUNDATION_CLAUDE_SESSION_ID: "archive-telemetry-session"
  };
  provenChange(fixture, env);
  const output = cli(fixture, env, "archive", "telemetry-probe");
  assert.match(output, /ARCHIVED telemetry-probe/);
});

test("a corrupt complete transcript line stays advisory during archive", () => {
  const fixture = project();
  const transcript = join(fixture.root, "transcript.jsonl");
  writeFileSync(transcript, "");
  const env = {
    FOUNDATION_CLAUDE_TRANSCRIPT_PATH: transcript,
    FOUNDATION_CLAUDE_SESSION_ID: "archive-corrupt-session"
  };
  provenChange(fixture, env);
  appendFileSync(transcript, "this is not json\n");
  const result = cliRaw(fixture, env, "archive", "telemetry-probe");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ARCHIVED telemetry-probe/);
  assert.match(result.stderr, /WARNING: skipped unreadable Claude transcript/);
});

test("explicit sync fails on corruption, preserves its cursor, and retries after repair", () => {
  const fixture = project();
  const transcript = join(fixture.root, "transcript.jsonl");
  writeFileSync(transcript, "");
  const env = {
    FOUNDATION_CLAUDE_TRANSCRIPT_PATH: transcript,
    FOUNDATION_CLAUDE_SESSION_ID: "explicit-corrupt-session"
  };
  provenChange(fixture, env);
  appendFileSync(transcript, "this is not json\n");
  const failed = cliRaw(fixture, env, "telemetry-sync", "telemetry-probe", transcript);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /invalid Claude transcript record/);
  const cursorPath = join(
    fixture.root, ".foundation", "logs", "telemetry-probe", "claude-cursors.json");
  const cursors = JSON.parse(readFileSync(cursorPath, "utf8"));
  const sources = Object.values(cursors.sessions["explicit-corrupt-session"].sources);
  assert.ok(sources.length > 0);
  assert.ok(sources.every((source) => source.offset === 0),
    `corrupt source cursor advanced: ${JSON.stringify(sources)}`);

  writeFileSync(transcript, JSON.stringify({
    type: "assistant", uuid: "repaired-row", timestamp: "2026-08-14T00:00:00Z",
    sessionId: "explicit-corrupt-session",
    message: { role: "assistant", model: "claude-test",
      usage: { input_tokens: 11, output_tokens: 7 } }
  }) + "\n");
  const retried = cliRaw(fixture, env, "telemetry-sync", "telemetry-probe", transcript);
  assert.equal(retried.status, 0, retried.stderr);
  assert.match(retried.stdout, /imported 1/);
});

test("sync resets a stale offset when a transcript is replaced at the same path", () => {
  const fixture = project();
  const transcript = join(fixture.root, "transcript.jsonl");
  writeFileSync(transcript, "");
  const env = {
    FOUNDATION_CLAUDE_TRANSCRIPT_PATH: transcript,
    FOUNDATION_CLAUDE_SESSION_ID: "rotated-transcript-session"
  };
  provenChange(fixture, env);
  const row = (uuid, input) => JSON.stringify({
    type: "assistant", uuid, timestamp: "2026-08-14T00:00:00Z",
    sessionId: "rotated-transcript-session",
    message: { role: "assistant", model: "claude-test",
      usage: { input_tokens: input, output_tokens: 7 } }
  }) + "\n";
  appendFileSync(transcript, row("before-rotation", 11));
  const first = cliRaw(fixture, env, "telemetry-sync", "telemetry-probe", transcript);
  assert.equal(first.status, 0, first.stderr);

  // Rewrite in place and keep the replacement larger than the saved offset.
  // Size-only cursor validation would begin in the middle of this new file.
  writeFileSync(transcript,
    row("after-rotation-1", 13) + row("after-rotation-2", 17));
  const rotated = cliRaw(fixture, env, "telemetry-sync", "telemetry-probe", transcript);
  assert.equal(rotated.status, 0, rotated.stderr);
  const eventsPath = join(
    fixture.root, ".foundation", "logs", "telemetry-probe", "events.jsonl");
  const requestIds = readFileSync(eventsPath, "utf8").trim().split("\n")
    .map((line) => JSON.parse(line).requestId);
  assert.ok(requestIds.includes("before-rotation"));
  assert.ok(requestIds.includes("after-rotation-1"));
  assert.ok(requestIds.includes("after-rotation-2"));

  // Upgrade safety: a cursor written before identity fields existed must also
  // re-scan safely rather than trust a path-only offset once more.
  const cursorPath = join(
    fixture.root, ".foundation", "logs", "telemetry-probe", "claude-cursors.json");
  const cursors = JSON.parse(readFileSync(cursorPath, "utf8"));
  for (const source of Object.values(cursors.sessions["rotated-transcript-session"].sources))
    for (const field of ["device", "inode", "anchorStart", "anchorHash"]) delete source[field];
  writeFileSync(cursorPath, JSON.stringify(cursors));
  writeFileSync(transcript, [
    row("legacy-rotation-1", 19), row("legacy-rotation-2", 23), row("legacy-rotation-3", 29)
  ].join(""));
  const legacy = cliRaw(fixture, env, "telemetry-sync", "telemetry-probe", transcript);
  assert.equal(legacy.status, 0, legacy.stderr);
  const afterLegacy = readFileSync(eventsPath, "utf8").trim().split("\n")
    .map((line) => JSON.parse(line).requestId);
  assert.ok(afterLegacy.includes("legacy-rotation-1"));
  assert.ok(afterLegacy.includes("legacy-rotation-2"));
  assert.ok(afterLegacy.includes("legacy-rotation-3"));
});

// The exit hook used to re-read runtime status at exit, and archive flips the
// status to "archived" mid-command — so the one command that finished a change
// was the only one missing from its own operations.jsonl.
test("a successful archive appends its own operation row", () => {
  const fixture = project();
  provenChange(fixture);
  const result = cliRaw(fixture, {}, "archive", "telemetry-probe");
  assert.equal(result.status, 0, result.stderr);
  const ops = join(fixture.root, ".foundation", "logs", "telemetry-probe", "operations.jsonl");
  const rows = readFileSync(ops, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const archiveRows = rows.filter((row) => row.operation === "archive");
  assert.equal(archiveRows.length, 1, "expected exactly one archive row");
  assert.equal(archiveRows[0].status, "completed");
});

test("a command against an already-archived change appends no operation row", () => {
  const fixture = project();
  provenChange(fixture);
  const result = cliRaw(fixture, {}, "archive", "telemetry-probe");
  assert.equal(result.status, 0, result.stderr);
  const ops = join(fixture.root, ".foundation", "logs", "telemetry-probe", "operations.jsonl");
  const before = readFileSync(ops, "utf8");
  cliRaw(fixture, {}, "archive", "telemetry-probe");
  const after = readFileSync(ops, "utf8");
  assert.equal(after, before, "archived change accumulated a new operation row");
});
