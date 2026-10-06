import assert from "node:assert/strict";
import test from "node:test";

import {
  coordinatorAction, createAdvanceRuntime, envelopeContextFiles, hasValidLandGrant,
  prepareAdvanceBuild, runAdvanceProof
} from "../runtime/workflow/advance-runtime.mjs";
import {
  feedbackSnapshotValue, operationCauseCoverage, reviewRepairIntervals, intervalDuration
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

test("advance phase operations measure harness-owned Build and Prove work", async () => {
  const calls = [];
  const measureAsync = async (stage, operation) => {
    calls.push(stage);
    return operation();
  };
  const runQuietly = (operation) => operation();
  await prepareAdvanceBuild({
    measureAsync, runQuietly,
    prepareBuildSandbox: (id) => calls.push(["sandbox", id]),
    prepareExecution: (id, options) => calls.push(["execution", id, options])
  }, "change-a");
  await runAdvanceProof({
    measureAsync, runQuietly,
    prepareExecution: (id, options) => calls.push(["execution", id, options]),
    proofAdvance: (id, options) => calls.push(["proof", id, options])
  }, "change-a");
  assert.deepEqual(calls, [
    "build.prepare", ["sandbox", "change-a"],
    ["execution", "change-a", { stage: "build" }],
    "prove.execute", ["execution", "change-a", { stage: "prove" }],
    ["proof", "change-a", { quiet: true, concurrentReview: true }]
  ]);
});

test("advance land grant adapter projects only current validity", () => {
  assert.equal(hasValidLandGrant({ valid: () => ({ valid: true }) }, "change-a"), true);
  assert.equal(hasValidLandGrant({ valid: () => ({ valid: false }) }, "change-a"), false);
});

test("advance returns bounded Build work without invoking a model", () => {
  const value = coordinatorAction({
    ...base,
    dispatch: { action: "run-in-session", packetCommand: "packet",
      task: { taskId: "T001" } },
    plan: { tasks: [{ id: "T001", text: "Implement behavior",
      repository: "root", paths: ["src/**"] }] }
  });
  assert.equal(value.action, "EDIT");
  assert.equal(value.legacyAction, "EXECUTE_TASK");
  assert.equal(value.boundary, "host-execution");
  assert.equal(value.resumeCommand, "claude-foundation advance change-a");
});

test("a task with a stale execution record is handed back as re-verification, not new work", () => {
  const value = coordinatorAction({
    ...base,
    dispatch: { action: "run-in-session", reason: "one repository" },
    plan: {
      tasks: [{ id: "T002", text: "Add it — verify: `go test ./...`", repository: "root",
        paths: ["api.go"] }],
      verification: [
        { taskId: "T002", reason: "stale or invalid result authority: taskAuthority" },
        { taskId: "T009", reason: "not selected" }
      ]
    }
  });
  assert.equal(value.action, "EDIT");
  assert.deepEqual(value.reverification, [
    { taskId: "T002", reason: "stale or invalid result authority: taskAuthority" }
  ]);
  const notes = value.instructions.join(" ");
  assert.match(notes, /T002 is already implemented; its execution record is stale/);
  assert.match(notes, /Do not re-implement it or split the diff per task/);
  assert.doesNotMatch(notes, /T009/);
});

test("a sequential session plan hands every pending task in dependency order", () => {
  const value = coordinatorAction({
    ...base,
    dispatch: { action: "run-in-session", reason: "one repository" },
    plan: {
      groups: [["T001"], ["T002"]],
      tasks: [
        { id: "T002", text: "Use it — verify: `npm test -- b`", repository: "root", paths: ["src/b.js"] },
        { id: "T001", text: "Add it — verify: `npm test -- a`", repository: "root", paths: ["src/a.js"] }
      ]
    }
  });
  assert.equal(value.action, "EDIT");
  assert.equal(value.legacyAction, "EXECUTE_TASK");
  assert.deepEqual(value.tasks.map((task) => task.id), ["T001", "T002"]);
  assert.deepEqual(value.verification, ["npm test -- a", "npm test -- b"]);
  assert.deepEqual(value.execution, { mode: "session", leases: [] });
  assert.match(value.instructions.join(" "), /T001, T002 in this order/);
  // Parallel groups still hand one wave to leased workers.
  const group = coordinatorAction({
    ...base,
    dispatch: { action: "spawn-group", workers: [{ taskId: "T001" }, { taskId: "T002" }] },
    plan: { groups: [["T001", "T002"], ["T003"]], tasks: ["T001", "T002", "T003"].map((id) =>
      ({ id, text: id, repository: "root", paths: [`src/${id}.js`] })) }
  });
  assert.deepEqual(group.tasks.map((task) => task.id), ["T001", "T002"]);
  assert.equal(group.execution.mode, "parallel");
  assert.equal(group.instructions, undefined);
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
  assert.equal(value.action, "REPAIR");
  assert.equal(value.legacyAction, "EXECUTE_REPAIR_BATCH");
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
  assert.equal(value.action, "RUN_EXTERNAL");
  assert.equal(value.legacyAction, "RUN_INVALIDATED_EVIDENCE");
  assert.equal(value.boundary, null);
  assert.equal(value.command, "claude-foundation proof advance change-a");
});

test("advance returns configured review and user authority boundaries", () => {
  const review = coordinatorAction({
    ...base,
    authorityRequests: [{
      requestId: "review-1", type: "review", status: "requested"
    }],
    authorityActions: [{
      requestId: "review-1",
      command: "claude-foundation authority run change-a --request review-1 --subject-actor implementation-agent"
    }]
  });
  assert.equal(review.action, "RUN_EXTERNAL");
  assert.equal(review.legacyAction, "RUN_CONFIGURED_REVIEW");
  assert.equal(review.boundary, "external-authority");

  const decision = coordinatorAction({
    ...base,
    proofCursor: { status: "NEEDS_USER_DECISION", decision: {
      id: "D1", kind: "work-decision", summary: "Choose the product behavior"
    } }
  });
  assert.equal(decision.action, "ASK_USER");
  assert.equal(decision.legacyAction, "REQUEST_DECISION");
  assert.equal(decision.boundary, "user-authority");
});

test("Land readiness forbids implicit delivery authority", () => {
  const value = coordinatorAction({
    ...base, state: { status: "proven" },
    proofCursor: { status: "PASS", workspaceHash: "workspace-a" }
  });
  assert.equal(value.action, "ASK_USER");
  assert.equal(value.legacyAction, "LAND_READY");
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
  assert.equal(proven.action, "ASK_USER");
  assert.equal(proven.legacyAction, "LAND_READY");

  const requested = coordinatorAction({
    ...base, workspaceHash: "workspace-b", latestReview: failedReview,
    authorityRequests: [{ requestId: "review-2", type: "review", status: "requested" }],
    authorityActions: [{
      requestId: "review-2",
      command: "claude-foundation authority run change-a --request review-2 --subject-actor implementation-agent"
    }]
  });
  assert.equal(requested.action, "RUN_EXTERNAL");
  assert.equal(requested.legacyAction, "RUN_CONFIGURED_REVIEW");
  assert.equal(requested.requestId, "review-2");
});

test("advance rejects stale proof and stops when bounded review needs an external verdict", () => {
  const stale = coordinatorAction({
    ...base, state: { status: "proven" },
    proofCursor: { status: "PASS", workspaceHash: "workspace-old" }
  });
  assert.equal(stale.action, "RUN_EXTERNAL");
  assert.equal(stale.legacyAction, "RUN_PROOF");

  const capped = coordinatorAction({
    ...base,
    authorityRequests: [{ requestId: "review-3", type: "review", status: "requested" }],
    authorityActions: [{ requestId: "review-3", command: "claude-foundation authority status change-a --request review-3 --template" }]
  });
  assert.equal(capped.action, "WAIT");
  assert.equal(capped.legacyAction, "WAIT_EXTERNAL");
  assert.equal(capped.actor, "external-authority");
  assert.match(capped.reason, /external verdict is pending/);
  assert.match(capped.command, /authority status/);
});

test("advance stops on proof preflight before starting expensive evidence", () => {
  const unavailable = coordinatorAction({
    ...base,
    proofPreflight: {
      status: "INFRASTRUCTURE_ERROR",
      unavailableProviders: ["browser"],
      next: [{ command: "claude-foundation doctor --stage prove --change change-a" }]
    }
  });
  assert.equal(unavailable.action, "REPAIR");
  assert.equal(unavailable.legacyAction, "REPAIR_PROVIDER_ENVIRONMENT");
  assert.equal(unavailable.boundary, "resource");
  assert.match(unavailable.command, /doctor --stage prove/);

  const invalid = coordinatorAction({
    ...base,
    proofPreflight: {
      status: "CONFIGURATION_ERROR", issues: ["critical case missing"], next: []
    }
  });
  assert.equal(invalid.action, "REPAIR");
  assert.equal(invalid.legacyAction, "REPAIR_PROOF_CONTRACT");
  assert.equal(invalid.boundary, "contract");
});

test("advance uses proof readiness hash and does not hash failed infrastructure again", () => {
  const runtime = createAdvanceRuntime({
    loadRuntime: () => ({ status: "building" }),
    agentDispatchValue: () => ({ action: "build-complete" }),
    proofReadinessValue: () => ({
      status: "INFRASTRUCTURE_ERROR",
      workspaceHash: null,
      issues: ["selected repository 'api' isolated workspace is missing"],
      repositoryIssues: ["selected repository 'api' isolated workspace is missing"],
      unavailableProviders: [],
      next: [{
        command: "claude-foundation sandbox create change-a --all"
      }]
    }),
    relevantHash: assert.fail,
    deliveredAiAttempts: () => [], authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "/proof.json", stableHash
  });
  const value = runtime.advanceValue("change-a");
  assert.equal(value.action, "REPAIR");
  assert.equal(value.legacyAction, "REPAIR_PROVIDER_ENVIRONMENT");
  assert.equal(value.command,
    "claude-foundation sandbox create change-a --all");
});

test("a reached target reports the latest AI review's spec gaps without changing the outcome", async () => {
  const gaps = [{ scenario: "fractional count", reason: "not named" }];
  const runtime = createAdvanceRuntime({
    loadRuntime: () => ({ status: "archived" }), stableHash,
    deliveredAiAttempts: () => [{ specGaps: [{ scenario: "stale" }] }, { specGaps: gaps }]
  });
  const result = await runtime.advanceThrough("change-a", "archived");
  assert.equal(result.action, "DONE");
  assert.equal(result.reached, "archived");
  assert.deepEqual(result.reviewAdvisories, { specGaps: gaps });
  const clean = await createAdvanceRuntime({
    loadRuntime: () => ({ status: "archived" }), stableHash, deliveredAiAttempts: () => [{}]
  }).advanceThrough("change-a", "archived");
  assert.equal(clean.reviewAdvisories, undefined, "no gaps add no advisory field");
});

test("explicit archive continuation recovers the moved packet before active approval checks", async () => {
  const state = { status: "applied" };
  let recoveries = 0;
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state, stableHash,
    assertApproval: () => assert.fail("active packet is already archived"),
    recoverArchive: () => { recoveries += 1; state.status = "archived"; return true; }
  });
  const result = await runtime.advanceThrough("change-a", "archived");
  assert.equal(result.action, "DONE");
  assert.equal(result.reached, "archived");
  assert.equal(recoveries, 1);
});

