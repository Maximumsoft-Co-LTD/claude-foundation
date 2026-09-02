import assert from "node:assert/strict";
import test from "node:test";

import { buildReleaseReport } from "../openspec-native/release-report.mjs";

const matrix = {
  protocol: "matrix-v2",
  execution_policy: { variance_repeats: 3 },
  scenarios: [
    { id: "paid", execution: "paid" },
    { id: "deterministic", execution: "deterministic" }
  ]
};
const sentinel = {
  status: "pass", matrixDigest: "sha256:matrix", zeroModelSpend: true,
  source: { commit: "abc", dirty: false, patchDigest: "sha256:patch" },
  scenarios: [{ id: "paid", status: "pass" }, { id: "deterministic", status: "pass" }]
};

test("release report keeps missing paid authority explicit", () => {
  const report = buildReleaseReport({ matrix, sentinel });
  assert.equal(report.releaseReady, false);
  assert.equal(report.status, "blocked");
  assert.equal(report.scenarios[0].blocker, "authorized-paid-smoke-missing");
  assert.equal(report.scenarios[1].stage, "deterministic-green");
});

test("release report promotes only three strict, measured repeats", () => {
  const measurement = { measured: 3, unavailable: 0 };
  const aggregate = {
    scenario: "paid", runs: 3, strictPasses: 3, strictPass: true,
    paidModelRuns: 3, paidModelStrictPasses: 3, paidModelStrictPass: true,
    reliabilityRate: 1, medianWallMs: 100, p95WallMs: 120,
    medianCostUsd: 1, p95CostUsd: 2, medianModelRequests: 3,
    p95ModelRequests: 4, medianResumptions: 0, p95Resumptions: 1,
    measurements: { wallMs: measurement, costUsd: measurement }, runDirs: ["a", "b", "c"]
  };
  const report = buildReleaseReport({ matrix, sentinel, aggregates: [aggregate] });
  assert.equal(report.releaseReady, true);
  assert.equal(report.scenarios[0].stage, "repeated-green");
  assert.equal(report.scenarios[0].paid.p95Resumptions, 1);
});
