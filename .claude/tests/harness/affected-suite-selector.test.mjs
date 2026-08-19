import assert from "node:assert/strict";
import test from "node:test";
import {
  selectAffectedSuites, suiteRunnerLabels
} from "../affected-suite-selector.mjs";

const labels = [
  "runtime syntax", "run-all process control", "composition-root wiring",
  "architecture boundaries", "single-source tables", "dashboard contracts",
  "configured reviewer adapters", "feedback review",
  "bounded review repair closure", "external operation handoff",
  "harness contracts (evidence recovery)",
  "harness contracts (evidence telemetry)",
  "harness contracts (evidence execution)",
  "harness contracts (evidence lifecycle)",
  "harness contracts (evidence review)",
  "harness contracts (evidence binding)",
  "harness contracts (evidence CI)",
  "harness contracts (evidence browser)",
  "harness contracts (evidence cache)",
  "harness contracts (evidence waiver)",
  "harness contracts (evidence service)", "proof loop end to end",
  "risk-tiered review contract", "review guard reconciliation",
  "land surface", "land surface mutation", "target drift mutation",
  "evidence binding mutation", "harness contracts (sandbox land)",
  "target drift", "spec sync land gate", "model drift land gate",
  "workspace surface"
];

test("a reviewer adapter edit selects review dependencies, not unrelated UI", () => {
  const { selected } = selectAffectedSuites([
    ".claude/harness/runtime/evidence/configured-reviewer.mjs"
  ], labels);
  assert.ok(selected.includes("configured reviewer adapters"));
  assert.ok(selected.includes("feedback review"));
  assert.ok(selected.includes("bounded review repair closure"));
  assert.equal(selected.includes("dashboard contracts"), false);
});

test("state identity edits include proof, land, and mutation detectors", () => {
  const { selected } = selectAffectedSuites([
    ".claude/harness/runtime/core/state-runtime.mjs"
  ], labels);
  for (const expected of [
    "harness contracts (evidence lifecycle)", "land surface",
    "land surface mutation", "target drift mutation", "evidence binding mutation"
  ]) assert.ok(selected.includes(expected), expected);
});

test("cross-cutting protocol edits expand to the full supplied suite set", () => {
  const { selected } = selectAffectedSuites([
    ".claude/harness/protocol.json"
  ], labels);
  assert.deepEqual(new Set(selected), new Set(labels));
});

test("the registry selects a suite whose label differs from its runner", () => {
  const registry = [
    'actionable validation and telemetry|sh "$HERE/harness/run-actionable-validation-telemetry-tests.sh"',
    'proof service lifecycle|node "$HERE/harness/run-service-session-tests.mjs"'
  ].join("\n");
  const { selected, reasons } = selectAffectedSuites([
    ".claude/tests/harness/run-actionable-validation-telemetry-tests.sh"
  ], [...labels, "actionable validation and telemetry", "proof service lifecycle"], registry);
  assert.ok(selected.includes("actionable validation and telemetry"));
  assert.equal(selected.includes("proof service lifecycle"), false);
  assert.match(reasons.get("actionable validation and telemetry")[0], /registered runner/);
});

test("a shared registered runner selects every suite that invokes it", () => {
  const registry = [
    'harness contracts (sandbox land)|sh "$HERE/harness/run-harness-tests.sh" sandbox-land',
    'harness contracts (change policy)|sh "$HERE/harness/run-harness-tests.sh" change-policy',
    'configured reviewer adapters|node "$ROOT/.claude/harness/tests/configured-reviewer.test.mjs"'
  ].join("\n");
  const mapped = suiteRunnerLabels(registry);
  assert.deepEqual(mapped.get(".claude/tests/harness/run-harness-tests.sh"), [
    "harness contracts (sandbox land)", "harness contracts (change policy)"
  ]);
  assert.deepEqual(mapped.get(".claude/harness/tests/configured-reviewer.test.mjs"), [
    "configured reviewer adapters"
  ]);
});

test("domain matches do not suppress runner stem self-selection", () => {
  const selfLabel = "authority runtime regression";
  const { selected } = selectAffectedSuites([
    ".claude/tests/harness/run-authority-runtime-regression-tests.mjs"
  ], [...labels, selfLabel]);
  assert.ok(selected.includes(selfLabel));
});
