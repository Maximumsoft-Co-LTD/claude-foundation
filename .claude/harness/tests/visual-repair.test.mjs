import assert from "node:assert/strict";
import test from "node:test";

import { createProofExecutionRuntime } from "../runtime/evidence/proof-execution-runtime.mjs";
import {
  VISUAL_REPAIR_ROUNDS, grantVisualRepair, planVisualRepair, visualRepairBudget
} from "../runtime/evidence/repair-runtime.mjs";

const major = { id: "V1", screen: "settings", difference: "Save sits in the header",
  severity: "major", claimIds: ["C-a"] };
const minor = { id: "V2", screen: "settings", difference: "8px wider gap",
  severity: "minor", claimIds: ["C-a"] };

// One change with an executable test provider and the built-in visual
// provider. Receipt validity and the visual receipt are set per pass.
function fixture() {
  let state = { version: 2, id: "change-a", status: "building" };
  let workspaceHash = "h1";
  let proof = null;
  const validity = { test: "valid", visual: "valid" };
  let visual = null;
  const executed = [];
  const runtime = createProofExecutionRuntime({
    proofReadinessValue: () => ({
      version: 1, changeId: "change-a", status: "READY", workspaceHash, issues: [],
      externalProviders: [], unavailableProviders: [], pendingTasks: [], next: []
    }),
    relevantSnapshot: () => ({ id: `snapshot-${workspaceHash}`, workspaceHash }),
    loadRuntime: () => state,
    saveRuntime: (next) => { state = next; },
    now: () => "2026-11-07T00:00:00.000Z",
    requiredProviders: () => ["test", "visual"],
    receiptValidity: (_id, provider) => ({ provider, validity: validity[provider] }),
    rebindReusableReceipt: () => {},
    rebindDiffBoundReceipt: () => {},
    executionNodes: () => ({
      nodes: Object.keys(validity).filter((provider) => validity[provider] !== "valid")
        .map((provider) => ({ provider, covers: [provider], dependsOn: [] })),
      unconfigured: [], unavailable: []
    }),
    collectableExecutionNodes: (_id, nodes) => ({ nodes, blocked: [] }),
    startRequiredServices: async () => [],
    runExecutionDag: async (_id, nodes) => {
      executed.push(...nodes.map((node) => node.provider));
      for (const node of nodes) validity[node.provider] = "valid";
      return nodes.map((node) => ({ provider: node.provider, status: "pass" }));
    },
    durableArtifact: () => null,
    pendingTasks: () => [],
    proofPreflight: () => {},
    prove: () => {
      proof = { version: 2, status: "pass", proofRunId: "proof-1", workspaceHash,
        providers: ["test", "visual"] };
    },
    proofAudit: () => proof ? { valid: true, proof } : { valid: false, reason: "missing-proof" },
    readJson: () => proof,
    proofPath: () => "proof.json",
    providerCapability: (provider) => provider,
    providerConfig: () => ({ adapter: "command" }),
    visualReceipt: () => visual,
    die: (message) => { throw new Error(message); }
  });
  return {
    advance: () => runtime.proofAdvance("change-a", { quiet: true }),
    pass: ({ hash, test = "valid", visualValidity = "valid", findings = [] }) => {
      workspaceHash = hash;
      validity.test = test;
      validity.visual = visualValidity;
      visual = { workspaceHash: hash, status: visualValidity === "fail" ? "fail" : "pass",
        visual: { findings } };
      proof = null;
    },
    state: () => state,
    executed
  };
}

async function quiet(operation) {
  const prior = process.exitCode;
  try { return await operation(); } finally { process.exitCode = prior; }
}

test("a visual failure fixed in the first round never asks the user", async () => {
  const world = fixture();
  world.pass({ hash: "h1", visualValidity: "fail", findings: [major] });
  const first = await quiet(world.advance);
  assert.equal(first.status, "ACTION_REQUIRED");
  assert.equal(first.repairGraph.kind, "visual-repair-graph");
  assert.equal(first.repairGraph.round, 1);
  assert.deepEqual(first.repairGraph.nodes[0].claimIds, ["C-a"]);
  assert.match(first.repairGraph.nodes[0].difference, /header/);
  assert.equal(world.state().visualRepair.rounds, 1);

  world.pass({ hash: "h2" });
  const second = await quiet(world.advance);
  assert.equal(second.status, "PASS");
  assert.equal(second.decision ?? null, null);
  assert.equal(world.state().visualRepair.drift, null);
});

