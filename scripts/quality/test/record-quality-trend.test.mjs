import assert from "node:assert/strict";
import test from "node:test";
import { trendPoint } from "../record-quality-trend.mjs";

test("trend point records risk distribution and mutation evidence", () => {
  const point = trendPoint({
    crap: {
      summary: { functions: 3, unmapped: 0 },
      functions: [{ crap: 1 }, { crap: 30 }, { crap: 100 }]
    },
    automatedMutation: { files: { "a.js": { mutants: [{ status: "Killed" }, { status: "Survived" }] } } },
    semanticMutation: { summary: { suites: 4, killed: 4 } },
    commit: "abc"
  });
  assert.equal(point.highCrap, 2);
  assert.equal(point.medianCrap, 30);
  assert.equal(point.p90Crap, 100);
  assert.equal(point.mutationScore, 50);
  assert.equal(point.semanticKillRate, 100);
});
