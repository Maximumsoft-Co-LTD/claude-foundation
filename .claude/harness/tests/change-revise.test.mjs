import assert from "node:assert/strict";
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  createChangeLifecycle, mergeApprovalDelta, requirementDelta, requirementFingerprints
} from "../runtime/workflow/change-lifecycle.mjs";
import { acquireProcessLock } from "../runtime/core/process-lock.mjs";

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function requirement(key, outcome) {
  return {
    key, capability: "change", operation: "added",
    scenario: `${key} is exercised`, outcome
  };
}

function semanticDraft({ requirements, id = undefined, version = 3 } = {}) {
  const rows = requirements || [
    requirement("throughput", "The service accepts 20 messages per second"),
    requirement("ack-path", "The webhook acknowledges after Temporal accepts")
  ];
  return {
    version,
    ...(id === undefined ? { id: "revisable-change" } : id === null ? {} : { id }),
    intent: "Revisable change",
    why: "Exercise pre-Build revision",
    impact: "medium",
    coupling: "isolated",
    requirements: rows,
    tasks: [{
      key: "implement", outcome: "Implement the requirements",
      covers: rows.map((row) => row.key), verify: "npm test"
    }],
    evidence: Object.fromEntries(rows.map((row) => [row.key, { capabilities: ["test"] }])),
    acceptance: { required: false },
    decisions: []
  };
}

function snapshot(root) {
  const files = {};
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files[relative(root, path)] = readFileSync(path, "utf8");
    }
  };
  walk(join(root, "openspec", "changes"));
  walk(join(root, ".foundation", "runtime"));
  return files;
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "foundation-change-revise-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const changes = join(root, "openspec", "changes");
  const runtime = join(root, ".foundation", "runtime");
  const control = { validationFailure: null, output: [] };
  for (const schema of ["foundation-rapid", "foundation-standard"]) {
    const templates = join(root, "openspec", "schemas", schema, "templates");
    mkdirSync(templates, { recursive: true });
    writeFileSync(join(templates, "proposal.md"), "# <title>\n");
    writeFileSync(join(templates, "tasks.md"), "- [ ] **T001** replace-with-task\n");
    writeJson(join(templates, "evidence.yaml"), { version: 2, claims: [] });
    writeJson(join(templates, "execution.yaml"), { version: 1, providers: {}, services: {} });
    writeJson(join(templates, "repositories.yaml"), {
      version: 1, repositories: [{ id: "root", mode: "write", dependsOn: [] }]
    });
    writeJson(join(templates, "handoffs.yaml"), { version: 1, operations: [] });
    writeFileSync(join(templates, "design.md"), "# Design for <title>\n");
    writeFileSync(join(templates, "spec.md"), "## ADDED Requirements\n");
  }
  const draftPath = join(root, "draft.json");
  const lifecycle = createChangeLifecycle({
    root,
    policy: () => ({ workflow: { grounding: "optional" }, land: {} }),
    securityTerms: ["authentication"],
    fail: (message) => { throw new Error(message); },
    pathInside: () => true,
    readJson: (path) => {
      if (path === draftPath && control.onReadDraft) control.onReadDraft();
      return JSON.parse(readFileSync(path, "utf8"));
    },
    writeJson,
    slugify: (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    changePath: (id) => join(changes, id),
    loadRuntime: (id) => JSON.parse(readFileSync(join(runtime, `${id}.json`), "utf8")),
    saveRuntime: (state) => writeJson(join(runtime, `${state.id}.json`), state),
    setOperationChangeId: () => {},
    initialBudget: () => ({ tokens: 0 }),
    gitHead: () => "head",
    preexistingDirty: () => ({}),
    now: () => "2026-09-24T00:00:00.000Z",
    bindClaudeSession: () => {},
    validate: () => {
      if (control.validationFailure) throw new Error(control.validationFailure);
    },
    showPacket: () => {},
    measureStage: (_stage, operation) => operation(),
    trapFailures: (operation) => operation(),
    rollbackStart: () => []
  });
  const start = (value = semanticDraft()) => {
    writeJson(draftPath, value);
    lifecycle.startAtomic(draftPath);
  };
  const revise = (value, options = {}) => {
    writeJson(draftPath, value);
    const log = console.log;
    console.log = (line) => control.output.push(String(line));
    try { return lifecycle.reviseChange("revisable-change", draftPath, options); }
    finally { console.log = log; }
  };
  const state = () => JSON.parse(readFileSync(join(runtime, "revisable-change.json"), "utf8"));
  const quiet = (operation) => {
    const log = console.log;
    console.log = () => {};
    try { return operation(); } finally { console.log = log; }
  };
  return { root, changes, runtime, draftPath, lifecycle, control, start: (v) => quiet(() => start(v)), revise, state };
}