test("archive recovery respects a user pause", async () => {
  const state = { status: "applied", advanceRecovery: {
    pending: { paused: true, through: "archived", decision: { summary: "pause" } }
  } };
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state, stableHash,
    recoverArchive: () => assert.fail("paused recovery must not run")
  });
  const result = await runtime.advanceThrough("change-a", "archived");
  assert.equal(result.action, "WAIT");
  assert.equal(result.boundary, "user-paused");
});

test("an archived checkpoint must finish its audit and cleanup before reporting completion", async () => {
  const state = { status: "archived" };
  let invalid = true, recoveries = 0;
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state, stableHash, relevantHash: () => "retained",
    readJson: () => ({}), proofAdvancePath: () => "/proof.json",
    recoverArchive: () => {
      recoveries += 1;
      if (invalid) throw new Error("archived specs do not match the change delta");
      return true;
    }
  });
  const rejected = await runtime.advanceThrough("change-a", "archived");
  assert.notEqual(rejected.action, "DONE");
  invalid = false;
  const resumed = await runtime.advanceThrough("change-a", "archived");
  assert.equal(resumed.action, "DONE");
  assert.equal(recoveries, 2);
});

test("advance --through runs deterministic proof and Land until archived", async () => {
  const state = { status: "building", workspace: { path: "/tmp/change" } };
  let proofRuns = 0;
  let landRuns = 0;
  let grants = 0;
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state,
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "workspace-a",
    deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => proofRuns ? { status: "PASS", workspaceHash: "workspace-a" } : {},
    proofAdvancePath: () => "/proof.json",
    stableHash,
    hasLandGrant: () => grants > 0,
    authorizeLand: () => { assert.equal(state.status, "proven"); grants += 1; },
    runProof: async () => {
      proofRuns += 1;
      state.status = "proven";
      return { progressed: true, completed: true };
    },
    runLand: async () => {
      landRuns += 1;
      state.status = "archived";
    }
  });
  const value = await runtime.advanceThrough("change-a", "archived");
  assert.equal(value.action, "DONE");
  assert.equal(value.reached, "archived");
  assert.equal(proofRuns, 1);
  assert.equal(landRuns, 1);
  assert.equal(grants, 1);
});

