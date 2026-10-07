import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync,
  rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { drainSignals } from "../runtime/core/signals.mjs";
import { createReviewAttemptStore } from "../runtime/evidence/review-attempt-store.mjs";

// A corrupt review attempt chain is harness bookkeeping: the harness
// quarantines it, rebuilds from what still verifies, and never asks the user.
// The rebuild is fail-closed: the attempt count never drops below what the
// durable sources evidence, an unverifiable verdict is never reused, and an
// undeterminable delivered count consumes the review budget.

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(canonical(value))).digest("hex");
const readJson = (path, fallback = undefined) => {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { if (fallback !== undefined) return fallback; throw error; }
};
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
const fail = (message) => { throw new Error(message); };

function world(t, id) {
  const root = mkdtempSync(join(tmpdir(), "foundation-review-recovery-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const evidenceVault = join(root, "evidence");
  let clock = 0;
  let state = { id, status: "proving", reviewHistory: { version: 1, totalAttempts: 0, aiAttempts: 0, chainHead: null } };
  const store = createReviewAttemptStore({
    receiptsRoot: join(root, "receipts"), evidenceVault, readJson, writeJson,
    loadRuntime: () => structuredClone(state),
    saveRuntime: (next) => { state = structuredClone(next); },
    stableHash,
    reviewReceiptBinding: () => null,
    now: () => new Date(Date.UTC(2026, 9, 7, 12, 0, clock++)).toISOString(),
    blockWithDecision: (_id, kind) => { throw new Error(`USER_DECISION:${kind}`); },
    fail
  });
  const attemptsDir = join(evidenceVault, id, "review-attempts");
  return {
    store, attemptsDir,
    state: () => structuredClone(state),
    update: (patch) => { state = { ...state, ...patch }; },
    reserve: (status) => store.reserveReviewAttempt(id, "ai", {
      workspaceHash: `workspace-${status}`, status, reviewBinding: null
    }),
    file: (attempt) => readdirSync(attemptsDir)
      .find((name) => name.startsWith(`${String(attempt).padStart(4, "0")}-`)),
    quarantines: () => readdirSync(join(evidenceVault, id))
      .filter((name) => name.startsWith("review-attempts.corrupt-"))
  };
}

test("a tampered head verdict is quarantined and consumes the budget instead of asking", (t) => {
  drainSignals();
  const id = "change-tampered-head";
  const w = world(t, id);
  w.reserve("fail");
  const headName = w.file(1);
  const original = readJson(join(w.attemptsDir, headName));
  // Rewrite the verdict without rehashing: the digest no longer verifies.
  writeJson(join(w.attemptsDir, headName), { ...original, status: "pass" });

  const history = w.store.assertReviewDispatchAllowed(id, "human");
  assert.equal(drainSignals().some((row) => row.code === "review-history-recovered"), true,
    "the recovery is visible as a signal");
  assert.ok(history.totalAttempts >= 1, "the evidenced attempt is never dropped");
  assert.equal(w.store.reviewHistoryChainValid(id, history), true);
  const [quarantine] = w.quarantines();
  assert.ok(quarantine, "the corrupt chain is moved aside, not deleted");
  assert.deepEqual(readJson(join(dirname(w.attemptsDir), quarantine, headName)),
    { ...original, status: "pass" }, "the quarantine keeps the tampered bytes as evidence");
  const delivered = w.store.deliveredAiAttempts(id, history);
  assert.equal(delivered.some((attempt) => attempt.status === "pass" ||
    attempt.resultStatus === "pass"), false, "an unverifiable verdict is never reused");
  assert.equal(w.state().reviewHistory.recoveries?.length, 1,
    "the recovery is recorded durably in the runtime history");
  assert.throws(() => w.store.assertReviewDispatchAllowed(id, "ai"),
    /REVIEW_ROUTE_COMPLETE/,
    "an undeterminable delivered count routes through the normal exhausted boundary");
});

test("a chain edited to lower the count rebuilds no lower than the evidence", (t) => {
  drainSignals();
  const id = "change-lowered-count";
  const w = world(t, id);
  w.reserve("fail");
  const second = w.reserve("pass");
  w.update({ reviewHistory: { ...w.state().reviewHistory, totalAttempts: 1, aiAttempts: 1 } });
  assert.equal(w.store.reviewHistoryChainValid(id, w.state().reviewHistory), false);

  const history = w.store.assertReviewDispatchAllowed(id, "human");
  assert.equal(history.totalAttempts, 2, "the rebuilt count matches the evidenced attempts");
  assert.equal(history.aiAttempts, 2);
  assert.equal(history.chainHead, second.digest,
    "a fully verifiable chain is restored with its verified verdict");
  assert.equal(w.store.reviewHistoryChainValid(id, history), true);
  assert.equal(w.quarantines().length, 1);
  assert.equal(w.store.deliveredAiAttempts(id, history).length, 2);
  assert.throws(() => w.store.assertReviewDispatchAllowed(id, "ai"),
    /REVIEW_ROUTE_COMPLETE/);
});

test("a tampered record that lowers its own attempt number cannot lower the count", (t) => {
  const id = "change-renumbered";
  const w = world(t, id);
  w.reserve("error");
  w.reserve("fail");
  w.reserve("inconclusive");
  const headName = w.file(3);
  const head = readJson(join(w.attemptsDir, headName));
  const forged = { ...head, attempt: 1, priorChainHead: null };
  delete forged.digest;
  forged.digest = stableHash(forged);
  // A forged, self-consistent record at attempt 1 under the old file name.
  rmSync(join(w.attemptsDir, headName));
  writeJson(join(w.attemptsDir, `0003-${forged.digest.slice(0, 12)}.json`), forged);
  w.update({ reviewHistory: { ...w.state().reviewHistory, chainHead: forged.digest, totalAttempts: 3 } });

  const history = w.store.assertReviewDispatchAllowed(id, "human");
  assert.ok(history.totalAttempts >= 3);
  assert.ok(w.store.deliveredAiAttempts(id, history).length >= 2);
  assert.throws(() => w.store.assertReviewDispatchAllowed(id, "ai"), /REVIEW_ROUTE_COMPLETE/);
});

test("a missing head record recovers through dispatch without a user decision", (t) => {
  const id = "change-missing-head";
  const w = world(t, id);
  w.reserve("fail");
  const scratch = mkdtempSync(join(tmpdir(), "foundation-review-recovery-moved-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  renameSync(join(w.attemptsDir, w.file(1)), join(scratch, "moved.json"));

  const attempt = w.store.dispatchReviewAttempt(id, {
    reviewerType: "human", reviewerIdentity: "security-owner",
    requestId: "request-human", workspaceHash: "workspace-now",
    scope: { mode: "full", paths: [], digest: "scope" }
  });
  assert.ok(attempt.attempt >= 2, "the new dispatch sits above every evidenced attempt");
  const history = w.state().reviewHistory;
  assert.equal(w.store.reviewHistoryChainValid(id, history), true);
  assert.equal(w.quarantines().length, 1);
});

test("an intact chain is never quarantined", (t) => {
  const id = "change-intact";
  const w = world(t, id);
  w.reserve("fail");
  w.store.assertReviewDispatchAllowed(id, "ai");
  assert.equal(existsSync(w.attemptsDir), true);
  assert.deepEqual(w.quarantines(), []);
  assert.equal(w.state().reviewHistory.recoveries, undefined);
});

test("a verified sibling never recorded as head is not restored as determinate", (t) => {
  // The recorded head is unverifiable and one or more self-consistent
  // siblings share its attempt number. None was ever the recorded head, so
  // restoring one would reuse a verdict the runtime never accepted.
  for (const siblings of [1, 2]) {
    drainSignals();
    const id = `change-unrecorded-sibling-${siblings}`;
    const w = world(t, id);
    w.reserve("fail");
    const headName = w.file(1);
    const head = readJson(join(w.attemptsDir, headName));
    for (let index = 0; index < siblings; index += 1) {
      const sibling = { ...head, status: "pass", workspaceHash: `workspace-sibling-${index}` };
      delete sibling.digest;
      sibling.digest = stableHash(sibling);
      writeJson(join(w.attemptsDir, `0001-${sibling.digest.slice(0, 12)}.json`), sibling);
    }
    // Rewrite the recorded head's verdict without rehashing.
    writeJson(join(w.attemptsDir, headName), { ...head, status: "pass" });

    const history = w.store.assertReviewDispatchAllowed(id, "human");
    const [recovery] = w.state().reviewHistory.recoveries;
    assert.equal(recovery.determinate, false,
      `${siblings} unrecorded sibling(s) take the placeholder rebuild`);
    assert.equal(w.store.deliveredAiAttempts(id, history).some((attempt) =>
      attempt.status === "pass" || attempt.resultStatus === "pass"), false,
    "an unrecorded sibling's verdict is never reused");
    assert.throws(() => w.store.assertReviewDispatchAllowed(id, "ai"), /REVIEW_ROUTE_COMPLETE/);
  }
});
