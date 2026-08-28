import assert from "node:assert/strict";
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  activeTelemetryRunId,
  appendTelemetryJsonLines,
  commandTelemetryEligible,
  commandTelemetryRow,
  commandTelemetryStatus,
  createTelemetryRuntime,
  normalizeTelemetryBatch,
  recordCommandTelemetry,
  rebindTelemetryWindow
} from "../runtime/observability/telemetry-runtime.mjs";

const readLines = (path) => existsSync(path)
  ? readFileSync(path, "utf8").split("\n").filter(Boolean).map(JSON.parse)
  : [];

function commandContext(overrides = {}) {
  return {
    telemetryDisabled: false,
    telemetryDebug: false,
    changeId: "change-a",
    operationName: "validate",
    operationPhase: "prove",
    operationStatusAtStart: "building",
    operationInputFingerprint: "sha256:input",
    publicOperation: null,
    blocked: false,
    operationStartedAt: Date.parse("2026-08-27T00:00:00.000Z"),
    readOnlyOperations: new Set(["metrics"]),
    logs: "/logs",
    mkdir: () => {},
    append: () => {},
    now: () => "2026-08-27T00:00:01.000Z",
    timestamp: () => Date.parse("2026-08-27T00:00:01.000Z"),
    warn: () => {},
    ...overrides
  };
}

test("command telemetry projects honest command outcomes and phase fallbacks", () => {
  assert.equal(commandTelemetryStatus(0, false), "completed");
  assert.equal(commandTelemetryStatus(2, true), "blocked");
  assert.equal(commandTelemetryStatus(1, false), "failed");
  const publicRow = commandTelemetryRow(commandContext({
    publicOperation: "proof-run", blocked: true
  }), 2);
  assert.equal(publicRow.phase, "proof-run");
  assert.equal(publicRow.status, "blocked");
  assert.equal(publicRow.kind, "lifecycle");
  assert.equal(publicRow.inputFingerprint, "sha256:input");
  assert.equal(publicRow.durationMs, 1_000);
  assert.equal(publicRow.measurement,
    "command-observed; model usage requires host telemetry ingestion");
  assert.equal(commandTelemetryRow(commandContext(), 0).phase, "prove");
  assert.equal(commandTelemetryRow(commandContext({ operationPhase: null }), 1).phase, null);
});

test("command telemetry eligibility excludes disabled, incomplete and archived work", () => {
  assert.equal(commandTelemetryEligible(commandContext()), true);
  assert.equal(commandTelemetryEligible(commandContext({ telemetryDisabled: true })), false);
  assert.equal(commandTelemetryEligible(commandContext({ changeId: null })), false);
  assert.equal(commandTelemetryEligible(commandContext({ operationName: null })), false);
  assert.equal(commandTelemetryEligible(commandContext({ operationName: "metrics" })), true);
  assert.equal(commandTelemetryEligible(commandContext({
    operationStatusAtStart: "archived"
  })), false);
});

test("command telemetry writes one JSONL row and contains optional write failures", (t) => {
  const root = mkdtempSync(join(tmpdir(), "command-telemetry-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const context = commandContext({
    logs: root,
    mkdir: mkdirSync,
    append: appendFileSync
  });
  assert.equal(recordCommandTelemetry(context, 0), true);
  const rows = readLines(join(root, "change-a", "operations.jsonl"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].operation, "validate");
  assert.equal(rows[0].kind, "lifecycle");
  assert.equal(recordCommandTelemetry(commandContext({
    logs: root, mkdir: mkdirSync, append: appendFileSync,
    operationName: "metrics"
  }), 0), true);
  const inspections = readLines(join(root, "change-a", "inspections.jsonl"));
  assert.equal(inspections.length, 1);
  assert.equal(inspections[0].kind, "inspection");
  assert.equal(recordCommandTelemetry(commandContext({
    telemetryDisabled: true,
    append: () => assert.fail("ineligible telemetry must not write")
  }), 0), false);
  const warnings = [];
  assert.equal(recordCommandTelemetry(commandContext({
    telemetryDebug: true,
    mkdir: () => { throw new Error("read only filesystem"); },
    warn: (message) => warnings.push(message)
  }), 1), false);
  assert.deepEqual(warnings, ["WARNING: telemetry unavailable: read only filesystem"]);
  assert.equal(recordCommandTelemetry(commandContext({
    mkdir: () => { throw new Error("hidden failure"); },
    warn: () => assert.fail("debug-disabled telemetry must stay quiet")
  }), 1), false);
});

test("telemetry batch normalization deduplicates events and Claude transitions", () => {
  let clock = 0;
  const batch = normalizeTelemetryBatch({
    id: "c", rows: [{ id: "a" }, { id: "a" }, { id: "skip" }],
    format: "claude", context: {}, known: new Set(), knownTransitions: new Set(),
    now: () => `t${clock += 1}`,
    normalizeTransition: (_id, row) => row.id === "skip" ? null : { transitionId: row.id },
    normalizeEvent: (_id, row) => row.id === "skip" ? null : {
      requestId: row.id, runId: "c"
    }
  });
  assert.deepEqual(batch.transitions, [{ transitionId: "a" }]);
  assert.deepEqual(batch.normalized, [{ requestId: "a", runId: "c" }]);
  assert.equal(clock, 6, "Claude rows retain separate transition and event timestamps");
});

