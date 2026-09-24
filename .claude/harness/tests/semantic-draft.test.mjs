import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { normalizeSemanticDraft, semanticDraftTemplate } from "../runtime/workflow/semantic-draft.mjs";
import {
  createChangeLifecycle, draftNeedsDesign, renderDraftProposal
} from "../runtime/workflow/change-lifecycle.mjs";
import {
  appendRequirementToSpec, compileSemanticAmendment, updateTaskClaimAnnotation,
  writeSemanticAmendment
} from "../runtime/workflow/semantic-amendment.mjs";

const slugify = (value) => String(value).toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function semanticDraft(overrides = {}) {
  return {
    version: 3,
    intent: "Keep payment retries safe",
    impact: "medium",
    coupling: "coupled",
    requirements: [
      {
        key: "payment-retry",
        capability: "payment-control",
        operation: "added",
        scenarios: [
          { key: "success", kind: "success", name: "Retry succeeds", when: "a retry succeeds", then: "one payment is recorded" },
          { key: "timeout", kind: "failure", name: "Retry times out", when: "a retry times out", then: "the request remains retryable" }
        ],
        outcome: "record at most one payment"
      },
      {
        key: "audit-result",
        capability: "payment-observability",
        operation: "added",
        scenario: "A payment attempt completes",
        outcome: "An audit result is available"
      }
    ],
    tasks: [
      {
        key: "implement-retry",
        outcome: "Implement bounded retry handling",
        covers: ["payment-retry"],
        paths: ["src/payment/**"],
        verify: "npm test -- payment-retry"
      },
      {
        key: "record-audit",
        outcome: "Record the payment result",
        covers: ["audit-result"],
        dependsOn: ["implement-retry"],
        paths: ["src/audit/**"],
        verify: "npm test -- payment-audit"
      }
    ],
    evidence: {
      "payment-retry": { capabilities: ["test"] },
      "audit-result": { capabilities: ["test"] }
    },
    integrations: [{
      key: "payment-api",
      kind: "external-api",
      documentation: { source: "https://provider.example/api", version: "2026-08" },
      concerns: ["authentication", "timeout", "retry", "compatibility"],
      relatesTo: ["payment-retry"]
    }],
    ...overrides
  };
}

function semanticDraftV4(overrides = {}) {
  const value = semanticDraft({ version: 4, ...overrides });
  value.discovery = {
    coverage: [
      "current-behavior", "affected-actor", "desired-behavior", "success-path",
      "failure-path", "input-boundary", "compatibility", "non-goals", "verification",
      "security-privacy", "permission-rejection", "integration-contract",
      "timeout-retry-idempotency", "operability", "recoverability"
    ].map((dimension) => ({
      dimension, status: "covered", covers: ["payment-retry"]
    })),
    decisions: []
  };
  return value;
}

test("semantic compiler creates stable cross-ledger links from semantic keys", () => {
  const result = normalizeSemanticDraft(semanticDraft(), slugify);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.draft.claims.map((claim) => claim.id), [
    "payment-retry-success", "payment-retry-timeout", "audit-result"
  ]);
  assert.deepEqual(result.draft.tasks.map((task) => task.id), ["T001", "T002"]);
  assert.deepEqual(result.draft.tasks[0].claims,
    ["payment-retry-success", "payment-retry-timeout"]);
  assert.deepEqual(result.draft.tasks[1].dependsOn, ["T001"]);
  assert.ok(result.draft.claims[0].capabilities.includes("integration"));
  assert.ok(result.draft.claims[0].capabilities.includes("security-static"));
  assert.ok(result.draft.claims[0].capabilities.includes("resilience"));
  assert.ok(result.draft.claims[0].capabilities.includes("compatibility"));
  assert.equal(result.draft._derivedExecution, true);
  assert.ok(result.draft.execution.providers.test);
  assert.ok(result.draft.execution.providers.integration);
});

test("semantic compiler accepts discovery-complete v4 and retains v3 compatibility", () => {
  const current = normalizeSemanticDraft(semanticDraftV4(), slugify);
  assert.deepEqual(current.issues, []);
  assert.equal(current.draft._semanticVersion, 4);
  assert.equal(current.draft.discovery.coverage[0].dimension, "current-behavior");
  assert.deepEqual(normalizeSemanticDraft(semanticDraft(), slugify).issues, []);
});

