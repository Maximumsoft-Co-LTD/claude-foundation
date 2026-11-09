import assert from "node:assert/strict";
import test from "node:test";

import { createProviderScheduler } from "../runtime/evidence/provider-scheduler.mjs";
import {
  assertProofCollectionOutcomes, createProofExecutionRuntime
} from "../runtime/evidence/proof-execution-runtime.mjs";

const VISUAL = { adapter: "command", capability: "visual", command: ["node", "visual-review.mjs"],
  builtIn: "visual-review-v1" };
const finding = { id: "V1", screen: "settings", difference: "Save sits in the header",
  severity: "major", claimIds: ["C-a"] };

// One change: a required test provider and, depending on the binding, a
// visual provider. `binding` is "advisory", "strict", or null.
function world({ binding = "advisory", visualStatus = "fail", visualDependsOn = [] } = {}) {
  const validity = { test: "missing", visual: "missing", browser: "valid" };
  const executed = [];
  const required = () => binding === "strict" ? ["test", "visual"] : ["test"];
  const scheduler = createProviderScheduler({
    requiredProviders: required,
    receiptValidity: (_id, provider) => ({ provider, validity: validity[provider] || "missing" }),
    providerConfig: (_id, provider) => provider === "visual"
      ? (binding ? { ...VISUAL, dependsOn: visualDependsOn } : null)
      : { adapter: "command", command: ["node", `${provider}.mjs`] },
    commandExists: () => true,
    providerWorkspace: () => "/workspace",
    playwrightAvailability: () => ({ packageOwned: true, binaryAvailable: true }),
    evidence: () => ({
      claims: [{ id: "C-a", capabilities: binding === "strict" ? ["test", "visual"] : ["test"] }],
      providers: {},
      ...(binding ? { visualClaims: ["C-a"], visualAdvisory: binding === "advisory" } : {})
    }),
    providerCapability: (provider, config) => config?.capability || provider,
    adapterResources: () => [],
    resourcesConflict: () => false,
    executeAdapter: async (_id, provider) => {
      executed.push(provider);
      const status = provider === "visual" ? visualStatus : "pass";
      validity[provider] = status === "pass" ? "valid" : status;
      return { status };
    },
    fail: (message) => { throw new Error(message); },
    log: () => {}, logError: () => {},
    maxParallelProviders: () => 4,
    recordScheduler: () => {},
    timestamp: Date.now
  });
  return { scheduler, validity, executed, required };
}

test("an advisory binding schedules its visual provider as a non-required node", () => {
  const { scheduler } = world();
  const execution = scheduler.executionNodes("change", "h1");
  assert.deepEqual(execution.nodes.map((node) => [node.provider, Boolean(node.advisory)]),
    [["test", false], ["visual", true]]);
  assert.deepEqual(execution.unconfigured, []);
  assert.deepEqual(execution.unavailable, []);
});

test("strict binding keeps visual as a required node; no binding schedules none", () => {
  const strict = world({ binding: "strict" }).scheduler.executionNodes("change", "h1");
  assert.deepEqual(strict.nodes.map((node) => [node.provider, Boolean(node.advisory)]),
    [["test", false], ["visual", false]]);
  const none = world({ binding: null }).scheduler.executionNodes("change", "h1");
  assert.deepEqual(none.nodes.map((node) => node.provider), ["test"]);
  assert.deepEqual(none.unconfigured, []);
});

test("an advisory fail is recorded but never fails collection, and is not re-run on the same content", async () => {
  const { scheduler, executed } = world();
  const { nodes } = scheduler.executionNodes("change", "h1");
  const outcomes = await scheduler.runExecutionDag("change", nodes, "run-1");
  assert.deepEqual(outcomes.find((row) => row.provider === "visual"),
    { provider: "visual", status: "fail", advisory: true, observations: [] });
  assert.doesNotThrow(() => assertProofCollectionOutcomes(outcomes));
  assert.deepEqual(executed.sort(), ["test", "visual"]);
  assert.deepEqual(scheduler.executionNodes("change", "h1").nodes, [],
    "a current advisory receipt is its report; the reviewer is not called again");
  // A required failure still fails collection.
  assert.throws(() => assertProofCollectionOutcomes([{ provider: "test", status: "fail" }]),
    /evidence collection failed/);
});

