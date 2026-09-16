import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdvanceRuntime, advanceFailureAction } from "../runtime/workflow/advance-runtime.mjs";
import { targetHeadMovedDecision } from "../runtime/workflow/apply-recovery.mjs";
import { gateDigest } from "../runtime/core/convergent-gate.mjs";
import { actionableGuidance, currentDeliveryProof } from "../runtime/workflow/advance-recovery.mjs";
import { lifecycleOutcome } from "../runtime/core/lifecycle-outcome.mjs";

function fixture(overrides = {}) {
  let stored = { id: "demo", status: "building", contractRevision: 1 };
  let content = "original";
  let cursor = {};
  let proofCalls = 0;
  const options = {
    loadRuntime: () => structuredClone(stored),
    saveRuntime: (state) => { stored = structuredClone(state); },
    agentDispatchValue: () => ({ action: "build-complete" }),
    relevantHash: () => content,
    stableHash: gateDigest,
    deliveredAiAttempts: () => [], authorityStatusValue: () => ({ requests: [] }),
    readJson: () => cursor, proofAdvancePath: () => "unused",
    output: () => {},
    runProof: async () => { proofCalls++; return { status: "ACTION_REQUIRED", next: [{ reason: "test failed" }] }; },
    ...overrides
  };
  return {
    runtime: () => createAdvanceRuntime(options),
    options,
    setContent: (value) => { content = value; },
    setCursor: (value) => { cursor = value; },
    setState: (value) => { stored = { ...stored, ...value }; },
    state: () => structuredClone(stored),
    calls: () => proofCalls
  };
}

function answer(value, decision = "retry", reference = "user:answer-1") {
  return { decision, "decision-fingerprint": value.decision.fingerprint,
    "decision-ref": reference, reason: "Use the alternate configured environment" };
}

test("fresh recovery lets Build repair missing repository bindings before hashing", async () => {
  let prepared = false;
  const f = fixture({
    prepareBuild: () => { prepared = true; },
    relevantHash: () => {
      assert.equal(prepared, true, "partial repository topology cannot be hashed before preparation");
      return "original";
    }
  });
  const value = await f.runtime().advanceThrough("demo", "proven");
  assert.equal(prepared, true);
  assert.equal(value.legacyAction, "REPAIR_PROOF_RESULT");
});

test("typed automatic sync stays harness-owned and arbitrary commands never become automatic", () => {
  const decision = targetHeadMovedDecision({ changeId: "demo", recordedBase: "a", currentHead: "b" });
  const value = advanceFailureAction("demo", { message: decision.summary, decision }, { stage: "land", through: "archived" });
  assert.equal(value.action, "REPAIR");
  assert.equal(value.owner, "harness");
  assert.equal(value.recovery.type, "AUTO_RECOVER");
  assert.equal(value.command, "claude-foundation sandbox sync demo");
  const unknown = advanceFailureAction("demo", { decision: {
    kind: "unknown", automaticRecovery: "run-arbitrary-shell", summary: "do something"
  } });
  assert.equal(unknown.action, "ASK_USER");
  assert.equal(unknown.command, undefined);
});

test("Land sync executes then reaches archived without asking again", async () => {
  let moved = true;
  let syncs = 0;
  const f = fixture({
    hasLandGrant: () => true,
    recoverSandbox: async () => { syncs++; moved = false; f.setContent("synced"); f.setCursor({ status: "PASS", workspaceHash: "synced" }); },
    runLand: async () => {
      if (moved) throw Object.assign(new Error("target moved"), {
        decision: targetHeadMovedDecision({ changeId: "demo", recordedBase: "a", currentHead: "b" })
      });
      f.setState({ status: "archived" });
      return { archived: true };
    }
  });
  f.setState({ status: "proven" });
  f.setCursor({ status: "PASS", workspaceHash: "original" });
  const value = await f.runtime().advanceThrough("demo", "archived");
  assert.equal(value.userState, "DELIVERED");
  assert.equal(syncs, 1);
});

