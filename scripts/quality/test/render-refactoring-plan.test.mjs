import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRefactoringPlan, renderIndex, renderSurface
} from "../render-refactoring-plan.mjs";

const fn = (overrides) => ({
  path: ".claude/harness/runtime/example.mjs", line: 1, endLine: 5, column: 1,
  name: "example", cyclomatic: 1, coveragePercent: 100,
  coverageStatus: "mapped", crap: 1, status: "pass", changedCodeFloor: 70,
  ...overrides
});

test("assigns every function exactly one risk-based action", () => {
  const crap = {
    repositoryCommit: "abc123", generatedAt: "2026-08-25T00:00:00Z",
    coverageKind: "branch", includedPaths: ["**/*.mjs"], excludedPaths: ["**/test/**"],
    functions: [
      fn({ name: "critical", cyclomatic: 60, crap: 3600, status: "fail" }),
      fn({ name: "warning", line: 10, endLine: 12, crap: 25, status: "warn", coveragePercent: 50 }),
      fn({ name: "gap", line: 20, endLine: 22, crap: 0, status: "unmapped", coveragePercent: null }),
      fn({ name: "covered", line: 30, endLine: 32 }),
      fn({ name: "weakCoverage", line: 40, endLine: 42, coveragePercent: 20, crap: 1 })
    ]
  };
  const plan = buildRefactoringPlan({ crap });
  assert.equal(plan.summary.functions, 5);
  assert.deepEqual(plan.functions.map((row) => row.action).sort(), [
    "coverage-mapping", "critical-refactor", "preserve",
    "test-and-simplify", "test-hardening-when-touched"
  ].sort());
  assert.equal(new Set(plan.functions.map((row) => row.id)).size, 5);
  assert.match(renderIndex(plan), /Production functions planned: 5/);
  assert.equal((renderSurface(plan, "runtime").match(/\| RF-/g) || []).length, 5);
});

test("binds survived and no-coverage mutants to their containing function", () => {
  const crap = {
    repositoryCommit: "abc123", generatedAt: "2026-08-25T00:00:00Z",
    coverageKind: "branch", includedPaths: [], excludedPaths: [],
    functions: [fn({ line: 10, endLine: 20 })]
  };
  const mutationReports = [{ report: { files: {
    ".claude/harness/runtime/example.mjs": { mutants: [
      { status: "Survived", location: { start: { line: 12 } } },
      { status: "NoCoverage", location: { start: { line: 18 } } },
      { status: "Survived", location: { start: { line: 30 } } }
    ] }
  } } }];
  const plan = buildRefactoringPlan({ crap, mutationReports });
  assert.deepEqual(plan.functions[0].mutationGaps, { survived: 1, noCoverage: 1 });
});
