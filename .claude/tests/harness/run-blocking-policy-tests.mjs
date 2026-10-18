// The blocking policy (WORKFLOW.md § Blocking policy): before Land only a user
// decision stops the flow, and Land is the single hard gate. These assertions
// pin the runtime form of that rule: which boundaries may reach the user, that
// the recovery ladder returns repeated agent and harness work to its owner,
// and that Land refuses work without a current passing proof.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADVANCE_DECISIONS, ALTERNATE_AFTER_ROUNDS, STRATEGY_AFTER_ROUNDS,
  USER_AUTHORITY_BOUNDARIES, createAdvanceRecovery
} from "../../harness/runtime/workflow/advance-recovery.mjs";
import { lifecycleOutcome } from "../../harness/runtime/core/lifecycle-outcome.mjs";
import {
  LIFECYCLE_STATUSES, lifecycleTransitionValue, normalizeLifecycleStatus
} from "../../harness/runtime/core/lifecycle-reducer.mjs";
import { createLandRuntime } from "../../harness/runtime/workflow/land-runtime.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RUNTIME = join(ROOT, ".claude", "harness", "runtime");

// The policy's user decisions, by the boundary each one is raised under.
// `user-environment` (a cause only the user can clear) and an
// amended-agreement conflict (agreement meaning) reach the user on their own
// typed routes rather than through the ladder's boundary set.
const POLICY_USER_BOUNDARIES = new Set([
  ...USER_AUTHORITY_BOUNDARIES, "user-environment", "amended-agreement-conflict"
]);

// Agent- and harness-owned boundaries the advance code raises. None may be a
// user boundary.
const OWNER_BOUNDARIES = [
  "repeated-no-progress", "alternate-approach", "conflict", "resource",
  "internal-recovery", "internal-lock", "internal-transaction", "target-conflict",
  "spec-sync", "host-execution", "draft-validation", "required-evidence",
  "content-identity", "land-verification"
];

test("the ladder's user boundaries are exactly the policy's user authority", () => {
  for (const boundary of ["user-authority", "land-authority", "spec-approval",
    "external-side-effect", "product-meaning", "budget-no-progress"])
    assert.ok(USER_AUTHORITY_BOUNDARIES.has(boundary), `${boundary} is a user boundary`);
  for (const boundary of OWNER_BOUNDARIES)
    assert.equal(USER_AUTHORITY_BOUNDARIES.has(boundary), false,
      `${boundary} is agent or harness work, never a user boundary`);
  for (const [kind, { boundary }] of Object.entries(ADVANCE_DECISIONS))
    assert.ok(POLICY_USER_BOUNDARIES.has(boundary),
      `advance decision '${kind}' is raised under the user boundary '${boundary}'`);
  assert.equal(ALTERNATE_AFTER_ROUNDS, 2);
  assert.equal(STRATEGY_AFTER_ROUNDS, 3);
});

function ladder() {
  let state = { id: "change-a", status: "building" };
  const recovery = createAdvanceRecovery({
    loadRuntime: () => structuredClone(state),
    saveRuntime: (next) => { state = structuredClone(next); },
    subject: () => "subject-a",
    now: () => "2026-10-18T00:00:00Z"
  });
  return (value, rounds) => {
    let result = null;
    for (let round = 0; round < rounds; round += 1)
      result = recovery.observe("change-a", structuredClone(value));
    return result;
  };
}

const outcome = (value) => lifecycleOutcome({ protocol: 6, ...value });

test("rung 3 returns repeated agent work to the agent, never the user", () => {
  const observe = ladder();
  const repair = { changeId: "change-a", action: "REPAIR", actor: "agent", owner: "agent",
    legacyAction: "REPAIR_PROOF_RESULT", boundary: "conflict",
    reason: "test api.spec failed: expected 200", instruction: "Fix the failing test",
    resume: "claude-foundation advance change-a --through proven" };
  assert.equal(observe(repair, 1).legacyAction, "REPAIR_PROOF_RESULT");
  const second = ladder()(repair, ALTERNATE_AFTER_ROUNDS);
  assert.equal(second.action, "REPAIR");
  assert.equal(second.owner, "agent");
  assert.equal(second.legacyAction, "TRY_ALTERNATE_APPROACH");
  const third = ladder()(repair, STRATEGY_AFTER_ROUNDS);
  assert.equal(third.action, "REPAIR");
  assert.equal(third.owner, "agent");
  assert.equal(third.legacyAction, "NO_PROGRESS_BOUNDARY");
  assert.equal(third.repetition.rounds, STRATEGY_AFTER_ROUNDS);
  assert.match(third.repetition.output, /expected 200/);
  assert.ok(third.attemptedStrategies.length > 0);
  outcome(third);
  // Later rounds keep counting with the owner.
  const fifth = ladder()(repair, 5);
  assert.equal(fifth.action, "REPAIR");
  assert.equal(fifth.repetition.rounds, 5);
});

