import assert from "node:assert/strict";
import test from "node:test";

import { createBudgetRuntime } from "../runtime/workflow/budget.mjs";

function fixture(execution = {}) {
  let ticks = 0;
  const runtime = createBudgetRuntime({
    policy: () => ({ execution: {
      requestBudgets: { rapid: 10, standard: 20 },
      tokenBudgets: { rapid: 100, standard: 200 },
      ...execution
    } }),
    now: () => `time-${++ticks}`
  });
  return { runtime, ticks: () => ticks };
}

function currentBudget(overrides = {}) {
  return {
    version: 3,
    measurement: "host-events",
    targetRequests: 20,
    targetTokens: 200,
    usedRequests: 0,
    usedTokens: 0,
    lifetime: { usedRequests: 0, usedTokens: 0 },
    window: {
      id: "run-1", extensionRootId: "run-1", extensionNumber: 0, sequence: 1,
      targetRequests: 20, targetTokens: 200,
      baselineRequests: 0, baselineTokens: 0,
      usedRequests: 0, usedTokens: 0, mode: "normal", reason: "initial-run",
      exhaustedAt: null
    },
    ...overrides
  };
}

test("budget targets select lanes and apply the largest request scale", () => {
  const { runtime } = fixture();
  assert.deepEqual(runtime.budgetTargets("foundation-rapid", "low", "xs"), {
    requests: 10, tokens: 100
  });
  assert.deepEqual(runtime.budgetTargets("foundation-standard", "high", "s"), {
    requests: 30, tokens: 200
  });
  assert.deepEqual(runtime.budgetTargets("unknown", "low", "L"), {
    requests: 40, tokens: 200
  });
  assert.deepEqual(runtime.budgetTargets("foundation-rapid", "high", "m"), {
    requests: 15, tokens: 100
  });
  assert.deepEqual(runtime.budgetTargets("foundation-standard", "medium", "s", {
    coupling: "coupled", repositoryCount: 4, providerCount: 8,
    securityTriggerCount: 1
  }), { requests: 50, tokens: 200 });
  assert.deepEqual(fixture({ requestBudgets: {} }).runtime
    .budgetTargets("foundation-rapid"), { requests: 100, tokens: 100 });
  assert.deepEqual(fixture({ requestBudgets: {} }).runtime
    .budgetTargets("foundation-standard", "low", "unrecognized"), {
      requests: 200, tokens: 200
    });
});

test("budget windows distinguish measured baselines from unavailable usage", () => {
  const { runtime } = fixture();
  const unavailable = runtime.budgetWindow("run", { requests: 2, tokens: 3 });
  assert.equal(unavailable.usedRequests, null);
  assert.equal(unavailable.usedTokens, null);
  assert.equal(unavailable.sequence, 1);
  assert.equal(unavailable.reason, "initial-run");

  const measured = runtime.budgetWindow("run-2", { requests: 4, tokens: 5 }, {
    measured: true, requests: 2, tokens: 3
  }, 4, "rollover");
  assert.equal(measured.usedRequests, 0);
  assert.equal(measured.usedTokens, 0);
  assert.equal(measured.baselineRequests, 2);
  assert.equal(measured.baselineTokens, 3);
  assert.equal(measured.startedAt, "time-2");

  const partial = runtime.budgetWindow("run-3", { requests: 4, tokens: 5 }, {
    measured: true, requests: null, tokens: null
  });
  assert.equal(partial.baselineRequests, 0);
  assert.equal(partial.usedRequests, 0);
  assert.equal(partial.usedTokens, null);
});

