import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { measuredNumber } from "../../harness/runtime/core/measured-number.mjs";
import { createMetricsRuntime } from "../../harness/runtime/observability/metrics-runtime.mjs";
import {
  createJsonlReader,
  normalizeClaudeUserTransition,
  normalizeTelemetryRow,
  runtimeSessionId
} from "../../harness/runtime/observability/telemetry.mjs";
import { createTelemetryRuntime } from "../../harness/runtime/observability/telemetry-runtime.mjs";
import { createBudgetRuntime } from "../../harness/runtime/workflow/budget.mjs";

const policy = () => ({
  execution: {
    requestBudgets: { rapid: 100, standard: 200 },
    tokenBudgets: { rapid: 800000, standard: 1600000 }
  },
  models: {
    fast: { family: "fast" },
    standard: { family: "standard" },
    deep: { family: "deep" }
  }
});

const json = (path, fallback = null) => {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
};
const jsonLines = (path) => {
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  } catch {
    return [];
  }
};

test("JSONL readers distinguish strict evidence from tolerant telemetry", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-jsonl-reader-"));
  const missing = join(root, "missing.jsonl");
  const valid = join(root, "valid.jsonl");
  const corrupt = join(root, "corrupt.jsonl");
  writeFileSync(valid, '{"id":1}\n\n{"id":2}\n');
  writeFileSync(corrupt, '{"id":1}\nnot-json\n{"id":2}\n');
  const reader = createJsonlReader({
    root,
    fail: (message) => { throw new Error(message); }
  });
  assert.deepEqual(reader.readJsonLines(missing), []);
  assert.deepEqual(reader.readJsonLines(valid), [{ id: 1 }, { id: 2 }]);
  assert.throws(() => reader.readJsonLines(corrupt), /invalid JSONL: corrupt\.jsonl/);
  assert.deepEqual(reader.readJsonLinesTolerant(missing), []);
  assert.deepEqual(reader.readJsonLinesTolerant(corrupt), [{ id: 1 }, { id: 2 }]);

  const priorDebug = process.env.FOUNDATION_TELEMETRY_DEBUG;
  const priorError = console.error;
  const warnings = [];
  process.env.FOUNDATION_TELEMETRY_DEBUG = "1";
  console.error = (message) => warnings.push(message);
  try {
    assert.deepEqual(reader.readJsonLinesTolerant(corrupt), [{ id: 1 }, { id: 2 }]);
  } finally {
    console.error = priorError;
    if (priorDebug === undefined) delete process.env.FOUNDATION_TELEMETRY_DEBUG;
    else process.env.FOUNDATION_TELEMETRY_DEBUG = priorDebug;
  }
  assert.match(warnings[0], /skipped invalid telemetry row in corrupt\.jsonl/);
});

test("unobserved host usage remains unknown in budget and metrics", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-telemetry-truth-"));
  const logs = join(root, "logs");
  const receipts = join(root, "receipts");
  const budgetRuntime = createBudgetRuntime({ policy, now: () => "2026-08-12T00:00:00.000Z" });
  const state = {
    id: "truthful-usage",
    schema: "foundation-standard",
    impact: "medium",
    budget: budgetRuntime.initialBudget("foundation-standard", "truthful-usage")
  };
  writeFileSync(join(root, "operations.jsonl"), "");
  let rendered = null;
  createMetricsRuntime({
    logs,
    receipts,
    readJson: json,
    readJsonLines: jsonLines,
    readJsonLinesTolerant: jsonLines,
    loadRuntime: () => structuredClone(state),
    ensureBudgetState: budgetRuntime.ensureBudgetState,
    budgetDecision: budgetRuntime.budgetDecision,
    output: (value) => { rendered = JSON.parse(value); }
  }).showMetrics("truthful-usage");

  assert.equal(state.budget.window.usedRequests, null);
  assert.equal(state.budget.window.usedTokens, null);
  assert.equal(budgetRuntime.budgetDecision(state).measured, false);
  assert.equal(rendered.requests, null);
  assert.equal(rendered.usageMeasurement, "unavailable");
});

