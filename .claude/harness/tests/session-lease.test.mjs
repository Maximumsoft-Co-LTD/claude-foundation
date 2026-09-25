import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAdvanceRuntime } from "../runtime/workflow/advance-runtime.mjs";
import {
  createSessionLeaseRuntime, sessionLeaseOwner, taskLineChecked
} from "../runtime/workflow/session-lease.mjs";

const stableHash = (value) => JSON.stringify(value).length.toString(16).padStart(12, "0");

function workspace(t, ticked = "") {
  const root = mkdtempSync(join(tmpdir(), "session-lease-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "openspec", "changes", "demo"), { recursive: true });
  const box = (id) => (ticked.includes(id) ? "x" : " ");
  writeFileSync(join(root, "openspec", "changes", "demo", "tasks.md"),
    `- [${box("T001")}] **T001** First [paths:src/a.js]\n- [${box("T002")}] **T002** Second [paths:src/b.js]\n`);
  return root;
}

function fakeLeases(root, leases, { releaseError = [] } = {}) {
  const calls = [];
  return {
    calls,
    runtime: createSessionLeaseRuntime({
      stableHash,
      loadRuntime: () => ({ workspace: { path: root } }),
      activeChangeLeases: () => leases,
      acquire: (id, taskId, flags) => {
        calls.push(["acquire", taskId, flags.owner]);
        return { leaseId: `lease-${calls.length}` };
      },
      discard: (id, taskId, owner) => { calls.push(["discard", taskId, owner]); },
      release: (id, taskId, flags) => {
        calls.push(["release", taskId, flags["lease-id"]]);
        const error = releaseError.shift();
        if (error) throw new Error(error);
        return { observedWrites: [] };
      }
    })
  };
}

test("a checked task is recognized by its exact id", () => {
  const ledger = "- [x] **T001** a\n- [ ] T010 b\n- [X] T0100 c\n";
  assert.equal(taskLineChecked(ledger, "T001"), true);
  assert.equal(taskLineChecked(ledger, "T010"), false);
  assert.equal(taskLineChecked(ledger, "T0100"), true);
  assert.equal(taskLineChecked(ledger, "T999"), false);
});

// A consumer Build acquired, released, and ticked every task by hand; the lease
// carried no decision, only ceremony between the agent and its next task.
test("settle releases only harness-issued session leases the agent completed", (t) => {
  const leases = [
    { taskId: "T001", owner: sessionLeaseOwner("demo", "T001", stableHash), leaseId: "l1" },
    { taskId: "T002", owner: "dispatch-t002-abc", leaseId: "l2" }
  ];
  const done = fakeLeases(workspace(t, "T001 T002"), leases);
  assert.deepEqual(done.runtime.settle("demo"), ["T001"]);
  assert.deepEqual(done.calls, [["release", "T001", "l1"]]);
  // A resume after an interruption is not a completion: the lease stays.
  const interrupted = fakeLeases(workspace(t), leases);
  assert.deepEqual(interrupted.runtime.settle("demo"), []);
  assert.deepEqual(interrupted.calls, []);
});

test("a widened scope renews the lease and a scope refusal routes back to advance", (t) => {
  const root = workspace(t, "T001 T002");
  const owner = sessionLeaseOwner("demo", "T001", stableHash);
  const stale = fakeLeases(root, [{ taskId: "T001", owner, leaseId: "l1" }], {
    releaseError: ["stale result authority for 'demo/T001': graph or contract changed after lease acquisition; re-acquire"]
  });
  assert.deepEqual(stale.runtime.settle("demo"), ["T001"]);
  assert.deepEqual(stale.calls.map((row) => row[0]), ["release", "acquire", "release"]);

  const scoped = fakeLeases(root, [{ taskId: "T002", owner, leaseId: "l1" }], {
    releaseError: ["task 'T002' changed outside granted scope: tests/b.spec.js; result and proof were not accepted. Revert ... 'claude-foundation agents acquire demo T002 --owner x'"]
  });
  assert.throws(() => scoped.runtime.settle("demo"), (error) => {
    assert.equal(error.owner, "agent");
    assert.match(error.message, /outside granted scope: tests\/b\.spec\.js\. Revert/);
    assert.match(error.message, /'claude-foundation advance demo --through build'$/);
    assert.doesNotMatch(error.message, /agents acquire/);
    return true;
  });
});

test("issue grants only a leased session task and removes the manual lease route", (t) => {
  const { runtime, calls } = fakeLeases(workspace(t), []);
  const edit = { action: "EDIT", workspace: "/sandbox", tasks: [{ id: "T001" }],
    execution: { mode: "session", leases: [{ taskId: "T001", acquireCommand: "x" }] } };
  const issued = runtime.issue("demo", edit);
  assert.deepEqual(issued.execution.leases, []);
  assert.equal(issued.execution.managedLease.managedBy, "harness");
  assert.equal(issued.execution.managedLease.leaseId, "lease-1");
  assert.match(issued.instructions.join(" "), /do not acquire or release the lease/);
  const single = { ...edit, execution: { mode: "session", leases: [] } };
  assert.equal(runtime.issue("demo", single), single);
  const group = { ...edit, execution: { mode: "parallel", leases: [{}, {}] } };
  assert.equal(runtime.issue("demo", group), group);
  assert.equal(calls.length, 1);
});

test("an explicit acquire takes over the harness-held lease without completing it", (t) => {
  const root = workspace(t);
  const owner = sessionLeaseOwner("demo", "T001", stableHash);
  const { runtime, calls } = fakeLeases(root, [
    { taskId: "T001", owner, leaseId: "l1" }, { taskId: "T002", owner: "agent-a", leaseId: "l2" }
  ]);
  runtime.yieldTo("demo");
  assert.deepEqual(calls, [["discard", "T001", owner]]);
});

test("advance settles the previous session task before dispatching the next", async () => {
  const order = [];
  const runtime = createAdvanceRuntime({
    loadRuntime: () => ({ status: "building", workspace: { path: "/tmp/change" } }),
    settleSessionLeases: () => { order.push("settle"); },
    issueSessionLease: (id, value) => { order.push("issue"); return { ...value, issued: true }; },
    agentDispatchValue: () => { order.push("dispatch");
      return { action: "run-leased-in-session", task: { taskId: "T002" } }; },
    agentPlanValue: () => ({ tasks: [{ id: "T002", text: "Second", repository: "root",
      paths: ["src/b.js"] }] }),
    relevantHash: () => "workspace-a", deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "/proof.json", stableHash
  });
  const value = await runtime.advanceThrough("demo", "build");
  assert.equal(value.action, "EDIT");
  assert.equal(value.issued, true);
  assert.deepEqual(order, ["settle", "dispatch", "issue"]);
});