test("advance --through build stops before proof and preserves one resume route", async () => {
  const runtime = createAdvanceRuntime({
    loadRuntime: () => ({ status: "building", workspace: { path: "/tmp/change" } }),
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "workspace-a",
    deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}),
    proofAdvancePath: () => "/proof.json",
    stableHash
  });
  const value = await runtime.advanceThrough("change-a", "build");
  assert.equal(value.action, "DONE");
  assert.equal(value.reached, "build");
  assert.equal(value.resume, null);
  assert.equal(value.next, "claude-foundation advance change-a --through proven");
});

test("advance --through records each phase once", async () => {
  const state = { status: "change", workspace: { path: "/tmp/change" } };
  const phases = [];
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state,
    prepareBuild: async () => { state.status = "building"; },
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "workspace-a",
    deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "/proof.json", stableHash,
    recordPhase: (_id, phase) => phases.push(phase),
    output: () => {}
  });
  await runtime.showAdvance("change-a", { through: "build" });
  assert.deepEqual(phases, ["build"]);
});

test("plain advance prepares the amended agreement before choosing work", async () => {
  let prepared = false;
  const runtime = createAdvanceRuntime({
    loadRuntime: () => ({ status: "building", workspace: { path: "/tmp/change" } }),
    prepareBuild: async () => { prepared = true; },
    agentDispatchValue: () => {
      assert.equal(prepared, true);
      return { action: "run-in-session", packetCommand: "packet", task: { taskId: "T002" } };
    },
    agentPlanValue: () => ({ tasks: [{ id: "T002", text: "New amended task",
      repository: "root", paths: ["src/**"] }] }),
    relevantHash: () => "workspace-a", deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "/proof.json", stableHash,
    output: () => {}
  });
  const value = await runtime.advanceThrough("change-a", null);
  assert.equal(value.action, "EDIT", JSON.stringify(value));
});

