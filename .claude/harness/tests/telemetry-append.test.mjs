import assert from "node:assert/strict";
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { blockedOutcomeReason, blockedOutcomeStop } from "../runtime/core/blocked-decision.mjs";
import { blockerMetrics } from "../runtime/observability/metrics-runtime.mjs";
import {
  activeTelemetryRunId,
  appendTelemetryJsonLines,
  blockerTelemetryValue,
  sanitizedBlockerReason,
  commandTelemetryEligible,
  commandTelemetryRow,
  commandTelemetryStatus,
  createTelemetryRuntime,
  createCommandPhaseRecorder,
  normalizeTelemetryBatch,
  recordCommandTelemetry,
  rebindTelemetryWindow,
  replaceTelemetryJsonLines
} from "../runtime/observability/telemetry-runtime.mjs";
import {
  lifecycleSchedulerMetrics, lifecycleStageMetrics
} from "../runtime/observability/metrics-runtime.mjs";

const readLines = (path) => existsSync(path)
  ? readFileSync(path, "utf8").split("\n").filter(Boolean).map(JSON.parse)
  : [];

test("advance records disjoint phase spans and attributes a failure to its active phase", () => {
  let at = 1000;
  let blocked = false;
  const rows = [];
  const recorder = createCommandPhaseRecorder(() => commandContext({
    operationName: "advance", operationPhase: "meta", publicOperation: "meta",
    operationStartedAt: 1000, timestamp: () => at,
    now: () => new Date(at).toISOString(), blocked
  }), (context, code) => rows.push(commandTelemetryRow(context, code)));
  recorder.transition("build");
  recorder.measure("build.prepare", () => { at = 1050; });
  recorder.scheduler({
    scheduler: "setup", wave: 1, readyNodes: 3, executedNodes: 2,
    reusedNodes: 1, queueingMs: 25, peakConcurrency: 2
  });
  at = 1100;
  recorder.transition("build");
  recorder.transition("prove");
  at = 1500;
  blocked = true;
  recorder.finish(1);
  assert.equal(rows.length, 1, "phase transitions must not inflate command invocations");
  assert.equal(rows[0].durationMs, 500);
  assert.deepEqual(rows[0].phaseSpans.map((row) => [row.phase, row.durationMs, row.status]), [
    ["build", 100, "completed"], ["prove", 400, "blocked"]
  ]);
  assert.equal(rows[0].phaseSpans[0].finishedAt, rows[0].phaseSpans[1].startedAt);
  assert.deepEqual(rows[0].stageSpans, [
    { stage: "build.prepare", durationMs: 50, status: "completed" }
  ]);
  assert.equal(rows[0].schedulerEvents[0].peakConcurrency, 2);
  assert.deepEqual(lifecycleSchedulerMetrics(rows), {
    setup: {
      waves: 1, readyNodes: 3, executedNodes: 2, reusedNodes: 1,
      queueingMs: 25, peakConcurrency: 2
    }
  });
  const planned = lifecycleSchedulerMetrics([{
    schedulerEvents: [{ scheduler: "build-task-plan", executedNodes: 1,
      readyNodes: 1, reusedNodes: null, queueingMs: null, peakConcurrency: 1 }]
  }]);
  assert.equal(planned["build-task-plan"].queueingMs, null);
  assert.equal(planned["build-task-plan"].reusedNodes, null);
});

