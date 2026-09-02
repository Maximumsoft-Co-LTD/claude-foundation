import assert from "node:assert/strict";
import test from "node:test";

import { executionPlan, loadMatrix, matrixIssues } from "../openspec-native/matrix.mjs";

test("the versioned cross-domain matrix is valid and every workload is executable", () => {
  const matrix = loadMatrix();
  assert.equal(matrix.protocol, "foundation-openspec-native-matrix-v2");
  assert.deepEqual(matrixIssues(matrix), []);
  assert.equal(matrix.scenarios.length, 7);
  assert.equal(matrix.scenarios.filter((scenario) => scenario.status === "ready").length, 7);
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
  const typescript = matrix.scenarios.find(({ id }) => id === "typescript-react-state");
  typescript.status = "planned";
  assert.throws(() => executionPlan(matrix, "typescript-react-state"), /not ready/);
  typescript.status = "ready";
  assert.throws(() => executionPlan(matrix, "missing"), /unknown/);
  const ready = executionPlan(matrix, "bare-node-boundary");
  assert.equal(ready.smokeRepeats, 1);
  assert.equal(ready.varianceRepeats, 3);
  assert.equal(ready.budget.wall_ms, 1800000);
  assert.equal(ready.budget.model_requests, 150);
  const python = executionPlan(matrix, "python-api-validation");
  assert.equal(python.budget.wall_ms, 1500000);
  assert.match(python.fixture, /15-python-api-validation\/seed$/);
  assert.match(python.oracle, /15-python-api-validation\/oracle\/run\.sh$/);
  const scenario = matrix.scenarios.find(({ id }) => id === "python-api-validation");
  const attempt = scenario.last_attempt;
  assert.equal(attempt.status, "needs-user-decision");
  assert.equal(attempt.model_requests, 30);
  assert.equal(attempt.readiness.external_provider, "review");
  assert.equal(attempt.readiness.budget_class, "external-authority");
  assert.equal(attempt.post_stop_oracle.verdict, "pass");
  assert.equal(attempt.post_stop_quality.fail, 1);
  assert.equal(attempt.cumulative.model_requests, 147);
  assert.equal(attempt.baseline_eligible, false);
  assert.equal(scenario.prior_attempt.post_stop_oracle.verdict, "pass");
  assert.equal(scenario.prior_attempt.post_stop_quality.fail, 3);
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

test("a user-decision attempt cannot be promoted to a baseline", () => {
  const matrix = loadMatrix();
  const scenario = matrix.scenarios.find(({ id }) => id === "python-api-validation");
  scenario.last_attempt.baseline_eligible = true;
  assert.ok(matrixIssues(matrix).some((issue) =>
    issue.includes("user-decision attempts cannot become baselines")));
});

test("validation rejects a paid ready scenario without its oracle", () => {
  const matrix = loadMatrix();
  const scenario = matrix.scenarios.find(({ id }) => id === "bare-node-boundary");
  scenario.oracle.required = false;
  assert.ok(matrixIssues(matrix).some((issue) => issue.includes("require a hidden oracle")));
});

test("validation rejects a ready scenario with an incomplete fixture manifest", () => {
  const matrix = loadMatrix();
  const scenario = matrix.scenarios.find(({ id }) => id === "bare-node-boundary");
  delete scenario.fixture_digest;
  scenario.critical_case_ids = [];
  const issues = matrixIssues(matrix);
  assert.ok(issues.some((issue) => issue.includes("fixture_digest is required")));
  assert.ok(issues.some((issue) => issue.includes("critical_case_ids are required")));
});
