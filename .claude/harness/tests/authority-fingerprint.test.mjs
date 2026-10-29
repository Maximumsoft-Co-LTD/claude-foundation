import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { fingerprintedReviewPolicy } from "../runtime/evidence/evidence-contract.mjs";
import { recordDeterministicReviewClosureOperation } from "../runtime/evidence/receipt-runtime.mjs";

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(canonical(value))).digest("hex");

const basePolicy = Object.freeze({
  tier: "medium", required: true, maxAiAttempts: 2,
  independence: "preferred", diversity: "preferred"
});

// A contract fingerprint built from the review policy before and after
// `authority extend-review` must be the same bytes: the grant is budget.
test("an extend-review grant does not change the fingerprinted review policy", () => {
  const granted = { ...basePolicy, grantedAiWaveCap: 3 };
  assert.deepEqual(fingerprintedReviewPolicy(granted), fingerprintedReviewPolicy(basePolicy));
  assert.equal(stableHash({ reviewPolicy: fingerprintedReviewPolicy(granted) }),
    stableHash({ reviewPolicy: fingerprintedReviewPolicy(basePolicy) }));
  assert.equal("grantedAiWaveCap" in fingerprintedReviewPolicy(granted), false);
});

test("the rapid exemption shape is preserved without the grant", () => {
  const exempt = { ...basePolicy, required: false, grantedAiWaveCap: 3 };
  assert.deepEqual(fingerprintedReviewPolicy(exempt), { ...basePolicy, required: true });
  assert.equal(fingerprintedReviewPolicy(null), null);
});

// The deterministic closure gate judges the agreement by fingerprint. With the
// grant outside it, the wave the user just paid for is dispatched instead of
// being blocked by the grant itself.
function closureContext({ priorFingerprint, currentFingerprint, grants = [] }) {
  const source = {
    reviewerType: "ai", resultStatus: "fail", scope: { mode: "delta" },
    digest: "attempt-final-delta", workspaceHash: "workspace-reviewed",
    findings: [{ id: "F1", severity: "major", path: "app.mjs", message: "open" }]
  };
  const receipt = {
    status: "fail", contractFingerprint: priorFingerprint,
    review: { attemptDigest: source.digest }
  };
  return {
    providerConfig: () => ({ capability: "review", adapter: "external" }),
    providerCapability: (_provider, config) => config.capability,
    deliveredAiAttempts: () => [{ ...source, digest: "attempt-full" }, source],
    receiptPath: () => "/receipts/review.json",
    exists: () => true,
    readJson: () => receipt,
    contractFingerprint: () => currentFingerprint,
    loadRuntime: () => ({
      status: "proving", contractRevision: 4,
      reviewHistory: { extraAiWaves: grants },
      groundingDigest: "grounding", groundingReopens: []
    }),
    requiredProviders: () => ["review"],
    receiptValidity: () => ({ validity: "valid" }),
    groundingForReview: () => ({ claims: [], criticalCases: [] }),
    reviewAttemptByDigest: () => null,
    reviewAttemptIsValid: () => false
  };
}

test("a grant after the final AI delta does not return CONTRACT_DECISION_REQUIRED", () => {
  const fingerprint = stableHash({ reviewPolicy: fingerprintedReviewPolicy(basePolicy) });
  const result = recordDeterministicReviewClosureOperation(closureContext({
    priorFingerprint: fingerprint,
    currentFingerprint: stableHash({ reviewPolicy: fingerprintedReviewPolicy(
      { ...basePolicy, grantedAiWaveCap: 3 }) }),
    grants: [{ decisionRef: "D-extend", delivered: 2, at: "2026-10-28T00:00:00.000Z" }]
  }), "demo", "review", "workspace-reviewed");
  assert.equal(result.closed, false);
  assert.notEqual(result.route, "CONTRACT_DECISION_REQUIRED");
  assert.equal(result.route, "AUTO_REPAIR");
});

test("a real agreement change after the final AI delta still needs a decision revision", () => {
  const result = recordDeterministicReviewClosureOperation(closureContext({
    priorFingerprint: stableHash({ reviewPolicy: basePolicy, claims: ["a"] }),
    currentFingerprint: stableHash({ reviewPolicy: basePolicy, claims: ["a", "b"] })
  }), "demo", "review", "workspace-reviewed");
  assert.equal(result.closed, false);
  assert.equal(result.route, "CONTRACT_DECISION_REQUIRED");
  assert.match(result.command, /advance demo --approve-spec/);
});