const revisedDraft = () => semanticDraft({ requirements: [
  requirement("throughput", "The service accepts 50 messages per second"),
  requirement("outbox", "The webhook acknowledges after the Mongo outbox commit")
] });

test("revise recompiles an agreed change in place and reports its delta", (t) => {
  const value = fixture(t);
  value.start();
  const before = value.state();
  const delta = value.revise(revisedDraft(), { consumeDraft: true });
  assert.deepEqual(delta, { added: ["outbox"], revised: ["throughput"], removed: ["ack-path"] });
  const after = value.state();
  assert.equal(after.id, "revisable-change");
  assert.equal(after.contractRevision, Number(before.contractRevision || 0) + 1);
  assert.deepEqual(after.specApproval, { required: true });
  assert.deepEqual(after.pendingApprovalDelta, {
    added: ["outbox"], revised: ["throughput"], removed: ["ack-path"],
    revision: after.contractRevision
  });
  assert.equal(after.revisions.at(-1).kind, "pre-build-revision");
  assert.equal(after.createdAt, before.createdAt);
  const spec = readFileSync(join(value.changes, "revisable-change", "specs", "change", "spec.md"), "utf8");
  assert.match(spec, /50 messages per second/);
  assert.doesNotMatch(spec, /Temporal accepts/);
  assert.equal(existsSync(value.draftPath), false);
  const output = value.control.output.join("\n");
  assert.match(output, /^REVISED revisable-change/m);
  assert.match(output, /added: outbox/);
  assert.match(output, /revised: throughput/);
  assert.match(output, /removed: ack-path/);
  assert.match(output, /change resolve revisable-change --approve-spec/);
  assert.deepEqual(readdirSync(value.changes).filter((name) => name.startsWith(".")), []);
});

test("a failed revision restores the prior packet and runtime byte-for-byte", (t) => {
  const value = fixture(t);
  value.start();
  const before = snapshot(value.root);
  value.control.validationFailure = "strict validation rejected the packet";
  assert.throws(() => value.revise(revisedDraft()),
    /strict validation rejected the packet; change revision rolled back/);
  assert.deepEqual(snapshot(value.root), before);
  assert.deepEqual(readdirSync(value.changes).filter((name) => name.startsWith(".")), []);
});

