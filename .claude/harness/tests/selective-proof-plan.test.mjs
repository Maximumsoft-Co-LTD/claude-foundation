import assert from "node:assert/strict";
import test from "node:test";
import { planSelectiveProofRecovery, rebindSelectiveProofReceipt } from
  "../runtime/workflow/validation/selective-proof-plan.mjs";

function binding(provider, revision, overrides = {}) {
  return {
    provider, status: "pass", validity: "contract-stale",
    binding: {
      contractRevision: revision,
      providerFingerprint: `${provider}-provider`,
      claimsFingerprint: `${provider}-claims`,
      inputIdentity: { mode: "declared", fingerprint: `${provider}-inputs` }
    },
    ...overrides
  };
}

function fixture(overrides = {}) {
  return {
    changeId: "profile-edit",
    invalidation: {
      status: "READY",
      proof: {
        invalidateReceipts: ["browser", "review"],
        preserveReceipts: ["lint"]
      }
    },
    requiredProviders: ["review", "lint", "browser"],
    receiptBindings: [binding("lint", 3)],
    currentBindings: [binding("lint", 4, { validity: "valid" })],
    priorContractRevision: 3,
    currentContractRevision: 4,
    ...overrides
  };
}

test("preserves only unchanged declared-input bindings across one revision", () => {
  const result = planSelectiveProofRecovery(fixture());
  assert.equal(result.status, "READY");
  assert.deepEqual(result.providers, {
    preserved: ["lint"], rerun: ["browser", "review"]
  });
  assert.equal(result.decisions.find((row) => row.provider === "lint").reason,
    "unchanged-declared-binding");
  assert.equal(result.recovery.command,
    "claude-foundation advance profile-edit --through proven");
  assert.equal(result.recovery.mode, "selective-rerun");
});

test("accepts a current valid binding without cross-revision reuse", () => {
  const result = planSelectiveProofRecovery(fixture({
    receiptBindings: [binding("lint", 4, { validity: "valid" })]
  }));
  assert.equal(result.status, "READY");
  assert.deepEqual(result.providers.preserved, ["lint"]);
  assert.equal(result.decisions.find((row) => row.provider === "lint").reason,
    "current-valid-binding");
});

test("fails closed when a preservation binding is missing or duplicated", () => {
  const missing = planSelectiveProofRecovery(fixture({ receiptBindings: [] }));
  assert.equal(missing.status, "BLOCKED");
  assert.deepEqual(missing.providers.preserved, []);
  assert.deepEqual(missing.providers.rerun, ["browser", "lint", "review"]);
  assert.ok(missing.findings.some((row) => row.code === "MISSING_PROVIDER_BINDING"));
  assert.equal(missing.recovery.mode, "fail-closed-rerun");

  const duplicate = planSelectiveProofRecovery(fixture({
    receiptBindings: [binding("lint", 3), binding("lint", 3)]
  }));
  assert.equal(duplicate.status, "BLOCKED");
  assert.ok(duplicate.findings.some((row) => row.code === "AMBIGUOUS_PROVIDER_BINDING"));
  assert.deepEqual(duplicate.providers.rerun, ["browser", "lint", "review"]);
});

test("does not reuse changed, unscoped, or independently stale receipts", () => {
  for (const [code, receipt, current] of [
    ["PROVIDER_IDENTITY_CHANGED", binding("lint", 3),
      binding("lint", 4, { binding: {
        ...binding("lint", 4).binding, claimsFingerprint: "new-claims"
      } })],
    ["UNSCOPED_PROVIDER_INPUTS", binding("lint", 3, { binding: {
      ...binding("lint", 3).binding, inputIdentity: { mode: "workspace", fingerprint: "lint-inputs" }
    } }), binding("lint", 4, { validity: "valid" })],
    ["RECEIPT_INVALID_BEYOND_CONTRACT", binding("lint", 3, { validity: "provider-inputs-stale" }),
      binding("lint", 4, { validity: "valid" })]
  ]) {
    const result = planSelectiveProofRecovery(fixture({
      receiptBindings: [receipt], currentBindings: [current]
    }));
    assert.equal(result.status, "BLOCKED", code);
    assert.ok(result.findings.some((row) => row.code === code), code);
    assert.ok(result.providers.rerun.includes("lint"), code);
  }
});

test("requires a complete single-step revision and provider partition", () => {
  const result = planSelectiveProofRecovery(fixture({
    currentContractRevision: 6,
    invalidation: {
      status: "READY",
      proof: { invalidateReceipts: ["browser"], preserveReceipts: ["lint"] }
    }
  }));
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.findings.some((row) => row.code === "AMBIGUOUS_CONTRACT_REVISION"));
  assert.ok(result.findings.some((row) => row.code === "UNCLASSIFIED_REQUIRED_PROVIDER"));
  assert.deepEqual(result.providers.rerun, ["browser", "lint", "review"]);
});

test("rejects overlapping, unknown, or blocked invalidation plans", () => {
  const result = planSelectiveProofRecovery(fixture({
    invalidation: {
      status: "BLOCKED",
      proof: {
        invalidateReceipts: ["lint", "unknown"],
        preserveReceipts: ["lint", "browser", "review"]
      }
    },
    receiptBindings: [binding("lint", 3), binding("browser", 3), binding("review", 3)],
    currentBindings: [binding("lint", 4), binding("browser", 4), binding("review", 4)]
  }));
  assert.equal(result.status, "BLOCKED");
  const codes = result.findings.map((row) => row.code);
  assert.ok(codes.includes("INVALID_INVALIDATION_PLAN"));
  assert.ok(codes.includes("AMBIGUOUS_INVALIDATION"));
  assert.ok(codes.includes("UNKNOWN_INVALIDATION_PROVIDER"));
  assert.deepEqual(result.providers.preserved, []);
  assert.ok(result.providers.rerun.includes("lint"));
});

test("receipt rebind is authorized only by a ready preserved-provider plan", () => {
  const plan = planSelectiveProofRecovery(fixture());
  const receipt = { provider: "lint", status: "pass", contractFingerprint: "old" };
  const rebound = rebindSelectiveProofReceipt({
    receipt, provider: "lint", plan,
    fromContractFingerprint: "old", toContractFingerprint: "new",
    reboundAt: "2026-09-15T00:00:00.000Z"
  });
  assert.equal(rebound.contractFingerprint, "new");
  assert.deepEqual(rebound.contractRebind, {
    version: 1,
    reason: "unaffected-semantic-amendment",
    fromContractRevision: 3,
    toContractRevision: 4,
    fromContractFingerprint: "old",
    toContractFingerprint: "new",
    reboundAt: "2026-09-15T00:00:00.000Z"
  });
  assert.throws(() => rebindSelectiveProofReceipt({
    receipt, provider: "review", plan,
    fromContractFingerprint: "old", toContractFingerprint: "new", reboundAt: "now"
  }), /not authorized/);
});
