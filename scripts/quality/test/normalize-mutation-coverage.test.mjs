import assert from "node:assert/strict";
import test from "node:test";
import { mutantExecuted, normalizeMutationCoverage } from "../normalize-mutation-coverage.mjs";

const coverage = {
  statementMap: {
    "0": { start: { line: 2, column: 0 }, end: { line: 2, column: 20 } },
    "1": { start: { line: 3, column: 0 }, end: { line: 3, column: 20 } }
  },
  s: { "0": 1, "1": 0 }, fnMap: {}, f: {}, branchMap: {}, b: {}
};

test("independent coverage distinguishes executed survivors from uncovered mutants", () => {
  assert.equal(mutantExecuted(coverage, { location: { start: { line: 2, column: 5 } } }), true);
  assert.equal(mutantExecuted(coverage, { location: { start: { line: 3, column: 5 } } }), false);
  const report = normalizeMutationCoverage({ files: { "src/a.js": { mutants: [
    { status: "Survived", location: { start: { line: 2, column: 5 } } },
    { status: "Survived", location: { start: { line: 3, column: 5 } } }
  ] } } }, [{ "/repo/src/a.js": coverage }], "/repo");
  assert.equal(report.files["src/a.js"].mutants[0].status, "Survived");
  assert.equal(report.files["src/a.js"].mutants[1].status, "NoCoverage");
  assert.equal(report.foundationCoverageNormalization.reclassified, 1);
});
