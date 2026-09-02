import assert from "node:assert/strict";
import test from "node:test";

import { buildRolloutReport } from "../../../../scripts/release/rollout-report.mjs";

const metricNames = ["terminal_truth", "phase_violations", "proof_failures",
  "land_recoveries", "reviewer_ci_waits", "resumptions", "model_requests",
  "cost_usd", "wall_ms"];

function observation(overrides = {}) {
  return {
    protocol: "foundation-rollout-observation-v1", stage: "dogfood", release: "3.4.11",
    startedAt: "2026-09-01T00:00:00Z", endedAt: "2026-09-02T00:00:00Z",
    consumers: 1, baselineDigest: "a".repeat(64), rollbackRehearsed: true,
    metrics: Object.fromEntries(metricNames.map((name) =>
      [name, { value: name === "cost_usd" ? null : 0,
        availability: name === "cost_usd" ? "unavailable" : "measured" }])),
    baselineMetrics: Object.fromEntries(metricNames.map((name) =>
      [name, { value: name === "cost_usd" ? null : 0,
        availability: name === "cost_usd" ? "unavailable" : "measured" }])),
    differences: [], stopConditions: [], incidents: [],
    evidence: [{ url: "https://example.test/runs/immutable", sha256: "b".repeat(64) }],
    ...overrides
  };
}

test("a complete privacy-safe dogfood observation can become production-observed", () => {
  const report = buildRolloutReport(observation());
  assert.equal(report.status, "production-observed");
  assert.deepEqual(report.blockers, []);
  assert.equal(report.metrics.find((row) => row.name === "cost_usd").value, null);
});

test("content, stop conditions, and unresolved incidents fail closed", () => {
  const report = buildRolloutReport(observation({
    prompt: "private product request", stopConditions: ["false-success"],
    incidents: [{ id: "INC-1", severity: "P0", status: "open" }]
  }));
  assert.equal(report.status, "blocked");
  for (const blocker of ["product-content-present", "rollout-stop-condition-observed",
    "unresolved-p0-p1-incident", "incident-reproduction-missing",
    "incident-regression-missing", "incident-scenarioDisposition-missing"])
    assert.ok(report.blockers.includes(blocker), blocker);
});

test("unavailable metrics cannot be represented as numeric zero", () => {
  const bad = observation();
  bad.metrics.cost_usd = { value: 0, availability: "unavailable" };
  assert.ok(buildRolloutReport(bad).blockers.includes("invalid-metric:cost_usd"));
});

test("a pilot difference requires one supported causal classification", () => {
  const unclassified = observation();
  unclassified.metrics.wall_ms.value = 10;
  assert.ok(buildRolloutReport(unclassified).blockers.includes(
    "unclassified-baseline-difference:wall_ms"));
  unclassified.differences = [{ metric: "wall_ms", classification: "consumer-topology",
    evidence: "https://example.test/comparison" }];
  assert.ok(!buildRolloutReport(unclassified).blockers.includes(
    "unclassified-baseline-difference:wall_ms"));
});
