// DAG cycle diagnostics: a stuck scheduler names a concrete cycle path, and
// the provider scheduler distinguishes a cycle from a failed dependency.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findCyclePath } from "../../harness/runtime/core/graph.mjs";
import {
  createProviderScheduler,
  discoveryProducer,
  executionNodeCovers,
  executionNodesOperation,
  neededExecutionProviders,
  providerAvailabilityIssue,
  providerExecutionNode
} from "../../harness/runtime/evidence/provider-scheduler.mjs";
import { createAgentPlanner } from "../../harness/runtime/workflow/agent-planning.mjs";

test("findCyclePath returns null for an acyclic diamond", () => {
  assert.equal(findCyclePath(new Map([
    ["a", []], ["b", ["a"]], ["c", ["a"]], ["d", ["b", "c"]]
  ])), null);
});

test("findCyclePath names a simple cycle with matching endpoints", () => {
  const cycle = findCyclePath(new Map([["a", ["b"]], ["b", ["a"]]]));
  assert.ok(cycle);
  assert.equal(cycle[0], cycle[cycle.length - 1]);
  assert.deepEqual([...cycle].sort(), ["a", "a", "b"]);
});

test("findCyclePath reports a self-loop", () => {
  assert.deepEqual(findCyclePath(new Map([["a", ["a"]]])), ["a", "a"]);
});

function scheduler(statusByProvider) {
  const executions = [];
  const instance = createProviderScheduler({
    receiptValidity: () => ({ validity: "missing" }),
    resourcesConflict: () => false,
    executeAdapter: async (id, provider) => {
      executions.push(provider);
      return { status: statusByProvider[provider] || "pass" };
    },
    log: () => {},
    logError: () => {}
  });
  return { instance, executions };
}

function node(provider, dependsOn = [], covers = [provider]) {
  return { provider, covers, config: {}, resources: [], dependsOn };
}

test("execution node helpers filter valid receipts and classify availability", () => {
  const context = {
    requiredProviders: () => ["valid", "needed"],
    receiptValidity: (_id, provider) => ({ validity: provider === "valid" ? "valid" : "missing" }),
    commandExists: (command) => command !== "missing",
    providerWorkspace: (_id, provider) => provider,
    playwrightAvailability: (workspace) => ({
      packageOwned: workspace !== "unowned", binaryAvailable: workspace !== "unavailable"
    }),
    adapterResources: (provider) => [`resource:${provider}`]
  };
  assert.deepEqual(neededExecutionProviders(context, "c", "hash"), ["needed"]);
  assert.equal(providerAvailabilityIssue(context, "c", "p", {
    adapter: "shell", command: ["missing"]
  }), "p:command");
  assert.equal(providerAvailabilityIssue(context, "c", "unowned", {
    adapter: "playwright", command: ["playwright"]
  }), "unowned:project-owned-playwright");
  assert.equal(providerAvailabilityIssue(context, "c", "unavailable", {
    adapter: "playwright", command: ["playwright"]
  }), "unavailable:project-owned-playwright");
  assert.equal(providerAvailabilityIssue(context, "c", "p", {
    adapter: "contract-digest"
  }), null);
  assert.deepEqual(executionNodeCovers("p", {
    adapter: "shell", outputs: ["extra", "p"]
  }, ["p", "extra"]), ["p", "extra"]);
  assert.deepEqual(executionNodeCovers("test", {
    adapter: "test-discovery", discoveryProvider: "discovery"
  }, ["test", "discovery"]), ["test", "discovery"]);
  const built = providerExecutionNode(context, "p", {
    adapter: "shell", dependsOn: ["base"]
  }, null, ["p"]);
  assert.deepEqual(built.dependsOn, ["base"]);
  assert.deepEqual(built.resources, ["resource:p"]);
});

test("executionNodesOperation binds discovery outputs to their producer", () => {
  const configs = {
    discovery: { adapter: "discovery", command: ["discover"], capability: "discovery" },
    test: {
      adapter: "test-discovery", command: ["test"], capability: "test",
      discoveryProvider: "discovery", dependsOn: ["base"]
    },
    external: { adapter: "external" },
    command: { adapter: "shell", command: ["missing"] },
    browser: { adapter: "playwright", command: ["playwright"] },
    contract: { adapter: "contract-digest", capability: "contract" },
    output: { adapter: "shell", command: ["run"], outputs: ["covered"] },
    covered: { adapter: "shell", command: ["covered"] }
  };
  const required = [
    "discovery", "test", "external", "absent", "command", "browser",
    "contract", "output", "covered"
  ];
  const context = {
    requiredProviders: () => required,
    receiptValidity: () => ({ validity: "missing" }),
    providerConfig: (_id, provider) => configs[provider],
    commandExists: (command) => command !== "missing",
    providerWorkspace: (_id, provider) => provider,
    playwrightAvailability: () => ({ packageOwned: true, binaryAvailable: false }),
    evidence: () => ({ providers: configs }),
    providerCapability: (_provider, config) => config.capability,
    adapterResources: (provider) => [`resource:${provider}`]
  };
  const producer = discoveryProducer(
    "discovery", configs.discovery, configs, context.providerCapability);
  assert.equal(producer[0], "test");
  assert.equal(discoveryProducer("contract", configs.contract, configs,
    context.providerCapability), null);
  const result = executionNodesOperation(context, "c", "hash");
  assert.deepEqual(result.unconfigured, ["external", "absent"]);
  assert.deepEqual(result.unavailable, [
    "command:command", "browser:project-owned-playwright"
  ]);
  assert.deepEqual(result.nodes.map((entry) => entry.provider), ["test", "contract", "output"]);
  assert.deepEqual(result.nodes[0].covers, ["test", "discovery"]);
  assert.deepEqual(result.nodes[2].covers, ["output", "covered"]);
});