test("restarted advance restores an interrupted amendment before checking approval", async () => {
  for (const status of ["building", "proven"]) {
    let restored = false;
    let approvals = 0;
    const approval = { required: true, revision: 1, identity: "approved-amended-packet" };
    const f = fixture({
      recoverWorkspace: () => {
        restored = true;
        f.setState({ workspace: { path: "/restored-sandbox" } });
      },
      assertApproval: (_id, state) => {
        approvals++;
        if (!restored) throw new Error("approval packet is still in staging");
        assert.deepEqual(state.specApproval, approval);
      },
      hasLandGrant: () => true,
      runLand: () => { f.setState({ status: "archived" }); return { archived: true }; }
    });
    f.setState({ status, specApproval: approval,
      workspace: { path: "/missing-sandbox", amendmentReplay: { packetHash: "retained" } } });
    f.setCursor({ status: "PASS", workspaceHash: "original" });
    f.runtime().advanceValue("demo", { inspect: true });
    assert.equal(restored, false, "inspection cannot restore or mutate the workspace");
    const value = await f.runtime().advanceThrough("demo", status === "building" ? "build" : "archived");
    assert.equal(restored, true);
    assert.ok(approvals > 0);
    assert.equal(value.action, "DONE");
    assert.deepEqual(f.state().specApproval, approval);
  }
});

test("sync conflicts are preserved and request a decision before another attempt", async () => {
  let syncs = 0;
  const f = fixture({ hasLandGrant: () => true,
    recoverSandbox: async () => { syncs++; return { status: "CONFLICT", conflicts: ["app.js"] }; },
    runLand: async () => ({ status: "BLOCKED", decision: targetHeadMovedDecision({ changeId: "demo" }) })
  });
  f.setState({ status: "proven" }); f.setCursor({ status: "PASS", workspaceHash: "original" });
  const value = await f.runtime().advanceThrough("demo", "archived");
  assert.equal(value.action, "ASK_USER");
  assert.equal(value.details.status, "CONFLICT");
  await f.runtime().advanceThrough("demo", "archived");
  assert.equal(syncs, 1);
  assert.equal(f.state().status, "proven");
});

test("repair handoffs persist across process-shaped runtime recreation and require a decision", async () => {
  const f = fixture();
  assert.equal((await f.runtime().advanceThrough("demo", "archived")).action, "REPAIR");
  assert.equal((await f.runtime().advanceThrough("demo", "archived")).action, "REPAIR");
  const stopped = await f.runtime().advanceThrough("demo", "archived");
  assert.equal(stopped.action, "ASK_USER");
  assert.equal(stopped.decision.attemptedStrategies[0].observations, 3);
  const calls = f.calls();
  const repeated = await f.runtime().advanceThrough("demo", "archived");
  assert.equal(repeated.decision.fingerprint, stopped.decision.fingerprint);
  assert.equal(f.calls(), calls, "pending decision does not repeat failed work");
  const state = f.state();
  assert.equal(f.runtime().advanceValue("demo", { inspect: true }).action, "ASK_USER");
  assert.deepEqual(f.state(), state, "inspection must not count as an attempt");
  const resumed = await f.runtime().showAdvance("demo", answer(stopped));
  assert.equal(resumed.action, "REPAIR");
  assert.equal(resumed.resume, "claude-foundation advance demo --through archived");
  assert.equal(f.state().advanceRecovery.answers.length, 1);
});

test("changed content expires a pending recovery decision and stale answers cannot authorize work", async () => {
  const f = fixture();
  let value;
  for (let index = 0; index < 3; index++) value = await f.runtime().advanceThrough("demo", "proven");
  f.setContent("actual repair");
  await assert.rejects(f.runtime().showAdvance("demo", answer(value)), /stale/);
  assert.equal((await f.runtime().advanceThrough("demo", "proven")).action, "REPAIR");
});

test("changing diagnostic text alone cannot reset the no-progress boundary", async () => {
  let attempt = 0;
  const f = fixture({ prepareBuild: async () => {
    throw new Error(`tool unavailable on connection attempt ${++attempt}`);
  } });
  let value;
  for (let index = 0; index < 3; index++) value = await f.runtime().advanceThrough("demo", "archived");
  assert.equal(value.action, "ASK_USER");
  assert.match(value.decision.summary, /connection attempt 3/);
  assert.equal(value.decision.attemptedStrategies[0].observations, 3);
});

test("repeated setup exceptions survive restart and pause prevents setup writes", async () => {
  let preparations = 0;
  const f = fixture({ prepareBuild: async () => { preparations++; throw new Error("tool unavailable"); } });
  let value;
  for (let index = 0; index < 3; index++) value = await f.runtime().advanceThrough("demo", "archived");
  assert.equal(value.action, "ASK_USER");
  assert.match(value.decision.summary, /tool unavailable/);
  const paused = await f.runtime().showAdvance("demo", answer(value, "pause"));
  assert.equal(paused.userState, "PAUSED");
  assert.equal(paused.user.decision, undefined, "a recorded pause does not ask the same question again");
  assert.equal((await f.runtime().advanceThrough("demo", "archived")).userState, "PAUSED");
  assert.equal(preparations, 3);
});

