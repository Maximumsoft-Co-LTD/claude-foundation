import assert from "node:assert/strict";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  apiContractErrorIssues, createChangeLifecycle
} from "../runtime/workflow/change-lifecycle.mjs";
import {
  amendmentTaskRepositoryIssues, amendmentVerifyPathIssues, taskRepositoryIssues,
  verifyDirectoryTargets, verifyPathIssues, verifyTestFileReferences
} from "../runtime/workflow/semantic-amendment.mjs";
import { verifySpecSync } from "../runtime/workflow/spec-sync-verify.mjs";
import { verifyCountAdvisories } from "../runtime/workflow/validation/design-blueprints.mjs";
import { CORE_DISCOVERY_DIMENSIONS } from
  "../runtime/workflow/validation/semantic-intake.mjs";
import { assertSpecApproval } from "../runtime/core/user-decisions.mjs";

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function draft(overrides = {}) {
  return {
    version: 1,
    id: "atomic-change",
    intent: "Create one atomic change",
    why: "Avoid partial change state",
    currentState: "Draft creation can fail after persistence",
    compatibility: "No compatibility impact",
    changes: ["Publish the agreement only after validation"],
    nonGoals: ["No product implementation"],
    decisions: [{ choice: "Use rollback", why: "Keep retries clean" }],
    risks: [{ risk: "Partial state", mitigation: "Rollback", owner: "runtime" }],
    tasks: [{ id: "T001", outcome: "Implement atomically", verify: "npm test" }],
    claims: [{
      id: "atomic-outcome", scenario: "Atomic start succeeds", impact: "low",
      capabilities: ["test"]
    }],
    specs: [{
      name: "atomic-change", operation: "added", requirement: "Atomic start",
      description: "The runtime SHALL avoid partial state.",
      scenarios: [{ name: "Rollback", when: "start fails", then: "state is removed" }]
    }],
    acceptance: { required: false, reason: null, claimIds: [] },
    impact: "low",
    coupling: "isolated",
    securityTriggers: [],
    execution: {
      version: 1,
      providers: { test: { adapter: "test-discovery", command: ["npm", "test"] } },
      services: {}
    },
    ...overrides
  };
}

