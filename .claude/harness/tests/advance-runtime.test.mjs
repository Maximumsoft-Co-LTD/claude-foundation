import assert from "node:assert/strict";
import test from "node:test";

import { coordinatorAction } from "../runtime/workflow/advance-runtime.mjs";
import {
  feedbackSnapshotValue, operationCauseCoverage, reviewRepairIntervals
} from "../runtime/observability/feedback-runtime.mjs";

const stableHash = (value) => `hash:${JSON.stringify(value)}`;
const base = {
  id: "change-a",
  state: { status: "building" },
  dispatch: { action: "build-complete" },
  workspaceHash: "workspace-a",
  proofCursor: {},
  authorityRequests: [],
  stableHash
};

test("advance returns bounded Build work without invoking a model", () => {
  const value = coordinatorAction({
    ...base,
    dispatch: { action: "run-in-session", packetCommand: "packet" }
  });
  assert.equal(value.action, "EXECUTE_TASK");
  assert.equal(value.boundary, "host-execution");
  assert.equal(value.resumeCommand, "claude-foundation advance change-a");
});

test("advance exposes current review findings as a repair graph", () => {
  const value = coordinatorAction({
    ...base,
    latestReview: {
      digest: "attempt-a", workspaceHash: "workspace-a", resultStatus: "fail",
      findings: [{
        id: "F1", severity: "major", path: "src/a.mjs",
        claimIds: ["claim-a"], verificationCaseIds: ["case-a"]
      }]
    }
  });
  assert.equal(value.action, "EXECUTE_REPAIR_BATCH");
  assert.equal(value.repairGraph.nodes[0].findingIds[0], "F1");
  assert.equal(value.repairGraph.nodes[0].sourceAttemptDigest, "attempt-a");
});

test("changed repair workspace routes to invalidated evidence", () => {
  const value = coordinatorAction({
    ...base,
    workspaceHash: "workspace-b",
    latestReview: {
      digest: "attempt-a", workspaceHash: "workspace-a", resultStatus: "fail",
      findings: [{ id: "F1", severity: "major", path: "src/a.mjs" }]
    }
  });
  assert.equal(value.action, "RUN_INVALIDATED_EVIDENCE");
  assert.equal(value.boundary, null);
  assert.equal(value.command, "claude-foundation proof advance change-a");
});

test("advance returns configured review and user authority boundaries", () => {
  const review = coordinatorAction({
    ...base,
    authorityRequests: [{
      requestId: "review-1", type: "review", status: "requested"
    }]
  });
  assert.equal(review.action, "RUN_CONFIGURED_REVIEW");
  assert.equal(review.boundary, "external-authority");

  const decision = coordinatorAction({
    ...base,
    proofCursor: { status: "NEEDS_USER_DECISION", decision: { id: "D1" } }
  });
  assert.equal(decision.action, "REQUEST_DECISION");
  assert.equal(decision.boundary, "user-authority");
});

test("Land readiness forbids implicit delivery authority", () => {
  const value = coordinatorAction({
    ...base, state: { status: "proven" },
    proofCursor: { status: "PASS", workspaceHash: "workspace-a" }
  });
  assert.equal(value.action, "LAND_READY");
  assert.deepEqual(value.forbidden, ["commit", "push", "publish", "open-pr", "waive"]);
});

test("successful proof and current review request supersede stale review failure", () => {
  const failedReview = {
    digest: "attempt-a", workspaceHash: "workspace-a", resultStatus: "fail",
    findings: [{ id: "F1", severity: "major", path: "src/a.mjs" }]
  };
  const proven = coordinatorAction({
    ...base, workspaceHash: "workspace-b", latestReview: failedReview,
    proofCursor: { status: "PASS", workspaceHash: "workspace-b" }
  });
  assert.equal(proven.action, "LAND_READY");

  const requested = coordinatorAction({
    ...base, workspaceHash: "workspace-b", latestReview: failedReview,
    authorityRequests: [{ requestId: "review-2", type: "review", status: "requested" }]
  });
  assert.equal(requested.action, "RUN_CONFIGURED_REVIEW");
  assert.equal(requested.requestId, "review-2");
});

test("advance rejects stale proof and uses proof-owned authority routing", () => {
  const stale = coordinatorAction({
    ...base, state: { status: "proven" },
    proofCursor: { status: "PASS", workspaceHash: "workspace-old" }
  });
  assert.equal(stale.action, "RUN_PROOF");

  const capped = coordinatorAction({
    ...base,
    authorityRequests: [{ requestId: "review-3", type: "review", status: "requested" }],
    authorityActions: [{ requestId: "review-3", command: "claude-foundation authority status change-a --request review-3 --template" }]
  });
  assert.equal(capped.action, "RUN_CONFIGURED_REVIEW");
  assert.match(capped.command, /authority status/);
});

test("feedback classifies observed review repair without inventing wait", () => {
  const operations = [{
    version: 3, operation: "proof-advance", status: "completed",
    startedAt: "2026-09-03T06:10:51.110Z"
  }];
  const attempts = [
    {
      status: "completed", resultStatus: "fail", digest: "review-a",
      timestamp: "2026-09-03T05:31:14.991Z",
      completedAt: "2026-09-03T05:40:00.506Z", workspaceHash: "workspace-a",
      findings: [{ id: "F1", severity: "major" }]
    },
    {
      status: "completed", resultStatus: "fail", digest: "review-b",
      timestamp: "2026-09-03T06:14:12.373Z",
      completedAt: "2026-09-03T06:19:28.083Z", workspaceHash: "workspace-b",
      findings: []
    }
  ];
  const intervals = reviewRepairIntervals(operations, attempts);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].durationMs, 1_850_604);
  assert.match(intervals[0].basis, /later-changed-workspace/);

  const snapshot = feedbackSnapshotValue({
    changeId: "change-a",
    metrics: { unattributedWaitMs: 2_000_000, humanWaitMs: null },
    operations,
    reviewAttempts: attempts,
    nextAction: { action: "RUN_PROOF" }
  });
  assert.equal(snapshot.timing.repairMs, 1_850_604);
  assert.equal(snapshot.timing.humanWaitMs, null);
  assert.equal(snapshot.timing.unattributedMs, 149_396);
});

test("feedback keeps legacy blocker cause explicitly unavailable", () => {
  assert.deepEqual(operationCauseCoverage([
    { version: 2, status: "blocked" },
    { version: 3, status: "blocked", blocker: { code: "budget-exhausted" } },
    { version: 3, status: "failed" }
  ]), { blocked: 2, typed: 1, legacyUnavailable: 1, untypedCurrent: 0 });
});