test("recovery snapshots after a setup exception stay inside the runtime failure trap", async () => {
  let trapped = false;
  const f = fixture({
    prepareBuild: () => { throw new Error("setup unavailable"); },
    capture: (operation) => {
      trapped = true;
      try { return operation(); } finally { trapped = false; }
    },
    relevantHash: () => {
      assert.equal(trapped, true, "runtime fail must throw rather than exit while retaining recovery");
      return "original";
    }
  });
  const value = await f.runtime().advanceThrough("demo", "archived");
  assert.equal(value.action, "REPAIR");
  assert.equal(f.state().advanceRecovery.attempts.length, 1);
});

test("external waiting is an explicit durable choice, and completion resumes automatically", async () => {
  let available = false;
  const f = fixture({ runProof: async () => {
    if (!available) return { status: "WAITING_EXTERNAL", requests: [{ requestId: "r1", owner: "CI team" }],
      next: [{ reason: "CI team must publish the signed result" }] };
    f.setState({ status: "proven" });
    return { status: "PASS" };
  } });
  const value = await f.runtime().advanceThrough("demo", "proven");
  assert.equal(value.action, "ASK_USER");
  assert.equal(value.decision.wait.owner, "CI team");
  const waiting = await f.runtime().showAdvance("demo", answer(value, "wait"));
  assert.equal(waiting.action, "WAIT");
  assert.equal(waiting.user.owner, "CI team");
  assert.match(waiting.wait.checkCommand, /advance demo/);
  assert.equal((await f.runtime().advanceThrough("demo", "proven")).action, "WAIT");
  available = true;
  assert.equal((await f.runtime().advanceThrough("demo", "proven")).reached, "proven");
});

test("repair counters and fresh proof IDs alone do not manufacture progress", async () => {
  let calls = 0;
  const f = fixture({ runProof: async () => {
    calls++;
    f.setCursor({ proofRunId: `run-${calls}`, repairCycle: calls });
    return { progressed: false };
  } });
  const value = await f.runtime().advanceThrough("demo", "proven");
  assert.equal(calls, 2);
  assert.equal(value.action, "ASK_USER");
  assert.ok(value.decision.fingerprint);
});

test("malformed legacy decisions retain honest choices and advance v6 rejects empty guidance", () => {
  const value = advanceFailureAction("demo", { decision: { kind: "needs-help", summary: "Needs a decision", options: [] } });
  assert.deepEqual(value.decision.options.map((row) => row.id), ["investigate", "pause"]);
  assert.equal(value.decision.recommended, "investigate");
  assert.throws(() => lifecycleOutcome({ protocol: 6, action: "ASK_USER", actor: "user", decision: { kind: "empty" } }), /actionable/);
  assert.throws(() => lifecycleOutcome({ protocol: 6, action: "WAIT", actor: "external-authority" }), /named owner/);
  const normalized = actionableGuidance({ action: "ASK_USER", decision: {
    kind: "human-acceptance", options: [{ id: "pass", outcome: "Accept" }, { id: "reject", outcome: "Reject" }]
  } });
  assert.equal(normalized.decision.recommended, "pause", "missing recommendation never defaults to a passing verdict");
});

test("a dead proof worker cannot leave delivery looking active indefinitely", async () => {
  const f = fixture({ runProof: async () => ({ status: "IN_PROGRESS", owner: { pid: -1 } }) });
  let value;
  for (let index = 0; index < 3; index++) value = await f.runtime().advanceThrough("demo", "proven");
  assert.equal(value.action, "ASK_USER");
  assert.match(value.decision.summary, /no longer live/);
});

test("a genuinely live proof worker stays a verified wait without consuming repair attempts", async () => {
  const f = fixture({ runProof: async () => ({ status: "IN_PROGRESS", owner: { pid: process.pid } }) });
  for (let index = 0; index < 4; index++) {
    const value = await f.runtime().advanceThrough("demo", "proven");
    assert.equal(value.action, "WORKING");
    assert.ok(value.wait.checkCommand);
  }
  assert.equal(f.state().advanceRecovery, undefined);
});

test("an authorized live configured reviewer does not ask permission to keep waiting", async () => {
  const f = fixture({ authorityStatusValue: () => ({ requests: [{
    type: "review", requestId: "r1", status: "dispatched",
    configuredController: { pid: process.pid, reviewer: "configured independent reviewer" }
  }] }) });
  for (let index = 0; index < 4; index++) {
    const value = await f.runtime().advanceThrough("demo", "proven");
    assert.equal(value.action, "WAIT");
    assert.equal(value.owner, "harness");
    assert.equal(value.wait.owner, "configured independent reviewer");
    assert.match(value.wait.condition, /r1/);
  }
  assert.equal(f.calls(), 0);
});