test("a real event reporting numeric zero remains measured", () => {
  const budgetRuntime = createBudgetRuntime({ policy, now: () => "2026-08-12T00:00:00.000Z" });
  const state = {
    id: "measured-zero",
    schema: "foundation-standard",
    impact: "medium",
    budget: budgetRuntime.initialBudget("foundation-standard", "measured-zero")
  };
  const event = {
    runId: "measured-zero",
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0
  };
  const decision = budgetRuntime.synchronizeBudgetUsage(
    state, [event], "measured-zero", "host-events:codex", 1
  );
  assert.equal(state.budget.window.usedRequests, 1);
  assert.equal(state.budget.window.usedTokens, 0);
  assert.equal(decision.measured, true);
  assert.equal(decision.limiter, "requests");
});

test("measured numbers reject JavaScript coercion values", () => {
  assert.equal(measuredNumber(0), 0);
  assert.equal(measuredNumber(" 42 "), 42);
  assert.equal(measuredNumber("0"), 0);
  // `-0 >= 0` holds, so without normalization the sign bit would survive.
  assert.ok(Object.is(measuredNumber(-0), 0));
  assert.ok(Object.is(measuredNumber("-0"), 0));
  for (const value of [
    null, undefined, "", "  ", true, false, [], [7], {}, NaN, Infinity, -2.5, "-1"
  ])
    assert.equal(measuredNumber(value), null, `expected ${String(value)} to be unknown`);
});

test("a user row without its own timestamp keeps one transition across a rescan", () => {
  const row = {
    type: "user", uuid: "row-1", sessionId: "session-a",
    message: { role: "user", content: "continue" }
  };
  const context = { sessionId: "session-a", sourcePath: "/transcript.jsonl" };
  const first = normalizeClaudeUserTransition(
    "change", row, context, "2026-08-12T00:00:00.000Z");
  const rescan = normalizeClaudeUserTransition(
    "change", row, context, "2026-08-12T00:05:00.000Z");
  assert.equal(first.transitionId, rescan.transitionId,
    "the import-time clock fallback must not mint a new transition identity");
  assert.equal(first.timestamp, "2026-08-12T00:00:00.000Z",
    "the fallback still populates the stored timestamp");
  const timestamped = normalizeClaudeUserTransition("change",
    { ...row, timestamp: "2026-08-12T00:00:00.000Z" }, context, null);
  assert.notEqual(timestamped.transitionId, first.transitionId,
    "rows with real timestamps keep their content-derived identity");

  assert.equal(normalizeClaudeUserTransition("change", {
    type: "assistant", message: { role: "assistant" }
  }, context, "2026-08-12T00:00:00.000Z"), null);
  assert.equal(normalizeClaudeUserTransition("change", {
    type: "user", timestamp: "invalid"
  }, context), null);
  assert.equal(normalizeClaudeUserTransition("change", {
    message: { role: "user", content: "continue" }, id: "message-role",
    created_at: "2026-08-12T00:01:00.000Z"
  }, {}, null).sessionId, null);
  const contextual = normalizeClaudeUserTransition("change", {
    type: "user", id: "contextual", message: { role: "user", content: "continue" }
  }, { sessionId: "context-session" }, "2026-08-12T00:02:00.000Z");
  assert.equal(contextual.sessionId, "context-session");
  assert.equal(contextual.sourcePathHash, null);
  assert.equal(contextual.kind, "human-message");
  assert.equal(contextual.version, 2);
  assert.equal(normalizeClaudeUserTransition("change", {
    type: "user", timestamp: "2026-08-12T00:03:00.000Z",
    message: { role: "user", content: [{ type: "tool_result", content: "ok" }] }
  }, context), null, "tool results are not human transitions");
  assert.equal(normalizeClaudeUserTransition("change", {
    type: "user", isMeta: true, timestamp: "2026-08-12T00:04:00.000Z",
    message: { role: "user", content: "Stop hook feedback" }
  }, context), null, "hook and skill metadata are not human transitions");
});