function fixture(t, { validationFailure = null, sandboxFailure = null, catalog = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foundation-atomic-start-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const changes = join(root, "openspec", "changes");
  const runtime = join(root, ".foundation", "runtime");
  const calls = { draftReads: 0, rollback: 0, sequence: [] };
  const dirtyTarget = {};
  for (const schema of ["foundation-rapid", "foundation-standard"]) {
    const templates = join(root, "openspec", "schemas", schema, "templates");
    mkdirSync(templates, { recursive: true });
    writeFileSync(join(templates, "proposal.md"), "# <title>\n");
    writeFileSync(join(templates, "tasks.md"), "- [ ] **T001** replace-with-task\n");
    writeJson(join(templates, "evidence.yaml"), {
      version: 2,
      claims: [{
        id: "replace-with-stable-claim-id", scenario: "replace-with", impact: "low",
        capabilities: ["test"]
      }]
    });
    writeJson(join(templates, "execution.yaml"), { version: 1, providers: {}, services: {} });
    writeJson(join(templates, "repositories.yaml"), {
      version: 1, repositories: [{ id: "root", mode: "write", dependsOn: [] }]
    });
    writeJson(join(templates, "handoffs.yaml"), { version: 1, operations: [] });
    writeFileSync(join(templates, "design.md"), "# Design for <title>\n");
    writeFileSync(join(templates, "spec.md"), "## ADDED Requirements\n");
  }
  const draftPath = join(root, "draft.json");
  writeJson(draftPath, draft());
  const fail = (message) => { throw new Error(message); };
  const lifecycle = createChangeLifecycle({
    root,
    policy: () => ({ workflow: { grounding: "optional" }, land: {} }),
    securityTerms: ["authentication"],
    fail,
    pathInside: () => true,
    readJson: (path) => {
      if (path === draftPath) calls.draftReads += 1;
      return JSON.parse(readFileSync(path, "utf8"));
    },
    writeJson,
    slugify: (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    changePath: (id) => join(changes, id),
    loadRuntime: (id) => JSON.parse(readFileSync(join(runtime, `${id}.json`), "utf8")),
    saveRuntime: (state) => writeJson(join(runtime, `${state.id}.json`), state),
    setOperationChangeId: () => {},
    initialBudget: () => ({}),
    gitHead: () => "head",
    preexistingDirty: () => ({ ...dirtyTarget }),
    now: () => "2026-09-02T00:00:00.000Z",
    bindClaudeSession: () => { calls.sequence.push("bind"); },
    validate: (...args) => {
      calls.sequence.push({ validate: args });
      if (validationFailure) throw new Error(validationFailure);
    },
    createSandbox: () => {
      calls.sequence.push("sandbox");
      if (sandboxFailure) throw new Error(sandboxFailure);
    },
    showPacket: () => { calls.sequence.push("packet"); },
    measureStage: (_stage, operation) => operation(),
    trapFailures: (operation) => operation(),
    rollbackStart: (id) => {
      calls.rollback += 1;
      rmSync(join(changes, id), { recursive: true, force: true });
      rmSync(join(runtime, `${id}.json`), { force: true });
      return [];
    },
    ...(catalog ? { repositoryCatalog: () => catalog(root) } : {})
  });
  return { root, changes, runtime, draftPath, lifecycle, calls, dirtyTarget };
}

test("atomic start reads once, validates explicitly, then publishes agreement state", (t) => {
  const value = fixture(t);
  value.lifecycle.startAtomic(value.draftPath);
  assert.equal(value.calls.draftReads, 1);
  assert.equal(value.calls.rollback, 0);
  assert.deepEqual(value.calls.sequence.map((entry) =>
    typeof entry === "string" ? entry : "validate"),
  ["validate", "bind"]);
  assert.deepEqual(value.calls.sequence[0].validate, ["atomic-change", "root"]);
  assert.equal(existsSync(join(value.changes, "atomic-change")), true);
  assert.equal(existsSync(join(value.runtime, "atomic-change.json")), true);
  assert.equal(JSON.parse(readFileSync(join(value.runtime, "atomic-change.json"))).status, "change");
});

test("atomic start consumes its transient draft only after success", (t) => {
  const value = fixture(t);
  value.lifecycle.startAtomic(value.draftPath, { consumeDraft: true });
  assert.equal(existsSync(value.draftPath), false);
  assert.equal(existsSync(join(value.changes, "atomic-change")), true);
});

test("v4 start persists completed intake effectiveness before deleting its snapshot", (t) => {
  const value = fixture(t);
  const semantic = {
    version: 4,
    id: "semantic-intake-change",
    intent: "Add a bounded semantic outcome",
    impact: "low",
    coupling: "isolated",
    requirements: [{
      key: "semantic-outcome", capability: "semantic-intake-change", operation: "added",
      scenarios: [{ name: "Bounded input", when: "A bounded input arrives",
        then: "The bounded result is returned" }],
      outcome: "The bounded result is returned"
    }],
    tasks: [{
      key: "implement-semantic-outcome", outcome: "Implement the bounded result",
      covers: ["semantic-outcome"], paths: ["src/**"], verify: "npm test"
    }],
    evidence: { "semantic-outcome": { capabilities: ["test"] } }
  };
  // An ordinary v4 draft needs neither coverage rows nor a copied source
  // digest: the first inspection completes intake.
  writeJson(value.draftPath, semantic);
  const acknowledgement = value.lifecycle.inspectDraft(value.draftPath);
  assert.equal(acknowledgement.action, "DONE");

  value.lifecycle.startAtomic(value.draftPath);
  const runtime = JSON.parse(readFileSync(join(
    value.runtime, "semantic-intake-change.json"), "utf8"));
  assert.equal(runtime.semanticIntakeEffectiveness.version, 1);
  assert.equal(runtime.semanticIntakeEffectiveness.history.observed, true);
  assert.equal(existsSync(join(value.root, acknowledgement.intakeState.path)), false);
});

function minimalRapidV4(overrides = {}) {
  return {
    version: 4,
    id: "single-shot-change",
    intent: "Return the bounded result",
    impact: "low",
    coupling: "isolated",
    requirements: [{
      key: "bounded-result", capability: "single-shot-change", operation: "added",
      scenarios: [{ name: "Bounded input", when: "A bounded input arrives",
        then: "The bounded result is returned" }],
      outcome: "The bounded result is returned"
    }],
    tasks: [{
      key: "implement-bounded-result", outcome: "Implement the bounded result",
      covers: ["bounded-result"], paths: ["src/**"], verify: "npm test"
    }],
    evidence: { "bounded-result": { capabilities: ["test"] } },
    ...overrides
  };
}

function captureLog(operation) {
  const lines = [];
  const prior = console.log;
  console.log = (...args) => { lines.push(args.join(" ")); };
  try { return { result: operation(), output: lines.join("\n") }; }
  finally { console.log = prior; }
}

test("bare start inspects and starts a correct v4 draft in one command", (t) => {
  const value = fixture(t);
  writeJson(value.draftPath, minimalRapidV4());
  const { output } = captureLog(() => value.lifecycle.startAtomic(value.draftPath));
  assert.match(output, /^AGREED single-shot-change/m);
  assert.match(output, /next: claude-foundation advance single-shot-change --approve-spec/);
  // The compiled files are listed so the agent never guesses artifact paths.
  assert.match(output, /\n  file: openspec\/changes\/single-shot-change\/proposal\.md\n/);
  assert.match(output, /\n  file: openspec\/changes\/single-shot-change\/tasks\.md\n/);
  // A compiled rapid packet carries a concise delta spec, so Land records the
  // behavior in openspec/specs; skip_specs would contradict it.
  assert.match(output, /\n  file: openspec\/changes\/single-shot-change\/specs\/[a-z0-9-]+\/spec\.md\n/);
  assert.doesNotMatch(output, /\n  specs: none/);
  assert.equal(readFileSync(join(value.changes, "single-shot-change", ".openspec.yaml"), "utf8"),
    "schema: foundation-rapid\n");
  assert.match(output, /\n  task: T001\b/);
  // One authoritative next step: no per-step `next` from CREATED/RESOLVED.
  assert.doesNotMatch(output, /complete artifacts, validate, then \/build/);
  assert.equal((output.match(/\n  next: /g) || []).length, 1);
  assert.match(output, /next: claude-foundation advance single-shot-change --approve-spec --decision-ref <user-decision> --through build/);
  assert.equal(existsSync(join(value.changes, "single-shot-change")), true);
  const runtime = JSON.parse(readFileSync(join(value.runtime, "single-shot-change.json"), "utf8"));
  assert.equal(runtime.status, "change");
  assert.equal(runtime.schema, "foundation-rapid");
  assert.equal(runtime.semanticIntakeEffectiveness.version, 1);
  assert.equal(existsSync(value.draftPath), true, "bare start keeps the draft unless --consume-draft");
  const intakeDir = join(value.root, ".foundation", "intake");
  assert.deepEqual(existsSync(intakeDir) ? readdirSync(intakeDir) : [], []);
});

test("start persists typed risk signals for review routing, and only when declared", (t) => {
  const value = fixture(t);
  writeJson(value.draftPath, minimalRapidV4({
    riskSignals: ["input-domain", "Input-Domain"],
    requirements: [{
      key: "bounded-result", capability: "single-shot-change", operation: "added",
      scenarios: [
        { name: "Bounded input", when: "A bounded input arrives",
          then: "The bounded result is returned" },
        { name: "Negative input", kind: "boundary", when: "A negative input arrives",
          then: "The input is rejected" }
      ],
      outcome: "The bounded result is returned"
    }]
  }));
  captureLog(() => value.lifecycle.startAtomic(value.draftPath));
  const runtime = JSON.parse(readFileSync(join(value.runtime, "single-shot-change.json"), "utf8"));
  assert.deepEqual(runtime.riskSignals, ["input-domain"]);

  const plain = fixture(t);
  writeJson(plain.draftPath, minimalRapidV4());
  captureLog(() => plain.lifecycle.startAtomic(plain.draftPath));
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(
    join(plain.runtime, "single-shot-change.json"), "utf8")), "riskSignals"), false);
});

test("bare start returns the inspect action for an incomplete draft and creates nothing", (t) => {
  const value = fixture(t);
  writeJson(value.draftPath, minimalRapidV4({ requirements: [] }));
  const { result, output } = captureLog(() =>
    value.lifecycle.startAtomic(value.draftPath, { consumeDraft: true }));
  assert.equal(result.action, "EDIT");
  assert.deepEqual(JSON.parse(output), JSON.parse(JSON.stringify(result)));
  assert.equal(existsSync(value.changes), false);
  assert.equal(existsSync(value.runtime), false);
  assert.equal(existsSync(value.draftPath), true);
  assert.equal(value.calls.rollback, 0);
  assert.deepEqual(value.calls.sequence, []);
});

test("spec approval is explicit, content-bound, and separate from edits", (t) => {
  const value = fixture(t);
  value.lifecycle.startAtomic(value.draftPath);
  const statePath = join(value.runtime, "atomic-change.json");
  const state = () => JSON.parse(readFileSync(statePath));
  assert.throws(() => assertSpecApproval(value.root, "atomic-change", state()), { code: "SPEC_APPROVAL_REQUIRED" });
  assert.throws(() => value.lifecycle.resolveChange("atomic-change", { "approve-spec": true }), /decision-ref/);
  assert.throws(() => value.lifecycle.resolveChange("atomic-change", {
    "approve-spec": true, "decision-ref": "fixture://approval", impact: "high"
  }), /separately from agreement edits/);
  value.lifecycle.resolveChange("atomic-change", { "approve-spec": true, "decision-ref": "fixture://approval" });
  assert.doesNotThrow(() => assertSpecApproval(value.root, "atomic-change", state()));
  writeFileSync(join(value.changes, "atomic-change", "proposal.md"), "Different behavior");
  assert.throws(() => assertSpecApproval(value.root, "atomic-change", state()), { code: "SPEC_APPROVAL_REQUIRED" });
});

