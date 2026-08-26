import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeHandoffOperation,
  normalizedActivationProof,
  normalizedOperationReferences,
  requiredOperationString
} from "../runtime/workflow/handoff-runtime.mjs";

const fail = (message) => { throw new Error(message); };
const label = "change/handoffs.yaml operations[0]";

function operation(overrides = {}) {
  return {
    id: "H001",
    owner: "platform-team",
    environment: "production",
    authority: "change-manager",
    operation: "deploy release",
    timing: "post-land",
    activation: "activation-coupled",
    evidence: ["deployment-health", "tracking-reference"],
    runbook: "docs/runbook.md",
    rollback: "roll back deployment",
    claimIds: ["claim-b", "claim-a", "claim-a"],
    taskIds: ["t002", "T001", "T001"],
    ...overrides
  };
}

function context(overrides = {}) {
  return {
    assertNoSecretMaterial: () => {},
    safeId: (value, _pattern, _label, reject) => {
      const id = String(value || "").trim().toUpperCase();
      if (!/^H\d{3,}$/.test(id)) reject("invalid handoff id");
      return id;
    },
    defaultOwner: () => "devops-team",
    fail,
    ...overrides
  };
}

test("required operation strings trim values and enforce bounds", () => {
  assert.equal(requiredOperationString({ operation: " deploy " },
    "operation", label, fail), "deploy");
  assert.throws(() => requiredOperationString({}, "operation", label, fail),
    /\.operation is required/);
  assert.throws(() => requiredOperationString({ operation: "x".repeat(1001) },
    "operation", label, fail), /\.operation is too long/);
});

test("operation references deduplicate, sort, normalize tasks, and validate scope", () => {
  assert.deepEqual(normalizedOperationReferences(operation(), label, {
    claimIds: new Set(["claim-a", "claim-b"]),
    taskIds: new Set(["T001", "T002"])
  }, fail), {
    claimIds: ["claim-a", "claim-b"],
    taskIds: ["T001", "T002"]
  });
  assert.throws(() => normalizedOperationReferences(operation({ claimIds: [] }),
    label, {}, fail), /claimIds must be non-empty/);
  assert.throws(() => normalizedOperationReferences(operation({ claimIds: [" "] }),
    label, {}, fail), /claimIds must contain non-empty strings/);
  assert.throws(() => normalizedOperationReferences(operation({ taskIds: ["task"] }),
    label, {}, fail), /taskIds must contain stable task IDs/);
});

test("operation references reject unknown declared claims and tasks", () => {
  assert.throws(() => normalizedOperationReferences(operation(), label, {
    claimIds: new Set(["claim-a"])
  }, fail), /references unknown claim\(s\): claim-b/);
  assert.throws(() => normalizedOperationReferences(operation(), label, {
    taskIds: new Set(["T001"])
  }, fail), /references unknown task\(s\): T002/);
});

test("activation proof is required and claim-bound only for safe activation", () => {
  assert.equal(normalizedActivationProof({}, "activation-coupled",
    ["claim-a"], label, fail), null);
  assert.throws(() => normalizedActivationProof({ activationProof: {} },
    "activation-coupled", ["claim-a"], label, fail), /only valid/);
  assert.throws(() => normalizedActivationProof({}, "safe-before-activation",
    ["claim-a"], label, fail), /requires claimId and condition/);
  assert.throws(() => normalizedActivationProof({
    activationProof: { claimId: "claim-b", condition: "healthy" }
  }, "safe-before-activation", ["claim-a"], label, fail), /must be listed in claimIds/);
  assert.deepEqual(normalizedActivationProof({
    activationProof: { claimId: " claim-a ", condition: " healthy " }
  }, "safe-before-activation", ["claim-a"], label, fail), {
    claimId: "claim-a", condition: "healthy"
  });
});

test("normalization returns the canonical activation-coupled operation", () => {
  assert.deepEqual(normalizeHandoffOperation(context(), operation({
    id: " h007 ",
    owner: "",
    evidence: ["tracking-reference", "deployment-health", "tracking-reference"]
  }), 0, { id: "change" }), {
    id: "H007",
    owner: "devops-team",
    environment: "production",
    authority: "change-manager",
    operation: "deploy release",
    timing: "post-land",
    activation: "activation-coupled",
    evidence: ["deployment-health", "tracking-reference"],
    runbook: "docs/runbook.md",
    rollback: "roll back deployment",
    claimIds: ["claim-a", "claim-b"],
    taskIds: ["T001", "T002"]
  });
});

test("normalization includes canonical safe-before-activation proof", () => {
  const value = normalizeHandoffOperation(context(), operation({
    activation: "safe-before-activation",
    activationProof: { claimId: "claim-a", condition: "health is green" }
  }), 0);
  assert.deepEqual(value.activationProof, {
    claimId: "claim-a", condition: "health is green"
  });
});

test("normalization rejects shape, enum, evidence, owner, and secret failures", () => {
  assert.throws(() => normalizeHandoffOperation(context(), null, 0), /must be an object/);
  assert.throws(() => normalizeHandoffOperation(context(), operation({ timing: "during-land" }), 0),
    /timing must be pre-land\|post-land/);
  assert.throws(() => normalizeHandoffOperation(context(), operation({ activation: "manual" }), 0),
    /activation must be safe-before-activation\|activation-coupled/);
  assert.throws(() => normalizeHandoffOperation(context(), operation({ evidence: ["unknown"] }), 0),
    /evidence must contain supported evidence types/);
  assert.throws(() => normalizeHandoffOperation(context({ defaultOwner: () => "" }),
    operation({ owner: "" }), 0), /owner is required/);
  assert.throws(() => normalizeHandoffOperation(context({
    assertNoSecretMaterial: (_raw, secretLabel, reject) =>
      reject(`${secretLabel} cannot contain secret material`)
  }), operation(), 0), /cannot contain secret material/);
});