test("telemetry normalization keeps junk unknown and normalizes numeric strings", () => {
  const junk = normalizeTelemetryRow("change", {
    requestId: "junk", inputTokens: "", outputTokens: true,
    cacheCreationTokens: [], cacheReadTokens: [7], cacheTokens: {},
    cost: false, durationMs: [10]
  }, "generic");
  for (const field of [
    "inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens",
    "cacheTokens", "cost", "durationMs"
  ]) assert.equal(junk[field], null, `${field} must remain unknown`);

  const measured = normalizeTelemetryRow("change", {
    requestId: "numeric-strings", inputTokens: "4", outputTokens: "2.5",
    cacheCreationTokens: "1", cacheReadTokens: "3", cost: "0.25", durationMs: "9"
  }, "generic");
  assert.deepEqual({
    inputTokens: measured.inputTokens,
    outputTokens: measured.outputTokens,
    cacheCreationTokens: measured.cacheCreationTokens,
    cacheReadTokens: measured.cacheReadTokens,
    cacheTokens: measured.cacheTokens,
    cost: measured.cost,
    durationMs: measured.durationMs
  }, {
    inputTokens: 4, outputTokens: 2.5, cacheCreationTokens: 1,
    cacheReadTokens: 3, cacheTokens: 4, cost: 0.25, durationMs: 9
  });

  const negative = normalizeTelemetryRow("change", {
    requestId: "negative", inputTokens: -100, outputTokens: "-2",
    cacheCreationTokens: -1, cacheReadTokens: -3, cacheTokens: -4,
    cost: -0.5, durationMs: -9
  }, "generic");
  for (const field of [
    "inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens",
    "cacheTokens", "cost", "durationMs"
  ]) assert.equal(negative[field], null, `${field} must reject negative quantities`);
});

test("telemetry normalization preserves every supported host format and fallback", () => {
  assert.equal(normalizeTelemetryRow("change", {
    type: "user", message: { role: "user", usage: {} }
  }, "claude"), null, "non-assistant Claude rows are not token events");
  assert.equal(normalizeTelemetryRow("change", {}, "generic"), null,
    "rows without a durable request identity are ignored");

  const claude = normalizeTelemetryRow("change", {
    type: "assistant",
    message: {
      role: "assistant", id: "message-request", model: "claude-model",
      usage: {
        input_tokens: 7, output_tokens: 3,
        cache_creation_input_tokens: 2, cache_read_input_tokens: 1
      }
    },
    uuid: "row-uuid"
  }, "claude", { sourcePath: "/tmp/transcript.jsonl" },
  "2026-08-12T00:00:00.000Z");
  assert.deepEqual({
    requestId: claude.requestId, agentId: claude.agentId, modelId: claude.modelId,
    inputTokens: claude.inputTokens, outputTokens: claude.outputTokens,
    cacheTokens: claude.cacheTokens, source: claude.source
  }, {
    requestId: "message-request", agentId: "orchestrator", modelId: "claude-model",
    inputTokens: 7, outputTokens: 3, cacheTokens: 3, source: "claude-transcript"
  });
  assert.match(claude.sourcePathHash, /^[a-f0-9]{64}$/);

  const otel = normalizeTelemetryRow("change", {
    trace_id: "trace-request",
    attributes: {
      "llm.usage.input_tokens": 11,
      "llm.usage.output_tokens": 5,
      "gen_ai.usage.cache_read_tokens": 4,
      "llm.request.model": "otel-model"
    }
  }, "otel", { sessionId: "session", operationId: "operation", agentId: "agent" });
  assert.deepEqual({
    requestId: otel.requestId, inputTokens: otel.inputTokens,
    outputTokens: otel.outputTokens, cacheReadTokens: otel.cacheReadTokens,
    modelId: otel.modelId
  }, {
    requestId: "trace-request", inputTokens: 11, outputTokens: 5,
    cacheReadTokens: 4, modelId: "otel-model"
  });

  const generic = normalizeTelemetryRow("change", {
    run_id: "run", operation_id: "operation", agent_id: "agent",
    model_id: "model", request_id: "request", session_id: "session",
    parent_request_id: "parent", created_at: "2026-08-12T00:00:00.000Z",
    token_usage: { input: 13, output: 8, cost_usd: 0.5 },
    cacheTokens: 0, duration_ms: 21, repository_id: "repo", task_id: "task",
    attempt: 0
  }, "generic", { snapshot: { workspaceHash: "workspace", id: "snapshot" } });
  assert.deepEqual({
    runId: generic.runId, operationId: generic.operationId, agentId: generic.agentId,
    inputTokens: generic.inputTokens, outputTokens: generic.outputTokens,
    cacheTokens: generic.cacheTokens, cost: generic.cost, durationMs: generic.durationMs,
    repositoryId: generic.repositoryId, taskId: generic.taskId,
    workspaceHash: generic.workspaceHash, workspaceSnapshotId: generic.workspaceSnapshotId,
    attempt: generic.attempt
  }, {
    runId: "run", operationId: "operation", agentId: "agent",
    inputTokens: 13, outputTokens: 8, cacheTokens: 0, cost: 0.5, durationMs: 21,
    repositoryId: "repo", taskId: "task", workspaceHash: "workspace",
    workspaceSnapshotId: "snapshot", attempt: 0
  });
});