test("advance preserves exact runtime failures in a repair envelope", () => {
  const reason = "isolated runtime state is missing repository 'api'; repair it with 'claude-foundation sandbox create change-a --all'";
  const runtime = createAdvanceRuntime({
    loadRuntime: () => ({ status: "building" }),
    agentDispatchValue: () => { throw new Error(reason); },
    relevantHash: () => "workspace-a",
    deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "/proof.json", stableHash
  });
  const value = runtime.advanceValue("change-a");
  assert.equal(value.action, "REPAIR");
  assert.equal(value.legacyAction, "REPAIR_BUILD_RUNTIME");
  assert.equal(value.reason, reason);
  assert.equal(value.command,
    "claude-foundation sandbox create change-a --all");
  assert.equal(value.resume, "claude-foundation advance change-a");
});

test("advance --through converts prepare and Land failures without rejecting", async () => {
  const preparing = { status: "change" };
  const prepareRuntime = createAdvanceRuntime({
    loadRuntime: () => preparing,
    prepareBuild: async () => { throw new Error("root sandbox unavailable"); },
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "workspace-a", deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }), readJson: () => ({}),
    proofAdvancePath: () => "/proof.json", stableHash
  });
  const prepare = await prepareRuntime.advanceThrough("change-a", "archived");
  assert.equal(prepare.action, "REPAIR");
  assert.equal(prepare.legacyAction, "REPAIR_BUILD_RUNTIME");
  assert.equal(prepare.reason, "root sandbox unavailable");
  assert.equal(prepare.resume,
    "claude-foundation advance change-a --through archived");

  const landing = { status: "proven" };
  const landRuntime = createAdvanceRuntime({
    loadRuntime: () => landing,
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "workspace-a", deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({ status: "PASS", workspaceHash: "workspace-a" }),
    proofAdvancePath: () => "/proof.json", stableHash,
    hasLandGrant: () => true,
    runLand: async () => { throw new Error("land conflict route"); }
  });
  const land = await landRuntime.advanceThrough("change-a", "archived");
  assert.equal(land.action, "REPAIR");
  assert.equal(land.legacyAction, "REPAIR_LAND_RUNTIME");
  assert.equal(land.reason, "land conflict route");
  assert.equal(land.command, "claude-foundation land check change-a");
});

test("advance convergence follows semantic progress beyond 32 proof runs", async () => {
  const state = { status: "building", revision: 0 };
  let proofRuns = 0;
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state,
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => `workspace-${state.revision}`,
    deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "/proof.json", stableHash,
    runProof: async () => {
      proofRuns += 1;
      state.revision += 1;
      if (proofRuns === 40) state.status = "proven";
      return { progressed: true, completed: proofRuns === 40 };
    }
  });
  const value = await runtime.advanceThrough("change-a", "proven");
  assert.equal(value.action, "DONE");
  assert.equal(value.reached, "proven");
  assert.equal(proofRuns, 40);
});

