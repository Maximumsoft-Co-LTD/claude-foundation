import assert from "node:assert/strict";
import test from "node:test";

import { createProviderScheduler } from "../runtime/evidence/provider-scheduler.mjs";
import { createProofExecutionRuntime } from "../runtime/evidence/proof-execution-runtime.mjs";
import { createAdvanceRuntime } from "../runtime/workflow/advance-runtime.mjs";
import { landAdvisoryLines } from "../runtime/workflow/land-runtime.mjs";
import { gateDigest } from "../runtime/core/convergent-gate.mjs";

const finding = { id: "V1", screen: "settings", difference: "Save sits in the header",
  severity: "major", claimIds: ["C-a"] };

// A required test provider plus an advisory visual provider, run through the
// real scheduler and proof advance. `visual` decides how the visual adapter
// behaves: "fail" (a verdict with one difference) or "throw".
function proofWorld({ visual = "fail", visualDependsOn = [] } = {}) {
  const validity = { test: "missing", visual: "missing" };
  const executed = [];
  let state = { version: 2, id: "change", status: "building" };
  let proof = null;
  const scheduler = createProviderScheduler({
    requiredProviders: () => ["test"],
    receiptValidity: (_id, provider) => ({ provider, validity: validity[provider] || "missing" }),
    providerConfig: (_id, provider) => provider === "visual"
      ? { adapter: "command", capability: "visual", command: ["node", "v.mjs"], dependsOn: visualDependsOn }
      : { adapter: "command", command: ["node", `${provider}.mjs`] },
    commandExists: () => true,
    providerWorkspace: () => "/workspace",
    playwrightAvailability: () => ({}),
    evidence: () => ({ claims: [{ id: "C-a", capabilities: ["test"] }], providers: {},
      visualClaims: ["C-a"], visualAdvisory: true }),
    providerCapability: (provider, config) => config?.capability || provider,
    adapterResources: () => [],
    resourcesConflict: () => false,
    executeAdapter: async (_id, provider) => {
      executed.push(provider);
      if (provider === "visual" && visual === "throw") throw new Error("reviewer crashed");
      const status = provider === "visual" ? "fail" : "pass";
      validity[provider] = status === "pass" ? "valid" : status;
      return { status };
    },
    fail: (message) => { throw new Error(message); },
    log: () => {}, logError: () => {},
    maxParallelProviders: () => 4, recordScheduler: () => {}, timestamp: Date.now
  });
  const runtime = createProofExecutionRuntime({
    proofReadinessValue: () => ({ version: 1, changeId: "change", status: "READY",
      workspaceHash: "h1", issues: [], externalProviders: [], unavailableProviders: [],
      pendingTasks: [], next: [] }),
    relevantSnapshot: () => ({ id: "s1", workspaceHash: "h1" }),
    loadRuntime: () => state,
    saveRuntime: (next) => { state = next; },
    now: () => "t",
    requiredProviders: () => ["test"],
    receiptValidity: (_id, provider) => ({ provider, validity: validity[provider] }),
    rebindReusableReceipt: () => {}, rebindDiffBoundReceipt: () => {},
    executionNodes: scheduler.executionNodes,
    collectableExecutionNodes: scheduler.collectableExecutionNodes,
    startRequiredServices: async () => [],
    runExecutionDag: scheduler.runExecutionDag,
    durableArtifact: () => null,
    pendingTasks: () => [], proofPreflight: () => {},
    prove: () => {
      proof = { version: 2, status: "pass", proofRunId: "p1", workspaceHash: "h1",
        providers: ["test"] };
    },
    proofAudit: () => proof ? { valid: true, proof } : { valid: false, reason: "missing" },
    readJson: () => proof,
    proofPath: () => "proof.json",
    providerCapability: (provider) => provider,
    providerConfig: () => ({ adapter: "command" }),
    visualReceipt: () => validity.visual === "fail"
      ? { workspaceHash: "h1", status: "fail", visual: { summary: "moved", findings: [finding] } } : null,
    die: (message) => { throw new Error(message); }
  });
  return {
    advance: async () => {
      const prior = process.exitCode;
      try { return await runtime.proofAdvance("change", { quiet: true }); }
      finally { process.exitCode = prior; }
    },
    state: () => state, validity, executed
  };
}