test("budget accounting ignores junk usage instead of inventing spend", () => {
  const runtime = createBudgetRuntime({ policy, now: () => "2026-08-12T00:00:00.000Z" });
  assert.equal(runtime.eventTokenCount({
    inputTokens: "", outputTokens: true, cacheCreationTokens: []
  }), null);
  assert.equal(runtime.eventTokenCount({
    inputTokens: "5", outputTokens: "2", cacheCreationTokens: "1"
  }), 8);
  assert.equal(runtime.eventTokenCount({
    inputTokens: -100, outputTokens: 5, cacheCreationTokens: 0
  }), 5);
  assert.equal(runtime.eventTokenCount({
    inputTokens: 10, outputTokens: 5, cacheTokens: 2, cacheReadTokens: 20
  }), 15);
  assert.equal(runtime.knownNumber(false), false);
  assert.equal(runtime.knownNumber([7]), false);
});

test("a phase's spend derives cache-write the same way the budget window does", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-derived-cache-write-"));
  const logs = join(root, "logs");
  const id = "derived-cache-write";
  mkdirSync(join(logs, id), { recursive: true });
  writeFileSync(join(logs, id, "operations.jsonl"), "");
  // This host reports only a cache total and a cache-read count, with no
  // explicit creation field — the budget derives the write as their
  // difference (cacheTokens - cacheReadTokens = 100), and the phase spend
  // shown in `metrics show` must charge that same derived write rather than
  // silently dropping it because no `cacheCreationTokens` field was present.
  writeFileSync(join(logs, id, "events.jsonl"), JSON.stringify({
    source: "generic", requestId: "derived", operationId: "build", modelId: "model-a",
    inputTokens: 10, outputTokens: 5, cacheTokens: 120, cacheReadTokens: 20,
    timestamp: "2026-08-12T00:00:00.000Z"
  }) + "\n");
  const budgetRuntime = createBudgetRuntime({ policy, now: () => "2026-08-12T00:00:00.000Z" });
  const state = {
    id, schema: "foundation-standard", impact: "medium",
    budget: budgetRuntime.initialBudget("foundation-standard", id)
  };
  budgetRuntime.synchronizeBudgetUsage(state, [{
    runId: id, inputTokens: 10, outputTokens: 5, cacheTokens: 120, cacheReadTokens: 20
  }], id, "host-events:generic", 1);
  assert.equal(state.budget.window.usedTokens, 115);
  let rendered;
  createMetricsRuntime({
    logs,
    receipts: join(root, "receipts"),
    readJson: json,
    readJsonLines: jsonLines,
    readJsonLinesTolerant: jsonLines,
    loadRuntime: () => structuredClone(state),
    ensureBudgetState: budgetRuntime.ensureBudgetState,
    budgetDecision: budgetRuntime.budgetDecision,
    output: (value) => { rendered = JSON.parse(value); }
  }).showMetrics(id);
  assert.equal(rendered.phases.build.spendTokens, 115,
    "phase spend must match the budget window it is compared against");
});