test("advance convergence stops only after repeated unchanged automation", async () => {
  const state = { status: "building", revision: 1 };
  let proofRuns = 0;
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state,
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "workspace-a", deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }), readJson: () => ({}),
    proofAdvancePath: () => "/proof.json", stableHash,
    runProof: async () => { proofRuns += 1; return { progressed: false }; }
  });
  const value = await runtime.advanceThrough("change-a", "proven");
  // Unchanged automation hands the stuck step to the agent with what it
  // returned; the recovery ladder asks the user only after repeated repair.
  assert.equal(value.action, "REPAIR");
  assert.equal(value.owner, "agent");
  assert.equal(value.boundary, "repeated-no-progress");
  assert.equal(value.recovery.type, "HANDOFF");
  assert.match(value.reason, /RUN_PROOF/);
  assert.equal(value.command, "claude-foundation advance change-a --inspect");
  assert.equal(proofRuns, 2);
});

test("a weak host can finish by reading one action and calling its resume", async () => {
  const state = { status: "building", workspace: { path: "/tmp/change" } };
  let edited = false;
  let landGranted = false;
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state,
    agentDispatchValue: () => edited
      ? { action: "build-complete" }
      : { action: "run-in-session", task: { taskId: "T001" } },
    agentPlanValue: () => ({
      tasks: [{
        id: "T001", text: "Implement bounded behavior — verify: `npm test`",
        paths: ["src/**"], repository: "root"
      }]
    }),
    relevantHash: () => "workspace-a",
    deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => state.status === "proven"
      ? { status: "PASS", workspaceHash: "workspace-a" } : {},
    proofAdvancePath: () => "/proof.json", stableHash,
    hasLandGrant: () => landGranted,
    authorizeLand: async () => { landGranted = true; },
    runProof: async () => { state.status = "proven"; return { progressed: true }; },
    runLand: async () => { state.status = "archived"; }
  });
  const first = await runtime.advanceThrough("change-a", "archived");
  assert.equal(first.action, "EDIT");
  assert.deepEqual(first.allowedPaths, ["src/**"]);
  assert.deepEqual(first.verification, ["npm test"]);
  assert.equal(first.resume, "claude-foundation advance change-a --through archived");
  assert.ok(JSON.stringify(first).length < 8192, "action stays within the bounded host context");
  edited = true;
  const second = await runtime.advanceThrough("change-a", "archived");
  assert.equal(second.action, "DONE");
  assert.equal(second.reached, "archived");
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
    metrics: {
      unattributedWaitMs: 2_000_000, humanWaitMs: null,
      evidenceObservationGroups: [{
        commandExecutionId: "exec-1", providers: ["test", "compatibility"],
        independent: false
      }]
    },
    operations,
    reviewAttempts: attempts,
    nextAction: { action: "RUN_PROOF" }
  });
  assert.equal(snapshot.timing.repairMs, 1_850_604);
  assert.equal(snapshot.timing.humanWaitMs, null);
  assert.equal(snapshot.timing.unattributedMs, 149_396);
  assert.equal(snapshot.evidenceObservationGroups[0].independent, false);
});

test("feedback derives repair on advance and excludes resumes after the next review", () => {
  const attempts = [
    { status: "completed", resultStatus: "fail", digest: "a", workspaceHash: "a",
      completedAt: "2026-09-11T00:00:00Z", findings: [{ id: "F1", severity: "major" }] },
    { status: "completed", resultStatus: "pass", workspaceHash: "b",
      timestamp: "2026-09-11T00:05:00Z" }
  ];
  const operation = { operation: "advance", startedAt: "2026-09-11T00:03:00Z" };
  const intervals = reviewRepairIntervals([operation], attempts);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].durationMs, 180000);
  assert.deepEqual(reviewRepairIntervals([
    { ...operation, startedAt: "2026-09-11T00:06:00Z" }
  ], attempts), []);
  const snapshot = feedbackSnapshotValue({ changeId: "a", metrics: {},
    operations: [operation], reviewAttempts: attempts });
  assert.equal(snapshot.timing.repairTimingAvailability, "derived");
  const overlapped = feedbackSnapshotValue({ changeId: "a", operations: [operation],
    reviewAttempts: attempts, metrics: {
      unattributedWaitMs: 600000, humanWaitMs: 60000,
      humanWaitSpans: [{ from: "2026-09-11T00:01:00Z", to: "2026-09-11T00:02:00Z" }]
    } });
  assert.equal(overlapped.timing.unattributedMs, 420000,
    "human wait inside repair is subtracted only once");
  const activeOverlap = feedbackSnapshotValue({ changeId: "a",
    operations: [operation, { operation: "exec", startedAt: "2026-09-11T00:01:00Z",
      finishedAt: "2026-09-11T00:02:00Z" }], reviewAttempts: attempts,
    metrics: { unattributedWaitMs: 600000 } });
  assert.equal(activeOverlap.timing.unattributedMs, 480000,
    "repair overlapping an observed operation is not subtracted from idle twice");
  const legacy = feedbackSnapshotValue({ changeId: "a", operations: [operation],
    reviewAttempts: attempts, metrics: { unattributedWaitMs: 600000, humanWaitMs: 60000 } });
  assert.equal(legacy.timing.unattributedMs, null,
    "legacy totals cannot establish overlap without boundaries");
});

