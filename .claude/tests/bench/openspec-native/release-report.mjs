#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { aggregateLabRuns } from "./aggregate.mjs";
import { loadMatrix, matrixIssues } from "./matrix.mjs";
import { DEFAULT_ARM } from "./scorecard.mjs";
import { runDeterministicSentinel } from "./sentinel.mjs";
import { timeGateReport } from "./time-gate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RESULTS = resolve(HERE, "../results/openspec-native-lab");

// Only Change Loop rows are release evidence. A no-harness baseline row is a
// comparison measurement and can never promote, or block, a matrix row.
export function changeLoopAggregates(aggregates = []) {
  return aggregates.filter((row) => (row.arm || DEFAULT_ARM) === "change-loop");
}

export function buildReleaseReport({ matrix, sentinel, aggregates = [], timeGate = null }) {
  const evidence = changeLoopAggregates(aggregates);
  const byScenario = new Map(evidence.map((row) => [row.scenario, row]));
  const scenarios = matrix.scenarios.map((scenario) => {
    const deterministic = sentinel.scenarios.find((row) => row.id === scenario.id);
    const aggregate = byScenario.get(scenario.id) || null;
    let stage = deterministic?.status === "pass" ? "deterministic-green" : "blocked";
    let blocker = deterministic?.status === "pass" ? null : "deterministic-sentinel-failed";
    if (scenario.execution === "paid") {
      if (!aggregate?.paidModelRuns) blocker = "authorized-paid-smoke-missing";
      else if (!aggregate.paidModelStrictPass) {
        stage = "blocked";
        blocker = "paid-run-failed-release-gate";
      } else if (aggregate.paidModelStrictPasses >= matrix.execution_policy.variance_repeats) {
        stage = "repeated-green";
        blocker = null;
      } else {
        stage = "smoke-green";
        blocker = "paid-repeat-count-incomplete";
      }
    }
    return {
      id: scenario.id, execution: scenario.execution, stage, blocker,
      deterministic: deterministic || null,
      paid: aggregate ? {
        runs: aggregate.runs, strictPasses: aggregate.strictPasses,
        paidModelRuns: aggregate.paidModelRuns,
        paidModelStrictPasses: aggregate.paidModelStrictPasses,
        reliabilityRate: aggregate.reliabilityRate,
        medianWallMs: aggregate.medianWallMs, p95WallMs: aggregate.p95WallMs,
        medianCostUsd: aggregate.medianCostUsd, p95CostUsd: aggregate.p95CostUsd,
        medianModelRequests: aggregate.medianModelRequests,
        p95ModelRequests: aggregate.p95ModelRequests,
        medianResumptions: aggregate.medianResumptions,
        p95Resumptions: aggregate.p95Resumptions,
        measurements: aggregate.measurements,
        runDirs: aggregate.runDirs
      } : null
    };
  });
  const ready = scenarios.every((row) => row.execution === "deterministic"
    ? row.stage === "deterministic-green" : row.stage === "repeated-green");
  return {
    version: 1,
    protocol: "foundation-release-evidence-index-v1",
    matrixProtocol: matrix.protocol,
    sentinel: {
      status: sentinel.status,
      matrixDigest: sentinel.matrixDigest,
      source: sentinel.source,
      zeroModelSpend: sentinel.zeroModelSpend
    },
    scenarios,
    // Advisory paid evidence (1.3x wall-time target against the no-harness
    // baseline): visible in the report, never part of `releaseReady`.
    advisories: timeGate ? [{ id: "time-gate", status: timeGate.status,
      reason: timeGate.reason, targetRatio: timeGate.targetRatio, tiers: timeGate.tiers }] : [],
    excludedComparisonRuns: aggregates.filter((row) => !evidence.includes(row))
      .reduce((total, row) => total + Number(row.runs || 0), 0),
    releaseReady: ready,
    status: ready ? "ready" : "blocked",
    blockedCount: scenarios.filter((row) => row.blocker).length
  };
}

export function releaseReport(resultsRoot = DEFAULT_RESULTS) {
  const matrix = loadMatrix();
  const issues = matrixIssues(matrix);
  if (issues.length) throw new Error(`invalid matrix:\n${issues.join("\n")}`);
  const sentinel = runDeterministicSentinel();
  const aggregates = existsSync(resultsRoot)
    ? aggregateLabRuns(resultsRoot, sentinel.source) : [];
  const timeGate = existsSync(resultsRoot) ? timeGateReport([resultsRoot]) : null;
  return buildReleaseReport({ matrix, sentinel, aggregates, timeGate });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = releaseReport(process.argv[2] || DEFAULT_RESULTS);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.releaseReady) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
