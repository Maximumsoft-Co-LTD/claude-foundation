import assert from "node:assert/strict";
import {
  mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createInvestigationRuntime, validateInvestigationBinding
} from "../runtime/workflow/investigation-runtime.mjs";

function fixture(t, options = {}) {
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
    setOperationChangeId: options.setOperationChangeId,
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
  assert.equal(result.report.status, "current");
  const report = readFileSync(join(value.root, result.report.path), "utf8");
  assert.match(report, /Require revision checking/);
  assert.match(report, /Source-grounded facts/);
  assert.match(report, /\.\.\/\.\.\/evidence\.md/);
  assert.match(report, /Supported/);
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

test("generated reports do not enter discovery or invalidate handoffs on repeated inspection", (t) => {
  const value = fixture(t);
  const inspect = () => quiet(() => value.runtime.inspectInvestigation("openspec/investigations/retry-race.json"));
  const first = inspect();
  const second = inspect();
  assert.equal(second.action, "DONE");
  assert.equal(first.handoff.sourceDigest, second.handoff.sourceDigest);
  assert.deepEqual(validateInvestigationBinding({ projectRoot: value.root, binding: second.handoff }), []);
  assert(!value.readJson(join(value.root, second.state.path)).repository.selectedSources.some((path) => path.endsWith(".report.md")));
});

test("Thai reports retain open hypotheses, choices and authored notes", (t) => {
  const value = fixture(t);
  value.record.problem = "ทำไมการลองใหม่จึงเขียนทับข้อมูลล่าสุด";
  value.record.conclusion = { status: "investigating", summary: "ยังต้องตรวจสอบเงื่อนไข revision" };
  value.record.hypotheses[0].status = "open";
  writeFileSync(value.recordPath, JSON.stringify(value.record));
  const note = join(value.root, "openspec/investigations/retry-race.md");
  writeFileSync(note, "บันทึกของผู้ใช้\n");
  const result = quiet(() => value.runtime.inspectInvestigation("openspec/investigations/retry-race.json"));
  const report = readFileSync(join(value.root, result.report.path), "utf8");
  assert.match(report, /รายงานการสำรวจปัญหา/);
  assert.match(report, /ยังไม่สมบูรณ์/);
  assert.match(report, /ยังไม่สรุป/);
  assert.match(report, /ยังต้องตรวจสอบเงื่อนไข revision/);
  assert.equal(readFileSync(note, "utf8"), "บันทึกของผู้ใช้\n");
});

test("report path conflicts preserve evidence and recover after resolving the destination", (t) => {
  const value = fixture(t);
  const path = join(value.root, "openspec/investigations/retry-race.report.md");
  const external = join(value.root, "user-note.txt");
  writeFileSync(external, "owned by user\n");
  symlinkSync(external, path);
  const inspect = () => quiet(() => value.runtime.inspectInvestigation("openspec/investigations/retry-race.json"));
  const blocked = inspect();
  assert.equal(blocked.action, "EDIT");
  assert.equal(blocked.boundary, "investigation-report");
  assert.equal(blocked.report.path, null);
  assert.equal(blocked.handoff, null);
  assert.equal(readFileSync(external, "utf8"), "owned by user\n");
  const preserved = value.readJson(join(value.root, blocked.state.path));
  assert.deepEqual(preserved.facts, value.record.facts);
  rmSync(path); rmSync(external);
  const resumed = inspect();
  assert.equal(resumed.action, "DONE");
  assert.equal(resumed.report.status, "current");
});

test("authored report conflicts never overwrite notes or advertise an older report as current", (t) => {
  const value = fixture(t);
  const inspect = () => quiet(() => value.runtime.inspectInvestigation("openspec/investigations/retry-race.json"));
  const first = inspect();
  const path = join(value.root, first.report.path);
  writeFileSync(path, "User replaced the generated report with private notes.\n");
  const stopped = inspect();
  assert.equal(stopped.report.status, "unavailable");
  assert.equal(stopped.report.path, null);
  assert.equal(stopped.handoff, null);
  assert.equal(readFileSync(path, "utf8"), "User replaced the generated report with private notes.\n");
  // An explicit fixture-owned relocation preserves the note, then the same
  // investigation can regenerate without discarding its research.
  const note = join(value.root, "openspec/investigations/retry-race.md");
  writeFileSync(note, readFileSync(path));
  rmSync(path);
  value.record.sources.push("openspec/investigations/retry-race.md");
  writeFileSync(value.recordPath, JSON.stringify(value.record));
  const resumed = inspect();
  assert.equal(resumed.action, "DONE");
  assert.equal(resumed.report.status, "current");
  assert.equal(readFileSync(note, "utf8"), "User replaced the generated report with private notes.\n");
});

test("invalid facts stay unverified after repeated no-progress and generated reports cannot be sources", (t) => {
  const value = fixture(t);
  value.record.facts[0].sources = [];
  writeFileSync(value.recordPath, JSON.stringify(value.record));
  const inspect = () => quiet(() => value.runtime.inspectInvestigation("openspec/investigations/retry-race.json"));
  for (let iteration = 0; iteration < 4; iteration++) {
    const result = inspect();
    const report = readFileSync(join(value.root, result.report.path), "utf8");
    assert.match(report, /Recorded facts — validation is incomplete/);
    assert.doesNotMatch(report, /## Source-grounded facts/);
    assert.notEqual(result.action, "DONE");
  }
  value.record.facts[0].sources = ["evidence.md"];
  value.record.sources.push("openspec/investigations/retry-race.report.md");
  writeFileSync(value.recordPath, JSON.stringify(value.record));
  const invalid = inspect();
  assert.notEqual(invalid.action, "DONE");
  assert.match(readFileSync(join(value.root, invalid.report.path), "utf8"), /presentation, not investigation sources/);
});

test("an active-change investigation reads and binds the isolated Build sandbox", (t) => {
  let operationChangeId = null;
  const value = fixture(t, {
    setOperationChangeId: (id) => { operationChangeId = id; }
  });
  const sandbox = join(value.root, ".foundation", "sandboxes", "active-change");
  mkdirSync(sandbox, { recursive: true });
  writeFileSync(join(sandbox, "evidence.md"), "Sandbox evidence is newer than main.\n");
  mkdirSync(join(value.root, ".foundation", "runtime"), { recursive: true });
  writeFileSync(join(value.root, ".foundation", "runtime", "active-change.json"),
    `${JSON.stringify({
      id: "active-change", status: "building",
      workspace: { mode: "copy", path: sandbox, baseHead: "base", baseline: {} }
    }, null, 2)}\n`);
  value.record.activeChange = "active-change";
  writeFileSync(value.recordPath, `${JSON.stringify(value.record, null, 2)}\n`);

  const result = quiet(() => value.runtime.inspectInvestigation(
    "openspec/investigations/retry-race.json"));
  assert.equal(result.action, "DONE");
  assert.equal(result.handoff.workspace.changeId, "active-change");
  assert.equal(operationChangeId, "active-change");
  assert.equal(result.handoff.workspace.sourceRoot, realpathSync(sandbox));
  const state = value.readJson(join(value.root, result.state.path));
  assert.equal(state.workspace.identity, result.handoff.workspace.identity);
  assert.equal(state.sourceInventory.sources[0].path, "evidence.md");
  assert.deepEqual(validateInvestigationBinding({
    projectRoot: value.root, binding: result.handoff
  }), []);

  writeFileSync(join(value.root, ".foundation", "runtime", "active-change.json"),
    `${JSON.stringify({
      id: "active-change", status: "building",
      workspace: { mode: "copy", path: sandbox, baseHead: "moved", baseline: {} }
    }, null, 2)}\n`);
  assert.match(validateInvestigationBinding({
    projectRoot: value.root, binding: result.handoff
  }).join("\n"), /sandbox identity or base is stale/);

  rmSync(sandbox, { recursive: true, force: true });
  assert.match(validateInvestigationBinding({
    projectRoot: value.root, binding: result.handoff
  }).join("\n"), /sandbox is missing or unsafe/);
  const blocked = quiet(() => value.runtime.inspectInvestigation(
    "openspec/investigations/retry-race.json"));
  assert.equal(blocked.action, "EDIT");
  assert.equal(blocked.resume,
    "claude-foundation investigate openspec/investigations/retry-race.json");
  assert.match(blocked.investigation.issues.join("\n"), /sandbox is missing or unsafe/);
  assert.deepEqual(value.readJson(join(value.root, blocked.state.path)).repository.selectedSources, []);
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

test("blocked repository discovery short-circuits source inventory reads", (t) => {
  const value = fixture(t);
  writeFileSync(join(value.root, "evidence.md"), "x".repeat(300_000));
  const result = quiet(() => value.runtime.inspectInvestigation(
    "openspec/investigations/retry-race.json"));
  assert.equal(result.action, "EDIT");
  assert.match(result.investigation.issues.join("\n"), /repository discovery scan-file-size-limit/);
  assert.doesNotMatch(result.investigation.issues.join("\n"), /investigation source source-file-size-limit/);
  const state = value.readJson(join(value.root, result.state.path));
  assert.deepEqual(state.sourceInventory.sources, []);
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

test("Investigation refuses record and state paths through parent-directory symlinks", (t) => {
  const outside = mkdtempSync(join(tmpdir(), "investigation-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const recordRoot = mkdtempSync(join(tmpdir(), "investigation-record-root-"));
  t.after(() => rmSync(recordRoot, { recursive: true, force: true }));
  mkdirSync(join(recordRoot, "openspec"), { recursive: true });
  symlinkSync(outside, join(recordRoot, "openspec", "investigations"));
  writeFileSync(join(outside, "escape.json"), JSON.stringify({ version: 1, id: "escape" }));
  const runtime = createInvestigationRuntime({
    root: recordRoot,
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    writeJson: (path, value) => writeFileSync(path, JSON.stringify(value)),
    now: () => "2026-09-15T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });
  assert.throws(() => runtime.inspectInvestigation("openspec/investigations/escape.json"),
    /regular JSON record inside the project/);

  const value = fixture(t);
  mkdirSync(join(value.root, ".foundation"), { recursive: true });
  symlinkSync(outside, join(value.root, ".foundation", "investigations"));
  assert.throws(() => quiet(() => value.runtime.inspectInvestigation(
    "openspec/investigations/retry-race.json")), /state directory is unsafe/);
});

test("Change handoff binds canonical inventory, outcome, and refreshed discovery", (t) => {
  const value = fixture(t);
  const result = quiet(() => value.runtime.inspectInvestigation(
    "openspec/investigations/retry-race.json"));
  assert.match(validateInvestigationBinding({
    projectRoot: value.root, binding: { ...result.handoff, outcome: "not-worth-changing" }
  }).join("\n"), /outcome does not match/);

  writeFileSync(join(value.root, "new-retry-evidence.md"),
    "A retry must preserve the latest revision and reject a stale write.\n");
  assert.match(validateInvestigationBinding({
    projectRoot: value.root, binding: result.handoff
  }).join("\n"), /repository discovery is stale/);

  rmSync(join(value.root, "new-retry-evidence.md"));
  const statePath = join(value.root, result.state.path);
  const state = value.readJson(statePath);
  state.sourceInventory.sources[0].path = "evidence.md/../evidence.md";
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  assert.match(validateInvestigationBinding({
    projectRoot: value.root, binding: result.handoff
  }).join("\n"), /source inventory is invalid or noncanonical/);
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
  assert.equal(result.action, "ASK_USER");
  assert.equal(result.owner, "user");
  assert.equal(result.boundary, "repeated-no-progress");
  assert.equal(result.decision.kind, "repair-no-progress");
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
  const result = quiet(() => value.runtime.inspectInvestigation(
    "openspec/investigations/retry-race.json"));
  assert.equal(result.action, "DONE");
  const report = readFileSync(join(value.root, result.report.path), "utf8");
  assert.match(report, /Options and tradeoffs/);
  assert.match(report, /Can lose a newer write/);
  assert.match(report, /Prototype \(not proof\)/);

  value.record.options[0].prototypePaths = ["src/escape.html"];
  value.record.selection.rejected = [];
  writeFileSync(value.recordPath, `${JSON.stringify(value.record, null, 2)}\n`);
  const blocked = quiet(() => value.runtime.inspectInvestigation(
    "openspec/investigations/retry-race.json"));
  assert.equal(blocked.action, "EDIT");
  assert.match(blocked.investigation.issues.join("\n"), /prototypePaths must stay under/);
  assert.match(blocked.investigation.issues.join("\n"), /must explain option/);
  assert.match(readFileSync(join(value.root, blocked.report.path), "utf8"), /Incomplete/);
});

test("report represents pending user choices and a no-change conclusion without automatic Change", (t) => {
  const value = fixture(t);
  value.record.decisions = [{ key: "policy", status: "open", question: "Which policy?",
    alternatives: ["strict", "compatible"], recommended: "strict",
    recommendationFactKeys: ["latest-revision"] }];
  value.record.conclusion.status = "needs-user-decision";
  writeFileSync(value.recordPath, JSON.stringify(value.record));
  const result = quiet(() => value.runtime.inspectInvestigation("openspec/investigations/retry-race.json"));
  assert.equal(result.action, "ASK_USER");
  const report = readFileSync(join(value.root, result.report.path), "utf8");
  assert.match(report, /Which policy/);
  assert.match(report, /strict \/ compatible/);
  assert.match(report, /User decision required/);
  value.record.decisions = [];
  value.record.conclusion = { status: "not-worth-changing", summary: "Existing behavior satisfies the constraint." };
  writeFileSync(value.recordPath, JSON.stringify(value.record));
  const done = quiet(() => value.runtime.inspectInvestigation("openspec/investigations/retry-race.json"));
  assert.equal(done.action, "DONE");
  assert.equal(done.handoff, null);
  assert.match(readFileSync(join(value.root, done.report.path), "utf8"), /no Change recommended/);
});
