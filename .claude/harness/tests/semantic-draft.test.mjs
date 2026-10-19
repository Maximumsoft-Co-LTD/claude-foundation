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
import {
  deriveRepositoryTaskDependencies, derivedCapabilityPurpose, expandMinimalSemanticDraft,
  mergeSemanticDraft,
  MINIMAL_DRAFT_WRITING, minimalSemanticDraftTemplate, normalizeSemanticDraft,
  renderRequirementMarkdown, renderSpecHeading, semanticDraftTemplate,
  SEMANTIC_DRAFT_VERSIONS, isSemanticV4Plus, isSemanticVersion,
  TASK_FIELDS, unknownTaskFieldWarnings
} from "../runtime/workflow/semantic-draft.mjs";
import { requiredProvidersOperation } from "../runtime/workflow/change-validation.mjs";
import { classifyReviewRisk } from "../runtime/evidence/review-routing.mjs";
import {
  createChangeLifecycle, draftNeedsDesign, renderDraftProposal, renderDraftTask,
  semanticDraftKeepsDesign, synchronizeProposalClassification
} from "../runtime/workflow/change-lifecycle.mjs";
import {
  declaredDraftRisk, deriveDraftRisk, riskLabel, withDerivedRisk
} from "../runtime/workflow/validation/draft-risk.mjs";
import {
  amendTaskVerifyOperation, amendmentRepositoryOrderIssues, appendRequirementToSpec,
  compileSemanticAmendment,
  semanticAmendmentTemplate, taskContractOnlyAmendment, taskVerifyAmendment,
  updateTaskClaimAnnotation, verifyCannotFail, writeSemanticAmendment
} from "../runtime/workflow/semantic-amendment.mjs";
import { taskCheck } from "../runtime/workflow/session-lease.mjs";
import { groupAgentTasks } from "../runtime/workflow/agent-planning.mjs";
import {
  LIGHT_WORK, WORK_TYPES, designBlueprintIssues, designBlueprintWarnings
} from "../runtime/workflow/validation/design-blueprints.mjs";
import {
  devDocumentIssues, devDocumentShapeIssues, requiredDevSections
} from "../runtime/workflow/validation/dev-document.mjs";
import { splitProse } from "../runtime/workflow/draft-folder.mjs";

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

// v4 requires a short scenario title distinct from WHEN; the shared fixtures
// use the v3 shorthand, so name each shorthand case here.
function namedScenarios(requirement) {
  if (typeof requirement?.scenario !== "string") return requirement;
  const { scenario, ...rest } = requirement;
  return { ...rest, scenarios: [{ name: `${requirement.key} case`, when: scenario,
    then: requirement.outcome || "the result is observable" }] };
}

// A standard v4 change carries the dev document sections its work needs.
const DEV_DOCUMENT = {
  summary: "Payment retries record one payment and an audit result.",
  failureMatrix: [{ failure: "Retry times out", userSees: "A retryable error", recovery: "Retry later" }]
};

function semanticDraftV4(overrides = {}) {
  const value = semanticDraft({ version: 4, ...DEV_DOCUMENT, ...overrides });
  value.requirements = value.requirements.map(namedScenarios);
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

test("an unknown task field warns with the field it likely means and still compiles", () => {
  const draft = semanticDraft();
  const { dependsOn, ...second } = draft.tasks[1];
  draft.tasks = [draft.tasks[0], { ...second, depends: dependsOn }];
  const result = normalizeSemanticDraft(draft, slugify);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.warnings,
    ["tasks[1].depends is not a known task field; did you mean dependsOn?"]);
  assert.deepEqual(result.draft.tasks.map((task) => task.id), ["T001", "T002"]);
  assert.deepEqual(unknownTaskFieldWarnings({ tasks: [{ path: "x", verfiy: "y", tset: "w", requirement: "z" }] }), [
    "tasks[0].path is not a known task field; did you mean paths?",
    "tasks[0].verfiy is not a known task field; did you mean verify?",
    "tasks[0].tset is not a known task field",
    "tasks[0].requirement is not a known task field; did you mean covers?"
  ]);
});

test("known task fields raise no field warning; an unrelated field warns without a guess", () => {
  assert.deepEqual(normalizeSemanticDraft(semanticDraft(), slugify).warnings, []);
  const everyField = Object.fromEntries(TASK_FIELDS.map((field) => [field, "x"]));
  assert.deepEqual(unknownTaskFieldWarnings({ tasks: [everyField] }), []);
  assert.deepEqual(unknownTaskFieldWarnings({ tasks: [{ outcome: "o", estimateHours: 3 }] }),
    ["tasks[0].estimateHours is not a known task field"]);
});

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

// A superproject declares `lib` at packages/lib (a submodule). The catalog
// row shape is what repository-topology's catalog() returns.
const SUPERPROJECT_CATALOG = [
  { id: "root", type: "root", relativePath: "." },
  { id: "lib", type: "submodule", relativePath: "packages/lib", dependsOn: [] }
];

function superprojectDraft(overrides = {}) {
  return semanticDraft({
    repositories: [{ id: "root", mode: "write" }, { id: "lib", mode: "write" }],
    tasks: [
      { key: "lib-clamp", repository: "lib", outcome: "Add clamp to lib",
        covers: ["payment-retry"], paths: ["index.js"], verify: "npm test" },
      { key: "app-clamped-total", repository: "root", outcome: "Use clamp from the app",
        covers: ["audit-result"], paths: ["main.js"], verify: "npm test" }
    ],
    ...overrides
  });
}

test("a root task follows same-change tasks in a repository nested inside it", () => {
  const result = normalizeSemanticDraft(superprojectDraft(), slugify,
    { repositories: SUPERPROJECT_CATALOG });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.draft.tasks.map((task) => [task.id, task.dependsOn]),
    [["T001", []], ["T002", ["T001"]]]);
  // The derived edge serializes Build: lib first, then the consuming root task.
  const tasks = result.draft.tasks.map((task) => ({
    ...task, repository: task.repository || "root", resources: []
  }));
  assert.deepEqual(groupAgentTasks(tasks, new Set(), 4, () => false,
    (message) => { throw new Error(message); }), [["T001"], ["T002"]]);
});

test("repository task dependencies come from containment and declared dependsOn", () => {
  const nested = deriveRepositoryTaskDependencies([
    { id: "T001", repository: "lib", dependsOn: [] },
    { id: "T002", repository: "root", dependsOn: [] },
    { id: "T003", repository: "lib", dependsOn: ["T001"] }
  ], { repositories: SUPERPROJECT_CATALOG });
  assert.deepEqual(nested.issues, []);
  assert.deepEqual(nested.tasks.map((task) => task.dependsOn), [[], ["T001", "T003"], ["T001"]]);
  assert.deepEqual(nested.derived.map((row) => [row.taskId, row.dependsOn]),
    [["T002", "T001"], ["T002", "T003"]]);
  assert.match(nested.derived[0].reason, /contains repository 'lib' at packages\/lib/);
  // Sibling repositories are ordered only by a declared repository dependency;
  // an authored task edge stays the precise order, as at runtime.
  const siblings = [
    { id: "root", relativePath: "." },
    { id: "api", relativePath: "../api", dependsOn: [] },
    { id: "web", relativePath: "../web", dependsOn: [] }
  ];
  const tasks = [
    { id: "T001", repository: "api", dependsOn: [] },
    { id: "T002", repository: "web", dependsOn: [] }
  ];
  assert.deepEqual(deriveRepositoryTaskDependencies(tasks, { repositories: siblings })
    .tasks.map((task) => task.dependsOn), [[], []]);
  const declared = deriveRepositoryTaskDependencies(tasks, { repositories: siblings,
    selection: [{ id: "api", mode: "write" }, { id: "web", mode: "write", dependsOn: ["api"] }] });
  assert.deepEqual(declared.tasks.map((task) => task.dependsOn), [[], ["T001"]]);
  assert.match(declared.derived[0].reason, /repository 'web' dependsOn 'api'/);
  const authored = deriveRepositoryTaskDependencies([
    ...tasks, { id: "T003", repository: "web", dependsOn: ["T002"] }
  ], { repositories: siblings,
    selection: [{ id: "api" }, { id: "web", dependsOn: ["api"] }] });
  assert.deepEqual(authored.tasks[2].dependsOn, ["T002"]);
  // The root never contains a sibling; only its declared dependsOn orders it.
  const rootTasks = [...tasks, { id: "T003", repository: "root", dependsOn: [] }];
  assert.deepEqual(deriveRepositoryTaskDependencies(rootTasks, { repositories: siblings })
    .tasks[2].dependsOn, []);
  assert.deepEqual(deriveRepositoryTaskDependencies(rootTasks, { repositories: siblings,
    selection: [{ id: "root", dependsOn: ["web"] }, { id: "api" }, { id: "web" }] })
    .tasks[2].dependsOn, ["T002"]);
  // Root-only and unbound drafts are unchanged.
  assert.deepEqual(deriveRepositoryTaskDependencies([{ id: "T001", dependsOn: [] }],
    { repositories: SUPERPROJECT_CATALOG }).derived, []);
});

test("a derived repository edge that would close a cycle is a compile issue", () => {
  const draft = superprojectDraft();
  draft.tasks[0].dependsOn = ["app-clamped-total"];
  const result = normalizeSemanticDraft(draft, slugify, { repositories: SUPERPROJECT_CATALOG });
  assert.match(result.issues.join("\n"),
    /task 'app-clamped-total' \(repository 'root'\) must follow 'lib-clamp' .*already depends on 'app-clamped-total'/);
  assert.ok(!result.issues.some((issue) => /dependencies contain a cycle/.test(issue)));
  assert.deepEqual(result.draft.tasks[1].dependsOn, []);
});