test("an advisory node whose dependency failed is skipped without aborting the run", async () => {
  const { scheduler, validity } = world({ visualDependsOn: ["browser"] });
  validity.browser = "missing";
  const nodes = [
    ...scheduler.executionNodes("change", "h1").nodes,
    { provider: "browser", covers: ["browser"], config: {}, resources: [], dependsOn: [] }
  ];
  const failing = createProviderScheduler({
    requiredProviders: () => ["test", "browser"], receiptValidity: () => ({ validity: "missing" }),
    providerConfig: () => null, commandExists: () => true, providerWorkspace: () => "/w",
    playwrightAvailability: () => ({}), evidence: () => ({ providers: {} }),
    providerCapability: (provider) => provider, adapterResources: () => [],
    resourcesConflict: () => false,
    executeAdapter: async (_id, provider) => ({ status: provider === "browser" ? "fail" : "pass" }),
    fail: (message) => { throw new Error(message); }, log: () => {}, logError: () => {},
    maxParallelProviders: () => 4, recordScheduler: () => {}, timestamp: Date.now
  });
  const outcomes = await failing.runExecutionDag("change", nodes, "run-1");
  const visual = outcomes.find((row) => row.provider === "visual");
  assert.equal(visual.status, "skipped");
  assert.equal(visual.advisory, true);
  assert.equal(outcomes.find((row) => row.provider === "test").status, "pass");
});

test("through proof advance, an advisory visual fail leaves proof passing with no repair or drift", async () => {
  const { scheduler, validity, executed, required } = world();
  let state = { version: 2, id: "change", status: "building" };
  let proof = null;
  const runtime = createProofExecutionRuntime({
    proofReadinessValue: () => ({ version: 1, changeId: "change", status: "READY",
      workspaceHash: "h1", issues: [], externalProviders: [], unavailableProviders: [],
      pendingTasks: [], next: [] }),
    relevantSnapshot: () => ({ id: "s1", workspaceHash: "h1" }),
    loadRuntime: () => state,
    saveRuntime: (next) => { state = next; },
    now: () => "t",
    requiredProviders: required,
    receiptValidity: (_id, provider) => ({ provider, validity: validity[provider] }),
    rebindReusableReceipt: () => {}, rebindDiffBoundReceipt: () => {},
    executionNodes: scheduler.executionNodes,
    collectableExecutionNodes: scheduler.collectableExecutionNodes,
    startRequiredServices: async () => [],
    runExecutionDag: scheduler.runExecutionDag,
    durableArtifact: () => null,
    pendingTasks: () => [], proofPreflight: () => {},
    prove: () => {
      assert.ok(required().every((provider) => validity[provider] === "valid"));
      proof = { version: 2, status: "pass", proofRunId: "p1", workspaceHash: "h1",
        providers: required() };
    },
    proofAudit: () => proof ? { valid: true, proof } : { valid: false, reason: "missing" },
    readJson: () => proof,
    proofPath: () => "proof.json",
    providerCapability: (provider) => provider,
    providerConfig: () => ({ adapter: "command" }),
    visualReceipt: () => ({ workspaceHash: "h1", status: "fail", visual: { findings: [finding] } }),
    die: (message) => { throw new Error(message); }
  });
  const prior = process.exitCode;
  let outcome;
  try { outcome = await runtime.proofAdvance("change", { quiet: true }); }
  finally { process.exitCode = prior; }
  assert.ok(executed.includes("visual"), "the advisory provider ran and reported");
  assert.equal(validity.visual, "fail");
  assert.equal(outcome.status, "PASS");
  assert.deepEqual(outcome.providers, ["test"]);
  assert.equal(outcome.decision ?? null, null);
  assert.equal(state.visualRepair, undefined, "no visual repair round or drift");
});
