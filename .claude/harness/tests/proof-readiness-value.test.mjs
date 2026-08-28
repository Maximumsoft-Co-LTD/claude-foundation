import assert from "node:assert/strict";
import test from "node:test";
import {
  proofReadinessValueOperation,
  readinessGraph,
  readinessNext,
  readinessStatus,
  workspaceIsolationIssuesValue
} from "../runtime/evidence/proof-readiness.mjs";

const empty = () => ({
  pending: [], issues: [], leases: [], repositoryConflicts: [],
  unavailable: [], repositoryIssues: [], unconfigured: []
});

test("readiness status preserves blocker precedence", () => {
  assert.equal(readinessStatus({ ...empty(), pending: [{}], issues: ["issue"] }),
    "NEEDS_CODE_CHANGE");
  assert.equal(readinessStatus({ ...empty(), issues: ["issue"], leases: [{}] }),
    "CONFIGURATION_ERROR");
  assert.equal(readinessStatus({ ...empty(), leases: [{}], unavailable: ["p"] }),
    "BLOCKED_BY_ACTIVE_WORK");
  assert.equal(readinessStatus({ ...empty(), repositoryConflicts: [{}] }),
    "BLOCKED_BY_ACTIVE_WORK");
  assert.equal(readinessStatus({ ...empty(), unavailable: ["p"], unconfigured: ["u"] }),
    "INFRASTRUCTURE_ERROR");
  assert.equal(readinessStatus({ ...empty(), repositoryIssues: ["repo"] }),
    "INFRASTRUCTURE_ERROR");
  assert.equal(readinessStatus({ ...empty(), unconfigured: ["u"] }),
    "NEEDS_USER_DECISION");
  assert.equal(readinessStatus(empty()), "READY");
});

test("readiness graph projects affected and preserved task nodes", () => {
  assert.equal(readinessGraph(null, []), null);
  const plan = { graph: {
    version: 2, revision: "r2", identity: "identity",
    nodes: [
      { id: "task:T1", kind: "task" },
      { id: "task:T2", kind: "task" },
      { id: "provider:test", kind: "provider" }
    ],
    edges: [{ from: "task:T1", to: "provider:test" }]
  } };
  assert.deepEqual(readinessGraph(plan, [{ id: "T1" }, { id: "missing" }]), {
    version: 2,
    revision: "r2",
    identity: "identity",
    nodeCount: 3,
    edgeCount: 1,
    pendingNodes: ["task:T1"],
    affectedNodes: ["provider:test", "task:T1"],
    preservedNodes: ["task:T2"]
  });
});

test("readiness recovery routes every typed status", () => {
  const calls = [];
  const context = {
    codeChangeRecovery: (...args) => { calls.push(["code", ...args]); return ["code"]; },
    configurationRecovery: (...args) => {
      calls.push(["config", ...args]); return ["config"];
    },
    activeWorkRecovery: (...args) => { calls.push(["active", ...args]); return ["active"]; },
    externalEvidenceRecovery: (...args) => { calls.push(["external", ...args]); return args[1]; },
    unavailableProviderRecovery: (...args) => {
      calls.push(["unavailable", ...args]); return args[1];
    }
  };
  const input = {
    id: "c", pending: ["task"], issues: ["issue"], surfaceFixits: ["fix"],
    leases: ["lease"], repositoryConflicts: ["conflict"],
    unconfigured: ["u1", "u2"], unavailable: ["x1", "x2"]
  };
  assert.deepEqual(readinessNext(context, {
    ...input, status: "NEEDS_CODE_CHANGE"
  }), ["code"]);
  assert.deepEqual(readinessNext(context, {
    ...input, status: "CONFIGURATION_ERROR"
  }), ["config"]);
  assert.deepEqual(readinessNext(context, {
    ...input, status: "BLOCKED_BY_ACTIVE_WORK"
  }), ["active"]);
  assert.deepEqual(readinessNext(context, {
    ...input, status: "NEEDS_USER_DECISION"
  }), ["u1", "u2"]);
  assert.deepEqual(readinessNext(context, {
    ...input, status: "INFRASTRUCTURE_ERROR"
  }), ["x1", "x2"]);
  assert.deepEqual(readinessNext(context, { ...input, status: "READY" }), []);
  assert.ok(calls.some(([kind]) => kind === "external"));
  assert.ok(calls.some(([kind]) => kind === "unavailable"));
});

