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

// A path that points at a risk the draft neither declares nor covers is a note.
import { pathRiskNoteLine } from "../runtime/workflow/change-lifecycle.mjs";

const migrationTask = { tasks: [{ paths: ["db/migrations/0042_orders.sql"] }] };

test("an undeclared, uncovered path risk is named with the coverage it lacks", () => {
  const note = pathRiskNoteLine({ ...migrationTask, discovery: { coverage: [] } });
  assert.match(note, /^path risk \(advisory\): db\/migrations\/0042_orders\.sql suggests persisted-data-change /);
  assert.match(note, /no coverage for data-migration, rollout-rollback, recoverability/);
});

test("a declared signal, covered dimensions, or a harmless path give no note", () => {
  assert.equal(pathRiskNoteLine({ ...migrationTask, riskSignals: ["persisted-data-change"] }), "");
  const covered = ["data-migration", "rollout-rollback", "recoverability"].map((dimension) =>
    ({ dimension, status: "covered", covers: ["r"] }));
  assert.equal(pathRiskNoteLine({ ...migrationTask, discovery: { coverage: covered } }), "");
  const notApplicable = covered.map((row) => ({ dimension: row.dimension, status: "not-applicable", rationale: "browser only" }));
  assert.equal(pathRiskNoteLine({ ...migrationTask, discovery: { coverage: notApplicable } }), "");
  assert.equal(pathRiskNoteLine({ tasks: [{ paths: ["src/util.mjs"] }] }), "");
  assert.equal(pathRiskNoteLine({}), "");
});

test("only the uncovered part of a path risk is named", () => {
  const partial = [{ dimension: "data-migration", status: "covered", covers: ["r"] }];
  const note = pathRiskNoteLine({ ...migrationTask, discovery: { coverage: partial } });
  assert.match(note, /no coverage for rollout-rollback, recoverability\b/);
  assert.doesNotMatch(note, /no coverage for data-migration/);
});
