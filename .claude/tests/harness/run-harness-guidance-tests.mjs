import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  createSourceCohortProvider, normalizedTelemetryHost, usageAvailability
} from "../../harness/runtime/observability/metrics-runtime.mjs";
import { blockerTelemetryValue } from "../../harness/runtime/observability/telemetry-runtime.mjs";
import { reviewRepairIntervals } from "../../harness/runtime/observability/feedback-runtime.mjs";
import { derivedReviewRepairGraph } from "../../harness/runtime/evidence/repair-runtime.mjs";
import { coordinatorAction } from "../../harness/runtime/workflow/advance-runtime.mjs";

const results = [];
const check = (id, operation) => {
  try { operation(); results.push({ id, status: "passed" }); }
  catch (error) {
    results.push({ id, status: "failed" });
    console.error(`${id}: ${error.message}`);
    process.exitCode = 1;
  }
};
const stableHash = (value) => `hash:${JSON.stringify(value)}`;

check("codex-host-source-normalized", () => {
  const event = {
    source: "host-execution", agentId: "codex",
    inputTokens: 10, outputTokens: 5, cost: null
  };
  assert.equal(normalizedTelemetryHost(event), "codex");
  assert.deepEqual(usageAvailability([event]).correlatedHosts, ["codex"]);
  assert.equal(blockerTelemetryValue("authority token conflict", {
    changeId: "change-a", operationName: "advance", phase: "prove"
  }).code, "policy-guard");
});

check("lazy-cohort-contained", () => {
  let calls = 0;
  const provider = createSourceCohortProvider({
    runtimeVersion: "test", protocolBundle: {}, directory: "/runtime",
    digest: () => { calls += 1; throw new Error("unreadable"); }
  });
  assert.equal(calls, 0);
  assert.equal(provider().reason, "source-read-failed");
  assert.equal(calls, 1);
});

const failedReview = {
  digest: "attempt-a", status: "completed", resultStatus: "fail",
  timestamp: "2026-09-03T05:31:14.991Z",
  completedAt: "2026-09-03T05:40:00.506Z", workspaceHash: "workspace-a",
  findings: [{ id: "F1", severity: "major", path: "src/a.mjs" }]
};

check("repair-node-current", () => {
  const graph = derivedReviewRepairGraph(failedReview, stableHash);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].sourceAttemptDigest, "attempt-a");
});

check("advance-stops-at-authority", () => {
  const action = coordinatorAction({
    id: "change-a", state: { status: "proven" },
    dispatch: { action: "build-complete" }, workspaceHash: "workspace-a",
    authorityRequests: [],
    proofCursor: { status: "PASS", workspaceHash: "workspace-a" }, stableHash
  });
  assert.equal(action.action, "ASK_USER");
  assert.equal(action.legacyAction, "LAND_READY");
  assert(action.forbidden.includes("commit"));
  assert(action.forbidden.includes("publish"));
});

check("repair-time-not-wait", () => {
  const intervals = reviewRepairIntervals([{
    operation: "proof-advance", startedAt: "2026-09-03T06:10:51.110Z"
  }], [failedReview, {
    status: "completed", resultStatus: "pass",
    completedAt: "2026-09-03T06:19:28.083Z", workspaceHash: "workspace-b"
  }]);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].kind, "review-repair");
});

check("report-inspects-behavior-before-quiet-label", () => {
  const guide = readFileSync(
    new URL("../../skills/harness-html-report/references/report.md", import.meta.url), "utf8");
  assert.match(guide, /Inspect behavior before naming a gap/);
  assert.match(guide, /reviewer execution, evidenced repair, human wait/);
  assert.match(guide, /ยังระบุสาเหตุไม่ได้/);
});

const report = process.env.FOUNDATION_RESULT_REPORT;
if (report) {
  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(report, JSON.stringify({
    numTotalTests: results.length,
    criticalCases: results
  }, null, 2) + "\n");
}

if (!process.exitCode) console.log(`harness guidance: ALL PASS (${results.length}/${results.length})`);
