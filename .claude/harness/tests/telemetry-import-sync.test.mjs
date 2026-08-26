import assert from "node:assert/strict";
import test from "node:test";
import {
  importTelemetryOperation,
  parseTelemetryImportRows,
  syncClaudeTelemetryOperation,
  syncClaudeTelemetrySource,
  validateTelemetryImportRows
} from "../runtime/observability/telemetry-runtime.mjs";

const fail = (message) => { throw new Error(message); };

test("telemetry import parser accepts JSON objects, arrays, and partial JSONL", () => {
  assert.deepEqual(parseTelemetryImportRows({ fail }, "rows.json", '{"id":1}'), [{ id: 1 }]);
  assert.deepEqual(parseTelemetryImportRows({ fail }, "rows.json", '[{"id":1}]'), [{ id: 1 }]);
  const warnings = [];
  assert.deepEqual(parseTelemetryImportRows({
    fail,
    output: { error: (message) => warnings.push(message) }
  }, "rows.jsonl", '{"id":1}\nbroken\n{"id":2}\n'), [{ id: 1 }, { id: 2 }]);
  assert.match(warnings[0], /skipped 1 unparseable telemetry line/);
  assert.throws(() => parseTelemetryImportRows({ fail }, "bad.jsonl", "broken\nstill-broken"),
    /neither JSON nor JSONL/);
});

test("Claude import validation requires a measured assistant usage row", () => {
  assert.throws(() => validateTelemetryImportRows({ fail }, "claude", [{ type: "user" }]),
    /no assistant\.message\.usage records/);
  assert.doesNotThrow(() => validateTelemetryImportRows({ fail }, "claude", [{
    type: "assistant",
    message: { role: "assistant", usage: { input_tokens: 2 } }
  }]));
  assert.doesNotThrow(() => validateTelemetryImportRows({ fail }, "generic", []));
});

function importContext(overrides = {}) {
  return {
    parseFlags: () => ({ flags: {}, rest: ["events.json"] }),
    fail,
    resolvePath: (_cwd, source) => `/project/${source}`,
    cwd: () => "/project",
    pathExists: () => true,
    readFile: () => '[{"requestId":"r1"},{"requestId":"r2"}]',
    readJson: () => ({ workspaceHash: "hash" }),
    snapshotPath: () => "/snapshot.json",
    appendTelemetryRows: () => 1,
    runtimeSessionId: () => "runtime-session",
    output: { log: () => {}, error: () => {} },
    ...overrides
  };
}

test("telemetry import validates CLI input before reading the source", () => {
  assert.throws(() => importTelemetryOperation(importContext({
    parseFlags: () => ({ flags: {}, rest: [] })
  }), "change", []), /requires a JSON or JSONL file/);
  assert.throws(() => importTelemetryOperation(importContext({
    parseFlags: () => ({ flags: { format: "unknown" }, rest: ["events.json"] })
  }), "change", []), /generic\|codex\|cursor\|otel\|claude/);
  assert.throws(() => importTelemetryOperation(importContext({
    pathExists: () => false
  }), "change", []), /source not found: events.json/);
});

test("Codex import binds snapshot and runtime session and reports skipped rows", () => {
  const calls = [];
  const logs = [];
  importTelemetryOperation(importContext({
    parseFlags: () => ({ flags: { format: "codex" }, rest: ["events.json"] }),
    appendTelemetryRows: (...args) => { calls.push(args); return 1; },
    output: { log: (message) => logs.push(message), error: assert.fail }
  }), "change", []);
  assert.equal(calls[0][0], "change");
  assert.equal(calls[0][1].length, 2);
  assert.equal(calls[0][2], "codex");
  assert.deepEqual(calls[0][3], {
    snapshot: { workspaceHash: "hash" },
    sessionId: "runtime-session"
  });
  assert.equal(logs[0], "TELEMETRY change: imported 1; skipped 1");
});

function syncContext(overrides = {}) {
  const session = { operationId: "prove", sources: {} };
  return {
    loadRuntime: () => ({}),
    claudeHostContext: () => ({ sessionId: "session", transcriptPath: "/main.jsonl" }),
    bindClaudeSession: () => ({ cursors: { sessions: {} }, session }),
    readJson: () => ({ workspaceHash: "hash" }),
    snapshotPath: () => "/snapshot.json",
    collectClaudeSources: () => ["/main.jsonl", "/agent-worker.jsonl"],
    sourceKey: (path) => path,
    sourceReadOffset: (_path, source) => source.offset,
    readCompleteJsonLines: () => ({ rows: [{ keep: true }, { keep: false }], nextOffset: 12 }),
    sourceCursor: (path, offset) => ({ path, offset, identity: true }),
    belongsToThisProject: (row) => row.keep,
    appendTelemetryRows: () => 1,
    saveClaudeCursors: () => {},
    now: () => "2026-08-26T00:00:00.000Z",
    fail,
    basename: (path) => path.split("/").at(-1),
    output: { log: () => {}, error: () => {} },
    ...overrides
  };
}

test("Claude sync handles unavailable and quiet hosts without binding", () => {
  const logs = [];
  const context = syncContext({
    claudeHostContext: () => null,
    bindClaudeSession: assert.fail,
    output: { log: (message) => logs.push(message), error: assert.fail }
  });
  assert.deepEqual(syncClaudeTelemetryOperation(context, "change"), { imported: 0, scanned: 0 });
  assert.match(logs[0], /transcript unavailable; imported 0/);
  logs.length = 0;
  assert.deepEqual(syncClaudeTelemetryOperation(context, "change", { quiet: true }),
    { imported: 0, scanned: 0 });
  assert.deepEqual(logs, []);
});

test("Claude sync imports orchestrator and subagent rows and advances cursors", () => {
  const appends = [];
  const saves = [];
  const logs = [];
  const context = syncContext({
    appendTelemetryRows: (...args) => { appends.push(args); return 1; },
    saveClaudeCursors: (...args) => saves.push(args),
    output: { log: (message) => logs.push(message), error: assert.fail }
  });
  assert.deepEqual(syncClaudeTelemetryOperation(context, "change", { operationId: "build" }),
    { imported: 2, scanned: 4 });
  assert.equal(appends[0][3].agentId, "orchestrator");
  assert.equal(appends[1][3].agentId, "worker");
  assert.deepEqual(appends[0][1], [{ keep: true }]);
  assert.equal(saves.length, 1);
  assert.match(logs[0], /imported 2; scanned 4; source claude-transcript/);
});

test("quiet Claude sync skips an unreadable source while normal sync fails", () => {
  const warnings = [];
  const context = syncContext({
    readCompleteJsonLines: () => { throw new Error("truncated cursor"); },
    output: { log: () => {}, error: (message) => warnings.push(message) }
  });
  const input = {
    id: "change",
    path: "/agent-worker.jsonl",
    host: { sessionId: "session", transcriptPath: "/main.jsonl" },
    session: { sources: {} },
    snapshot: {},
    options: { quiet: true }
  };
  assert.deepEqual(syncClaudeTelemetrySource(context, input), { imported: 0, scanned: 0 });
  assert.match(warnings[0], /skipped unreadable Claude transcript agent-worker\.jsonl/);
  assert.throws(() => syncClaudeTelemetrySource(context, {
    ...input,
    options: { quiet: false }
  }), /truncated cursor/);
});