test("JSONL append, window rebinding and active run selection preserve fallbacks", (t) => {
  const root = mkdtempSync(join(tmpdir(), "telemetry-append-helper-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "nested", "events.jsonl");
  assert.equal(appendTelemetryJsonLines(path, []), false);
  assert.equal(appendTelemetryJsonLines(path, [{ a: 1 }, { b: 2 }]), true);
  assert.deepEqual(readLines(path), [{ a: 1 }, { b: 2 }]);
  const events = [{ runId: "c" }, { runId: "explicit" }];
  rebindTelemetryWindow(events, "c", "window");
  assert.deepEqual(events.map((event) => event.runId), ["window", "explicit"]);
  rebindTelemetryWindow(events, "c", null);
  assert.equal(activeTelemetryRunId(events, {}, "c"), "explicit");
  assert.equal(activeTelemetryRunId([], { sessionId: "session" }, "c"), "session");
  assert.equal(activeTelemetryRunId([], {}, "c"), "c");
});

test("appendTelemetryRows persists only new events and updates the active budget", (t) => {
  const root = mkdtempSync(join(tmpdir(), "telemetry-append-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logs = join(root, "logs");
  const state = { budget: { window: { id: "window-1" } } };
  const calls = { synchronized: [], saved: 0, reported: 0 };
  const runtime = createTelemetryRuntime({
    root, logs, now: () => "2026-08-26T00:00:00.000Z",
    readJsonLines: readLines, loadRuntime: () => state,
    synchronizeBudgetUsage: (...args) => calls.synchronized.push(args),
    saveRuntime: () => { calls.saved += 1; },
    reportBudget: () => { calls.reported += 1; }
  });
  const rows = [
    { requestId: "request-1", inputTokens: 2 },
    { requestId: "request-1", inputTokens: 99 },
    { inputTokens: 3 }
  ];
  assert.equal(runtime.appendTelemetryRows("change", rows, "generic"), 1);
  const events = readLines(join(logs, "change", "events.jsonl"));
  assert.equal(events[0].runId, "window-1");
  assert.equal(events[0].inputTokens, 2);
  assert.equal(calls.synchronized[0][2], "window-1");
  assert.equal(calls.saved, 1);
  assert.equal(calls.reported, 1);
  assert.equal(runtime.appendTelemetryRows("change", rows, "generic"), 0);
  assert.equal(calls.saved, 1, "an empty import leaves runtime state untouched");
});

test("appendTelemetryRows records Claude user transitions without token events", (t) => {
  const root = mkdtempSync(join(tmpdir(), "telemetry-transition-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logs = join(root, "logs");
  const state = { budget: {} };
  let loads = 0;
  const runtime = createTelemetryRuntime({
    root, logs, now: () => "2026-08-26T00:00:00.000Z",
    readJsonLines: readLines,
    loadRuntime: () => { loads += 1; return state; },
    synchronizeBudgetUsage: () => {}, saveRuntime: () => {}, reportBudget: () => {}
  });
  const row = {
    type: "user", uuid: "user-1", timestamp: "2026-08-26T00:00:00.000Z",
    message: { role: "user", content: "must not persist" }
  };
  assert.equal(runtime.appendTelemetryRows("change", [row, row], "claude", {
    sessionId: "session"
  }), 0);
  assert.equal(loads, 0, "a transition-only import does not load runtime state");
  const transitions = readLines(join(logs, "change", "user-transitions.jsonl"));
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].kind, "human-message");
  assert.equal(JSON.stringify(transitions).includes("must not persist"), false);
  assert.equal(runtime.appendTelemetryRows("change", [{
    type: "user", uuid: "tool-result-1", timestamp: "2026-08-26T00:00:01.000Z",
    message: { role: "user", content: [{ type: "tool_result", content: "secret" }] }
  }], "claude", { sessionId: "session" }), 0);
  assert.equal(readLines(join(logs, "change", "user-transitions.jsonl")).length, 1,
    "tool results never enter the human-wait timeline");
  assert.equal(runtime.appendTelemetryRows("change", [{
    type: "user", isMeta: true, uuid: "meta-1",
    timestamp: "2026-08-26T00:00:02.000Z",
    message: { role: "user", content: "hook feedback" }
  }], "claude", { sessionId: "session" }), 0);
  assert.equal(readLines(join(logs, "change", "user-transitions.jsonl")).length, 1,
    "Claude metadata never enters the human-wait timeline");
  assert.equal(runtime.appendTelemetryRows("change", [{
    type: "assistant", uuid: "assistant-1",
    message: {
      role: "assistant", id: "message-1", model: "model",
      usage: { input_tokens: 3, output_tokens: 2 }
    }
  }], "claude", { sessionId: "session" }), 1);
  assert.equal(loads, 1);
  assert.equal(readLines(join(logs, "change", "events.jsonl"))[0].source,
    "claude-transcript");
});