test("Thai integration concerns derive the same security capability", () => {
  const base = semanticDraft();
  const thai = normalizeSemanticDraft(semanticDraft({
    integrations: [{ ...base.integrations[0], concerns: ["ยืนยันตัวตนของผู้ให้บริการ"] }]
  }), slugify);
  assert.deepEqual(thai.issues, []);
  assert.ok(thai.draft.claims[0].capabilities.includes("security-static"));
  assert.ok(thai.draft.securityTriggers.includes("external-integration-authentication"));
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
    // The harness records the source digest; no acknowledgement round-trip.
    const ready = lifecycle.inspectDraft("draft.json");
    assert.equal(ready.intelligence.repository.findings.some((finding) =>
      finding.path === "ignored-output.json"), false);
    assert.equal(ready.action, "DONE");
    assert.equal(existsSync(join(root, ready.intakeState.path)), true);
    writeFileSync(join(root, "README.md"), "second\n");
    const stale = lifecycle.inspectDraft("draft.json");
    assert.equal(stale.action, "EDIT");
    assert.equal(stale.intake.kind, "refresh-source-coverage");
    // After the agent re-reads, an unchanged draft reaches DONE: the snapshot
    // adopted the current inventory instead of staying stale forever.
    assert.equal(lifecycle.inspectDraft("draft.json").action, "DONE");
    writeFileSync(join(root, "README.md"), "second, revised\n");
    assert.equal(lifecycle.inspectDraft("draft.json").action, "EDIT");
    source.why = "Acknowledge the refreshed source";
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
    // Bare start re-inspects a stale snapshot and returns its action unchanged
    // instead of starting; nothing is materialized.
    const staleStart = lifecycle.startAtomic("draft.json");
    assert.equal(staleStart.action, "EDIT");
    assert.equal(staleStart.intake.kind, "refresh-source-coverage");
    assert.equal(existsSync(join(root, "openspec", "changes")), false);
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
  assert.match(proposal, /## Appendix: Discovery coverage/);
  assert.match(proposal, /\| compatibility \| covered \| payment-retry \|/);
  assert.match(proposal, /Preserve caller \\\| exporter/);
  // One investigation appendix, after Definition of done, holds the handoff and its provenance.
  assert.equal(proposal.split("## Appendix: Investigation").length - 1, 1);
  assert.ok(proposal.indexOf("## Appendix: Investigation") > proposal.indexOf("## Definition of done"));
  assert.match(proposal, /## Appendix: Investigation[\s\S]*payment-investigation[\s\S]*Change retry behavior[\s\S]*state-digest/);
  assert.doesNotMatch(proposal.slice(0, proposal.indexOf("## Appendix")), /state-digest|Change retry behavior/);
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
  // An unknown name lists the requirements it could modify.
  source.requirements[0].requirement = "Retry backoff";
  const unknown = normalizeSemanticDraft(source, slugify, { loadCanonicalSpec: () => canonical });
  assert.ok(unknown.issues.some((issue) => /cannot find canonical requirement 'Retry backoff' to modify; set requirement to one of: Retry policy$/.test(issue)),
    JSON.stringify(unknown.issues));
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
  // The template asks only for coverage its own content cannot imply, and
  // writes failures once, as scenarios, instead of a parallel matrix.
  const dimensions = template.discovery.coverage.map((row) => row.dimension);
  for (const derived of ["affected-actor", "desired-behavior", "success-path", "failure-path",
    "verification"]) assert.ok(!dimensions.includes(derived), derived);
  assert.equal(template.failureMatrix, undefined);
  assert.equal(template.summary, undefined);
  assert.deepEqual(template.requirements[0].scenarios.map((row) => row.kind), ["success", "failure"]);
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

// Build runs a repository task's verify in that repository's sandbox; the
// provider derived from it must run there too (issues #39/#40).
test("a derived provider runs in the single repository its tasks belong to", () => {
  const derived = (repositories) => {
    const draft = semanticDraft();
    draft.tasks = draft.tasks.map((task, index) => ({
      ...task, ...(repositories[index] ? { repository: repositories[index] } : {})
    }));
    return normalizeSemanticDraft(draft, slugify).draft.execution.providers;
  };
  const tasks = semanticDraft().tasks.length;
  assert.equal(derived(Array(tasks).fill("svc")).test.repository, "svc");
  assert.equal(derived([]).test.repository, undefined);
  assert.equal(derived(Array(tasks).fill("root")).test.repository, undefined);
  if (tasks > 1)
    assert.equal(derived(["svc", ...Array(tasks - 1).fill("lib")]).test.repository, undefined);
  const mixed = semanticDraft();
  mixed.tasks = [...mixed.tasks, { ...mixed.tasks[0], key: "lib-task", repository: "lib" }]
    .map((task, index) => index === 0 ? { ...task, repository: "svc" } : task);
  assert.equal(normalizeSemanticDraft(mixed, slugify).draft.execution.providers.test?.repository,
    undefined);
});

// An amendment adding a root task to a change whose lib task already exists
// gets the same containment edge start derives; a cycle is an issue.
test("an amendment's added root task follows the submodule's tasks", () => {
  const tasksContent = [
    "# Tasks", "",
    "- [x] **T001** Add clamp [key:lib-clamp] [repo:lib] [paths:index.js] " +
      "[claims:existing-claim] — verify: `npm test`",
    ""
  ].join("\n");
  const amendment = (addTasks) => ({
    version: 1,
    reason: "The app must use clamp",
    addRequirements: [{ key: "app-total", capability: "app-total", operation: "added",
      scenario: "The app totals clamped values", outcome: "The total is clamped" }],
    addTasks,
    evidence: { "app-total": { capabilities: ["test"] } }
  });
  const compile = (addTasks) => compileSemanticAmendment({
    amendment: amendment(addTasks),
    contract: { version: 1, claims: [{ id: "existing-claim", requirementKey: "lib-clamp",
      scenario: "Clamp works", capabilities: ["test"] }], providers: {} },
    tasksContent, slugify, renderTask: renderDraftTask,
    repositories: SUPERPROJECT_CATALOG,
    repositorySelection: [{ id: "root", mode: "write" }, { id: "lib", mode: "write" }]
  });
  const rootTask = { key: "app-total", repository: "root", outcome: "Use clamp",
    covers: ["app-total"], paths: ["main.js"], verify: "npm test" };
  const compiled = compile([rootTask]);
  assert.deepEqual(compiled.issues, []);
  assert.match(compiled.tasksContent, /\*\*T002\*\*[^\n]*\[repo:root\][^\n]*\[depends:T001\]/);
  const cyclic = compile([rootTask, { key: "lib-extra", repository: "lib",
    outcome: "Extend lib", covers: ["app-total"], paths: ["extra.js"], verify: "npm test",
    dependsOn: ["app-total"] }]);
  assert.match(cyclic.issues.join("\n"),
    /amendment task 'app-total' \(repository 'root'\) must follow 'lib-extra'/);
  assert.deepEqual(amendmentRepositoryOrderIssues(amendment([rootTask, { key: "lib-extra",
    repository: "lib", dependsOn: ["app-total"] }]), tasksContent, {
    repositories: SUPERPROJECT_CATALOG }), cyclic.issues);
  assert.deepEqual(amendmentRepositoryOrderIssues(amendment([rootTask]), tasksContent, {
    repositories: SUPERPROJECT_CATALOG }), []);
});

// An amendment must not derive a second, repository-less provider for a
// capability the agreement already proves (issue #40).
test("an amendment reuses the provider that already serves a capability", () => {
  const tasksContent = [
    "# Tasks", "",
    "- [x] **T001** Existing [key:t1] [repo:svc] [paths:a.go] [claims:c1] — verify: `go test ./...`",
    ""
  ].join("\n");
  const declared = (claims = "declared") => ({ adapter: "test-discovery", capability: "test",
    repository: "svc", command: ["sh", "-c", "go test ./..."], claims });
  const compile = (providers) => compileSemanticAmendment({
    amendment: {
      version: 1, reason: "Reject a reused key",
      addRequirements: [{ key: "guard", capability: "guard", operation: "added",
        scenario: "A reused key is rejected", outcome: "Rejected" }],
      addTasks: [{ key: "t2", repository: "svc", outcome: "Guard", covers: ["guard"],
        paths: ["b.go"], verify: "go test ./..." }],
      evidence: { guard: { capabilities: ["test"] } }
    },
    contract: { version: 1, providers,
      claims: [{ id: "c1", requirementKey: "r1", scenario: "S", capabilities: ["test"] }] },
    tasksContent, slugify, renderTask: renderDraftTask
  });

  const reused = compile({ "test-svc": declared() });
  assert.deepEqual(reused.issues, []);
  assert.deepEqual(Object.keys(reused.providers), ["test-svc"]);
  assert.deepEqual(reused.providers["test-svc"], declared());

  const listed = compile({ "test-svc": declared(["c1"]) });
  assert.deepEqual(listed.issues, []);
  assert.deepEqual(listed.providers["test-svc"].claims, ["c1", listed.claims.at(-1).id]);

  const byRepository = compile({ "test-svc": declared(),
    "test-lib": { ...declared(), repository: "lib" } });
  assert.deepEqual(byRepository.issues, []);
  assert.deepEqual(Object.keys(byRepository.providers).sort(), ["test-lib", "test-svc"]);

  const ambiguous = compile({ "test-a": { ...declared(), repository: "a" },
    "test-b": { ...declared(), repository: "b" } });
  assert.match(ambiguous.issues.join("\n"),
    /cannot choose which provider proves capability 'test': test-a, test-b/);

  const none = compile({});
  assert.deepEqual(none.issues, []);
  assert.equal(none.providers.test.repository, "svc");
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

test("v4 semantic amendment records an optional discovery delta in proposal", (t) => {
  const amendment = {
    version: 1,
    reason: "Build exposed an additional bounded failure",
    addRequirements: [{
      key: "bounded-failure", capability: "mutation-control", operation: "added",
      scenarios: [{ name: "Bounded failure", when: "A bounded failure occurs",
        then: "The failure is reported" }],
      outcome: "The failure is reported"
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
  // An ordinary amendment needs no discovery delta; high impact still does.
  assert.deepEqual(compileSemanticAmendment(args).issues, []);
  amendment.impact = "high";
  assert.match(compileSemanticAmendment(args).issues.join("\n"),
    /missing required dimension 'current-behavior'/);
  delete amendment.impact;

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

test("a compiled rapid packet amends its delta spec like a standard change", (t) => {
  const root = mkdtempSync(join(tmpdir(), "rapid-amend-specs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, ".openspec.yaml"), "schema: foundation-rapid\n");
  writeFileSync(join(root, "evidence.yaml"), JSON.stringify({ version: 1 }));
  const draft = normalizeSemanticDraft(semanticDraft(), slugify).draft;
  const capability = slugify(draft.specs[0].name);
  mkdirSync(join(root, "specs", capability), { recursive: true });
  writeFileSync(join(root, "specs", capability, "spec.md"), `# ${capability}\n`);
  const compiled = { tasksContent: "- [x] existing task\n", claims: draft.claims,
    providers: draft.execution.providers, specs: draft.specs };
  writeSemanticAmendment(root, compiled, slugify, { schema: "foundation-rapid" });
  assert.match(readFileSync(join(root, "specs", capability, "spec.md"), "utf8"),
    new RegExp(`### Requirement: ${draft.specs[0].requirement}`));
  assert.equal(readFileSync(join(root, ".openspec.yaml"), "utf8"), "schema: foundation-rapid\n");
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

function verifyFixture(taskLines, provider = { adapter: "test-discovery", command: ["sh", "-c", "npm tset"] }) {
  return {
    contract: {
      version: 1,
      claims: [
        { id: "a", requirementKey: "a", scenario: "A runs", capabilities: ["test"] },
        { id: "b", requirementKey: "b", scenario: "B runs", capabilities: ["lint"] }
      ],
      providers: {
        test: provider,
        lint: { adapter: "command", capability: "lint", claims: ["b"],
          command: ["sh", "-c", "npm run lint"] }
      }
    },
    tasksContent: ["# Tasks", "", ...taskLines, ""].join("\n"),
    slugify,
    renderTask: () => { throw new Error("no new task expected"); }
  };
}

test("a verify-only amendment corrects an unfinished task without requirement input", () => {
  const amendment = { version: 1, reason: "Fix the typo in the verify command",
    updateTasks: [{ key: "impl", verify: "npm test", paths: ["src/a.js"] }] };
  assert.equal(taskContractOnlyAmendment(amendment), true);
  const compiled = compileSemanticAmendment({ ...verifyFixture([
    "- [ ] **T001** Build A [key:impl] [paths:src/**] [claims:a] — verify: `npm tset`",
    "- [x] **T002** Build B [key:lint] [claims:b] — verify: `npm run lint`"
  ], { adapter: "test-discovery", command: ["sh", "-c", "(npm tset) && (npm run lint)"] }),
  amendment });
  assert.deepEqual(compiled.issues, []);
  assert.match(compiled.tasksContent,
    /^- \[ \] \*\*T001\*\* Build A \[key:impl\] \[paths:src\/a\.js\] \[claims:a\] — verify: `npm test`$/m);
  assert.match(compiled.tasksContent, /^- \[x\] \*\*T002\*\*.*verify: `npm run lint`$/m);
  // The derived provider command follows the tasks; an explicit one does not.
  assert.deepEqual(compiled.providers.test.command, ["sh", "-c", "(npm test) && (npm run lint)"]);
  assert.deepEqual(compiled.providers.lint.command, ["sh", "-c", "npm run lint"]);
  assert.deepEqual(compiled.taskContractChanges, [{
    key: "impl", id: "T001", claims: ["a"], verify: "npm test", priorVerify: "npm tset",
    paths: ["src/a.js"]
  }]);
  assert.deepEqual(compiled.invalidatedClaims, ["a"]);
  assert.deepEqual(compiled.claims, verifyFixture([]).contract.claims);
  assert.deepEqual([compiled.addedRequirementKeys, compiled.revisedRequirementKeys,
    compiled.removedRequirementKeys], [[], [], []]);
});

// A task added for a requirement the agreement already has needs no
// requirement change (issue #43, decided by the user).
test("an amendment adds a task for an existing requirement without requirement input", () => {
  const args = { ...verifyFixture([
    "- [x] **T001** Build A [key:impl] [claims:a] — verify: `npm test`"
  ]), renderTask: renderDraftTask };
  const amendment = { version: 1, reason: "Add a dedicated check script",
    addTasks: [{ key: "check-script", outcome: "Check A with its script", covers: ["a"],
      paths: ["scripts/check-a.sh"], verify: "sh scripts/check-a.sh" }] };
  assert.equal(taskContractOnlyAmendment(amendment), true);
  const compiled = compileSemanticAmendment({ ...args, amendment });
  assert.deepEqual(compiled.issues, []);
  assert.match(compiled.tasksContent, /^- \[x\] \*\*T001\*\*/m, "completed work keeps its status");
  assert.match(compiled.tasksContent, /^- \[ \] \*\*T002\*\*.*\[claims:a\].*sh scripts\/check-a\.sh/m);
  assert.deepEqual(compiled.invalidatedClaims, ["a"]);
  assert.deepEqual([compiled.addedRequirementKeys, compiled.revisedRequirementKeys,
    compiled.removedRequirementKeys], [[], [], []]);
  assert.deepEqual(compiled.claims, args.contract.claims);

  const unknown = compileSemanticAmendment({ ...args, amendment: { ...amendment,
    addTasks: [{ ...amendment.addTasks[0], covers: ["missing"] }] } });
  assert.match(unknown.issues.join("\n"), /task 'check-script' covers unknown requirement 'missing'/);
  const uncovered = compileSemanticAmendment({ ...args, amendment: { ...amendment,
    addTasks: [{ ...amendment.addTasks[0], covers: [] }] } });
  assert.match(uncovered.issues.join("\n"), /task 'check-script' must cover at least one requirement/);
});

test("a completed-task refusal names the state that completed it", () => {
  const amendment = { version: 1, updateTasks: [{ key: "impl", verify: "npm test" }] };
  const ticked = compileSemanticAmendment({ ...verifyFixture([
    "- [x] **T001** Build A [key:impl] [claims:a] — verify: `npm tset`"
  ]), amendment });
  assert.match(ticked.issues.join("\n"),
    /task 'impl' \(T001\) counts as completed because it is ticked in the agreement's tasks\.md/);
  const receipted = compileSemanticAmendment({ ...verifyFixture([
    "- [ ] **T001** Build A [key:impl] [claims:a] — verify: `npm tset`"
  ]), amendment, provenClaimIds: ["a"] });
  assert.match(receipted.issues.join("\n"),
    /task 'impl' \(T001\) counts as completed because its claims already have a passing command receipt/);
});

test("a verify-only amendment cannot rewrite completed or proven work", () => {
  const amendment = { version: 1, updateTasks: [{ key: "impl", verify: "npm test" }] };
  const checked = compileSemanticAmendment({ ...verifyFixture([
    "- [x] **T001** Build A [key:impl] [claims:a] — verify: `npm tset`"
  ]), amendment });
  assert.match(checked.issues.join("\n"),
    /updateTasks\[0\] cannot replace verify; add a new task so completed work keeps its meaning/);
  assert.equal(checked.tasksContent, undefined);
  const open = verifyFixture(["- [ ] **T001** Build A [key:impl] [claims:a] — verify: `npm tset`"]);
  assert.match(compileSemanticAmendment({ ...open, amendment, provenClaimIds: ["a"] })
    .issues.join("\n"), /cannot replace verify/);
  assert.deepEqual(compileSemanticAmendment({ ...open, amendment, provenClaimIds: ["b"] })
    .issues, []);
  // Resending the current command changes nothing and is refused as a no-op.
  assert.match(compileSemanticAmendment({ ...open, amendment: { version: 1,
    updateTasks: [{ key: "impl", verify: "npm tset" }] } }).issues.join("\n"),
  /changes no verify command or paths/);
  assert.match(compileSemanticAmendment({ ...open, amendment: { version: 1,
    updateTasks: [{ key: "impl", verify: "npm `x`" }] } }).issues.join("\n"),
  /verify must be a non-empty one-line command without backticks/);
  // Outcome and covers are not verify-only; they still need a requirement change.
  for (const row of [{ key: "impl", verify: "npm test", outcome: "Other" },
    { key: "impl", verify: "npm test", covers: ["a"] }]) {
    assert.equal(taskContractOnlyAmendment({ version: 1, updateTasks: [row] }), false);
    assert.match(compileSemanticAmendment({ ...open, amendment: { version: 1, updateTasks: [row] } })
      .issues.join("\n"), /requires a non-empty addRequirements/);
  }
});

// The agent corrects a wrong verify command directly: `change amend <change>
// --task <key|id> --verify <command>`. Only the task's check changes; claims,
// capabilities, and the approval stay, and the harness accepts the task only
// when the new command passes in the workspace.
test("a direct verify correction names a task by id and never weakens evidence", () => {
  const fixture = verifyFixture([
    "- [ ] **T001** Build A [key:impl] [claims:a] — verify: `npm tset`",
    "- [x] **T002** Build B [key:lint] [claims:b] — verify: `npm run lint`"
  ]);
  const amendment = taskVerifyAmendment({ task: "t001", verify: " node --test a.test.js " });
  assert.deepEqual(amendment, { version: 1,
    reason: "Correct the verify command of task 't001'",
    updateTasks: [{ key: "t001", verify: "node --test a.test.js" }] });
  assert.equal(taskContractOnlyAmendment(amendment), true);
  const compiled = compileSemanticAmendment({ ...fixture, amendment });
  assert.deepEqual(compiled.issues, []);
  assert.deepEqual(compiled.taskContractChanges, [{ key: "impl", id: "T001", claims: ["a"],
    verify: "node --test a.test.js", priorVerify: "npm tset" }]);
  // tasks.md stays the sole ledger, and the harness re-verification reads the
  // corrected command from it before ticking the task.
  assert.deepEqual(taskCheck(compiled.tasksContent, "T001"),
    { taskId: "T001", command: "node --test a.test.js", repository: "root" });
  assert.deepEqual(compiled.claims, fixture.contract.claims);
  assert.deepEqual(Object.fromEntries(Object.entries(compiled.providers).map(([name, row]) =>
    [name, [row.adapter, row.capability, row.claims]])),
  Object.fromEntries(Object.entries(fixture.contract.providers).map(([name, row]) =>
    [name, [row.adapter, row.capability, row.claims]])));
  for (const noop of ["true", ":", "exit 0", "echo ok", "npm test || true", "(npm test || :)",
    "npm test; true", "npm test; echo done", "npm test | true", "npm test || true # ignore",
    "(npm test; :)", "npm test & exit 0"]) {
    assert.equal(verifyCannotFail(noop), true, noop);
    assert.match(compileSemanticAmendment({ ...fixture,
      amendment: taskVerifyAmendment({ task: "impl", verify: noop }) }).issues.join("\n"),
    /cannot be a command that always passes/, noop);
  }
  for (const check of ["npm test", "node --test", "true-check", "pytest -k echo",
    "npm test && echo ok", "npm test && true", "npm test # true", "grep -q '#x' f; npm test"])
    assert.equal(verifyCannotFail(check), false, check);
  assert.match(compileSemanticAmendment({ ...fixture,
    amendment: taskVerifyAmendment({ task: "T002", verify: "npm test" }) }).issues.join("\n"),
  /cannot replace verify/);
});

test("a direct verify correction runs through change amend and leaves no staged file", (t) => {
  const root = mkdtempSync(join(tmpdir(), "verify-direct-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const calls = [];
  let exitCleanup = null;
  const result = amendTaskVerifyOperation({
    root, pid: 7, now: () => 42, onExit: (cleanup) => { exitCleanup = cleanup; },
    amendChange: (id, path, options) => {
      calls.push({ id, path, options, amendment: JSON.parse(readFileSync(path, "utf8")) });
      return "amended";
    }
  }, "demo", { task: "impl", verify: "npm test", reason: "Typo in the test script" });
  assert.equal(result, "amended");
  assert.deepEqual(calls, [{
    id: "demo", path: join(root, ".foundation", "amendments", "demo-verify-42-7.json"),
    options: { consumeAmendment: true },
    amendment: { version: 1, reason: "Typo in the test script",
      updateTasks: [{ key: "impl", verify: "npm test" }] }
  }]);
  assert.equal(existsSync(calls[0].path), false);
  assert.equal(typeof exitCleanup, "function");
  assert.throws(() => amendTaskVerifyOperation({
    root, onExit: () => {}, amendChange: () => { throw new Error("refused"); }
  }, "demo", { task: "impl", verify: "npm test" }), /refused/);
  assert.deepEqual(readdirSync(join(root, ".foundation", "amendments")), []);
});

test("the amendment template leads with the verify-only form", () => {
  const template = semanticAmendmentTemplate();
  assert.deepEqual(Object.keys(template),
    ["save", "verifyOnly", "reopenCompleted", "removeUnfinished", "requirementChange"]);
  // The host refuses a shell-written amendment; the file tool is pre-allowed.
  assert.match(template.save, /Write tool to \.foundation\/drafts\/<change>-amendment\.json/);
  assert.match(template.save, /not save it through the shell \(heredoc/);
  assert.match(template.save,
    /claude-foundation change amend <change> \.foundation\/drafts\/<change>-amendment\.json/);
  assert.equal(taskContractOnlyAmendment(template.verifyOnly), true);
  assert.equal(taskContractOnlyAmendment(template.reopenCompleted), true);
  assert.equal(taskContractOnlyAmendment(template.removeUnfinished), true);
  assert.equal(taskContractOnlyAmendment(template.requirementChange), false);
});

// Tasks can be withdrawn while unfinished, and a completed task's check can
// change only by re-opening it, so a changed verify never keeps a completed
// status and finished work never silently disappears.
test("an amendment withdraws unfinished tasks and never completed or depended-on ones", () => {
  const ledger = [
    "- [x] **T001** Build A [key:a-task] [claims:a] — verify: `npm test`",
    "- [ ] **T002** Build B [key:b-task] [claims:b] — verify: `npm run lint`",
    "- [ ] **T003** Extra B [key:b-extra] [claims:b] — verify: `npm run lint:extra`",
    "  - detail line kept with its task",
    "- [ ] **T004** Docs [key:docs] [depends:T003] [claims:a] — verify: `npm run docs`"
  ];
  const removal = (refs, extra = {}) => ({ version: 1, reason: "No longer needed",
    removeTasks: refs, ...extra });
  assert.equal(taskContractOnlyAmendment(removal(["T003"])), true);
  // A depended-on task stays unless the dependent goes too or is updated.
  assert.match(compileSemanticAmendment({ ...verifyFixture(ledger), amendment: removal(["b-extra"]) })
    .issues.join("\n"), /cannot remove T003: task T004 depends on it; remove T004 too or update its dependsOn/);
  const withDependent = compileSemanticAmendment({ ...verifyFixture(ledger),
    amendment: removal(["b-extra", { key: "T004" }]) });
  assert.deepEqual(withDependent.issues, []);
  assert.doesNotMatch(withDependent.tasksContent, /T003|T004|detail line/);
  assert.match(withDependent.tasksContent, /^- \[ \] \*\*T002\*\*/m);
  assert.deepEqual(withDependent.removedTasks.map((task) => task.id), ["T003", "T004"]);
  assert.deepEqual(withDependent.invalidatedClaims, ["b", "a"]);
  // The derived provider command follows the remaining verify commands.
  const derived = compileSemanticAmendment({ ...verifyFixture(ledger, { adapter: "test-discovery",
    command: ["sh", "-c", "(npm test) && (npm run lint) && (npm run lint:extra) && (npm run docs)"] }),
  amendment: removal(["T003"], { updateTasks: [{ key: "docs", dependsOn: [] }] }) });
  assert.deepEqual(derived.issues, []);
  assert.deepEqual(derived.providers.test.command,
    ["sh", "-c", "(npm test) && (npm run lint) && (npm run docs)"]);
  assert.doesNotMatch(derived.tasksContent, /\[depends:/);
  // Completed work and the last task carrying a claim cannot be withdrawn.
  assert.match(compileSemanticAmendment({ ...verifyFixture(ledger), amendment: removal(["T001"]) })
    .issues.join("\n"), /cannot remove completed task 'a-task' \(T001\)/);
  assert.match(compileSemanticAmendment({ ...verifyFixture(ledger), amendment: removal(["T002"]),
    provenClaimIds: ["b"] }).issues.join("\n"), /cannot remove completed task 'b-task'/);
  const lastB = compileSemanticAmendment({ ...verifyFixture(ledger),
    amendment: removal(["T002", "T003", "T004"]) });
  assert.match(lastB.issues.join("\n"),
    /cannot remove task 'b-task' \(T002\): claim\(s\) b would have no task/);
  // Coverage can move to a remaining task in the same amendment.
  const moved = compileSemanticAmendment({ ...verifyFixture(ledger),
    amendment: removal(["T002", "T003", "T004"], { updateTasks: [{ key: "a-task", covers: ["b"] }] }) });
  assert.deepEqual(moved.issues, []);
  assert.match(moved.tasksContent, /^- \[x\] \*\*T001\*\* Build A \[key:a-task\] \[claims:a,b\]/m);
  assert.match(compileSemanticAmendment({ ...verifyFixture(ledger), amendment: removal(["T009"]) })
    .issues.join("\n"), /removeTasks references unknown task 'T009'/);
  // A withdrawn id is never reused by a later amendment.
  const added = compileSemanticAmendment({
    amendment: { version: 1, addRequirements: [{ key: "c", capability: "change",
      scenario: "C runs", outcome: "C" }],
    addTasks: [{ key: "c-task", outcome: "Build C", covers: ["c"], verify: "npm test" }],
    evidence: { c: { capabilities: ["test"] } } },
    ...verifyFixture(ledger.slice(0, 2)), renderTask: (task) => `- [ ] **${task.id}** ${task.outcome}`,
    retiredTaskIds: ["T003", "T004"]
  });
  assert.deepEqual(added.issues, []);
  assert.match(added.tasksContent, /^- \[ \] \*\*T005\*\* Build C$/m);
});

// A multi-task cycle is an amendment repair, never a Build-time planner failure.
test("an amendment refuses task dependency cycles across updated and added tasks", () => {
  const ledger = [
    "- [ ] **T001** Build A [key:a-task] [claims:a] — verify: `npm test`",
    "- [ ] **T002** Build B [key:b-task] [depends:T001] [claims:b] — verify: `npm run lint`"
  ];
  const updated = compileSemanticAmendment({ ...verifyFixture(ledger), amendment: {
    version: 1, updateTasks: [{ key: "a-task", dependsOn: ["b-task"] }] } });
  assert.match(updated.issues.join("\n"),
    /task dependencies contain a cycle: (T001 -> T002 -> T001|T002 -> T001 -> T002)/);
  assert.equal(updated.tasksContent, undefined);
  const added = compileSemanticAmendment({
    ...verifyFixture(ledger), renderTask: (task) => `- [ ] **${task.id}** ${task.outcome}`,
    amendment: { version: 1, addRequirements: [{ key: "c", capability: "change",
      scenario: "C runs", outcome: "C" }],
    evidence: { c: { capabilities: ["test"] } },
    addTasks: [
      { key: "c-one", outcome: "C one", covers: ["c"], verify: "npm test", dependsOn: ["c-two"] },
      { key: "c-two", outcome: "C two", covers: ["c"], verify: "npm test", dependsOn: ["c-one"] }
    ] }
  });
  assert.match(added.issues.join("\n"), /task dependencies contain a cycle: 'c-one' -> 'c-two' -> 'c-one'/);
  // An acyclic reorder still compiles.
  const reordered = compileSemanticAmendment({ ...verifyFixture(ledger), amendment: {
    version: 1, updateTasks: [{ key: "b-task", dependsOn: [] }, { key: "a-task", dependsOn: ["b-task"] }] } });
  assert.deepEqual(reordered.issues, []);
});

test("a completed task's verify changes only by re-opening it", () => {
  const ledger = ["- [x] **T001** Build A [key:impl] [claims:a] — verify: `go test ./...`"];
  const refused = compileSemanticAmendment({ ...verifyFixture(ledger), amendment: { version: 1,
    updateTasks: [{ key: "impl", verify: "go test -v ./..." }] } });
  assert.match(refused.issues.join("\n"),
    /cannot replace verify; add a new task so completed work keeps its meaning, or set "reopen": true/);
  const amendment = taskVerifyAmendment({ task: "T001", verify: "go test -v ./...", reopen: true });
  assert.deepEqual(amendment.updateTasks, [{ key: "T001", verify: "go test -v ./...", reopen: true }]);
  assert.equal(taskContractOnlyAmendment(amendment), true);
  const reopened = compileSemanticAmendment({ ...verifyFixture(ledger), amendment,
    provenClaimIds: ["a"] });
  assert.deepEqual(reopened.issues, []);
  assert.match(reopened.tasksContent,
    /^- \[ \] \*\*T001\*\* Build A \[key:impl\] \[claims:a\] — verify: `go test -v \.\/\.\.\.`$/m);
  assert.deepEqual(reopened.taskContractChanges, [{ key: "impl", id: "T001", claims: ["a"],
    verify: "go test -v ./...", priorVerify: "go test ./...", reopened: true }]);
  assert.deepEqual(reopened.invalidatedClaims, ["a"]);
  // Re-opening never changes an outcome, and reopen with no change is a no-op.
  assert.match(compileSemanticAmendment({ ...verifyFixture(ledger), amendment: { version: 1,
    addRequirements: [{ key: "n", capability: "change", scenario: "N", outcome: "N" }],
    evidence: { n: { capabilities: ["test"] } },
    updateTasks: [{ key: "impl", outcome: "Other", verify: "make", reopen: true, covers: ["n"] }] } })
    .issues.join("\n"), /cannot replace outcome; add a new task/);
  assert.match(compileSemanticAmendment({ ...verifyFixture(ledger), amendment: { version: 1,
    updateTasks: [{ key: "impl", verify: "go test ./...", reopen: true }] } }).issues.join("\n"),
  /changes no verify command or paths/);
  assert.match(compileSemanticAmendment({ ...verifyFixture(ledger), amendment: { version: 1,
    updateTasks: [{ key: "impl", verify: "make", reopen: "yes" }] } }).issues.join("\n"),
  /reopen must be true or false/);
});

for (const initialStatus of ["building", "proven"]) {
test(`change amend from ${initialStatus} installs atomically and restores files and state on validation failure`, (t) => {
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
      scenarios: [{ name: `${key} case`, when: `${key} is observed`, then: `${key} is handled` }],
      outcome: `${key} is handled`
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
    id, status: initialStatus, semanticDraftVersion: 4,
    revision: 0, contractRevision: 0, executionRevision: 0
  };
  const proofAdvancePath = join(root, ".foundation", "evidence", id, "proof-advance.json");
  mkdirSync(dirname(proofAdvancePath), { recursive: true });
  const priorProofAdvance = JSON.stringify({ status: "READY", contractRevision: 0 });
  writeFileSync(proofAdvancePath, priorProofAdvance);
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
    assert.equal(firstInspection.action, "DONE");
    const firstAmendment = JSON.parse(readFileSync(amendmentPath, "utf8"));
    const specPath = join(change, "specs", "payment-control", "spec.md");
    writeFileSync(join(root, "README.md"), "Changed amendment source.\n");
    // A stale intake is inspected in the same call: the action is returned
    // and nothing is amended until the author repairs the amendment.
    const refreshed = lifecycle.amendChange(id, "amendment.json");
    assert.equal(refreshed.action, "EDIT");
    assert.equal(state.contractRevision || 0, 0);
    assert.equal(state.status, initialStatus);
    assert.equal(readFileSync(proofAdvancePath, "utf8"), priorProofAdvance);
    // Changed sources still require the author to re-read and touch the draft.
    firstAmendment.discovery.sourceDigest = refreshed.intakeState.sourceDigest;
    writeFileSync(amendmentPath, `${JSON.stringify(firstAmendment, null, 2)}\n`);
    assert.equal(lifecycle.inspectAmendment(id, "amendment.json").action, "DONE");
    rejectValidation = true;
    const stateBeforeRejectedAmendment = structuredClone(state);
    assert.throws(() => lifecycle.amendChange(id, "amendment.json"),
      /synthetic validator failure; semantic amendment rolled back/);
    assert.deepEqual(state, stateBeforeRejectedAmendment);
    assert.equal(readFileSync(proofAdvancePath, "utf8"), priorProofAdvance);
    assert.equal(JSON.parse(readFileSync(join(receipts, "lint.json"), "utf8")).contractFingerprint,
      initialLintReceipt.contractFingerprint);
    rejectValidation = false;
    runContender = true;
    lifecycle.amendChange(id, "amendment.json");
    assert.match(contenderError?.message || "", /already in progress/);
    assert.equal(state.contractRevision, 1);
    assert.equal(state.status, "building");
    assert.equal(existsSync(proofAdvancePath), false);
    assert.equal(state.amendments.length, 1);
    assert.deepEqual(state.amendments[0].requirementKeys, ["malformed-row"]);
    assert.equal(state.amendments[0].semanticIntakeEffectiveness.history.inspections, 3);
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

    // A task added for an existing requirement amends without intake, and the
    // claims it covers are invalidated so Prove runs them again (issue #43).
    rejectRebind = false;
    writeFileSync(amendmentPath, `${JSON.stringify({
      version: 1, reason: "Add a dedicated check for the existing behavior",
      addTasks: [{ key: "check-existing", outcome: "Check the existing behavior",
        covers: ["existing-behavior"], paths: ["src/check.js"], verify: "npm test" }]
    }, null, 2)}\n`);
    const revisionBefore = state.contractRevision;
    lifecycle.amendChange(id, "amendment.json");
    assert.equal(state.contractRevision, revisionBefore + 1);
    const added = state.amendments.at(-1);
    assert.ok(added.invalidation.affectedTasks.some((task) => task !== "T001"),
      JSON.stringify(added.invalidation.affectedTasks));
    assert.ok(added.invalidation.affectedProviders.includes("lint"));
    assert.match(readFileSync(join(change, "tasks.md"), "utf8"),
      /^- \[ \] \*\*T00\d\*\* Check the existing behavior \[key:check-existing\].*\[claims:existing-claim\]/m);
  } finally {
    console.log = priorLog;
  }
});
}

function amendVerifyOnlySameContract(t, lintFingerprint) {
  // The real contract fingerprint covers claims and policy, not task verify
  // commands, so a verify-only amendment leaves it unchanged.
  const root = mkdtempSync(join(tmpdir(), "verify-amend-same-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const id = "verify-change";
  const change = join(root, ".foundation", "sandboxes", id, "openspec", "changes", id);
  mkdirSync(change, { recursive: true });
  writeFileSync(join(change, "tasks.md"), [
    "# Tasks", "",
    "- [ ] **T001** Build A [key:impl] [claims:a] — verify: `npm tset`",
    "- [x] **T002** Build B [key:style] [claims:b] — verify: `npm run lint`", ""
  ].join("\n"));
  writeFileSync(join(change, "evidence.yaml"), `${JSON.stringify({
    version: 1,
    claims: [
      { id: "a", requirementKey: "a", scenario: "A runs", capabilities: ["test"] },
      { id: "b", requirementKey: "b", scenario: "B runs", capabilities: ["lint"] }
    ],
    providers: {
      test: { adapter: "test-discovery", capability: "test", claims: ["a"],
        command: ["sh", "-c", "(npm tset) && (npm run lint)"] },
      lint: { adapter: "command", capability: "lint", claims: ["b"],
        command: ["sh", "-c", "npm run lint"] }
    }
  }, null, 2)}\n`);
  let state = { id, status: "building", semanticDraftVersion: 4,
    revision: 0, contractRevision: 0, executionRevision: 0 };
  const stableHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const contract = () => JSON.parse(readFileSync(join(change, "evidence.yaml"), "utf8"));
  const contractFingerprint = () => stableHash(contract().claims);
  const receipts = join(root, ".foundation", "receipts", id);
  mkdirSync(receipts, { recursive: true });
  const lintReceipt = `${JSON.stringify({ provider: "lint", status: "pass",
    contractFingerprint: lintFingerprint || contractFingerprint() })}\n`;
  writeFileSync(join(receipts, "lint.json"), lintReceipt);
  writeFileSync(join(receipts, "test.json"), `${JSON.stringify({ provider: "test",
    status: "fail", contractFingerprint: contractFingerprint() })}\n`);
  const lifecycle = createChangeLifecycle({
    root,
    policy: () => ({ workflow: { grounding: "optional" } }),
    securityTerms: [],
    fail: (message) => { throw new Error(message); },
    pathInside: (parent, candidate) => {
      const rel = relative(parent, candidate);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    },
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    writeJson: (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`),
    slugify,
    changePath: () => change,
    activeChangePath: () => change,
    loadRuntime: () => state,
    saveRuntime: (value) => { state = structuredClone(value); },
    validate: () => {},
    now: () => "2026-10-01T00:00:00.000Z",
    receiptPath: (_changeId, provider) => join(receipts, `${provider}.json`),
    receiptValidity: (_changeId, provider) => {
      const receipt = JSON.parse(readFileSync(join(receipts, `${provider}.json`), "utf8"));
      return { provider, status: receipt.status,
        validity: receipt.contractFingerprint === contractFingerprint() ? "valid" : "contract-stale" };
    },
    contractFingerprint,
    requiredProviders: () => Object.keys(contract().providers),
    providerConfig: (_changeId, provider) => contract().providers[provider],
    claimsForProvider: (_changeId, provider) => contract().claims.filter((claim) =>
      contract().providers[provider].claims.includes(claim.id)),
    relevantHash: () => "workspace",
    providerWorkspaceHash: () => "workspace",
    providerInputIdentity: () => ({ mode: "declared", fingerprint: "inputs" }),
    stableHash
  });
  writeFileSync(join(root, "amendment.json"), JSON.stringify({
    version: 1, reason: "Correct the verify command",
    updateTasks: [{ key: "impl", verify: "npm test" }]
  }));
  const priorLog = console.log;
  console.log = () => {};
  try {
    lifecycle.amendChange(id, "amendment.json");
  } finally {
    console.log = priorLog;
  }
  assert.equal(state.contractRevision, 1);
  assert.match(readFileSync(join(change, "tasks.md"), "utf8"), /verify: `npm test`$/m);
  assert.equal(readFileSync(join(receipts, "lint.json"), "utf8"), lintReceipt,
    "the receipt is left as it was");
  return state.amendments.at(-1).invalidation.proofRecovery;
}

test("a verify-only amend keeps a passing receipt whose contract did not change", (t) => {
  const { providers } = amendVerifyOnlySameContract(t);
  assert.ok(providers.preserved.includes("lint"));
});

test("a verify-only amend reruns a receipt already stale for the unchanged contract", (t) => {
  const plan = amendVerifyOnlySameContract(t, "an-older-contract");
  assert.ok(!plan.providers.preserved.includes("lint"), "a stale receipt is not reported preserved");
  assert.ok(plan.providers.rerun.includes("lint"));
  assert.deepEqual(plan.decisions.find((row) => row.provider === "lint"),
    { provider: "lint", action: "rerun", reason: "RECEIPT_STALE_FOR_UNCHANGED_CONTRACT" });
  assert.match(plan.recovery.instruction,
    new RegExp(`retain ${plan.providers.preserved.length} bound receipt\\(s\\) and rerun ${plan.providers.rerun.length}`));
});

test("a verify-only change amend reruns that task's evidence and keeps the rest", (t) => {
  const root = mkdtempSync(join(tmpdir(), "verify-amend-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const id = "verify-change";
  const change = join(root, ".foundation", "sandboxes", id, "openspec", "changes", id);
  mkdirSync(change, { recursive: true });
  writeFileSync(join(change, "tasks.md"), [
    "# Tasks", "",
    "- [ ] **T001** Build A [key:impl] [claims:a] — verify: `npm tset`",
    "- [x] **T002** Build B [key:style] [claims:b] — verify: `npm run lint`", ""
  ].join("\n"));
  writeFileSync(join(change, "evidence.yaml"), `${JSON.stringify({
    version: 1,
    claims: [
      { id: "a", requirementKey: "a", scenario: "A runs", capabilities: ["test"] },
      { id: "b", requirementKey: "b", scenario: "B runs", capabilities: ["lint"] }
    ],
    providers: {
      test: { adapter: "test-discovery", capability: "test", claims: ["a"],
        command: ["sh", "-c", "(npm tset) && (npm run lint)"] },
      lint: { adapter: "command", capability: "lint", claims: ["b"],
        command: ["sh", "-c", "npm run lint"] }
    }
  }, null, 2)}\n`);
  let state = { id, status: "building", semanticDraftVersion: 4,
    revision: 0, contractRevision: 0, executionRevision: 0 };
  let rejectValidation = false;
  const stableHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const contract = () => JSON.parse(readFileSync(join(change, "evidence.yaml"), "utf8"));
  const contractFingerprint = () => stableHash(contract());
  const receipts = join(root, ".foundation", "receipts", id);
  mkdirSync(receipts, { recursive: true });
  const writeReceipt = (provider, status) => writeFileSync(join(receipts, `${provider}.json`),
    `${JSON.stringify({ provider, status, contractFingerprint: contractFingerprint() })}\n`);
  writeReceipt("test", "fail");
  writeReceipt("lint", "pass");
  const lifecycle = createChangeLifecycle({
    root,
    policy: () => ({ workflow: { grounding: "optional" } }),
    securityTerms: [],
    fail: (message) => { throw new Error(message); },
    pathInside: (parent, candidate) => {
      const rel = relative(parent, candidate);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    },
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    writeJson: (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`),
    slugify,
    changePath: () => change,
    activeChangePath: () => change,
    loadRuntime: () => state,
    saveRuntime: (value) => { state = structuredClone(value); },
    validate: () => { if (rejectValidation) throw new Error("synthetic validator failure"); },
    now: () => "2026-10-01T00:00:00.000Z",
    receiptPath: (_changeId, provider) => join(receipts, `${provider}.json`),
    receiptValidity: (_changeId, provider) => {
      const receipt = JSON.parse(readFileSync(join(receipts, `${provider}.json`), "utf8"));
      return { provider, status: receipt.status,
        validity: receipt.contractFingerprint === contractFingerprint() ? "valid" : "contract-stale" };
    },
    contractFingerprint,
    requiredProviders: () => Object.keys(contract().providers),
    providerConfig: (_changeId, provider) => contract().providers[provider],
    claimsForProvider: (_changeId, provider) => contract().claims.filter((claim) =>
      contract().providers[provider].claims.includes(claim.id)),
    relevantHash: () => "workspace",
    providerWorkspaceHash: () => "workspace",
    providerInputIdentity: () => ({ mode: "declared", fingerprint: "inputs" }),
    stableHash
  });
  const amend = (verify) => {
    writeFileSync(join(root, "amendment.json"), JSON.stringify({
      version: 1, reason: "Correct the verify command",
      updateTasks: [{ key: "impl", verify }]
    }));
    return lifecycle.amendChange(id, "amendment.json");
  };
  const priorLog = console.log;
  console.log = () => {};
  try {
    const failedReceipt = readFileSync(join(receipts, "test.json"), "utf8");
    // Version 4 needs no semantic intake for a verify-only correction.
    amend("npm test");
    assert.equal(state.contractRevision, 1);
    assert.equal(state.pendingApprovalDelta, undefined);
    const [row] = state.amendments;
    assert.deepEqual(row.taskContractChanges,
      [{ key: "impl", id: "T001", claims: ["a"], verify: "npm test",
        priorVerify: "npm tset" }]);
    assert.deepEqual(row.invalidation.affectedTasks, ["T001"]);
    assert.deepEqual(row.invalidation.proofRecovery.providers.rerun, ["test"]);
    assert.deepEqual(row.invalidation.proofRecovery.providers.preserved, ["lint"]);
    assert.match(readFileSync(join(change, "tasks.md"), "utf8"),
      /^- \[ \] \*\*T001\*\* Build A \[key:impl\] \[claims:a\] — verify: `npm test`$/m);
    assert.deepEqual(contract().providers.test.command,
      ["sh", "-c", "(npm test) && (npm run lint)"]);
    // The task's receipt is left stale for Prove to rerun; the other is rebound.
    assert.equal(readFileSync(join(receipts, "test.json"), "utf8"), failedReceipt);
    assert.notEqual(JSON.parse(failedReceipt).contractFingerprint, contractFingerprint());
    const lint = JSON.parse(readFileSync(join(receipts, "lint.json"), "utf8"));
    assert.equal(lint.contractFingerprint, contractFingerprint());
    assert.equal(lint.contractRebind.reason, "unaffected-semantic-amendment");

    const before = { tasks: readFileSync(join(change, "tasks.md"), "utf8"),
      evidence: readFileSync(join(change, "evidence.yaml"), "utf8"), state: structuredClone(state) };
    rejectValidation = true;
    assert.throws(() => amend("npm run test:unit"),
      /synthetic validator failure; semantic amendment rolled back/);
    assert.equal(readFileSync(join(change, "tasks.md"), "utf8"), before.tasks);
    assert.equal(readFileSync(join(change, "evidence.yaml"), "utf8"), before.evidence);
    assert.deepEqual(state, before.state);

    // Once that task's command evidence passes, its verify is finished work.
    rejectValidation = false;
    writeReceipt("test", "pass");
    assert.throws(() => amend("npm run test:unit"), /updateTasks\[0\] cannot replace verify/);
    assert.deepEqual(state, before.state);

    // Re-opening is the only way to change it: the task must pass again.
    writeFileSync(join(root, "amendment.json"), JSON.stringify(
      taskVerifyAmendment({ task: "T001", verify: "npm run test:unit", reopen: true })));
    lifecycle.amendChange(id, "amendment.json");
    assert.deepEqual(state.amendments.at(-1).taskContractChanges, [{ key: "impl", id: "T001",
      claims: ["a"], verify: "npm run test:unit", priorVerify: "npm test", reopened: true }]);
    assert.deepEqual(state.amendments.at(-1).invalidation.proofRecovery.providers.rerun, ["test"]);
    assert.match(readFileSync(join(change, "tasks.md"), "utf8"),
      /^- \[ \] \*\*T001\*\* Build A \[key:impl\] \[claims:a\] — verify: `npm run test:unit`$/m);

    // Withdrawing an unfinished task: refused while it carries the last claim,
    // accepted once another open task carries it, and its id stays retired.
    const remove = (refs) => {
      writeFileSync(join(root, "amendment.json"), JSON.stringify({
        version: 1, reason: "Withdraw duplicated work", removeTasks: refs }));
      return lifecycle.amendChange(id, "amendment.json");
    };
    assert.throws(() => remove(["impl"]), /claim\(s\) a would have no task/);
    writeFileSync(join(change, "tasks.md"), `${readFileSync(join(change, "tasks.md"), "utf8")
      .replace(/\s+$/, "")}\n- [ ] **T003** Build A again [key:impl-2] [claims:a] — verify: \`npm test\`\n`);
    // As an addTasks amendment would have left it: the derived command covers T003.
    const withThird = contract();
    withThird.providers.test.command =
      ["sh", "-c", "(npm run test:unit) && (npm run lint) && (npm test)"];
    writeFileSync(join(change, "evidence.yaml"), `${JSON.stringify(withThird, null, 2)}\n`);
    writeReceipt("lint", "pass");
    const revision = state.contractRevision;
    remove(["impl"]);
    assert.equal(state.contractRevision, revision + 1);
    assert.deepEqual(state.amendments.at(-1).removedTasks, [{ key: "impl", id: "T001",
      claims: ["a"], verify: "npm run test:unit" }]);
    assert.equal(state.pendingApprovalDelta, undefined);
    assert.doesNotMatch(readFileSync(join(change, "tasks.md"), "utf8"), /T001/);
    assert.deepEqual(contract().providers.test.command,
      ["sh", "-c", "(npm run lint) && (npm test)"]);
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

test("a version-4 revision accepts optional discovery coverage for revised requirements", () => {
  const args = revisionFixture([
    "- [ ] **T001** Build A and B [key:impl] [claims:a,b] — verify: `npm test`"
  ]);
  const amendment = {
    version: 1,
    reviseRequirements: [{ key: "a", capability: "change", scenario: "A runs",
      outcome: "A runs at 50 per second" }],
    evidence: { a: { capabilities: ["test"] } }
  };
  assert.deepEqual(compileSemanticAmendment({ ...args, amendment, semanticDraftVersion: 4 })
    .issues, []);
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

function readableDraft(requirement, extra = {}) {
  const value = semanticDraftV4(extra);
  value.requirements = [{ key: "payment-retry", capability: "payment-control",
    operation: "added", ...requirement }];
  value.tasks = [{ key: "implement-retry", outcome: "Implement retries",
    covers: ["payment-retry"], paths: ["src/**"], verify: "npm test" }];
  value.evidence = { "payment-retry": { capabilities: ["test"] } };
  delete value.integrations;
  return value;
}

test("v4 specs render a titled capability, GIVEN/AND scenarios, and detail bullets", () => {
  const { draft, issues } = normalizeSemanticDraft(readableDraft({
    description: "The service SHALL record at most one payment per retry.",
    details: ["A retry reuses the original idempotency key"],
    outcome: "one payment is recorded",
    scenarios: [{ name: "Retry succeeds", given: "a payment timed out once",
      when: "the client retries", then: "one payment is recorded",
      and: ["the retry returns the original receipt"] }]
  }, { language: "en", capabilityOverviews: [{ capability: "payment-control",
    title: "Payment retries", overview: "Retries never charge twice." }] }), slugify);
  assert.deepEqual(issues, []);
  const [spec] = draft.specs;
  assert.equal(renderSpecHeading(spec), "# Payment retries\n\nRetries never charge twice.");
  assert.equal(renderRequirementMarkdown(spec), [
    "### Requirement: payment-retry", "",
    "The service SHALL record at most one payment per retry.", "",
    "- A retry reuses the original idempotency key", "",
    "#### Scenario: Retry succeeds", "",
    "- **GIVEN** a payment timed out once",
    "- **WHEN** the client retries",
    "- **THEN** one payment is recorded",
    "- **AND** the retry returns the original receipt"
  ].join("\n"));
});

test("v4 rejects scenarios and statements that are hard to read", () => {
  const issuesFor = (requirement, extra) =>
    normalizeSemanticDraft(readableDraft(requirement, extra), slugify).issues.join("\n");
  assert.match(issuesFor({ outcome: "one payment is recorded",
    scenario: "the client retries" }), /scenarios\[0\]\.name is required/);
  assert.match(issuesFor({ outcome: "x is recorded", scenarios: [{
    name: "The client retries", when: "the client retries", then: "x" }] }),
  /name repeats WHEN/);
  assert.match(issuesFor({ outcome: "x is recorded", scenarios: [{ name: "Mixed",
    when: "the client retries; or the server restarts", then: "x" }] }),
  /when joins several cases with ';'/);
  assert.match(issuesFor({ outcome: "x", description: "The service SHALL a; b; c; d.",
    scenarios: [{ name: "One", when: "w", then: "t" }] }), /statement is too long/);
  assert.match(issuesFor({ outcome: "บันทึกการชำระเงินครั้งเดียว",
    scenarios: [{ name: "หนึ่ง", when: "w", then: "t" }] }), /description is required/);
  assert.match(issuesFor({ outcome: "x", description: "Payments are recorded once.",
    scenarios: [{ name: "One", when: "w", then: "t" }] }), /SHALL or MUST/);
  assert.match(issuesFor({ outcome: "x", scenarios: [{ name: "One", when: "w", then: "t" }] },
    { language: "thai language" }), /BCP 47/);
  assert.match(issuesFor({ outcome: "x", scenarios: [{ name: "One", when: "w", then: "t" }] },
    { capabilityOverviews: [{ capability: "unknown", overview: "o" }] }),
  /matches no requirement capability/);
});

// A headless agent wrote capabilityOverviews keyed by capability and spent an
// inspect round on "must be an array"; the natural map form now normalizes.
test("capabilityOverviews accepts an object keyed by capability", () => {
  const heading = (capabilityOverviews) => {
    const { draft, issues } = normalizeSemanticDraft(readableDraft({
      outcome: "one payment is recorded",
      scenarios: [{ name: "Retry succeeds", when: "the client retries", then: "one payment" }]
    }, { capabilityOverviews }), slugify);
    assert.deepEqual(issues, []);
    assert.ok(Array.isArray(draft.capabilityOverviews));
    return renderSpecHeading(draft.specs[0]);
  };
  assert.equal(heading({ "payment-control": { title: "Payment retries",
    overview: "Retries never charge twice." } }),
  "# Payment retries\n\nRetries never charge twice.");
  assert.equal(heading({ "payment-control": "Retries never charge twice." }),
    "# payment-control\n\nRetries never charge twice.");
  const bad = normalizeSemanticDraft(readableDraft({ outcome: "x",
    scenarios: [{ name: "One", when: "w", then: "t" }] },
  { capabilityOverviews: "payment-control" }), slugify).issues.join("\n");
  assert.match(bad, /capabilityOverviews must be an array of \{ capability, title, overview \} or an object keyed by capability/);
  // Optional and capability-bound: the template leaves it out so editing a
  // requirement capability can never strand a stale overview.
  assert.equal(semanticDraftTemplate().capabilityOverviews, undefined);
});

test("v4 builds a grammatical SHALL statement; v3 keeps its historical stem", () => {
  const statement = (outcome, version = 4) => {
    const value = readableDraft({ outcome,
      scenarios: [{ name: "One", when: "w", then: "t" }] });
    value.version = version;
    return normalizeSemanticDraft(value, slugify).draft.specs[0].description;
  };
  assert.equal(statement("a board renders three columns"),
    "The system SHALL ensure that a board renders three columns.");
  assert.equal(statement("The card appears in To Do."),
    "The system SHALL ensure that the card appears in To Do.");
  assert.equal(statement("record at most one payment"),
    "The system SHALL record at most one payment.");
  assert.equal(statement("The board SHALL keep three columns."),
    "The board SHALL keep three columns.");
  assert.equal(statement("a board renders three columns", 3),
    "The system SHALL a board renders three columns.");
});

test("non-Latin scenario titles get positional claim ids and usable trace labels", () => {
  const { draft, issues } = normalizeSemanticDraft(readableDraft({
    description: "ระบบ SHALL บันทึกการชำระเงินครั้งเดียว", outcome: "บันทึกครั้งเดียว",
    scenarios: [
      { name: "สำเร็จ", given: "ชำระเงินหมดเวลาหนึ่งครั้ง", when: "ลองใหม่", then: "บันทึกหนึ่งรายการ" },
      { name: "หมดเวลาอีก", when: "ลองใหม่แล้วหมดเวลา", then: "ยังลองใหม่ได้" }
    ]
  }, { language: "th" }), slugify);
  assert.deepEqual(issues, []);
  assert.deepEqual(draft.claims.map((claim) => claim.id),
    ["payment-retry-1", "payment-retry-2"]);
  assert.match(renderRequirementMarkdown(draft.specs[0]), /- \*\*GIVEN\*\* ชำระเงินหมดเวลาหนึ่งครั้ง/);
});

test("an amendment that opens a new capability file starts with its heading", () => {
  const content = appendRequirementToSpec("", {
    name: "payment-control", title: "Payment retries", overview: "Retries never charge twice.",
    operation: "added", requirement: "Retry", description: "The service SHALL retry.",
    scenarios: [{ name: "Retry", when: "w", then: "t" }]
  });
  assert.match(content, /^# Payment retries\n\nRetries never charge twice\.\n\n## ADDED Requirements/);
});

test("modifying a canonical requirement preserves its GIVEN and AND lines", () => {
  const canonical = [
    "# payment-control", "", "## Requirements", "",
    "### Requirement: payment-retry", "", "The service SHALL retry.", "",
    "#### Scenario: Retry succeeds", "",
    "- **GIVEN** a payment timed out", "- **WHEN** the client retries",
    "- **THEN** one payment is recorded", "- **AND** the receipt is reused"
  ].join("\n");
  const { draft } = normalizeSemanticDraft(readableDraft({
    operation: "modified", requirement: "payment-retry",
    description: "The service SHALL retry once.", outcome: "x",
    scenarios: [{ name: "Retry fails", when: "the retry fails", then: "an error is shown" }]
  }), slugify, { loadCanonicalSpec: () => canonical });
  const rendered = renderRequirementMarkdown(draft.specs[0]);
  assert.match(rendered, /GIVEN\*\* a payment timed out[\s\S]*AND\*\* the receipt is reused/);
  assert.match(rendered, /Scenario: Retry fails/);
});

function rapidDraftWithoutEvidence(overrides = {}) {
  const { evidence: _omitted, integrations: _none, ...draft } = semanticDraft({
    impact: "low", coupling: "isolated", acceptance: { required: false }
  });
  return { ...draft, ...overrides };
}

test("a rapid draft may omit evidence capabilities and proves with test, discovery, and review", () => {
  const result = normalizeSemanticDraft(rapidDraftWithoutEvidence(), slugify,
    { defaultRapidEvidence: true });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.draft._defaultedEvidence, ["payment-retry", "audit-result"]);
  assert.ok(result.draft.claims.every((claim) => claim.capabilities.join() === "test"));
  const test = result.draft.execution.providers.test;
  assert.equal(test.adapter, "test-discovery");
  assert.deepEqual(test.command.slice(0, 2), ["sh", "-c"]);
  assert.match(test.command[2], /npm test -- payment-retry/);
  // Installed consumers run risk-tiered review: a low-risk rapid change needs
  // exactly one ai-full attempt and nothing more from the author.
  const state = { impact: "low", coupling: "isolated", securityTriggers: [], waivers: [] };
  const route = classifyReviewRisk({ state, claims: result.draft.claims,
    capabilities: new Set(["test"]), grounding: {} });
  assert.deepEqual([route.tier, route.route, route.maxAiAttempts], ["low", ["ai-full"], 1]);
  const required = requiredProvidersOperation({
    loadRuntime: () => state,
    evidence: () => ({ providers: result.draft.execution.providers, claims: result.draft.claims }),
    providerCapability: (provider, config) => config?.capability || provider,
    reviewPolicy: () => ({ required: true, tier: route.tier }),
    resolvedAcceptance: () => ({ required: false }),
    policyCapabilitySplit: () => ({ enforced: [] }),
    foundationPolicy: () => ({ quality: { changeGate: "warn" } })
  }, "rapid");
  assert.deepEqual(required, ["discovery", "review", "test"]);
});

test("docs or chore work defaults omitted capabilities to static-analysis by exit code", () => {
  for (const workType of [["docs"], ["chore"], ["docs", "chore"]]) {
    const result = normalizeSemanticDraft(rapidDraftWithoutEvidence({ workType }), slugify,
      { defaultRapidEvidence: true });
    assert.deepEqual(result.issues, [], workType.join());
    assert.ok(result.draft.claims.every((claim) =>
      claim.capabilities.join() === "static-analysis"), workType.join());
    const providers = result.draft.execution.providers;
    assert.deepEqual(Object.keys(providers), ["static-analysis"]);
    assert.equal(providers["static-analysis"].adapter, "command");
  }
  // Inferred from paths: a task touching only Markdown is docs work.
  const inferred = rapidDraftWithoutEvidence();
  inferred.tasks = inferred.tasks.map((task) => ({ ...task, paths: ["README.md"] }));
  assert.ok(normalizeSemanticDraft(inferred, slugify, { defaultRapidEvidence: true })
    .draft.claims.every((claim) => claim.capabilities.join() === "static-analysis"));
  // Mixed work, product work, and authored capabilities keep their evidence.
  assert.ok(normalizeSemanticDraft(rapidDraftWithoutEvidence({ workType: ["docs", "feature"] }),
    slugify, { defaultRapidEvidence: true }).draft.claims.every((claim) =>
    claim.capabilities.join() === "test"));
  assert.ok(normalizeSemanticDraft(rapidDraftWithoutEvidence({ workType: ["docs"],
    evidence: { "payment-retry": { capabilities: ["test"] },
      "audit-result": { capabilities: ["test"] } } }), slugify,
  { defaultRapidEvidence: true }).draft.claims.every((claim) =>
    claim.capabilities.join() === "test"));
});

test("evidence defaults apply in both lanes; only security triggers, opt-out, and v3 callers keep them explicit", () => {
  const missing = /requires evidence\['payment-retry'\]\.capabilities/;
  // Standard lane (impact, coupling, review, acceptance) defaults like rapid
  // and records the keys, so the proposal can say the harness chose them.
  for (const overrides of [{ impact: "medium" }, { impact: "high" }, { reviewRequired: true },
    { acceptance: { required: true, reason: "UX" } }, { coupling: "coupled" }]) {
    const result = normalizeSemanticDraft(rapidDraftWithoutEvidence(overrides), slugify,
      { defaultRapidEvidence: true });
    assert.deepEqual(result.issues, [], JSON.stringify(overrides));
    assert.deepEqual(result.draft._defaultedEvidence, ["payment-retry", "audit-result"]);
    assert.ok(result.draft.claims.every((claim) => claim.capabilities.join() === "test"));
  }
  // A declared security trigger keeps the capability choice with the author.
  const triggered = normalizeSemanticDraft(
    rapidDraftWithoutEvidence({ securityTriggers: ["auth"], evidence: {} }), slugify,
    { defaultRapidEvidence: true });
  assert.ok(triggered.issues.some((issue) => missing.test(issue)));
  assert.ok(normalizeSemanticDraft(rapidDraftWithoutEvidence({ securityTriggers: ["auth"] }),
    slugify, { defaultRapidEvidence: true }).issues
    .some((issue) => /requires an 'evidence' object/.test(issue)));
  // Agent-provided capabilities are never replaced by the default.
  const kept = normalizeSemanticDraft(rapidDraftWithoutEvidence({ impact: "medium", evidence: {
    "payment-retry": { capabilities: ["test", "compatibility"] } } }), slugify,
  { defaultRapidEvidence: true });
  assert.deepEqual(kept.issues, []);
  assert.deepEqual(kept.draft._defaultedEvidence, ["audit-result"]);
  assert.deepEqual(kept.draft.claims.find((claim) =>
    claim.requirementKey === "payment-retry").capabilities, ["test", "compatibility"]);
  // Callers that do not opt in (amendments) keep the explicit contract.
  assert.ok(normalizeSemanticDraft(rapidDraftWithoutEvidence({ evidence: {} }), slugify)
    .issues.some((issue) => missing.test(issue)));
  // An explicit empty list is an authored decision, not an omission.
  assert.ok(normalizeSemanticDraft(rapidDraftWithoutEvidence({
    evidence: { "payment-retry": { capabilities: [] }, "audit-result": { capabilities: ["test"] } }
  }), slugify, { defaultRapidEvidence: true }).issues
    .some((issue) => /requires at least one evidence capability/.test(issue)));
  // Declared capabilities are kept verbatim.
  const declared = normalizeSemanticDraft(rapidDraftWithoutEvidence({
    evidence: { "payment-retry": { capabilities: ["test", "static-analysis"] } }
  }), slugify, { defaultRapidEvidence: true });
  assert.deepEqual(declared.issues, []);
  assert.deepEqual(declared.draft._defaultedEvidence, ["audit-result"]);
  assert.deepEqual(declared.draft.claims.find((claim) =>
    claim.requirementKey === "payment-retry").capabilities, ["test", "static-analysis"]);
});

test("colliding derived claim IDs are disambiguated deterministically", () => {
  // Truncates like the runtime slugify, so long shared title prefixes collide.
  const truncating = (value) => String(value).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 64).replace(/-+$/, "");
  const prefix = "producer emits v2 envelopes with the negotiated schema version header";
  const input = (version) => {
    const value = semanticDraft({ version, integrations: [] });
    value.requirements[0].scenarios = [
      { name: "New consumer", when: `${prefix} for new consumers`, then: "v2 is sent" },
      { name: "Old consumer", when: `${prefix} for old consumers`, then: "v1 is sent" },
      { key: "producer-emits-v2-envelopes-with-the-negotiated-sc", name: "Pinned",
        when: "a consumer pins", then: "the pinned version is sent" }
    ];
    return version === 4 ? { ...value, requirements: value.requirements.map(namedScenarios) } : value;
  };
  for (const version of [3, 4]) {
    const first = normalizeSemanticDraft(input(version), truncating);
    assert.deepEqual(first.issues.filter((issue) => /claim ID/.test(issue)), [], `v${version}`);
    const ids = first.draft.claims.map((claim) => claim.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => id.length <= 64));
    // The explicit scenario key keeps its ID; both derived IDs step around it.
    assert.equal(ids[2], "payment-retry-producer-emits-v2-envelopes-with-the-negotiated-sc");
    assert.match(ids[0], /-2$/);
    assert.match(ids[1], /-3$/);
    assert.deepEqual(first.draft.tasks[0].claims, ids.slice(0, 3));
    assert.deepEqual(normalizeSemanticDraft(input(version), truncating).draft.claims
      .map((claim) => claim.id), ids, "recompiling yields the same IDs");
  }
  const reserved = normalizeSemanticDraft(semanticDraft(), slugify,
    { reservedClaimIds: ["audit-result", "payment-retry-success"] });
  // A derived ID steps around a reserved one; an author-chosen key is left to the caller.
  assert.deepEqual(reserved.draft.claims.map((claim) => claim.id),
    ["payment-retry-success", "payment-retry-timeout", "audit-result-2"]);
});

test("two author-chosen scenario keys that collide remain an error", () => {
  const value = semanticDraft();
  value.requirements[0].scenarios[1].key = "success";
  assert.match(normalizeSemanticDraft(value, slugify).issues.join("\n"),
    /derives duplicate claim ID 'payment-retry-success'/);
});

test("a draft decision without alternatives needs no reason", () => {
  const settled = normalizeSemanticDraft(semanticDraft({
    decisions: [{ key: "shape", choice: "Keep one module" }]
  }), slugify);
  assert.deepEqual(settled.issues, []);
  assert.match(settled.draft.decisions[0].why, /No alternative was open/);
  const chosen = normalizeSemanticDraft(semanticDraft({
    decisions: [{ key: "shape", choice: "Keep one module", rejected: ["Split modules"] }]
  }), slugify);
  assert.match(chosen.issues.join("\n"), /decisions\[0\]\.reason is required/);
});

function minimalDraft(overrides = {}) {
  return {
    intent: "Export invoices as CSV",
    requirements: [
      { description: "The system SHALL export every invoice row as CSV",
        scenarios: [{ when: "an operator exports invoices", then: "a CSV file is returned" }] },
      { description: "The system SHALL escape commas inside invoice fields",
        scenarios: [{ when: "a field contains a comma", then: "the field is quoted" }] }
    ],
    tasks: [
      { outcome: "Write the invoice CSV exporter", verify: "npm test", paths: ["src/export.js"] },
      { outcome: "Quote comma fields during escaping", verify: "npm test",
        paths: ["src/escape.js"] }
    ],
    ...overrides
  };
}

function explicitCovers(overrides = {}) {
  const value = minimalDraft(overrides);
  value.tasks[0].covers = ["export-invoice-row-as-csv"];
  value.tasks[1].covers = ["escape-commas-inside-invoice-fields"];
  return value;
}

test("a minimal draft infers version, keys, capability, names, and operation", () => {
  const expanded = expandMinimalSemanticDraft(explicitCovers());
  assert.equal(expanded.version, 4);
  assert.deepEqual(expanded.requirements.map((row) => [row.key, row.capability, row.operation]), [
    ["export-invoice-row-as-csv", "export-invoices", "added"],
    ["escape-commas-inside-invoice-fields", "export-invoices", "added"]
  ]);
  assert.equal(expanded.requirements[0].scenarios[0].name, "Operator exports invoices");
  assert.equal(expanded.requirements[1].scenarios[0].name, "Field contains a comma");
  assert.deepEqual(expanded.tasks.map((task) => [task.key, task.covers]), [
    ["write-the-invoice-csv-exporter", ["export-invoice-row-as-csv"]],
    ["quote-comma-fields-during-escaping", ["escape-commas-inside-invoice-fields"]]
  ]);
  const { draft, issues } = normalizeSemanticDraft(expanded, slugify, { defaultRapidEvidence: true });
  assert.deepEqual(issues, []);
  // No stated reason: the proposal omits Why instead of repeating the intent.
  assert.equal(draft.why, "");
  assert.equal(draft.impact, "low");
  assert.deepEqual(draft.claims.map((claim) => claim.capabilities), [["test"], ["test"]]);
  // Expansion is deterministic, so recompiling yields the same IDs.
  assert.deepEqual(expandMinimalSemanticDraft(explicitCovers()), expanded);
});

// Dogfooding: "What changes" read "it returns 6" and a scenario was titled
// "Sum([1" from a code-shaped trigger.
test("a minimal draft names what changes and code-shaped scenarios after the requirement", () => {
  const expanded = expandMinimalSemanticDraft({
    intent: "Add a sum helper",
    requirements: [{ description: "The library SHALL return the sum of a list of numbers",
      scenarios: [{ when: "sum([1, 2, 3]) is called", then: "it returns 6" },
        { when: "sum([]) is called", then: "it returns 0" }] }],
    tasks: [{ outcome: "Add sum", verify: "npm test", paths: ["src/sum.js"] }]
  });
  assert.deepEqual(expanded.requirements[0].scenarios.map((row) => row.name), [
    "Return the sum of a list of numbers", "Return the sum of a list of numbers (it returns 0)"
  ]);
  const { draft, issues } = normalizeSemanticDraft(expanded, slugify, { defaultRapidEvidence: true });
  assert.deepEqual(issues, []);
  assert.deepEqual(draft.changes, ["Return the sum of a list of numbers"]);
  // An authored outcome that is not just the first example is used as written.
  const outcome = structuredClone(expanded);
  outcome.requirements[0].outcome = "Lists of numbers can be summed";
  assert.deepEqual(normalizeSemanticDraft(outcome, slugify, { defaultRapidEvidence: true }).draft.changes,
    ["Lists of numbers can be summed"]);
});

test("the template shows per-work-type section shapes that compile cleanly", () => {
  const template = semanticDraftTemplate();
  const examples = template.workTypeExamples;
  assert.ok(examples.ui.uiStates.length && examples.ui.componentMap.length && examples.api.apiContracts.length);
  const copied = { ...template, ...examples.ui, ...examples.api, ...examples.config,
    tasks: [{ ...template.tasks[0], paths: ["src/**"] }] };
  assert.deepEqual(designBlueprintWarnings(copied).filter((row) => /placeholder|missing/.test(row)), []);
  assert.deepEqual(devDocumentShapeIssues(copied), []);
  assert.match(template.userFlow.source, /A\["User acts"\]/);
});

// Each example is the whole repair for its type: copied onto the base template
// (without its own workType and userFlow) it leaves no required section
// missing and no field-shape issue, so an author never gets an EDIT round.
test("every work-type example carries exactly its required sections and validates", () => {
  const { workTypeExamples: examples, workType: _type, userFlow: _flow, ...base } = semanticDraftTemplate();
  const typed = WORK_TYPES.filter((type) => !LIGHT_WORK.has(type));
  assert.deepEqual(typed.filter((type) => !examples[type]), [], "every typed work type has an example");
  for (const variant of ["bugfix-security", "bugfix-hotfix"]) assert.ok(examples[variant], variant);
  for (const [name, block] of Object.entries(examples)) {
    if (name === "use") continue;
    const type = name.startsWith("bugfix") ? "bugfix" : name;
    const draft = { ...base, workType: [type], ...structuredClone(block) };
    assert.deepEqual(devDocumentIssues(draft), [], `${name}: required sections`);
    assert.deepEqual(designBlueprintIssues(draft), [], `${name}: field shapes`);
    assert.deepEqual(devDocumentShapeIssues(draft), [], `${name}: dev document shapes`);
    const required = requiredDevSections(draft)
      .filter((key) => !["summary", "failureMatrix"].includes(key))
      .map((key) => key.split(".")[0]);
    assert.deepEqual(Object.keys(block).sort(), [...new Set(required)].sort(),
      `${name}: exactly the required sections`);
    const compiled = normalizeSemanticDraft(structuredClone(draft), slugify).issues
      .filter((issue) => !/discovery/.test(issue));
    assert.deepEqual(compiled, [], `${name}: compiles`);
  }
});

test("the start template states reader-sized writing limits", () => {
  assert.equal(MINIMAL_DRAFT_WRITING.limits.intentMaxCharacters, 70);
  assert.equal(MINIMAL_DRAFT_WRITING.limits.whyMaxSentences, 3);
  assert.match(MINIMAL_DRAFT_WRITING.intent, /70 characters/);
  assert.match(MINIMAL_DRAFT_WRITING.why, /3 plain sentences/);
  assert.match(MINIMAL_DRAFT_WRITING.decisions, /One decision per entry/);
  assert.match(MINIMAL_DRAFT_WRITING.scope, /short phrases/);
  assert.match(MINIMAL_DRAFT_WRITING.language, /user's language/);
  assert.match(MINIMAL_DRAFT_WRITING.sections, /only the sections your work type needs/);
  assert.ok(semanticDraftTemplate().intent.length <= 70);
});

test("the template describes the v5 draft folder with an example that splits cleanly", () => {
  const folder = semanticDraftTemplate().draftFolderV5;
  assert.match(folder.layout, /change\.json/);
  assert.match(folder.layout, /proposal\.md/);
  assert.match(folder.layout, /design\.md/);
  assert.match(folder.headings, /English or Thai/);
  assert.match(folder.headings, /Never write a heading the harness derives/);
  assert.ok(folder.proposalHeadings.some((row) => row.startsWith("Why |")));
  assert.ok(folder.designHeadings.some((row) => row.startsWith("Decisions |")));
  assert.ok(!folder.designHeadings.some((row) => /^(?:Work type|File map|Test map) \|/.test(row)));
  assert.equal(folder.example["change.json"].version, 5);
  for (const document of ["proposal", "design"]) {
    const split = splitProse(document, folder.example[`${document}.md`]);
    assert.deepEqual(split.issues, [], document);
    assert.ok(Object.keys(split.prose).length, document);
  }
});

test("minimal draft keys stay collision-safe and one task covers every requirement", () => {
  const same = { description: "The system SHALL keep invoices",
    scenarios: [{ when: "invoices are kept", then: "they persist" }] };
  const expanded = expandMinimalSemanticDraft(minimalDraft({
    requirements: [same, same],
    tasks: [{ outcome: "Keep invoices", verify: "npm test", paths: ["src/a.js"] }]
  }));
  assert.deepEqual(expanded.requirements.map((row) => row.key), ["keep-invoices", "keep-invoices-2"]);
  assert.deepEqual(expanded.tasks[0].covers, ["keep-invoices", "keep-invoices-2"]);
});

test("a minimal requirement matching the canonical spec compiles as modified", () => {
  const canonical = [
    "# export-invoices", "", "### Requirement: Invoice export", "",
    "The system SHALL export every invoice row as CSV", "",
    "#### Scenario: Export", "", "- **WHEN** an operator exports", "- **THEN** CSV is returned"
  ].join("\n");
  const expanded = expandMinimalSemanticDraft(minimalDraft(), {
    loadCanonicalSpec: (capability) => capability === "export-invoices" ? canonical : null
  });
  assert.equal(expanded.requirements[0].operation, "modified");
  assert.equal(expanded.requirements[0].requirement, "Invoice export");
  assert.equal(expanded.requirements[1].operation, "added");
});

test("several tasks and requirements require explicit covers, even when words overlap", () => {
  // Word overlap would pair these tasks and requirements; it is never guessed.
  const expanded = expandMinimalSemanticDraft(minimalDraft());
  assert.deepEqual(expanded.tasks.map((task) => task.covers), [undefined, undefined]);
  const { issues } = normalizeSemanticDraft(expanded, slugify, { defaultRapidEvidence: true });
  assert.ok(issues.some((issue) =>
    /tasks\[0\]\.covers must name at least one requirement \(several tasks and requirements/.test(issue)));
  assert.ok(issues.some((issue) => /tasks\[1\]\.covers must name/.test(issue)));
  assert.ok(issues.some((issue) => /no implementation task: .*name each in one task's 'covers'/.test(issue)));
});

test("one requirement is covered by every task of a minimal draft", () => {
  const expanded = expandMinimalSemanticDraft(minimalDraft({
    requirements: [minimalDraft().requirements[0]]
  }));
  assert.deepEqual(expanded.tasks.map((task) => task.covers),
    [["export-invoice-row-as-csv"], ["export-invoice-row-as-csv"]]);
  const { issues } = normalizeSemanticDraft(expanded, slugify, { defaultRapidEvidence: true });
  assert.deepEqual(issues, []);
});

const invoiceSpec = [
  "# invoices", "", "### Requirement: Invoice export", "",
  "The system SHALL export every invoice row as CSV", "",
  "#### Scenario: Export", "", "- **WHEN** an operator exports", "- **THEN** CSV is returned"
].join("\n");
const authSpec = [
  "# auth", "", "### Requirement: Session login", "",
  "The system SHALL start a session after a valid login", "",
  "#### Scenario: Login", "", "- **WHEN** a user logs in", "- **THEN** a session starts"
].join("\n");
const specContext = (specs) => ({
  loadCanonicalSpec: (name) => specs[name] ?? null,
  listCanonicalCapabilities: () => Object.keys(specs)
});

test("a minimal draft restating a canonical requirement joins that capability as modified", () => {
  const expanded = expandMinimalSemanticDraft(explicitCovers(),
    specContext({ auth: authSpec, invoices: invoiceSpec }));
  assert.deepEqual(expanded.requirements.map((row) => [row.capability, row.operation]),
    [["invoices", "modified"], ["invoices", "added"]]);
  assert.equal(expanded.requirements[0].requirement, "Invoice export");
});

test("a minimal draft matching an existing capability by paths and words adds to it", () => {
  const expanded = expandMinimalSemanticDraft(minimalDraft({
    intent: "Lock accounts after repeated failures",
    requirements: [{ description: "The system SHALL lock an account after five failures",
      scenarios: [{ when: "a fifth login fails", then: "the account is locked" }] }],
    tasks: [{ outcome: "Lock accounts", verify: "npm test", paths: ["src/auth/lockout.js"] }]
  }), specContext({ auth: authSpec, invoices: invoiceSpec }));
  assert.deepEqual(expanded.requirements.map((row) => [row.capability, row.operation]),
    [["auth", "added"]]);
});

test("a minimal draft matching no existing capability asks for one by name", () => {
  const expanded = expandMinimalSemanticDraft(minimalDraft({
    intent: "Send weekly digest emails",
    requirements: [
      { description: "The system SHALL email a weekly digest",
        scenarios: [{ when: "a week ends", then: "a digest email is sent" }] },
      { description: "The system SHALL skip empty digests",
        scenarios: [{ when: "nothing happened", then: "no email is sent" }] }
    ],
    tasks: [{ outcome: "Send digests", verify: "npm test", paths: ["src/digest.js"] }]
  }), specContext({ auth: authSpec, invoices: invoiceSpec }));
  assert.deepEqual(expanded.requirements.map((row) => row.capability), [undefined, undefined]);
  const { issues } = normalizeSemanticDraft(expanded, slugify, { defaultRapidEvidence: true });
  const capabilityIssues = issues.filter((issue) => /capability/.test(issue));
  assert.equal(capabilityIssues.length, 1);
  assert.match(capabilityIssues[0], /'capability' is required: .*one of: auth, invoices/);
  // An explicit capability is always kept.
  const chosen = expandMinimalSemanticDraft(minimalDraft({
    requirements: [{ ...minimalDraft().requirements[0], capability: "digest" }],
    tasks: [{ outcome: "Send digests", verify: "npm test", paths: ["src/digest.js"] }]
  }), specContext({ auth: authSpec }));
  assert.equal(chosen.requirements[0].capability, "digest");
  assert.equal(chosen._capabilityChoices, undefined);
});

test("explicit versions and non-minimal shapes are never expanded", () => {
  const v3 = semanticDraft();
  assert.equal(expandMinimalSemanticDraft(v3), v3);
  const v4 = minimalDraft({ version: 4 });
  assert.equal(expandMinimalSemanticDraft(v4), v4);
  const legacy = { intent: "x", claims: [], specs: [], requirements: [{ description: "y" }],
    tasks: [{ outcome: "z" }] };
  assert.equal(expandMinimalSemanticDraft(legacy), legacy);
});

test("a minimal draft that declares risk defaults evidence unless it names security triggers", () => {
  const defaulted = normalizeSemanticDraft(expandMinimalSemanticDraft(
    minimalDraft({ impact: "high" })), slugify, { defaultRapidEvidence: true });
  assert.ok(!defaulted.issues.some((issue) => /evidence/.test(issue)), defaulted.issues.join("\n"));
  assert.deepEqual(defaulted.draft._defaultedEvidence,
    ["export-invoice-row-as-csv", "escape-commas-inside-invoice-fields"]);
  const { issues } = normalizeSemanticDraft(expandMinimalSemanticDraft(
    minimalDraft({ impact: "high", securityTriggers: ["auth"] })), slugify,
  { defaultRapidEvidence: true });
  assert.ok(issues.some((issue) => /requires evidence\['export-invoice-row-as-csv'\]/.test(issue)));
});

test("the minimal template compiles once expanded", () => {
  const { issues } = normalizeSemanticDraft(
    expandMinimalSemanticDraft(minimalSemanticDraftTemplate()), slugify,
    { defaultRapidEvidence: true });
  assert.deepEqual(issues, []);
});

// Benchmark v3.5.29 (kanban, no capability named, no existing specs): the
// capability was the cut intent sentence and keys were description slugs cut
// mid-phrase, both of which became living-spec names.
const kanbanRequirements = [
  { description: "The board SHALL show three fixed columns (To Do, In Progress, Done)",
    scenarios: [{ when: "the page opens", then: "three columns show" }] },
  { description: "The board SHALL let the user move a card to any other column",
    scenarios: [{ when: "a card is dropped on another column", then: "the card moves" }] },
  { description: "The board SHALL persist its cards in browser localStorage and restore them",
    scenarios: [{ when: "the page reloads", then: "the cards remain" }] }
];
const kanbanDraft = (overrides = {}) => ({
  intent: "Users can manage tasks on a browser kanban board",
  requirements: kanbanRequirements,
  tasks: [{ outcome: "Build the board page", verify: "npm test", paths: ["index.html"] }],
  ...overrides
});

test("a new capability is named by the intent's short noun phrase", () => {
  const capability = (intent, paths = ["src/a.js"]) => expandMinimalSemanticDraft(minimalDraft({
    intent, requirements: [minimalDraft().requirements[0]],
    tasks: [{ outcome: "Do it", verify: "npm test", paths }]
  })).requirements[0].capability;
  assert.equal(capability("Users can manage tasks on a browser kanban board"), "kanban-board");
  assert.equal(capability("Users can manage tasks on a browser-based kanban board stored in localStorage"),
    "kanban-board");
  assert.equal(capability("Create kanban board"), "kanban-board");
  assert.equal(capability("Add a dark mode toggle to the settings page"), "dark-mode-toggle");
  assert.equal(capability("Provide a todo list app with localStorage persistence"), "todo-list-app");
  assert.equal(capability("Users can export reports as CSV"), "reports");
  // Nothing sensible remains: the previous intent slug, then a path segment.
  assert.equal(capability("Users can manage"), "users-can-manage");
  assert.equal(capability("ทำบอร์ด", ["src/board/view.js"]), "board");
  for (const intent of ["Users can manage tasks on a browser kanban board", "Create kanban board"])
    assert.ok(capability(intent).split("-").length <= 3);
});

test("a minimal draft's top-level capability names the living spec", () => {
  const named = expandMinimalSemanticDraft(kanbanDraft({ capability: "task-board" }),
    specContext({ auth: authSpec, invoices: invoiceSpec }));
  assert.equal(named.capability, undefined, "the top-level name is not a v4 field");
  assert.deepEqual(named.requirements.map((row) => row.capability),
    ["task-board", "task-board", "task-board"]);
  assert.equal(named._capabilityChoices, undefined);
  const { issues } = normalizeSemanticDraft(named, slugify, { defaultRapidEvidence: true });
  assert.deepEqual(issues, []);
});

test("derived requirement keys are short whole words and headings are readable titles", () => {
  const expanded = expandMinimalSemanticDraft(kanbanDraft());
  assert.deepEqual(expanded.requirements.map((row) => [row.key, row.requirement]), [
    ["show-three-fixed-columns", "Show three fixed columns"],
    ["move-card-to-other-column", "Let the user move a card to any other column"],
    ["persist-cards-in-browser-localstorage", "Persist its cards in browser localStorage"]
  ]);
  for (const { key } of expanded.requirements) {
    assert.ok(key.length <= 40 && key.split("-").length <= 5, key);
    assert.doesNotMatch(key, /-(?:and|the|to|in|of|a|an|or)$/, key);
  }
  assert.deepEqual(expandMinimalSemanticDraft(kanbanDraft()), expanded, "deterministic");
  // Same clause twice: keys and headings stay unique.
  const twice = expandMinimalSemanticDraft(kanbanDraft({
    requirements: [kanbanRequirements[0], kanbanRequirements[0]]
  }));
  assert.deepEqual(twice.requirements.map((row) => [row.key, row.requirement]), [
    ["show-three-fixed-columns", "Show three fixed columns"],
    ["show-three-fixed-columns-2", "Show three fixed columns (2)"]
  ]);
  // Explicit keys and titles are kept verbatim.
  const explicit = expandMinimalSemanticDraft(kanbanDraft({
    requirements: [{ ...kanbanRequirements[0], key: "columns", requirement: "Fixed columns" }]
  }));
  assert.deepEqual([explicit.requirements[0].key, explicit.requirements[0].requirement],
    ["columns", "Fixed columns"]);
  const { draft, issues } = normalizeSemanticDraft(expanded, slugify, { defaultRapidEvidence: true });
  assert.deepEqual(issues, []);
  assert.match(renderRequirementMarkdown(draft.specs[2]),
    /^### Requirement: Persist its cards in browser localStorage\n/);
});

test("a revise keeps the requirement keys and capability its change already uses", () => {
  const legacyKeys = ["show-three-fixed-columns-to-do-in-progress-done",
    "let-the-user-move-a-card-to-any-other-column"];
  const revised = expandMinimalSemanticDraft(kanbanDraft(), {
    priorRequirementKeys: legacyKeys, priorCapabilities: ["users-can-manage-tasks-on-a-browser"]
  });
  assert.deepEqual(revised.requirements.map((row) => [row.key, row.requirement, row.capability]), [
    [legacyKeys[0], undefined, "users-can-manage-tasks-on-a-browser"],
    [legacyKeys[1], undefined, "users-can-manage-tasks-on-a-browser"],
    ["persist-cards-in-browser-localstorage", "Persist its cards in browser localStorage",
      "users-can-manage-tasks-on-a-browser"]
  ]);
});

test("a new capability's delta states a Purpose; an existing one never does", () => {
  const { draft } = normalizeSemanticDraft(expandMinimalSemanticDraft(kanbanDraft()), slugify,
    { defaultRapidEvidence: true });
  assert.equal(draft.specs[0].purpose,
    "Users can manage tasks on a browser kanban board. Requirements: Show three fixed columns; " +
    "Let the user move a card to any other column; Persist its cards in browser localStorage.");
  assert.equal(renderSpecHeading(draft.specs[0], { newCapability: true }),
    `# kanban-board\n\n## Purpose\n\n${draft.specs[0].purpose}`);
  assert.equal(renderSpecHeading(draft.specs[0]), "# kanban-board");
  // A long intent is the whole Purpose; an overview replaces the derivation.
  assert.equal(derivedCapabilityPurpose("Users can drag cards between the three columns of a board", ["X"]),
    "Users can drag cards between the three columns of a board.");
  const overview = normalizeSemanticDraft(expandMinimalSemanticDraft(kanbanDraft({
    capabilityOverviews: { "kanban-board": "Lets one person track work as cards in three columns." }
  })), slugify, { defaultRapidEvidence: true }).draft;
  assert.equal(renderSpecHeading(overview.specs[0], { newCapability: true }),
    "# kanban-board\n\n## Purpose\n\nLets one person track work as cards in three columns.");
});

test("an amendment adding a new capability states its Purpose and a revise keeps headings", (t) => {
  const root = mkdtempSync(join(tmpdir(), "amend-purpose-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const change = join(root, "openspec", "changes", "board");
  mkdirSync(join(change, "specs", "kanban-board"), { recursive: true });
  mkdirSync(join(root, "openspec", "specs", "auth"), { recursive: true });
  writeFileSync(join(root, "openspec", "specs", "auth", "spec.md"), authSpec);
  writeFileSync(join(change, "specs", "kanban-board", "spec.md"), [
    "# kanban-board", "", "## Purpose", "", "Track cards.", "", "## ADDED Requirements", "",
    "### Requirement: Show three fixed columns", "", "The board SHALL show three columns.", "",
    "#### Scenario: Page opens", "", "- **WHEN** the page opens", "- **THEN** three columns show", ""
  ].join("\n"));
  writeFileSync(join(change, "evidence.yaml"), JSON.stringify({ version: 1 }));
  const contract = { version: 1, providers: {}, claims: [{ id: "show-three-fixed-columns",
    requirementKey: "show-three-fixed-columns", scenario: "Page opens", capabilities: ["test"] }] };
  const compiled = compileSemanticAmendment({
    amendment: {
      version: 1, reason: "Build found the board needs an archive of finished cards",
      addRequirements: [
        { key: "archive-done-cards", capability: "card-archive", scenarios: [{ name: "Archive",
          when: "a done card is archived", then: "it leaves the board" }], outcome: "archived" },
        { key: "session-expiry", capability: "auth", scenarios: [{ name: "Expiry",
          when: "a session is idle", then: "it expires" }], outcome: "expired" }
      ],
      reviseRequirements: [{ key: "show-three-fixed-columns", capability: "kanban-board",
        scenario: "Page opens", outcome: "Four columns show" }],
      addTasks: [{ key: "archive", outcome: "Archive cards", paths: ["src/**"], verify: "npm test",
        covers: ["archive-done-cards", "session-expiry", "show-three-fixed-columns"] }],
      evidence: { "archive-done-cards": { capabilities: ["test"] },
        "session-expiry": { capabilities: ["test"] },
        "show-three-fixed-columns": { capabilities: ["test"] } }
    },
    contract, slugify, renderTask: () => "",
    tasksContent: "# Tasks\n\n- [ ] **T001** Build [key:impl] [claims:show-three-fixed-columns] — verify: `npm test`\n"
  });
  assert.deepEqual(compiled.issues, []);
  writeSemanticAmendment(change, compiled, slugify, { schema: "foundation-standard" });
  const added = readFileSync(join(change, "specs", "card-archive", "spec.md"), "utf8");
  assert.match(added, /^# card-archive\n\n## Purpose\n\nBuild found the board needs an archive of finished cards\.\n\n## ADDED Requirements\n/);
  assert.doesNotMatch(readFileSync(join(change, "specs", "auth", "spec.md"), "utf8"), /## Purpose/);
  const revised = readFileSync(join(change, "specs", "kanban-board", "spec.md"), "utf8");
  assert.match(revised, /### Requirement: Show three fixed columns\n[\s\S]*Four columns show/);
});

// Derived scenario titles (benchmark: "The user adds a card titled" was cut
// mid-phrase and repeated cases became "(case 2)").
function derivedScenarioNames(scenarios) {
  return expandMinimalSemanticDraft(minimalDraft({
    requirements: [{ description: "The system SHALL manage board cards", scenarios }],
    tasks: [{ outcome: "Build the board", verify: "npm test", paths: ["src/board.js"] }]
  })).requirements[0].scenarios.map((scenario) => scenario.name);
}

test("derived scenario names are whole-word titles without dangling words", () => {
  const names = derivedScenarioNames([
    { when: "The user adds a card titled \"Buy milk\" to the To Do column of the board",
      then: "the card appears in To Do" },
    { when: "The user moves a To Do card into the Done column of the board after review",
      then: "the card appears in Done" },
    { when: "the user opens the board", then: "three columns render" }
  ]);
  assert.deepEqual(names, [
    "User adds a card titled \"Buy milk\" to the To Do column",
    "User moves a To Do card into the Done column of the board",
    "User opens the board"
  ]);
  for (const name of names) {
    assert.ok(name.length <= 60, name);
    assert.doesNotMatch(name, /\b(?:a|an|the|to|of|titled|into|from)$/i, name);
    assert.doesNotMatch(name, /\(case \d+\)/);
  }
});

test("a derived name never cuts inside a quoted title or repeats WHEN", () => {
  const [quoted, short] = derivedScenarioNames([
    { when: "the user adds a card titled \"Prepare the quarterly planning review deck\"",
      then: "the card appears" },
    { when: "user exports", then: "a CSV file is returned" }
  ]);
  // The quote cannot close within the limit, and "titled" would dangle.
  assert.equal(quoted, "User adds a card");
  assert.equal(quoted.includes("\""), false);
  // A short trigger without an article would repeat WHEN; the outcome names it.
  assert.equal(short, "CSV file is returned");
  const { issues } = normalizeSemanticDraft(expandMinimalSemanticDraft(minimalDraft({
    requirements: [{ description: "The system SHALL export",
      scenarios: [{ when: "user exports", then: "a CSV file is returned" }] }],
    tasks: [{ outcome: "Export", verify: "npm test", paths: ["src/export.js"] }]
  })), slugify, { defaultRapidEvidence: true });
  assert.deepEqual(issues, []);
});

test("colliding derived names are told apart by their precondition or outcome", () => {
  const names = derivedScenarioNames([
    { when: "The user deletes a card", then: "the card is removed" },
    { when: "The user deletes a card", given: "the card is the last one in its column",
      then: "the column shows an empty state" },
    { when: "The user deletes a card", then: "an undo notice appears" },
    { when: "The user deletes a card", then: "an undo notice appears" }
  ]);
  assert.deepEqual(names, [
    "User deletes a card",
    "User deletes a card (card is the last one in its column)",
    "User deletes a card (undo notice appears)",
    "User deletes a card (2)"
  ]);
  assert.equal(new Set(names).size, names.length);
  // Deterministic: the same draft yields the same names.
  assert.deepEqual(derivedScenarioNames([
    { when: "The user deletes a card", then: "the card is removed" },
    { when: "The user deletes a card", given: "the card is the last one in its column",
      then: "the column shows an empty state" },
    { when: "The user deletes a card", then: "an undo notice appears" },
    { when: "The user deletes a card", then: "an undo notice appears" }
  ]), names);
});

test("minimal draft decisions record agent defaults without forcing design", () => {
  const expanded = expandMinimalSemanticDraft(minimalDraft({
    requirements: [minimalDraft().requirements[0]],
    decisions: [
      { key: "stack", choice: "Plain HTML and JavaScript", reason: "No build step is needed" },
      { key: "storage", choice: "localStorage" }
    ]
  }));
  assert.deepEqual(expanded.decisions.map((row) => [row.key, row.decidedBy]),
    [["stack", "agent"], ["storage", "agent"]]);
  const { draft, issues } = normalizeSemanticDraft(expanded, slugify, { defaultRapidEvidence: true });
  assert.deepEqual(issues, []);
  // Agent defaults keep the rapid lane; a user decision is design content.
  assert.equal(semanticDraftKeepsDesign(draft, true), false);
  assert.equal(semanticDraftKeepsDesign({
    ...draft, decisions: [{ ...draft.decisions[0], decidedBy: "user" }]
  }, true), true);
  const proposal = renderDraftProposal(draft, { intent: "Export invoices as CSV", schema: "foundation-rapid" });
  assert.match(proposal, /## Decisions\n\n- \*\*stack:\*\* Plain HTML and JavaScript — No build step is needed \(decided by agent\)\n- \*\*storage:\*\* localStorage \(decided by agent\)/);
  assert.doesNotMatch(proposal, /No alternative was open/);
  // The standard lane keeps decisions in design.md, not the proposal.
  assert.doesNotMatch(renderDraftProposal(draft, { intent: "x", schema: "foundation-standard" }),
    /## Decisions/);
  const invalid = normalizeSemanticDraft({ ...expanded,
    decisions: [{ key: "stack", choice: "Vue", decidedBy: "robot" }] }, slugify,
  { defaultRapidEvidence: true });
  assert.match(invalid.issues.join("\n"), /decisions\[0\]\.decidedBy must be user\|agent/);
});

test("a proposal without a stated why does not repeat the intent", () => {
  const { draft } = normalizeSemanticDraft(expandMinimalSemanticDraft(explicitCovers()), slugify,
    { defaultRapidEvidence: true });
  const proposal = renderDraftProposal(draft, { intent: "Export invoices as CSV", schema: "foundation-rapid" });
  assert.match(proposal, /^# Change: Export invoices as CSV\n/);
  assert.doesNotMatch(proposal, /## Why/);
  assert.equal(proposal.split("Export invoices as CSV").length - 1, 1);
  const stated = renderDraftProposal({ ...draft, why: "Accountants reconcile invoices in spreadsheets" },
    { intent: "Export invoices as CSV", schema: "foundation-rapid" });
  assert.match(stated, /## Why\n\nAccountants reconcile invoices in spreadsheets/);
});

test("a partial draft merges by identity, deletes with null, and drops removed links", () => {
  const prior = {
    version: 4, intent: "Bound intake", why: "Keep intake fast", nonGoals: ["No queue"],
    requirements: [
      { key: "throughput", outcome: "20 per second",
        scenarios: [{ name: "Fast", when: "messages arrive", then: "20 accepted" },
          { name: "Burst", when: "a burst arrives", then: "it is queued" }] },
      { key: "ack", outcome: "Acknowledge after commit", scenarios: [] }
    ],
    tasks: [{ key: "implement", outcome: "Implement", covers: ["throughput", "ack"], verify: "npm test" }],
    evidence: { throughput: { capabilities: ["test"] }, ack: { capabilities: ["test"] } },
    discovery: { coverage: [{ dimension: "compatibility", status: "needs-investigation" }] }
  };
  const frozen = structuredClone(prior);
  const merged = mergeSemanticDraft(prior, {
    why: null,
    nonGoals: ["No queue", "No retry"],
    requirements: [
      { key: "throughput", outcome: "50 per second",
        scenarios: [{ name: "Fast", then: "50 accepted" }, { name: "Burst", $remove: true }] },
      { key: "ack", $remove: true },
      { key: "trim", outcome: "Titles are trimmed" }
    ],
    discovery: { coverage: [{ dimension: "compatibility", status: "not-applicable" }] }
  });
  assert.deepEqual(prior, frozen, "the prior draft is not mutated");
  assert.equal("why" in merged, false);
  assert.deepEqual(merged.nonGoals, ["No queue", "No retry"]);
  assert.deepEqual(merged.requirements.map((row) => row.key), ["throughput", "trim"]);
  assert.deepEqual(merged.requirements[0].scenarios,
    [{ name: "Fast", when: "messages arrive", then: "50 accepted" }]);
  assert.equal(merged.requirements[0].outcome, "50 per second");
  // The removed requirement's evidence and coverage go with it.
  assert.deepEqual(merged.evidence, { throughput: { capabilities: ["test"] } });
  assert.deepEqual(merged.tasks[0].covers, ["throughput"]);
  assert.equal(merged.tasks[0].outcome, "Implement");
  assert.deepEqual(merged.discovery.coverage, [{ dimension: "compatibility", status: "not-applicable" }]);
  // An entry without the identity is appended; an array without one is replaced.
  assert.equal(mergeSemanticDraft(prior, { requirements: [{ outcome: "New" }] }).requirements.length, 3);
  assert.deepEqual(mergeSemanticDraft({ risks: [{ risk: "a" }] }, { risks: [{ risk: "b" }] }).risks,
    [{ risk: "b" }]);
  assert.throws(() => mergeSemanticDraft(prior, []), /patch must be a JSON object/);
  assert.throws(() => mergeSemanticDraft(null, {}), /requires the change's prior draft/);
});

test("a partial draft entry merges by any identity it names, and an unmatched $remove fails", () => {
  const prior = {
    requirements: [
      { key: "throughput", name: "Throughput", outcome: "20 per second" },
      { key: "ack", name: "Acknowledge", outcome: "Acknowledge after commit" }
    ]
  };
  const byName = mergeSemanticDraft(prior, {
    requirements: [{ name: "Throughput", outcome: "50 per second" },
      { name: "Acknowledge", $remove: true }]
  });
  assert.deepEqual(byName.requirements,
    [{ key: "throughput", name: "Throughput", outcome: "50 per second" }],
    "an entry named by name merges instead of appending a duplicate");
  assert.throws(() => mergeSemanticDraft(prior, {
    requirements: [{ key: "missing", $remove: true }]
  }), /"\$remove" names key 'missing', which matches no existing entry/);
  assert.throws(() => mergeSemanticDraft(prior, {
    requirements: [{ outcome: "unnamed", $remove: true }]
  }), /"\$remove" entry names no key or name/);
  assert.deepEqual(prior.requirements.map((row) => row.key), ["throughput", "ack"]);
});

function riskDraft(overrides = {}) {
  return {
    version: 4,
    intent: "Change one bounded outcome",
    requirements: [{ key: "outcome", description: "The system SHALL return the result",
      scenarios: [{ name: "Result", when: "Input arrives", then: "The result is returned" }] }],
    tasks: [{ key: "do", outcome: "Implement", covers: ["outcome"], paths: ["src/result.js"],
      verify: "npm test" }],
    ...overrides
  };
}

const tasksAt = (...paths) => paths.map((path, index) => ({
  key: `t${index}`, outcome: "Implement", covers: ["outcome"], paths: [path], verify: "npm test"
}));

test("risk derivation reads coupling from service, package, and repository spans", () => {
  assert.deepEqual(deriveDraftRisk(riskDraft()),
    { impact: "low", coupling: "isolated", reasons: { impact: [], coupling: [] } });
  assert.deepEqual(deriveDraftRisk(riskDraft({
    tasks: tasksAt("services/orders/**", "services/billing/src/a.js") })).reasons.coupling,
  ["tasks span services/billing, services/orders"]);
  assert.equal(deriveDraftRisk(riskDraft({
    tasks: tasksAt("packages/ui/**", "packages/core/**") })).coupling, "coupled");
  // Two folders of one service are not two services.
  assert.equal(deriveDraftRisk(riskDraft({
    tasks: tasksAt("services/orders/src/**", "services/orders/test/**") })).coupling, "isolated");
  assert.equal(deriveDraftRisk(riskDraft({
    tasks: tasksAt("src/a.js", "src/b.js") })).coupling, "isolated");
  assert.deepEqual(deriveDraftRisk(riskDraft({
    repositories: [{ id: "root" }, { id: "web", mode: "write" }] })).reasons.coupling,
  ["repositories root, web"]);
  assert.deepEqual(deriveDraftRisk(riskDraft({ integrations: [{ name: "Stripe" }] }))
    .reasons.coupling, ["declares integrations"]);
});

test("risk derivation reads data and published-contract work as medium impact", () => {
  assert.equal(deriveDraftRisk(riskDraft({ tasks: tasksAt("schema.sql") })).impact, "medium");
  assert.equal(deriveDraftRisk(riskDraft({ tasks: tasksAt("migration.mjs") })).impact, "medium");
  assert.equal(deriveDraftRisk(riskDraft({ tasks: tasksAt("src/api/notes.js") })).impact, "medium");
  assert.equal(deriveDraftRisk(riskDraft({ tasks: tasksAt("src/workers/sync.js") })).impact, "medium");
  assert.match(deriveDraftRisk(riskDraft({
    intent: "Version the order event schema" })).reasons.impact.join(), /published contract/);
  assert.match(deriveDraftRisk(riskDraft({
    requirements: [{ key: "outcome", description: "The system SHALL restore rows on rollback",
      scenarios: [{ name: "Undo", when: "Rolled back", then: "Rows return" }] }]
  })).reasons.impact.join(), /data work \('rollback'\)/);
  // A model file alone is not persistence; ordinary words are not contracts.
  assert.equal(deriveDraftRisk(riskDraft({ tasks: tasksAt("src/models/note.js") })).impact, "low");
  assert.equal(deriveDraftRisk(riskDraft({ intent: "Show the event list" })).impact, "low");
  // A bare "payloads" is function input (a validator's argument), not a contract;
  // a request/response payload is.
  assert.equal(deriveDraftRisk(riskDraft({
    intent: "Reject invalid seat counts; create_workspace returns 422 for such payloads" })).impact, "low");
  assert.match(deriveDraftRisk(riskDraft({
    intent: "Change the response payload shape" })).reasons.impact.join(), /published contract/);
  // A declared work type replaces text inference; persistence paths still count.
  assert.equal(deriveDraftRisk(riskDraft({ workType: ["bugfix"],
    intent: "Fix the API rounding" })).impact, "low");
  assert.equal(deriveDraftRisk(riskDraft({ workType: ["bugfix"],
    tasks: tasksAt("db/schema.sql") })).impact, "medium");
  assert.equal(deriveDraftRisk(riskDraft({ workType: ["api"] })).impact, "medium");
});

test("derived risk only raises, records why, and is removed from the stored draft", () => {
  const spanning = riskDraft({ tasks: tasksAt("services/a/**", "services/b/**") });
  const raised = withDerivedRisk({ ...spanning, impact: "low", coupling: "isolated" });
  assert.equal(raised.coupling, "coupled");
  assert.equal(raised.impact, "low");
  assert.equal(riskLabel(raised, "coupling"),
    "coupled (derived: tasks span services/a, services/b; declared isolated)");
  assert.equal(riskLabel(raised, "impact"), "low");
  assert.deepEqual(declaredDraftRisk(raised), { ...spanning, impact: "low", coupling: "isolated" });
  assert.deepEqual(declaredDraftRisk(withDerivedRisk(spanning)), spanning);
  // Re-deriving a derived draft is stable, and a narrowed draft derives again.
  assert.deepEqual(withDerivedRisk(raised), raised);
  assert.equal(withDerivedRisk({ ...raised, tasks: tasksAt("services/a/**") }).coupling, "isolated");
  // Declared high stays high; legacy drafts and unknown values are untouched.
  const high = withDerivedRisk(riskDraft({ impact: "high", tasks: tasksAt("db/a.sql") }));
  assert.equal(high.impact, "high");
  assert.equal(high._riskDerivation, undefined);
  const legacy = { version: 1, tasks: tasksAt("services/a/**", "services/b/**") };
  assert.equal(withDerivedRisk(legacy), legacy);
  assert.equal(withDerivedRisk(riskDraft({ coupling: "loose",
    tasks: tasksAt("services/a/**", "services/b/**") })).coupling, "loose");
});

test("a derived standard draft says why in its proposal and its evidence repair", () => {
  const source = withDerivedRisk(riskDraft({
    capability: undefined, securityTriggers: ["auth"],
    requirements: [{ key: "outcome", capability: "orders", description: "The system SHALL return the result",
      scenarios: [{ name: "Result", when: "Input arrives", then: "The result is returned" }] }],
    tasks: tasksAt("services/orders/**", "services/billing/**")
  }));
  const { draft, issues } = normalizeSemanticDraft(source, slugify, { defaultRapidEvidence: true });
  assert.match(issues.join("\n"), /requires evidence\['outcome'\]\.capabilities .*the harness derived coupling coupled \(derived: tasks span services\/billing, services\/orders\)/);
  assert.equal(draft.coupling, "coupled");
  const proposal = renderDraftProposal(draft, { intent: draft.intent, schema: "foundation-standard" });
  assert.match(proposal, /^- \*\*Coupling:\*\* coupled \(derived: tasks span services\/billing, services\/orders\)$/m);
  // Resolve keeps the reason while the value holds and replaces it otherwise.
  assert.equal(synchronizeProposalClassification(proposal, { impact: "low", coupling: "coupled" }),
    proposal);
  assert.match(synchronizeProposalClassification(proposal, { coupling: "isolated" }),
    /^- \*\*Coupling:\*\* isolated$/m);
});

function investigationDraft() {
  const source = semanticDraft({ integrations: [], nonGoals: ["Never delete payment history"],
    decisions: [{ key: "storage", choice: "Keep existing storage", reason: "Avoid migration" }] });
  source.investigation = { version: 2, id: "payment-research", outcome: "ready-for-change",
    summary: "Keep retries safe", changeIntent: source.intent, statePath: ".foundation/investigations/payment-research.json",
    stateDigest: "bound-at-runtime", sourceDigest: "bound-at-runtime",
    intake: { purpose: "change", intent: { goal: "Safe retries", outcome: "One payment", scope: ["Payment retries"] },
      conversation: [{ key: "request", speaker: "user", statement: "Keep history and avoid duplicate charges", source: "session:message:1" }],
      requirements: [
        { key: "retry", revision: 1, kind: "behavior", statement: "Avoid duplicate charges", status: "stated", material: true, origin: "user", examples: ["Timeout then retry"], criteria: ["Exactly one charge"], conversationKeys: ["request"] },
        { key: "history", revision: 1, kind: "non-goal", statement: "Never delete payment history", status: "stated", material: true, origin: "user", conversationKeys: ["request"] },
        { key: "storage", revision: 1, kind: "constraint", statement: "Keep existing storage", status: "stated", material: true, origin: "user", conversationKeys: ["request"] }
      ], questions: [{ key: "result", question: "How many charges?", status: "answered", answer: "Exactly one", conversationKeys: ["request"] }],
      experiments: [{ key: "local", question: "Does retry duplicate?", status: "complete", criteria: ["one charge"],
        findings: ["No duplicates"], limitations: ["Local fixture only"], requirementRefs: [{ key: "retry", revision: 1 }] }],
      historyGaps: ["An earlier session is unavailable"] }
  };
  source.investigationCoverage = [
    { sourceKey: "retry", sourceRevision: 1, targets: [{ kind: "requirement", key: "payment-retry" }, { kind: "scenario", key: "payment-retry", scenario: "timeout" }] },
    { sourceKey: "history", sourceRevision: 1, targets: [{ kind: "non-goal", key: "Never delete payment history" }] },
    { sourceKey: "storage", sourceRevision: 1, targets: [{ kind: "design", key: "storage" }] }
  ];
  return source;
}

test("investigation coverage accepts real many-to-many targets and reports uncovered user requirements", () => {
  const source = investigationDraft();
  assert.deepEqual(normalizeSemanticDraft(source, slugify).issues, []);
  source.investigationCoverage.pop();
  assert.match(normalizeSemanticDraft(source, slugify).issues.join("\n"), /storage@1.*uncovered/);
  source.investigationCoverage[0].targets[1].scenario = "missing-scenario";
  assert.match(normalizeSemanticDraft(source, slugify).issues.join("\n"), /invalid scenario target/);
});

test("coverage rejects superseded intent, duplicate source rows and nonexistent targets", () => {
  const source = investigationDraft();
  source.investigationCoverage.push(source.investigationCoverage[0]);
  source.investigation.intake.requirements[0].status = "superseded";
  source.investigationCoverage[1].targets[0].key = "Drop all history";
  const issues = normalizeSemanticDraft(source, slugify).issues.join("\n");
  assert.match(issues, /repeats source/);
  assert.match(issues, /not current user intent/);
  assert.match(issues, /invalid non-goal target/);
});

test("compiled proposal retains examples, criteria, decisions, experiment limitations and conversation gaps", () => {
  const source = investigationDraft(), { draft, issues } = normalizeSemanticDraft(source, slugify);
  assert.deepEqual(issues, []);
  const packet = renderDraftProposal(draft, { id: "payment", intent: source.intent, schema: "foundation-standard" });
  for (const detail of ["Timeout then retry", "Exactly one charge", "Keep existing storage",
    "Local fixture only", "An earlier session is unavailable", "session:message:1", "retry@1", "scenario: payment-retry / timeout"])
    assert.ok(packet.includes(detail), detail);
  assert.match(packet, /agent must compare meaning/);
  const thai = renderDraftProposal({ ...draft, language: "th" }, { intent: source.intent, schema: "foundation-standard" });
  assert.match(thai, /ความครบของ requirement/);
  assert.match(thai, /ช่องว่างของประวัติ/);
});

test("legacy handoffs and changes without investigation require no retroactive coverage", () => {
  const source = investigationDraft();
  source.investigation.version = 1;
  delete source.investigationCoverage;
  assert.deepEqual(normalizeSemanticDraft(source, slugify).issues, []);
  delete source.investigation;
  assert.deepEqual(normalizeSemanticDraft(source, slugify).issues, []);
});

test("semantic amendments cannot orphan a retained investigation requirement", () => {
  const source = investigationDraft();
  const { draft } = normalizeSemanticDraft(source, slugify);
  const tasksContent = draft.tasks.map((task, i) => renderDraftTask(task, i)).join("\n");
  const result = compileSemanticAmendment({
    amendment: { version: 1, reason: "Remove retry", removeRequirements: [{ key: "payment-retry", migration: "Retain records" }] },
    contract: { version: 2, claims: draft.claims, providers: {} }, tasksContent, slugify,
    renderTask: renderDraftTask, semanticDraftVersion: 3, investigationSource: source
  });
  assert.match(result.issues.join("\n"), /invalid requirement target|invalid scenario target/);
});

const TWO_CONSTRAINTS = ["Keep the existing payment table", "Respond within 200 ms"];

test("draft constraints render as a proposal section before Non-goals", () => {
  const state = { intent: "Keep payment retries safe", schema: "foundation-standard" };
  const plain = normalizeSemanticDraft(semanticDraftV4({ nonGoals: ["No refunds"] }), slugify);
  const constrained = normalizeSemanticDraft(semanticDraftV4({
    nonGoals: ["No refunds"], constraints: TWO_CONSTRAINTS
  }), slugify);
  assert.deepEqual(constrained.issues, []);
  assert.deepEqual(constrained.draft.constraints, TWO_CONSTRAINTS);
  const proposal = renderDraftProposal(constrained.draft, state);
  const section = "\n\n## Constraints\n\n- Keep the existing payment table\n- Respond within 200 ms";
  assert.ok(proposal.includes(section));
  assert.ok(proposal.indexOf("## Constraints") < proposal.indexOf("## Non-goals"));
  // Without constraints there is no section and every other line is unchanged.
  assert.equal(Object.hasOwn(plain.draft, "constraints"), false);
  const unconstrained = renderDraftProposal(plain.draft, state);
  assert.doesNotMatch(unconstrained, /## Constraints/);
  assert.equal(proposal.replace(section, ""), unconstrained);
});

test("constraints must be an array of non-empty strings", () => {
  for (const constraints of ["Keep the existing payment table", ["Keep it", ""], ["ok", 3]]) {
    const issues = normalizeSemanticDraft(semanticDraftV4({ constraints }), slugify).issues;
    assert.ok(issues.includes("semantic draft constraints must be an array of non-empty strings"),
      JSON.stringify(constraints));
  }
});

test("investigation coverage maps a requirement to a constraint by its exact text", () => {
  const source = investigationDraft();
  source.constraints = ["Keep existing storage"];
  source.investigationCoverage[2].targets = [{ kind: "constraint", key: "Keep existing storage" }];
  assert.deepEqual(normalizeSemanticDraft(source, slugify).issues, []);
  source.investigationCoverage[2].targets = [{ kind: "constraint", key: "Keep the storage" }];
  assert.match(normalizeSemanticDraft(source, slugify).issues.join("\n"),
    /storage@1' has missing or invalid constraint target 'Keep the storage'/);
  source.investigationCoverage.pop();
  assert.match(normalizeSemanticDraft(source, slugify).issues.join("\n"),
    /storage@1' is uncovered; map to requirement, scenario, non-goal, constraint or design/);
});

test("an amendment keeps the change's constraints for investigation coverage", () => {
  const source = investigationDraft();
  source.constraints = ["Keep existing storage"];
  source.investigationCoverage[2].targets = [{ kind: "constraint", key: "Keep existing storage" }];
  const { draft } = normalizeSemanticDraft(source, slugify);
  const tasksContent = draft.tasks.map((task, i) => renderDraftTask(task, i)).join("\n");
  const compile = (amendment) => compileSemanticAmendment({
    amendment: { version: 1, reason: "Name the audit sink", ...amendment },
    contract: { version: 2, claims: draft.claims, providers: {} }, tasksContent, slugify,
    renderTask: renderDraftTask, semanticDraftVersion: 3, investigationSource: source
  });
  assert.doesNotMatch(compile({}).issues.join("\n"), /constraint target/);
  assert.match(compile({ constraints: ["Move to new storage"] }).issues.join("\n"),
    /invalid constraint target 'Keep existing storage'/);
});

test("a benchmark provider needs at least three runs and a non-negative regression limit", () => {
  const issuesFor = (provider) => normalizeSemanticDraft(semanticDraftV4({
    execution: { version: 1, services: {}, providers: {
      performance: { adapter: "benchmark", command: ["npm", "run", "bench"], ...provider }
    } }
  }), slugify).issues.filter((issue) => issue.includes("execution.providers"));
  assert.deepEqual(issuesFor({}), [], "omitted values take the defaults");
  assert.deepEqual(issuesFor({ runs: 3, maxRegressionPercent: 0 }), []);
  assert.match(issuesFor({ runs: 1 }).join("\n"),
    /execution\.providers\.performance\.runs must be at least 3/);
  assert.match(issuesFor({ runs: 4.5 }).join("\n"), /runs must be at least 3/);
  assert.match(issuesFor({ maxRegressionPercent: -1 }).join("\n"),
    /maxRegressionPercent must be a number of at least 0/);
  assert.match(issuesFor({ maxRegressionPercent: "10" }).join("\n"), /maxRegressionPercent/);
  // Only the benchmark adapter carries these fields.
  assert.deepEqual(normalizeSemanticDraft(semanticDraftV4({
    execution: { version: 1, services: {}, providers: {
      performance: { adapter: "command", command: ["npm", "run", "bench"], runs: 1 }
    } }
  }), slugify).issues.filter((issue) => issue.includes("execution.providers")), []);
});

function startFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "semantic-fixes-start-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const changes = join(root, "openspec", "changes");
  const runtime = join(root, ".foundation", "runtime");
  const writeJson = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  };
  for (const schema of ["foundation-rapid", "foundation-standard"]) {
    const templates = join(root, "openspec", "schemas", schema, "templates");
    mkdirSync(templates, { recursive: true });
    writeFileSync(join(templates, "proposal.md"), "# <title>\n");
    writeFileSync(join(templates, "tasks.md"), "- [ ] **T001** replace-with-task\n");
    writeJson(join(templates, "evidence.yaml"), { version: 2, claims: [{
      id: "replace-with-stable-claim-id", scenario: "replace-with", impact: "low",
      capabilities: ["test"] }] });
    writeJson(join(templates, "execution.yaml"), { version: 1, providers: {}, services: {} });
    writeJson(join(templates, "repositories.yaml"), {
      version: 1, repositories: [{ id: "root", mode: "write", dependsOn: [] }] });
    writeJson(join(templates, "handoffs.yaml"), { version: 1, operations: [] });
    writeFileSync(join(templates, "design.md"), "# Design for <title>\n");
    writeFileSync(join(templates, "spec.md"), "## ADDED Requirements\n");
  }
  mkdirSync(join(changes, "archive", "2026-09-01-fix-rounding"), { recursive: true });
  const draftPath = join(root, "draft.json");
  const lifecycle = createChangeLifecycle({
    root, policy: () => ({ workflow: { grounding: "optional" }, land: {} }), securityTerms: [],
    fail: (message) => { throw new Error(message); }, pathInside: () => true,
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")), writeJson, slugify,
    changePath: (id) => join(changes, id),
    loadRuntime: (id) => JSON.parse(readFileSync(join(runtime, `${id}.json`), "utf8")),
    saveRuntime: (state) => writeJson(join(runtime, `${state.id}.json`), state),
    setOperationChangeId: () => {}, initialBudget: () => ({}), gitHead: () => "head",
    preexistingDirty: () => ({}), now: () => "2026-09-02T00:00:00.000Z",
    bindClaudeSession: () => {}, validate: () => {}, createSandbox: () => {},
    showPacket: () => {}, measureStage: (_stage, operation) => operation(),
    trapFailures: (operation) => operation(),
    rollbackStart: (id) => {
      rmSync(join(changes, id), { recursive: true, force: true });
      rmSync(join(runtime, `${id}.json`), { force: true });
      return [];
    }
  });
  const start = (overrides = {}) => {
    writeJson(draftPath, {
      version: 4, id: "fix-change", intent: "Return the bounded result",
      impact: "low", coupling: "isolated",
      requirements: [{
        key: "bounded-result", capability: "fix-change", operation: "added",
        scenarios: [{ name: "Bounded input", when: "A bounded input arrives",
          then: "The bounded result is returned" }],
        outcome: "The bounded result is returned"
      }],
      tasks: [{ key: "implement-bounded-result", outcome: "Implement the bounded result",
        covers: ["bounded-result"], paths: ["src/**"], verify: "npm test" }],
      evidence: { "bounded-result": { capabilities: ["test"] } },
      ...overrides
    });
    const prior = console.log;
    console.log = () => {};
    try { return lifecycle.startAtomic(draftPath); }
    finally { console.log = prior; }
  };
  const state = () => JSON.parse(readFileSync(join(runtime, "fix-change.json"), "utf8"));
  const proposal = () => readFileSync(join(changes, "fix-change", "proposal.md"), "utf8");
  return { root, changes, start, state, proposal };
}

test("a draft that fixes an archived change records it in state and proposal", (t) => {
  const value = startFixture(t);
  // A declared fix owes the analogous-boundary coverage row.
  value.start({ fixes: ["fix-rounding"], constraints: TWO_CONSTRAINTS, discovery: {
    coverage: [{ dimension: "input-boundary", status: "covered", covers: ["bounded-result"] }],
    decisions: []
  } });
  assert.deepEqual(value.state().fixes, ["fix-rounding"]);
  assert.match(value.proposal(), /^- \*\*Fixes:\*\* fix-rounding$/m);
  assert.match(value.proposal(), /## Constraints\n\n- Keep the existing payment table\n- Respond within 200 ms/);
});

test("fixes naming an unarchived change is an agent draft edit at inspect", (t) => {
  const value = startFixture(t);
  const action = value.start({ fixes: ["zzz"] });
  assert.equal(action.action, "EDIT");
  assert.equal(action.owner, "agent");
  assert.equal(action.boundary, "draft-validation");
  assert.ok(action.intake.issues.includes("semantic draft fixes zzz is not an archived change"));
  assert.equal(existsSync(join(value.changes, "fix-change")), false);
  // An active (unarchived) change of that name is not archived either.
  mkdirSync(join(value.changes, "zzz"), { recursive: true });
  assert.ok(value.start({ fixes: ["zzz"] }).intake.issues
    .includes("semantic draft fixes zzz is not an archived change"));
  assert.match(value.start({ fixes: "fix-rounding" }).intake.issues.join("\n"),
    /fixes must be an array of archived change ids/);
});

test("a benchmark provider below three runs is an agent draft edit at inspect", (t) => {
  const value = startFixture(t);
  const action = value.start({ execution: { version: 1, services: {}, providers: {
    test: { adapter: "benchmark", command: ["npm", "run", "bench"], runs: 1 } } } });
  assert.equal(action.action, "EDIT");
  assert.equal(action.boundary, "draft-validation");
  assert.match(action.intake.issues.join("\n"), /runs must be at least 3/);
});

test("a draft without fixes leaves state and proposal without them", (t) => {
  const value = startFixture(t);
  value.start();
  assert.equal(Object.hasOwn(value.state(), "fixes"), false);
  assert.doesNotMatch(value.proposal(), /Fixes:/);
  assert.doesNotMatch(value.proposal(), /## Constraints/);
});

// T029 draft-versions: v5 is v4 semantics plus folder prose; 3, 4 and 5 are
// the accepted versions and every version check goes through one helper.
test("draft version helpers accept 3, 4 and 5 and treat 5 like 4", () => {
  assert.deepEqual(SEMANTIC_DRAFT_VERSIONS, [3, 4, 5]);
  assert.deepEqual([2, 3, 4, 5, 6, undefined].map(isSemanticVersion),
    [false, true, true, true, false, false]);
  assert.deepEqual([3, 4, 5, 6].map(isSemanticV4Plus), [false, true, true, false]);
});

test("a v5 folder draft normalizes like v4 and records version 5", () => {
  const v4 = normalizeSemanticDraft(semanticDraftV4(), slugify);
  // The shape loadDraftFolder returns: change.json fields plus split prose.
  const v5 = normalizeSemanticDraft(semanticDraftV4({
    version: 5,
    prose: { proposal: { why: "Retries double-charge today." }, design: {} }
  }), slugify);
  assert.deepEqual(v5.issues, v4.issues);
  assert.ok(!v5.issues.some((issue) => /version/.test(issue)));
  assert.equal(v5.draft._semanticVersion, 5);
  assert.deepEqual(v5.draft.discovery, v4.draft.discovery);
  assert.ok(v5.draft.discovery, "v5 keeps v4 discovery normalization");
  assert.deepEqual(v5.draft.claims, v4.draft.claims);
  assert.equal(v5.draft.prose.proposal.why, "Retries double-charge today.");
});

test("v3 and v4 fixtures still normalize without version issues", () => {
  for (const source of [semanticDraft(), semanticDraftV4()]) {
    const result = normalizeSemanticDraft(source, slugify);
    assert.ok(!result.issues.some((issue) => /version/.test(issue)), result.issues.join("\n"));
    assert.equal(result.draft._semanticVersion, source.version);
  }
});

test("an unknown draft version names the accepted versions", () => {
  const result = normalizeSemanticDraft(semanticDraftV4({ version: 6 }), slugify);
  assert.ok(result.issues.includes("semantic draft version must be 3, 4, or 5"),
    result.issues.join("\n"));
});

test("a minimal draft without a version still defaults to v4", () => {
  const expanded = expandMinimalSemanticDraft(minimalDraft());
  assert.equal((expanded.draft || expanded).version, 4);
});

test("no literal semantic-version check remains outside the helper", () => {
  const runtime = new URL("../runtime/", import.meta.url);
  const files = [
    "workflow/semantic-draft.mjs", "workflow/change-lifecycle.mjs",
    ...readdirSync(new URL("workflow/validation/", runtime))
      .filter((name) => name.endsWith(".mjs") && name !== "draft-version.mjs")
      .map((name) => `workflow/validation/${name}`)
  ];
  const literal = /\[3, ?4\]|(?:_semanticVersion|semanticDraftVersion|\b(?:source|draft|input)\??\.version)\s*[!=]==\s*[345]\b/;
  const offenders = files.flatMap((file) =>
    readFileSync(new URL(file, runtime), "utf8").split("\n")
      .map((line, index) => literal.test(line) ? `${file}:${index + 1}: ${line.trim()}` : null)
      .filter(Boolean));
  assert.deepEqual(offenders, []);
});
