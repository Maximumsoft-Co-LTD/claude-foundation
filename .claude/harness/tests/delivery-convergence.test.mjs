import assert from "node:assert/strict";
import test from "node:test";

import {
  lifecycleOutcome
} from "../runtime/core/lifecycle-outcome.mjs";
import {
  coordinatorAction, createAdvanceRuntime
} from "../runtime/workflow/advance-runtime.mjs";

const stableHash = (value) => JSON.stringify(value);

function fixture({ status = "building", proofCursor = {}, runProof, runLand } = {}) {
  const state = {
    status,
    revision: 1,
    workspace: { path: "/sandbox", mode: "worktree", baseHead: "base" },
    repositories: {}
  };
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state,
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "workspace-a",
    deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    authorityNext: () => [],
    readJson: () => proofCursor,
    proofAdvancePath: () => "/proof.json",
    stableHash,
    proofReadinessValue: () => ({ status: "READY", workspaceHash: "workspace-a" }),
    hasLandGrant: () => Boolean(runLand),
    runProof,
    runLand,
    capture: (operation) => operation(),
    captureAsync: (operation) => operation()
  });
  return { runtime, state };
}

test("lifecycle outcomes preserve actor compatibility and enforce ownership", () => {
  const value = lifecycleOutcome({ action: "EDIT", actor: "agent" });
  assert.equal(value.owner, "agent");
  assert.equal(value.actor, "agent");
  assert.throws(() => lifecycleOutcome({ action: "EDIT", actor: "harness" }),
    /belong to the agent/);
  assert.throws(() => lifecycleOutcome({
    action: "ASK_USER", actor: "user", boundary: "user-authority",
    decision: { kind: "host-permission" }
  }), /must not be delegated to the user/);
});

test("advance consumes a proof repair outcome without rerunning proof", async () => {
  let calls = 0;
  const { runtime } = fixture({
    runProof: async () => {
      calls += 1;
      return {
        status: "ACTION_REQUIRED",
        route: "AUTO_REPAIR",
        next: [{ reason: "fix the current finding" }],
        repairPlan: { digest: "repair-a", tasks: [{ id: "R1" }] }
      };
    }
  });
  const value = await runtime.advanceThrough("change-a", "proven");
  assert.equal(calls, 1);
  assert.equal(value.action, "REPAIR");
  assert.equal(value.owner, "agent");
  assert.equal(value.repairPlan.digest, "repair-a");
  assert.equal(value.reason, "fix the current finding");
  assert.equal("command" in value.user, false);
  assert.equal("resume" in value.user, false);
  assert.equal("repairPlan" in value.user, false);
});

test("advance preserves a proof decision returned by a quiet operation", async () => {
  const decision = {
    kind: "repair-no-progress",
    summary: "The same product finding remains",
    options: [
      { id: "revise", outcome: "revise the product contract" },
      { id: "pause", outcome: "preserve the current state" }
    ]
  };
  const { runtime } = fixture({
    runProof: async () => ({
      status: "NEEDS_USER_DECISION", route: "NO_PROGRESS_DECISION", decision
    })
  });
  const value = await runtime.advanceThrough("change-a", "proven");
  assert.equal(value.action, "ASK_USER");
  assert.equal(value.owner, "user");
  assert.deepEqual(value.decision, decision);
  assert.deepEqual(value.user.decision.options, decision.options);
});

test("an active proof lock becomes harness-owned working state", async () => {
  let calls = 0;
  const { runtime } = fixture({
    runProof: async () => {
      calls += 1;
      return { status: "IN_PROGRESS", owner: { pid: 42 } };
    }
  });
  const value = await runtime.advanceThrough("change-a", "proven");
  assert.equal(calls, 1);
  assert.equal(value.action, "WORKING");
  assert.equal(value.owner, "harness");
  assert.equal(value.userState, "WORKING");
});

test("advance consumes a structured Land decision", async () => {
  const decision = {
    kind: "target-conflict",
    summary: "A delivered path also has a user edit",
    options: [
      { id: "resolve", outcome: "choose the intended merged behavior" },
      { id: "pause", outcome: "leave every target recoverable" }
    ]
  };
  const { runtime } = fixture({
    status: "proven",
    proofCursor: { status: "PASS", workspaceHash: "workspace-a" },
    runLand: async () => ({ status: "BLOCKED", decision })
  });
  const value = await runtime.advanceThrough("change-a", "archived");
  assert.equal(value.action, "ASK_USER");
  assert.equal(value.owner, "user");
  assert.deepEqual(value.decision, decision);
});

test("Build never emits an empty edit packet", () => {
  const value = coordinatorAction({
    id: "change-a",
    state: { status: "building", workspace: { path: "/sandbox" } },
    dispatch: { action: "run-in-session", reason: "ready" },
    workspaceHash: "workspace-a",
    stableHash
  });
  assert.equal(value.action, "REPAIR");
  assert.equal(value.owner, "harness");
  assert.equal(value.legacyAction, "REPAIR_BUILD_PLAN");
});

test("model budget decisions reach the coordinator before Build dispatch", () => {
  const decision = {
    kind: "budget-exhausted",
    summary: "The active model budget is exhausted",
    options: [
      { id: "continue", outcome: "authorize another bounded window" },
      { id: "pause", outcome: "preserve the current state" }
    ]
  };
  const value = coordinatorAction({
    id: "change-a",
    state: { status: "building", workspace: { path: "/sandbox" } },
    dispatch: { action: "run-in-session", reason: "ready" },
    workspaceHash: "workspace-a",
    budget: { status: "NEEDS_USER_DECISION", decision },
    stableHash
  });
  assert.equal(value.action, "ASK_USER");
  assert.deepEqual(value.decision, decision);
});

test("Build preparation is re-entered after a setup repair boundary", async () => {
  let preparations = 0;
  const { runtime } = fixture();
  const state = {
    status: "building", revision: 1,
    workspace: { path: "/sandbox", mode: "worktree", baseHead: "base" },
    repositories: {}
  };
  const retrying = createAdvanceRuntime({
    loadRuntime: () => state,
    agentDispatchValue: () => ({ action: "run-in-session", tasks: ["T1"],
      allowedPaths: ["src/**"] }),
    relevantHash: () => "workspace-a",
    deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "/proof.json", stableHash,
    prepareBuild: async () => { preparations += 1; },
    capture: (operation) => operation(),
    captureAsync: (operation) => operation()
  });
  await retrying.advanceThrough("change-a", "build");
  assert.equal(preparations, 1);
  // Keep the original fixture referenced so this test also exercises factory
  // construction with the default optional preparation callback.
  assert(runtime);
});
