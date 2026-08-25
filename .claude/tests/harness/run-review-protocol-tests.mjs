import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createReviewProtocol } from "../../harness/runtime/evidence/review-protocol.mjs";

const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");
const fail = (message) => { throw new Error(message); };
const protocol = createReviewProtocol({ stableHash, fail });

function fixture() {
  const paths = ["src/a.mjs", "src/b.mjs"];
  const workspaceHash = "workspace";
  const receipt = {
    workspaceHash,
    status: "pass",
    review: {
      round: 1,
      requestId: "request",
      packetDigest: "packet",
      reviewer: {
        type: "ai", identity: "reviewer", providerFamily: "openai",
        modelFamily: "gpt", modelId: "gpt-review", sessionId: "session"
      },
      findings: {
        verified: 1, unresolvedBlockers: 0,
        items: [{ id: "finding-1" }], verifiedIds: ["finding-1"]
      },
      scope: {
        mode: "full", paths, baseAttemptDigest: null,
        dispatchDigest: "dispatch",
        digest: stableHash({ priorWorkspaceHash: null, workspaceHash, paths })
      },
      repairClosure: {
        sourceAttemptDigest: "source-attempt",
        evidenceBindings: [{ id: "binding-1" }]
      }
    }
  };
  const common = {
    workspaceHash,
    reviewerType: "ai",
    attempt: 1,
    requestId: "request",
    reviewerIdentity: "reviewer",
    reviewerProviderFamily: "openai",
    reviewerModelFamily: "gpt",
    reviewerModelId: "gpt-review",
    reviewerSessionId: "session",
    packetDigest: "packet"
  };
  return { receipt, common, paths };
}

test("review attempt protocol accepts valid versions 1 through 4", () => {
  const { receipt, common, paths } = fixture();
  assert.equal(protocol.attemptIsValid(receipt, {
    ...common, version: 1, reviewBinding: protocol.receiptBinding(receipt)
  }), true);
  assert.equal(protocol.attemptIsValid(receipt, {
    ...common, version: 2, status: "dispatched",
    scope: { mode: "full", paths, baseAttemptDigest: null, digest: "dispatch" }
  }), true);
  assert.equal(protocol.attemptIsValid(receipt, {
    ...common, version: 3, status: "completed", resultStatus: "pass",
    findings: [{ id: "finding-1" }], verifiedFindingIds: ["finding-1"],
    scope: { mode: "full", paths: [...paths].reverse(), baseAttemptDigest: null, digest: "dispatch" }
  }), true);
  assert.equal(protocol.attemptIsValid(receipt, {
    ...common, version: 4, status: "completed", resultStatus: "pass",
    sourceAttemptDigest: "source-attempt",
    evidenceBindings: [{ id: "binding-1" }], verifiedFindingIds: ["finding-1"],
    scope: { mode: "repair-closure", paths, baseAttemptDigest: null, digest: "dispatch" }
  }), true);
});