test("phase recorder covers failed sync and async stages plus empty scheduler values", async () => {
  let at = 2000;
  const rows = [];
  const recorder = createCommandPhaseRecorder(() => commandContext({
    operationName: "advance", operationStartedAt: 2000,
    timestamp: () => at, now: () => new Date(at).toISOString()
  }), (context, code) => rows.push(commandTelemetryRow(context, code)));
  assert.throws(() => recorder.measure("sync-failure", () => {
    at += 5;
    throw new Error("sync failed");
  }), /sync failed/);
  assert.equal(await recorder.measureAsync("async-success", async () => {
    at += 10;
    return "ok";
  }), "ok");
  await assert.rejects(() => recorder.measureAsync("async-failure", async () => {
    at += 15;
    throw new Error("async failed");
  }), /async failed/);
  recorder.scheduler({ reusedNodes: null, queueingMs: null });
  recorder.finish(0);
  assert.deepEqual(rows[0].stageSpans.map((span) => span.status),
    ["failed", "completed", "failed"]);
  assert.deepEqual(rows[0].schedulerEvents[0], {
    scheduler: "unknown", wave: 0, readyNodes: 0, executedNodes: 0,
    reusedNodes: null, queueingMs: null, peakConcurrency: 0
  });
  assert.deepEqual(lifecycleStageMetrics([
    ...rows,
    { stageSpans: [{ stage: null, durationMs: 1 },
      { stage: "ignored", durationMs: "not-a-number" }] },
    { stageSpans: null }
  ]), {
    "sync-failure": { calls: 1, durationMs: 5, failures: 1 },
    "async-success": { calls: 1, durationMs: 10, failures: 0 },
    "async-failure": { calls: 1, durationMs: 15, failures: 1 }
  });
});

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

test("blocked command telemetry carries bounded cause and recovery without raw error text", () => {
  const blocker = blockerTelemetryValue(
    "budget exceeded while reading token SECRET-123 at /private/path",
    { changeId: "change-a", operationName: "proof-advance", phase: "prove" }
  );
  const row = commandTelemetryRow(commandContext({
    operationName: "proof-advance", blocked: true, blocker
  }), 2);
  assert.equal(row.version, 5);
  assert.deepEqual(Object.keys(row.blocker).sort(), [
    "classification", "code", "fingerprint", "reason", "recovery", "summary"
  ]);
  assert.equal(row.blocker.reason, "budget exceeded while reading token <redacted> at <path>");
  assert.equal(row.blocker.code, "budget-exhausted");
  assert.equal(row.blocker.classification, "budget");
  assert.match(row.blocker.recovery, /budget checkpoint change-a/);
  assert.equal(JSON.stringify(row).includes("SECRET-123"), false);
  assert.equal(JSON.stringify(row).includes("/private/path"), false);
  assert.equal(blockerTelemetryValue("budget stopped for OTHER-SECRET", {
    changeId: "change-a", operationName: "proof-advance", phase: "prove"
  }).fingerprint, blocker.fingerprint);
  const hostilePhase = blockerTelemetryValue("unclassified stop", {
    changeId: "change-a", operationName: "proof-advance",
    phase: "prove; echo SECRET-456 /private/path"
  });
  assert.equal(hostilePhase.recovery,
    "claude-foundation packet change-a --phase build");
  assert.equal(JSON.stringify(hostilePhase).includes("SECRET-456"), false);
  assert.equal(commandTelemetryRow(commandContext(), 0).blocker, null);
});

test("blocker text naming several kinds takes the first by precedence", () => {
  const blocker = blockerTelemetryValue(
    "authority token conflicts with workspace evidence",
    { changeId: "change-a", operationName: "proof-advance", phase: "prove" }
  );
  assert.equal(blocker.code, "authority-required");
  assert.equal(blocker.reason, "authority token conflicts with workspace evidence");
  assert.equal(blockerTelemetryValue("sandbox lease conflict", {}).code, "resource-conflict");
  assert.equal(blockerTelemetryValue("token count drifted", {}).code, "policy-guard");
});

test("unmatched blocker text keeps the policy guard but records its reason", () => {
  const blocker = blockerTelemetryValue("unclassified stop", {
    changeId: "change-a", operationName: "proof-advance", phase: "prove"
  });
  assert.equal(blocker.code, "policy-guard");
  assert.equal(blocker.reason, "unclassified stop");
  assert.equal(blocker.recovery, "claude-foundation packet change-a --phase prove");
  assert.equal(blockerTelemetryValue("", {}).reason, null);
});