// An unamended isolated packet that drifted is restored by the harness before
// consent binds, so approval covers the approved text and the edit is saved.
test("spec approval restores a drifted unamended isolated packet before binding", (t) => {
  const value = fixture(t);
  value.lifecycle.startAtomic(value.draftPath);
  const statePath = join(value.runtime, "atomic-change.json");
  const workspace = join(value.root, "workspace");
  cpSync(join(value.changes, "atomic-change"), join(workspace, "openspec/changes/atomic-change"),
    { recursive: true });
  writeFileSync(join(workspace, "openspec/changes/atomic-change/proposal.md"), "Edited in place");
  writeJson(statePath, { ...JSON.parse(readFileSync(statePath)), workspace: { path: workspace } });
  const notices = [];
  const original = console.error;
  console.error = (line) => notices.push(String(line));
  try {
    value.lifecycle.resolveChange("atomic-change", {
      "approve-spec": true, "decision-ref": "fixture://approval"
    });
  } finally { console.error = original; }
  assert.match(notices.join("\n"), /restored the approved text and saved the edit/);
  assert.equal(readFileSync(join(workspace, "openspec/changes/atomic-change/proposal.md"), "utf8"),
    readFileSync(join(value.changes, "atomic-change/proposal.md"), "utf8"));
  assert.ok(JSON.parse(readFileSync(statePath)).specApproval.identity);
});

test("accepting target edits binds the exact edited bytes to a user decision", (t) => {
  const value = fixture(t);
  value.lifecycle.startAtomic(value.draftPath);
  const statePath = join(value.runtime, "atomic-change.json");
  writeJson(statePath, { ...JSON.parse(readFileSync(statePath)),
    workspace: { mode: "worktree", path: "/sandbox", targetDirty: {} } });
  assert.throws(() => value.lifecycle.resolveChange("atomic-change", {
    "accept-target-edits": true, "decision-ref": "fixture://accept"
  }), /No target checkout edits/);
  value.dirtyTarget["src/user.js"] = "digest-1";
  value.dirtyTarget[".foundation/x"] = "machine";
  assert.throws(() => value.lifecycle.resolveChange("atomic-change", {
    "accept-target-edits": true, "approve-spec": true, "decision-ref": "fixture://accept"
  }), /one user decision at a time/);
  value.lifecycle.resolveChange("atomic-change", {
    "accept-target-edits": true, "decision-ref": "fixture://accept"
  });
  const accepted = JSON.parse(readFileSync(statePath)).targetEditsAccepted;
  assert.deepEqual(accepted.paths, ["src/user.js"]);
  assert.equal(accepted.decisionRef, "fixture://accept");
});

test("review continuation is accepted for compatibility and changes nothing", (t) => {
  const value = fixture(t);
  value.lifecycle.startAtomic(value.draftPath);
  const path = join(value.runtime, "atomic-change.json");
  const state = JSON.parse(readFileSync(path));
  state.reviewWindow = { deadline: "2026-09-01T00:30:00Z" };
  writeJson(path, state);
  assert.throws(() => value.lifecycle.resolveChange("atomic-change", { "continue-review": true }), /decision-ref/);
  value.lifecycle.resolveChange("atomic-change", { "continue-review": true, "decision-ref": "fixture://continue" });
  const next = JSON.parse(readFileSync(path));
  assert.deepEqual(next.reviewWindow, state.reviewWindow, "there is no window to extend");
  assert.equal(next.reviewWindowHistory, undefined);
});

test("atomic start removes change and runtime state after late validation failure", (t) => {
  const value = fixture(t, { validationFailure: "invalid compiled packet" });
  assert.throws(() => value.lifecycle.startAtomic(value.draftPath, { consumeDraft: true }),
    /invalid compiled packet; partial atomic start rolled back/);
  assert.equal(value.calls.rollback, 1);
  assert.equal(existsSync(join(value.changes, "atomic-change")), false);
  assert.equal(existsSync(join(value.runtime, "atomic-change.json")), false);
  assert.equal(existsSync(value.draftPath), true);
  assert.deepEqual(value.calls.sequence.map((entry) =>
    typeof entry === "string" ? entry : "validate"), ["validate"]);
});

test("atomic start defers sandbox creation even when the later sandbox would fail", (t) => {
  const value = fixture(t, { sandboxFailure: "sandbox unavailable" });
  value.lifecycle.startAtomic(value.draftPath);
  assert.equal(value.calls.rollback, 0);
  assert.equal(existsSync(join(value.changes, "atomic-change")), true);
  assert.equal(existsSync(join(value.runtime, "atomic-change.json")), true);
  assert.deepEqual(value.calls.sequence.map((entry) =>
    typeof entry === "string" ? entry : "validate"), ["validate", "bind"]);
});

test("atomic start never rolls back a pre-existing change", (t) => {
  const value = fixture(t);
  const existing = join(value.changes, "atomic-change");
  mkdirSync(existing, { recursive: true });
  writeFileSync(join(existing, "owned-by-user"), "keep\n");
  assert.throws(() => value.lifecycle.startAtomic(value.draftPath), /change already exists/);
  assert.equal(value.calls.rollback, 0);
  assert.equal(readFileSync(join(existing, "owned-by-user"), "utf8"), "keep\n");
});

test("a low-impact semantic draft with design content keeps the standard schema", async () => {
  const { semanticDraftKeepsDesign } = await import("../runtime/workflow/change-lifecycle.mjs");
  const designed = { _semanticVersion: 4, dataModel: [{ entity: "Card", fields: ["id"], migration: "none" }] };
  // A descriptive section (file map) renders in the rapid proposal instead.
  assert.equal(semanticDraftKeepsDesign({ _semanticVersion: 4,
    fileMap: [{ path: "src/a.ts", change: "added" }] }, true), false);
  const answered = { _semanticVersion: 4,
    discovery: { decisions: [{ key: "stack", status: "resolved", choice: "Vite",
      alternatives: ["Vite", "Plain HTML"] }] } };
  assert.equal(semanticDraftKeepsDesign(designed, true), true);
  assert.equal(semanticDraftKeepsDesign(answered, true), true);
  assert.equal(semanticDraftKeepsDesign({ _semanticVersion: 4 }, true), false);
  assert.equal(semanticDraftKeepsDesign({ _semanticVersion: 4, workType: ["feature"] }, true), false);
  // Optional reader-guide prose lives in the proposal and never forces standard.
  assert.equal(semanticDraftKeepsDesign({
    _semanticVersion: 4, workType: ["feature"], summary: "Adds search",
    userStories: [{ priority: "P1", story: "Find a contact", covers: ["search"] }],
    successCriteria: ["A contact is found in one query"]
  }, true), false);
  assert.equal(semanticDraftKeepsDesign(designed, false), false);
  // Legacy drafts always carry decisions and keep their rapid lane.
  assert.equal(semanticDraftKeepsDesign({ decisions: [{ choice: "x" }] }, true), false);
});

