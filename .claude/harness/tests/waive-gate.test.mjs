import assert from "node:assert/strict";
import test from "node:test";

import {
  assertWaivableCapability,
  revokeGateWaiver,
  waiveGateOperation,
  waiverRequest
} from "../runtime/workflow/change-validation.mjs";

const fail = (message) => { throw new Error(message); };

test("waiver request trims authority fields and requires capability and decision", () => {
  assert.deepEqual(waiverRequest({
    capability: " test ", "decision-ref": " decision:1 ", reason: " why "
  }, fail), { capability: "test", decisionRef: "decision:1", reason: "why" });
  assert.throws(() => waiverRequest({}, fail), /requires --capability/);
  assert.throws(() => waiverRequest({ capability: "test" }, fail),
    /requires --decision-ref/);
});

function fixture({ required = ["test"], state = {} } = {}) {
  const saves = [];
  const logs = [];
  const context = {
    loadRuntime: () => state,
    saveRuntime: (value) => saves.push(value),
    requiredProviders: () => required,
    providerCapability: (_provider, config) => config.capability,
    providerConfig: (_id, provider) => ({ capability: provider }),
    now: () => "recorded-at",
    fail,
    log: (message) => logs.push(message)
  };
  return { context, state, saves, logs };
}

test("waivable capability validates reason, protected routes, duplicates, and requirement", () => {
  const world = fixture();
  assert.throws(() => assertWaivableCapability(world.context, "change", {
    capability: "test", reason: ""
  }, []), /requires --reason/);
  assert.throws(() => assertWaivableCapability(world.context, "change", {
    capability: "review", reason: "why"
  }, []), /not required/);
  assert.throws(() => assertWaivableCapability(world.context, "change", {
    capability: "acceptance", reason: "why"
  }, []), /withdraw the requirement/);
  assert.throws(() => assertWaivableCapability(world.context, "change", {
    capability: "test", reason: "why"
  }, [{ capability: "test" }]), /already waived/);
  assert.throws(() => assertWaivableCapability(world.context, "change", {
    capability: "missing", reason: "why"
  }, []), /nothing to waive/);
  assert.doesNotThrow(() => assertWaivableCapability(fixture({ required: ["test", "lint"] }).context,
    "change", { capability: "test", reason: "why" }, []));
  const aliased = fixture({ required: ["provider-id", "test"] });
  aliased.context.providerConfig = (_id, provider) =>
    ({ capability: provider === "provider-id" ? "security-static" : provider });
  assert.doesNotThrow(() => assertWaivableCapability(
    aliased.context, "change", { capability: "security-static", reason: "why" }, []));
});

test("waiver revocation removes the gate and writes the recovery message", () => {
  const world = fixture({ state: {
    waivers: [{ capability: "test" }, { capability: "other" }]
  } });
  revokeGateWaiver(world.context, "change", world.state, world.state.waivers,
    { capability: "test" });
  assert.deepEqual(world.state.waivers, [{ capability: "other" }]);
  assert.equal(world.saves.length, 1);
  assert.match(world.logs[0], /WAIVER REVOKED change\/test/);
  assert.throws(() => revokeGateWaiver(
    world.context, "change", world.state, world.state.waivers,
    { capability: "missing" }), /no recorded waiver/);
});

// A waiver that withdraws every required provider leaves a proof without
// receipts, which Land refuses; refuse it here with the cause (issue #40).
test("a waiver that would leave no required evidence is refused before it is recorded", () => {
  const only = fixture({ required: ["test", "discovery"] });
  assert.throws(() => waiveGateOperation(only.context, "change", {
    capability: "test", "decision-ref": "decision:1", reason: "flaky"
  }), /waiving 'test' would leave change 'change' with no required evidence.*change amend change/s);
  assert.equal(only.saves.length, 0);
  assert.equal(only.state.waivers, undefined);

  const repositoryBound = fixture({ required: ["test-svc", "discovery"] });
  repositoryBound.context.providerConfig = (_id, provider) =>
    ({ capability: provider === "test-svc" ? "test" : provider });
  assert.throws(() => assertWaivableCapability(repositoryBound.context, "change", {
    capability: "test", reason: "why" }, []), /no required evidence/);

  const reviewOnly = fixture({ required: ["review"] });
  assert.throws(() => assertWaivableCapability(reviewOnly.context, "change", {
    capability: "review", reason: "why" }, []), /no required evidence/);

  const remaining = fixture({ required: ["test", "discovery", "review"] });
  assert.doesNotThrow(() => assertWaivableCapability(remaining.context, "change", {
    capability: "review", reason: "why" }, []));
});

test("waive operation records durable authority and supports legacy empty state", () => {
  const world = fixture({ required: ["test", "review"] });
  waiveGateOperation(world.context, "change", {
    capability: "test", "decision-ref": "decision:1", reason: "risk accepted"
  });
  assert.deepEqual(world.state.waivers, [{
    capability: "test", reason: "risk accepted",
    authority: { kind: "host-user-decision", reference: "decision:1" },
    recordedAt: "recorded-at"
  }]);
  assert.equal(world.saves.length, 1);
  assert.match(world.logs[0], /GATE WAIVED change\/test/);
  assert.match(world.logs[0], /decision: decision:1/);
});

test("waive operation handles revocation and refuses archived changes", () => {
  const revoke = fixture({ state: { waivers: [{ capability: "test" }] } });
  waiveGateOperation(revoke.context, "change", {
    capability: "test", "decision-ref": "decision:2", revoke: true
  });
  assert.deepEqual(revoke.state.waivers, []);
  assert.match(revoke.logs[0], /WAIVER REVOKED/);

  const archived = fixture({ state: { status: "archived" } });
  assert.throws(() => waiveGateOperation(archived.context, "change", {
    capability: "test", "decision-ref": "decision:3", reason: "why"
  }), /already archived/);
  assert.equal(archived.saves.length, 0);
});

test("review waiver binds the current diff and a stale waiver can be revoked", () => {
  const world = fixture({ required: ["review", "test"], state: { contractRevision: 4 } });
  world.context.relevantHash = () => "reviewed-diff";
  waiveGateOperation(world.context, "change", {
    capability: "review", reason: "User accepts unfinished review", "decision-ref": "decision:land"
  });
  assert.deepEqual(world.state.waivers[0].binding, {
    workspaceHash: "reviewed-diff", contractRevision: 4
  });
  world.context.relevantHash = () => { throw new Error("workspace unavailable"); };
  waiveGateOperation(world.context, "change", {
    capability: "review", revoke: true, "decision-ref": "decision:revoke"
  });
  assert.deepEqual(world.state.waivers, []);
});
