import assert from "node:assert/strict";
import test from "node:test";
import { evaluateChangedFunctions, parseChangedLines } from "../evaluate-changed-quality.mjs";

test("git zero-context hunks map repository paths to changed lines", () => {
  const changed = parseChangedLines([
    "diff --git a/src/a.mjs b/src/a.mjs",
    "--- a/src/a.mjs",
    "+++ b/src/a.mjs",
    "@@ -2,0 +3,2 @@",
    "+one",
    "+two"
  ].join("\n"));
  assert.deepEqual(changed.get("src/a.mjs"), [{ start: 3, end: 4 }]);
});

test("changed functions fail on unmapped coverage or configured thresholds", () => {
  const result = evaluateChangedFunctions({ functions: [
    { path: "src/a.mjs", name: "a", line: 2, endLine: 8, cyclomatic: 31, coveragePercent: 100, crap: 31 },
    { path: "src/b.mjs", name: "b", line: 1, endLine: 2, cyclomatic: 1, coveragePercent: null, crap: null }
  ] }, new Map([
    ["src/a.mjs", [{ start: 5, end: 5 }]],
    ["src/b.mjs", [{ start: 1, end: 1 }]]
  ]), {
    crap: { mode: "report-only", failure: 30 },
    complexity: { maximumChanged: 30 }
  });
  assert.equal(result.summary.fail, 2);
  assert.match(result.functions[0].reasons.join(" "), /cyclomatic 31/);
  assert.deepEqual(result.functions[1].reasons, ["coverage is unmapped"]);
});

test("merge-base comparison rejects regressions but preserves unchanged legacy debt", () => {
  const policy = {
    crap: { mode: "enforce", failure: 30, rejectRegression: true },
    complexity: { maximumChanged: 30 }
  };
  const current = { functions: [
    { path: "src/a.mjs", name: "legacy", line: 2, endLine: 8, cyclomatic: 10,
      coveragePercent: 50, changedCodeFloor: null, crap: 22.5 },
    { path: "src/b.mjs", name: "regressed", line: 2, endLine: 8, cyclomatic: 10,
      coveragePercent: 40, changedCodeFloor: null, crap: 31.6 }
  ] };
  const baseReport = { functions: [
    { path: "src/a.mjs", name: "legacy", line: 1, cyclomatic: 10, coveragePercent: 50, crap: 22.5 },
    { path: "src/b.mjs", name: "regressed", line: 1, cyclomatic: 10, coveragePercent: 50, crap: 22.5 }
  ] };
  const changed = new Map([["src/a.mjs", [{ start: 3, end: 3 }]], ["src/b.mjs", [{ start: 3, end: 3 }]]]);
  const result = evaluateChangedFunctions(current, changed, policy, { baseReport });
  assert.equal(result.functions[0].changedStatus, "pass");
  assert.match(result.functions[1].reasons.join(" "), /regressed/);
});

test("new changed functions enforce CRAP and coverage floors", () => {
  const result = evaluateChangedFunctions({ functions: [{
    path: "src/new.mjs", name: "created", line: 1, endLine: 4, cyclomatic: 8,
    coveragePercent: 0, changedCodeFloor: 80, crap: 72
  }] }, new Map([["src/new.mjs", [{ start: 1, end: 1 }]]]), {
    crap: { mode: "enforce", failure: 30, rejectRegression: true }, complexity: { maximumChanged: 30 }
  }, { baseReport: { functions: [] } });
  assert.equal(result.functions[0].changeKind, "new");
  assert.deepEqual(result.functions[0].reasons, ["coverage 0% is below 80%", "CRAP 72 is at or above 30"]);
});