test("provider scheduler runs an acyclic graph in dependency order", async () => {
  const { instance, executions } = scheduler({});
  const outcomes = await instance.runExecutionDag("c1", [
    node("b", ["a"]), node("a")
  ], "run");
  assert.deepEqual(executions, ["a", "b"]);
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ["pass", "pass"]);
});

test("provider scheduler names the cycle path for a dependency cycle", async () => {
  const { instance } = scheduler({});
  await assert.rejects(
    instance.runExecutionDag("c1", [node("a", ["b"]), node("b", ["a"])], "run"),
    (error) => {
      assert.match(error.message, /provider dependency cycle: /);
      assert.match(error.message, /(a -> b -> a|b -> a -> b)/);
      return true;
    });
});

test("provider scheduler reports a failed dependency as blocked, not a cycle", async () => {
  const { instance } = scheduler({ a: "fail" });
  await assert.rejects(
    instance.runExecutionDag("c1", [node("a"), node("b", ["a"])], "run"),
    (error) => {
      assert.match(error.message, /blocked by failed dependency: b \(needs a\)/);
      assert.doesNotMatch(error.message, /cycle/);
      return true;
    });
});

test("provider scheduler attributes a failed covered output to its producer", async () => {
  const { instance } = scheduler({ t: "fail" });
  await assert.rejects(
    instance.runExecutionDag("c1", [
      node("t", [], ["t", "d"]), node("c", ["d"])
    ], "run"),
    (error) => {
      assert.match(error.message, /blocked by failed dependency: c \(needs d\)/);
      return true;
    });
});

function planner(tasks) {
  const changePath = mkdtempSync(join(tmpdir(), "dag-cycle-"));
  writeFileSync(join(changePath, "tasks.md"), "# Tasks\n");
  return createAgentPlanner({
    root: changePath,
    plans: changePath,
    runtime: join(changePath, "absent-runtime"),
    schemaVersion: 3,
    validate: () => {},
    loadRuntime: () => ({ revision: 0, contractRevision: 0 }),
    policy: () => ({
      execution: { maxParallelAgents: 3 },
      models: {
        fast: { family: "haiku" },
        standard: { family: "sonnet" },
        deep: { family: "opus" }
      }
    }),
    selectedRepositories: () => [{ id: "root", mode: "write", workspacePath: "." }],
    safeSelectedRepositories: () => null,
    taskBlocks: () => tasks,
    taskMetadata: (task) => task,
    activeChangePath: () => changePath,
    evidence: () => ({ claims: [] }),
    resourcesConflict: () => false,
    relevantHash: () => "hash",
    contractFingerprint: () => "fingerprint",
    stableHash: (value) => JSON.stringify(value).length.toString(16),
    now: () => "now",
    readJson: () => ({}),
    writeJson: () => {},
    recordInstructionManifest: null,
    modelForTask: () => ({ tier: "fast", family: "haiku" }),
    fail: (message) => { throw new Error(message); }
  });
}

function plannerTask(id, dependsOn = []) {
  // Disjoint paths keep same-repository tasks parallelizable, so wave shape
  // is decided by dependencies alone.
  return {
    id, done: false, repository: "root", dependsOn,
    resources: [], paths: [`${id}/`], kind: "code", text: id, requestedModel: null
  };
}

test("task planner names the cycle path for a dependency cycle", () => {
  const instance = planner([
    plannerTask("T001", ["T002"]), plannerTask("T002", ["T001"])
  ]);
  assert.throws(() => instance.planValue("c1"), (error) => {
    assert.match(error.message, /task dependency cycle: /);
    assert.match(error.message, /(T001 -> T002 -> T001|T002 -> T001 -> T002)/);
    return true;
  });
});

test("task planner groups an acyclic graph into dependency waves", () => {
  const instance = planner([
    plannerTask("T001"), plannerTask("T002", ["T001"]), plannerTask("T003")
  ]);
  const plan = instance.planValue("c1");
  assert.deepEqual(plan.groups, [["T001", "T003"], ["T002"]]);
});
