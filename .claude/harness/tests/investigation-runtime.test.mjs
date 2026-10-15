import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createInvestigationRuntime, investigationRecordTemplate, validateInvestigationBinding
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

// A shell-written JSON record is refused by the host; the route the agent
// copies from names the file tool, the record path, and its consuming command.
test("the record template leads with the file-tool save route and tolerates it saved", (t) => {
  const template = investigationRecordTemplate();
  assert.deepEqual(Object.keys(template).slice(0, 2), ["save", "version"]);
  assert.match(template.save, /Write tool to openspec\/investigations\/<id>\.json/);
  assert.match(template.save, /not save it through the shell \(heredoc/);
  assert.match(template.save,
    /claude-foundation investigate openspec\/investigations\/<id>\.json/);
  const value = fixture(t);
  writeFileSync(value.recordPath,
    `${JSON.stringify({ save: template.save, ...value.record }, null, 2)}\n`);
  assert.equal(quiet(() => value.runtime.inspectInvestigation(
    "openspec/investigations/retry-race.json")).action, "DONE");
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

test("an authored investigation note written after DONE never makes discovery stale", (t) => {
  const value = fixture(t);
  const git = (args, cwd) => {
    const listed = execFileSync("git", args, { cwd, encoding: "utf8" });
    return { status: 0, stdout: listed, stderr: "" };
  };
  execFileSync("git", ["init", "-q"], { cwd: value.root });
  const runtime = createInvestigationRuntime({
    root: value.root, readJson: value.readJson,
    writeJson: (path, json) => writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`),
    now: () => "2026-09-15T00:00:00.000Z", git,
    fail: (message) => { throw new Error(message); }
  });
  const done = quiet(() => runtime.inspectInvestigation("openspec/investigations/retry-race.json"));
  assert.equal(done.action, "DONE");
  for (const name of ["retry-race.md", "nested/latest-revision-retry.md"]) {
    mkdirSync(join(value.root, "openspec/investigations", name, ".."), { recursive: true });
    writeFileSync(join(value.root, "openspec/investigations", name),
      "Retry latest revision stale write evidence notes.\n");
  }
  for (const gitAware of [git, null])
    assert.deepEqual(validateInvestigationBinding({
      projectRoot: value.root, binding: done.handoff, git: gitAware
    }), []);
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

test("discovered sources are acknowledged automatically, hashed, and listed as unread", (t) => {
  const value = fixture(t);
  writeFileSync(join(value.root, "second.md"),
    "A retry can overwrite a newer revision without a version check.\n");
  const result = quiet(() => value.runtime.inspectInvestigation(
    "openspec/investigations/retry-race.json"));
  assert.equal(result.action, "DONE");
  assert.notEqual(result.handoff, null);
  const state = value.readJson(join(value.root, result.state.path));
  assert.ok(state.sourceInventory.sources.some((row) => row.path === "second.md"));
  assert.deepEqual(state.repository.unreadSources, ["second.md"]);
  const report = readFileSync(join(value.root, result.report.path), "utf8");
  assert.match(report, /## Discovered sources not cited by a fact[^\n]*\n\n- \[second\.md\]/);
  // An auto-acknowledged discovery is still freshness-bound.
  writeFileSync(join(value.root, "second.md"), "A retry changed after the handoff.\n");
  assert.match(validateInvestigationBinding({
    projectRoot: value.root, binding: result.handoff
  }).join("\n"), /sources changed|discovery is stale/);
});

test("facts must cite an inventoried source", (t) => {
  const value = fixture(t);
  writeFileSync(join(value.root, "unrelated.txt"), "zzz\n");
  value.record.facts[0].sources = ["unrelated.txt"];
  writeFileSync(value.recordPath, JSON.stringify(value.record));
  const result = quiet(() => value.runtime.inspectInvestigation(
    "openspec/investigations/retry-race.json"));
  assert.equal(result.action, "EDIT");
  assert.match(result.investigation.issues.join("\n"),
    /fact 'latest-revision' cites source 'unrelated\.txt' outside the investigation inventory/);
});

test("conclusion status is derived: open decisions ask the user and a settled record concludes in one run", (t) => {
  const value = fixture(t);
  delete value.record.conclusion.status;
  value.record.decisions = [{ key: "policy", status: "open", question: "Which policy?",
    alternatives: ["strict", "compatible"], recommended: "strict",
    recommendationFactKeys: ["latest-revision"] }];
  writeFileSync(value.recordPath, JSON.stringify(value.record));
  const asked = quiet(() => value.runtime.inspectInvestigation("openspec/investigations/retry-race.json"));
  assert.equal(asked.action, "ASK_USER");
  assert.equal(value.readJson(join(value.root, asked.state.path)).conclusion.status,
    "needs-user-decision");
  value.record.decisions = [{ key: "policy", status: "resolved", choice: "strict",
    reason: "User chose strict." }];
  writeFileSync(value.recordPath, JSON.stringify(value.record));
  const done = quiet(() => value.runtime.inspectInvestigation("openspec/investigations/retry-race.json"));
  assert.equal(done.action, "DONE");
  assert.equal(done.handoff.outcome, "ready-for-change");
  assert.deepEqual(validateInvestigationBinding({ projectRoot: value.root, binding: done.handoff }), []);
  value.record.conclusion.status = "concluded";
  writeFileSync(value.recordPath, JSON.stringify(value.record));
  const invalid = quiet(() => value.runtime.inspectInvestigation("openspec/investigations/retry-race.json"));
  assert.match(invalid.investigation.issues.join("\n"), /conclusion\.status must be/);
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
  assert.equal(result.action, "EDIT");
  assert.equal(result.owner, "agent");
  assert.equal(result.boundary, "repeated-no-progress");
  assert.equal(result.investigation.kind, "change-strategy");
  assert.equal(result.investigation.repeated.kind, "test-hypotheses");
});

test("repeated no-progress from a missing sandbox goes to the harness, not the user", (t) => {
  const value = fixture(t);
  value.record.activeChange = "missing-change";
  writeFileSync(value.recordPath, JSON.stringify(value.record));
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1)
    result = quiet(() => value.runtime.inspectInvestigation("openspec/investigations/retry-race.json"));
  assert.equal(result.noProgress.boundaryReached, true);
  assert.equal(result.action, "EDIT");
  assert.equal(result.owner, "harness");
  assert.equal(result.investigation.kind, "repair-harness");
  assert.match(result.investigation.issues.join("\n"), /runtime state is missing/);
});

test("repeated no-progress asks the user only when the repeated action was a user question", (t) => {
  const value = fixture(t);
  value.record.decisions = [{ key: "policy", status: "open", question: "Which policy?",
    alternatives: ["strict", "compatible"], recommended: "strict",
    recommendationFactKeys: ["latest-revision"] }];
  writeFileSync(value.recordPath, JSON.stringify(value.record));
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1)
    result = quiet(() => value.runtime.inspectInvestigation("openspec/investigations/retry-race.json"));
  assert.equal(result.action, "ASK_USER");
  assert.equal(result.owner, "user");
  assert.equal(result.boundary, "repeated-no-progress");
  assert.equal(result.decision.items[0].key, "policy");
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

function intakeFixture(t) {
  const value = fixture(t);
  Object.assign(value.record, {
    ...investigationRecordTemplate(), id: "retry-race", purpose: "change",
    problem: "Explore safe profile retries", sources: ["evidence.md"],
    facts: [{ key: "revision", statement: "Retries need revision checks", sources: ["evidence.md"] }],
    hypotheses: [], intent: { goal: "Preserve newer writes", outcome: "Reject stale revisions" },
    conversation: [{ key: "request", speaker: "user", statement: "Reject stale writes", source: "session:message:1" }],
    requirements: [{ key: "retry", revision: 1, kind: "behavior", statement: "Reject stale writes",
      origin: "user", status: "stated", material: true, conversationKeys: ["request"] }],
    conclusion: { summary: "Use revision checks" }, changeIntent: "Reject stale profile writes"
  });
  value.save = () => writeFileSync(value.recordPath, JSON.stringify(value.record));
  value.inspect = () => { value.save(); return quiet(() => value.runtime.inspectInvestigation("openspec/investigations/retry-race.json")); };
  value.state = (result) => value.readJson(join(value.root, result.state.path));
  return value;
}

test("v2 explicit requirements are ready without a blanket confirmation and remain digest-bound", (t) => {
  const v = intakeFixture(t), done = v.inspect();
  assert.equal(done.action, "DONE");
  assert.equal(done.handoff.version, 2);
  assert.equal(done.handoff.intake.requirements[0].status, "stated");
  assert.deepEqual(validateInvestigationBinding({ projectRoot: v.root, binding: done.handoff }), []);
  const tampered = structuredClone(done.handoff);
  tampered.intake.requirements[0].statement = "Accept stale writes";
  assert.match(validateInvestigationBinding({ projectRoot: v.root, binding: tampered }).join("\n"), /intake digest/);
  v.record.conversation.push({ key: "correction", speaker: "user", statement: "Only retry writes", source: "session:message:2" });
  v.save();
  assert.match(validateInvestigationBinding({ projectRoot: v.root, binding: done.handoff }).join("\n"), /request changed/);
});

test("downgrading a retained v2 record cannot erase history or bypass its material questions", (t) => {
  const v = intakeFixture(t); v.inspect();
  v.record.version = 1;
  v.record.requirements = [];
  const result = v.inspect();
  assert.equal(result.action, "EDIT");
  assert.match(result.investigation.issues.join("\n"), /cannot downgrade/);
  assert.equal(v.state(result).validatedIntake.requirements[0].key, "retry");
});

test("missing requirement history preserves the validated baseline across repeated failed edits", (t) => {
  const v = intakeFixture(t); v.inspect();
  v.record.requirements = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const failed = v.inspect();
    assert.equal(failed.action, "EDIT");
    assert.equal(failed.owner, "agent");
    assert.equal(failed.handoff, null);
    assert.equal(v.state(failed).validatedIntake.requirements[0].key, "retry");
  }
  v.record.requirements = v.state(v.inspect()).validatedIntake.requirements;
  assert.equal(v.inspect().action, "DONE");
});

test("partial correction retains old revisions, unrelated constraints and conversation after resume", (t) => {
  const v = intakeFixture(t);
  v.record.requirements.push({ ...v.record.requirements[0], key: "no-delete", kind: "constraint",
    statement: "Never delete profiles" });
  v.inspect();
  v.record.conversation.push({ key: "correct", speaker: "user", statement: "Reject only stale retries", source: "session:message:2" });
  Object.assign(v.record.requirements[0], { status: "superseded", reason: "User narrowed scope",
    supersededBy: { key: "retry", revision: 2 } });
  v.record.requirements.push({ key: "retry", revision: 2, kind: "behavior", statement: "Reject stale retries",
    origin: "user", status: "stated", material: true, conversationKeys: ["correct"] });
  const result = v.inspect(), state = v.state(result);
  assert.equal(result.action, "DONE");
  assert.equal(state.intake.requirements.length, 3);
  assert.equal(state.intake.requirements[1].statement, "Never delete profiles");
  assert.equal(state.intake.conversation.length, 2);
  assert.equal(v.inspect().action, "DONE");
});

test("editing a requirement in place or dropping conversation is agent-owned repair", (t) => {
  const v = intakeFixture(t); v.inspect();
  v.record.requirements[0].statement = "Allow stale writes";
  assert.match(v.inspect().investigation.issues.join("\n"), /new revision/);
  v.record.requirements[0].statement = "Reject stale writes";
  v.record.conversation = [];
  assert.match(v.inspect().investigation.issues.join("\n"), /conversation.*disappeared/);
});

test("open requirement questions need no forced alternatives and permit independent work", (t) => {
  const v = intakeFixture(t);
  v.record.questions = [{ key: "goal", question: "What should success mean?", material: true, status: "open" }];
  v.record.work = [
    { key: "read", outcome: "Inspect revision guard", questionKeys: [] },
    { key: "choose", outcome: "Implement selected semantics", questionKeys: ["goal"] }
  ];
  const result = v.inspect();
  assert.equal(result.action, "ASK_USER");
  assert.equal(result.decision.items[0].question, "What should success mean?");
  assert.deepEqual(result.decision.items[0].alternatives, []);
  assert.deepEqual(result.independentWork.map((w) => w.key), ["read"]);
  assert.equal(result.handoff, null);
  v.record.conversation.push({ key: "answer", speaker: "user", statement: "Reject stale writes", source: "session:message:2" });
  Object.assign(v.record.questions[0], { status: "answered", answer: "Reject stale writes", conversationKeys: ["answer"] });
  assert.equal(v.inspect().action, "DONE");
});

test("an agent suggestion or silent user cannot become confirmed intent", (t) => {
  const v = intakeFixture(t);
  v.record.conversation.push({ key: "suggest", speaker: "agent", statement: "Maybe delete profiles", source: "session:message:2" });
  v.record.requirements.push({ key: "delete", revision: 1, kind: "behavior", statement: "Delete profiles",
    origin: "agent", status: "proposed", material: true, conversationKeys: ["suggest"] });
  assert.equal(v.inspect().action, "ASK_USER");
  v.record.requirements[1].status = "confirmed";
  assert.equal(v.inspect().action, "EDIT");
  v.record.requirements[1].status = "proposed";
  v.record.requirements[1].material = false;
  assert.equal(v.inspect().action, "EDIT"); // changing materiality also needs a new revision
  const optional = intakeFixture(t);
  optional.record.conversation.push(v.record.conversation[1]);
  optional.record.requirements.push(v.record.requirements[1]);
  assert.equal(optional.inspect().action, "DONE");
});

test("nonmaterial open questions do not block a clear change", (t) => {
  const v = intakeFixture(t);
  v.record.questions = [{ key: "future", question: "Should a future version support history?", material: false, status: "open" }];
  const result = v.inspect();
  assert.equal(result.action, "DONE");
  assert.equal(result.pendingQuestions.length, 1);
  assert.ok(result.handoff);
});

test("question dependency cycles and nonexistent work links are repaired by the agent", (t) => {
  const v = intakeFixture(t);
  v.record.questions = [
    { key: "a", question: "A?", status: "open", material: true, dependsOn: ["b"] },
    { key: "b", question: "B?", status: "open", material: true, dependsOn: ["a"], workKeys: ["missing"] }
  ];
  const result = v.inspect();
  assert.equal(result.action, "EDIT");
  assert.match(result.investigation.issues.join("\n"), /cycle/);
  assert.match(result.investigation.issues.join("\n"), /unknown work/);
});

test("stale experiments selectively require review and retain their previous results", (t) => {
  const v = intakeFixture(t);
  v.record.requirements.push({ ...v.record.requirements[0], key: "other", statement: "Keep unrelated behavior" });
  const experiment = { key: "poc", question: "Does the guard reject stale retries?", criteria: ["stale retries rejected"],
    material: true, status: "complete", findings: ["guard rejects stale writes"], limitations: ["local fixture only"],
    requirementRefs: [{ key: "retry", revision: 1 }], prototypePaths: [".foundation/prototypes/retry-race/poc.js"] };
  v.record.experiments = [experiment, { ...experiment, key: "other-poc", requirementRefs: [{ key: "other", revision: 1 }] }];
  v.inspect();
  v.record.conversation.push({ key: "correct", speaker: "user", statement: "Reject only retries", source: "session:message:2" });
  Object.assign(v.record.requirements[0], { status: "superseded", reason: "scope changed", supersededBy: { key: "retry", revision: 2 } });
  v.record.requirements.push({ ...v.record.requirements[1], key: "retry", revision: 2, statement: "Reject stale retries", conversationKeys: ["correct"] });
  const stale = v.inspect();
  assert.equal(stale.action, "EDIT");
  assert.equal(stale.boundary, "experiment-review");
  assert.deepEqual(stale.staleExperiments, ["poc"]);
  v.record.experiments.push({ ...experiment, key: "poc-v2", requirementRefs: [{ key: "retry", revision: 2 }] });
  Object.assign(experiment, { supersededBy: "poc-v2", reason: "Rechecked narrowed requirement" });
  assert.equal(v.inspect().action, "DONE");
  assert.equal(v.record.experiments[0].findings[0], "guard rejects stale writes");
});

test("completed experiment output cannot be overwritten and prototype paths stay bounded", (t) => {
  const v = intakeFixture(t);
  v.record.experiments = [{ key: "poc", question: "Works?", criteria: ["reject"], status: "complete",
    material: false, findings: ["rejects"], limitations: ["fixture"], requirementRefs: [{ key: "retry", revision: 1 }] }];
  v.inspect();
  v.record.experiments[0].findings = ["accepts"];
  assert.match(v.inspect().investigation.issues.join("\n"), /completed result changed/);
  v.record.experiments[0].findings = ["rejects"];
  v.record.experiments[0].prototypePaths = [".foundation/prototypes/retry-race/../outside.js"];
  assert.match(v.inspect().investigation.issues.join("\n"), /prototypePaths/);
});

test("a planned material feasibility experiment cannot be silently treated as completed", (t) => {
  const v = intakeFixture(t);
  v.record.conclusion.status = "ready-for-change";
  v.record.experiments = [{ key: "poc", question: "Does retry duplicate writes?", criteria: ["one write"],
    status: "planned", material: true, requirementRefs: [{ key: "retry", revision: 1 }] }];
  const result = v.inspect();
  assert.equal(result.action, "EDIT");
  assert.equal(result.boundary, "experiment-execution");
  assert.equal(result.handoff, null);
});

test("a grounded no-change conclusion need not resolve questions for a change that is not proposed", (t) => {
  const v = intakeFixture(t);
  v.record.questions = [{ key: "future", question: "Which implementation would be wanted?", status: "open", material: true }];
  v.record.conclusion = { status: "not-worth-changing", summary: "The existing guard already meets the need" };
  const result = v.inspect();
  assert.equal(result.action, "DONE");
  assert.equal(result.handoff, null);
});

test("malformed intake rows return repair findings rather than crashing or producing a handoff", (t) => {
  for (const field of ["requirements", "conversation", "questions", "work", "experiments"]) {
    for (const retained of [false, true]) {
      const v = intakeFixture(t);
      if (retained) assert.equal(v.inspect().action, "DONE");
      const original = v.record[field];
      v.record[field] = [null];
      const result = v.inspect();
      assert.equal(result.action, "EDIT", field);
      assert.equal(result.handoff, null, field);
      v.record[field] = original;
      assert.equal(v.inspect().action, "DONE", `${field}: corrected record resumes`);
    }
  }
});

test("malformed dependency lists cannot advertise dependent work as independent", (t) => {
  const v = intakeFixture(t);
  v.record.questions = [{ key: "policy", question: "Which behavior?", material: true, status: "open" }];
  v.record.work = [{ key: "dependent", outcome: "Research the selected behavior", questionKeys: "policy" }];
  const result = v.inspect();
  assert.equal(result.action, "EDIT");
  assert.equal(result.handoff, null);
  assert.ok(!result.independentWork?.some((row) => row.key === "dependent"));
});

test("malformed retained detail arrays require repair instead of silently dropping context", (t) => {
  const cases = [
    (record) => { record.intent.scope = "profile updates"; },
    (record) => { record.requirements[0].examples = "retry after a timeout"; },
    (record) => { record.requirements[0].criteria = "newer writes survive"; }
  ];
  for (const mutate of cases) {
    const v = intakeFixture(t);
    mutate(v.record);
    const result = v.inspect();
    assert.equal(result.action, "EDIT");
    assert.equal(result.handoff, null);
  }
});

test("v2 Thai report retains requirement context, answers, independent work and missing history", (t) => {
  const v = intakeFixture(t);
  v.record.language = "th";
  v.record.historyGaps = ["ข้อความจาก session เก่าเข้าถึงไม่ได้"];
  v.record.requirements[0].examples = ["retry หลัง timeout"];
  v.record.questions = [{ key: "future", question: "รองรับประวัติในอนาคตไหม", status: "open", material: false }];
  v.record.work = [{ key: "read", outcome: "อ่าน guard ต่อได้", questionKeys: [] }];
  const result = v.inspect();
  const report = readFileSync(join(v.root, result.report.path), "utf8");
  for (const detail of ["ข้อกำหนดล่าสุด", "Reject stale writes", "retry หลัง timeout", "รองรับประวัติในอนาคตไหม", "อ่าน guard ต่อได้", "ข้อความจาก session เก่าเข้าถึงไม่ได้", "session:message:1"])
    assert.ok(report.includes(detail), detail);
});

function nextCheckFixture(t, language) {
  const v = intakeFixture(t);
  if (language) v.record.language = language;
  v.record.hypotheses = [
    { key: "h1", statement: "Retry skips the revision guard", status: "open", experimentKeys: ["e1"] },
    { key: "h2", statement: "Cache returns a stale revision", status: "open" }
  ];
  v.record.experiments = [{ key: "e1", question: "Does a stale retry reach the write?",
    criteria: ["write rejected"], status: "planned", material: false,
    requirementRefs: [{ key: "retry", revision: 1 }] }];
  v.unknowns = (result) => {
    const report = readFileSync(join(v.root, result.report.path), "utf8");
    const heading = language === "th" ? "## สิ่งที่ยังไม่รู้และงานที่เหลือ" : "## Unknowns and remaining work";
    return report.slice(report.indexOf(heading)).split("\n## ")[0];
  };
  return v;
}

test("report Unknowns name each open hypothesis's next check or its absence", (t) => {
  const v = nextCheckFixture(t);
  const result = v.inspect();
  assert.notEqual(result.investigation?.kind, "repair-record");
  const unknowns = v.unknowns(result);
  const h1 = unknowns.split("\n").find((line) => line.includes("h1"));
  assert.ok(h1.includes("Next check: **e1** [planned] Does a stale retry reach the write?"), h1);
  const h2 = unknowns.split("\n").find((line) => line.includes("h2"));
  assert.ok(h2.includes("No next check yet"), h2);
});

test("Thai report Unknowns label next checks and their absence", (t) => {
  const v = nextCheckFixture(t, "th");
  const unknowns = v.unknowns(v.inspect());
  assert.ok(unknowns.includes("ตรวจต่อ: **e1** [planned] Does a stale retry reach the write?"), unknowns);
  assert.ok(unknowns.split("\n").find((line) => line.includes("h2")).includes("ยังไม่มีการตรวจต่อ"));
});

test("hypothesis experimentKeys must name a retained, current experiment", (t) => {
  const v = nextCheckFixture(t);
  v.record.hypotheses[0].experimentKeys = ["nope"];
  const unknown = v.inspect();
  assert.equal(unknown.action, "EDIT");
  assert.equal(unknown.investigation.kind, "repair-record");
  assert.ok(unknown.investigation.issues.some((issue) =>
    issue.includes("'h1'") && issue.includes("unknown experiment 'nope'")), unknown.investigation.issues.join("\n"));
  v.record.hypotheses[0].experimentKeys = "e1";
  assert.match(v.inspect().investigation.issues.join("\n"), /'h1' experimentKeys must be an array/);
  v.record.hypotheses[0].experimentKeys = ["e1"];
  v.record.experiments.push({ ...v.record.experiments[0], key: "e2" });
  Object.assign(v.record.experiments[0], { supersededBy: "e2", reason: "Narrowed the retry question" });
  const superseded = v.inspect();
  assert.equal(superseded.action, "EDIT");
  assert.equal(superseded.investigation.kind, "repair-record");
  assert.ok(superseded.investigation.issues.some((issue) =>
    issue.includes("'h1'") && issue.includes("superseded experiment 'e1'") && issue.includes("'e2'")),
  superseded.investigation.issues.join("\n"));
  v.record.hypotheses[0].experimentKeys = ["e2"];
  assert.notEqual(v.inspect().investigation?.kind, "repair-record");
});
