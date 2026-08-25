import assert from "node:assert/strict";
import test from "node:test";
import { qualityFailures } from "../enforce-quality.mjs";

test("unified enforcement fails closed on missing or incomplete evidence", () => {
  assert.equal(qualityFailures({ changed: null, automatedMutation: null, semanticMutation: null }).length, 3);
  assert.deepEqual(qualityFailures({
    changed: { baselineAvailable: true, summary: { fail: 0 } },
    automatedMutation: { status: "pass", reasons: [], current: { coverageNormalized: true } },
    semanticMutation: { summary: { suites: 5, killed: 5, survived: 0, invalid: 0 } }
  }), []);
});