function operationContext(overrides = {}) {
  return {
    validate: () => {},
    topologyIssues: () => [],
    workspaceIsolationIssues: () => [],
    changedSurfaceIssues: () => [],
    criticalCaseIssues: () => [],
    relevantHash: () => "workspace",
    executionNodes: () => ({ unconfigured: [], unavailable: [] }),
    repositoryInfrastructureIssues: () => [],
    pendingTasks: () => [],
    agentPlanValue: null,
    handoffReadiness: () => ({ status: "COMPLETE" }),
    activeChangeLeases: () => [],
    activeRepositoryConflicts: () => [],
    selectedRepositories: () => [{ id: "root" }],
    advisoryCapabilities: () => [{ capability: "advisory" }],
    readinessBudgetPolicy: (status) => ({ status }),
    codeChangeRecovery: () => ["code-recovery"],
    configurationRecovery: () => ["configuration-recovery"],
    activeWorkRecovery: () => ["active-recovery"],
    externalEvidenceRecovery: (_id, provider) => ({ provider }),
    unavailableProviderRecovery: (_id, provider) => ({ provider }),
    ...overrides
  };
}

test("prove readiness operation composes issues, graph, leases, and task fallbacks", () => {
  const calls = [];
  const context = operationContext({
    validate: (...args) => calls.push(["validate", ...args]),
    topologyIssues: () => ["topology"],
    changedSurfaceIssues: (_id, fixits) => {
      fixits.push({ repositoryId: "root" });
      return ["surface"];
    },
    criticalCaseIssues: () => ["critical"],
    executionNodes: () => ({ unconfigured: ["external"], unavailable: ["down"] }),
    repositoryInfrastructureIssues: () => ["repository"],
    pendingTasks: () => [{ id: "T1", text: "first" }, { id: "", text: "fallback" }],
    agentPlanValue: () => ({ graph: {
      version: 2, revision: "r", identity: "i",
      nodes: [{ id: "task:T1", kind: "task" }], edges: []
    } }),
    activeChangeLeases: () => [
      { taskId: "T1", owner: "one", expiresAt: "later" },
      { taskId: "T2", owner: "two" }
    ],
    activeRepositoryConflicts: (...args) => {
      calls.push(["conflicts", ...args]); return [{ changeId: "other" }];
    }
  });
  const value = proofReadinessValueOperation(context, "change", "prove");
  assert.equal(value.status, "NEEDS_CODE_CHANGE");
  assert.deepEqual(value.pendingTasks, ["T1", "fallback"]);
  assert.deepEqual(value.issues, ["topology", "surface", "critical"]);
  assert.deepEqual(value.activeLeases, [
    { taskId: "T1", owner: "one", expiresAt: "later" },
    { taskId: "T2", owner: "two", expiresAt: null }
  ]);
  assert.deepEqual(value.graph.pendingNodes, ["task:T1"]);
  assert.deepEqual(value.next, ["code-recovery"]);
  assert.equal(value.externalOperations.proofBlocking, false);
  assert.match(value.externalOperations.note, /evaluated at Land/);
  assert.deepEqual(calls[0], ["validate", "change", "active", { quiet: true }]);
  assert.deepEqual(calls.at(-1), [
    "conflicts", "change", [{ id: "root" }], { executing: true }
  ]);
});

test("root product changes require an isolated workspace", () => {
  const state = { id: "demo", workspace: { mode: "current" } };
  assert.match(workspaceIsolationIssuesValue(state, [
    { repositoryId: "root", path: "src/app.js" }
  ])[0], /ISOLATION_REQUIRED/);
  assert.deepEqual(workspaceIsolationIssuesValue(state, [
    { repositoryId: "root", path: "openspec/changes/demo/tasks.md" }
  ]), []);
  assert.deepEqual(workspaceIsolationIssuesValue({
    ...state, workspace: { mode: "copy" }
  }, [{ repositoryId: "root", path: "src/app.js" }]), []);
});

test("build readiness skips prove-only checks and returns a ready value", () => {
  const context = operationContext({
    changedSurfaceIssues: assert.fail,
    criticalCaseIssues: assert.fail,
    repositoryInfrastructureIssues: assert.fail,
    activeChangeLeases: assert.fail
  });
  const value = proofReadinessValueOperation(context, "change", "build");
  assert.equal(value.stage, "build");
  assert.equal(value.status, "READY");
  assert.deepEqual(value.repositoryIssues, []);
  assert.deepEqual(value.activeLeases, []);
  assert.equal(value.graph, null);
  assert.deepEqual(value.next, []);
});
