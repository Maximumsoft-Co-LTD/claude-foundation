import assert from "node:assert/strict";
import test from "node:test";
import { renderSummary } from "../render-quality-summary.mjs";

test("summary prioritizes the highest CRAP findings", () => {
  const markdown = renderSummary({
    coverageKind: "branch-with-function-fallback",
    summary: { functions: 2, pass: 0, warn: 1, fail: 1, unmapped: 0 },
    functions: [
      { path: "a.mjs", line: 1, name: "a", cyclomatic: 5, coveragePercent: 50, crap: 8.13, status: "warn" },
      { path: "b.mjs", line: 2, name: "b", cyclomatic: 12, coveragePercent: 0, crap: 156, status: "fail" }
    ]
  }, {
    automatedMutation: {
      files: { "a.mjs": { mutants: [{ status: "Killed" }, { status: "Survived" }] } }
    },
    semanticMutation: { summary: { suites: 1, killed: 1, mutants: 2, survived: 0, invalid: 0 } }
  });
  assert.ok(markdown.indexOf("b.mjs") < markdown.indexOf("a.mjs"));
  assert.match(markdown, /legacy findings remain debt inventory/);
  assert.match(markdown, /Score: 50.00%/);
  assert.match(markdown, /Semantic mutation/);
  assert.match(markdown, /Suites killed: 1/);
  assert.match(markdown, /Mutants: 2/);
});