test("revision is refused once Build or proof state exists", (t) => {
  const cases = [
    ["sandbox workspace", (value) => {
      const state = value.state();
      state.workspace = { mode: "worktree", path: join(value.root, ".foundation", "sandboxes", "x") };
      writeJson(join(value.runtime, "revisable-change.json"), state);
    }, /only available before Build.*change amend revisable-change/],
    ["completed task", (value) => {
      const path = join(value.changes, "revisable-change", "tasks.md");
      writeFileSync(path, readFileSync(path, "utf8").replace("- [ ]", "- [x]"));
    }, /only available before Build/],
    ["receipt", (value) => {
      writeJson(join(value.root, ".foundation", "receipts", "revisable-change", "test.json"), {});
    }, /only available before Build/],
    ["archived", (value) => {
      const state = value.state();
      state.status = "archived";
      writeJson(join(value.runtime, "revisable-change.json"), state);
    }, /cannot rewrite an agreement in 'archived' status; start a successor change/],
    ["archived with its packet moved", (value) => {
      const state = value.state();
      state.status = "archived";
      writeJson(join(value.runtime, "revisable-change.json"), state);
      rmSync(join(value.changes, "revisable-change"), { recursive: true, force: true });
    }, /cannot rewrite an agreement in 'archived' status; start a successor change/]
  ];
  for (const [name, arrange, expected] of cases) {
    const value = fixture(t);
    value.start();
    arrange(value);
    const before = snapshot(value.root);
    assert.throws(() => value.revise(revisedDraft()), expected, name);
    assert.deepEqual(snapshot(value.root), before, name);
  }
});

test("revision serializes with amendments and refuses a concurrent state change", (t) => {
  const value = fixture(t);
  value.start();
  const before = snapshot(value.root);
  const lock = acquireProcessLock(
    join(value.root, ".foundation", "locks", "amend-revisable-change.lock"));
  assert.equal(lock.acquired, true);
  try {
    assert.throws(() => value.revise(revisedDraft()),
      /change revision for 'revisable-change' is already in progress/);
  } finally { lock.release(); }
  assert.deepEqual(snapshot(value.root), before);

  // Build or another writer advances the runtime while the draft compiles.
  value.control.onReadDraft = () => {
    value.control.onReadDraft = null;
    const state = value.state();
    state.executionRevision = Number(state.executionRevision || 0) + 1;
    writeJson(join(value.runtime, "revisable-change.json"), state);
  };
  const concurrent = snapshot(value.root);
  assert.throws(() => value.revise(revisedDraft()),
    /change revision for 'revisable-change' conflicted with a newer change revision/);
  const after = snapshot(value.root);
  for (const path of Object.keys(concurrent).filter((path) => !path.endsWith("revisable-change.json")))
    assert.equal(after[path], concurrent[path], path);
  assert.equal(JSON.parse(after[".foundation/runtime/revisable-change.json"]).executionRevision,
    Number(JSON.parse(concurrent[".foundation/runtime/revisable-change.json"]).executionRevision || 0) + 1);
  assert.deepEqual(readdirSync(value.changes).filter((name) => name.startsWith(".")), []);
});

test("revision keeps the change identity and rejects legacy or missing changes", (t) => {
  const value = fixture(t);
  value.start();
  assert.throws(() => value.revise(semanticDraft({ id: "other-change" })),
    /draft id 'other-change' does not match change 'revisable-change'/);
  value.revise(semanticDraft({ id: null, requirements: [
    requirement("throughput", "The service accepts 30 messages per second"),
    requirement("ack-path", "The webhook acknowledges after Temporal accepts")
  ] }));
  assert.deepEqual(value.state().pendingApprovalDelta.revised, ["throughput"]);

  assert.throws(() => value.lifecycle.reviseChange("missing-change", value.draftPath),
    /requires an existing active change; 'missing-change' was not found/);
  const legacy = value.state();
  legacy.semanticDraftVersion = null;
  writeJson(join(value.runtime, "revisable-change.json"), legacy);
  assert.throws(() => value.revise(revisedDraft()), /legacy agreement/);
});

test("a version-4 revision must pass the revise intake gate", (t) => {
  const value = fixture(t);
  value.start();
  const before = snapshot(value.root);
  assert.throws(() => value.revise({ ...revisedDraft(), version: 4 }),
    /resume with 'claude-foundation change revise revisable-change .*draft\.json --inspect'/);
  assert.deepEqual(snapshot(value.root), before);
});

