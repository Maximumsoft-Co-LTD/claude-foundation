import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquireLeaseUnderLock,
  leaseAcquisitionRequest,
  leaseDescriptorIsOwned,
  leaseRenewalRows,
  leaseResourceConflicts,
  sameLeaseRenewalAuthority,
  taskNodeOutputSchema
} from "../runtime/workflow/lease-runtime.mjs";

const owned = {
  changeId: "change-a", taskId: "T001", owner: "agent-a",
  key: "path:root:src/api"
};

test("lease ownership requires matching change, task, and owner", () => {
  assert.equal(leaseDescriptorIsOwned(owned, "change-a", "T001", "agent-a"), true);
  assert.equal(leaseDescriptorIsOwned({ ...owned, changeId: "other" },
    "change-a", "T001", "agent-a"), false);
  assert.equal(leaseDescriptorIsOwned({ ...owned, taskId: "T002" },
    "change-a", "T001", "agent-a"), false);
  assert.equal(leaseDescriptorIsOwned({ ...owned, owner: "agent-b" },
    "change-a", "T001", "agent-a"), false);
});

test("lease renewal rows retain only descriptors held by the same authority", () => {
  const rows = [
    { path: "one", descriptor: owned },
    { path: "two", descriptor: { ...owned, owner: "agent-b" } }
  ];
  assert.deepEqual(leaseRenewalRows(
    rows, "change-a", "T001", "agent-a"), [rows[0]]);
  assert.deepEqual(leaseRenewalRows([], "change-a", "T001", "agent-a"), []);
});

test("lease resource conflicts skip renewal rows and preserve legacy resource keys", () => {
  const rows = [{ descriptor: owned }, {
    descriptor: {
      changeId: "other", taskId: "T002", owner: "agent-b",
      resource: "path:root:src"
    }
  }, {
    descriptor: {
      changeId: "other", taskId: "T003", owner: "agent-c",
      key: "path:root:docs"
    }
  }];
  const conflicts = leaseResourceConflicts(
    ["path:root:src/api"], rows, "change-a", "T001", "agent-a",
    (requested, held) => requested.startsWith(held));
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].held, "path:root:src");
  assert.deepEqual(leaseResourceConflicts(
    [], rows, "change-a", "T001", "agent-a"), []);
});

test("lease renewal authority binds keys, owner, graph, and contract revision", () => {
  const renewal = [{ descriptor: owned }];
  const keys = [owned.key];
  const prior = {
    owner: "agent-a", graphRevision: "rev-1",
    graphIdentity: "graph-1", contractRevision: 2
  };
  const plan = {
    graphRevision: "rev-1", graphIdentity: "graph-1", contractRevision: "2"
  };
  assert.equal(sameLeaseRenewalAuthority(
    renewal, keys, prior, "agent-a", plan), true);
  const variants = [
    [[], keys, prior, "agent-a", plan],
    [renewal, ["other"], prior, "agent-a", plan],
    [renewal, keys, prior, "agent-b", plan],
    [renewal, keys, prior, "agent-a", { ...plan, graphRevision: "rev-2" }],
    [renewal, keys, prior, "agent-a", { ...plan, graphIdentity: "graph-2" }],
    [renewal, keys, prior, "agent-a", { ...plan, contractRevision: 3 }]
  ];
  for (const args of variants)
    assert.equal(sameLeaseRenewalAuthority(...args), false);
});

test("task output schema is selected without callback-only coverage", () => {
  const schema = { type: "object" };
  assert.equal(taskNodeOutputSchema({
    graph: { nodes: [{ id: "task:T001", outputSchema: schema }] }
  }, "T001"), schema);
  assert.equal(taskNodeOutputSchema({ graph: { nodes: [] } }, "T001"), undefined);
  assert.equal(taskNodeOutputSchema({}, "T001"), undefined);
});

function requestContext(plan, overrides = {}) {
  return {
    agentPlanValue: () => plan,
    policy: () => ({ execution: { leaseMinutes: 30 } }),
    leases: "/leases",
    exists: () => false,
    readJson: () => ({}),
    nowMs: () => Date.parse("2026-08-27T00:00:00.000Z"),
    fail: (message) => { throw new Error(message); },
    ...overrides
  };
}