test("timing unions duplicate and overlapping intervals without inventing measurements", () => {
  const row = (from, to) => ({ from: `2026-09-11T00:00:${from}Z`, to: `2026-09-11T00:00:${to}Z` });
  assert.equal(intervalDuration([row("00", "10"), row("05", "15"),
    row("00", "10"), row("20", "25")]), 20000);
  assert.equal(intervalDuration([row("00", "00")]), 0);
  assert.equal(intervalDuration([{ from: "invalid", to: null }]), null);
});

test("feedback keeps missing timing unknown and retains measured zero", () => {
  const snapshot = (reviewAttempts) => feedbackSnapshotValue({
    changeId: "change-a", metrics: {}, reviewAttempts
  }).timing;
  assert.equal(snapshot([]).reviewerExecutionMs, null);
  assert.equal(snapshot([]).repairMs, null);
  assert.equal(snapshot([{ timestamp: "invalid" }]).reviewerExecutionMs, null);
  const measured = { timestamp: "2026-09-05T00:00:00Z",
    completedAt: "2026-09-05T00:00:00Z" };
  assert.equal(snapshot([measured]).reviewerExecutionMs, 0);
  assert.equal(snapshot([measured]).reviewerTimingAvailability, "complete");
  assert.equal(snapshot([measured, {}]).reviewerTimingAvailability, "partial");
});

test("feedback keeps legacy blocker cause explicitly unavailable", () => {
  assert.deepEqual(operationCauseCoverage([
    { version: 2, status: "blocked" },
    { version: 3, status: "blocked", blocker: { code: "budget-exhausted" } },
    { version: 3, status: "failed" }
  ]), { blocked: 2, typed: 1, legacyUnavailable: 1, untypedCurrent: 0 });
});

// S1: the agent issues only `change start` and `advance`; the harness performs
// the wiring, sync, and configured-review primitives it used to hand back.
function selfDrivingRuntime(overrides = {}) {
  const state = { status: "building", workspace: { path: "/tmp/change" } };
  const calls = [];
  const runtime = createAdvanceRuntime({
    loadRuntime: () => state,
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "workspace-a",
    deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => state.status === "proven" ? { status: "PASS", workspaceHash: "workspace-a" } : {},
    proofAdvancePath: () => "/proof.json",
    stableHash,
    runProof: async () => { calls.push("proof"); state.status = "proven"; return { completed: true }; },
    ...overrides(state, calls)
  });
  return { state, calls, runtime };
}

test("automatic review accepts only an exact harness-generated authority run route", async () => {
  const { automaticReviewRun } = await import("../runtime/workflow/advance-recovery.mjs");
  assert.deepEqual(automaticReviewRun("change-a",
    "claude-foundation authority run change-a --request review-1 --subject-actor implementation-agent"),
  { request: "review-1", "subject-actor": "implementation-agent" });
  for (const route of [
    "claude-foundation authority run change-a --request review-1 --subject-actor <original-implementer>",
    "claude-foundation authority run change-a --request review-1 --subject-actor x --main-session-model <model>",
    "claude-foundation authority run other --request review-1 --subject-actor x",
    "claude-foundation authority run change-a --request review-1",
    "claude-foundation authority status change-a --request review-1 --template",
    "claude-foundation authority run change-a --request r1 --subject-actor x; rm -rf /"
  ]) assert.equal(automaticReviewRun("change-a", route), null, route);
});