test("an amendment folds into the unapproved delta and approval clears it", (t) => {
  const value = fixture(t);
  value.start();
  value.revise(revisedDraft());
  const amendmentPath = join(value.root, "amendment.json");
  writeJson(amendmentPath, {
    version: 1,
    reason: "Retry replaces the outbox follow-up",
    addRequirements: [requirement("retry", "The webhook retries a failed delivery")],
    removeRequirements: [{ key: "outbox", migration: "Outbox moves to a successor change" }],
    updateTasks: [{ key: "implement", covers: ["retry"] }],
    evidence: { retry: { capabilities: ["test"] } }
  });
  const log = console.log;
  console.log = (line) => value.control.output.push(String(line));
  try { value.lifecycle.amendChange("revisable-change", amendmentPath); }
  finally { console.log = log; }
  const amended = value.state();
  assert.deepEqual(amended.pendingApprovalDelta, {
    added: ["retry"], revised: ["throughput"], removed: ["ack-path"],
    revision: amended.contractRevision
  });
  assert.deepEqual(Object.keys(amended.requirementFingerprints).sort(), ["retry", "throughput"]);
  assert.match(value.control.output.join("\n"),
    /AMENDED revisable-change[\s\S]*requirement delta awaiting approval:\n  added: retry\n  revised: throughput\n  removed: ack-path/);

  value.control.output.length = 0;
  console.log = (line) => value.control.output.push(String(line));
  try {
    value.lifecycle.resolveChange("revisable-change", {
      "approve-spec": true, "decision-ref": "fixture://user/delta"
    });
  } finally { console.log = log; }
  const approved = value.state();
  assert.equal(approved.pendingApprovalDelta, undefined);
  assert.equal(approved.specApproval.decisionRef, "fixture://user/delta");
  assert.equal(approved.specApproval.revision, amended.contractRevision);
  assert.match(value.control.output.join("\n"),
    /DECISION RECORDED revisable-change\n  approved requirement delta:\n  added: retry\n  revised: throughput\n  removed: ack-path/);
});

test("approval without a pending delta keeps its prior output", (t) => {
  const value = fixture(t);
  value.start();
  const log = console.log;
  console.log = (line) => value.control.output.push(String(line));
  try {
    value.lifecycle.resolveChange("revisable-change", {
      "approve-spec": true, "decision-ref": "fixture://user/spec"
    });
  } finally { console.log = log; }
  assert.equal(value.control.output.join("\n"),
    "DECISION RECORDED revisable-change\n  next: claude-foundation advance revisable-change --through build");
});

test("unapproved revisions accumulate into one approval delta", () => {
  let delta = mergeApprovalDelta(null, { added: ["a"], revised: ["b"], removed: ["c"] });
  delta = mergeApprovalDelta(delta, { added: ["c"], revised: ["a"], removed: ["b"] });
  assert.deepEqual(delta, { added: ["a"], revised: ["c"], removed: ["b"] });
  delta = mergeApprovalDelta(delta, { added: [], revised: [], removed: ["a"] });
  assert.deepEqual(delta, { added: [], revised: ["c"], removed: ["b"] });
});

test("requirement fingerprints change only with a requirement's claims or spec text", () => {
  const claims = [
    { id: "a", requirementKey: "a", scenario: "A runs", capabilities: ["test"] },
    { id: "b", requirementKey: "b", scenario: "B runs", capabilities: ["test"] }
  ];
  const spec = (aThen) => "## ADDED Requirements\n\n### Requirement: a\n\nA SHALL run.\n\n" +
    `#### Scenario: A runs\n\n- **WHEN** a\n- **THEN** ${aThen}\n\n` +
    "### Requirement: b\n\nB SHALL run.\n\n#### Scenario: B runs\n\n- **WHEN** b\n- **THEN** ok\n";
  const before = requirementFingerprints({ claims, specTexts: [spec("one")] });
  const after = requirementFingerprints({ claims, specTexts: [spec("two")] });
  assert.deepEqual(requirementDelta(before, after), { added: [], revised: ["a"], removed: [] });
  assert.deepEqual(requirementDelta(before, before), { added: [], revised: [], removed: [] });
});
