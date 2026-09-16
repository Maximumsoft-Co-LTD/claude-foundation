import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createHandoffRuntime } from "../runtime/workflow/handoff-runtime.mjs";

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(canonical(value))).digest("hex");
const fixture = mkdtempSync(join(tmpdir(), "foundation-handoff-"));
const changeId = "external-operation";
const change = join(fixture, "changes", changeId);
const brokenChangeId = "broken-external-operation";
const brokenChange = join(fixture, "changes", brokenChangeId);
const archivedChange = join(fixture, "changes", "archive", `2026-08-14-${changeId}`);
const state = {
  id: changeId, status: "building", contractRevision: 1,
  workspace: { mode: "current", path: fixture }
};
const readJson = (path, fallback = undefined) => {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { if (fallback !== undefined) return fallback; throw error; }
};
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
const fail = (message) => { throw new Error(message); };
const operation = (overrides = {}) => ({
  id: "H001",
  owner: "devops-platform",
  environment: "dev",
  authority: "AWS role with Secrets Manager write",
  operation: "Populate nova/service/config and activate the deployment",
  timing: "post-land",
  activation: "safe-before-activation",
  evidence: ["tracking-reference", "secret-reference", "deployment-health"],
  runbook: "docs/runbooks/service.md#activate",
  rollback: "Disable the deployment flag and restore the previous secret version",
  claimIds: ["activation-safe"],
  taskIds: ["T001"],
  activationProof: {
    claimId: "activation-safe",
    condition: "The merged deployment remains disabled until DevOps enables it"
  },
  ...overrides
});