test("rung 3 keeps harness work with the harness and its own command", () => {
  const repair = { changeId: "change-a", action: "REPAIR", actor: "harness", owner: "harness",
    legacyAction: "REPAIR_SETUP", boundary: "host-execution",
    reason: "npm ci exited 1", command: "npm ci",
    resume: "claude-foundation advance change-a --through proven" };
  const third = ladder()(repair, STRATEGY_AFTER_ROUNDS);
  assert.equal(third.action, "REPAIR");
  assert.equal(third.owner, "harness");
  assert.equal(third.command, "npm ci");
  assert.equal(third.recoveryType, "HANDOFF");
  outcome(third);
});

test("a Build verify that keeps failing stays an agent repair", () => {
  const edit = { changeId: "change-a", action: "EDIT", actor: "agent", owner: "agent",
    legacyAction: "EXECUTE_TASK", reason: "T001 verify failed",
    verificationFailures: [{ taskId: "T001", command: "npm test", exitCode: 1,
      output: "1 failing (12ms)" }] };
  const third = ladder()(edit, STRATEGY_AFTER_ROUNDS);
  assert.equal(third.action, "REPAIR");
  assert.equal(third.owner, "agent");
  assert.equal(third.repetition.verification[0].taskId, "T001");
});

test("only a user-owned boundary becomes a question at rung 3", () => {
  for (const boundary of USER_AUTHORITY_BOUNDARIES) {
    const repair = { changeId: "change-a", action: "REPAIR", actor: "agent", owner: "agent",
      legacyAction: "REPAIR_LAND_INPUT", boundary, reason: `blocked at ${boundary}`,
      instruction: "Resolve the input", resume: "claude-foundation advance change-a" };
    const third = ladder()(repair, STRATEGY_AFTER_ROUNDS);
    assert.equal(third.action, "ASK_USER", boundary);
    assert.equal(third.boundary, boundary);
    assert.equal(third.decision.repetition.rounds, STRATEGY_AFTER_ROUNDS);
    outcome(third);
  }
});

test("waits are never counted as repeated repair", () => {
  const wait = { changeId: "change-a", action: "WAIT", actor: "harness", owner: "harness",
    legacyAction: "WAIT_RESOURCE", boundary: "resource",
    reason: "queued behind change-b",
    wait: { owner: "harness", condition: "change-b releases resource:db",
      checkCommand: "claude-foundation advance change-a" } };
  const later = ladder()(wait, 10);
  assert.equal(later.action, "WAIT");
  assert.equal(later.legacyAction, "WAIT_RESOURCE");
});

// Every ASK_USER the advance, recovery, and proof code can emit. A literal
// boundary must be a policy user boundary; a computed one must be a reviewed
// site whose source is covered above (ladder pending records) or carries the
// raising module's own typed decision.
const SCANNED = [
  "workflow/advance-runtime.mjs", "workflow/advance-recovery.mjs",
  "evidence/proof-execution-runtime.mjs", "evidence/proof-readiness.mjs",
  "core/convergent-gate.mjs", "workflow/land-runtime.mjs",
  "workflow/lease-runtime.mjs", "workflow/agent-dispatch.mjs",
  "workflow/apply-runtime.mjs"
];
const REVIEWED_COMPUTED_SITES = new Map([
  // A thrown error that already carries a typed decision or user owner; the
  // raising module chose the boundary and the decision kind.
  ["workflow/advance-runtime.mjs:error.boundary || \"user-authority\"", "error-carried decision"],
  ["workflow/advance-runtime.mjs:error?.boundary || \"user-authority\"", "error owned by the user or Land"],
  // Replays a ladder pending record; pending records exist only for user
  // boundaries, typed advance decisions, and the budget cap (tested above).
  ["workflow/advance-runtime.mjs:pending.paused ? \"user-paused\" : pending.boundary || \"repeated-no-progress\"", "ladder pending record"],
  ["workflow/advance-recovery.mjs:pending.boundary || \"repeated-no-progress\"", "ladder pending record"]
]);

function askUserSites(file) {
  const source = readFileSync(join(RUNTIME, file), "utf8");
  const pattern = /envelope\(\s*id\s*,\s*(?:[^,]*\?\s*"WAIT"\s*:\s*)?"ASK_USER"\s*,|action:\s*"ASK_USER"\s*,/g;
  const sites = [];
  for (const match of source.matchAll(pattern)) {
    const start = match[0].startsWith("action")
      ? source.lastIndexOf("{", match.index)
      : source.indexOf("{", match.index + match[0].length);
    let depth = 0;
    let end = start;
    for (let index = start; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}" && --depth === 0) { end = index; break; }
    }
    const boundary = source.slice(start, end + 1).match(/\bboundary:\s*([^,\n]+)/)?.[1].trim() || null;
    sites.push({ line: source.slice(0, match.index).split("\n").length, boundary });
  }
  return sites;
}

