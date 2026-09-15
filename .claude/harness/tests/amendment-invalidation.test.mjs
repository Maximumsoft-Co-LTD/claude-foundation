import assert from "node:assert/strict";
import test from "node:test";
import { planAmendmentInvalidation } from
  "../runtime/workflow/validation/amendment-invalidation.mjs";

function fixture(overrides = {}) {
  return {
    claims: [
      { id: "profile-read", capabilities: ["test"] },
      { id: "profile-write", capabilities: ["test", "browser"] },
      { id: "audit-log", capabilities: ["test"] }
    ],
    tasks: [
      { id: "T001", claims: ["profile-read"] },
      { id: "T002", claims: ["profile-write"] },
      { id: "T003", claims: ["audit-log"] }
    ],
    providers: {
      test: { capability: "test" },
      browser: { capability: "browser", claims: ["profile-write"] },
      discovery: { capability: "discovery" },
      review: { capability: "review" },
      deploy: { capability: "live", dependsOn: ["browser"] }
    },
    coverageDelta: { changedClaimIds: ["profile-write"] },
    ...overrides
  };
}

test("planner invalidates affected and packet-bound providers selectively", () => {
  const result = planAmendmentInvalidation(fixture());
  assert.equal(result.status, "READY");
  assert.deepEqual(result.affectedClaims, ["profile-write"]);
  assert.deepEqual(result.affectedTasks, ["T002"]);
  assert.deepEqual(result.affectedProviders,
    ["browser", "deploy", "discovery", "review", "test"]);
  assert.deepEqual(result.preservedProviders, []);
  assert.deepEqual(result.approval,
    { invalidate: true, reasons: ["semantic-coverage-changed"] });
  assert.deepEqual(result.proof.invalidateReceipts,
    ["browser", "deploy", "discovery", "review", "test"]);
});

test("test changes invalidate derived discovery coverage", () => {
  const result = planAmendmentInvalidation(fixture({
    coverageDelta: { changedClaimIds: ["audit-log"] },
    providers: {
      discovery: { capability: "discovery" },
      audit: { capability: "test", claims: ["audit-log"] },
      browser: { capability: "browser", claims: ["profile-write"] }
    }
  }));
  assert.deepEqual(result.affectedProviders, ["audit", "discovery"]);
  assert.deepEqual(result.proof.preserveReceipts, ["browser"]);
});

test("global coverage changes conservatively affect every claim", () => {
  const result = planAmendmentInvalidation(fixture({
    coverageDelta: {
      coverageChanges: [{ dimension: "compatibility", beforeStatus: "covered",
        afterStatus: "needs-investigation" }]
    }
  }));
  assert.equal(result.coverage.global, true);
  assert.deepEqual(result.affectedClaims,
    ["audit-log", "profile-read", "profile-write"]);
  assert.deepEqual(result.affectedTasks, ["T001", "T002", "T003"]);
});

test("added claims are planned and removed claims fail closed without history", () => {
  const added = fixture({
    claims: [{ id: "new", capabilities: ["test"] }],
    tasks: [{ id: "T004", claims: ["new"] }],
    providers: [{ id: "test", capability: "test" }],
    coverageDelta: { addedClaimIds: ["new"] }
  });
  assert.equal(planAmendmentInvalidation(added).status, "READY");

  const removed = fixture({
    claims: [], tasks: [], providers: [{ id: "test", capability: "test" }],
    coverageDelta: { removedClaimIds: ["old"] }
  });
  const removedResult = planAmendmentInvalidation(removed);
  assert.equal(removedResult.status, "BLOCKED");
  assert.deepEqual(removedResult.affectedClaims, ["old"]);
  assert.ok(removedResult.findings.some((finding) =>
    finding.code === "REMOVED_CLAIM_HISTORY_REQUIRED"));
});

test("planner fails closed for incomplete bindings and unknown identities", () => {
  const result = planAmendmentInvalidation({
    claims: [{ id: "changed" }],
    tasks: [{ id: "T001" }],
    providers: { test: {} },
    coverageDelta: { changedClaimIds: ["changed", "unknown"] }
  });
  assert.equal(result.status, "BLOCKED");
  const codes = result.findings.map((finding) => finding.code);
  for (const code of [
    "INVALID_CLAIM_CAPABILITIES", "MISSING_TASK_CLAIMS",
    "UNIMPLEMENTED_AFFECTED_CLAIM", "UNKNOWN_AFFECTED_CLAIM",
    "UNRESOLVED_PROVIDER_CAPABILITY"
  ]) assert.ok(codes.includes(code), code);
  assert.equal(result.approval.invalidate, true);
  assert.equal(result.proof.invalidate, true);
});

test("provider dependencies propagate transitively and terminate on cycles", () => {
  const result = planAmendmentInvalidation(fixture({
    providers: [
      { id: "test", capability: "test" },
      { id: "package", capability: "package", dependsOn: ["test", "publish"] },
      { id: "publish", capability: "live", dependsOn: ["package"] }
    ],
    coverageDelta: { changedClaimIds: ["profile-read"] }
  }));
  assert.equal(result.status, "READY");
  assert.deepEqual(result.affectedProviders, ["package", "publish", "test"]);
});

test("empty or malformed deltas cannot produce a ready no-op plan", () => {
  const empty = planAmendmentInvalidation(fixture({ coverageDelta: {} }));
  assert.equal(empty.status, "BLOCKED");
  assert.ok(empty.findings.some((finding) => finding.code === "EMPTY_COVERAGE_DELTA"));

  const malformed = planAmendmentInvalidation(fixture({ coverageDelta: null }));
  assert.equal(malformed.status, "BLOCKED");
  assert.ok(malformed.findings.some((finding) => finding.code === "INVALID_COVERAGE_DELTA"));
});