test("initial and upgraded budgets preserve only compatible measured usage", () => {
  const { runtime } = fixture();
  const initial = runtime.initialBudget("foundation-rapid", "change");
  assert.equal(initial.version, 3);
  assert.equal(initial.targetRequests, 10);
  assert.equal(initial.usedRequests, null);
  assert.equal(initial.window.id, "change");

  const v2 = { id: "change", schema: "foundation-standard", budget: {
    version: 2, usedRequests: "7", usedTokens: 90
  } };
  runtime.ensureBudgetState(v2);
  assert.equal(v2.budget.usedRequests, 7);
  assert.equal(v2.budget.usedTokens, null);
  assert.equal(v2.budget.measurement, "unavailable-until-external-events");
  assert.equal(v2.budget.window.reason, "runtime-upgrade");

  const legacy = { id: "legacy", schema: "foundation-standard", budget: {
    version: 1, usedRequests: "bad", usedTokens: "12", measurement: "legacy"
  } };
  runtime.ensureBudgetState(legacy);
  assert.equal(legacy.budget.usedRequests, null);
  assert.equal(legacy.budget.usedTokens, 12);
  assert.equal(legacy.budget.measurement, "legacy");
});

test("current budgets normalize lifetime, heal invented zeros, and refresh targets", () => {
  const { runtime } = fixture();
  const state = {
    id: "change", schema: "foundation-standard", impact: "high", size: "l",
    budget: currentBudget({
      measurement: "unavailable-until-external-events",
      lifetime: { usedRequests: "bad", usedTokens: null },
      window: {
        ...currentBudget().window, usedRequests: 0, usedTokens: 0,
        targetRequests: 1, targetTokens: 2
      }
    })
  };
  runtime.ensureBudgetState(state);
  assert.equal(state.budget.lifetime.usedRequests, null);
  assert.equal(state.budget.usedTokens, null);
  assert.equal(state.budget.window.usedRequests, null);
  assert.equal(state.budget.window.usedTokens, null);
  assert.equal(state.budget.window.targetRequests, 40);
  assert.equal(state.budget.window.targetTokens, 200);

  const continued = {
    id: "change", schema: "foundation-standard",
    budget: currentBudget({
      lifetime: { usedRequests: "3", usedTokens: "4" },
      window: {
        ...currentBudget().window, reason: "operator-continue",
        targetRequests: null, targetTokens: 999
      }
    })
  };
  runtime.ensureBudgetState(continued);
  assert.equal(continued.budget.usedRequests, 3);
  assert.equal(continued.budget.usedTokens, 4);
  assert.equal(continued.budget.window.targetRequests, 20);
  assert.equal(continued.budget.window.targetTokens, 999);
});

test("budget activation is idempotent and carries extension authority across runs", () => {
  const { runtime } = fixture();
  const state = { id: "change", schema: "foundation-standard", budget: currentBudget() };
  assert.equal(runtime.activateBudgetWindow(state, null), state.budget.window);
  assert.equal(runtime.activateBudgetWindow(state, "run-1"), state.budget.window);

  state.budget.window = {
    ...state.budget.window, id: "prior", extensionRootId: "root",
    extensionNumber: 1, sequence: 2, mode: "operator-required"
  };
  const next = runtime.activateBudgetWindow(state, "run-2", "new-session", [
    { runId: "run-2", inputTokens: 3 }, { runId: "other", inputTokens: 9 }
  ]);
  assert.equal(next.id, "run-2");
  assert.equal(next.sequence, 3);
  assert.equal(next.baselineRequests, 1);
  assert.equal(next.baselineTokens, 3);
  assert.equal(next.extensionRootId, "root");
  assert.equal(next.extensionNumber, 1);
  assert.equal(next.mode, "operator-required");

  state.budget.window = { ...next, id: "prior-2", extensionRootId: "", extensionNumber: null };
  const fallback = runtime.activateBudgetWindow(state, "run-3");
  assert.equal(fallback.extensionRootId, "prior-2");
  assert.equal(fallback.extensionNumber, 0);
});