test("advance wires detected evidence itself, then proves without an agent command", async () => {
  let wired = 0;
  const { runtime, calls } = selfDrivingRuntime(() => ({
    proofReadinessValue: () => wired ? { status: "READY", workspaceHash: "workspace-a", next: [] } : {
      status: "NEEDS_USER_DECISION", workspaceHash: "workspace-a",
      authorityPreflight: { status: "READY" },
      next: [{ provider: "test", kind: "user-decision",
        wiring: { kind: "configure-provider", command: "claude-foundation evidence init change-a --write" },
        decision: { kind: "external-evidence", summary: "wire test", options: [] } }]
    },
    wireEvidence: async (id, wiring) => { wired += 1; assert.deepEqual(wiring.providers, ["test"]); }
  }));
  const value = await runtime.advanceThrough("change-a", "proven");
  assert.equal(value.action, "DONE");
  assert.equal(value.reached, "proven");
  assert.equal(wired, 1);
  assert.deepEqual(calls, ["proof"]);
});

test("wiring that does not clear the gap falls back to the evidence decision once", async () => {
  let wired = 0;
  const { runtime, calls } = selfDrivingRuntime(() => ({
    proofReadinessValue: () => ({
      status: "NEEDS_USER_DECISION", workspaceHash: "workspace-a",
      next: [{ provider: "test", wiring: { kind: "configure-provider" },
        decision: { kind: "external-evidence", summary: "Provider 'test' needs evidence", options: [] } }]
    }),
    wireEvidence: async () => { wired += 1; }
  }));
  const value = await runtime.advanceThrough("change-a", "proven");
  assert.equal(value.action, "ASK_USER");
  assert.equal(value.decision.kind, "external-evidence");
  assert.equal(wired, 1);
  assert.deepEqual(calls, []);
  // The Build target never performs Prove-side wiring.
  const build = await runtime.advanceThrough("change-a", "build");
  assert.equal(build.reached, "build");
  assert.equal(wired, 1);
});

test("advance runs an agent-runnable configured reviewer inline and keeps placeholders a handoff", async () => {
  const request = { requestId: "review-1", type: "review", status: "requested" };
  const reviews = [];
  const { runtime, calls } = selfDrivingRuntime(() => ({
    authorityStatusValue: () => ({ requests: request.status === "requested" ? [request] : [] }),
    authorityNext: () => [{ requestId: "review-1",
      command: "claude-foundation authority run change-a --request review-1 --subject-actor implementation-agent" }],
    runReview: async (id, flags) => { reviews.push([id, flags]); request.status = "completed"; }
  }));
  const value = await runtime.advanceThrough("change-a", "proven");
  assert.equal(value.reached, "proven");
  assert.deepEqual(reviews, [["change-a", { request: "review-1", "subject-actor": "implementation-agent" }]]);
  assert.deepEqual(calls, ["proof"]);

  const fallback = { requestId: "review-2", type: "review", status: "requested" };
  const handoff = selfDrivingRuntime(() => ({
    authorityStatusValue: () => ({ requests: [fallback] }),
    authorityNext: () => [{ requestId: "review-2",
      command: "claude-foundation authority run change-a --request review-2 --subject-actor x --main-session-model <model>" }],
    runReview: async () => { throw new Error("placeholder routes must not run"); }
  }));
  const stopped = await handoff.runtime.advanceThrough("change-a", "proven");
  assert.equal(stopped.action, "RUN_EXTERNAL");
  assert.equal(stopped.legacyAction, "RUN_CONFIGURED_REVIEW");
  assert.equal(stopped.automaticReview, undefined);
});

test("a reviewer run that changes nothing stops at the no-progress boundary", async () => {
  const request = { requestId: "review-1", type: "review", status: "requested" };
  let runs = 0;
  const { runtime } = selfDrivingRuntime(() => ({
    authorityStatusValue: () => ({ requests: [request] }),
    authorityNext: () => [{ requestId: "review-1",
      command: "claude-foundation authority run change-a --request review-1 --subject-actor implementation-agent" }],
    runReview: async () => { runs += 1; }
  }));
  const value = await runtime.advanceThrough("change-a", "proven");
  assert.equal(value.boundary, "repeated-no-progress");
  assert.equal(runs, 2);
});

test("a proven change with a revised agreement is synchronized by advance itself", async () => {
  const synced = [];
  const { runtime } = selfDrivingRuntime((state) => {
    state.status = "proven";
    return { synchronizeAgreement: async (id) => { synced.push(id); return true; } };
  });
  await runtime.advanceThrough("change-a", "proven");
  assert.deepEqual(synced, ["change-a"]);
});