test("metrics totals, groups, phases, and carry-in ignore junk values", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-strict-metrics-"));
  const logs = join(root, "logs");
  const id = "strict-metrics";
  mkdirSync(join(logs, id), { recursive: true });
  writeFileSync(join(logs, id, "operations.jsonl"), "");
  writeFileSync(join(logs, id, "events.jsonl"), [
    {
      source: "generic", requestId: "junk", operationId: "build", modelId: "model-a",
      inputTokens: "", outputTokens: true, cacheCreationTokens: [],
      cacheReadTokens: [7], cacheTokens: {}, cost: false,
      timestamp: "2026-08-12T00:00:00.000Z"
    },
    {
      source: "generic", requestId: "valid", operationId: "build", modelId: "model-a",
      inputTokens: "4", outputTokens: "2", cacheCreationTokens: "1",
      cacheReadTokens: "3", cacheTokens: "4", cost: "0.5",
      timestamp: "2026-08-12T00:00:01.000Z"
    }
  ].map(JSON.stringify).join("\n") + "\n");
  writeFileSync(join(logs, id, "context.jsonl"), [
    { kind: "junk-blank", bytes: "" },
    { kind: "junk-boolean", bytes: true },
    { kind: "junk-array", bytes: [7] },
    { kind: "junk-negative", bytes: -10 }
  ].map(JSON.stringify).join("\n") + "\n");
  writeFileSync(join(logs, id, "context-rollup.json"), JSON.stringify({
    count: true,
    totalBytes: [99],
    byKind: { archivedJunk: { count: 1, totalBytes: false, maxBytes: [] } }
  }));
  const budgetRuntime = createBudgetRuntime({ policy, now: () => "2026-08-12T00:00:00.000Z" });
  const state = {
    id, schema: "foundation-standard", impact: "medium",
    budget: budgetRuntime.initialBudget("foundation-standard", id)
  };
  let rendered;
  createMetricsRuntime({
    logs,
    receipts: join(root, "receipts"),
    readJson: json,
    readJsonLines: jsonLines,
    readJsonLinesTolerant: jsonLines,
    loadRuntime: () => structuredClone(state),
    ensureBudgetState: budgetRuntime.ensureBudgetState,
    budgetDecision: budgetRuntime.budgetDecision,
    output: (value) => { rendered = JSON.parse(value); }
  }).showMetrics(id);
  assert.equal(rendered.inputTokens, 4);
  assert.equal(rendered.outputTokens, 2);
  assert.equal(rendered.cacheTokens, 4);
  assert.equal(rendered.cost, 0.5);
  assert.equal(rendered.byModel["model-a"].inputTokens, 4);
  assert.equal(rendered.phases.build.inputTokens, 4);
  assert.equal(rendered.phases.build.contextCarryInTokens, 3);
  assert.equal(rendered.usageAvailability.classification, "partial-measurement");
  assert.equal(rendered.context.totalBytes, null);
  assert.equal(rendered.context.retainedEvents, 0);
  assert.equal(rendered.context.archivedEvents, null);
  assert.deepEqual(rendered.context.byKind, {});
});

