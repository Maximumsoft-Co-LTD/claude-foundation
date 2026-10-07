import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdvanceRuntime, advanceFailureAction, withSignals } from "../runtime/workflow/advance-runtime.mjs";
import { drainSignals, emitSignal, recordSignal } from "../runtime/core/signals.mjs";
import { manualRecoveryDecision, targetHeadMovedDecision } from "../runtime/workflow/apply-recovery.mjs";
import { gateDigest } from "../runtime/core/convergent-gate.mjs";
import {
  actionableGuidance, agentSafeRoutes, automaticRecoveryAction, createAdvanceRecovery,
  currentDeliveryProof, environmentCause, userEnvironmentCause
} from "../runtime/workflow/advance-recovery.mjs";
import { userDecisionError } from "../runtime/core/user-decisions.mjs";
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
  assert.equal(value.command, "claude-foundation advance demo --through archived",
    "the agent is never handed the sandbox sync primitive; advance performs the sync");
  assert.equal(value.automaticRecovery.kind, "sandbox-sync");
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

// A sync conflict is the agent's to resolve first; only repeated conflict
// without progress reaches the user.
test("sync conflicts go to the agent first and reach the user only after repeated attempts", async () => {
  let syncs = 0;
  const f = fixture({ hasLandGrant: () => true,
    recoverSandbox: async () => { syncs++; return { status: "CONFLICT", conflicts: ["app.js"] }; },
    runLand: async () => ({ status: "BLOCKED", decision: targetHeadMovedDecision({ changeId: "demo" }) })
  });
  f.setState({ status: "proven" }); f.setCursor({ status: "PASS", workspaceHash: "original" });
  const value = await f.runtime().advanceThrough("demo", "archived");
  assert.equal(value.action, "REPAIR");
  assert.equal(value.owner, "agent");
  assert.equal(value.legacyAction, "REPAIR_SYNC_CONFLICT");
  assert.equal(value.details.status, "CONFLICT");
  let last = value;
  for (let index = 0; index < 4 && last.action !== "ASK_USER"; index++)
    last = await f.runtime().advanceThrough("demo", "archived");
  assert.equal(last.action, "ASK_USER");
  assert.equal(f.state().status, "proven");
});