test("test", () => {
try {
  mkdirSync(change, { recursive: true });
  let captureCalls = 0;
  const runtime = createHandoffRuntime({
    root: fixture,
    handoffsRoot: join(fixture, ".foundation", "handoffs"),
    activeChangePath: (id, current = state) => id === brokenChangeId
      ? brokenChange
      : current.status === "archived" ? archivedChange : change,
    loadRuntime: (id) => id === brokenChangeId
      ? { ...state, id: brokenChangeId }
      : state,
    readJson,
    writeJson,
    stableHash,
    defaultOwner: () => "devops-team",
    now: () => "2026-08-14T12:00:00.000Z",
    fail,
    capture: (callback) => {
      captureCalls += 1;
      return callback();
    }
  });

  writeJson(join(change, "handoffs.yaml"), { version: 1, operations: [operation()] });
  writeJson(join(fixture, ".foundation", "runtime", `${changeId}.json`), state);
  const validated = runtime.handoffContract(changeId, {
    claimIds: new Set(["activation-safe"]), taskIds: new Set(["T001"])
  });
  assert.equal(validated.operations.length, 1);
  const declared = runtime.handoffReadiness(changeId);
  assert.deepEqual(declared.blocking, []);
  assert.deepEqual(declared.declared, ["H001"]);
  assert.equal(declared.operations[0].landDisposition, "declared-post-land");
  const initialPacket = runtime.handoffPacketValue(changeId);
  assert.equal(initialPacket.operations[0].obligationClass,
    "production-verification");
  assert.equal(initialPacket.operations[0].userActionRequired, false);
  assert.equal(initialPacket.operations[0].decision, null,
    "a valid declaration must not ask a user to acknowledge harness bookkeeping");
  const openList = runtime.handoffListValue({ open: true });
  assert.equal(openList.changes.length, 1);
  assert.equal(openList.changes[0].changeId, changeId);
  assert.equal(openList.changes[0].operations[0].landDisposition,
    "declared-post-land");
  assert.deepEqual(openList.errors, []);
  mkdirSync(brokenChange, { recursive: true });
  writeFileSync(join(brokenChange, "handoffs.yaml"), "{not-json");
  writeJson(join(fixture, ".foundation", "runtime", `${brokenChangeId}.json`), {
    ...state, id: brokenChangeId
  });
  const isolatedList = runtime.handoffListValue({ open: true });
  assert.equal(isolatedList.changes.length, 1,
    "an unreadable change must not hide healthy operational obligations");
  assert.equal(isolatedList.changes[0].changeId, changeId);
  assert.equal(isolatedList.errors.length, 1);
  assert.equal(isolatedList.errors[0].changeId, brokenChangeId);
  assert.equal(captureCalls, 3,
    "aggregate readiness must cross the injected failure trap for every change");
  assert.equal(JSON.stringify(initialPacket).includes("claude-foundation"), false,
    "a user-facing recovery packet must never require the user to type a command");

  writeJson(join(change, "handoffs.yaml"), {
    version: 1, operations: [operation({ owner: undefined })]
  });
  assert.equal(runtime.handoffContract(changeId).operations[0].owner, "devops-team",
    "an omitted owner defaults to the configured team identity");
  writeJson(join(change, "handoffs.yaml"), { version: 1, operations: [operation()] });

  const lockPath = join(fixture, ".foundation", "handoffs", changeId,
    ".mutation.lock");
  writeJson(lockPath, {
    version: 1, pid: process.pid, token: "live-owner",
    acquiredAt: "2026-08-14T00:00:00.000Z"
  });
  const oldLock = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(lockPath, oldLock, oldLock);
  assert.throws(() => runtime.recordHandoff(changeId, {
    id: "H001", status: "accepted", actor: "Nok SRE", reference: "OPS-1842"
  }), /handoff mutation already active/,
  "a live owner is never evicted merely because its lock is old");
  rmSync(lockPath, { force: true });

  const priorLog = console.log;
  console.log = () => {};
  try {
    runtime.recordHandoff(changeId, {
      id: "H001", status: "accepted", actor: "Nok SRE",
      reference: "OPS-1842"
    });
  } finally { console.log = priorLog; }
  const accepted = runtime.handoffReadiness(changeId);
  assert.equal(accepted.status, "READY_WITH_TRACKED_HANDOFF");
  assert.equal(accepted.operations[0].landBlocking, false);
  assert.equal(accepted.operations[0].landDisposition, "tracked-post-land");
  const acceptedPacket = runtime.handoffPacketValue(changeId);
  assert.equal(acceptedPacket.operations[0].userActionRequired, false);
  assert.equal(acceptedPacket.operations[0].decision, null,
    "an already accepted tracked handoff must not ask the user again");

  mkdirSync(archivedChange, { recursive: true });
  writeJson(join(archivedChange, "handoffs.yaml"), {
    version: 1, operations: [operation()]
  });
  state.status = "archived";
  assert.equal(runtime.handoffReadiness(changeId).status,
    "READY_WITH_TRACKED_HANDOFF",
    "the content-bound operator record remains usable after OpenSpec archives the contract");
  state.status = "building";

  writeJson(join(change, "handoffs.yaml"), {
    version: 1, operations: [operation({ owner: "devops-cloud" })]
  });
  const stale = runtime.handoffReadiness(changeId);
  assert.equal(stale.operations[0].validity, "stale");
  assert.equal(stale.operations[0].landBlocking, false,
    "a stale optional acknowledgement must not block a valid safe declaration");
  assert.equal(stale.operations[0].landDisposition, "declared-post-land");

  writeJson(join(change, "handoffs.yaml"), {
    version: 1,
    operations: [operation({
      owner: "devops-cloud",
      timing: "pre-land",
      activation: "activation-coupled",
      activationProof: null
    })]
  });
  console.log = () => {};
  try {
    runtime.recordHandoff(changeId, {
      id: "H001", status: "accepted", actor: "Mek DevOps",
      reference: "OPS-1843"
    });
  } finally { console.log = priorLog; }
  assert.equal(runtime.handoffReadiness(changeId).operations[0].landBlocking, true,
    "accepted activation-coupled work remains a Land blocker");
  const coupledPacket = runtime.handoffPacketValue(changeId);
  assert.equal(coupledPacket.operations[0].obligationClass, "activation-safety");
  assert.equal(coupledPacket.operations[0].decision.recommended, "complete");
  console.log = () => {};
  try {
    runtime.recordHandoff(changeId, {
      id: "H001", status: "completed", actor: "Mek DevOps",
      reference: "OPS-1843", evidence: "terraform-run-991,deploy-health-991"
    });
  } finally { console.log = priorLog; }
  assert.equal(runtime.handoffReadiness(changeId).status, "COMPLETE");
  assert.equal(runtime.handoffListValue({ open: true }).changes.length, 0,
    "completed obligations leave the open operational queue");
  const completedPacket = runtime.handoffPacketValue(changeId);
  assert.equal(completedPacket.operations[0].userActionRequired, false);
  assert.equal(completedPacket.operations[0].decision, null);

  writeFileSync(join(fixture, ".foundation", "handoffs", changeId, "H001.json"),
    "{not-json");
  const invalid = runtime.handoffReadiness(changeId).operations[0];
  assert.equal(invalid.validity, "invalid",
    "a torn operator record becomes a typed invalid state instead of crashing readiness");
  assert.equal(invalid.landBlocking, true,
    "the current activation-coupled declaration remains fail-closed");

  writeJson(join(change, "handoffs.yaml"), { version: 1, operations: [operation()] });
  console.log = () => {};
  try {
    runtime.recordHandoff(changeId, {
      id: "H001", status: "cancelled", actor: "foundation-harness",
      reference: "change-retired", reason: "Deployment was superseded before activation"
    });
  } finally { console.log = priorLog; }
  const cancelled = runtime.handoffReadiness(changeId);
  assert.equal(cancelled.operations[0].landDisposition, "cancelled");
  assert.equal(cancelled.operations[0].landBlocking, false);
  assert.equal(runtime.handoffListValue({ open: true }).changes.length, 0,
    "cancelled safe obligations leave the open operational queue");
  assert.throws(() => runtime.recordHandoff(changeId, {
    id: "H001", status: "accepted", actor: "Nok SRE", reference: "OPS-1900"
  }), /cancelled handoff 'H001' cannot be changed/);
  writeJson(join(change, "handoffs.yaml"), {
    version: 1,
    operations: [operation({ runbook: "docs/runbooks/service-v2.md#activate" })]
  });
  const staleTerminalList = runtime.handoffListValue({ open: true });
  assert.equal(staleTerminalList.changes.length, 1,
    "a stale terminal record must not hide the current declared obligation");
  assert.equal(staleTerminalList.changes[0].operations[0].validity, "stale");
  assert.equal(staleTerminalList.changes[0].operations[0].landDisposition,
    "declared-post-land");
  console.log = () => {};
  try {
    runtime.recordHandoff(changeId, {
      id: "H001", status: "superseded", actor: "foundation-harness",
      reference: "replacement-change-v2"
    });
  } finally { console.log = priorLog; }
  const superseded = runtime.handoffReadiness(changeId);
  assert.equal(superseded.operations[0].landDisposition, "superseded");
  assert.equal(runtime.handoffListValue({ open: true }).changes.length, 0,
    "superseded safe obligations leave the open operational queue");

  writeJson(join(change, "handoffs.yaml"), {
    version: 1,
    operations: [operation({ privateKey: "should-never-be-stored" })]
  });
  assert.throws(() => runtime.handoffContract(changeId), /secret-valued field/);

  writeJson(join(change, "handoffs.yaml"), {
    version: 1,
    operations: [operation({ runbook: "https://user:password@example.test/runbook" })]
  });
  assert.throws(() => runtime.handoffContract(changeId), /credential material/);

  console.log("handoff policy tests: PASS");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
});