test("metrics compose lifecycle, receipt, context, and human-wait timelines", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-complete-metrics-"));
  const logs = join(root, "logs");
  const receipts = join(root, "receipts");
  const id = "complete-metrics";
  mkdirSync(join(logs, id), { recursive: true });
  mkdirSync(join(receipts, id, "ignored-dir"), { recursive: true });
  const operations = [
    {
      operation: "authority-request", phase: "resolve", status: "completed", durationMs: 10,
      startedAt: "2026-08-12T00:00:00.000Z", finishedAt: "2026-08-12T00:01:00.000Z"
    },
    {
      operation: "build", status: "blocked", durationMs: 20,
      startedAt: "2026-08-12T00:01:00.000Z", finishedAt: "2026-08-12T00:02:00.000Z"
    },
    {
      status: "failed", durationMs: 30,
      startedAt: "2026-08-12T00:02:00.000Z", finishedAt: "2026-08-12T00:03:00.000Z"
    },
    {
      operation: "authority-record", phase: "resolve", status: "completed", durationMs: 5,
      startedAt: "2026-08-12T00:06:00.000Z", finishedAt: "2026-08-12T00:06:05.000Z"
    },
    {
      operation: "authority-request", phase: "resolve", status: "completed", durationMs: 1,
      startedAt: "invalid", finishedAt: "invalid"
    },
    {
      operation: "exec", status: "completed", durationMs: 40,
      startedAt: "2026-08-12T00:06:05.000Z", finishedAt: "2026-08-12T00:07:00.000Z"
    }
  ];
  writeFileSync(join(logs, id, "operations.jsonl"),
    operations.map(JSON.stringify).join("\n") + "\n");
  const events = [
    {
      source: "generic", requestId: "one", operationId: "build", agentId: "orchestrator",
      sessionId: "session-a", inputTokens: 10, outputTokens: 5,
      cacheCreationTokens: 2, cacheReadTokens: 3, cacheTokens: 5, cost: 1,
      modelId: "model-a", repositoryId: "root", taskId: "T1", attempt: 0,
      attemptStatus: "pass", instructionManifestDigest: "digest-a",
      timestamp: "2026-08-12T00:03:00.000Z"
    },
    {
      source: "generic", requestId: "two", operationId: "prove", agentId: "worker",
      sessionId: "session-a", inputTokens: 4, outputTokens: 2,
      cacheTokens: 4, cacheReadTokens: 1, cost: 0.5, fallbackReason: "retry",
      attempt: 1, timestamp: "2026-08-12T00:04:00.000Z"
    },
    {
      source: "generic", requestId: "three", agentId: "orchestrator",
      sessionId: "session-a", inputTokens: 1, outputTokens: 1,
      timestamp: "2026-08-12T00:05:00.000Z"
    },
    {
      source: "generic", requestId: "four", operationId: "orchestrator",
      inputTokens: 0, outputTokens: 0, timestamp: "invalid"
    }
  ];
  writeFileSync(join(logs, id, "events.jsonl"),
    events.map(JSON.stringify).join("\n") + "\n");
  writeFileSync(join(logs, id, "user-transitions.jsonl"), [
    { kind: "human-message", sessionId: "session-a", timestamp: "2026-08-12T00:05:30.000Z" },
    { kind: "tool-result", sessionId: "session-a", timestamp: "2026-08-12T00:07:00.000Z" },
    { kind: "human-message", sessionId: "session-a", timestamp: "2026-08-12T00:08:00.000Z" },
    { kind: "human-message", sessionId: "missing", timestamp: "2026-08-12T00:09:00.000Z" },
    { kind: "human-message", sessionId: "session-a", timestamp: "invalid" }
  ].map(JSON.stringify).join("\n") + "\n");
  writeFileSync(join(logs, id, "phase-context.jsonl"), [
    { phase: "build", contextMode: "fresh" },
    { phase: "build", contextMode: "ignored-second" },
    { phase: "missing", contextMode: "fresh" },
    { contextMode: "unknown" }
  ].map(JSON.stringify).join("\n") + "\n");
  writeFileSync(join(logs, id, "context.jsonl"), [
    { kind: "packet", bytes: 100 }, { kind: "packet", bytes: 300 }
  ].map(JSON.stringify).join("\n") + "\n");
  writeFileSync(join(logs, id, "context-rollup.json"), JSON.stringify({
    count: 2, totalBytes: 50,
    byKind: { packet: { count: 2, totalBytes: 50, maxBytes: 40 } }
  }));
  writeFileSync(join(logs, id, "reuse.jsonl"), [
    { reason: "declared-inputs" }, { reason: "declared-inputs" }, {}
  ].map(JSON.stringify).join("\n") + "\n");
  writeFileSync(join(receipts, id, "proof.json"), "{}\n");
  writeFileSync(join(receipts, id, "ignored.txt"), "ignored\n");
  writeFileSync(join(receipts, id, "test.json"), JSON.stringify({
    provider: "test", status: "pass", adapter: "command", durationMs: 50,
    commandExecutionId: "exec-1", proofRunId: "proof-1"
  }));
  writeFileSync(join(receipts, id, "second.json"), JSON.stringify({
    status: "pass", durationMs: 100, executionId: "exec-1"
  }));
  writeFileSync(join(receipts, id, "external.json"), JSON.stringify({
    provider: "external", status: "pass", durationMs: "unknown"
  }));

  const budgetRuntime = createBudgetRuntime({
    policy, now: () => "2026-08-12T00:00:00.000Z"
  });
  const state = {
    id, schema: "foundation-standard", impact: "medium",
    budget: budgetRuntime.initialBudget("foundation-standard", id)
  };
  let rendered;
  const runtime = createMetricsRuntime({
    logs, receipts, readJson: json, readJsonLines: jsonLines,
    readJsonLinesTolerant: jsonLines, loadRuntime: () => structuredClone(state),
    ensureBudgetState: budgetRuntime.ensureBudgetState,
    budgetDecision: budgetRuntime.budgetDecision,
    output: (value) => { rendered = JSON.parse(value); }
  });
  runtime.showMetrics(id);
  assert.equal(rendered.phases.build.blocked, 1);
  assert.equal(rendered.phases.unknown.failed, 1);
  assert.equal(rendered.phases.prove.contextMode, "retained");
  assert.equal(rendered.providers.test.commandExecutionId, "exec-1");
  assert.equal(rendered.providers.second.adapter, "external");
  assert.equal(rendered.evidenceExecutionTimeMs, 100);
  assert.equal(rendered.externalExecutionTimeMs, 40);
  assert.equal(rendered.context.totalBytes, 450);
  assert.equal(rendered.context.byKind.packet.count, 4);
  assert.ok(rendered.humanWaitMs > 0);
  assert.ok(rendered.humanWaitSpans.some((span) => span.sources.includes("transcript")));
  assert.equal(rendered.hostExecution.fallbacks, 1);
  assert.deepEqual(rendered.evidenceReuse.byReason,
    { "declared-inputs": 2, unknown: 1 });

  const operationOnly = "operation-only";
  mkdirSync(join(logs, operationOnly), { recursive: true });
  writeFileSync(join(logs, operationOnly, "operations.jsonl"), JSON.stringify({
    operation: "build", status: "completed", durationMs: 7,
    startedAt: "2026-08-12T00:00:00.000Z", finishedAt: "2026-08-12T00:00:01.000Z"
  }) + "\n");
  runtime.showMetrics(operationOnly);
  assert.equal(rendered.activeTimeMs, 7);

  const evidenceOnly = "evidence-only";
  mkdirSync(join(receipts, evidenceOnly), { recursive: true });
  writeFileSync(join(receipts, evidenceOnly, "test.json"), JSON.stringify({
    provider: "test", status: "pass", durationMs: 9, commandExecutionId: "exec-only"
  }));
  runtime.showMetrics(evidenceOnly);
  assert.equal(rendered.activeTimeMs, 9);
});