test("a declared blocker code wins over message text", () => {
  const decision = blockerTelemetryValue(
    { code: "decision-required", reason: "choose workspace strategy" },
    { changeId: "change-a", operationName: "proof-advance", phase: "prove" }
  );
  assert.equal(decision.code, "decision-required");
  assert.equal(decision.classification, "decision");
  assert.equal(decision.reason, "choose workspace strategy");
  assert.equal(decision.recovery, "claude-foundation packet change-a --phase prove");
  assert.equal(blockerTelemetryValue({ code: "execution-indeterminate", reason: "x" },
    { changeId: "change-a" }).recovery, "claude-foundation proof advance change-a");
  assert.equal(blockerTelemetryValue({ code: "unknown-code", reason: "budget hit" }, {}).code,
    "budget-exhausted");
});

test("blocker reasons are bounded and strip credentials and paths", () => {
  assert.equal(sanitizedBlockerReason(null), null);
  assert.equal(sanitizedBlockerReason("   "), null);
  assert.equal(sanitizedBlockerReason("api_key=abc123 failed"), "api_key=<redacted> failed");
  assert.equal(sanitizedBlockerReason("used ghp_abcdefghijkl0123"), "used <redacted>");
  assert.equal(sanitizedBlockerReason("Authorization: Bearer xyz"),
    "Authorization: <redacted>");
  assert.equal(sanitizedBlockerReason("send Bearer xyz now"), "send Bearer <redacted> now");
  assert.equal(sanitizedBlockerReason("read ~/work/app/.env and C:\\Users\\me\\x"),
    "read <path> and <path>");
  assert.equal(sanitizedBlockerReason("line one\n  line two"), "line one line two");
  const long = sanitizedBlockerReason("x".repeat(500));
  assert.equal(long.length, 200);
  assert.equal(long.endsWith("…"), true);
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

test("native Codex token_count rows preserve measured usage and deduplicate repeats", () => {
  const batch = normalizeTelemetryBatch({
    id: "change-a",
    format: "codex",
    context: {
      sessionId: "session-a",
      since: "2026-09-03T00:00:00.000Z"
    },
    known: new Set(),
    knownTransitions: new Set(),
    now: () => "2026-09-03T00:00:00.000Z",
    rows: [
      {
        type: "event_msg", timestamp: "2026-09-02T23:59:59.000Z",
        payload: { type: "token_count", info: {
          total_token_usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          last_token_usage: { input_tokens: 1, output_tokens: 1 }
        } }
      },
      { type: "turn_context", payload: { model: "gpt-5.6-sol", cwd: "/project" } },
      {
        type: "event_msg", timestamp: "2026-09-03T00:00:01.000Z",
        payload: { type: "token_count", info: {
          total_token_usage: {
            input_tokens: 120, cached_input_tokens: 80,
            output_tokens: 10, total_tokens: 130
          },
          last_token_usage: {
            input_tokens: 20, cached_input_tokens: 8,
            cache_write_input_tokens: 2, output_tokens: 3
          }
        } }
      },
      {
        type: "event_msg", timestamp: "2026-09-03T00:00:02.000Z",
        payload: { type: "token_count", info: {
          total_token_usage: {
            input_tokens: 120, cached_input_tokens: 80,
            output_tokens: 10, total_tokens: 130
          },
          last_token_usage: {
            input_tokens: 20, cached_input_tokens: 8,
            cache_write_input_tokens: 2, output_tokens: 3
          }
        } }
      }
    ]
  });
  assert.equal(batch.normalized.length, 1);
  assert.deepEqual({
    source: batch.normalized[0].source,
    modelId: batch.normalized[0].modelId,
    inputTokens: batch.normalized[0].inputTokens,
    outputTokens: batch.normalized[0].outputTokens,
    cacheReadTokens: batch.normalized[0].cacheReadTokens,
    cacheCreationTokens: batch.normalized[0].cacheCreationTokens
  }, {
    source: "codex",
    modelId: "gpt-5.6-sol",
    inputTokens: 12,
    outputTokens: 3,
    cacheReadTokens: 8,
    cacheCreationTokens: 2
  });
  assert.match(batch.normalized[0].requestId, /^codex:session-a:/);
});

test("JSONL append, window rebinding and active run selection preserve fallbacks", (t) => {
  const root = mkdtempSync(join(tmpdir(), "telemetry-append-helper-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "nested", "events.jsonl");
  assert.equal(appendTelemetryJsonLines(path, []), false);
  assert.equal(appendTelemetryJsonLines(path, [{ a: 1 }, { b: 2 }]), true);
  assert.deepEqual(readLines(path), [{ a: 1 }, { b: 2 }]);
  assert.equal(replaceTelemetryJsonLines(path, [{ corrected: true }]), true);
  assert.deepEqual(readLines(path), [{ corrected: true }]);
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

test("Codex source reimport atomically replaces stale normalization", (t) => {
  const root = mkdtempSync(join(tmpdir(), "telemetry-codex-reimport-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logs = join(root, "logs");
  const state = { budget: { window: {
    id: "session-a"
  } } };
  const runtime = createTelemetryRuntime({
    root, logs, now: () => "2026-09-03T00:00:03.000Z",
    readJsonLines: readLines, loadRuntime: () => state,
    synchronizeBudgetUsage: () => {}, saveRuntime: () => {}, reportBudget: () => {}
  });
  const row = (inputTokens) => ({
    type: "event_msg", timestamp: "2026-09-03T00:00:01.000Z",
    payload: { type: "token_count", info: {
      total_token_usage: {
        input_tokens: 120, cached_input_tokens: 80,
        output_tokens: 10, total_tokens: 130
      },
      last_token_usage: {
        input_tokens: inputTokens, cached_input_tokens: 8, output_tokens: 3
      }
    } }
  });
  const context = {
    sessionId: "session-a", sourcePath: "/tmp/codex.jsonl", replaceSource: true
  };
  assert.equal(runtime.appendTelemetryRows("change", [row(20)], "codex", context), 1);
  assert.equal(runtime.appendTelemetryRows("change", [row(18)], "codex", context), 1);
  const events = readLines(join(logs, "change", "events.jsonl"));
  assert.equal(events.length, 1);
  assert.equal(events[0].inputTokens, 10);
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

test("non-ready outcomes declare their stop kind and reason", () => {
  assert.deepEqual(blockedOutcomeStop({
    status: "NEEDS_USER_DECISION", decision: { summary: "pick a reviewer" }
  }), { code: "decision-required", reason: "pick a reviewer" });
  assert.deepEqual(blockedOutcomeStop({
    stage: "execution-indeterminate", next: [{ reason: "inspect side effects" }]
  }), { code: "execution-indeterminate", reason: "inspect side effects" });
  assert.deepEqual(blockedOutcomeStop({ status: "BLOCKED", issues: ["provider missing"] }),
    { code: null, reason: "provider missing" });
  assert.equal(blockedOutcomeReason({ blockers: [{ summary: "lease held" }] }), "lease held");
  assert.equal(blockedOutcomeReason({ command: "proof run", status: "BLOCKED" }),
    "proof run BLOCKED");
  assert.equal(blockedOutcomeReason({}), null);
});

test("metrics group blocked operations by code, phase and operation", () => {
  const value = blockerMetrics([
    { status: "completed", operation: "advance" },
    { status: "blocked", phase: "prove", operation: "proof-advance",
      blocker: { code: "authority-required", reason: "first" } },
    { status: "blocked", phase: "prove", operation: "authority-run",
      blocker: { code: "authority-required", reason: "latest" } },
    { status: "blocked", operation: "start" }
  ]);
  assert.equal(value.total, 3);
  assert.deepEqual(value.byCode["authority-required"], {
    count: 2, phases: { prove: 2 },
    operations: { "proof-advance": 1, "authority-run": 1 }, latestReason: "latest"
  });
  assert.deepEqual(value.byCode.untyped, {
    count: 1, phases: { unknown: 1 }, operations: { start: 1 }, latestReason: null
  });
});
