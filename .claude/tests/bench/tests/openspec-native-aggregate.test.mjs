import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  aggregateLabRuns, compareArms, formatArmComparison
} from "../openspec-native/aggregate.mjs";

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

test("lab aggregate requires every lifecycle, oracle, quality, and delivery gate", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-lab-aggregate-"));
  try {
    for (const [runId, wallMs] of [["r1", 100], ["r2", 200], ["r3", 300]]) {
      write(join(root, runId, "manifest.json"), {
        runId, scenario: "fixture", strictPass: true,
        source: { commit: "abc", patchDigest: runId === "r3" ? "old" : "current" },
        verification: {
          projectCommand: { status: "pass" }, cleanInstall: { status: "pass" },
          cleanInstallProjectCommand: { status: "pass" }
        }
      });
      write(join(root, runId, "openspec-native-runs", runId, "scorecard.json"), {
        outcome: { status: "completed", complete: true },
        oracle: { configured: true, verdict: "pass" },
        quality: { fail: 0, coverageMinimum: 90, crapMaximum: 3 },
        timing: { wallMs }, usage: { costUsd: 1, modelRequests: runId === "r3" ? 0 : 2 },
        operations: { total: 4 }, evidenceReuse: { resumptions: wallMs === 300 ? 1 : 0 }
      });
    }
    const [summary] = aggregateLabRuns(root);
    assert.equal(summary.strictPass, true);
    assert.equal(summary.strictPasses, 3);
    assert.equal(summary.paidModelRuns, 2);
    assert.equal(summary.paidModelStrictPasses, 2);
    assert.equal(summary.medianWallMs, 200);
    assert.equal(summary.p95WallMs, 300);
    assert.equal(summary.reliabilityRate, 1);
    assert.equal(summary.medianResumptions, 0);
    assert.equal(summary.p95Resumptions, 1);
    assert.deepEqual(summary.measurements.costUsd, { measured: 3, unavailable: 0 });
    assert.equal(summary.cleanInstallPasses, 3);
    write(join(root, "r3", "openspec-native-runs/r3/scorecard.json"), {
      outcome: { status: "completed", complete: true },
      oracle: { configured: true, verdict: "fail" }, quality: { fail: 0 }
    });
    assert.equal(aggregateLabRuns(root)[0].strictPass, false);
    const degraded = aggregateLabRuns(root)[0];
    assert.equal(degraded.reliabilityRate, 0.666667);
    assert.deepEqual(degraded.measurements.costUsd, { measured: 2, unavailable: 1 });
    const [current] = aggregateLabRuns(root, { commit: "abc", patchDigest: "current" });
    assert.equal(current.runs, 2);
    assert.equal(current.strictPass, true,
      "a failed historical source must not poison the current release cohort");
    assert.equal(current.paidModelRuns, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("aggregate groups by arm across result roots and compares arms pairwise", () => {
  const changeLoopRoot = mkdtempSync(join(tmpdir(), "foundation-lab-arm-cl-"));
  const baselineRoot = mkdtempSync(join(tmpdir(), "foundation-lab-arm-base-"));
  const row = (root, runId, arm, { cost, wallMs, requests, tools, prompts, score, max }) => {
    write(join(root, runId, "manifest.json"), {
      runId, scenario: "fixture", strictPass: score === max, ...(arm ? { arm } : {}),
      verification: { projectCommand: { status: "pass" } }
    });
    write(join(root, runId, "openspec-native-runs", runId, "scorecard.json"), {
      ...(arm ? { arm } : {}),
      outcome: { status: score === max ? "completed" : "failed", complete: score === max },
      oracle: { configured: true, verdict: score === max ? "pass" : "fail", score, max },
      quality: { fail: 0 }, timing: { wallMs },
      usage: { costUsd: cost, modelRequests: requests, costMeasurement: "measured" },
      operations: { total: 0, hostToolCalls: { total: tools } },
      friction: { permissionPrompts: prompts, hookBlocks: 0, toolErrors: prompts }
    });
  };
  try {
    // Pre-arm manifests carry no arm and remain Change Loop rows.
    row(changeLoopRoot, "cl-1", null,
      { cost: 0.9, wallMs: 90000, requests: 12, tools: 15, prompts: 1, score: 6, max: 6 });
    row(baselineRoot, "base-1", "baseline",
      { cost: 0.3, wallMs: 30000, requests: 8, tools: 9, prompts: 0, score: 5, max: 6 });
    const aggregates = aggregateLabRuns([changeLoopRoot, baselineRoot]);
    assert.deepEqual(aggregates.map(({ scenario, arm }) => `${scenario}/${arm}`),
      ["fixture/change-loop", "fixture/baseline"]);
    assert.equal(aggregates[0].medianToolCalls, 15);
    assert.equal(aggregates[1].strictPass, false);
    assert.equal(aggregates[1].medianOracleScore, 5);
    const [comparison] = compareArms(aggregates);
    assert.equal(comparison.scenario, "fixture");
    assert.equal(comparison.changeLoop.oraclePasses, 1);
    assert.equal(comparison.baseline.oraclePasses, 0);
    assert.deepEqual(comparison.delta, {
      oraclePasses: 1, medianOracleScore: 1, medianCostUsd: 0.6, medianWallMs: 60000,
      medianModelRequests: 4, medianToolCalls: 6, permissionPrompts: 1
    });
    const table = formatArmComparison([comparison, {
      scenario: "cl-only", changeLoop: comparison.changeLoop, baseline: null, delta: null
    }]);
    assert.match(table, /\| fixture \| 1\/1 \(6\/6\) \| 0\/1 \(5\/6\) \| \$0\.9000 \| \$0\.3000 \| 90\.0s \| 30\.0s \| 12 \| 8 \| 15 \| 9 \| 1 \| 0 \|/);
    assert.match(table, /\| cl-only \| 1\/1 \(6\/6\) \| - \|/, "a missing arm is shown, not zeroed");
  } finally {
    rmSync(changeLoopRoot, { recursive: true, force: true });
    rmSync(baselineRoot, { recursive: true, force: true });
  }
});
