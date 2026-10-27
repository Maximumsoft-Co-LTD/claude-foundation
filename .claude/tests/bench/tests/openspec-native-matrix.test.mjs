import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve, relative } from 'node:path';
import { buildRepositoryCatalog } from '../../../harness/runtime/workflow/repository-topology.mjs';

import { directoryDigest } from "../openspec-native/lab.mjs";
import { executionPlan, loadMatrix, matrixIssues } from "../openspec-native/matrix.mjs";

const ROOT = resolve(import.meta.dirname, "../../../..");

// The paid work-type scenarios added for complete-change-packets: one per
// catalog work type that had no scenario (29-33 product, 34-41 operations),
// each with its named critical cases.
const WORK_TYPE_SCENARIOS = [
  ["library-cli-flag", "29-library-cli-flag", "library-public-api",
    ["CASE_JSON_FLAG", "CASE_JSON_ERRORS_KEEP_EXIT_CODES", "CASE_PLAIN_OUTPUT_UNCHANGED"]],
  ["platform-migration", "30-platform-migration", "platform-migration",
    ["CASE_PARITY_ALL_TIMES", "CASE_CRON_ENTRY_UNCHANGED", "CASE_FAILURE_ISOLATED"]],
  ["webhook-integration", "31-webhook-integration", "external-integration",
    ["CASE_BAD_SIGNATURE", "CASE_STALE_TIMESTAMP", "CASE_DUPLICATE_EVENT"]],
  ["config-flag", "32-config-flag", "config-contract",
    ["CASE_DEFAULT", "CASE_ENV_OVERRIDE", "CASE_INVALID_REJECTED", "CASE_ERROR_MESSAGE"]],
  ["dependency-upgrade", "33-dependency-upgrade", "dependency-upgrade",
    ["CASE_LOCKFILE_UPGRADED", "CASE_RESOLVES_V2", "CASE_PATHS_UNCHANGED"]],
  ["deprecate-option", "34-deprecate-option", "deprecation-plan",
    ["CASE_NEW_OPTION", "CASE_CLI_WARNING_ONCE", "CASE_LIBRARY_WARNING_ONCE"]],
  ["infra-config", "35-infra-config", "infra-plan",
    ["CASE_PROBE_DEFAULT_PATH", "CASE_DEFAULT_RESOURCES", "CASE_OTHER_FIELDS_UNCHANGED"]],
  ["add-metrics", "36-add-metrics", "observability-signal",
    ["CASE_FAILED_COUNTER", "CASE_FAILURE_LOG", "CASE_NO_CUSTOMER_DATA"]],
  ["privacy-erasure", "37-privacy-erasure", "privacy-erasure",
    ["CASE_PERSONAL_FIELDS_ERASED", "CASE_FINANCIAL_TOTALS_RETAINED", "CASE_AUDIT_ENTRY"]],
  ["feature-experiment", "38-feature-experiment", "experiment-flag",
    ["CASE_STABLE_ASSIGNMENT", "CASE_SPLIT_NEAR_EVEN", "CASE_EXPOSURE_ONCE", "CASE_KILL_SWITCH"]],
  ["client-version-gate", "39-client-version-gate", "client-release-compat",
    ["CASE_SUPPORTED_VERSIONS_SERVED", "CASE_OLD_VERSIONS_REJECTED", "CASE_NUMERIC_COMPARISON"]],
  ["ml-eval-threshold", "40-ml-eval-threshold", "model-evaluation",
    ["CASE_EVALUATION_MEETS_THRESHOLD", "CASE_HELD_OUT_ACCURACY", "CASE_FALLBACK_ON_THROW"]],
  ["security-hotfix", "41-security-hotfix", "security-hotfix",
    ["CASE_ENCODED_TRAVERSAL", "CASE_NESTED_TRAVERSAL", "CASE_NORMAL_FILES_SERVED"]]
];