test("after two rounds still failing: no third batch, drift recorded, other gates keep repairing", async () => {
  const world = fixture();
  world.pass({ hash: "h1", visualValidity: "fail", findings: [major] });
  assert.equal((await quiet(world.advance)).repairGraph.round, 1);
  world.pass({ hash: "h2", visualValidity: "fail", findings: [major] });
  assert.equal((await quiet(world.advance)).repairGraph.round, 2);

  // Round three: visual still fails and a test fails too. Only the test is repaired.
  world.pass({ hash: "h3", test: "fail", visualValidity: "fail", findings: [major] });
  const third = await quiet(world.advance);
  assert.equal(third.status, "ACTION_REQUIRED");
  assert.ok(!third.repairGraph || third.repairGraph.kind !== "visual-repair-graph");
  assert.ok(third.repairPlan.findings?.every?.((finding) => !String(finding.id).startsWith("visual:")) ?? true);
  assert.deepEqual(third.failures.map((row) => row.provider), ["test"]);
  const drift = world.state().visualRepair.drift;
  assert.equal(drift.rounds, VISUAL_REPAIR_ROUNDS);
  assert.equal(drift.workspaceHash, "h3");
  assert.deepEqual(drift.findings, [major]);

  // The test is repaired; visual is not re-run on unchanged content, and the
  // user is asked once now that every other gate is done.
  world.pass({ hash: "h3", test: "missing", visualValidity: "fail", findings: [major] });
  const asked = await quiet(world.advance);
  assert.ok(world.executed.includes("test"));
  assert.ok(!world.executed.includes("visual"));
  assert.equal(asked.status, "NEEDS_USER_DECISION");
  assert.equal(asked.decision.kind, "visual-drift");
  assert.deepEqual(asked.decision.options.map((row) => row.id),
    ["repair-more", "accept", "amend-agreement", "pause"]);
  assert.match(asked.decision.summary, /Save sits in the header/);
});

test("resuming a visual batch without editing records drift instead of the same batch", async () => {
  const world = fixture();
  world.pass({ hash: "h1", visualValidity: "fail", findings: [major] });
  const first = await quiet(world.advance);
  assert.equal(first.repairGraph.round, 1);
  assert.match(first.next?.[0]?.reason || first.reason || JSON.stringify(first),
    /contradict the approved agreement is not yours to apply/);
  // The agent declines (the difference is forbidden) and resumes unchanged.
  world.pass({ hash: "h1", visualValidity: "fail", findings: [major] });
  const declined = await quiet(world.advance);
  assert.ok(!declined.repairGraph || declined.repairGraph.kind !== "visual-repair-graph");
  const drift = world.state().visualRepair.drift;
  assert.equal(drift.declined, true);
  assert.equal(drift.rounds, 1);
  assert.deepEqual(drift.findings, [major]);
  assert.equal(declined.status, "NEEDS_USER_DECISION");
  assert.equal(declined.decision.kind, "visual-drift");
});

test("a first visual failure is always a repair batch, never drift", () => {
  const plan = planVisualRepair({}, { provider: "visual", now: "t",
    receipt: { workspaceHash: "h1", visual: { findings: [major] } } });
  assert.equal(plan.action, "repair");
  assert.equal(plan.round, 1);
  assert.equal(plan.visualRepair.drift, null);
});

test("repair more after a declined drift gives a fresh batch on the same workspace", () => {
  const state = { visualRepair: { rounds: 1, lastBatchWorkspaceHash: "h1",
    drift: { findings: [major], rounds: 1, workspaceHash: "h1", declined: true } } };
  grantVisualRepair(state, { decisionRef: "user:more", now: "t" });
  const plan = planVisualRepair(state, { provider: "visual", now: "t",
    receipt: { workspaceHash: "h1", visual: { findings: [major] } } });
  assert.equal(plan.action, "repair");
  assert.equal(plan.round, 2);
});

test("minor-only differences make no visual repair batch", () => {
  const state = {};
  const plan = planVisualRepair(state, { provider: "visual", now: "t",
    receipt: { workspaceHash: "h1", status: "pass", visual: { findings: [minor] } } });
  assert.equal(plan.action, "none");
  assert.deepEqual(plan.findings, []);
  assert.equal(visualRepairBudget({ visualRepair: plan.visualRepair }).rounds, 0);
});

test("only a user grant extends the visual budget, two rounds at a time", () => {
  const state = { visualRepair: { rounds: 2, lastBatchWorkspaceHash: "h2",
    drift: { findings: [major], rounds: 2, workspaceHash: "h3" } } };
  assert.equal(planVisualRepair(state, { provider: "visual", now: "t",
    receipt: { workspaceHash: "h3", visual: { findings: [major] } } }).action, "drift");
  grantVisualRepair(state, { decisionRef: "user:more", now: "t" });
  assert.equal(state.visualRepair.drift, null);
  assert.equal(visualRepairBudget(state).allowed, 4);
  const plan = planVisualRepair(state, { provider: "visual", now: "t",
    receipt: { workspaceHash: "h3", visual: { findings: [major] } } });
  assert.equal(plan.action, "repair");
  assert.equal(plan.round, 3);
});
