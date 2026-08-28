import assert from "node:assert/strict";
import test from "node:test";

import {
  verificationPlanValue, verificationRisk
} from "../runtime/workflow/verification-plan.mjs";

function packet(overrides = {}) {
  return {
    changeId: "change",
    schema: "foundation-standard",
    impact: "medium",
    coupling: "isolated",
    reviewRequired: false,
    pendingTaskCount: 0,
    providers: [
      { provider: "test", validity: "valid", repositories: ["root"] },
      { provider: "static", validity: "missing", repositories: ["root"] }
    ],
    ...overrides
  };
}

test("risk routing preserves high assurance across security and multi-repo shapes", () => {
  assert.equal(verificationRisk(packet({
    schema: "foundation-rapid", impact: "low"
  })), "rapid");
  assert.equal(verificationRisk(packet()), "standard");
  assert.equal(verificationRisk(packet({ impact: "high" })), "high");
  assert.equal(verificationRisk(packet({ reviewRequired: true })), "high");
  assert.equal(verificationRisk(packet({
    providers: [{ provider: "contract", repositories: ["api", "web"] }]
  })), "high");
});

test("prove uses one boundary command and names the probes it replaces", () => {
  const plan = verificationPlanValue(packet(), "prove", (value) => `digest:${value.phase}`);
  assert.equal(plan.execution.command, "claude-foundation proof advance change");
  assert.ok(plan.execution.includes.includes("receipt-reuse"));
  assert.ok(plan.execution.avoidBefore.includes(
    "claude-foundation proof readiness change"));
  assert.equal(plan.evidence.measurement, "provider-validity");
  assert.deepEqual(plan.evidence.reusable, ["test"]);
  assert.deepEqual(plan.evidence.required, ["static"]);
  assert.equal(plan.planFingerprint, "digest:prove");
  assert.equal(plan.assurance, "unchanged-by-batching");
});

test("build defers its single readiness check until tasks are complete", () => {
  const pending = verificationPlanValue(packet({ pendingTaskCount: 2 }), "build");
  assert.equal(pending.execution.command, null);
  assert.equal(pending.execution.deferredCommand,
    "claude-foundation proof readiness change");
  const complete = verificationPlanValue(packet({ pendingTaskCount: 0 }), "build");
  assert.equal(complete.execution.command,
    "claude-foundation proof readiness change");
  assert.equal(complete.execution.deferredCommand, null);
});

test("compacted provider displays never invent reuse decisions", () => {
  const plan = verificationPlanValue(packet({
    providers: { count: 50, digest: "providers" }
  }), "land");
  assert.equal(plan.risk, "standard");
  assert.equal(plan.evidence.measurement, "compacted-unavailable");
  assert.deepEqual(plan.evidence.reusable, []);
  assert.equal(plan.execution.command, "claude-foundation land advance change");
});