test("repair handoffs persist across process-shaped runtime recreation and require a decision", async () => {
  const f = fixture();
  assert.equal((await f.runtime().advanceThrough("demo", "archived")).action, "REPAIR");
  const alternate = await f.runtime().advanceThrough("demo", "archived");
  assert.equal(alternate.action, "REPAIR", "the agent tries one different approach before any question");
  assert.equal(alternate.legacyAction, "TRY_ALTERNATE_APPROACH");
  assert.equal(alternate.owner, "agent");
  const stopped = await f.runtime().advanceThrough("demo", "archived");
  assert.equal(stopped.action, "ASK_USER", "the third unchanged round asks the user");
  assert.equal(stopped.decision.attemptedStrategies[0].observations, 3);
  assert.equal(stopped.decision.repetition.rounds, 3);
  assert.match(stopped.decision.repetition.output, /test failed/);
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
  for (let index = 0; index < 4; index++) value = await f.runtime().advanceThrough("demo", "proven");
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

test("external waiting is the default without a question, and completion resumes automatically", async () => {
  let available = false;
  const f = fixture({ runProof: async () => {
    if (!available) return { status: "WAITING_EXTERNAL", requests: [{ requestId: "r1", owner: "CI team" }],
      next: [{ reason: "CI team must publish the signed result" }] };
    f.setState({ status: "proven" });
    return { status: "PASS" };
  } });
  for (let index = 0; index < 4; index++) {
    const waiting = await f.runtime().advanceThrough("demo", "proven");
    assert.equal(waiting.action, "WAIT", "a named external owner is waited on, never turned into a question");
    assert.equal(waiting.wait.owner, "CI team");
    assert.match(waiting.wait.checkCommand, /advance demo/);
  }
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
  assert.equal(value.action, "REPAIR", "the agent gets the stuck step before the user is asked");
  assert.equal(value.owner, "agent");
  assert.equal(value.recovery.type, "HANDOFF");
  let last = value;
  for (let index = 0; index < 4 && last.action !== "ASK_USER"; index++)
    last = await f.runtime().advanceThrough("demo", "proven");
  assert.equal(last.action, "ASK_USER");
  assert.ok(last.decision.fingerprint);
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
  for (let index = 0; index < 4; index++) value = await f.runtime().advanceThrough("demo", "proven");
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

test("external waiting follows its current owner, condition and checking route", async () => {
  for (const field of ["owner", "condition", "checkCommand"]) {
    let wait = { owner: "CI team", condition: "Publish signed result", checkCommand: "check-ci" };
    const f = fixture({ runProof: async () => ({ status: "WAITING_EXTERNAL", wait }) });
    assert.equal((await f.runtime().advanceThrough("demo", "proven")).action, "WAIT");
    wait = { ...wait, [field]: `changed ${field}` };
    const changed = await f.runtime().advanceThrough("demo", "proven");
    assert.equal(changed.action, "WAIT");
    assert.equal(changed.wait[field], wait[field]);
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
    assert.equal(value.action, progresses ? "DONE" : "REPAIR");
    assert.equal(runs, progresses ? 3 : 2);
    if (progresses) continue;
    assert.equal(value.owner, "agent");
    let last = value;
    for (let index = 0; index < 4 && last.action !== "ASK_USER"; index++)
      last = await f.runtime().advanceThrough("demo", "archived");
    assert.equal(last.action, "ASK_USER", "a stuck checkpoint still asks before repeating forever");
  }
});

test("retry does not grant Land, waive evidence or extend model/review budgets", async () => {
  const f = fixture();
  let value;
  for (let index = 0; index < 4; index++) value = await f.runtime().advanceThrough("demo", "proven");
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

test("proof target refreshes stale evidence while explicit Land accepts its assurance", async () => {
  let current = false;
  let proofs = 0;
  const prove = fixture({ proofIsCurrent: () => current,
    runProof: async () => { proofs++; current = true; return { status: "PASS" }; }
  });
  prove.setState({ status: "proven" });
  prove.setCursor({ status: "PASS", workspaceHash: "original" });
  assert.equal((await prove.runtime().advanceThrough("demo", "proven")).reached, "proven");
  assert.equal(proofs, 1);

  let lands = 0;
  const land = fixture({ proofIsCurrent: () => false, hasLandGrant: () => true,
    runProof: async () => { throw new Error("explicit Land must not rerun proof"); },
    runLand: async () => { lands++; land.setState({ status: "archived" }); }
  });
  land.setState({ status: "proven" });
  land.setCursor({ status: "PASS", workspaceHash: "original" });
  assert.equal((await land.runtime().advanceThrough("demo", "archived")).reached, "archived");
  assert.equal(lands, 1);
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

// S2: every non-terminal advance outcome carries its own recovery. A REPAIR
// without a command or instruction is rejected at the lifecycle boundary.
function assertActionable(value, label) {
  const hasText = (item) => typeof item === "string" && item.trim().length > 0;
  if (value.action === "DONE") return;
  if (value.action === "REPAIR")
    assert.ok(hasText(value.command) || hasText(value.instruction), `${label}: REPAIR lacks command/instruction`);
  else if (value.action === "ASK_USER")
    assert.ok(value.decision?.options?.length >= 2, `${label}: ASK_USER lacks options`);
  else if (value.action === "WAIT")
    assert.ok(hasText(value.wait?.checkCommand), `${label}: WAIT lacks checkCommand`);
  else assert.ok(hasText(value.command) || hasText(value.instruction) ||
    (value.tasks?.length && hasText(value.resume)), `${label}: ${value.action} lacks a route`);
  assert.doesNotMatch(`${value.instruction || ""} ${value.reason || ""}`,
    /read (?:the )?(?:harness )?source|\.mjs\b/, `${label}: points the agent at harness source`);
}

test("REPAIR outcomes require an actionable command or instruction", () => {
  assert.throws(() => lifecycleOutcome({ action: "REPAIR", actor: "agent" }), /actionable 'command' or 'instruction'/);
  assert.throws(() => lifecycleOutcome({ action: "REPAIR", actor: "agent", command: " " }), /actionable/);
  assert.equal(lifecycleOutcome({ action: "REPAIR", actor: "agent", instruction: "Fix x" }).action, "REPAIR");
  const filled = actionableGuidance({ action: "REPAIR", legacyAction: "REPAIR_PROOF_RESULT", reason: "test failed",
    next: [{ command: "claude-foundation proof readiness demo" }] });
  assert.match(filled.instruction, /test failed/);
  assert.match(filled.instruction, /proof readiness demo/);
});

test("every coordinator legacyAction and readiness status yields an actionable recovery", async () => {
  const { coordinatorAction } = await import("../runtime/workflow/advance-runtime.mjs");
  const base = { id: "demo", state: { status: "building" }, dispatch: { action: "build-complete" },
    workspaceHash: "w1", proofCursor: {}, authorityRequests: [], stableHash: gateDigest };
  const plan = { tasks: [{ id: "T001", text: "do — verify: `npm test`", repository: "root", paths: ["src/a.js"] }] };
  const failedReview = { digest: "a1", workspaceHash: "w1", resultStatus: "fail",
    findings: [{ id: "F1", severity: "major", path: "src/a.mjs" }] };
  const scenarios = {
    archived: { state: { status: "archived" } },
    buildPlanMissing: { dispatch: { action: "run-in-session" } },
    buildTask: { dispatch: { action: "run-in-session", task: { taskId: "T001" } }, plan },
    buildWait: { dispatch: { action: "wait", reason: "lease held" } },
    buildBlocked: { dispatch: { action: "blocked", reason: "graph cycle" } },
    buildBlockedCommand: { dispatch: { action: "blocked", reason: "x", nextCommand: "claude-foundation change validate demo" } },
    staleProof: { state: { status: "proven" }, proofIsCurrent: false },
    landReady: { state: { status: "proven" }, proofCursor: { status: "PASS", workspaceHash: "w1" } },
    reviewExhausted: { authorityRequests: [{ requestId: "r1", type: "review", status: "infrastructure-exhausted" }] },
    reviewReady: { authorityRequests: [{ requestId: "r1", type: "review", status: "requested" }],
      authorityActions: [{ requestId: "r1", command: "claude-foundation authority run demo --request r1" }] },
    externalPending: { authorityRequests: [{ requestId: "r1", type: "acceptance", status: "pending" }] },
    repairBatch: { latestReview: failedReview },
    invalidated: { latestReview: failedReview, workspaceHash: "w2" },
    proofDecision: { proofCursor: { status: "NEEDS_USER_DECISION", decision: { kind: "work-decision", summary: "pick" } } },
    runProof: {}
  };
  for (const status of ["NEEDS_CODE_CHANGE", "CONFIGURATION_ERROR", "BLOCKED_BY_ACTIVE_WORK",
    "INFRASTRUCTURE_ERROR", "NEEDS_USER_DECISION", "UNKNOWN_STATUS"]) {
    scenarios[`readiness:${status}`] = { proofPreflight: { status, issues: [`${status} issue`], next: [] } };
    scenarios[`readiness:${status}:next`] = { proofPreflight: { status, issues: ["x"],
      next: [{ reason: "wire provider", command: "claude-foundation evidence init demo --write" }] } };
  }
  scenarios["readiness:READY"] = { proofPreflight: { status: "READY", issues: [], next: [] } };
  const seen = new Set();
  for (const [label, overrides] of Object.entries(scenarios)) {
    const value = coordinatorAction({ ...base, ...overrides });
    seen.add(value.legacyAction);
    assertActionable(value, label);
  }
  for (const legacyAction of ["ARCHIVED", "REPAIR_BUILD_PLAN", "EXECUTE_TASK", "WAIT_RESOURCE",
    "RUN_INVALIDATED_EVIDENCE", "LAND_READY", "REPAIR_REVIEW_INFRASTRUCTURE", "RUN_CONFIGURED_REVIEW",
    "WAIT_EXTERNAL", "EXECUTE_REPAIR_BATCH", "REQUEST_DECISION", "RUN_PROOF", "REPAIR_PROOF_CONTRACT",
    "REPAIR_PROVIDER_ENVIRONMENT", "REPAIR_PROOF_PREFLIGHT"])
    assert.ok(seen.has(legacyAction), `scenario matrix no longer reaches ${legacyAction}`);

  for (const stage of ["build", "prove", "land"]) {
    for (const error of [new Error("root sandbox unavailable"),
      Object.assign(new Error("agent-owned failure"), { owner: "agent" }),
      new Error("semantic draft validation failed:\n  - semantic draft capabilityOverviews must be an array of { capability, title, overview } or an object keyed by capability")])
      assertActionable(advanceFailureAction("demo", error, { stage }), `failure:${stage}:${error.message}`);
  }
});

test("runtime failures without an exact command name the field and expected shape", () => {
  const shape = advanceFailureAction("demo", new Error(
    "semantic draft validation failed:\n  - semantic draft capabilityOverviews must be an array of { capability, title, overview } or an object keyed by capability"));
  assert.equal(shape.repairTarget.field, "capabilityOverviews");
  assert.match(shape.repairTarget.expected, /^an array of/);
  assert.match(shape.instruction, /Set 'capabilityOverviews' to an array/);
  const typed = advanceFailureAction("demo", Object.assign(new Error("bad"),
    { details: { field: "evidence.test.minimum", value: 0, expected: "an integer >= 1" } }));
  assert.deepEqual(typed.repairTarget, { field: "evidence.test.minimum", value: 0, expected: "an integer >= 1" });
  const exact = advanceFailureAction("demo", new Error("fix with 'claude-foundation sandbox create demo --all'"));
  assert.equal(exact.command, "claude-foundation advance demo",
    "an exact primitive named by an error is routed through advance");
  assert.equal(exact.instruction, undefined);
  const unknown = advanceFailureAction("demo", new Error("root sandbox unavailable"));
  assert.equal(unknown.repairTarget, null);
  assert.match(unknown.instruction, /root sandbox unavailable/);
});

test("proof repair and alternate-approach outcomes carry instructions", async () => {
  const f = fixture();
  const first = await f.runtime().advanceThrough("demo", "proven");
  assert.equal(first.legacyAction, "REPAIR_PROOF_RESULT");
  assertActionable(first, "REPAIR_PROOF_RESULT");
  const alternate = await f.runtime().advanceThrough("demo", "proven");
  assert.equal(alternate.legacyAction, "TRY_ALTERNATE_APPROACH");
  assert.match(alternate.instruction, /materially different/);
  assertActionable(alternate, "TRY_ALTERNATE_APPROACH");
});

// An interrupted apply never stops for the user: the harness settles what Land
// wrote, keeps divergent target content, and hands the paths to the agent.
function pendingApplyDecision(kind, resolution, divergentPaths = []) {
  return kind === "manual-recovery"
    ? manualRecoveryDecision("/transactions/tx", { changeId: "demo", divergentPaths })
    : { kind, summary: "An earlier apply is unresolved.", divergentPaths,
      options: [{ id: resolution, outcome: "recover" }, { id: "pause", outcome: "pause" }],
      recommended: resolution, automaticRecovery: resolution };
}

test("interrupted apply resolutions are typed automatic routes; restore-backup never is", () => {
  const settle = automaticRecoveryAction("demo", pendingApplyDecision("apply-pending-recovery", "settle"));
  assert.deepEqual([settle.kind, settle.resolution, settle.command],
    ["apply-recovery", "settle", "claude-foundation advance demo --through archived"]);
  const keep = automaticRecoveryAction("demo",
    pendingApplyDecision("manual-recovery", "keep-current", ["src/a.js"]));
  assert.equal(keep.resolution, "keep-current");
  assert.deepEqual(keep.divergentPaths, ["src/a.js"]);
  assert.equal(automaticRecoveryAction("demo",
    pendingApplyDecision("apply-pending-recovery", "restore-backup")), null);
  const value = advanceFailureAction("demo", { message: "pending",
    decision: pendingApplyDecision("apply-pending-recovery", "settle") },
  { stage: "land", through: "archived" });
  assert.equal(value.action, "REPAIR");
  assert.equal(value.legacyAction, "RECOVER_APPLY_TRANSACTION");
  assert.equal(value.recovery.type, "AUTO_RECOVER");
});

test("Land settles, keeps divergent content, and archives without a user stop", async () => {
  let journal = "applying";
  const recovered = [];
  const f = fixture({
    hasLandGrant: () => true,
    recoverApply: async (_id, resolution) => {
      recovered.push(resolution);
      // Settling meets divergent content: the journal becomes a manual recovery.
      if (resolution === "settle") {
        journal = "manual-recovery";
        throw new Error("rollback requires manual recovery at 'src/a.js'");
      }
      journal = "settled-current";
    },
    runLand: async () => {
      if (journal === "applying") throw Object.assign(new Error("pending"), {
        decision: pendingApplyDecision("apply-pending-recovery", "settle") });
      if (journal === "manual-recovery") throw Object.assign(new Error("manual"), {
        decision: pendingApplyDecision("manual-recovery", "keep-current", ["src/a.js"]) });
      f.setState({ status: "archived" });
      return { archived: true };
    }
  });
  f.setState({ status: "proven" });
  f.setCursor({ status: "PASS", workspaceHash: "original" });
  const value = await f.runtime().advanceThrough("demo", "archived");
  assert.equal(value.userState, "DELIVERED");
  assert.deepEqual(recovered, ["settle", "keep-current"]);
  assert.ok(value.notices.some((notice) => /keep-current.*src\/a\.js/.test(notice)));
});

test("an automatic apply recovery that cannot finish goes to the agent, not the user", async () => {
  const f = fixture({
    hasLandGrant: () => true,
    recoverApply: async () => { throw new Error("backup unreadable"); },
    runLand: async () => {
      throw Object.assign(new Error("manual"), {
        decision: pendingApplyDecision("manual-recovery", "keep-current", ["src/a.js"]) });
    }
  });
  f.setState({ status: "proven" });
  f.setCursor({ status: "PASS", workspaceHash: "original" });
  const value = await f.runtime().advanceThrough("demo", "archived");
  assert.equal(value.action, "REPAIR");
  assert.equal(value.actor, "agent");
  assert.equal(value.legacyAction, "REPAIR_APPLY_RECOVERY");
  assert.deepEqual(value.details.divergentPaths, ["src/a.js"]);
  assert.match(value.reason, /backup unreadable/);
});

// --- User-only causes, loop cap, forbidden routes, typed advance decisions ---

const FORBIDDEN = /claude-foundation (?:proof (?:run|advance)|land (?:check|advance)|sandbox sync|sandbox create)/;

test("a cause only the user can clear asks on the first observation with the fix and resume", async () => {
  const disk = fixture({ prepareBuild: async () => {
    throw Object.assign(new Error("write failed"), { code: "ENOSPC" });
  } });
  const full = await disk.runtime().advanceThrough("demo", "build");
  assert.equal(full.action, "ASK_USER", "no agent repair rounds for a full disk");
  assert.equal(full.boundary, "user-environment");
  assert.equal(full.decision.cause, "disk-full");
  assert.match(full.decision.fix, /Free disk space/);
  assert.equal(full.decision.options[0].command, "claude-foundation advance demo --through build");
  assert.equal(disk.state().advanceRecovery?.attempts?.length || 0, 0, "nothing is counted or pending");

  const login = fixture({ prepareBuild: async () => {
    throw Object.assign(new Error("reviewer failed"), { details: { handoff: {
      step: "reviewer", command: "claude -p", log: "Invalid API key · Please run /login" } } });
  } });
  const reviewer = await login.runtime().advanceThrough("demo", "proven");
  assert.equal(reviewer.action, "ASK_USER");
  assert.equal(reviewer.decision.cause, "reviewer-login");
  assert.match(reviewer.reason, /claude \/login/);
  assert.equal(reviewer.resume, "claude-foundation advance demo --through proven");

  const cases = [
    [{ action: "REPAIR", legacyAction: "REPAIR_BUILD_RUNTIME", reason: "npm ERR! code E401 Unable to authenticate" }, "registry-auth"],
    [{ action: "REPAIR", legacyAction: "REPAIR_BUILD_RUNTIME", reason: "getaddrinfo ENOTFOUND registry.internal" }, "network"],
    [{ action: "REPAIR", legacyAction: "REPAIR_PROVIDER_ENVIRONMENT", reason: "GITHUB_TOKEN has expired" }, "credential"],
    [{ action: "REPAIR", legacyAction: "REPAIR_REVIEW_INFRASTRUCTURE", reason: "reviewer exhausted",
      requests: [{ infrastructureError: "tunneling socket could not be established, statusCode=407" }] }, "network"]
  ];
  for (const [value, cause] of cases) assert.equal(userEnvironmentCause(value)?.cause, cause, value.reason);
  assert.equal(userEnvironmentCause({ action: "REPAIR", legacyAction: "REPAIR_PROOF_RESULT",
    reason: "test expected 401 Unauthorized from the login route" }), null,
  "credential words in failing product output stay a product repair");
  assert.equal(userEnvironmentCause({ action: "REPAIR", legacyAction: "REPAIR_PROOF_RESULT",
    reason: "ENOSPC: no space left on device" })?.cause, "disk-full");
  assert.equal(userEnvironmentCause({ action: "REPAIR", legacyAction: "REPAIR_BUILD_RUNTIME",
    reason: "tool unavailable on connection attempt 2" }), null);
});

function recoveryHarness(initial = {}) {
  let stored = { id: "demo", status: "building", ...initial };
  let subject = "content-a";
  const recovery = createAdvanceRecovery({
    loadRuntime: () => structuredClone(stored),
    saveRuntime: (state) => { stored = structuredClone(state); },
    subject: () => subject, now: () => "2026-10-06T00:00:00.000Z"
  });
  return { recovery, set: (patch) => { stored = { ...stored, ...patch }; },
    setSubject: (value) => { subject = value; }, state: () => stored };
}

test("a Build verify that keeps failing identically is counted; changed output or content resets", () => {
  const h = recoveryHarness();
  const edit = (output, ms = 12) => ({ action: "EDIT", changeId: "demo", legacyAction: "EXECUTE_TASK",
    reason: "implement T001", resume: "claude-foundation advance demo --through build",
    verificationFailures: [{ taskId: "T001", command: "npm test", exitCode: 1,
      output: `${output} (${ms}ms) at 2026-10-0${ms % 9}T01:02:03.000Z` }] });
  assert.equal(h.recovery.observe("demo", edit("expected 2 got 3", 10)).action, "EDIT");
  const alternate = h.recovery.observe("demo", edit("expected 2 got 3", 31));
  assert.equal(alternate.legacyAction, "TRY_ALTERNATE_APPROACH", "durations and timestamps are not progress");
  const asked = h.recovery.observe("demo", edit("expected 2 got 3", 47));
  assert.equal(asked.action, "ASK_USER");
  assert.equal(asked.boundary, "repeated-no-progress");
  assert.equal(asked.decision.repetition.rounds, 3);
  assert.equal(asked.decision.repetition.verification[0].command, "npm test");

  const changed = recoveryHarness();
  changed.recovery.observe("demo", edit("expected 2 got 3"));
  changed.recovery.observe("demo", edit("expected 2 got 3"));
  assert.equal(changed.recovery.observe("demo", edit("expected 2 got 4")).action, "EDIT",
    "a different verify output is progress");
  changed.setSubject("content-b");
  assert.equal(changed.recovery.observe("demo", edit("expected 2 got 3")).action, "EDIT",
    "changed content starts a new count");
  assert.equal(changed.recovery.observe("demo", { action: "EDIT", changeId: "demo", reason: "next task" }).action,
    "EDIT", "ordinary Build work is never counted");
});

test("budget windows that keep reopening without progress ask with the evidence; an answer resets the count", () => {
  const h = recoveryHarness({ budget: { autoContinuation: { count: 1 } } });
  const working = { action: "EDIT", changeId: "demo", reason: "implement T001",
    resume: "claude-foundation advance demo --through build" };
  assert.equal(h.recovery.observe("demo", working).action, "EDIT");
  h.set({ budget: { autoContinuation: { count: 3, at: "2026-10-06T00:00:00.000Z" } } });
  assert.equal(h.recovery.observe("demo", working).action, "EDIT", "two reopened windows still continue");
  h.set({ budget: { autoContinuation: { count: 4, at: "2026-10-06T00:00:00.000Z" } } });
  const asked = h.recovery.observe("demo", working);
  assert.equal(asked.action, "ASK_USER");
  assert.equal(asked.boundary, "budget-no-progress");
  assert.equal(asked.decision.repetition.rounds, 3);
  assert.match(asked.decision.options[0].command, /^claude-foundation advance demo --decision retry /);
  const answer = h.recovery.resolve("demo", { decision: "retry", "decision-fingerprint": asked.decision.fingerprint,
    "decision-ref": "user:keep-going", reason: "narrow the scope" });
  assert.equal(answer.through, "build");
  assert.equal(h.recovery.observe("demo", working).action, "EDIT", "the answer starts a new count");

  const progressed = recoveryHarness({ budget: { autoContinuation: { count: 0 } } });
  progressed.recovery.observe("demo", working);
  progressed.setSubject("content-b");
  progressed.set({ budget: { autoContinuation: { count: 5 } } });
  assert.equal(progressed.recovery.observe("demo", working).action, "EDIT", "progress resets the baseline");
});

test("no agent-facing route names a forbidden lifecycle primitive", () => {
  const routed = agentSafeRoutes({ changeId: "demo", action: "REPAIR",
    resume: "claude-foundation advance demo --through archived",
    command: "claude-foundation sandbox sync demo --resolve openspec/changes/demo",
    reason: "run 'claude-foundation land check demo' after repair",
    next: [{ kind: "land", command: "claude-foundation land check demo" },
      { kind: "retry", command: "claude-foundation proof advance demo --retry-indeterminate --decision-ref <ref>" }],
    decision: { kind: "x", summary: "then 'claude-foundation proof run demo'",
      options: [{ id: "sync", outcome: "replay: 'claude-foundation sandbox sync demo'" }] } });
  assert.doesNotMatch(JSON.stringify(routed), FORBIDDEN);
  assert.equal(routed.command, "claude-foundation advance demo --through archived");
  assert.equal(routed.next[1].command, "claude-foundation advance demo --through archived");
  const building = agentSafeRoutes({ changeId: "demo", action: "REPAIR",
    resume: "claude-foundation advance demo --through build",
    command: "claude-foundation proof run demo", reason: "rerun 'claude-foundation sandbox sync demo'" });
  assert.equal(building.command, "claude-foundation advance demo --through proven");
  assert.match(building.reason, /claude-foundation advance demo --through build/,
    "a sandbox primitive never widens the route to Land");
  const inspect = agentSafeRoutes({ changeId: "demo", action: "ASK_USER",
    command: "claude-foundation land advance demo" });
  assert.equal(inspect.command, "claude-foundation advance demo --through archived");
  const authority = agentSafeRoutes({ changeId: "demo", action: "RUN_EXTERNAL",
    command: "claude-foundation authority run demo --request r1 --subject-actor a" });
  assert.equal(authority.command, "claude-foundation authority run demo --request r1 --subject-actor a",
    "harness-runnable reviewer routes are unchanged");
});

test("an indeterminate provider run is a recorded advance decision whose retry reaches the proof run", async () => {
  const flags = [];
  let indeterminate = true;
  const f = fixture({ runProof: async (_id, received) => {
    flags.push(received || null);
    if (indeterminate) return { status: "ACTION_REQUIRED", stage: "execution-indeterminate",
      providers: ["test"], next: [{ kind: "decide-indeterminate-execution",
        reason: "A prior controller stopped after reserving provider execution.",
        command: "claude-foundation advance demo --through proven" }] };
    f.setState({ status: "proven" });
    return { status: "PASS" };
  } });
  const asked = await f.runtime().advanceThrough("demo", "proven");
  assert.equal(asked.action, "ASK_USER");
  assert.equal(asked.legacyAction, "DECIDE_INDETERMINATE_EXECUTION");
  assert.doesNotMatch(JSON.stringify(asked), FORBIDDEN);
  assert.match(asked.decision.options.find((row) => row.id === "retry").command,
    /^claude-foundation advance demo --decision retry --decision-fingerprint /);
  assert.equal((await f.runtime().advanceThrough("demo", "proven")).decision.fingerprint,
    asked.decision.fingerprint, "the question stays pending until answered");
  assert.equal(flags.length, 1, "a pending decision never re-runs provider side effects");
  indeterminate = false;
  const done = await f.runtime().showAdvance("demo", { decision: "retry",
    "decision-fingerprint": asked.decision.fingerprint, "decision-ref": "user:inspected",
    reason: "side effects inspected" });
  assert.equal(done.reached, "proven");
  assert.deepEqual(flags.at(-1), { "retry-indeterminate": true, "decision-ref": "user:inspected" });
});

test("an amended-agreement conflict is answered through advance and resolves the sync, never sandbox sync", async () => {
  const synchronized = [];
  let conflict = true;
  const f = fixture({
    prepareBuild: async () => {
      if (conflict) throw userDecisionError("AMENDED_AGREEMENT_CONFLICT", "The target agreement changed.", [
        { id: "merge", outcome: "Merge, approve, then synchronize.", command: "claude-foundation sandbox sync demo --resolve openspec/changes/demo" },
        { id: "retain", outcome: "Keep the isolated agreement.", command: "claude-foundation sandbox sync demo --resolve openspec/changes/demo" },
        { id: "pause", outcome: "Pause." }], "merge");
    },
    synchronizeAgreement: async (id, flags) => { synchronized.push([id, flags]); conflict = false; return true; }
  });
  const asked = await f.runtime().advanceThrough("demo", "build");
  assert.equal(asked.action, "ASK_USER");
  assert.equal(asked.legacyAction, "RESOLVE_AGREEMENT_CONFLICT");
  assert.doesNotMatch(JSON.stringify(asked), FORBIDDEN);
  assert.deepEqual(asked.decision.options.map((row) => row.id), ["merge", "retain", "pause"]);
  await f.runtime().showAdvance("demo", { decision: "retain",
    "decision-fingerprint": asked.decision.fingerprint, "decision-ref": "user:retain", reason: "keep isolated" });
  assert.deepEqual(synchronized[0], ["demo", { resolve: "openspec/changes/demo" }]);
});

// --- Typed user-only boundaries at the failure source, and envelope signals ---

test("a full disk in a harness handoff asks the user at the source, even on inspection", () => {
  const value = advanceFailureAction("demo", Object.assign(new Error("setup failed"), {
    code: "EXECUTION_PREPARATION_FAILED",
    details: { handoff: { step: "sandbox setup", command: "npm ci", cwd: "/w",
      log: "npm ERR! code ENOSPC\nnpm ERR! nospc ENOSPC: no space left on device, write" } }
  }), { stage: "build", through: "build" });
  assert.equal(value.action, "ASK_USER");
  assert.equal(value.boundary, "user-environment");
  assert.equal(value.decision.cause, "disk-full");
  assert.equal(value.decision.category, "resource");
  assert.doesNotMatch(value.instruction || "", /foundation\.json/,
    "no repair of workspace or foundation.json is handed out for a full disk");
  assert.equal(value.decision.options[0].command, "claude-foundation advance demo --through build");
  assert.equal(value.userState, "NEEDS_DECISION");

  const typed = advanceFailureAction("demo", Object.assign(new Error("write failed"), {
    cause: { code: "EDQUOT" } }), { stage: "prove", through: "proven" });
  assert.equal(typed.decision?.cause, "disk-full", "a typed code wins without any message text");

  const agentOwned = advanceFailureAction("demo", Object.assign(new Error("setup failed"), {
    details: { handoff: { step: "sandbox setup", command: "npm ci", log: "ERESOLVE could not resolve" } }
  }));
  assert.equal(agentOwned.action, "REPAIR", "an agent-fixable setup failure stays the agent's handoff");
  assert.equal(agentOwned.recovery.type, "HANDOFF");
});

test("a rejected credential is the user's, not an open external wait", () => {
  const forbidden = advanceFailureAction("demo", Object.assign(new Error(
    "git push: remote: Permission to acme/app.git denied to bot. The requested URL returned error: 403"),
  { owner: "external" }), { stage: "land", through: "archived" });
  assert.equal(forbidden.action, "ASK_USER");
  assert.equal(forbidden.decision.category, "credential");
  assert.equal(forbidden.decision.cause, "remote-permission");
  assert.match(forbidden.reason, /returned error: 403/);

  const pending = advanceFailureAction("demo", Object.assign(new Error("the deploy approver has not answered"), {
    owner: "external" }));
  assert.equal(pending.action, "WAIT", "ordinary external waiting keeps its owner and condition");
  assert.ok(pending.wait.condition);
});

test("a local process timeout is not a network cause; a socket timeout is", () => {
  const repair = (reason) => ({ action: "REPAIR", legacyAction: "REPAIR_REVIEW_INFRASTRUCTURE", reason });
  assert.equal(userEnvironmentCause(repair("spawn ETIMEDOUT")), null);
  assert.equal(userEnvironmentCause({ action: "REPAIR", legacyAction: "REPAIR_BUILD_RUNTIME",
    reason: "setup failed", errorCode: "ETIMEDOUT" }), null);
  assert.equal(userEnvironmentCause(repair("connect ETIMEDOUT 10.0.0.1:443"))?.cause, "network");
  assert.equal(environmentCause({ codes: ["ENOTFOUND"] })?.category, "network");
});

test("signals raised during a command ride on the advance envelope and keep their stream line", async () => {
  drainSignals();
  const lines = [];
  emitSignal("budget-warning", "WARNING: BUDGET demo: 72.0% warn continue (tokens)", (line) => lines.push(line));
  assert.deepEqual(lines, ["WARNING: BUDGET demo: 72.0% warn continue (tokens)"]);
  recordSignal("budget-warning", "WARNING: BUDGET demo: 72.0% warn continue (tokens)");
  let printed = null;
  const f = fixture({ output: (text) => { printed = JSON.parse(text); } });
  await f.runtime().showAdvance("demo", { through: "proven" });
  assert.deepEqual(printed.signals, [
    { code: "budget-warning", message: "BUDGET demo: 72.0% warn continue (tokens)" }]);
  await f.runtime().showAdvance("demo", { through: "proven" });
  assert.equal(printed.signals, undefined, "a signal is reported once and absent when there is none");
  assert.deepEqual(withSignals({ action: "DONE" }), { action: "DONE" });
});

test("an archive recovery that finds the change already archived signals it in the envelope", async () => {
  drainSignals();
  let printed = null;
  const f = fixture({
    output: (text) => { printed = JSON.parse(text); },
    hasLandGrant: () => true,
    recoverArchive: async (id) => {
      // apply-runtime's recovery line is quiet under advance; the signal is not.
      emitSignal("already-archived", `ALREADY ARCHIVED ${id}\n  archived: 2026-10-06`, () => {});
      return true;
    }
  });
  f.setState({ status: "archived" });
  await f.runtime().showAdvance("demo", { through: "archived" });
  assert.equal(printed.action, "DONE");
  assert.equal(printed.signals[0].code, "already-archived");
  assert.match(printed.signals[0].message, /^ALREADY ARCHIVED demo/);
});