function rapidV3WithoutEvidence(overrides = {}) {
  return {
    version: 3,
    id: "derived-evidence",
    intent: "Return the derived result",
    acceptance: { required: false },
    requirements: [{
      key: "derived-result", capability: "derived-evidence", operation: "added",
      scenario: "A derived input arrives", outcome: "The derived result is returned"
    }],
    tasks: [{
      key: "implement-derived-result", outcome: "Implement the derived result",
      covers: ["derived-result"], paths: ["src/**"], verify: "npm test"
    }],
    ...overrides
  };
}

test("a rapid draft without evidence capabilities starts with a derived test provider", (t) => {
  const value = fixture(t);
  writeJson(value.draftPath, rapidV3WithoutEvidence());
  value.lifecycle.startAtomic(value.draftPath);
  const runtime = JSON.parse(readFileSync(join(value.runtime, "derived-evidence.json"), "utf8"));
  assert.equal(runtime.schema, "foundation-rapid");
  const contract = JSON.parse(readFileSync(
    join(value.changes, "derived-evidence", "evidence.yaml"), "utf8"));
  assert.deepEqual(contract.claims.map((claim) => claim.capabilities), [["test"]]);
  assert.equal(contract.providers.test.adapter, "test-discovery");
  assert.deepEqual(contract.providers.test.command, ["sh", "-c", "npm test"]);
});

test("a draft that lands on the standard lane must declare evidence capabilities", (t) => {
  const value = fixture(t);
  writeJson(value.draftPath, rapidV3WithoutEvidence({
    decisions: [{ key: "shape", choice: "Keep one module", reason: "Smallest change" }]
  }));
  assert.throws(() => value.lifecycle.startAtomic(value.draftPath),
    /foundation-standard, which requires explicit evidence capabilities; add evidence\['derived-result'\]\.capabilities/);
  assert.equal(existsSync(join(value.changes, "derived-evidence")), false);
});

test("one start reports every detectable draft issue in a single EDIT", (t) => {
  const value = fixture(t);
  const { evidence: _omitted, ...withoutEvidence } = minimalRapidV4();
  writeJson(value.draftPath, {
    ...withoutEvidence,
    decisions: [{ key: "shape", choice: "Keep one module" }],
    domainLanguage: [{ term: "result", meaning: "The bounded output" }],
    discovery: { decisions: [{ key: "scope", status: "open", question: "Which?" }] }
  });
  const { result } = captureLog(() => value.lifecycle.startAtomic(value.draftPath));
  assert.equal(result.action, "EDIT");
  const issues = result.intake.issues.join("\n");
  assert.match(issues, /alternatives must name at least two choices/);
  assert.match(issues, /domainLanguage\[0\]\.avoid is required/);
  assert.match(issues, /requires explicit evidence capabilities; add evidence\['bounded-result'\]/);
  assert.equal(existsSync(value.changes), false);
});

test("a draft with colliding scenario titles and a settled decision starts in one pass", (t) => {
  const value = fixture(t);
  writeJson(value.draftPath, minimalRapidV4({
    requirements: [{
      key: "bounded-result", capability: "single-shot-change", operation: "added",
      scenarios: [
        { name: "New consumer", when: "A consumer arrives (v2)", then: "v2 is returned" },
        { name: "Old consumer", when: "A consumer arrives: v2", then: "v1 is returned" }
      ],
      outcome: "The bounded result is returned"
    }],
    discovery: { decisions: [{ key: "format", question: "Which format?", choice: "json" }] }
  }));
  const { output } = captureLog(() => value.lifecycle.startAtomic(value.draftPath));
  assert.match(output, /^AGREED single-shot-change/m);
  const contract = JSON.parse(readFileSync(
    join(value.changes, "single-shot-change", "evidence.yaml"), "utf8"));
  assert.deepEqual(contract.claims.map((claim) => claim.id),
    ["bounded-result-a-consumer-arrives-v2", "bounded-result-a-consumer-arrives-v2-2"]);
});

test("a minimal draft without version compiles and starts in one call", (t) => {
  const value = fixture(t);
  writeJson(value.draftPath, {
    intent: "Reject empty note titles",
    requirements: [{
      description: "The system SHALL reject a note whose title is empty",
      scenarios: [{ when: "a user submits an empty title", then: "the note is not created" }]
    }],
    tasks: [{ outcome: "Validate note titles", verify: "npm test", paths: ["src/note.js"] }]
  });
  const { output } = captureLog(() => value.lifecycle.startAtomic(value.draftPath));
  assert.match(output, /^AGREED reject-empty-note-titles/m);
  const runtime = JSON.parse(readFileSync(
    join(value.runtime, "reject-empty-note-titles.json"), "utf8"));
  assert.equal(runtime.schema, "foundation-rapid");
  const contract = JSON.parse(readFileSync(
    join(value.changes, "reject-empty-note-titles", "evidence.yaml"), "utf8"));
  assert.deepEqual(contract.claims.map((claim) => [claim.id, claim.capabilities]),
    [["reject-note-title-empty", ["test"]]]);
  assert.equal(contract.providers.test.adapter, "test-discovery");
  assert.match(readFileSync(join(value.changes, "reject-empty-note-titles", "tasks.md"), "utf8"),
    /\[key:validate-note-titles\]/);
});

// Seam: a rapid packet's concise delta spec is valid OpenSpec and Land's
// archive step (the real CLI, as apply-runtime runs it) merges it into the
// living spec exactly as for a standard change. Benchmark v3.5.29 archived a
// kanban board with no spec at all.
const REPOSITORY = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const OPENSPEC_CLI = join(REPOSITORY, "node_modules", ".bin", "openspec");

