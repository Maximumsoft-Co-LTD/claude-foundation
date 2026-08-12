import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMetricsRuntime } from "../../harness/runtime/observability/metrics-runtime.mjs";
import {
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
  assert.equal(decision.mode, "completion-only");
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