test("review attempt protocol rejects common binding mismatches", () => {
  const { receipt, common } = fixture();
  assert.equal(protocol.attemptIsValid(receipt, null), false);
  for (const patch of [
    { workspaceHash: "stale" }, { reviewerType: "human" }, { attempt: 2 }
  ]) assert.equal(protocol.attemptIsValid(receipt, {
    ...common, ...patch, version: 1, reviewBinding: protocol.receiptBinding(receipt)
  }), false);

  const blockers = structuredClone(receipt);
  blockers.review.findings.unresolvedBlockers = 1;
  blockers.review.scope.digest = stableHash({
    priorWorkspaceHash: null,
    workspaceHash: blockers.workspaceHash,
    paths: blockers.review.scope.paths
  });
  assert.equal(protocol.attemptIsValid(blockers, {
    ...common, version: 1, reviewBinding: protocol.receiptBinding(blockers)
  }), false);

  const invalidCount = structuredClone(receipt);
  invalidCount.review.findings.verified = -1;
  assert.equal(protocol.attemptIsValid(invalidCount, {
    ...common, version: 1, reviewBinding: protocol.receiptBinding(invalidCount)
  }), false);

  const failedReview = structuredClone(receipt);
  failedReview.status = "fail";
  failedReview.review.findings.unresolvedBlockers = 1;
  assert.equal(protocol.attemptIsValid(failedReview, {
    ...common, version: 1, reviewBinding: protocol.receiptBinding(failedReview)
  }), true, "failed reviews may retain unresolved blockers");

  const emptyScope = structuredClone(receipt);
  emptyScope.review.scope.paths = null;
  emptyScope.review.scope.digest = stableHash({
    priorWorkspaceHash: null, workspaceHash: receipt.workspaceHash, paths: []
  });
  assert.equal(protocol.attemptIsValid(emptyScope, {
    ...common, version: 1, reviewBinding: protocol.receiptBinding(emptyScope)
  }), true, "legacy receipts without a path array normalize to an empty scope");
});

test("review attempt protocol rejects version-specific identity and evidence drift", () => {
  const { receipt, common, paths } = fixture();
  const v3 = {
    ...common, version: 3, status: "completed", resultStatus: "pass",
    findings: [{ id: "finding-1" }], verifiedFindingIds: ["finding-1"],
    scope: { mode: "full", paths, baseAttemptDigest: null, digest: "dispatch" }
  };
  for (const mutate of [
    (row) => { row.status = "dispatched"; },
    (row) => { row.resultStatus = "fail"; },
    (row) => { row.reviewerIdentity = "other"; },
    (row) => { row.reviewerModelId = "other"; },
    (row) => { row.scope.paths = ["src/other.mjs"]; },
    (row) => { row.scope.digest = "other"; },
    (row) => { row.findings = []; },
    (row) => { row.verifiedFindingIds = []; }
  ]) {
    const changed = structuredClone(v3);
    mutate(changed);
    assert.equal(protocol.attemptIsValid(receipt, changed), false);
  }
  assert.equal(protocol.attemptIsValid(receipt, {
    ...v3, findings: undefined, verifiedFindingIds: undefined
  }), false, "missing v3 finding evidence cannot match non-empty receipt findings");

  const v4 = {
    ...common, version: 4, status: "completed", resultStatus: "pass",
    sourceAttemptDigest: "source-attempt",
    evidenceBindings: [{ id: "binding-1" }], verifiedFindingIds: ["finding-1"],
    scope: { mode: "repair-closure", paths, baseAttemptDigest: null, digest: "dispatch" }
  };
  for (const mutate of [
    (row) => { row.status = "dispatched"; },
    (row) => { row.resultStatus = "fail"; },
    (row) => { row.requestId = "other"; },
    (row) => { row.reviewerIdentity = "other"; },
    (row) => { row.scope.baseAttemptDigest = "other"; },
    (row) => { row.scope.paths = ["src/other.mjs"]; },
    (row) => { row.scope.digest = "other"; },
    (row) => { row.packetDigest = "other"; },
    (row) => { row.sourceAttemptDigest = "other"; },
    (row) => { row.evidenceBindings = []; },
    (row) => { row.verifiedFindingIds = []; },
    (row) => { row.scope.mode = "full"; }
  ]) {
    const changed = structuredClone(v4);
    mutate(changed);
    assert.equal(protocol.attemptIsValid(receipt, changed), false);
  }

  const noClosure = structuredClone(receipt);
  delete noClosure.review.repairClosure;
  const noClosureAttempt = structuredClone(v4);
  delete noClosureAttempt.sourceAttemptDigest;
  delete noClosureAttempt.evidenceBindings;
  assert.equal(protocol.attemptIsValid(noClosure, noClosureAttempt), true,
    "an empty repair closure remains compatible with empty optional bindings");
});