function fixtureDigest(path) {
  return statSync(path).isDirectory() ? directoryDigest(path)
    : `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

// Ready scenarios whose frozen fixture no longer matches its recorded digest.
function staleFixtures(matrix) {
  return matrix.scenarios
    .filter((scenario) => scenario.status === "ready" && scenario.fixture)
    .filter((scenario) => fixtureDigest(resolve(ROOT, scenario.fixture)) !== scenario.fixture_digest)
    .map(({ id }) => id);
}

test("the versioned cross-domain matrix is valid and every workload is executable", () => {
  const matrix = loadMatrix();
  assert.equal(matrix.protocol, "foundation-openspec-native-matrix-v2");
  assert.deepEqual(matrixIssues(matrix), []);
  assert.equal(matrix.scenarios.length, 30);
  assert.equal(matrix.scenarios.filter((scenario) => scenario.status === "ready").length, 30);
  assert.equal(matrix.scenarios.filter((scenario) => scenario.baseline !== null).length, 1);
});

test("a lifecycle lane must declare its protocol, phase files and repositories", () => {
  const matrix = loadMatrix();
  const lane = matrix.scenarios.find(({ id }) => id === "order-inventory-lifecycle");
  assert.equal(lane.lifecycle.protocol, "foundation-openspec-native-lifecycle-v1");
  assert.ok(lane.critical_case_ids.some((id) => id.startsWith("CASE_RELEASE_")));
  assert.ok(lane.critical_case_ids.some((id) => id.startsWith("CASE_B_")));
  for (const [mutate, expected] of [
    [(row) => { row.lifecycle.amendment.file = "MISSING.md"; }, /lifecycle needs/],
    [(row) => { row.lifecycle.protocol = "other"; }, /lifecycle needs/],
    [(row) => { delete row.repository_catalog; }, /lifecycle lane needs/]
  ]) {
    const broken = structuredClone(matrix);
    mutate(broken.scenarios.find(({ id }) => id === "order-inventory-lifecycle"));
    assert.ok(matrixIssues(broken).some((issue) => expected.test(issue)), String(expected));
  }
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

test("the tiny-feature scenario caps host tool calls and binds its oracle", () => {
  const plan = executionPlan(loadMatrix(), "tiny-feature");
  assert.equal(plan.execution, "paid");
  assert.equal(plan.budget.tool_calls, 80);
  assert.match(plan.fixture, /20-tiny-feature\/seed$/);
  assert.match(plan.oracle, /20-tiny-feature\/oracle\/run\.sh$/);
  assert.match(plan.prompt, /discount\(total, percent\)/);
});

test("the ~10-minute feature scenarios bind their hidden oracles and budgets", () => {
  const matrix = loadMatrix();
  for (const [id, task, prompt] of [
    ["notes-api", "21-notes-api", /NOTES-API\.md/],
    ["cart-coupons", "22-cart-coupons", /COUPONS\.md/]
  ]) {
    const plan = executionPlan(matrix, id);
    assert.equal(plan.execution, "paid");
    assert.deepEqual(plan.budget,
      { wall_ms: 1800000, cost_usd: 10, model_requests: 150, tool_calls: 150 });
    assert.match(plan.fixture, new RegExp(`${task}/seed$`));
    assert.match(plan.oracle, new RegExp(`${task}/oracle/run\\.sh$`));
    assert.match(plan.prompt, prompt);
    assert.ok(plan.criticalCaseIds.includes("CASE_TESTS_EXIST"));
  }
});

test("the evidence-gate scenarios bind hidden oracles, small budgets, and plain prompts", () => {
  const matrix = loadMatrix();
  for (const [id, task, cases] of [
    ["owner-only-delete", "25-owner-only-delete", ["CASE_OTHER_USER_403", "CASE_ADMIN_DELETE"]],
    ["idempotent-refund", "26-idempotent-refund", ["CASE_RESTART_DEDUPES", "CASE_CONCURRENT_DUPLICATES"]],
    ["speed-up-search", "27-speed-up-search", ["CASE_RESULTS_IDENTICAL", "CASE_SPEEDUP_3X"]],
    ["regression-fix-with-fixes", "28-regression-fix-with-fixes", ["CASE_UPPER_BOUNDARY", "CASE_TESTS_DETECT_SEED"]]
  ]) {
    const plan = executionPlan(matrix, id);
    assert.equal(plan.execution, "paid");
    assert.deepEqual(plan.budget,
      { wall_ms: 1800000, cost_usd: 3, model_requests: 150, tool_calls: 150 });
    assert.match(plan.fixture, new RegExp(`${task}/seed$`));
    assert.match(plan.oracle, new RegExp(`${task}/oracle/run\\.sh$`));
    for (const value of cases) assert.ok(plan.criticalCaseIds.includes(value), `${id}: ${value}`);
    // The agent must classify the risk itself: the task text names product
    // behavior only, never Change Loop vocabulary.
    assert.doesNotMatch(plan.prompt, /risk|signal|access|financial|fixes|openspec|archiv/i, id);
  }
});

test("the large project-tracker scenario binds its hidden oracle and budget", () => {
  const plan = executionPlan(loadMatrix(), "project-tracker-api");
  assert.equal(plan.execution, "paid");
  assert.deepEqual(plan.budget,
    { wall_ms: 3600000, cost_usd: 15, model_requests: 300, tool_calls: 300 });
  assert.match(plan.fixture, /23-project-tracker-api\/seed$/);
  assert.match(plan.oracle, /23-project-tracker-api\/oracle\/run\.sh$/);
  assert.match(plan.prompt, /TRACKER-API\.md/);
  assert.ok(plan.criticalCaseIds.length >= 30);
  assert.ok(plan.criticalCaseIds.includes("CASE_TESTS_EXIST"));
  assert.ok(plan.criticalCaseIds.includes("CASE_NO_LOST_UPDATE"));
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

test("order/inventory binds its three product repositories and transaction cases", () => {
  const matrix = loadMatrix();
  const plan = executionPlan(matrix, 'order-inventory');
  assert.equal(plan.risk, 'high');
  assert.match(plan.fixture, /24-order-inventory\/seed$/);
  assert.equal(plan.criticalCaseIds.length, 19);
  assert.ok(plan.criticalCaseIds.includes('CASE_CONCURRENT_STOCK'));
  assert.equal(plan.cleanInstallCommand, 'npm install --ignore-scripts --offline');
  const scenario = matrix.scenarios.find(({id}) => id === 'order-inventory');
  assert.deepEqual(scenario.repository_catalog.repositories.map(({id}) => id),
    ['backend', 'sdk', 'web']);
  const root = resolve(plan.fixture);
  const catalog = buildRepositoryCatalog({root, configured:scenario.repository_catalog, discovered:[],
    canonicalPath:resolve, pathInside:(parent,child)=>!relative(parent,child).startsWith('..'),
    fail:message=>{throw new Error(message);}});
  assert.deepEqual(catalog.repositories.map(({id})=>id), ['root','backend','sdk','web']);
  scenario.repository_catalog.repositories[0].path = '../outside';
  assert.ok(matrixIssues(matrix).some(issue => issue.includes('invalid repository_catalog entry')));
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

test("every ready fixture matches its recorded digest", () => {
  const matrix = loadMatrix();
  assert.deepEqual(staleFixtures(matrix), []);
  matrix.scenarios.find(({ id }) => id === "config-flag").fixture_digest = `sha256:${"0".repeat(64)}`;
  assert.deepEqual(staleFixtures(matrix), ["config-flag"]);
});

test("every uncovered work type has a ready paid scenario within the small budget", () => {
  const matrix = loadMatrix();
  for (const [id, task, workload, cases] of WORK_TYPE_SCENARIOS) {
    const scenario = matrix.scenarios.find((row) => row.id === id);
    assert.equal(scenario?.workload, workload, id);
    const plan = executionPlan(matrix, id);
    assert.equal(plan.execution, "paid");
    assert.equal(plan.host, "claude-code");
    assert.ok(plan.budget.cost_usd > 0 && plan.budget.cost_usd <= 3, id);
    assert.ok(plan.budget.wall_ms <= 1800000, id);
    assert.equal(plan.projectCommand, "node --test");
    assert.match(plan.fixture, new RegExp(`${task}/seed$`));
    assert.match(plan.oracle, new RegExp(`${task}/oracle/run\\.sh$`));
    assert.match(plan.prompt, /^\/dev /);
    assert.doesNotMatch(plan.prompt, /risk|signal|openspec|archiv|work type/i, id);
    for (const value of cases) assert.ok(plan.criticalCaseIds.includes(value), `${id}: ${value}`);
  }
});

test("each work-type oracle fails the unmodified seed at a named critical case", () => {
  const matrix = loadMatrix();
  for (const [id, , , cases] of WORK_TYPE_SCENARIOS) {
    const plan = executionPlan(matrix, id);
    const run = spawnSync("sh", [resolve(ROOT, plan.oracle), resolve(ROOT, plan.fixture)],
      { encoding: "utf8", timeout: 180000 });
    assert.equal(run.status, 0, `${id}: ${run.stderr}`);
    const verdict = JSON.parse(run.stdout.trim().split("\n").at(-1));
    assert.equal(verdict.verdict, "fail", id);
    assert.deepEqual(Object.keys(verdict.results).sort(), [...plan.criticalCaseIds].sort(), id);
    assert.ok(cases.some((value) => verdict.results[value] === "fail"), `${id}: no critical case failed`);
  }
});
