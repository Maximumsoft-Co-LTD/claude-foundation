import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { aggregateLabRuns } from "../openspec-native/aggregate.mjs";

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