test("lease acquisition request validates dispatch, task, dependencies, and owner", () => {
  const task = {
    id: "T001", dependsOn: [], resources: ["repo:root"], repository: "root"
  };
  const plan = { dispatchable: true, tasks: [task] };
  assert.throws(() => leaseAcquisitionRequest(
    requestContext(plan), "change-a", "T001", {}), /requires/);
  assert.throws(() => leaseAcquisitionRequest(
    requestContext(plan), "change-a", "T001", { owner: "bad owner" }), /requires/);
  assert.throws(() => leaseAcquisitionRequest(
    requestContext({ ...plan, dispatchable: false }),
    "change-a", "T001", { owner: "agent-a" }), /conflicts/);
  assert.throws(() => leaseAcquisitionRequest(
    requestContext(plan), "change-a", "missing", { owner: "agent-a" }), /unknown/);
  assert.throws(() => leaseAcquisitionRequest(requestContext({
    ...plan,
    tasks: [{ ...task, dependsOn: ["T002"] }, { id: "T002", dependsOn: [] }]
  }), "change-a", "T001", { owner: "agent-a" }), /blocked by/);

  const result = leaseAcquisitionRequest(requestContext(plan, {
    exists: () => true,
    readJson: () => ({ owner: "prior" })
  }), "change-a", "t001", { owner: "agent-a" });
  assert.deepEqual(result.keys, ["repo:root"]);
  assert.equal(result.prior.owner, "prior");
  assert.equal(result.expiresAt, "2026-08-27T00:30:00.000Z");
});

function lockedContext(overrides = {}) {
  const writes = [];
  const context = {
    id: "change-a",
    task: { id: "T001", repository: "root" },
    owner: "agent-a",
    keys: [],
    prior: {},
    plan: {
      graphRevision: "rev-1", graphIdentity: "graph-1", planDigest: "plan-1",
      contractRevision: 1, workspaceHash: "workspace-1", graph: { nodes: [] }
    },
    expiresAt: "2026-08-27T01:00:00.000Z",
    taskLeasePath: "/leases/tasks/change-a/T001.json",
    leases: "/leases",
    resourceDescriptors: () => [],
    writeJson: (...args) => writes.push(args),
    now: () => "2026-08-27T00:00:00.000Z",
    readJson: () => ({ generation: 0 }),
    stableHash: () => "lease-id",
    leasePath: (key) => `/leases/resources/${key}.json`,
    observedTaskSurface: () => [],
    ...overrides
  };
  return { context, writes };
}

test("lease transaction renews matching authority and rejects conflicts or stale renewal", () => {
  const renewal = { path: "/resource", descriptor: owned };
  const renewed = lockedContext({
    keys: [owned.key],
    prior: {
      owner: "agent-a", graphRevision: "rev-1", graphIdentity: "graph-1",
      contractRevision: 1
    },
    resourceDescriptors: () => [renewal]
  });
  assert.equal(acquireLeaseUnderLock(renewed.context).owner, "agent-a");
  assert.equal(renewed.writes.length, 2);

  const stale = lockedContext({
    keys: [owned.key], prior: { owner: "other" },
    resourceDescriptors: () => [renewal]
  });
  assert.throws(() => acquireLeaseUnderLock(stale.context), /stale lease authority/);

  const conflict = lockedContext({
    keys: ["repo:root"],
    resourceDescriptors: () => [{ descriptor: { key: "repo:root" } }]
  });
  assert.throws(() => acquireLeaseUnderLock(conflict.context),
    /held by unknown\/unknown/);
});

test("lease transaction creates default authority and rolls back partial resources", () => {
  const created = lockedContext({
    plan: {
      graphRevision: "rev-1", graphIdentity: "graph-1", planDigest: "plan-1",
      contractRevision: 1, workspaceHash: "workspace-1",
      graph: { nodes: [{ id: "task:T001", outputSchema: { type: "object" } }] }
    }
  });
  const lease = acquireLeaseUnderLock(created.context);
  assert.equal(lease.fencingGeneration, 1);
  assert.equal(lease.executionAttempt, 1);
  assert.deepEqual(lease.paths, []);
  assert.deepEqual(lease.claimIds, []);
  assert.deepEqual(lease.outputSchema, { type: "object" });

  const root = mkdtempSync(join(tmpdir(), "foundation-lease-rollback-"));
  try {
    const first = join(root, "first.json");
    const second = join(root, "second.json");
    writeFileSync(second, "occupied");
    const rollback = lockedContext({
      keys: ["first", "second"],
      leasePath: (key) => key === "first" ? first : second
    });
    assert.throws(() => acquireLeaseUnderLock(rollback.context), /EEXIST/);
    assert.equal(existsSync(first), false);
    assert.equal(existsSync(second), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
