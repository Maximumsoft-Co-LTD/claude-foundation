import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createAdvanceRuntime } from "../runtime/workflow/advance-runtime.mjs";
import { createLeaseRuntime } from "../runtime/workflow/lease-runtime.mjs";
import { recoverCompletedTasksForExecution } from "../runtime/workflow/agent-planning.mjs";
import { taskAuthorityShape } from "../runtime/core/task-execution-authority.mjs";
import {
  createSessionLeaseRuntime, runTaskCheck, sessionLeaseOwner, taskCheck, taskLineChecked, tickTaskLine
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

test("a scope refusal routes back to advance; release owns stale-authority renewal", (t) => {
  const root = workspace(t, "T001 T002");
  const owner = sessionLeaseOwner("demo", "T001", stableHash);
  const settled = fakeLeases(root, [{ taskId: "T001", owner, leaseId: "l1" }]);
  assert.deepEqual(settled.runtime.settle("demo"), ["T001"]);
  assert.deepEqual(settled.calls.map((row) => row[0]), ["release"],
    "settle never composes acquire-then-release itself");

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

test("reverify settles ticked tasks with stale records and leaves real work to the plan", (t) => {
  const root = workspace(t, "T001 T002");
  const calls = [];
  let blockOnce = true;
  const runtime = createSessionLeaseRuntime({
    stableHash,
    loadRuntime: () => ({ workspace: { path: root } }),
    activeChangeLeases: () => [],
    acquire: (id, taskId, flags) => {
      // T002 waits for T001 in the first pass, as acquire refuses a task
      // behind a pending dependency.
      if (taskId === "T002" && blockOnce) { blockOnce = false; throw new Error("blocked by T001"); }
      calls.push(["acquire", taskId, flags.owner]);
      return { leaseId: `lease-${taskId}` };
    },
    release: (id, taskId, flags) => { calls.push(["release", taskId, flags["lease-id"]]); },
    discard: () => {}
  });
  const rows = [
    { taskId: "T002", reason: "depends on T001, which needs verification" },
    { taskId: "T001", reason: "stale or invalid result authority: taskAuthority" },
    { taskId: "T003", reason: "never ticked" }
  ];
  assert.deepEqual(runtime.reverify("demo", rows), ["T001", "T002"]);
  assert.deepEqual(calls.map((row) => `${row[0]}:${row[1]}`),
    ["acquire:T001", "release:T001", "acquire:T002", "release:T002"]);
  assert.ok(calls.every((row) => row[0] !== "acquire" || row[2] ===
    sessionLeaseOwner("demo", row[1], stableHash)), "the harness owns every re-verification lease");
});

test("reverify skips a task a live worker holds and one whose check fails", (t) => {
  const root = workspace(t, "T001 T002");
  const calls = [];
  const runtime = createSessionLeaseRuntime({
    stableHash,
    loadRuntime: () => ({ workspace: { path: root } }),
    activeChangeLeases: () => [{ taskId: "T001", owner: "dispatch-t001-live" }],
    acquire: (id, taskId) => { calls.push(taskId); return { leaseId: "l" }; },
    release: () => {}, discard: () => {},
    runCheck: () => ({ status: "fail", exitCode: 1, output: "FAIL" })
  });
  writeFileSync(join(root, "openspec", "changes", "demo", "tasks.md"),
    "- [x] **T001** First [paths:src/a.js]\n- [x] **T002** Second — verify: `npm test` [paths:src/b.js]\n");
  assert.deepEqual(runtime.reverify("demo", [{ taskId: "T001" }, { taskId: "T002" }]), []);
  assert.deepEqual(calls, [], "no lease is taken for held or failing tasks");
});

// A consumer amended the spec mid-Build, its leases expired, and workers
// finished the rest outside any lease. All tasks are ticked; none needs work.
test("an amended, out-of-lease Build settles to verified without handing work back", (t) => {
  const root = workspace(t, "T001 T002");
  const leases = join(root, ".foundation", "leases");
  const node = (id, digest, dependsOn = []) => ({
    id: `task:${id}`, kind: "task", repository: "root", required: true,
    dependsOn: dependsOn.map((value) => `task:${value}`), paths: [`src/${id.toLowerCase()}.js`],
    contracts: [], resources: ["workspace:root"], claims: [], inputSchema: null,
    outputSchema: null, lifecycle: "build", authorityDigest: digest
  });
  const ledger = [
    { id: "T001", done: true, dependsOn: [], paths: ["src/t001.js"], repository: "root" },
    { id: "T002", done: true, dependsOn: ["T001"], paths: ["src/t002.js"], repository: "root" }
  ];
  let graph = { version: 3, revision: "r1", identity: "i1", claims: [],
    nodes: [node("T001", "a"), node("T002", "b", ["T001"])] };
  let contractRevision = 1;
  const readJson = (path, fallback = null) => existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8")) : fallback;
  const recover = () => recoverCompletedTasksForExecution({
    id: "demo", allTasks: ledger, graph, state: { contractRevision }, priorPlan: {},
    currentContractFingerprint: "c",
    taskResult: (id, taskId) => {
      const path = join(leases, "results", id, `${taskId}.json`);
      return existsSync(path) ? { path, value: readJson(path) } : null;
    },
    taskLease: (id, taskId) => {
      const path = join(leases, "tasks", id, `${taskId}.json`);
      return existsSync(path) ? readJson(path) : null;
    }
  });
  const planValue = () => {
    const recovered = recover();
    return {
      dispatchable: true, graph, graphRevision: graph.revision, graphIdentity: graph.identity,
      contractRevision, planDigest: "p", workspaceHash: "w",
      tasks: recovered.tasks.filter((task) => !task.done), verification: recovered.verification
    };
  };
  const leaseRuntime = createLeaseRuntime({
    leases, stableHash, agentPlanValue: planValue,
    policy: () => ({ execution: { leaseMinutes: 45 } }),
    readJson, writeJson: (path, value) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(value)}\n`);
    },
    now: () => new Date().toISOString(),
    fail: (message) => { throw new Error(message); }
  });
  const sessions = createSessionLeaseRuntime({
    stableHash, loadRuntime: () => ({ workspace: { path: root } }),
    activeChangeLeases: (id) => leaseRuntime.active(id, { includeExpired: true }),
    acquire: leaseRuntime.acquire, release: leaseRuntime.release, discard: leaseRuntime.discard
  });

  // No lease ever recorded these tasks: both need verification.
  assert.deepEqual(recover().verification.map((row) => row.taskId), ["T001", "T002"]);
  assert.deepEqual(sessions.reverify("demo", planValue().verification), ["T001", "T002"]);
  assert.deepEqual(recover().verification, [], "both tasks now carry current authority");

  // An amendment moves the graph and contract and rewrites T002 only.
  graph = { ...graph, revision: "r2", identity: "i2",
    nodes: [node("T001", "a"), node("T002", "b-amended", ["T001"])] };
  contractRevision = 2;
  assert.deepEqual(recover().verification.map((row) => row.taskId), ["T002"],
    "the untouched T001 keeps its result across the amendment");
  assert.deepEqual(sessions.reverify("demo", planValue().verification), ["T002"]);
  assert.deepEqual(recover().verification, []);
});

// A parallel worker released T001 and asked the user to tick tasks.md
// because the host blocked its own checkbox edit. The harness owns the tick.
test("a released parallel result is ticked by the harness once its verify passes", (t) => {
  const root = workspace(t);
  const ledger = join(root, "openspec", "changes", "demo", "tasks.md");
  writeFileSync(ledger,
    "- [ ] **T001** First — verify: `npm test -- a` [paths:src/a.js]\n" +
    "- [ ] **T002** Second — verify: `npm test -- b` [paths:src/b.js]\n");
  const runtime = createSessionLeaseRuntime({
    stableHash, loadRuntime: () => ({ workspace: { path: root } }),
    activeChangeLeases: () => [], acquire: () => ({}), release: () => {}, discard: () => {},
    runCheck: (id, check) => ({ status: check.command.endsWith("a") ? "pass" : "fail",
      exitCode: check.command.endsWith("a") ? 0 : 1, output: "b broke" })
  });
  assert.deepEqual(runtime.tickAccepted("demo", ["T001", "T002"]), ["T001"]);
  const content = readFileSync(ledger, "utf8");
  assert.equal(taskLineChecked(content, "T001"), true);
  assert.equal(taskLineChecked(content, "T002"), false, "a failing verify stays pending");
  const handed = runtime.issue("demo", {
    action: "EDIT", tasks: [{ id: "T002" }], execution: { mode: "parallel", leases: [] }
  });
  assert.equal(handed.verificationFailures[0].taskId, "T002",
    "the next parallel EDIT carries the failure instead of a bare pending task");
});

test("the planner reports an accepted unticked result as ready for the harness tick", () => {
  const graph = { version: 3, revision: "r1", identity: "i1", claims: [], nodes: [{
    id: "task:T001", kind: "task", repository: "root", required: true, dependsOn: [],
    paths: ["src/a.js"], contracts: [], resources: [], claims: [], inputSchema: null,
    outputSchema: null, lifecycle: "build", authorityDigest: "a"
  }] };
  const result = { value: {
    taskId: "T001", repository: "root", status: "observed", paths: ["src/a.js"], claimIds: [],
    outputSchema: null, planDigest: "p", workspaceHash: "w", leaseId: "l",
    fencingGeneration: 1, executionAttempt: 1, observedWrites: ["src/a.js"],
    taskAuthority: taskAuthorityShape(graph, "T001")
  } };
  const tasks = [{ id: "T001", done: false, dependsOn: [] }];
  const base = { id: "demo", allTasks: tasks, graph, state: { contractRevision: 1 },
    priorPlan: {}, currentContractFingerprint: "c" };
  assert.deepEqual(recoverCompletedTasksForExecution({
    ...base, taskResult: () => result }).resultReady, ["T001"]);
  assert.deepEqual(recoverCompletedTasksForExecution({
    ...base, taskResult: () => result, taskLease: () => ({ leaseId: "live" }) }).resultReady, [],
  "a task a worker still holds is not ready");
  assert.deepEqual(recoverCompletedTasksForExecution({ ...base }).resultReady, [],
    "no released result, no tick");
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
  assert.equal(calls.length, 1);
});

test("a parallel group runs on harness-held leases; the parent only spawns and waits", (t) => {
  const { runtime, calls } = fakeLeases(workspace(t), []);
  const group = {
    action: "EDIT", workspace: "/sandbox", tasks: [{ id: "T001" }, { id: "T002" }],
    execution: { mode: "parallel", leases: [
      { taskId: "T001", repository: "api", owner: "dispatch-t001-x",
        acquireCommand: "claude-foundation agents acquire demo T001 --owner dispatch-t001-x",
        packetCommand: "claude-foundation packet demo --task T001",
        releaseCommand: "claude-foundation agents release demo T001 --owner dispatch-t001-x" },
      { taskId: "T002", repository: "web", owner: "dispatch-t002-x",
        acquireCommand: "claude-foundation agents acquire demo T002 --owner dispatch-t002-x",
        packetCommand: "claude-foundation packet demo --task T002",
        releaseCommand: "claude-foundation agents release demo T002 --owner dispatch-t002-x" }
    ] }
  };
  const issued = runtime.issue("demo", group);
  assert.deepEqual(calls, [
    ["acquire", "T001", sessionLeaseOwner("demo", "T001", stableHash)],
    ["acquire", "T002", sessionLeaseOwner("demo", "T002", stableHash)]
  ], "the harness acquires every lease with its own owner");
  assert.deepEqual(issued.execution.leases, []);
  assert.deepEqual(issued.execution.workers.map((worker) => worker.packetCommand), [
    "claude-foundation packet demo --task T001", "claude-foundation packet demo --task T002"
  ]);
  assert.ok(issued.execution.managedLeases.every((lease) => lease.managedBy === "harness"));
  const text = JSON.stringify(issued);
  assert.doesNotMatch(text, /agents (acquire|release)/, "no lease command reaches the agent");
  assert.match(issued.instructions.join(" "), /Nobody acquires or releases a lease or edits tasks\.md/);
});

test("a parallel group that cannot lease every worker returns the leases it took", () => {
  const calls = [];
  const runtime = createSessionLeaseRuntime({
    stableHash, loadRuntime: () => ({}), activeChangeLeases: () => [], release: () => {},
    acquire: (id, taskId) => {
      if (taskId === "T002") throw new Error("T002 is held");
      calls.push(["acquire", taskId]);
      return { leaseId: `lease-${taskId}` };
    },
    discard: (id, taskId, owner) => { calls.push(["discard", taskId, owner]); }
  });
  const group = { action: "EDIT", tasks: [{ id: "T001" }, { id: "T002" }],
    execution: { mode: "parallel", leases: [{ taskId: "T001" }, { taskId: "T002" }] } };
  assert.throws(() => runtime.issue("demo", group), /T002 is held/);
  assert.deepEqual(calls, [
    ["acquire", "T001"], ["discard", "T001", sessionLeaseOwner("demo", "T001", stableHash)]
  ]);
});

test("a no-lease session handoff records a harness-verified result for each passing task", (t) => {
  const root = workspace(t);
  writeFileSync(join(root, "openspec", "changes", "demo", "tasks.md"),
    "- [ ] **T001** First — verify: `npm test -- a` [paths:src/a.js]\n" +
    "- [ ] **T002** Second — verify: `npm test -- b` [paths:src/b.js]\n");
  let state = { workspace: { path: root }, sessionHandoff: { version: 1, taskIds: ["T001", "T002"] } };
  const calls = [];
  const runtime = createSessionLeaseRuntime({
    stableHash, loadRuntime: () => state, saveRuntime: (value) => { state = value; },
    activeChangeLeases: () => [],
    acquire: (id, taskId, flags) => { calls.push(["acquire", taskId, flags.owner]); return { leaseId: `l-${taskId}` }; },
    release: (id, taskId, flags) => { calls.push(["release", taskId, flags["lease-id"]]); },
    discard: () => {},
    runCheck: (id, check) => ({ status: check.command.endsWith("a") ? "pass" : "fail", exitCode: 1 })
  });
  assert.deepEqual(runtime.settle("demo"), ["T001"]);
  assert.deepEqual(calls.map((row) => `${row[0]}:${row[1]}`), ["acquire:T001", "release:T001"],
    "only the passing task gets a recorded result");
  assert.deepEqual(state.sessionHandoff.taskIds, ["T002"]);
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

// The fakes above cannot see the lease primitive's authority checks. These
// drive the real runtime, where a widened `[paths:]` changes both the lease
// keys and the graph identity of a task the agent has not ticked yet.
function realLeases(t, root) {
  const leases = mkdtempSync(join(tmpdir(), "session-lease-real-"));
  t.after(() => rmSync(leases, { recursive: true, force: true }));
  const plan = {
    dispatchable: true, planDigest: "p", graphRevision: "g1", graphIdentity: "gi1",
    contractRevision: 1, workspaceHash: "w", graph: { nodes: [] },
    tasks: [{ id: "T001", dependsOn: [], leaseKeys: ["path:root:src/a.js"],
      paths: ["src/a.js"], claims: [], repository: "root" }]
  };
  const surface = new Map();
  const json = (path, fallback = {}) => {
    try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
  };
  const leaseRuntime = createLeaseRuntime({
    leases,
    stableHash: (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex"),
    agentPlanValue: () => plan,
    policy: () => ({ execution: { leaseMinutes: 45 } }),
    readJson: json,
    writeJson: (path, value) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(value)}\n`);
    },
    now: () => new Date().toISOString(),
    observedTaskSurface: () => [...surface].map(([path, identity]) => ({ path, identity })),
    fail: (message) => { throw new Error(message); }
  });
  const runtime = createSessionLeaseRuntime({
    stableHash, loadRuntime: () => ({ workspace: { path: root } }),
    activeChangeLeases: leaseRuntime.active, acquire: leaseRuntime.acquire,
    release: leaseRuntime.release, discard: leaseRuntime.discard
  });
  const edit = { action: "EDIT", workspace: root, tasks: [{ id: "T001" }],
    execution: { mode: "session", leases: [{ taskId: "T001" }] } };
  return { leases, plan, surface, runtime, edit, json };
}

function tick(root, taskId) {
  const path = join(root, "openspec", "changes", "demo", "tasks.md");
  writeFileSync(path, readFileSync(path, "utf8").replace(`[ ] **${taskId}**`, `[x] **${taskId}**`));
}

test("resuming an unticked task after widening its paths renews the harness lease", (t) => {
  const root = workspace(t);
  const { leases, plan, surface, runtime, edit, json } = realLeases(t, root);
  const first = runtime.issue("demo", edit).execution.managedLease;
  surface.set("src/a.js", "edited");
  surface.set("tests/a.test.js", "edited");
  plan.tasks[0].leaseKeys = ["path:root:src/a.js", "path:root:tests/a.test.js"];
  plan.tasks[0].paths = ["src/a.js", "tests/a.test.js"];
  plan.graphRevision = "g2";
  plan.graphIdentity = "gi2";
  const second = runtime.issue("demo", edit).execution.managedLease;
  assert.notEqual(second.leaseId, first.leaseId);
  tick(root, "T001");
  assert.deepEqual(runtime.settle("demo"), ["T001"]);
  const result = json(join(leases, "results", "demo", "T001.json"));
  assert.deepEqual(result.observedWrites, ["src/a.js", "tests/a.test.js"],
    "writes made before the renewal still count against the widened scope");
});

test("a harness lease past its TTL is still settled when the agent ticks the task", (t) => {
  const root = workspace(t);
  const { leases, surface, runtime, edit, json } = realLeases(t, root);
  runtime.issue("demo", edit);
  surface.set("src/a.js", "edited");
  const past = "2020-01-01T00:00:00.000Z";
  const index = join(leases, "tasks", "demo", "T001.json");
  writeFileSync(index, `${JSON.stringify({ ...json(index), expiresAt: past })}\n`);
  for (const name of readdirSync(join(leases, "resources"))) {
    const path = join(leases, "resources", name);
    writeFileSync(path, `${JSON.stringify({ ...json(path), expiresAt: past })}\n`);
  }
  tick(root, "T001");
  assert.deepEqual(runtime.settle("demo"), ["T001"]);
  assert.equal(existsSync(index), false);
  assert.deepEqual(json(join(leases, "results", "demo", "T001.json")).observedWrites,
    ["src/a.js"]);
});

// D5: the harness, not the agent, ticks a task once its own focused check passes.
function checkedWorkspace(t) {
  const root = mkdtempSync(join(tmpdir(), "session-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "openspec", "changes", "demo"), { recursive: true });
  writeFileSync(join(root, "openspec", "changes", "demo", "tasks.md"),
    "- [ ] **T001** First [paths:src/a.js] — verify: `node -e 'process.exit(0)'`\n" +
    "- [ ] **T002** Second [repo:api] [paths:src/b.js] — verify: `npm test -- b`\n" +
    "- [ ] **T003** Third [paths:src/c.js] — verify: `existing`\n");
  return root;
}

test("task checks parse the ledger's own verify and tick exactly one line", () => {
  const ledger = "- [ ] **T001** a — verify: `npm test`\n- [ ] **T0010** b — verify: `x`\n";
  assert.deepEqual(taskCheck(ledger, "T001"), { taskId: "T001", command: "npm test", repository: "root" });
  assert.equal(taskCheck("- [ ] **T001** a — verify: `existing`", "T001"), null);
  assert.equal(taskCheck("- [ ] **T001** a", "T001"), null);
  assert.equal(tickTaskLine(ledger, "T001"),
    "- [x] **T001** a — verify: `npm test`\n- [ ] **T0010** b — verify: `x`\n");
});

test("settle ticks a leased task whose focused check passes and keeps a failing one pending", (t) => {
  const root = checkedWorkspace(t);
  const leases = [
    { taskId: "T001", owner: sessionLeaseOwner("demo", "T001", stableHash), leaseId: "l1" },
    { taskId: "T002", owner: sessionLeaseOwner("demo", "T002", stableHash), leaseId: "l2" },
    { taskId: "T003", owner: sessionLeaseOwner("demo", "T003", stableHash), leaseId: "l3" }
  ];
  const checks = [];
  const calls = [];
  const runtime = createSessionLeaseRuntime({
    stableHash, loadRuntime: () => ({ workspace: { path: root } }),
    activeChangeLeases: () => leases,
    acquire: () => ({ leaseId: "renewed" }), discard: () => {},
    release: (id, taskId) => { calls.push(taskId); },
    runCheck: (id, check) => {
      checks.push(check);
      return check.taskId === "T001" ? { status: "pass", exitCode: 0 }
        : { status: "fail", exitCode: 1, output: "1 failing" };
    }
  });
  assert.deepEqual(runtime.settle("demo"), ["T001"]);
  assert.deepEqual(calls, ["T001"]);
  assert.deepEqual(checks.map((row) => [row.taskId, row.repository]), [["T001", "root"], ["T002", "api"]]);
  const ledger = readFileSync(join(root, "openspec", "changes", "demo", "tasks.md"), "utf8");
  assert.match(ledger, /^- \[x\] \*\*T001\*\*/m);
  assert.match(ledger, /^- \[ \] \*\*T002\*\*/m);
  // The failing check reaches the agent with the re-issued task.
  const issued = runtime.issue("demo", { action: "EDIT", workspace: root, tasks: [{ id: "T002" }],
    execution: { mode: "session", leases: [{ taskId: "T002" }] } });
  assert.deepEqual(issued.verificationFailures, [{ taskId: "T002", command: "npm test -- b",
    exitCode: 1, output: "1 failing" }]);
  assert.match(issued.instructions.join(" "), /do not edit tasks\.md/);
});

// A repository task is ticked exactly like a root task: its check runs in its
// own repository sandbox and the checkbox lands in the control ledger.
test("an accepted repository task is ticked in the control ledger after its check passes", (t) => {
  const root = checkedWorkspace(t);
  const api = mkdtempSync(join(tmpdir(), "session-check-api-"));
  t.after(() => rmSync(api, { recursive: true, force: true }));
  const state = { workspace: { path: root }, repositories: { api: { path: api } } };
  const seen = [];
  const runtime = createSessionLeaseRuntime({
    stableHash, loadRuntime: () => state, activeChangeLeases: () => [],
    acquire: () => ({ leaseId: "l1" }), discard: () => {}, release: () => {},
    runCheck: (id, check) => runTaskCheck({ loadRuntime: () => state,
      spawn: (shell, args, options) => { seen.push(options.cwd); return { status: 0 }; } }, id, check)
  });
  assert.deepEqual(runtime.tickAccepted("demo", ["T002"]), ["T002"]);
  assert.deepEqual(seen, [api]);
  assert.match(readFileSync(join(root, "openspec", "changes", "demo", "tasks.md"), "utf8"),
    /^- \[x\] \*\*T002\*\* Second \[repo:api\]/m);
});

test("a single-agent handoff is recorded, then completed by its passing check", (t) => {
  const root = checkedWorkspace(t);
  let state = { workspace: { path: root } };
  const runtime = createSessionLeaseRuntime({
    stableHash, loadRuntime: () => structuredClone(state),
    saveRuntime: (value) => { state = structuredClone(value); },
    activeChangeLeases: () => [], acquire: () => { throw new Error("no lease"); },
    discard: () => {}, release: () => {},
    runCheck: (id, check) => runTaskCheck({ loadRuntime: () => state }, id, check)
  });
  // Nothing was handed off yet: resuming runs no check.
  assert.deepEqual(runtime.settle("demo"), []);
  const edit = { action: "EDIT", workspace: root, tasks: [{ id: "T001" }],
    execution: { mode: "session", leases: [] } };
  assert.equal(runtime.issue("demo", edit), edit);
  assert.deepEqual(state.sessionHandoff.taskIds, ["T001"]);
  assert.deepEqual(runtime.settle("demo"), ["T001"]);
  assert.equal(state.sessionHandoff, undefined);
  assert.match(readFileSync(join(root, "openspec", "changes", "demo", "tasks.md"), "utf8"),
    /^- \[x\] \*\*T001\*\*/m);
});

test("a no-lease handoff surfaces an out-of-scope write and keeps the handoff pending", (t) => {
  const root = checkedWorkspace(t);
  let state = { workspace: { path: root }, sessionHandoff: { version: 1, taskIds: ["T001"] } };
  const runtime = createSessionLeaseRuntime({
    stableHash, loadRuntime: () => structuredClone(state),
    saveRuntime: (value) => { state = structuredClone(value); },
    activeChangeLeases: () => [], acquire: () => ({ leaseId: "l1" }), discard: () => {},
    release: () => { throw new Error("task 'T001' changed outside granted scope: src/other.js; result and proof were not accepted."); },
    runCheck: (id, check) => runTaskCheck({ loadRuntime: () => state }, id, check)
  });
  assert.throws(() => runtime.settle("demo"), (error) => {
    assert.equal(error.boundary, "task-scope");
    assert.match(error.message, /outside granted scope: src\/other\.js\. Revert/);
    return true;
  });
  assert.deepEqual(state.sessionHandoff.taskIds, ["T001"]);
});

test("the task check runs in the task repository and reports an unavailable workspace", () => {
  const seen = [];
  const spawn = (shell, args, options) => { seen.push([shell, args, options.cwd]); return { status: 3, stdout: "o", stderr: "e" }; };
  const loadRuntime = () => ({ workspace: { path: "/root-box" }, repositories: { api: { path: "/api-box" } } });
  assert.deepEqual(runTaskCheck({ loadRuntime, spawn }, "demo", { command: "make t", repository: "api" }),
    { status: "fail", exitCode: 3, output: "oe" });
  assert.deepEqual(seen, [["sh", ["-c", "make t"], "/api-box"]]);
  assert.equal(runTaskCheck({ loadRuntime, spawn }, "demo", { command: "x", repository: "web" }).status,
    "unavailable");
});

// Headless E2E: a two-task chain paid one advance round-trip per task. The
// session now takes the whole chain and one resume verifies and ticks both.
function chainWorkspace(t) {
  const root = mkdtempSync(join(tmpdir(), "session-chain-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "openspec", "changes", "demo"), { recursive: true });
  writeFileSync(join(root, "openspec", "changes", "demo", "tasks.md"),
    "- [ ] **T001** Add [paths:src/a.js] — verify: `test -f a.done`\n" +
    "- [ ] **T002** Use [paths:src/b.js] — verify: `test -f b.done`\n");
  return root;
}

function chainAdvance(root) {
  const ledger = join(root, "openspec", "changes", "demo", "tasks.md");
  let state = { status: "building", workspace: { path: root } };
  const loadRuntime = () => structuredClone(state);
  const saveRuntime = (value) => { state = structuredClone(value); };
  const session = createSessionLeaseRuntime({
    stableHash, loadRuntime, saveRuntime,
    activeChangeLeases: () => [], acquire: () => { throw new Error("no lease"); },
    discard: () => {}, release: () => {},
    runCheck: (id, check) => runTaskCheck({ loadRuntime }, id, check)
  });
  const pending = () => ["T002", "T001"].filter((id) =>
    !taskLineChecked(readFileSync(ledger, "utf8"), id));
  const runtime = createAdvanceRuntime({
    loadRuntime, saveRuntime,
    settleSessionLeases: session.settle, issueSessionLease: session.issue,
    agentDispatchValue: () => pending().length
      ? { action: "run-in-session", reason: "one repository" } : { action: "build-complete" },
    // T002 depends on T001, so each wave holds one task.
    agentPlanValue: () => ({
      groups: ["T001", "T002"].filter((id) => pending().includes(id)).map((id) => [id]),
      tasks: pending().map((id) => ({ id, text: readFileSync(ledger, "utf8")
        .split("\n").find((line) => line.includes(`**${id}**`)), repository: "root",
      paths: [`src/${id}.js`] }))
    }),
    runProof: async () => { state.status = "proven"; return { status: "PASS" }; },
    relevantHash: () => "workspace-a", deliveredAiAttempts: () => [],
    authorityStatusValue: () => ({ requests: [] }),
    readJson: () => ({}), proofAdvancePath: () => "/proof.json", stableHash
  });
  return { runtime, state: () => state };
}

test("a two-task session chain is handed in one EDIT and proven after one resume", async (t) => {
  const root = chainWorkspace(t);
  const { runtime, state } = chainAdvance(root);
  const first = await runtime.advanceThrough("demo", "proven");
  assert.equal(first.action, "EDIT");
  assert.deepEqual(first.tasks.map((task) => task.id), ["T001", "T002"]);
  assert.deepEqual(state().sessionHandoff.taskIds, ["T001", "T002"]);
  writeFileSync(join(root, "a.done"), "");
  writeFileSync(join(root, "b.done"), "");
  const second = await runtime.advanceThrough("demo", "proven");
  assert.equal(second.action, "DONE");
  assert.equal(second.reached, "proven");
  assert.match(readFileSync(join(root, "openspec", "changes", "demo", "tasks.md"), "utf8"),
    /^- \[x\] \*\*T001\*\*[^\n]*\n- \[x\] \*\*T002\*\*/);
});

test("a failed task in a session chain is handed back alone with its failure", async (t) => {
  const root = chainWorkspace(t);
  const { runtime, state } = chainAdvance(root);
  await runtime.advanceThrough("demo", "proven");
  writeFileSync(join(root, "a.done"), "");
  const second = await runtime.advanceThrough("demo", "proven");
  assert.equal(second.action, "EDIT");
  assert.deepEqual(second.tasks.map((task) => task.id), ["T002"]);
  assert.deepEqual(second.verificationFailures.map((row) => [row.taskId, row.command]),
    [["T002", "test -f b.done"]]);
  assert.deepEqual(state().sessionHandoff.taskIds, ["T002"]);
  writeFileSync(join(root, "b.done"), "");
  assert.equal((await runtime.advanceThrough("demo", "proven")).reached, "proven");
});

test("a dependent is not ticked when its dependency fails verify in the same batch", async (t) => {
  const root = chainWorkspace(t);
  const ledger = join(root, "openspec", "changes", "demo", "tasks.md");
  writeFileSync(ledger,
    "- [ ] **T001** Add [paths:src/a.js] — verify: `test -f a.done`\n" +
    "- [ ] **T002** Use [depends: T001] [paths:src/b.js] — verify: `test -f b.done`\n");
  const { runtime, state } = chainAdvance(root);
  await runtime.advanceThrough("demo", "proven");
  // T002's own check would pass; T001's fails.
  writeFileSync(join(root, "b.done"), "");
  const second = await runtime.advanceThrough("demo", "proven");
  assert.equal(second.action, "EDIT");
  assert.match(readFileSync(ledger, "utf8"), /^- \[ \] \*\*T001\*\*[^\n]*\n- \[ \] \*\*T002\*\*/);
  assert.deepEqual(second.tasks.map((task) => task.id), ["T001", "T002"]);
  assert.deepEqual(second.verificationFailures.map((row) => [row.taskId, row.blockedBy || null]),
    [["T001", null], ["T002", ["T001"]]]);
  assert.deepEqual(state().sessionHandoff.taskIds, ["T001", "T002"]);
  writeFileSync(join(root, "a.done"), "");
  assert.equal((await runtime.advanceThrough("demo", "proven")).reached, "proven");
});

// Wave-4 probe: a task whose verify already passed on unchanged code was
// marked complete with no edit. A behavior task with no diff in its declared
// paths is handed back instead; one that changed its paths is ticked.
test("a passing verify with no change in a behavior task's paths does not complete it", (t) => {
  const root = workspace(t);
  const ledger = join(root, "openspec", "changes", "demo", "tasks.md");
  writeFileSync(ledger,
    "- [ ] **T001** First — verify: `npm test -- a` [paths:src/a.js]\n" +
    "- [ ] **T002** Second — verify: `npm test -- b` [paths:src/b.js]\n");
  let state = { workspace: { path: root }, sessionHandoff: { version: 1, taskIds: ["T001", "T002"] } };
  const runtime = createSessionLeaseRuntime({
    stableHash, loadRuntime: () => state, saveRuntime: (next) => { state = next; },
    activeChangeLeases: () => [], acquire: () => ({ leaseId: "l" }), release: () => {},
    discard: () => {},
    runCheck: () => ({ status: "pass", exitCode: 0, output: "ok" }),
    taskChangeIssue: (_id, taskId) => taskId === "T001"
      ? "task T001 completed with no change: its verify passed, but nothing changed in its declared paths (src/a.js)"
      : null
  });
  assert.deepEqual(runtime.settle("demo"), ["T002"]);
  const content = readFileSync(ledger, "utf8");
  assert.equal(taskLineChecked(content, "T001"), false, "no change, no completion");
  assert.equal(taskLineChecked(content, "T002"), true);
  const handed = runtime.issue("demo", {
    action: "EDIT", tasks: [{ id: "T001" }], execution: { mode: "session", leases: [] }
  });
  assert.match(handed.verificationFailures[0].output, /completed with no change/);
  // A self-ticked task with no change is reopened the same way.
  writeFileSync(ledger, tickTaskLine(readFileSync(ledger, "utf8"), "T001"));
  state = { ...state, sessionHandoff: { version: 1, taskIds: ["T001"] } };
  assert.deepEqual(runtime.settle("demo"), []);
  assert.equal(taskLineChecked(readFileSync(ledger, "utf8"), "T001"), false);
});