test("a rapid minimal draft compiles a delta spec that archive merges into openspec/specs", (t) => {
  if (!existsSync(OPENSPEC_CLI)) return t.skip("repository OpenSpec CLI is not installed");
  const value = fixture(t);
  writeJson(value.draftPath, {
    intent: "Create kanban board",
    requirements: [{
      description: "The system SHALL let a user add, move, and delete board cards",
      scenarios: [
        { when: "The user adds a card titled \"Buy milk\" to the To Do column of the board",
          then: "the card appears in To Do" },
        { when: "The user deletes a card", then: "the card is removed" },
        { when: "The user deletes a card", given: "the card is the last one in its column",
          then: "the column shows an empty state" }
      ]
    }],
    tasks: [{ outcome: "Build the board page", verify: "npm test", paths: ["index.html"] }],
    decisions: [{ key: "stack", choice: "Plain HTML and JavaScript", reason: "No build step" }]
  });
  const { output } = captureLog(() => value.lifecycle.startAtomic(value.draftPath));
  assert.match(output, /^AGREED create-kanban-board/m);
  const id = "create-kanban-board";
  const change = join(value.changes, id);
  const runtime = JSON.parse(readFileSync(join(value.runtime, `${id}.json`), "utf8"));
  assert.equal(runtime.schema, "foundation-rapid", "an agent default does not force the standard lane");
  assert.equal(readFileSync(join(change, ".openspec.yaml"), "utf8"), "schema: foundation-rapid\n");
  // No capability matched and none was named: the intent's noun phrase names
  // it, and the readable heading is the requirement's clause.
  assert.equal(existsSync(join(change, "specs", id)), false);
  const delta = readFileSync(join(change, "specs", "kanban-board", "spec.md"), "utf8");
  assert.match(delta, /^# kanban-board\n\n## Purpose\n\nCreate kanban board\. Requirements: Let a user add, move, and delete board cards\.\n\n## ADDED Requirements\n\n### Requirement: Let a user add, move, and delete board cards\n/);
  assert.match(delta, /The system SHALL let a user add, move, and delete board cards/);
  assert.match(delta, /#### Scenario: User adds a card titled "Buy milk" to the To Do column\n/);
  assert.match(delta, /#### Scenario: User deletes a card \(card is the last one in its column\)\n\n- \*\*GIVEN\*\* the card is the last one in its column\n- \*\*WHEN\*\* The user deletes a card\n- \*\*THEN\*\* the column shows an empty state/);
  assert.doesNotMatch(delta, /\(case \d+\)|design/i);
  const proposal = readFileSync(join(change, "proposal.md"), "utf8");
  assert.doesNotMatch(proposal, /## Why/);
  assert.match(proposal, /## Decisions\n\n- \*\*stack:\*\* Plain HTML and JavaScript — No build step \(decided by agent\)/);
  assert.equal(existsSync(join(change, "design.md")), false);

  // Archive with the shipped schemas, exactly as Land runs it.
  rmSync(join(value.root, "openspec", "schemas"), { recursive: true, force: true });
  cpSync(join(REPOSITORY, "openspec", "schemas"), join(value.root, "openspec", "schemas"),
    { recursive: true });
  cpSync(join(REPOSITORY, "openspec", "config.yaml"), join(value.root, "openspec", "config.yaml"));
  writeFileSync(join(change, "tasks.md"),
    readFileSync(join(change, "tasks.md"), "utf8").replace(/- \[ \]/g, "- [x]"));
  const run = (...args) => spawnSync(OPENSPEC_CLI, args, {
    cwd: value.root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }
  });
  const validation = run("validate", id, "--type", "change", "--strict", "--no-interactive");
  assert.equal(validation.status, 0, validation.stdout + validation.stderr);
  const archive = run("archive", id, "--yes");
  assert.equal(archive.status, 0, archive.stdout + archive.stderr);
  const living = readFileSync(join(value.root, "openspec", "specs", "kanban-board", "spec.md"), "utf8");
  // OpenSpec carries the delta's Purpose instead of its TBD placeholder.
  assert.match(living, /## Purpose\nCreate kanban board\. Requirements: /);
  assert.doesNotMatch(living, /TBD/);
  assert.match(living, /### Requirement: Let a user add, move, and delete board cards\n/);
  assert.match(living, /The system SHALL let a user add, move, and delete board cards/);
  assert.match(living, /#### Scenario: User deletes a card\n/);
  assert.deepEqual(verifySpecSync({ before: "", after: living, delta }).violations, []);
});

// Scenario finding: a rapid change carrying the typed section its work type
// recommends moved to the standard lane and then owed a failure matrix.
test("typed sections keep a low-risk draft rapid; risk still selects standard", (t) => {
  const typed = {
    workType: ["refactor", "config", "bugfix"],
    refactor: { invariants: ["Same result for every input"], characterization: "npm test" },
    configContract: [{ key: "RESULT_LIMIT", default: "10", validation: "Integer from 1 to 100" }],
    bugfix: { reproduction: "An unbounded input hangs", rootCause: "No limit",
      regression: "npm test covers the limit" }
  };
  const rapid = fixture(t);
  writeJson(rapid.draftPath, minimalRapidV4(typed));
  const { output } = captureLog(() => rapid.lifecycle.startAtomic(rapid.draftPath));
  assert.match(output, /^AGREED single-shot-change/m);
  assert.doesNotMatch(output, /carries design content/);
  const state = JSON.parse(readFileSync(join(rapid.runtime, "single-shot-change.json"), "utf8"));
  assert.equal(state.schema, "foundation-rapid");
  const proposal = readFileSync(join(rapid.changes, "single-shot-change", "proposal.md"), "utf8");
  for (const heading of ["## Refactor invariants", "## Config contract", "## Bugfix analysis"])
    assert.ok(proposal.includes(heading), heading);

  // A declared risk signal still selects standard, whose dev document asks
  // a refactor/config change for its own sections but no failure matrix.
  const standard = fixture(t);
  writeJson(standard.draftPath, minimalRapidV4({
    impact: "medium", decisions: [], why: "Bound the result without changing it",
    workType: ["refactor", "config"], refactor: typed.refactor, configContract: typed.configContract,
    componentMap: [{ component: "Result", responsibility: "Bounds the result", files: ["src/result.js"] }]
  }));
  captureLog(() => standard.lifecycle.startAtomic(standard.draftPath));
  const upgraded = JSON.parse(readFileSync(join(standard.runtime, "single-shot-change.json"), "utf8"));
  assert.equal(upgraded.schema, "foundation-standard");
});

test("a rapid docs-only draft writes no delta spec and archives without touching openspec/specs", (t) => {
  const value = fixture(t);
  writeJson(value.draftPath, minimalRapidV4({
    id: "reword-readme", intent: "Reword the README quick start", workType: ["docs"],
    requirements: [{
      key: "quick-start-wording", capability: "readme", operation: "added",
      description: "The README SHALL describe the quick start in three steps",
      outcome: "The quick start lists three steps",
      scenarios: [{ name: "Reader follows the quick start", when: "A reader opens the README",
        then: "The quick start lists three steps" }]
    }],
    tasks: [{ key: "reword", outcome: "Reword the quick start", covers: ["quick-start-wording"],
      paths: ["README.md"], verify: "npm test" }],
    evidence: { "quick-start-wording": { capabilities: ["test"] } }
  }));
  const { output } = captureLog(() => value.lifecycle.startAtomic(value.draftPath));
  assert.match(output, /^AGREED reword-readme/m);
  assert.match(output, /\n  specs: none \(docs-only change; it modifies no living spec\)\n/);
  const change = join(value.changes, "reword-readme");
  assert.equal(existsSync(join(change, "specs")), false);
  assert.equal(readFileSync(join(change, ".openspec.yaml"), "utf8"),
    "schema: foundation-rapid\nskip_specs: true\n");
  assert.match(readFileSync(join(change, "proposal.md"), "utf8"),
    /- \*\*Specs:\*\* none; docs-only work modifies no living spec/);
  // The requirement still binds evidence: Prove checks the wording.
  assert.deepEqual(JSON.parse(readFileSync(join(change, "evidence.yaml"), "utf8")).claims
    .map((claim) => claim.requirementKey), ["quick-start-wording"]);

  if (!existsSync(OPENSPEC_CLI)) return t.skip("repository OpenSpec CLI is not installed");
  rmSync(join(value.root, "openspec", "schemas"), { recursive: true, force: true });
  cpSync(join(REPOSITORY, "openspec", "schemas"), join(value.root, "openspec", "schemas"),
    { recursive: true });
  cpSync(join(REPOSITORY, "openspec", "config.yaml"), join(value.root, "openspec", "config.yaml"));
  writeFileSync(join(change, "tasks.md"),
    readFileSync(join(change, "tasks.md"), "utf8").replace(/- \[ \]/g, "- [x]"));
  const run = (...args) => spawnSync(OPENSPEC_CLI, args, {
    cwd: value.root, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }
  });
  const archive = run("archive", "reword-readme", "--yes");
  assert.equal(archive.status, 0, archive.stdout + archive.stderr);
  assert.equal(existsSync(join(value.root, "openspec", "specs", "readme")), false);
});

test("a minimal draft with ambiguous covers returns one EDIT naming covers", (t) => {
  const value = fixture(t);
  writeJson(value.draftPath, {
    intent: "Tidy note titles",
    requirements: [
      { description: "The system SHALL trim note titles",
        scenarios: [{ when: "a title has spaces", then: "the stored title is trimmed" }] },
      { description: "The system SHALL collapse repeated spaces in note titles",
        scenarios: [{ when: "a title has double spaces", then: "one space is stored" }] }
    ],
    tasks: [
      { outcome: "Trim the title", verify: "npm test", paths: ["src/note.js"] },
      { outcome: "Collapse repeated spaces", verify: "npm test", paths: ["src/note.js"] }
    ]
  });
  const { result } = captureLog(() => value.lifecycle.startAtomic(value.draftPath));
  assert.equal(result.action, "EDIT");
  const issues = result.intake.issues.join("\n");
  assert.match(issues, /tasks\[0\]\.covers must name at least one requirement/);
  assert.match(issues, /tasks\[1\]\.covers must name at least one requirement/);
  assert.equal(existsSync(value.changes), false);
});

test("a minimal draft joins an existing capability or asks which one", (t) => {
  const value = fixture(t);
  const specDir = join(value.root, "openspec", "specs", "notes");
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "spec.md"), [
    "# notes", "", "### Requirement: Note creation", "",
    "The system SHALL create a note with a title", "",
    "#### Scenario: Create", "", "- **WHEN** a user saves a note", "- **THEN** the note exists"
  ].join("\n"));
  mkdirSync(join(value.root, "openspec", "specs", "billing"), { recursive: true });
  writeFileSync(join(value.root, "openspec", "specs", "billing", "spec.md"), "# billing\n");
  writeJson(value.draftPath, {
    intent: "Send weekly digests",
    requirements: [{
      description: "The system SHALL send a weekly digest",
      scenarios: [{ when: "a week ends", then: "a digest is sent" }]
    }],
    tasks: [{ outcome: "Send digests", verify: "npm test", paths: ["src/digest.js"] }]
  });
  const { result } = captureLog(() => value.lifecycle.startAtomic(value.draftPath));
  assert.equal(result.action, "EDIT");
  assert.match(result.intake.issues.join("\n"),
    /'capability' is required: .*one of: billing, notes/);
  assert.equal(existsSync(value.changes), false);

  writeJson(value.draftPath, {
    intent: "Reject empty note titles",
    requirements: [{
      description: "The system SHALL reject a note whose title is empty",
      scenarios: [{ when: "a user submits an empty title", then: "the note is not created" }]
    }],
    tasks: [{ outcome: "Validate note titles", verify: "npm test", paths: ["src/notes/title.js"] }]
  });
  const { output } = captureLog(() => value.lifecycle.startAtomic(value.draftPath));
  assert.match(output, /^AGREED reject-empty-note-titles/m);
  assert.match(readFileSync(join(value.changes, "reject-empty-note-titles", "proposal.md"), "utf8"),
    /^\| notes \| Reject a note whose title is empty \|/m);
});

// Problems Build used to discover are agent repairs on the first inspect.
test("a verify naming a test file nobody creates is an EDIT at start", (t) => {
  const value = fixture(t);
  const missing = minimalRapidV4({ tasks: [{
    key: "implement-bounded-result", outcome: "Implement the bounded result",
    covers: ["bounded-result"], paths: ["src/**"],
    verify: "node --test tests/bounded-result.test.mjs"
  }] });
  writeJson(value.draftPath, missing);
  const { result } = captureLog(() => value.lifecycle.startAtomic(value.draftPath));
  assert.equal(result.action, "EDIT");
  assert.equal(result.owner, "agent");
  assert.match(result.intake.issues.join("\n"),
    /task 'implement-bounded-result' verify references 'tests\/bounded-result\.test\.mjs', which does not exist and no task's paths create it/);
  assert.equal(existsSync(value.changes), false);
  // A task that creates the file is accepted.
  missing.tasks[0].paths = ["src/**", "tests/bounded-result.test.mjs"];
  writeJson(value.draftPath, missing);
  assert.match(captureLog(() => value.lifecycle.startAtomic(value.draftPath)).output,
    /^AGREED single-shot-change/m);
});

test("an existing test file named by verify needs no task path", (t) => {
  const value = fixture(t);
  mkdirSync(join(value.root, "tests"), { recursive: true });
  writeFileSync(join(value.root, "tests", "bounded.test.mjs"), "");
  writeJson(value.draftPath, minimalRapidV4({ tasks: [{
    key: "implement-bounded-result", outcome: "Implement the bounded result",
    covers: ["bounded-result"], paths: ["src/**"],
    verify: "node --test ./tests/bounded.test.mjs && npm test -- tests/bounded.test.mjs:12"
  }] }));
  assert.match(captureLog(() => value.lifecycle.startAtomic(value.draftPath)).output,
    /^AGREED single-shot-change/m);
});

test("verify path references skip commands that change directory", () => {
  assert.deepEqual(verifyTestFileReferences(
    "pytest tests/test_api.py::test_ok --cov=src && sh run-test.sh reports/test.json"),
  ["tests/test_api.py", "run-test.sh"]);
  assert.deepEqual(verifyTestFileReferences("cd web && npx vitest run src/a.test.ts"), []);
  assert.deepEqual(verifyTestFileReferences("npm test -- 'src/**/*.test.ts'"), []);
  assert.deepEqual(verifyPathIssues([{ key: "a", verify: "node --test tests/x.test.mjs",
    repository: "api" }], { exists: () => false }), []);
  assert.deepEqual(amendmentVerifyPathIssues({
    addTasks: [{ key: "added", verify: "node --test tests/new.test.mjs", paths: ["src/**"] }],
    updateTasks: [{ key: "existing", verify: "node --test tests/old.test.mjs" }]
  }, "- [ ] **T001** Existing [key:existing] [paths:tests/old.test.mjs] — verify: `npm test`\n",
  { exists: () => false }), [
    "amendment task 'added' verify references 'tests/new.test.mjs', which does not exist and " +
      "no task's paths create it; correct the path in verify or add it to that task's paths"
  ]);
});

// A consumer keeps services in submodules declared in openspec/repositories.yaml.
// The catalog row shape is what repository-topology's catalog() returns.
function submoduleCatalog(root) {
  return { version: 1, repositories: [
    { id: "root", type: "root", path: root, relativePath: "." },
    { id: "hook-api", type: "submodule", path: join(root, "services/hook/hook-api"),
      relativePath: "services/hook/hook-api" },
    { id: "hook-worker", type: "submodule", path: join(root, "services/hook/hook-worker"),
      relativePath: "services/hook/hook-worker" }
  ] };
}

test("verify directory targets resolve cd chains and per-tool directory flags", () => {
  assert.deepEqual(verifyDirectoryTargets("cd services/hook/hook-api && go test ./..."),
    [{ raw: "services/hook/hook-api", outside: false, path: "services/hook/hook-api" }]);
  assert.deepEqual(verifyDirectoryTargets("cd web && cd ../api && npm test").map((row) => row.path),
    ["web", "api"]);
  assert.deepEqual(verifyDirectoryTargets("cd .. && npm test")[0].outside, true);
  assert.deepEqual(verifyDirectoryTargets("cd /tmp/x && npm test")[0].outside, true);
  assert.deepEqual(verifyDirectoryTargets("git -C 'services/hook/hook-worker' status")
    .map((row) => row.path), ["services/hook/hook-worker"]);
  assert.deepEqual(verifyDirectoryTargets("npm --prefix=web test").map((row) => row.path), ["web"]);
  // Dynamic targets are unknown, and commands that only contain "cd" are not directory changes.
  assert.deepEqual(verifyDirectoryTargets("cd \"$ROOT\" && cdk synth && npm test"), []);
});

test("a task whose files live in a declared repository must name it", (t) => {
  const repositories = submoduleCatalog("/project").repositories;
  const exists = () => false;
  // Bound to root (no repository): paths and a cd into the submodule are both repairs.
  const unbound = taskRepositoryIssues([{
    semanticKey: "api-handler", paths: ["services/hook/hook-api/internal/**"],
    verify: "cd services/hook/hook-api && go test ./..."
  }], { repositories, exists });
  assert.match(unbound.join("\n"),
    /task 'api-handler' path 'services\/hook\/hook-api\/internal\/\*\*' is inside repository 'hook-api' \(services\/hook\/hook-api\) but the task runs in root; set "repository": "hook-api"/);
  assert.match(unbound.join("\n"),
    /task 'api-handler' verify changes into 'services\/hook\/hook-api', which is repository 'hook-api'/);
  // Bound to the repository but still written from the control root.
  const rooted = taskRepositoryIssues([{
    semanticKey: "api-handler", repository: "hook-api",
    paths: ["services/hook/hook-api/internal/**"],
    verify: "cd services/hook/hook-api && go test ./..."
  }], { repositories, selection: [{ id: "hook-api", mode: "write" }], exists });
  assert.match(rooted.join("\n"),
    /path 'services\/hook\/hook-api\/internal\/\*\*' is written from the control root; task paths are relative to repository 'hook-api', so write 'internal\/\*\*'/);
  assert.match(rooted.join("\n"),
    /verify changes into 'services\/hook\/hook-api', but verify already runs from repository 'hook-api'/);
  // Another repository, or a directory outside the task repository, cannot run.
  assert.match(taskRepositoryIssues([{ semanticKey: "x", repository: "hook-api", paths: ["a/**"],
    verify: "cd ../hook-worker && go test ./..." }],
  { repositories, selection: ["hook-api"], exists }).join("\n"),
  /verify changes into '\.\.\/hook-worker', outside repository 'hook-api'/);
  assert.match(taskRepositoryIssues([{ semanticKey: "x", repository: "hook-api", paths: ["a/**"],
    verify: "cd services/hook/hook-worker && go test ./..." }],
  { repositories, selection: ["hook-api"], exists }).join("\n"),
  /which is repository 'hook-worker'; verify runs from repository 'hook-api'/);
  // A real subdirectory of the task repository with the same name is allowed.
  assert.deepEqual(taskRepositoryIssues([{ semanticKey: "x", repository: "hook-api",
    paths: ["a/**"], verify: "cd services/hook/hook-api && go test ./..." }],
  { repositories, selection: ["hook-api"],
    exists: (path) => path === "/project/services/hook/hook-api/services/hook/hook-api" }), []);
  // Selection: a named repository must be selected, and a multi-repository
  // draft binds every task.
  assert.match(taskRepositoryIssues([{ semanticKey: "x", repository: "hook-api", paths: ["a/**"],
    verify: "go test -v ./..." }], { repositories, exists }).join("\n"),
  /runs in repository 'hook-api', which the draft's 'repositories' does not list/);
  assert.match(taskRepositoryIssues([{ semanticKey: "x", repository: "hook-db", paths: ["a/**"],
    verify: "go test -v ./..." }], { repositories, selection: ["hook-db"], exists }).join("\n"),
  /names repository 'hook-db', which openspec\/repositories\.yaml does not declare/);
  assert.match(taskRepositoryIssues([{ semanticKey: "x", paths: ["docs/**"], verify: "npm test" }],
    { repositories, selection: ["hook-api"], exists }).join("\n"),
  /task 'x' names no 'repository' while the draft selects hook-api/);
  // Correct bindings, root-only work, and a project without repositories pass.
  assert.deepEqual(taskRepositoryIssues([
    { semanticKey: "a", repository: "hook-api", paths: ["internal/**"], verify: "go test -v ./..." },
    { semanticKey: "b", repository: "root", paths: ["docs/**"], verify: "cd docs && npm test" }
  ], { repositories, selection: ["root", { id: "hook-api" }], exists }), []);
  assert.deepEqual(taskRepositoryIssues([{ semanticKey: "a", paths: ["services/**"],
    verify: "npm test" }], { repositories, exists }), []);
  assert.deepEqual(taskRepositoryIssues([{ semanticKey: "a", paths: ["src/**"],
    verify: "cd web && npm test" }], { exists }), []);
  // Amendment tasks use the change's selection.
  assert.match(amendmentTaskRepositoryIssues({
    addTasks: [{ key: "n", repository: "hook-api", paths: ["a/**"], verify: "cd ../x && make" }],
    updateTasks: [{ key: "old", verify: "cd services/hook/hook-api && go test ./..." }]
  }, "- [ ] **T001** Old [key:old] [repo:hook-api] [paths:a/**] — verify: `go test -v ./...`\n",
  { repositories, selection: ["hook-api"], exists }).join("\n"),
  /amendment task 'n' verify changes into '\.\.\/x'[\s\S]*amendment task 'old' verify changes into 'services\/hook\/hook-api', but verify already runs/);
  t.diagnostic("repository binding checks are pure and need no filesystem");
});

test("change start returns an EDIT for a submodule task bound to root", (t) => {
  const value = fixture(t, { catalog: submoduleCatalog });
  const wrong = minimalRapidV4({ tasks: [{
    key: "implement-bounded-result", outcome: "Implement the bounded result",
    covers: ["bounded-result"], paths: ["services/hook/hook-api/internal/**"],
    verify: "cd services/hook/hook-api && go test -v ./..."
  }] });
  writeJson(value.draftPath, wrong);
  const { result } = captureLog(() => value.lifecycle.startAtomic(value.draftPath));
  assert.equal(result.action, "EDIT");
  assert.equal(result.owner, "agent");
  assert.match(result.intake.issues.join("\n"), /is inside repository 'hook-api'/);
  assert.equal(existsSync(value.changes), false);
  // Bound and written relative to the repository, it compiles with a selection.
  writeJson(value.draftPath, minimalRapidV4({
    repositories: [{ id: "hook-api", mode: "write" }],
    tasks: [{ ...wrong.tasks[0], repository: "hook-api", paths: ["internal/**"],
      verify: "go test -v ./..." }]
  }));
  assert.match(captureLog(() => value.lifecycle.startAtomic(value.draftPath)).output,
    /^AGREED single-shot-change/m);
  assert.match(readFileSync(join(value.changes, "single-shot-change", "tasks.md"), "utf8"),
    /\[repo:hook-api\][^\n]*\[paths:internal\/\*\*\]/);
  assert.deepEqual(JSON.parse(readFileSync(join(value.changes, "single-shot-change",
    "repositories.yaml"), "utf8")).repositories, [{ id: "hook-api", mode: "write" }]);
});

// `go test` prints `ok <package>` or `(cached)`: no test result Prove can read.
test("a verify whose known runner prints no countable result gets an advisory, not a block", (t) => {
  assert.deepEqual(verifyCountAdvisories([
    { semanticKey: "bare", verify: "go test ./..." },
    { semanticKey: "json", verify: "go test -json ./..." },
    { semanticKey: "verbose", verify: "go test -v ./..." },
    { semanticKey: "verbose-flag", verify: "go test -count=1 -test.v=true ./pkg" },
    { semanticKey: "unknown", verify: "make check" },
    { semanticKey: "node", verify: "node --test" }
  ]).map((row) => row.match(/^task '([^']+)'/)[1]), ["bare", "json"]);
  const value = fixture(t);
  writeJson(value.draftPath, minimalRapidV4({ tasks: [{
    key: "implement-bounded-result", outcome: "Implement the bounded result",
    covers: ["bounded-result"], paths: ["src/**"], verify: "go test ./..."
  }] }));
  const inspected = captureLog(() => value.lifecycle.inspectDraft(value.draftPath)).result;
  assert.equal(inspected.action, "DONE");
  assert.match(inspected.designWarnings.join("\n"),
    /task 'implement-bounded-result' verify runs 'go test' without a countable report: .*'go test -v \.\/\.\.\.'/);
  const { output } = captureLog(() => value.lifecycle.startAtomic(value.draftPath));
  assert.match(output, /^AGREED single-shot-change/m);
  assert.match(output, /^ {2}verify advisory: task 'implement-bounded-result' verify runs 'go test'/m);
});

test("the start template shows repository binding only when the project declares repositories", (t) => {
  const plain = fixture(t).lifecycle.rapidStartTemplate();
  assert.equal(plain.minimalDraftRepositories, undefined);
  assert.equal(plain.repositoryExample, undefined);
  const multi = fixture(t, { catalog: submoduleCatalog }).lifecycle.rapidStartTemplate();
  assert.match(multi.minimalDraftRepositories, /names it in 'repository'/);
  assert.deepEqual(multi.declaredRepositories, [
    { id: "hook-api", path: "services/hook/hook-api" },
    { id: "hook-worker", path: "services/hook/hook-worker" }]);
  assert.deepEqual(multi.repositoryExample.repositories, [{ id: "hook-api", mode: "write" }]);
  assert.equal(multi.repositoryExample.tasks[0].repository, "hook-api");
  // The minimal draft the agent copies stays root-only.
  assert.equal(multi.minimalDraft.repositories, undefined);
});

test("api contract errors without a status or code are an EDIT at start", (t) => {
  const value = fixture(t);
  writeJson(value.draftPath, minimalRapidV4({
    apiContracts: [{ method: "GET", path: "/results", auth: "session",
      request: "none", response: "200 list",
      errors: [{ status: 404, when: "missing" }, { when: "the store is down" },
        "rate limited", "429 too many requests", { code: "CONFLICT_STATE" }] }]
  }));
  const { result } = captureLog(() => value.lifecycle.startAtomic(value.draftPath));
  assert.equal(result.action, "EDIT");
  const issues = result.intake.issues.filter((issue) => /apiContracts/.test(issue));
  assert.deepEqual(issues.map((issue) => issue.match(/errors\[\d\]/)[0]),
    ["errors[1]", "errors[2]"]);
  assert.deepEqual(apiContractErrorIssues({ apiContracts: [{ errors: "none" }] }), []);
});

test("dev document sections and draft checks arrive together on the first inspect", (t) => {
  const value = fixture(t);
  writeJson(value.draftPath, minimalRapidV4({
    impact: "medium",
    tasks: [{
      key: "implement-bounded-result", outcome: "Implement the endpoint",
      covers: ["bounded-result"], paths: ["src/api/results.js"],
      verify: "node --test tests/api/results.test.mjs"
    }]
  }));
  const first = captureLog(() => value.lifecycle.inspectDraft(value.draftPath)).result;
  assert.equal(first.action, "EDIT");
  assert.equal(first.owner, "agent");
  const issues = first.intake.issues.join("\n");
  assert.match(issues, /dev document \(api[^)]*\) needs 'why'/);
  assert.match(issues, /dev document \(api[^)]*\) needs 'apiContracts'/);
  assert.match(issues, /verify references 'tests\/api\/results\.test\.mjs'/);
});

test("open questions are listed with the approval packet", (t) => {
  const value = fixture(t);
  writeJson(value.draftPath, minimalRapidV4({
    openQuestions: ["How long are results retained?"]
  }));
  const { result, output } = captureLog(() => value.lifecycle.startAtomic(value.draftPath));
  assert.equal(result, "single-shot-change");
  assert.match(output, /open questions \(ask with the approval\):\n {4}- How long are results retained\?/);
  assert.match(output, /next: ask these with the approval, record the answers in the draft, then claude-foundation change revise single-shot-change .*draft\.json --approve-spec --decision-ref <user-decision> --through build/);
  assert.equal((output.match(/\n  next: /g) || []).length, 1);
});