test("stopped configured reviewers return the bounded run route with retained subject provenance", async () => {
  for (const checkpointed of [false, true]) {
    const subject = { subjectActor: "implementation-agent", subjectSession: "original-session",
      subjectProvider: "openai", subjectFamily: "gpt", subjectModel: "model" };
    const request = { type: "review", requestId: "r1", status: "dispatched",
      ...(checkpointed ? { configuredResult: { subject } } : {
        configuredController: { pid: 2147483647, reviewer: "configured", subject }
      }) };
    const f = fixture({ authorityStatusValue: () => ({ requests: [request] }) });
    for (let index = 0; index < 4; index++) {
      const value = await f.runtime().advanceThrough("demo", "proven");
      assert.equal(value.action, "RUN_EXTERNAL");
      assert.equal(value.legacyAction, "RUN_CONFIGURED_REVIEW");
      assert.equal(value.requestId, "r1");
      assert.match(value.command, /^claude-foundation authority run demo --request r1 /);
      assert.match(value.command, /--subject-session original-session/);
      assert.match(value.command, /--subject-model model/);
    }
    assert.equal(f.state().advanceRecovery, undefined);
    assert.equal(f.calls(), 0, "the host must complete the returned authority route before proof resumes");
  }
});

test("accepted external waiting expires when its owner, condition or checking route changes", async () => {
  for (const field of ["owner", "condition", "checkCommand"]) {
    let wait = { owner: "CI team", condition: "Publish signed result", checkCommand: "check-ci" };
    const f = fixture({ runProof: async () => ({ status: "WAITING_EXTERNAL", wait }) });
    const question = await f.runtime().advanceThrough("demo", "proven");
    assert.equal((await f.runtime().showAdvance("demo", answer(question, "wait"))).action, "WAIT");
    wait = { ...wait, [field]: `changed ${field}` };
    const changed = await f.runtime().advanceThrough("demo", "proven");
    assert.equal(changed.action, "ASK_USER");
    assert.notEqual(changed.decision.fingerprint, question.decision.fingerprint);
    assert.equal(changed.decision.wait[field], wait[field]);
    assert.equal((await f.runtime().showAdvance("demo", answer(changed, "wait", "user:updated-wait"))).action, "WAIT");
  }
});

test("partial Land checkpoints converge, but a stuck checkpoint asks before repeating forever", async () => {
  for (const progresses of [true, false]) {
    let runs = 0;
    const f = fixture({ hasLandGrant: () => true, runLand: async () => {
      runs++;
      if (progresses) {
        f.setState({ land: { status: `checkpoint-${runs}` }, ...(runs === 3 ? { status: "archived" } : {}) });
      }
      return { status: "PENDING", reason: "finish the current transaction" };
    } });
    f.setState({ status: "proven" }); f.setCursor({ status: "PASS", workspaceHash: "original" });
    const value = await f.runtime().advanceThrough("demo", "archived");
    assert.equal(value.action, progresses ? "DONE" : "ASK_USER");
    assert.equal(runs, progresses ? 3 : 2);
  }
});

test("retry does not grant Land, waive evidence or extend model/review budgets", async () => {
  const f = fixture();
  let value;
  for (let index = 0; index < 3; index++) value = await f.runtime().advanceThrough("demo", "proven");
  await assert.rejects(f.runtime().showAdvance("demo", answer(value, "land")), /not offered/);
  await assert.rejects(f.runtime().showAdvance("demo", { ...answer(value), "decision-ref": "" }), /explicit user/);
  await f.runtime().showAdvance("demo", answer(value));
  for (const key of ["landGrant", "waivers", "reviewWindow", "budgetContinuation"])
    assert.equal(f.state()[key], undefined);
  assert.equal(f.state().status, "building");
});