test("budget decisions cover unknown, normal, conserve, completion, and operator modes", () => {
  const { runtime } = fixture();
  const state = { id: "change", schema: "foundation-standard", budget: currentBudget() };
  state.budget.window.usedRequests = null;
  state.budget.window.usedTokens = null;
  let decision = runtime.budgetDecision(state);
  assert.equal(decision.measured, false);
  assert.equal(decision.limiter, null);
  assert.equal(decision.action, "CONTINUE");
  assert.deepEqual(decision.allowed, ["scoped-execution"]);
  assert.deepEqual(decision.forbidden, []);

  state.budget.window.usedRequests = 14;
  state.budget.window.usedTokens = 10;
  decision = runtime.budgetDecision(state);
  assert.equal(decision.ratio, 0.7);
  assert.equal(decision.limiter, "requests");
  assert.equal(decision.mode, "conserve");
  assert.equal(decision.action, "BATCH_AND_REUSE");

  state.budget.window.usedRequests = 17;
  state.budget.window.usedTokens = 190;
  decision = runtime.budgetDecision(state);
  assert.equal(decision.ratio, 0.95);
  assert.equal(decision.limiter, "tokens");
  assert.equal(decision.mode, "completion-only");
  assert.equal(decision.recommendation, "STOP_EXPLORATION");
  assert.ok(decision.allowed.includes("focused-fix"));
  assert.ok(decision.forbidden.includes("scope-expansion"));

  state.budget.window.usedTokens = 200;
  decision = runtime.budgetDecision(state);
  assert.equal(decision.action, "COMPLETION_ONLY");
  assert.equal(decision.recommendation, "STOP_AND_RESCOPE");

  state.budget.window.mode = "normal";
  state.budget.window.reason = "operator-continue";
  state.budget.window.targetRequests = 0;
  state.budget.window.targetTokens = 0;
  state.budget.window.usedRequests = 0;
  state.budget.window.usedTokens = 0;
  decision = runtime.budgetDecision(state);
  assert.equal(decision.ratio, 0);
  assert.equal(decision.mode, "normal");

  state.budget.window.mode = "operator-required";
  decision = runtime.budgetDecision(state);
  assert.equal(decision.action, "OPERATOR_REQUIRED");
  assert.equal(decision.recommendation, "CONTINUE_OR_RESCOPE");
  assert.ok(decision.allowed.includes("budget-continue"));
  assert.deepEqual(decision.forbidden, [
    "model-exploration", "new-subagent", "scope-expansion"
  ]);
});

test("applying a decision timestamps exhaustion and stops at the continuation ceiling", () => {
  const { runtime, ticks } = fixture();
  const state = { id: "change", schema: "foundation-standard", budget: currentBudget() };
  state.budget.window.usedRequests = 15;
  let decision = runtime.applyBudgetDecision(state);
  assert.equal(decision.mode, "conserve");
  assert.equal(state.budget.window.exhaustedAt, null);

  state.budget.window.usedRequests = 20;
  state.budget.window.extensionNumber = 3;
  decision = runtime.applyBudgetDecision(state);
  assert.equal(state.budget.window.exhaustedAt, "time-1");
  assert.equal(decision.mode, "operator-required");
  assert.equal(ticks(), 1);

  runtime.applyBudgetDecision(state);
  assert.equal(ticks(), 1);
});

test("usage synchronization subtracts baselines and retains unknown token totals", () => {
  const { runtime } = fixture();
  const state = { id: "change", schema: "foundation-standard", budget: currentBudget() };
  const events = [
    { runId: "run-2", inputTokens: 2, outputTokens: 1 },
    { runId: "run-2", inputTokens: 4 },
    { runId: "other", inputTokens: 8 }
  ];
  const decision = runtime.synchronizeBudgetUsage(
    state, events, "run-2", "host-events", 1
  );
  assert.equal(state.budget.lifetime.usedRequests, 3);
  assert.equal(state.budget.lifetime.usedTokens, 15);
  assert.equal(state.budget.window.baselineRequests, 2);
  assert.equal(state.budget.window.usedRequests, 0);
  assert.equal(state.budget.window.usedTokens, 0);
  assert.equal(decision.mode, "normal");

  runtime.synchronizeBudgetUsage(state, [], "run-2", "unavailable");
  assert.equal(state.budget.usedRequests, null);
  assert.equal(state.budget.usedTokens, null);
  assert.equal(state.budget.window.usedRequests, 0);
  assert.equal(state.budget.window.usedTokens, null);
});
