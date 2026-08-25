import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMutationDelta, mutationCounts } from "../evaluate-mutation-delta.mjs";

function report(statuses) {
  return { files: { "a.js": { mutants: statuses.map((status) => ({ status })) } } };
}

test("mutation counts use killed and timeout in the effective score", () => {
  assert.deepEqual(mutationCounts(report(["Killed", "Timeout", "Survived", "NoCoverage"])), {
    counts: { killed: 1, timeout: 1, survived: 1, noCoverage: 1 }, score: 50
  });
});

test("mutation ratchet rejects score regression and new uncovered mutants", () => {
  const result = evaluateMutationDelta(report(["Killed", "Survived", "NoCoverage"]), {
    counts: { killed: 2, timeout: 0, survived: 1, noCoverage: 0 }, score: 66.67
  }, { mutation: { automated: {
    mode: "enforce", rejectNewNoCoverage: true, rejectScoreRegression: true
  } } });
  assert.equal(result.status, "fail");
  assert.equal(result.reasons.length, 2);
});

test("mutation ratchet requires the versioned snapshot to advance with improvements", () => {
  const result = evaluateMutationDelta(report(["Killed", "Killed"]), {
    counts: { killed: 1, timeout: 0, survived: 1, noCoverage: 0 }, score: 50
  }, { mutation: { automated: {
    mode: "enforce", rejectNewNoCoverage: true, rejectScoreRegression: true,
    requireBaselineSnapshot: true
  } } });
  assert.equal(result.status, "fail");
  assert.match(result.reasons.join(" "), /baseline does not match/);
});
