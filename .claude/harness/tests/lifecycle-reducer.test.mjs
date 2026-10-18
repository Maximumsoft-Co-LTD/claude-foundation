import assert from "node:assert/strict";
import test from "node:test";

import {
  lifecycleTransitionValue, normalizeLifecycleState, normalizeLifecycleStatus,
  transitionLifecycleState
} from "../runtime/core/lifecycle-reducer.mjs";

test("lifecycle reducer returns one typed transition outcome", () => {
  const state = { status: "change" };
  assert.deepEqual(transitionLifecycleState(state, "building", "sandbox-created"), {
    version: 1, from: "change", to: "building", changed: true,
    outcome: "transitioned", reason: "sandbox-created"
  });
  assert.equal(state.status, "building");
  assert.equal(transitionLifecycleState(state, "building").outcome, "unchanged");
});

test("lifecycle reducer permits recovery edges and rejects impossible resurrection", () => {
  assert.equal(lifecycleTransitionValue({ status: "change" }, "proven").to,
    "proven");
  assert.equal(lifecycleTransitionValue({ status: "resolved" }, "building").to,
    "building");
  assert.equal(lifecycleTransitionValue({ status: "proven" }, "building",
    "proof-invalidated").to, "building");
  assert.equal(lifecycleTransitionValue({ status: "applied" }, "proven").to,
    "proven");
  assert.equal(lifecycleTransitionValue({ status: "applied" }, "archived").to,
    "archived");
  assert.throws(() => lifecycleTransitionValue({ status: "archived" }, "building"),
    /invalid lifecycle transition/);
  assert.throws(() => lifecycleTransitionValue({ status: "change" }, "unknown"),
    /unknown lifecycle target/);
});

test("lifecycle reducer never lets unproven work reach applied or archived", () => {
  for (const from of ["change", "resolved", "building"])
    for (const target of ["applied", "archived"])
      assert.throws(() => lifecycleTransitionValue({ status: from }, target),
        /invalid lifecycle transition/, `${from} -> ${target}`);
  assert.equal(lifecycleTransitionValue({ status: "proven" }, "applied").to, "applied");
  assert.equal(lifecycleTransitionValue({ status: "proven" }, "archived").to, "archived");
});

test("a legacy landing status is read as proven", () => {
  assert.equal(normalizeLifecycleStatus("landing"), "proven");
  assert.equal(normalizeLifecycleStatus(undefined), "change");
  assert.equal(normalizeLifecycleStatus("building"), "building");
  const legacy = { status: "landing" };
  assert.equal(normalizeLifecycleState(legacy), true);
  assert.equal(legacy.status, "proven");
  assert.equal(normalizeLifecycleState(legacy), false);
  assert.deepEqual(lifecycleTransitionValue({ status: "landing" }, "applied"), {
    version: 1, from: "proven", to: "applied", changed: true,
    outcome: "transitioned", reason: null
  });
});