test("draft inspection persists source freshness and blocks stale compilation", (t) => {
  const root = mkdtempSync(join(tmpdir(), "semantic-intake-lifecycle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "openspec", "specs"), { recursive: true });
  writeFileSync(join(root, "README.md"), "first\n");
  writeFileSync(join(root, "ignored-output.json"), "x".repeat(300_000));
  const source = semanticDraftV4({ integrations: [], securityTriggers: [] });
  source.discovery.coverage = source.discovery.coverage
    .filter((row) => ![
      "security-privacy", "permission-rejection", "integration-contract",
      "timeout-retry-idempotency", "operability", "recoverability"
    ].includes(row.dimension));
  source.discovery.coverage[0].sources = ["README.md"];
  const draftPath = join(root, "draft.json");
  const saveDraft = () => writeFileSync(draftPath, `${JSON.stringify(source, null, 2)}\n`);
  saveDraft();
  const fail = (message) => { throw new Error(message); };
  const lifecycle = createChangeLifecycle({
    root, policy: () => ({ workflow: { grounding: "optional" } }), securityTerms: [], fail,
    pathInside: (parent, candidate) => {
      const rel = relative(parent, candidate);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    },
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    writeJson: (path, value) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
    },
    slugify, measureStage: (_stage, operation) => operation(),
    git: (args) => ({
      status: 0,
      stdout: args.includes("--others")
        ? "README.md\0draft.json\0" : "README.md\0"
    }),
    changePath: (id) => join(root, "openspec", "changes", id),
    loadRuntime: () => ({}), saveRuntime: () => {}, setOperationChangeId: () => {},
    initialBudget: () => ({}), gitHead: () => "head", preexistingDirty: () => [],
    now: () => "2026-09-15T00:00:00.000Z", bindClaudeSession: () => {},
    validate: () => {}, rollbackStart: () => []
  });
  const priorLog = console.log;
  console.log = () => {};
  try {
    source.investigation = {
      version: 1, id: "missing-investigation",
      statePath: ".foundation/investigations/missing-investigation.json",
      stateDigest: "missing", sourceDigest: "missing", outcome: "ready-for-change",
      summary: "Missing", changeIntent: "Missing"
    };
    saveDraft();
    const missingInvestigation = lifecycle.inspectDraft("draft.json");
    assert.equal(missingInvestigation.action, "EDIT");
    assert.match(missingInvestigation.intake.issues.join("\n"),
      /investigation binding state is missing or unsafe/);
    delete source.investigation;
    saveDraft();
    const discovery = lifecycle.inspectDraft("draft.json");
    assert.equal(discovery.action, "EDIT");
    assert.equal(discovery.intelligence.repository.findings.some((finding) =>
      finding.path === "ignored-output.json"), false);
    source.discovery.sourceDigest = discovery.intakeState.sourceDigest;
    saveDraft();
    const ready = lifecycle.inspectDraft("draft.json");
    assert.equal(ready.action, "DONE");
    assert.equal(existsSync(join(root, ready.intakeState.path)), true);
    writeFileSync(join(root, "README.md"), "second\n");
    const stale = lifecycle.inspectDraft("draft.json");
    assert.equal(stale.action, "EDIT");
    assert.equal(stale.intake.kind, "refresh-source-coverage");
    source.why = "Acknowledge the refreshed source";
    source.discovery.sourceDigest = stale.intake?.findings?.find((finding) =>
      finding.code === "source-acknowledgement-required")?.detail?.expected ||
      stale.intakeState.sourceDigest;
    saveDraft();
    assert.equal(lifecycle.inspectDraft("draft.json").action, "DONE");
    const languagePlans = [];
    for (const intent of [
      "Preserve the selected source behavior",
      "รักษาพฤติกรรมจากแหล่งข้อมูลที่เลือก",
      "รักษา selected source behavior"
    ]) {
      source.intent = intent;
      saveDraft();
      const inspected = lifecycle.inspectDraft("draft.json");
      assert.equal(inspected.action, "DONE");
      languagePlans.push(inspected.intelligence.depth);
    }
    assert.deepEqual(languagePlans[0], languagePlans[1]);
    assert.deepEqual(languagePlans[1], languagePlans[2]);
    writeFileSync(join(root, "README.md"), "third\n");
    assert.throws(() => lifecycle.startAtomic("draft.json"),
      /current completed semantic intake/);
  } finally {
    console.log = priorLog;
  }
});

test("semantic v4 renders discovery coverage into the compiled agreement", () => {
  const input = semanticDraftV4();
  input.investigation = {
    version: 1, id: "payment-investigation",
    statePath: ".foundation/investigations/payment-investigation.json",
    stateDigest: "state-digest", sourceDigest: "source-digest",
    outcome: "ready-for-change", summary: "Retry behavior should change",
    changeIntent: "Change retry behavior"
  };
  input.discovery.coverage.find((row) => row.dimension === "compatibility").rationale =
    "Preserve caller | exporter";
  const compiled = normalizeSemanticDraft(input, slugify).draft;
  const proposal = renderDraftProposal(compiled, { intent: compiled.intent });
  assert.match(proposal, /## Requirement discovery coverage/);
  assert.match(proposal, /\| compatibility \| covered \| payment-retry \|/);
  assert.match(proposal, /Preserve caller \\\| exporter/);
  assert.match(proposal, /## Investigation handoff[\s\S]*payment-investigation/);
  assert.match(proposal, /Change retry behavior/);
});

test("semantic compiler aggregates unknown references, cycles, and placeholders", () => {
  const value = semanticDraft({
    requirements: [{
      key: "replace-with-key", capability: "change", scenario: "When",
      outcome: "Then"
    }],
    tasks: [{
      key: "one", outcome: "TODO", covers: ["missing"], dependsOn: ["one"],
      verify: "npm test"
    }],
    evidence: { ghost: { capabilities: ["test"] } },
    integrations: []
  });
  const result = normalizeSemanticDraft(value, slugify);
  const message = result.issues.join("\n");
  assert.match(message, /placeholder/);
  assert.match(message, /unknown requirement 'ghost'/);
  assert.match(message, /covers references unknown requirement/);
  assert.match(message, /dependencies contain a cycle/);
  assert.match(message, /requirements have no implementation task/);
});

test("integration contracts require explicit success and failure scenarios", () => {
  const value = semanticDraft();
  delete value.requirements[0].scenarios[1].kind;
  const result = normalizeSemanticDraft(value, slugify);
  assert.match(result.issues.join("\n"), /related scenario with kind 'failure'/);
});

test("semantic draft validates local integration documentation references", (t) => {
  const root = mkdtempSync(join(tmpdir(), "semantic-integration-doc-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "provider.md"), "# Provider API\n");
  const draft = semanticDraft();
  draft.integrations[0].documentation.source = "docs/provider.md";
  writeFileSync(join(root, "draft.json"), `${JSON.stringify(draft, null, 2)}\n`);
  const lifecycle = createChangeLifecycle({
    root, policy: () => ({ workflow: { grounding: "optional" } }), securityTerms: [],
    fail: (message) => { throw new Error(message); },
    pathInside: (parent, candidate) => {
      const rel = relative(parent, candidate);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    },
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    slugify, changePath: () => root, loadRuntime: () => ({})
  });
  assert.equal(lifecycle.loadDraft("draft.json").integrations[0]
    .documentation.source, "docs/provider.md");
  draft.integrations[0].documentation.source = "docs/missing.md";
  writeFileSync(join(root, "draft.json"), `${JSON.stringify(draft, null, 2)}\n`);
  assert.throws(() => lifecycle.loadDraft("draft.json"),
    /documentation.source must reference an existing regular file/);

  draft.integrations[0].documentation.source = "docs";
  writeFileSync(join(root, "draft.json"), `${JSON.stringify(draft, null, 2)}\n`);
  assert.throws(() => lifecycle.loadDraft("draft.json"), /existing regular file/);

  const outside = mkdtempSync(join(tmpdir(), "semantic-integration-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "provider.md"), "# Outside\n");
  symlinkSync(join(outside, "provider.md"), join(root, "docs", "outside.md"));
  draft.integrations[0].documentation.source = "docs/outside.md";
  writeFileSync(join(root, "draft.json"), `${JSON.stringify(draft, null, 2)}\n`);
  assert.throws(() => lifecycle.loadDraft("draft.json"), /existing regular file/);

  draft.integrations[0].documentation.source = "file:///etc/passwd";
  writeFileSync(join(root, "draft.json"), `${JSON.stringify(draft, null, 2)}\n`);
  assert.throws(() => lifecycle.loadDraft("draft.json"), /must use HTTPS/);

  draft.integrations[0].documentation.source = "https://provider.example/api";
  draft.integrations[0].documentation.version = "latest";
  writeFileSync(join(root, "draft.json"), `${JSON.stringify(draft, null, 2)}\n`);
  assert.throws(() => lifecycle.loadDraft("draft.json"), /must identify a fixed version/);
});

test("modified requirements merge every canonical scenario before rendering", () => {
  const source = semanticDraft({
    requirements: [{
      key: "retry-policy", capability: "payment-control", operation: "modified",
      requirement: "Retry policy", outcome: "record one result",
      scenarios: [{ name: "New rejection", when: "the provider rejects", then: "the rejection is recorded" }]
    }],
    tasks: [{
      key: "modify-retry", outcome: "Modify retry policy", covers: ["retry-policy"],
      paths: ["src/payment/**"], verify: "npm test"
    }],
    evidence: { "retry-policy": { capabilities: ["test"] } },
    integrations: []
  });
  const canonical = [
    "# payment-control", "", "## Requirements", "",
    "### Requirement: Retry policy", "", "The system SHALL retain existing behavior.", "",
    "#### Scenario: Existing success", "", "- **WHEN** a retry succeeds", "- **THEN** one result is recorded", ""
  ].join("\n");
  const result = normalizeSemanticDraft(source, slugify, {
    loadCanonicalSpec: () => canonical
  });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.draft.specs[0].scenarios.map((row) => row.name),
    ["Existing success", "New rejection"]);
});

test("semantic template is compact and delegates bookkeeping", () => {
  const template = semanticDraftTemplate();
  assert.equal(template.version, 4);
  assert.ok(template.requirements[0].key);
  assert.ok(template.tasks[0].covers.length);
  assert.equal(template.claims, undefined);
  assert.equal(template.specs, undefined);
  assert.equal(template.execution, undefined);
  assert.equal(template.grounding, undefined);
  assert.ok(template.discovery.coverage.length);
  assert.ok(template.discovery.coverage.some((row) => row.status === "needs-investigation"));
});

test("semantic materialization omits virtual-default files and writes typed extensions", (t) => {
  const root = mkdtempSync(join(tmpdir(), "semantic-materialize-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = {
    intent: "Keep payment retries safe", impact: "medium", coupling: "coupled",
    schema: "foundation-standard", groundingRequired: false,
    artifactDefaultsVersion: 2, decisionMetadataRequired: true
  };
  const writeJson = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  };
  writeJson(join(root, "evidence.yaml"), { version: 1, claims: [] });
  const lifecycle = createChangeLifecycle({
    root, policy: () => ({ workflow: { grounding: "optional" } }), securityTerms: [],
    fail: (message) => { throw new Error(message); }, pathInside: () => true,
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")), writeJson,
    slugify, changePath: () => root, loadRuntime: () => state
  });
  const mapping = "## Affected folders\n\n```text\nsrc/payment/ — retry policy\n```\n\n" +
    "| Path | Responsibility | Requirement | Task | Verification |\n" +
    "|---|---|---|---|---|\n| src/payment | Retry safely | payment-retry | implement-retry | npm test |";
  const diagram = "sequenceDiagram\nClient->>Payment: retry\nPayment-->>Client: stable result";
  const compiled = normalizeSemanticDraft(semanticDraftV4({ currentState: mapping,
    diagrams: [{ key: "retry-flow", type: "mermaid", purpose: "Retry boundary", source: diagram }]
  }), slugify).draft;
  assert.equal(draftNeedsDesign(compiled), true);
  lifecycle.materializeDraft("payment", compiled);
  assert.ok(existsSync(join(root, "design.md")));
  assert.ok(existsSync(join(root, "specs", "payment-control", "spec.md")));
  assert.equal(existsSync(join(root, "execution.yaml")), false);
  assert.equal(existsSync(join(root, "repositories.yaml")), false);
  assert.equal(existsSync(join(root, "handoffs.yaml")), false);
  const evidence = JSON.parse(readFileSync(join(root, "evidence.yaml"), "utf8"));
  assert.equal(evidence.claims[0].requirementKey, "payment-retry");
  assert.ok(evidence.providers.test);
  assert.match(readFileSync(join(root, "tasks.md"), "utf8"), /\[key:implement-retry\]/);
  assert.match(readFileSync(join(root, "design.md"), "utf8"), /payment-api/);
  const design = readFileSync(join(root, "design.md"), "utf8");
  assert.ok(design.includes(mapping));
  assert.ok(design.includes(diagram));
});

test("derived evidence commands preserve the prepared PATH and explicit execution stays unchanged", () => {
  const draft = semanticDraft();
  draft.tasks = draft.tasks.map((task) => ({ ...task, verify: "printf '%s' \"$PATH\"" }));
  const normalized = normalizeSemanticDraft(draft, slugify);
  assert.deepEqual(normalized.issues, []);
  const [executable, ...args] = normalized.draft.execution.providers.test.command;
  // A login shell can source host profiles and replace this prepared PATH.
  assert.deepEqual(args.slice(0, 1), ["-c"]);
  const preparedPath = `/prepared-node/bin:${process.env.PATH}`;
  const result = spawnSync(executable, args, { encoding: "utf8", env: {
    ...process.env, PATH: preparedPath
  } });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, preparedPath);
  const explicit = { version: 1, providers: {
    test: { command: ["sh", "-lc", "custom toolchain"], adapter: "command" }
  } };
  assert.deepEqual(normalizeSemanticDraft({ ...draft, execution: explicit }, slugify)
    .draft.execution, explicit);
});

test("semantic amendment preserves completed tasks and custom spec sections", () => {
  const tasksContent = [
    "# Tasks", "",
    "- [x] **T001** Existing outcome [key:existing-task] [claims:existing-claim] — verify: `npm test`",
    ""
  ].join("\n");
  const compiled = compileSemanticAmendment({
    amendment: {
      version: 1,
      reason: "A malformed row was discovered during Build",
      addRequirements: [{
        key: "malformed-row",
        capability: "mutation-control",
        operation: "added",
        scenario: "A malformed row exists",
        outcome: "It is reported without blocking unrelated work"
      }],
      updateTasks: [{
        key: "existing-task", covers: ["existing-behavior", "malformed-row"]
      }],
      evidence: { "malformed-row": { capabilities: ["test"] } }
    },
    contract: {
      version: 1,
      claims: [{
        id: "existing-claim", requirementKey: "existing-behavior",
        scenario: "Existing behavior", capabilities: ["test"]
      }],
      providers: { test: { adapter: "test-discovery", command: ["sh", "-lc", "npm test"] } }
    },
    tasksContent,
    slugify,
    renderTask: () => { throw new Error("no new task expected"); }
  });
  assert.deepEqual(compiled.issues, []);
  assert.match(compiled.tasksContent, /^- \[x\].*existing-claim,malformed-row/m);
  assert.equal(compiled.claims.at(-1).id, "malformed-row");
  const original = [
    "# mutation-control", "", "## ADDED Requirements", "",
    "### Requirement: Existing", "", "The system SHALL keep this.", "",
    "## Operator notes", "", "Preserve this manual section.", ""
  ].join("\n");
  const amended = appendRequirementToSpec(original, compiled.specs[0]);
  assert.match(amended, /Requirement: Existing[\s\S]*Requirement: malformed-row/);
  assert.ok(amended.indexOf("Requirement: malformed-row") < amended.indexOf("## Operator notes"));
  assert.match(amended, /## Operator notes[\s\S]*Preserve this manual section/);
  assert.equal(updateTaskClaimAnnotation(
    "- [ ] **T001** Work — verify: `npm test`", ["a"]),
  "- [ ] **T001** Work [claims:a] — verify: `npm test`");
});

test("v4 semantic amendment requires discovery delta and records it in proposal", (t) => {
  const amendment = {
    version: 1,
    reason: "Build exposed an additional bounded failure",
    addRequirements: [{
      key: "bounded-failure", capability: "mutation-control", operation: "added",
      scenario: "A bounded failure occurs", outcome: "The failure is reported"
    }],
    addTasks: [{
      key: "handle-bounded-failure", outcome: "Handle the bounded failure",
      covers: ["bounded-failure"], paths: ["src/**"], verify: "npm test"
    }],
    evidence: { "bounded-failure": { capabilities: ["test"] } }
  };
  const args = {
    amendment,
    semanticDraftVersion: 4,
    contract: { version: 1, claims: [], providers: {} },
    tasksContent: "# Tasks\n",
    slugify,
    renderTask: (task) => `- [ ] **${task.id}** ${task.outcome} [key:${task.key}] ` +
      `[claims:${task.claims.join(",")}] — verify: \`${task.verify}\`\n`
  };
  assert.match(compileSemanticAmendment(args).issues.join("\n"),
    /version 4 requires a 'discovery' object/);

  amendment.discovery = {
    coverage: [
      "current-behavior", "affected-actor", "desired-behavior", "success-path",
      "failure-path", "input-boundary", "compatibility", "non-goals", "verification"
    ].map((dimension) => ({
      dimension, status: "covered", covers: ["bounded-failure"]
    })),
    decisions: []
  };
  const compiled = compileSemanticAmendment(args);
  assert.deepEqual(compiled.issues, []);
  assert.equal(compiled.discovery.coverage.length, 9);

  const root = mkdtempSync(join(tmpdir(), "v4-amend-proposal-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "proposal.md"), "# Change\n");
  writeFileSync(join(root, "tasks.md"), "# Tasks\n");
  writeFileSync(join(root, "evidence.yaml"), JSON.stringify({ version: 1 }));
  writeSemanticAmendment(root, compiled, slugify, { schema: "foundation-rapid" });
  const proposal = readFileSync(join(root, "proposal.md"), "utf8");
  assert.match(proposal, /## Amendment discovery coverage/);
  assert.match(proposal, /\| failure-path \| covered \| bounded-failure \|/);
});

test("rapid amendments preserve skip_specs while retaining claims and tasks", (t) => {
  const root = mkdtempSync(join(tmpdir(), "rapid-amend-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, ".openspec.yaml"), "schema: foundation-rapid\nskip_specs: true\n");
  writeFileSync(join(root, "evidence.yaml"), JSON.stringify({ version: 1 }));
  const draft = normalizeSemanticDraft(semanticDraft(), slugify).draft;
  const compiled = { tasksContent: "- [x] existing task\n", claims: draft.claims,
    providers: draft.execution.providers, specs: draft.specs };
  writeSemanticAmendment(root, compiled, slugify, { schema: "foundation-rapid" });
  assert.equal(existsSync(join(root, "specs")), false);
  assert.equal(readFileSync(join(root, ".openspec.yaml"), "utf8"),
    "schema: foundation-rapid\nskip_specs: true\n");
  assert.deepEqual(JSON.parse(readFileSync(join(root, "evidence.yaml"))).claims, draft.claims);
  assert.equal(readFileSync(join(root, "tasks.md"), "utf8"), compiled.tasksContent);
});

test("semantic amendment rejects unknown task references without writing", () => {
  const compiled = compileSemanticAmendment({
    amendment: {
      version: 1,
      addRequirements: [{
        key: "new", capability: "change", scenario: "Input", outcome: "Output"
      }],
      updateTasks: [{ key: "missing", covers: ["new"] }],
      evidence: { new: { capabilities: ["test"] } }
    },
    contract: { version: 1, claims: [] },
    tasksContent: "# Tasks\n",
    slugify,
    renderTask: () => ""
  });
  assert.match(compiled.issues.join("\n"), /unknown task 'missing'/);
});

test("semantic amendment never silently replaces a completed task contract", () => {
  const compiled = compileSemanticAmendment({
    amendment: {
      version: 1,
      addRequirements: [{
        key: "new", capability: "change", scenario: "Input", outcome: "Output"
      }],
      updateTasks: [{
        key: "existing", covers: ["old", "new"],
        outcome: "A different outcome", verify: "npm run test:new"
      }],
      evidence: { new: { capabilities: ["test"] } }
    },
    contract: {
      version: 1,
      claims: [{ id: "old", requirementKey: "old", capabilities: ["test"] }]
    },
    tasksContent: "# Tasks\n\n- [x] **T001** Existing [key:existing] " +
      "[claims:old] — verify: `npm test`\n",
    slugify,
    renderTask: () => ""
  });
  assert.match(compiled.issues.join("\n"),
    /cannot replace outcome or verify; add a new task/);
  assert.equal(compiled.tasksContent, undefined);
});

test("change amend installs atomically and restores files and state on validation failure", (t) => {
  const root = mkdtempSync(join(tmpdir(), "semantic-amend-transaction-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const id = "payment-change";
  const rootChange = join(root, "openspec", "changes", id);
  const change = join(root, ".foundation", "sandboxes", id, "openspec", "changes", id);
  mkdirSync(rootChange, { recursive: true });
  writeFileSync(join(rootChange, "tasks.md"), "# Root packet stays unchanged\n");
  writeFileSync(join(root, "README.md"), "Initial amendment source.\n");
  mkdirSync(join(change, "specs", "payment-control"), { recursive: true });
  writeFileSync(join(change, "tasks.md"), [
    "# Tasks", "",
    "- [x] **T001** Existing outcome [key:existing-task] [claims:existing-claim] — verify: `npm test`",
    ""
  ].join("\n"));
  writeFileSync(join(change, "proposal.md"), "# Payment change\n");
  writeFileSync(join(change, "evidence.yaml"), `${JSON.stringify({
    version: 1,
    claims: [{
      id: "existing-claim", requirementKey: "existing-behavior",
      scenario: "Existing behavior", capabilities: ["lint"]
    }],
    providers: { lint: {
      adapter: "command", capability: "lint", claims: ["existing-claim"],
      inputs: ["src/**"], command: ["sh", "-c", "npm test"]
    } }
  }, null, 2)}\n`);
  writeFileSync(join(change, "specs", "payment-control", "spec.md"), [
    "# payment-control", "", "## ADDED Requirements", "",
    "### Requirement: Existing", "", "The system SHALL keep this.", "",
    "## Operator notes", "", "Preserve this manual section.", ""
  ].join("\n"));
  const amendmentPath = join(root, "amendment.json");
  const writeAmendment = (key, path = amendmentPath) => writeFileSync(path, `${JSON.stringify({
    version: 1,
    reason: `Add ${key}`,
    addRequirements: [{
      key, capability: "payment-control", operation: "added",
      scenario: `${key} is observed`, outcome: `${key} is handled`
    }],
    updateTasks: [{ key: "existing-task", covers: ["existing-behavior", key] }],
    evidence: { [key]: { capabilities: ["test"] } },
    discovery: {
      coverage: [
        "current-behavior", "affected-actor", "desired-behavior", "success-path",
        "failure-path", "input-boundary", "compatibility", "non-goals", "verification"
      ].map((dimension) => ({
        dimension, status: "covered", covers: [key],
        ...(dimension === "current-behavior" ? { sources: ["README.md"] } : {})
      })),
      decisions: []
    }
  }, null, 2)}\n`);
  let state = {
    id, status: "building", semanticDraftVersion: 4,
    revision: 0, contractRevision: 0, executionRevision: 0
  };
  let rejectValidation = false;
  let rejectRebind = false;
  let rejectRebindChecks = 0;
  let runContender = false;
  let contenderError = null;
  let mutateStateOnFingerprint = false;
  let lifecycle;
  const stableHash = (value) => createHash("sha256")
    .update(JSON.stringify(value)).digest("hex");
  const contractFingerprint = () => {
    if (mutateStateOnFingerprint) {
      mutateStateOnFingerprint = false;
      state = { ...state, revision: Number(state.revision || 0) + 1 };
    }
    return stableHash(JSON.parse(readFileSync(join(change, "evidence.yaml"), "utf8")));
  };
  const receipts = join(root, ".foundation", "receipts", id);
  mkdirSync(receipts, { recursive: true });
  writeFileSync(join(receipts, "lint.json"), `${JSON.stringify({
    provider: "lint", status: "pass", contractFingerprint: contractFingerprint()
  }, null, 2)}\n`);
  const initialLintReceipt = JSON.parse(readFileSync(join(receipts, "lint.json"), "utf8"));
  lifecycle = createChangeLifecycle({
    root,
    policy: () => ({ workflow: { grounding: "optional" } }),
    securityTerms: [],
    fail: (message) => { throw new Error(message); },
    pathInside: (parent, candidate) => {
      const rel = relative(parent, candidate);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    },
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    writeJson: (path, value) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
    },
    slugify,
    changePath: () => rootChange,
    activeChangePath: () => change,
    loadRuntime: () => state,
    saveRuntime: (value) => { state = structuredClone(value); },
    validate: (_changeId, validationSource) => {
      assert.equal(validationSource, "active");
      assert.match(readFileSync(join(change, "tasks.md"), "utf8"), /\[x\]/);
      if (runContender) {
        runContender = false;
        try { lifecycle.amendChange(id, "amendment.json"); }
        catch (error) { contenderError = error; }
      }
      if (rejectValidation) throw new Error("synthetic validator failure");
    },
    now: () => "2026-09-03T00:00:00.000Z",
    receiptPath: (_changeId, provider) => join(receipts, `${provider}.json`),
    receiptValidity: (_changeId, provider) => {
      const receipt = JSON.parse(readFileSync(join(receipts, `${provider}.json`), "utf8"));
      return { provider, status: receipt.status,
        validity: rejectRebind && ++rejectRebindChecks > 1 ? "invalid-artifacts" :
          receipt.contractFingerprint === contractFingerprint()
          ? "valid" : "contract-stale" };
    },
    contractFingerprint,
    requiredProviders: () => Object.keys(JSON.parse(
      readFileSync(join(change, "evidence.yaml"), "utf8")).providers),
    providerConfig: (_changeId, provider) => JSON.parse(
      readFileSync(join(change, "evidence.yaml"), "utf8")).providers[provider],
    claimsForProvider: (_changeId, provider) => {
      const contract = JSON.parse(readFileSync(join(change, "evidence.yaml"), "utf8"));
      const config = contract.providers[provider];
      return contract.claims.filter((claim) => config.claims?.includes(claim.id) ||
        claim.capabilities.includes(config.capability || provider));
    },
    relevantHash: () => "workspace",
    providerWorkspaceHash: () => "workspace",
    providerInputIdentity: () => ({ mode: "declared", fingerprint: "inputs" }),
    stableHash
  });
  const priorLog = console.log;
  console.log = () => {};
  try {
    writeAmendment("malformed-row");
    const firstInspection = lifecycle.inspectAmendment(id, "amendment.json");
    assert.equal(firstInspection.action, "EDIT");
    const firstAmendment = JSON.parse(readFileSync(amendmentPath, "utf8"));
    firstAmendment.discovery.sourceDigest = firstInspection.intakeState.sourceDigest;
    writeFileSync(amendmentPath, `${JSON.stringify(firstAmendment, null, 2)}\n`);
    assert.equal(lifecycle.inspectAmendment(id, "amendment.json").action, "DONE");
    const specPath = join(change, "specs", "payment-control", "spec.md");
    writeFileSync(join(root, "README.md"), "Changed amendment source.\n");
    assert.throws(() => lifecycle.amendChange(id, "amendment.json"),
      /current completed semantic intake/);
    const refreshed = lifecycle.inspectAmendment(id, "amendment.json");
    assert.equal(refreshed.action, "EDIT");
    firstAmendment.discovery.sourceDigest = refreshed.intake.findings.find((finding) =>
      finding.code === "source-acknowledgement-required").detail.expected;
    writeFileSync(amendmentPath, `${JSON.stringify(firstAmendment, null, 2)}\n`);
    assert.equal(lifecycle.inspectAmendment(id, "amendment.json").action, "DONE");
    runContender = true;
    lifecycle.amendChange(id, "amendment.json");
    assert.match(contenderError?.message || "", /already in progress/);
    assert.equal(state.contractRevision, 1);
    assert.equal(state.amendments.length, 1);
    assert.deepEqual(state.amendments[0].requirementKeys, ["malformed-row"]);
    assert.equal(state.amendments[0].semanticIntakeEffectiveness.history.inspections, 4);
    assert.deepEqual(state.amendments[0].invalidation.affectedTasks, ["T001"]);
    assert.deepEqual(state.amendments[0].invalidation.affectedProviders, ["test"]);
    assert.deepEqual(state.amendments[0].invalidation.proofRecovery.providers.preserved,
      ["lint"]);
    const rebound = JSON.parse(readFileSync(join(receipts, "lint.json"), "utf8"));
    assert.equal(rebound.contractFingerprint, contractFingerprint());
    assert.equal(rebound.contractRebind.reason, "unaffected-semantic-amendment");
    const audits = readdirSync(join(root, ".foundation", "evidence", id, "receipt-rebinds"));
    assert.equal(audits.length, 1);
    const audit = JSON.parse(readFileSync(join(root, ".foundation", "evidence", id,
      "receipt-rebinds", audits[0]), "utf8"));
    assert.equal(audit.priorReceiptDigest, stableHash(initialLintReceipt));
    assert.equal(audit.reboundReceiptDigest, stableHash(rebound));
    assert.equal(state.amendments[0].invalidation.rebindAudits[0].provider, "lint");
    assert.equal(state.amendments[0].invalidation.rebindAudits[0].digest, stableHash(audit));
    assert.match(readFileSync(join(change, "tasks.md"), "utf8"),
      /\[x\].*existing-claim,malformed-row/);
    assert.match(readFileSync(join(change, "proposal.md"), "utf8"),
      /Amendment discovery coverage[\s\S]*malformed-row/);
    const spec = readFileSync(join(change, "specs", "payment-control", "spec.md"), "utf8");
    assert.ok(spec.indexOf("Requirement: malformed-row") < spec.indexOf("## Operator notes"));

    const before = {
      tasks: readFileSync(join(change, "tasks.md"), "utf8"),
      evidence: readFileSync(join(change, "evidence.yaml"), "utf8"),
      proposal: readFileSync(join(change, "proposal.md"), "utf8"),
      spec: readFileSync(join(change, "specs", "payment-control", "spec.md"), "utf8"),
      receipt: readFileSync(join(receipts, "lint.json"), "utf8"),
      state: structuredClone(state)
    };
    writeAmendment("second-behavior");
    const secondInspection = lifecycle.inspectAmendment(id, "amendment.json");
    const secondAmendment = JSON.parse(readFileSync(amendmentPath, "utf8"));
    secondAmendment.discovery.sourceDigest = secondInspection.intakeState.sourceDigest;
    writeFileSync(amendmentPath, `${JSON.stringify(secondAmendment, null, 2)}\n`);
    assert.equal(lifecycle.inspectAmendment(id, "amendment.json").action, "DONE");
    mutateStateOnFingerprint = true;
    assert.throws(() => lifecycle.amendChange(id, "amendment.json"),
      /conflicted with a newer change revision/);
    assert.equal(readFileSync(join(change, "tasks.md"), "utf8"), before.tasks);
    assert.equal(readFileSync(join(receipts, "lint.json"), "utf8"), before.receipt);
    assert.equal(state.revision, before.state.revision + 1);
    before.state = structuredClone(state);
    rejectValidation = true;
    assert.throws(() => lifecycle.amendChange(id, "amendment.json"),
      /synthetic validator failure; semantic amendment rolled back/);
    assert.equal(readFileSync(join(change, "tasks.md"), "utf8"), before.tasks);
    assert.equal(readFileSync(join(change, "evidence.yaml"), "utf8"), before.evidence);
    assert.equal(readFileSync(join(change, "proposal.md"), "utf8"), before.proposal);
    assert.equal(readFileSync(join(change, "specs", "payment-control", "spec.md"), "utf8"), before.spec);
    assert.equal(readFileSync(join(receipts, "lint.json"), "utf8"), before.receipt);
    assert.equal(readFileSync(join(rootChange, "tasks.md"), "utf8"),
      "# Root packet stays unchanged\n");
    assert.deepEqual(state, before.state);

    rejectValidation = false;
    rejectRebind = true;
    rejectRebindChecks = 0;
    writeAmendment("third-behavior");
    const thirdInspection = lifecycle.inspectAmendment(id, "amendment.json");
    const thirdAmendment = JSON.parse(readFileSync(amendmentPath, "utf8"));
    thirdAmendment.discovery.sourceDigest = thirdInspection.intakeState.sourceDigest;
    writeFileSync(amendmentPath, `${JSON.stringify(thirdAmendment, null, 2)}\n`);
    assert.equal(lifecycle.inspectAmendment(id, "amendment.json").action, "DONE");
    const receiptBeforeFailedRebind = readFileSync(join(receipts, "lint.json"), "utf8");
    const auditCountBefore = readdirSync(join(root, ".foundation", "evidence", id,
      "receipt-rebinds")).length;
    assert.throws(() => lifecycle.amendChange(id, "amendment.json"),
      /failed post-rebind validation; semantic amendment rolled back/);
    assert.equal(readFileSync(join(receipts, "lint.json"), "utf8"), receiptBeforeFailedRebind);
    assert.equal(readdirSync(join(root, ".foundation", "evidence", id,
      "receipt-rebinds")).length, auditCountBefore);
    assert.deepEqual(state, before.state);
  } finally {
    console.log = priorLog;
  }
});

function revisionFixture(taskLines) {
  return {
    contract: {
      version: 1,
      claims: [
        { id: "a", requirementKey: "a", scenario: "A runs", capabilities: ["test"] },
        { id: "b", requirementKey: "b", scenario: "B runs", capabilities: ["test"] }
      ],
      providers: {
        test: { adapter: "test-discovery", command: ["sh", "-c", "npm test"] },
        lint: { adapter: "command", capability: "lint", claims: ["a", "b"],
          command: ["sh", "-c", "npm run lint"] }
      }
    },
    tasksContent: ["# Tasks", "", ...taskLines, ""].join("\n"),
    slugify,
    renderTask: (task) => `- [ ] **${task.id}** ${task.outcome} [key:${task.key}] ` +
      `[claims:${task.claims.join(",")}] — verify: \`${task.verify}\``
  };
}

const revisionSpec = [
  "# change", "", "## ADDED Requirements", "",
  "### Requirement: a", "", "The system SHALL run A.", "",
  "#### Scenario: A runs", "", "- **WHEN** a", "- **THEN** 20 per second", "",
  "### Requirement: b", "", "The system SHALL run B.", "",
  "#### Scenario: B runs", "", "- **WHEN** b", "- **THEN** ok", "",
  "## Operator notes", "", "Preserve this manual section.", ""
].join("\n");

test("semantic amendment revises an existing requirement in place", (t) => {
  const compiled = compileSemanticAmendment({
    ...revisionFixture([
      "- [x] **T001** Build A and B [key:impl] [claims:a,b] — verify: `npm test`"
    ]),
    amendment: {
      version: 1,
      reason: "Measured load changed the throughput target",
      reviseRequirements: [{
        key: "a", capability: "change", scenario: "A runs faster",
        outcome: "A runs at 50 per second"
      }],
      addTasks: [{ key: "rework-a", outcome: "Raise A throughput", covers: ["a"],
        paths: ["src/**"], verify: "npm test" }],
      evidence: { a: { capabilities: ["test"] } }
    }
  });
  assert.deepEqual(compiled.issues, []);
  assert.deepEqual(compiled.changedClaimIds, ["a"]);
  assert.deepEqual(compiled.addedClaimIds, []);
  assert.deepEqual(compiled.removedClaimIds, []);
  assert.deepEqual(compiled.revisedRequirementKeys, ["a"]);
  assert.deepEqual(compiled.claims.map((claim) => claim.id), ["b", "a"]);
  assert.equal(compiled.claims.find((claim) => claim.id === "a").scenario, "A runs faster");
  assert.match(compiled.tasksContent, /^- \[x\] \*\*T001\*\*.*\[claims:a,b\]/m);
  assert.match(compiled.tasksContent, /^- \[ \] \*\*T002\*\* Raise A throughput.*\[claims:a\]/m);
  assert.deepEqual(compiled.revisedSpecs[0].priorScenarios, ["A runs"]);

  const root = mkdtempSync(join(tmpdir(), "revise-amend-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "specs", "change"), { recursive: true });
  writeFileSync(join(root, "specs", "change", "spec.md"), revisionSpec);
  writeFileSync(join(root, "proposal.md"), "# Change\n");
  writeFileSync(join(root, "evidence.yaml"), JSON.stringify({ version: 1 }));
  writeSemanticAmendment(root, compiled, slugify, { schema: "foundation-standard" });
  const spec = readFileSync(join(root, "specs", "change", "spec.md"), "utf8");
  assert.match(spec, /#### Scenario: A runs faster[\s\S]*50 per second/);
  assert.doesNotMatch(spec, /20 per second/);
  assert.match(spec, /### Requirement: b[\s\S]*#### Scenario: B runs/);
  assert.match(spec, /## Operator notes\n\nPreserve this manual section\./);
  assert.equal(spec.match(/### Requirement:/g).length, 2);
});

test("revise and remove match the key's own block when scenario names are shared", (t) => {
  const contract = {
    version: 1,
    claims: [
      { id: "a-success", requirementKey: "a", scenario: "Success", capabilities: ["test"] },
      { id: "a-failure", requirementKey: "a", scenario: "Failure", capabilities: ["test"] },
      { id: "b", requirementKey: "b", scenario: "Success", capabilities: ["test"] }
    ],
    providers: {}
  };
  const spec = [
    "# change", "", "## ADDED Requirements", "",
    "### Requirement: a", "", "The system SHALL run A.", "",
    "#### Scenario: Success", "", "- **WHEN** a", "- **THEN** a ok", "",
    "#### Scenario: Failure", "", "- **WHEN** a fails", "- **THEN** a reported", "",
    "### Requirement: b", "", "The system SHALL run B.", "",
    "#### Scenario: Success", "", "- **WHEN** b", "- **THEN** b old", ""
  ].join("\n");
  const tasksContent = "# Tasks\n\n- [ ] **T001** Build [key:impl] [claims:a-success,a-failure,b] — verify: `npm test`\n";
  const write = (amendment) => {
    const compiled = compileSemanticAmendment({
      amendment: { version: 1, ...amendment }, contract, tasksContent, slugify,
      renderTask: () => ""
    });
    assert.deepEqual(compiled.issues, []);
    const root = mkdtempSync(join(tmpdir(), "shared-scenario-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "specs", "change"), { recursive: true });
    writeFileSync(join(root, "specs", "change", "spec.md"), spec);
    writeFileSync(join(root, "evidence.yaml"), JSON.stringify({ version: 1 }));
    writeSemanticAmendment(root, compiled, slugify, { schema: "foundation-standard" });
    return readFileSync(join(root, "specs", "change", "spec.md"), "utf8");
  };
  const revised = write({
    reviseRequirements: [{ key: "b", capability: "change", scenario: "Success",
      outcome: "B returns new" }],
    evidence: { b: { capabilities: ["test"] } }
  });
  assert.match(revised, /### Requirement: a[\s\S]*a ok[\s\S]*a reported/);
  assert.match(revised, /B returns new/);
  assert.doesNotMatch(revised, /b old/);
  const removed = write({ removeRequirements: [{ key: "b", migration: "Dropped" }] });
  assert.match(removed, /### Requirement: a[\s\S]*a ok[\s\S]*a reported/);
  assert.doesNotMatch(removed, /Requirement: b|b old/);
});

test("a revision cannot move a requirement to another capability or operation", (t) => {
  for (const [row, expected] of [
    [{ capability: "payments" }, /cannot revise 'a' from change\/added to payments\/added; remove it and add/],
    [{ capability: "change", operation: "modified" },
      /cannot revise 'a' from change\/added to change\/modified; remove it and add/]
  ]) {
    const compiled = compileSemanticAmendment({
      ...revisionFixture([
        "- [ ] **T001** Build A and B [key:impl] [claims:a,b] — verify: `npm test`"
      ]),
      amendment: {
        version: 1,
        reviseRequirements: [{ key: "a", scenario: "A runs", outcome: "A moved", ...row }],
        evidence: { a: { capabilities: ["test"] } }
      },
      loadCanonicalSpec: () => "## Requirements\n\n### Requirement: a\n\n#### Scenario: A runs\n"
    });
    assert.deepEqual(compiled.issues, []);
    const root = mkdtempSync(join(tmpdir(), "revise-move-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "specs", "change"), { recursive: true });
    writeFileSync(join(root, "specs", "change", "spec.md"), revisionSpec);
    writeFileSync(join(root, "evidence.yaml"), JSON.stringify({ version: 1 }));
    assert.throws(() => writeSemanticAmendment(root, compiled, slugify,
      { schema: "foundation-standard" }), expected);
    assert.equal(readFileSync(join(root, "specs", "change", "spec.md"), "utf8"), revisionSpec);
    assert.equal(existsSync(join(root, "specs", "payments")), false);
  }
});

test("an ambiguous requirement block fails the amendment instead of guessing", (t) => {
  const contract = { version: 1, providers: {}, claims: [
    { id: "a", requirementKey: "a", scenario: "Success", capabilities: ["test"] },
    { id: "b", requirementKey: "b", scenario: "Other", capabilities: ["test"] }
  ] };
  const compiled = compileSemanticAmendment({
    amendment: { version: 1, removeRequirements: [{ key: "a", migration: "Dropped" }] },
    contract, slugify, renderTask: () => "",
    tasksContent: "# Tasks\n\n- [ ] **T001** Build [key:impl] [claims:a,b] — verify: `npm test`\n"
  });
  assert.deepEqual(compiled.issues, []);
  const root = mkdtempSync(join(tmpdir(), "ambiguous-block-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "specs", "change"), { recursive: true });
  const spec = ["# change", "", "## ADDED Requirements", "",
    "### Requirement: a", "", "A.", "", "#### Scenario: Success", "",
    "### Requirement: a copy", "", "A again.", "", "#### Scenario: Success", ""].join("\n");
  writeFileSync(join(root, "specs", "change", "spec.md"), spec);
  writeFileSync(join(root, "evidence.yaml"), JSON.stringify({ version: 1 }));
  assert.throws(() => writeSemanticAmendment(root, compiled, slugify,
    { schema: "foundation-standard" }),
  /cannot identify the requirement block for 'a': 2 blocks carry its scenarios/);
  assert.equal(readFileSync(join(root, "specs", "change", "spec.md"), "utf8"), spec);
});

test("a revised requirement needs an open task", () => {
  const compiled = compileSemanticAmendment({
    ...revisionFixture([
      "- [x] **T001** Build A and B [key:impl] [claims:a,b] — verify: `npm test`"
    ]),
    amendment: {
      version: 1,
      reviseRequirements: [{ key: "a", capability: "change", scenario: "A runs",
        outcome: "A runs at 50 per second" }],
      evidence: { a: { capabilities: ["test"] } }
    }
  });
  assert.match(compiled.issues.join("\n"),
    /revises 'a' but no open task covers it; add a task with addTasks/);
  assert.equal(compiled.tasksContent, undefined);

  const open = compileSemanticAmendment({
    ...revisionFixture([
      "- [ ] **T001** Build A and B [key:impl] [claims:a,b] — verify: `npm test`"
    ]),
    amendment: {
      version: 1,
      reviseRequirements: [{ key: "a", capability: "change", scenario: "A runs",
        outcome: "A runs at 50 per second" }],
      evidence: { a: { capabilities: ["test"] } }
    }
  });
  assert.deepEqual(open.issues, []);
});

test("semantic amendment removes a requirement and its claims", (t) => {
  const compiled = compileSemanticAmendment({
    ...revisionFixture([
      "- [x] **T001** Build A and B [key:impl] [claims:a,b] — verify: `npm test`"
    ]),
    amendment: {
      version: 1,
      reason: "B moved to a follow-up",
      removeRequirements: [{ key: "b", migration: "B ships in a successor change" }]
    }
  });
  assert.deepEqual(compiled.issues, []);
  assert.deepEqual(compiled.removedClaimIds, ["b"]);
  assert.deepEqual(compiled.invalidatedClaims, []);
  assert.deepEqual(compiled.claims.map((claim) => claim.id), ["a"]);
  assert.deepEqual(compiled.providers.lint.claims, ["a"]);
  assert.match(compiled.tasksContent, /^- \[x\] \*\*T001\*\*.*\[claims:a\]/m);

  const root = mkdtempSync(join(tmpdir(), "remove-amend-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "specs", "change"), { recursive: true });
  writeFileSync(join(root, "specs", "change", "spec.md"), revisionSpec);
  writeFileSync(join(root, "proposal.md"), "# Change\n");
  writeFileSync(join(root, "evidence.yaml"), JSON.stringify({ version: 1 }));
  writeSemanticAmendment(root, compiled, slugify, { schema: "foundation-standard" });
  const spec = readFileSync(join(root, "specs", "change", "spec.md"), "utf8");
  assert.doesNotMatch(spec, /Requirement: b|B runs/);
  assert.match(spec, /### Requirement: a[\s\S]*## Operator notes/);
  assert.match(readFileSync(join(root, "proposal.md"), "utf8"),
    /## Amendment removed requirements[\s\S]*\| b \| B ships in a successor change \|/);
});

test("removing a requirement cannot orphan a task", () => {
  const args = revisionFixture([
    "- [x] **T001** Build A [key:impl-a] [claims:a] — verify: `npm test`",
    "- [ ] **T002** Build B [key:impl-b] [claims:b] — verify: `npm test`"
  ]);
  const orphaned = compileSemanticAmendment({ ...args, amendment: {
    version: 1, removeRequirements: [{ key: "b", migration: "Dropped" }]
  } });
  assert.match(orphaned.issues.join("\n"),
    /would leave task\(s\) T002 without requirement coverage; move their coverage with updateTasks/);
  const moved = compileSemanticAmendment({ ...args, amendment: {
    version: 1, removeRequirements: [{ key: "b", migration: "Dropped" }],
    updateTasks: [{ key: "impl-b", covers: ["a"] }]
  } });
  assert.deepEqual(moved.issues, []);
  assert.match(moved.tasksContent, /^- \[ \] \*\*T002\*\*.*\[claims:a\]/m);
});

test("amendment requirement keys are unambiguous", () => {
  const args = revisionFixture([
    "- [ ] **T001** Build A and B [key:impl] [claims:a,b] — verify: `npm test`"
  ]);
  const compile = (amendment) =>
    compileSemanticAmendment({ ...args, amendment: { version: 1, ...amendment } }).issues.join("\n");
  assert.match(compile({}),
    /requires a non-empty addRequirements, reviseRequirements, or removeRequirements array/);
  assert.match(compile({
    reviseRequirements: [{ key: "missing", capability: "change", scenario: "x", outcome: "y" }],
    evidence: { missing: { capabilities: ["test"] } }
  }), /'missing' does not exist; only existing requirements can be revised or removed/);
  assert.match(compile({
    reviseRequirements: [{ key: "a", capability: "change", scenario: "x", outcome: "y" }],
    removeRequirements: [{ key: "a", migration: "gone" }],
    evidence: { a: { capabilities: ["test"] } }
  }), /'a' is named more than once across add, revise, and remove/);
  assert.match(compile({ removeRequirements: [{ key: "b" }] }),
    /removeRequirements\[0\]\.migration is required/);
  assert.match(compile({
    removeRequirements: [{ key: "b", migration: "gone" }],
    updateTasks: [{ key: "impl", covers: ["b"] }]
  }), /covers removed requirement 'b'/);
});

test("a version-4 revision requires discovery coverage for revised requirements", () => {
  const args = revisionFixture([
    "- [ ] **T001** Build A and B [key:impl] [claims:a,b] — verify: `npm test`"
  ]);
  const amendment = {
    version: 1,
    reviseRequirements: [{ key: "a", capability: "change", scenario: "A runs",
      outcome: "A runs at 50 per second" }],
    evidence: { a: { capabilities: ["test"] } }
  };
  assert.match(compileSemanticAmendment({ ...args, amendment, semanticDraftVersion: 4 })
    .issues.join("\n"), /version 4 requires a 'discovery' object/);
  amendment.discovery = {
    coverage: [
      "current-behavior", "affected-actor", "desired-behavior", "success-path",
      "failure-path", "input-boundary", "compatibility", "non-goals", "verification"
    ].map((dimension) => ({ dimension, status: "covered", covers: ["a"] })),
    decisions: []
  };
  const compiled = compileSemanticAmendment({ ...args, amendment, semanticDraftVersion: 4 });
  assert.deepEqual(compiled.issues, []);
  assert.equal(compiled.discovery.coverage.length, 9);
});
