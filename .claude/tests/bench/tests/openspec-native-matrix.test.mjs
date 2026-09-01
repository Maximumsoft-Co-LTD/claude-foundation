import assert from "node:assert/strict";
import test from "node:test";

import { executionPlan, loadMatrix, matrixIssues } from "../openspec-native/matrix.mjs";

test("the cross-domain matrix is valid and keeps unmeasured work planned", () => {
  const matrix = loadMatrix();
  assert.deepEqual(matrixIssues(matrix), []);
  assert.equal(matrix.scenarios.length, 7);
  assert.equal(matrix.scenarios.filter((scenario) => scenario.status === "ready").length, 2);
  assert.equal(matrix.scenarios.filter((scenario) => scenario.baseline !== null).length, 1);
});

test("the measured brownfield baseline preserves its real r21 truth", () => {
  const scenario = loadMatrix().scenarios.find(({ id }) => id === "bare-node-boundary");
  assert.equal(scenario.baseline.wall_ms, 566240.411333);
  assert.equal(scenario.baseline.cost_usd, 3.861066);
  assert.equal(scenario.baseline.model_requests, 46);
  assert.equal(scenario.baseline.oracle_score, 6);
  assert.equal(scenario.baseline.oracle_max, 6);
});

test("planned scenarios cannot accidentally spend a live-run budget", () => {
  const matrix = loadMatrix();
  assert.throws(() => executionPlan(matrix, "python-api-validation"), /not ready/);
  assert.throws(() => executionPlan(matrix, "missing"), /unknown/);
  const ready = executionPlan(matrix, "bare-node-boundary");
  assert.equal(ready.smokeRepeats, 1);
  assert.equal(ready.varianceRepeats, 3);
  assert.equal(ready.budget.wall_ms, 900000);
});

test("budget exhaustion pauses for a resumable user decision", () => {
  assert.deepEqual(loadMatrix().execution_policy.budget_exhaustion, {
    terminal_status: "needs-user-decision",
    ask_user: true,
    resumable: true,
    may_report_complete: false,
    may_report_blocked: false
  });
});

test("validation rejects a paid ready scenario without its oracle", () => {
  const matrix = loadMatrix();
  const scenario = matrix.scenarios.find(({ id }) => id === "bare-node-boundary");
  scenario.oracle.required = false;
  assert.ok(matrixIssues(matrix).some((issue) => issue.includes("require a hidden oracle")));
});
