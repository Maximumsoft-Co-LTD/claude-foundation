import assert from "node:assert/strict";
import test from "node:test";
import { classifyLegacyResult, validMutationV2 } from "../collect-semantic-mutation.mjs";

test("legacy semantic mutation requires both a clean exit and behavioral kill marker", () => {
  assert.deepEqual(classifyLegacyResult(0, "FOUNDATION_MUTATION_RESULT=behavioral-kill\n"), {
    marker: "behavioral-kill", result: "killed"
  });
  assert.equal(classifyLegacyResult(1, "FOUNDATION_MUTATION_RESULT=behavioral-kill\n").result, "invalid");
  assert.equal(classifyLegacyResult(0, "FOUNDATION_MUTATION_RESULT=survived\n").result, "survived");
});

test("mutation-v2 rejects compile failures, wrong killers, missing catalog IDs and failed processes", () => {
  const declared = [{ id: "MUT-A" }];
  const valid = { mutants: [{ id: "MUT-A", applied: true, compiled: true, result: "killed",
    expectedKiller: "CASE-A", killedBy: "CASE-A", restored: true }] };
  assert.equal(validMutationV2(valid, declared, 0), true);
  assert.equal(validMutationV2({ mutants: [{ ...valid.mutants[0], compiled: false }] }, declared, 0), false);
  assert.equal(validMutationV2({ mutants: [{ ...valid.mutants[0], killedBy: "CASE-B" }] }, declared, 0), false);
  assert.equal(validMutationV2(valid, [{ id: "MUT-MISSING" }], 0), false);
  assert.equal(validMutationV2(valid, declared, 1), false);
});
