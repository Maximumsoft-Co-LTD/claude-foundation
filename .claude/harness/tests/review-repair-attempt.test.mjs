import assert from "node:assert/strict";
import test from "node:test";

import {
  createRepairClosureAttempt,
  matchingRepairClosure,
  recordRepairClosureAttemptOperation,
  repairClosureSource,
  repairClosureVerifiedFindingIds
} from "../runtime/evidence/review-attempt-store.mjs";

const hash = (value) => JSON.stringify(value);
const fail = (message) => { throw new Error(message); };
const source = {
  digest: "ai-final", resultStatus: "fail", workspaceHash: "before",
  scope: { mode: "delta" }, packetDigest: "packet",
  findings: [
    { id: "F-2", severity: "major" },
    { id: "F-1", severity: "blocker" },
    { id: "F-3", severity: "minor" }
  ]
};
const details = {
  sourceAttemptDigest: "ai-final", workspaceHash: "after",
  scopeDigest: "scope", paths: ["b.js", "a.js", "b.js"],
  verifiedFindingIds: ["F-2", "F-1", "F-1"],
  evidenceBindings: [{ provider: "test", digest: "evidence" }]
};

test("matching repair closure requires the complete deterministic identity", () => {
  const current = {
    reviewerType: "deterministic", sourceAttemptDigest: "ai-final",
    workspaceHash: "after", scope: { digest: "scope" },
    evidenceBindings: details.evidenceBindings
  };
  assert.equal(matchingRepairClosure(current, details, hash), current);
  for (const changed of [
    { reviewerType: "ai" }, { sourceAttemptDigest: "other" },
    { workspaceHash: "other" }, { scope: { digest: "other" } },
    { evidenceBindings: [] }
  ]) assert.equal(matchingRepairClosure({ ...current, ...changed }, details, hash), null);
});

test("repair closure source requires the failed second AI delta and changed workspace", () => {
  assert.equal(repairClosureSource([{ digest: "first" }, source], details, fail), source);
  const invalid = [
    [[source], details],
    [[{}, { ...source, digest: "other" }], details],
    [[{}, { ...source, resultStatus: "pass" }], details],
    [[{}, { ...source, scope: { mode: "full" } }], details]
  ];
  for (const [delivered, value] of invalid)
    assert.throws(() => repairClosureSource(delivered, value, fail), /failed final AI delta/);
  assert.throws(() => repairClosureSource([{}, source], {
    ...details, workspaceHash: "before"
  }, fail), /changed workspace/);
});

test("verified findings close every blocker and major exactly once", () => {
  assert.deepEqual(repairClosureVerifiedFindingIds(source, details, fail), ["F-1", "F-2"]);
  assert.throws(() => repairClosureVerifiedFindingIds(source, {
    ...details, verifiedFindingIds: ["F-1"]
  }, fail), /close every blocker\/major/);
  assert.throws(() => repairClosureVerifiedFindingIds({
    ...source, findings: [{ id: "minor", severity: "minor" }]
  }, details, fail), /close every blocker\/major/);
});

test("repair closure builder emits the versioned immutable record", () => {
  let tick = 0;
  const attempt = createRepairClosureAttempt({
    now: () => ++tick,
    stableHash: () => "digest"
  }, "change", { totalAttempts: 2, chainHead: "head" }, source, details,
  ["F-1", "F-2"]);
  assert.equal(attempt.version, 4);
  assert.equal(attempt.attempt, 3);
  assert.equal(attempt.digest, "digest");
  assert.deepEqual(attempt.scope.paths, ["a.js", "b.js"]);
  assert.equal(attempt.packetDigest, "packet");
  assert.equal(attempt.priorChainHead, "head");
  assert.equal(attempt.timestamp, 1);
  assert.equal(attempt.completedAt, 2);
  const defaults = createRepairClosureAttempt({
    now: () => 1, stableHash: () => "default"
  }, "change", {}, { ...source, packetDigest: "" }, {
    ...details, paths: undefined
  }, []);
  assert.equal(defaults.attempt, 1);
  assert.equal(defaults.packetDigest, null);
  assert.equal(defaults.priorChainHead, null);
});

function operationFixture() {
  const state = {};
  const writes = [];
  const saves = [];
  const history = { totalAttempts: 2, chainHead: "head" };
  const context = {
    evidenceVault: "/vault",
    loadRuntime: () => state,
    saveRuntime: (value) => saves.push(value),
    stableHash: (value) => value?.version === 4 ? "closure-digest" : hash(value),
    writeJson: (...args) => writes.push(args),
    now: () => 10,
    fail,
    reviewHistoryState: () => history,
    reviewHistoryChainValid: () => true,
    reviewAttempts: () => [{ reviewerType: "ai" }],
    deliveredAiAttempts: () => [{ digest: "first" }, source]
  };
  return { context, state, writes, saves, history };
}

test("repair closure operation persists the next chained attempt", () => {
  const fixture = operationFixture();
  const attempt = recordRepairClosureAttemptOperation(
    fixture.context, "change", details);
  assert.equal(attempt.digest, "closure-digest");
  assert.match(fixture.writes[0][0], /0003-closure-dige\.json$/);
  assert.equal(fixture.state.reviewHistory.totalAttempts, 3);
  assert.equal(fixture.state.reviewHistory.chainHead, "closure-digest");
  assert.equal(fixture.saves.length, 1);
});

test("repair closure operation preserves idempotency and fails closed", () => {
  const duplicate = operationFixture();
  const current = {
    reviewerType: "deterministic", sourceAttemptDigest: "ai-final",
    workspaceHash: "after", scope: { digest: "scope" },
    evidenceBindings: details.evidenceBindings
  };
  duplicate.context.reviewAttempts = () => [current];
  assert.equal(recordRepairClosureAttemptOperation(
    duplicate.context, "change", details), current);
  assert.equal(duplicate.writes.length, 0);

  const corrupt = operationFixture();
  corrupt.context.reviewHistoryChainValid = () => false;
  assert.throws(() => recordRepairClosureAttemptOperation(
    corrupt.context, "change", details), /valid attempt history/);

  const missing = operationFixture();
  assert.throws(() => recordRepairClosureAttemptOperation(
    missing.context, "change", { ...details, evidenceBindings: [] }),
  /current evidence bindings/);
});