test("an explicit nonzero window is not erased while host totals are unavailable", () => {
  const budgetRuntime = createBudgetRuntime({ policy, now: () => "2026-08-12T00:00:00.000Z" });
  const state = {
    id: "explicit-window",
    schema: "foundation-standard",
    impact: "medium",
    budget: budgetRuntime.initialBudget("foundation-standard", "explicit-window")
  };
  state.budget.window.usedRequests = 0;
  state.budget.window.usedTokens = 1600001;
  const decision = budgetRuntime.budgetDecision(state);
  assert.equal(state.budget.window.usedTokens, 1600001);
  assert.equal(decision.measured, true);
  assert.equal(decision.mode, "operator-required");
  assert.equal(decision.status, "NEEDS_USER_DECISION");
});

test("Codex thread identity correlates imported rows without creating usage", () => {
  const env = { CODEX_THREAD_ID: "codex-thread", FOUNDATION_SESSION_ID: "" };
  assert.equal(runtimeSessionId(env), "codex-thread");
  const row = normalizeTelemetryRow("change", {
    requestId: "codex-request",
    usage: { input_tokens: 3, output_tokens: 2 }
  }, "codex", { sessionId: runtimeSessionId(env) }, "2026-08-12T00:00:00.000Z");
  assert.equal(row.runId, "codex-thread");
  assert.equal(row.sessionId, "codex-thread");
  assert.equal(row.inputTokens, 3);
  assert.equal(row.outputTokens, 2);
});