test("advisory differences are shown in the Prove outcome and the Land report, never as passing evidence", async () => {
  const world = proofWorld();
  assert.equal((await world.advance()).status, "PASS");
  const [row] = world.state().advisoryEvidence.rows;
  assert.equal(row.provider, "visual");
  assert.equal(row.advisory, true);
  assert.deepEqual(row.differences, [finding]);

  // The advance outcome when Prove finishes.
  let stored = { id: "change", status: "building", contractRevision: 1,
    advisoryEvidence: world.state().advisoryEvidence };
  const advance = createAdvanceRuntime({
    loadRuntime: () => structuredClone(stored),
    saveRuntime: (next) => { stored = structuredClone(next); },
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => "h1", stableHash: gateDigest,
    deliveredAiAttempts: () => [], authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "unused", output: () => {},
    runProof: async () => { stored = { ...stored, status: "proven" }; return { status: "PASS" }; }
  });
  const outcome = await advance.advanceThrough("change", "proven");
  assert.equal(outcome.action, "DONE");
  assert.equal(outcome.reached, "proven");
  assert.equal(outcome.advisoryEvidence.passingEvidence, false);
  assert.equal(outcome.advisoryEvidence.rows[0].differences.length, 1);
  const line = outcome.advisoryEvidence.summary[0];
  assert.match(line, /^advisory visual visual \(not passing evidence\): fail; 1 difference\(s\): settings: Save sits in the header \[major\]$/);

  // The Land report names the same advisory result.
  assert.deepEqual(landAdvisoryLines(stored), [line]);
  assert.deepEqual(landAdvisoryLines({}), []);
});

test("an advisory adapter that throws is recorded as an error and proof still finishes", async () => {
  const world = proofWorld({ visual: "throw" });
  const outcome = await world.advance();
  assert.equal(outcome.status, "PASS");
  assert.equal(world.validity.test, "valid", "the required provider ran and recorded its receipt");
  const [row] = world.state().advisoryEvidence.rows;
  assert.equal(row.status, "error");
  assert.match(row.reason, /adapter threw: reviewer crashed/);
});

test("an advisory provider whose dependency never ran is skipped with its reason and proof still finishes", async () => {
  const world = proofWorld({ visualDependsOn: ["browser"] });
  const outcome = await world.advance();
  assert.equal(outcome.status, "PASS");
  assert.equal(world.validity.test, "valid");
  assert.ok(!world.executed.includes("visual"));
  const [row] = world.state().advisoryEvidence.rows;
  assert.equal(row.status, "skipped");
  assert.match(row.reason, /dependency browser did not run/);
});

test("the scheduler skips an advisory node with an unmet dependency instead of aborting", async () => {
  const scheduler = createProviderScheduler({
    requiredProviders: () => ["test"], receiptValidity: () => ({ validity: "missing" }),
    providerConfig: () => null, commandExists: () => true, providerWorkspace: () => "/w",
    playwrightAvailability: () => ({}), evidence: () => ({ providers: {} }),
    providerCapability: (provider) => provider, adapterResources: () => [],
    resourcesConflict: () => false, executeAdapter: async () => ({ status: "pass" }),
    fail: (message) => { throw new Error(message); }, log: () => {}, logError: () => {},
    maxParallelProviders: () => 4, recordScheduler: () => {}, timestamp: Date.now
  });
  const outcomes = await scheduler.runExecutionDag("change", [
    { provider: "test", covers: ["test"], config: {}, resources: [], dependsOn: [] },
    { provider: "visual", covers: ["visual"], config: {}, resources: [], dependsOn: ["browser"],
      advisory: true }
  ], "run-1");
  assert.deepEqual(outcomes.map((row) => [row.provider, row.status]),
    [["test", "pass"], ["visual", "skipped"]]);
  // A required node with the same unmet dependency still stops the run.
  await assert.rejects(scheduler.runExecutionDag("change", [
    { provider: "test", covers: ["test"], config: {}, resources: [], dependsOn: ["browser"] }
  ], "run-2"), /unresolvable/);
});