test("a rapid two-task EDIT names the files to open: packet, existing task paths, new files", async (t) => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, isAbsolute } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "advance-context-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packet = join(root, "openspec", "changes", "change-a");
  const workspace = join(root, "box");
  mkdirSync(packet, { recursive: true });
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(join(packet, "proposal.md"), "# Proposal\n");
  writeFileSync(join(packet, "tasks.md"), "- [ ] **T001** a\n- [ ] **T002** b\n");
  writeFileSync(join(workspace, "src", "a.js"), "");
  const runtime = createAdvanceRuntime({
    loadRuntime: () => ({ status: "building", workspace: { path: workspace } }),
    changePath: () => packet,
    agentDispatchValue: () => ({ action: "run-in-session", reason: "one repository" }),
    agentPlanValue: () => ({ groups: [["T001"], ["T002"]], tasks: [
      { id: "T001", text: "Edit a — verify: `true`", repository: "root", paths: ["src/a.js"] },
      { id: "T002", text: "Add b — verify: `true`", repository: "root", paths: ["src/b.js", "src/**"] }
    ] }),
    relevantHash: () => "workspace-a", deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "/proof.json", stableHash,
    output: () => {}
  });
  const value = await runtime.advanceThrough("change-a", "build");
  assert.equal(value.action, "EDIT", JSON.stringify(value));
  assert.deepEqual(value.tasks.map((task) => task.id), ["T001", "T002"]);
  assert.deepEqual(value.contextFiles, [
    join(packet, "proposal.md"), join(packet, "tasks.md"), join(workspace, "src", "a.js")]);
  assert.ok(value.contextFiles.every((file) => isAbsolute(file) && existsSync(file)));
  assert.ok(!value.contextFiles.some((file) => file.includes(`${join("change-a", "specs")}`)));
  assert.deepEqual(value.newFiles, [join(workspace, "src", "b.js")]);
  assert.deepEqual(value.contextScope, { paths: "absolute", specs: "none" });
  // Existing fields stay.
  assert.deepEqual(value.allowedPaths, ["src/a.js", "src/b.js", "src/**"]);
});

test("envelope context keeps only files inside the workspace or repository bases", async (t) => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "advance-context-bound-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packet = join(root, "packet");
  const workspace = join(root, "box");
  const service = join(root, "service");
  const outside = join(root, "secret.txt");
  for (const dir of [packet, join(workspace, "src"), service]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(workspace, "src", "a.js"), "");
  writeFileSync(join(service, "b.js"), "");
  writeFileSync(outside, "");
  const value = envelopeContextFiles({
    packetDir: packet,
    state: { workspace: { path: workspace }, repositories: { service: { path: service } } },
    tasks: [{ repository: "service", allowedPaths: ["b.js", "../box/src/a.js", "../secret.txt"] }],
    // Repair-node paths: relative, absolute inside, absolute outside, escaping.
    paths: ["src/a.js", join(service, "b.js"), outside, "../secret.txt", "/etc/passwd", "src/new.js"]
  });
  assert.deepEqual(value.contextFiles, [join(service, "b.js"), join(workspace, "src", "a.js")]);
  assert.deepEqual(value.newFiles, [join(workspace, "src", "new.js")]);
  assert.ok(![...value.contextFiles, ...value.newFiles].some((file) =>
    file === outside || file === "/etc/passwd"));
});

test("spec approval carries authority gates the change already needs", async () => {
  const state = { status: "change", workspace: { path: "/tmp/change" } };
  const approval = Object.assign(new Error("approve"), {
    code: "SPEC_APPROVAL_REQUIRED", owner: "user", boundary: "spec-approval-required",
    decision: { kind: "spec-approval-required", summary: "approve",
      options: [{ id: "approve", outcome: "Approve" }], recommended: "approve" }
  });
  const fixture = (pendingApprovalDecisions) => createAdvanceRuntime({
    loadRuntime: () => state,
    prepareBuild: async () => { throw approval; },
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "workspace-a", deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "/proof.json", stableHash,
    pendingApprovalDecisions, output: () => {}
  });
  const ci = { code: "SIGNED_CI_CONFIGURATION_REQUIRED", summary: "needs CI", next: "configure" };
  const asked = await fixture(() => [ci]).advanceThrough("change-a", "build");
  assert.equal(asked.action, "ASK_USER", JSON.stringify(asked));
  assert.deepEqual(asked.decision.alongside, [ci]);
  assert.match(asked.decision.summary, /^approve Ask in the same question, before Build: needs CI \(configure\)$/);
  approval.decision = { ...approval.decision, summary: "approve" };
  delete approval.decision.alongside;
  const plain = await fixture(() => { throw new Error("unresolvable"); })
    .advanceThrough("change-a", "build");
  assert.equal(plain.action, "ASK_USER");
  assert.equal(plain.decision.alongside, undefined);
});
