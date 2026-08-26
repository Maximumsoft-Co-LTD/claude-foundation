import assert from "node:assert/strict";
import test from "node:test";
import {
  collectPlaywrightAttachments,
  playwrightAnnotationClaims,
  playwrightReportSummary,
  playwrightTestOutcome,
  recordPlaywrightTest,
  visitPlaywrightReport
} from "../runtime/evidence/evidence-results.mjs";

test("Playwright result helpers classify annotations and terminal outcomes", () => {
  assert.deepEqual(playwrightAnnotationClaims(null), []);
  assert.deepEqual(playwrightAnnotationClaims([
    { type: "claim", description: "claim:a" },
    { type: "note", description: "ignored" },
    { type: "claim" }, null
  ]), ["claim:a"]);
  assert.deepEqual(playwrightTestOutcome([{ status: "passed" }]),
    { failed: false, skipped: false });
  assert.deepEqual(playwrightTestOutcome([{ status: "skipped" }, { status: "skipped" }]),
    { failed: false, skipped: true });
  for (const status of ["failed", "timedOut", "interrupted"])
    assert.deepEqual(playwrightTestOutcome([{ status }, { status: "skipped" }]),
      { failed: true, skipped: false });
  assert.deepEqual(playwrightTestOutcome([{}, null]), { failed: false, skipped: false });
});

test("playwrightReportSummary carries claims only to tests that ran", () => {
  const report = {
    annotations: [{ type: "claim", description: "suite" }],
    suites: [{
      annotations: [{ type: "claim", description: "nested" }],
      specs: [
        {
          annotations: [{ type: "claim", description: "passed" }],
          attachments: [{ path: "trace.zip" }, {}, null],
          results: [{ status: "passed" }]
        },
        {
          annotations: [{ type: "claim", description: "skipped-only" }],
          attachments: [{ path: "skip.png" }],
          results: [{ status: "skipped" }]
        },
        {
          annotations: [{ type: "claim", description: "suite" }],
          results: [{ status: "failed" }, { status: "skipped" }]
        }
      ]
    }]
  };
  report.self = report;
  assert.deepEqual(playwrightReportSummary(report), {
    claims: ["nested", "passed", "suite"],
    attachments: ["skip.png", "trace.zip"],
    skippedClaims: ["skipped-only"],
    tests: 3, failed: 1, skipped: 1
  });
  assert.deepEqual(playwrightReportSummary(null), {
    claims: [], attachments: [], skippedClaims: [], tests: 0, failed: 0, skipped: 0
  });
});

test("visitPlaywrightReport ignores repeated object identities", () => {
  const testCase = {
    annotations: [{ type: "claim", description: "once" }],
    results: [{ status: "passed" }]
  };
  const state = {
    claims: new Set(), attachments: new Set(), skippedClaims: new Set(),
    tests: 0, failed: 0, skipped: 0
  };
  visitPlaywrightReport({ children: [testCase, testCase] }, [], state);
  assert.equal(state.tests, 1);
  assert.deepEqual([...state.claims], ["once"]);
  collectPlaywrightAttachments(null, state.attachments);
  recordPlaywrightTest(null, [], state);
  assert.equal(state.tests, 1);
});
