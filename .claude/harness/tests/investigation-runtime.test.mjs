import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createInvestigationRuntime, validateInvestigationBinding
} from "../runtime/workflow/investigation-runtime.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "investigation-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "openspec", "investigations"), { recursive: true });
  writeFileSync(join(root, "evidence.md"), "The retry path preserves the latest revision.\n");
  const recordPath = join(root, "openspec", "investigations", "retry-race.json");
  const record = {
    version: 1,
    id: "retry-race",
    problem: "Why can a retry overwrite a newer revision?",
    mode: "analyze",
    sources: ["evidence.md"],
    facts: [{
      key: "latest-revision",
      statement: "The retry path must preserve the latest revision.",
      sources: ["evidence.md"]
    }],
    hypotheses: [{
      key: "stale-write", statement: "A stale write bypasses revision checking.",
      status: "supported", factKeys: ["latest-revision"]
    }],
    decisions: [],
    conclusion: { status: "ready-for-change", summary: "Require revision checking." },
    changeIntent: "Reject stale profile writes"
  };
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
  const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  const runtime = createInvestigationRuntime({
    root, readJson, writeJson, now: () => "2026-09-15T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });
  return { root, record, recordPath, runtime, readJson };
}

function quiet(operation) {
  const prior = console.log;
  console.log = () => {};
  try { return operation(); } finally { console.log = prior; }
}

test("persists deterministic investigation evidence and emits a Change-bound handoff", (t) => {
  const value = fixture(t);
  const result = quiet(() => value.runtime.inspectInvestigation(
    "openspec/investigations/retry-race.json"));
  assert.equal(result.action, "DONE");
  assert.equal(result.owner, "harness");
  assert.equal(result.handoff.id, "retry-race");
  assert.equal(result.handoff.outcome, "ready-for-change");
  assert.equal(result.metrics.factCount, 1);
  assert.equal(result.metrics.supportedHypothesisCount, 1);
  assert.deepEqual(validateInvestigationBinding({
    projectRoot: value.root, binding: result.handoff
  }), []);

  writeFileSync(join(value.root, "evidence.md"), "The source changed after handoff.\n");
  assert.match(validateInvestigationBinding({
    projectRoot: value.root, binding: result.handoff
  }).join("\n"), /sources changed/);
  writeFileSync(join(value.root, "evidence.md"),
    "The retry path preserves the latest revision.\n");

  const state = value.readJson(join(value.root, result.state.path));
  assert.equal(state.path, ".foundation/investigations/retry-race.json");
  state.facts[0].statement = "tampered";
  writeFileSync(join(value.root, result.state.path), `${JSON.stringify(state, null, 2)}\n`);
  assert.match(validateInvestigationBinding({
    projectRoot: value.root, binding: result.handoff
  }).join("\n"), /digest is stale/);
});

test("new repository sources require an agent acknowledgement before DONE", (t) => {
  const value = fixture(t);
  writeFileSync(join(value.root, "second.md"),
    "A retry can overwrite a newer revision without a version check.\n");
  writeFileSync(value.recordPath, `${JSON.stringify(value.record, null, 2)}\n`);
  const result = quiet(() => value.runtime.inspectInvestigation(
    "openspec/investigations/retry-race.json"));
  assert.equal(result.action, "EDIT");
  assert.equal(result.owner, "agent");
  assert.equal(result.investigation.kind, "inspect-sources");
  assert.ok(result.investigation.paths.includes("second.md"));
  assert.equal(result.handoff, null);
});

test("hypotheses, facts, and recommendations fail closed on invalid bindings", (t) => {
  const value = fixture(t);
  value.record.hypotheses[0].factKeys = ["invented"];
  value.record.decisions = [{
    key: "policy", status: "open", question: "Which policy?",
    alternatives: ["strict", "compatible"], recommended: "strict",
    recommendationFactKeys: ["invented"]
  }];
  writeFileSync(value.recordPath, `${JSON.stringify(value.record, null, 2)}\n`);
  const result = quiet(() => value.runtime.inspectInvestigation(
    "openspec/investigations/retry-race.json"));
  assert.equal(result.action, "EDIT");
  assert.match(result.investigation.issues.join("\n"), /unknown fact 'invented'/);
});

test("Change handoff validation rejects traversing investigation identities", (t) => {
  const value = fixture(t);
  assert.deepEqual(validateInvestigationBinding({
    projectRoot: value.root,
    binding: { version: 1, id: "../escape", statePath: ".foundation/escape.json" }
  }), ["investigation binding id is invalid"]);
});

test("repeated unchanged work records a bounded no-progress recovery route", (t) => {
  const value = fixture(t);
  value.record.hypotheses[0].status = "open";
  value.record.hypotheses[0].factKeys = [];
  writeFileSync(value.recordPath, `${JSON.stringify(value.record, null, 2)}\n`);
  const route = "claude-foundation investigate openspec/investigations/retry-race.json";
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1)
    result = quiet(() => value.runtime.inspectInvestigation(
      "openspec/investigations/retry-race.json"));
  assert.equal(result.noProgress.count, 3);
  assert.equal(result.noProgress.boundaryReached, true);
  assert.equal(result.noProgress.resume, route);
});

test("comparison requires grounded options, a selection, and bounded prototype paths", (t) => {
  const value = fixture(t);
  value.record.mode = "compare";
  value.record.options = ["optimistic", "last-write", "merge"].map((key) => ({
    key, summary: key, findings: [`${key} is viable`], tradeoffs: [`${key} tradeoff`],
    sources: ["evidence.md"],
    prototypePaths: [`.foundation/prototypes/retry-race/${key}.html`]
  }));
  value.record.selection = {
    optionKey: "optimistic", reason: "Preserves the latest revision.",
    rejected: [
      { optionKey: "last-write", reason: "Can lose a newer write." },
      { optionKey: "merge", reason: "Adds unsupported conflict semantics." }
    ]
  };
  writeFileSync(value.recordPath, `${JSON.stringify(value.record, null, 2)}\n`);
  assert.equal(quiet(() => value.runtime.inspectInvestigation(
    "openspec/investigations/retry-race.json")).action, "DONE");

  value.record.options[0].prototypePaths = ["src/escape.html"];
  value.record.selection.rejected = [];
  writeFileSync(value.recordPath, `${JSON.stringify(value.record, null, 2)}\n`);
  const blocked = quiet(() => value.runtime.inspectInvestigation(
    "openspec/investigations/retry-race.json"));
  assert.equal(blocked.action, "EDIT");
  assert.match(blocked.investigation.issues.join("\n"), /prototypePaths must stay under/);
  assert.match(blocked.investigation.issues.join("\n"), /must explain option/);
});
