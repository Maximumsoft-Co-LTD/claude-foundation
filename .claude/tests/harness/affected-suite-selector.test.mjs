import assert from "node:assert/strict";
import test from "node:test";
import { selectAffectedSuites } from "../affected-suite-selector.mjs";

const labels = [
  "runtime syntax", "run-all process control", "composition-root wiring",
  "architecture boundaries", "single-source tables", "dashboard contracts",
  "configured reviewer adapters", "feedback review",
  "bounded review repair closure", "external operation handoff",
  "harness contracts (evidence proof a1)",
  "harness contracts (evidence proof a2)",
  "harness contracts (evidence proof b)",
  "harness contracts (evidence proof c)", "proof loop end to end",
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
    "harness contracts (evidence proof a1)", "land surface",
    "land surface mutation", "target drift mutation", "evidence binding mutation"
  ]) assert.ok(selected.includes(expected), expected);
});

test("cross-cutting protocol edits expand to the full supplied suite set", () => {
  const { selected } = selectAffectedSuites([
    ".claude/harness/protocol.json"
  ], labels);
  assert.deepEqual(new Set(selected), new Set(labels));
});