test("separate CLI host processes retain decisions, protect inspection, and resume old runtime records", () => {
  const directory = mkdtempSync(join(tmpdir(), "advance-recovery-process-"));
  const statePath = join(directory, "runtime.json");
  const scriptPath = join(directory, "host.mjs");
  const moduleUrl = new URL("../runtime/workflow/advance-runtime.mjs", import.meta.url).href;
  const digestUrl = new URL("../runtime/core/convergent-gate.mjs", import.meta.url).href;
  try {
    writeFileSync(statePath, JSON.stringify({ version: 2, id: "demo", status: "building", contractRevision: 1 }));
    writeFileSync(scriptPath, `
      import { readFileSync, writeFileSync } from "node:fs";
      import { createAdvanceRuntime } from ${JSON.stringify(moduleUrl)};
      import { gateDigest } from ${JSON.stringify(digestUrl)};
      const path = ${JSON.stringify(statePath)};
      const runtime = createAdvanceRuntime({
        loadRuntime: () => JSON.parse(readFileSync(path, "utf8")),
        saveRuntime: value => writeFileSync(path, JSON.stringify(value)),
        agentDispatchValue: () => ({ action: "build-complete" }),
        relevantHash: () => "unchanged", stableHash: gateDigest,
        deliveredAiAttempts: () => [], authorityStatusValue: () => ({ requests: [] }),
        readJson: () => ({}), proofAdvancePath: () => "unused",
        prepareBuild: async () => { throw new Error("fixture tool is unavailable"); }
      });
      await runtime.showAdvance("demo", JSON.parse(process.argv[2]));
    `);
    const run = (flags) => JSON.parse(execFileSync(process.execPath, [scriptPath, JSON.stringify(flags)], {
      encoding: "utf8", timeout: 10_000
    }));
    for (let index = 0; index < 2; index++)
      assert.equal(run({ through: "archived" }).action, "REPAIR");
    const stopped = run({ through: "archived" });
    assert.equal(stopped.action, "ASK_USER");
    const before = readFileSync(statePath, "utf8");
    assert.equal(run({ inspect: true }).decision.fingerprint, stopped.decision.fingerprint);
    assert.equal(readFileSync(statePath, "utf8"), before);
    assert.equal(run(answer(stopped, "pause")).userState, "PAUSED");
    assert.match(run({ through: "archived" }).reason, /paused/);
    const resumed = run(answer(stopped, "retry", "user:retry-after-pause"));
    assert.equal(resumed.action, "REPAIR");
    assert.equal(resumed.resume, "claude-foundation advance demo --through archived");
    const saved = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(saved.advanceRecovery.answers.length, 2);
    assert.equal(saved.version, 2, "legacy runtime schema is accepted without a migration");
    assert.equal(saved.status, "building");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a proven lifecycle label cannot bypass stale evidence at either requested target", async () => {
  for (const target of ["proven", "archived"]) {
    let current = false;
    let proofs = 0;
    let lands = 0;
    const f = fixture({ proofIsCurrent: () => current, hasLandGrant: () => true,
      runProof: async () => { proofs++; current = true; return { status: "PASS" }; },
      runLand: async () => { assert.equal(current, true); lands++; f.setState({ status: "archived" }); }
    });
    f.setState({ status: "proven" }); f.setCursor({ status: "PASS", workspaceHash: "original" });
    const value = await f.runtime().advanceThrough("demo", target);
    assert.equal(value.reached, target);
    assert.equal(proofs, 1);
    assert.equal(lands, target === "archived" ? 1 : 0);
  }
});

test("current proof requires durable audit, matching content, current receipts and the proven manifest", () => {
  const context = {
    proofAudit: () => ({ valid: true, proof: { workspaceHash: "current", receipts: [{ provider: "test", sha256: "digest" }] } }),
    relevantHash: () => "current", requiredProviders: () => ["test"],
    receiptValidity: () => ({ validity: "valid" }), receiptPath: () => "receipt", fileDigest: () => "digest"
  };
  assert.equal(currentDeliveryProof(context, "demo"), true);
  for (const patch of [
    { proofAudit: () => ({ valid: false }) }, { relevantHash: () => "changed" },
    { requiredProviders: () => ["new-provider"] }, { fileDigest: () => "changed" },
    ...["missing", "stale", "fail", "error", "inconclusive"].map((validity) => ({ receiptValidity: () => ({ validity }) }))
  ]) assert.equal(currentDeliveryProof({ ...context, ...patch }, "demo"), false);
});

test("successful archive never re-hashes a sandbox that Land has already cleaned up", async () => {
  let cleaned = false;
  const f = fixture({
    relevantHash: () => { if (cleaned) throw new Error("sandbox no longer exists"); return "original"; },
    hasLandGrant: () => true,
    runLand: async () => { f.setState({ status: "archived" }); cleaned = true; return { archived: true }; }
  });
  f.setState({ status: "proven" }); f.setCursor({ status: "PASS", workspaceHash: "original" });
  assert.equal((await f.runtime().advanceThrough("demo", "archived")).userState, "DELIVERED");
  assert.equal((await f.runtime().advanceThrough("demo", "archived")).userState, "DELIVERED",
    "re-entering an archived change also avoids the retired workspace");
});
