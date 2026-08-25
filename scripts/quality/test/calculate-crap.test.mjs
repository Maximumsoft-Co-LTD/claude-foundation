import assert from "node:assert/strict";
import test from "node:test";
import { buildCrapReport, coverageForFunction, crapScore } from "../calculate-crap.mjs";

test("CRAP formula preserves complexity at full coverage", () => {
  assert.equal(crapScore(10, 100), 10);
  assert.equal(crapScore(10, 0), 110);
  assert.equal(crapScore(10, 50), 22.5);
});

test("branch coverage is scoped to the mapped function", () => {
  const coverage = {
    fnMap: { "0": { name: "example", loc: { start: { line: 2 }, end: { line: 8 } } } },
    f: { "0": 1 },
    branchMap: {
      "0": { loc: { start: { line: 3 }, end: { line: 5 } } },
      "1": { loc: { start: { line: 20 }, end: { line: 22 } } }
    },
    b: { "0": [1, 0], "1": [0, 0] }
  };
  assert.deepEqual(coverageForFunction(coverage, { name: "example", line: 2 }), {
    status: "mapped", percent: 50, branchTotal: 2, branchCovered: 1
  });
});

test("report exposes missing coverage instead of silently treating it as zero", () => {
  const report = buildCrapReport({
    complexity: { functions: [{ path: "src/a.mjs", name: "a", line: 1, column: 1, cyclomatic: 3 }] },
    coverageReports: [],
    policy: {
      coverage: { kind: "branch-with-function-fallback" },
      crap: { warning: 20, failure: 30 },
      complexity: { maximumChanged: 30 }
    },
    root: "/repo"
  });
  assert.equal(report.functions[0].status, "unmapped");
  assert.equal(report.functions[0].coveragePercent, null);
  assert.equal(report.summary.unmapped, 1);
});

test("active coverage lanes synthesize zero for production files not loaded by tests", () => {
  const report = buildCrapReport({
    complexity: { functions: [{ path: "src/a.mjs", name: "a", line: 1, column: 1, cyclomatic: 3 }] },
    coverageReports: [],
    coverageLanes: [{ id: "unit", active: true, include: ["src/**/*.mjs"], changedCodeFloor: 80 }],
    policy: {
      coverage: { kind: "branch-with-function-fallback" },
      crap: { warning: 20, failure: 30 },
      complexity: { maximumChanged: 30 }
    },
    root: "/repo"
  });
  assert.equal(report.functions[0].coverageStatus, "synthetic-zero");
  assert.equal(report.functions[0].coveragePercent, 0);
  assert.equal(report.functions[0].coverageLane, "unit");
});

test("active lanes classify V8-omitted callbacks as zero coverage", () => {
  const report = buildCrapReport({
    complexity: { functions: [{
      path: "src/a.mjs", name: "<anonymous@2:10>", line: 2, column: 10,
      endLine: 2, endColumn: 25, cyclomatic: 2
    }] },
    coverageReports: [{
      "/repo/src/a.mjs": { fnMap: {}, f: {}, branchMap: {}, b: {}, statementMap: {}, s: {} }
    }],
    coverageLanes: [{ id: "unit", active: true, include: ["src/**/*.mjs"], changedCodeFloor: 80 }],
    policy: {
      coverage: { kind: "branch-with-function-fallback" },
      crap: { warning: 20, failure: 30 },
      complexity: { maximumChanged: 30 }
    },
    root: "/repo"
  });
  assert.equal(report.functions[0].coverageStatus, "synthetic-zero-unreported-function");
  assert.equal(report.functions[0].coveragePercent, 0);
  assert.equal(report.functions[0].crap, 6);
  assert.equal(report.summary.unmapped, 0);
});

test("nested Istanbul functions map to the smallest containing function", () => {
  const measured = coverageForFunction({
    fnMap: {
      "0": { name: "outer", loc: { start: { line: 1, column: 0 }, end: { line: 20, column: 1 } } },
      "1": { name: "inner", loc: { start: { line: 4, column: 2 }, end: { line: 8, column: 3 } } }
    },
    f: { "0": 1, "1": 0 },
    branchMap: {}, b: {}
  }, { name: "inner", line: 5, column: 3 });
  assert.equal(measured.status, "mapped-function-fallback");
  assert.equal(measured.percent, 0);
});

test("outer function coverage excludes branches owned by nested functions", () => {
  const measured = coverageForFunction({
    fnMap: {
      "0": { name: "outer", loc: { start: { line: 1, column: 0 }, end: { line: 20, column: 1 } } },
      "1": { name: "inner", loc: { start: { line: 10, column: 2 }, end: { line: 15, column: 3 } } }
    },
    f: { "0": 1, "1": 1 },
    branchMap: {
      "0": { loc: { start: { line: 3 }, end: { line: 5 } } },
      "1": { loc: { start: { line: 11 }, end: { line: 13 } } }
    },
    b: { "0": [1, 0], "1": [0, 0] }
  }, { name: "outer", line: 1, column: 1 });
  assert.equal(measured.percent, 50);
  assert.equal(measured.branchTotal, 2);
});

test("AST range fallback maps callbacks that V8 omits from the function map", () => {
  const measured = coverageForFunction({
    fnMap: {}, f: {},
    branchMap: { "0": { loc: { start: { line: 2, column: 10 }, end: { line: 2, column: 20 } } } },
    b: { "0": [1, 0] }, statementMap: {}, s: {}
  }, { name: "<anonymous>", line: 2, column: 5, endLine: 2, endColumn: 25 });
  assert.equal(measured.status, "mapped-range-branch-fallback");
  assert.equal(measured.percent, 50);
});
