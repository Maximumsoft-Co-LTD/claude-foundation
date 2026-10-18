import assert from "node:assert/strict";
import test from "node:test";

import { scratchNoteLine } from "../runtime/workflow/change-lifecycle.mjs";

const PREFIX = "scratch (advisory, approval page): ";
const example = { type: "examples", title: "Rules", rules: [] };

test("a medium change without examples is told it lacks a concrete example", () => {
  assert.equal(scratchNoteLine({ impact: "medium", workType: ["feature"] }),
    `${PREFIX}no concrete example (optional 'examples')`);
  assert.equal(scratchNoteLine({ impact: "medium", workType: ["feature"], examples: [] }),
    `${PREFIX}no concrete example (optional 'examples')`);
});

test("a performance change without any target number is told so", () => {
  const line = scratchNoteLine({ impact: "medium", workType: ["performance"], examples: [example],
    successMeasure: "search feels faster" });
  assert.equal(line, `${PREFIX}no target number (perf example target or 'successMeasure')`);
  assert.equal(scratchNoteLine({ impact: "high", workType: ["feature"], riskSignals: ["performance-slo"],
    examples: [example] }), `${PREFIX}no target number (perf example target or 'successMeasure')`);
  // Either source of a number is enough.
  assert.equal(scratchNoteLine({ impact: "medium", workType: ["performance"], examples: [example],
    successMeasure: "p95 under 200 ms" }), "");
  assert.equal(scratchNoteLine({ impact: "medium", workType: ["performance"],
    examples: [{ type: "perf", title: "p95", metrics: [{ name: "p95", now: 480, target: 200, unit: "ms" }] }] }), "");
  // A metric with no target number does not count.
  assert.match(scratchNoteLine({ impact: "medium", workType: ["performance"],
    examples: [{ type: "perf", title: "p95", metrics: [{ name: "p95", now: 480, target: null, unit: "ms" }] }] }),
  /no target number/);
});

test("a defect, migration, or deprecation without an affected count is told so", () => {
  for (const type of ["bugfix", "migration", "deprecation"])
    assert.equal(scratchNoteLine({ impact: "medium", workType: [type], examples: [example],
      scratch: { asIs: "Staff are refused at the wrong hours" } }), `${PREFIX}no affected count (optional 'scratch.asIs')`, type);
  assert.equal(scratchNoteLine({ impact: "medium", workType: ["bugfix"], examples: [example],
    scratch: { asIs: "Only 27 of 595 bookings get staff" } }), "");
});

test("every gap is listed once in a single line", () => {
  assert.equal(scratchNoteLine({ impact: "high", workType: ["bugfix", "performance"] }),
    `${PREFIX}no concrete example (optional 'examples'); no target number (perf example target or 'successMeasure'); ` +
    "no affected count (optional 'scratch.asIs')");
});

test("low impact and complete drafts raise no scratch NOTE", () => {
  assert.equal(scratchNoteLine({ impact: "low", workType: ["bugfix"] }), "");
  assert.equal(scratchNoteLine({ workType: ["feature"] }), "");
  assert.equal(scratchNoteLine({ impact: "high", workType: ["bugfix"], examples: [example],
    scratch: { asIs: "412 imports stuck in pending" } }), "");
});