test("phase correlation records Codex identity without synthesizing an event", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-codex-correlation-"));
  // A Claude host still outranks the Codex fallback, so this case only exists
  // once no Claude transcript is bound. The suite must therefore run the same
  // way inside a Claude session as it does under Codex or bare CI.
  const isolated = [
    "CODEX_THREAD_ID",
    "FOUNDATION_SESSION_ID",
    "FOUNDATION_CLAUDE_SESSION_ID",
    "FOUNDATION_CLAUDE_TRANSCRIPT_PATH"
  ];
  const priorEnv = Object.fromEntries(isolated.map((key) => [key, process.env[key]]));
  for (const key of isolated) delete process.env[key];
  process.env.CODEX_THREAD_ID = "codex-phase-thread";
  try {
    const runtime = createTelemetryRuntime({
      root,
      logs: root,
      contextEventSchemaVersion: "2",
      stableHash: () => "digest",
      now: () => "2026-08-12T00:00:00.000Z",
      readJson: json,
      writeJson: (path, value) => writeFileSync(path, JSON.stringify(value)),
      readJsonLines: jsonLines,
      readJsonLinesTolerant: jsonLines,
      loadRuntime: () => ({}),
      saveRuntime: () => {},
      synchronizeBudgetUsage: () => {},
      reportBudget: () => {},
      snapshotPath: () => join(root, "snapshot.json"),
      parseFlags: () => ({ flags: {}, rest: [] }),
      activeChangePath: () => root,
      repositoryById: () => null,
      taskBlocks: () => [],
      fail: (message) => { throw new Error(message); }
    });
    runtime.recordPhaseContext("change", "build");
    const phase = jsonLines(join(root, "change", "phase-context.jsonl"));
    assert.equal(phase.length, 1);
    assert.equal(phase[0].sessionId, "codex-phase-thread");
    assert.equal(jsonLines(join(root, "change", "events.jsonl")).length, 0);
  } finally {
    for (const key of isolated) {
      if (priorEnv[key] === undefined) delete process.env[key];
      else process.env[key] = priorEnv[key];
    }
  }
});