test("every pre-Land ASK_USER is raised under a user boundary", () => {
  const violations = [];
  const computed = new Set();
  for (const file of SCANNED) {
    for (const site of askUserSites(file)) {
      const where = `${file}:${site.line}`;
      if (!site.boundary) { violations.push(`${where} has no boundary`); continue; }
      const literal = site.boundary.match(/^"([a-z-]+)"$/)?.[1];
      if (literal) {
        if (!POLICY_USER_BOUNDARIES.has(literal))
          violations.push(`${where} asks the user under '${literal}', which the agent or harness owns`);
        continue;
      }
      const key = `${file}:${site.boundary}`;
      if (!REVIEWED_COMPUTED_SITES.has(key))
        violations.push(`${where} computes its boundary (${site.boundary}); review it and list it`);
      computed.add(key);
    }
  }
  for (const key of REVIEWED_COMPUTED_SITES.keys())
    assert.ok(computed.has(key), `reviewed site no longer exists: ${key}`);
  assert.deepEqual(violations, []);
});

test("nothing before proven reaches applied or archived", () => {
  for (const from of ["change", "resolved", "building"])
    for (const target of ["applied", "archived"])
      assert.throws(() => lifecycleTransitionValue({ status: from }, target),
        /invalid lifecycle transition/, `${from} -> ${target}`);
  assert.equal(lifecycleTransitionValue({ status: "proven" }, "applied").to, "applied");
  assert.equal(normalizeLifecycleStatus("landing"), "proven");
  assert.equal(LIFECYCLE_STATUSES.includes("landing"), false);
});

const HASH = "a".repeat(64);

function landFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "foundation-blocking-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const proofs = join(root, "proofs");
  mkdirSync(bin, { recursive: true });
  mkdirSync(proofs, { recursive: true });
  writeFileSync(join(bin, "openspec"), "#!/bin/sh\nprintf '1.7.0\\n'\n");
  chmodSync(join(bin, "openspec"), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath}`;
  const originalLog = console.log;
  console.log = () => {};
  t.after(() => { process.env.PATH = originalPath; console.log = originalLog; });
  let sequence = 0;
  return (options = {}) => {
    sequence += 1;
    const id = `land-${sequence}`;
    const state = { id, status: "proven", impact: "low", repositories: {}, waivers: [],
      ...options.state };
    const proofFile = join(proofs, `${id}.json`);
    if (!options.proofMissing)
      writeFileSync(proofFile, `${JSON.stringify({ status: "pass", proofRunId: `${id}-proof`,
        workspaceHash: options.proofHash || HASH, receipts: [] })}\n`);
    const runtime = createLandRuntime({
      assertApproval: options.assertApproval || (() => {}),
      root, transactions: join(root, "transactions"),
      loadRuntime: () => state, saveRuntime: () => {},
      pendingApplyTransactions: () => [], recoverPendingApply: () => {},
      assertNoDroppedScenarios: () => {}, blockingDrift: () => [],
      proofAudit: () => ({ valid: true }), proofPath: () => proofFile,
      readJson: (path, fallback = null) => {
        try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
      },
      writeJson: () => {}, clearSnapshotCache: () => {},
      relevantHash: () => options.currentHash || HASH,
      requiredProviders: () => [], receiptValidity: () => ({ validity: "valid" }),
      fileDigest: () => "digest", receiptPath: () => join(root, "receipt.json"),
      handoffReadiness: () => ({ operations: [], blocking: [], tracked: [], status: "COMPLETE" }),
      telemetryReadiness: null, verifyAppliedProjection: () => ({ valid: true }),
      selectedRepositories: () => [], repositoryById: () => null,
      git: () => ({ status: 1, stdout: "", stderr: "" }),
      gitHead: () => "root-head", ciEvidenceProtocolVersion: 1,
      stableHash: (value) => JSON.stringify(value), agentPlanValue: null,
      executionContract: null, now: () => "2026-10-18T00:00:00Z",
      blockWithDecision: (_id, code) => { throw new Error(`decision:${code}`); },
      deliveryObservation: () => ({ observed: false, paths: [],
        reason: "target-does-not-match-change-projection" }),
      landPreflight: null,
      fail: (message) => { throw new Error(message); }
    });
    return { id, runtime };
  };
}

test("Land refuses without a current passing proof or a valid spec approval", (t) => {
  const make = landFixture(t);
  const ready = make();
  assert.equal(ready.runtime.landCheck(ready.id).archived, false);
  const unproven = /Land requires current passing proof/;
  const missing = make({ proofMissing: true });
  assert.throws(() => missing.runtime.landCheck(missing.id), unproven);
  const stale = make({ currentHash: "b".repeat(64) });
  assert.throws(() => stale.runtime.landCheck(stale.id), unproven);
  const building = make({ state: { status: "building" } });
  assert.throws(() => building.runtime.landCheck(building.id), unproven);
  const unapproved = make({ assertApproval: () => {
    throw Object.assign(new Error("spec approval required"), { code: "SPEC_APPROVAL_REQUIRED" });
  } });
  assert.throws(() => unapproved.runtime.landCheck(unapproved.id),
    (error) => error.code === "SPEC_APPROVAL_REQUIRED");
  assert.throws(() => createLandRuntime({ fail: () => {} }), /requires assertApproval/);
});
