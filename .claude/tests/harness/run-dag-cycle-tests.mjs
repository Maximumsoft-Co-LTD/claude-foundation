// DAG cycle diagnostics: a stuck scheduler names a concrete cycle path, and
// the provider scheduler distinguishes a cycle from a failed dependency.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findCyclePath } from "../../harness/runtime/core/graph.mjs";
import { createProviderScheduler } from "../../harness/runtime/evidence/provider-scheduler.mjs";
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
