import assert from "node:assert/strict";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createChangeLifecycle,
  deriveDraftBookkeeping,
  draftDomainRows,
  groupDraftSpecs,
  materializeDraftSpecs,
  renderDraftDesign,
  renderDraftProposal,
  renderDraftSpecDocument,
  renderDraftTask,
  renderDraftTasks
} from "../runtime/workflow/change-lifecycle.mjs";
import { loadDraftFolder } from "../runtime/workflow/draft-folder.mjs";

test("draft bookkeeping derives mechanical IDs and unambiguous bindings", () => {
  const value = deriveDraftBookkeeping({
    claims: [{ scenario: "Zero window returns nothing" }],
    tasks: [{ outcome: "Implement", paths: ["window.js"], verify: "node --test" }],
    execution: { providers: { test: { adapter: "test-discovery" } } },
    grounding: {
      claims: [{ productionPath: [] }],
      criticalCases: [{ input: "zero", expected: "empty" }]
    }
  }, (text) => text.toLowerCase().replaceAll(" ", "-"));
  assert.equal(value.claims[0].id, "zero-window-returns-nothing");
  assert.equal(value.tasks[0].id, "T001");
  assert.deepEqual(value.tasks[0].claims, ["zero-window-returns-nothing"]);
  assert.equal(value.grounding.claims[0].id, "zero-window-returns-nothing");
  assert.equal(value.grounding.criticalCases[0].id, "CC-001");
  assert.deepEqual(value.grounding.criticalCases[0].claimIds,
    ["zero-window-returns-nothing"]);
  assert.deepEqual(value.execution.providers.test.criticalCases, ["CC-001"]);
  assert.deepEqual(value.execution.providers.test.command,
    ["sh", "-c", "node --test"]);
});

test("draft bookkeeping never guesses ambiguous multi-claim task bindings", () => {
  const value = deriveDraftBookkeeping({
    claims: [{ id: "one" }, { id: "two" }],
    tasks: [{ outcome: "A" }, { outcome: "B" }]
  }, String);
  assert.equal(value.tasks[0].claims, undefined);
  assert.equal(value.tasks[1].claims, undefined);
});

const draft = () => ({
  title: "Draft title", why: "Because", changes: ["One", "Two"],
  impact: "low", coupling: "isolated", surfaces: ["api", "ui"],
  securityTriggers: ["authentication"], nonGoals: ["No migration"],
  currentState: "Current", compatibility: "Compatible",
  domainLanguage: [{ term: "Draft", meaning: "Atomic input", avoid: "Chain" }],
  decisions: [{ choice: "Use JSON", why: "Atomic" }],
  risks: [{ risk: "Bad input", mitigation: "Validate", owner: "runtime" }],
  tasks: [
    {
      outcome: "Implement", verify: "npm test", repository: "api", kind: "code",
      paths: ["src/**"], dependsOn: ["T000"], resources: ["database"],
      claims: ["claim-1"], model: "strong", inputSchema: "request-v1",
      outputSchema: "result-v1"
    },
    { id: "CUSTOM", outcome: "Document", verify: "npm run docs" }
  ],
  claims: [{ id: "claim-1" }],
  execution: { version: 1 }, externalOperations: [{ id: "deploy" }],
  repositories: [{ id: "api" }], grounding: { version: 2 },
  specs: [
    {
      name: "Draft API", operation: "added", requirement: "Create",
      description: "Create it", scenarios: [{ name: "A", when: "x", then: "y" }]
    },
    {
      name: "Draft API", operation: "modified", requirement: "Change",
      description: "Change it", scenarios: [{ name: "B", when: "x", then: "z" }]
    },
    {
      name: "Old API", operation: "removed", requirement: "Remove",
      description: "Remove it", migration: "Move first", scenarios: []
    }
  ]
});

test("draft renderers preserve defaults, metadata and markdown sections", () => {
  const value = draft();
  assert.match(renderDraftProposal(value, { intent: "Fallback" }), /# Change: Draft title/);
  const defaults = { ...value, title: null, impact: null, coupling: null,
    surfaces: null, securityTriggers: null };
  const defaultProposal = renderDraftProposal(defaults, { intent: "Fallback" });
  for (const expected of [
    "# Change: Fallback", "**Impact:** medium", "**Coupling:** coupled",
    "**Affected surfaces:** code", "**Security triggers:** none"
  ]) assert.ok(defaultProposal.includes(expected));
  assert.match(renderDraftDesign(value), /Draft \| Atomic input \| Chain/);
  assert.match(draftDomainRows([]), /introduces no project-specific term/);
  assert.equal(renderDraftTask(value.tasks[0], 0),
    "- [ ] **T001** Implement [repo:api] [kind:code] [model:strong] [paths:src/**] [depends:T000] [resources:database] [claims:claim-1] [input-schema:request-v1] [output-schema:result-v1] — verify: `npm test`");
  assert.match(renderDraftTasks(value.tasks), /\*\*CUSTOM\*\* Document/);
});

test("spec grouping and document rendering order operations", (t) => {
  const value = draft();
  const grouped = groupDraftSpecs(value.specs, (name) => name.toLowerCase().replaceAll(" ", "-"));
  assert.equal(grouped.get("draft-api").length, 2);
  const rendered = renderDraftSpecDocument(grouped.get("draft-api"),
    (spec) => `REQ:${spec.requirement}`);
  assert.ok(rendered.indexOf("ADDED Requirements") < rendered.indexOf("MODIFIED Requirements"));
  const root = mkdtempSync(join(tmpdir(), "draft-spec-render-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  materializeDraftSpecs({
    basePath: root, specs: value.specs,
    slugify: (name) => name.toLowerCase().replaceAll(" ", "-"),
    renderRequirement: (spec) => `REQ:${spec.requirement}`
  });
  assert.match(readFileSync(join(root, "specs", "draft-api", "spec.md"), "utf8"),
    /REQ:Create[\s\S]*REQ:Change/);
  assert.match(readFileSync(join(root, "specs", "old-api", "spec.md"), "utf8"),
    /REMOVED Requirements/);
});

function lifecycleFixture(t, schema) {
  const root = mkdtempSync(join(tmpdir(), "draft-materialize-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = {
    intent: "State intent", impact: "high", coupling: "coupled", schema,
    groundingRequired: schema === "foundation-standard"
  };
  const writeJson = (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  };
  writeJson(join(root, "evidence.yaml"), { version: 1, claims: [] });
  const lifecycle = createChangeLifecycle({
    root, policy: () => ({ workflow: {} }), securityTerms: [],
    fail: (message) => { throw new Error(message); },
    pathInside: () => true,
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")), writeJson,
    slugify: (name) => name.toLowerCase().replaceAll(" ", "-"),
    changePath: () => root, loadRuntime: () => state
  });
  return { root, lifecycle };
}

test("materializeDraft writes rapid artifacts without standard-only files", (t) => {
  const { root, lifecycle } = lifecycleFixture(t, "foundation-rapid");
  lifecycle.materializeDraft("change", draft());
  assert.match(readFileSync(join(root, "proposal.md"), "utf8"), /Draft title/);
  assert.match(readFileSync(join(root, "tasks.md"), "utf8"), /T001/);
  assert.deepEqual(JSON.parse(readFileSync(join(root, "evidence.yaml"), "utf8")).claims,
    [{ id: "claim-1" }]);
  assert.equal(existsSync(join(root, "design.md")), false);
});

test("materializeDraft writes standard design, grounding, repositories and specs", (t) => {
  const { root, lifecycle } = lifecycleFixture(t, "foundation-standard");
  lifecycle.materializeDraft("change", draft());
  assert.match(readFileSync(join(root, "design.md"), "utf8"), /## Decisions/);
  assert.equal(JSON.parse(readFileSync(join(root, "grounding.yaml"), "utf8")).version, 2);
  assert.equal(JSON.parse(readFileSync(join(root, "execution.yaml"), "utf8")).version, 1);
  assert.equal(JSON.parse(readFileSync(join(root, "repositories.yaml"), "utf8")).version, 1);
  assert.match(readFileSync(join(root, "specs", "draft-api", "spec.md"), "utf8"),
    /Scenario: A[\s\S]*Scenario: B/);
});

// --- Completeness guard: every authored item survives compilation ---------
// The fixtures hold one rich draft twice: a v4 JSON file and the equivalent
// v5 folder (typed change.json plus proposal.md/design.md prose). The real
// start path compiles each; every authored item must appear at least once in
// proposal.md, design.md, specs/*/spec.md, or tasks.md.

const COMPLETE_FIXTURES = new URL("./fixtures/complete-packets/", import.meta.url);

const asList = (value) => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

// Labeled authored items: [{ path, value }]. The path names the draft item so
// a failure says which one a renderer dropped.
function authoredItems(source) {
  const items = [];
  const add = (path, value) => {
    if (value === undefined || value === null) return;
    const textValue = String(value).trim();
    if (textValue) items.push({ path, value: textValue });
  };
  const each = (path, value, visit) => asList(value).forEach((row, index) => visit(row ?? {}, `${path}[${index}]`));
  const fields = (row, path, names) => names.forEach((name) => add(`${path}.${name}`, row[name]));
  const strings = (path, value) => each(path, value, (row, at) => add(at, row));

  add("intent", source.intent);
  add("why", source.why);
  add("currentState", source.currentState);
  add("compatibility", source.compatibility);
  add("successMeasure", source.successMeasure);
  strings("successCriteria", source.successCriteria);
  strings("nonGoals", source.nonGoals);
  strings("constraints", source.constraints);
  strings("demo", source.demo);
  each("requirements", source.requirements, (row, at) => {
    fields(row, at, ["requirement", "description", "outcome", "migration"]);
    each(`${at}.scenarios`, row.scenarios, (scenario, path) => {
      fields(scenario, path, ["name", "when", "then", "recovery"]);
      strings(`${path}.given`, scenario.given);
      strings(`${path}.and`, scenario.and);
    });
  });
  each("tasks", source.tasks, (row, at) => fields(row, at, ["outcome", "verify"]));
  each("decisions", source.decisions, (row, at) => fields(row, at, ["choice", "reason", "why", "consequences"]));
  each("risks", source.risks, (row, at) => fields(row, at, ["risk", "mitigation"]));
  each("userStories", source.userStories, (row, at) => fields(row, at, ["asA", "iWant", "soThat"]));
  each("decisionLog", source.decisionLog, (row, at) => {
    fields(row, at, ["date", "question", "answer", "by"]);
    strings(`${at}.options`, row.options);
  });
  const communication = Array.isArray(source.communication)
    ? { rows: source.communication } : source.communication || {};
  each("communication.rows", communication.rows, (row, at) => fields(row, at, ["audience", "channel", "when"]));
  fields(communication, "communication", ["owner", "supportRunbook"]);
  if (typeof source.releaseNote === "string") add("releaseNote", source.releaseNote);
  else for (const [category, entries] of Object.entries(source.releaseNote || {}))
    strings(`releaseNote.${category}`, entries);
  if (source.userFlow) add("userFlow.purpose", source.userFlow.purpose);
  each("boundaries", source.boundaries, (row, at) => fields(row, at, ["from", "to", "why", "timeout", "owner"]));
  each("componentMap", source.componentMap, (row, at) => fields(row, at, ["component", "responsibility"]));
  each("apiContracts", source.apiContracts, (row, at) => {
    fields(row, at, ["method", "path", "auth", "rateLimit"]);
    if (row.idempotency && typeof row.idempotency === "object")
      fields(row.idempotency, `${at}.idempotency`, ["header", "retention"]);
    each(`${at}.errors`, row.errors, (error, path) => fields(error, path, ["status", "code", "when"]));
    if (row.errorEnvelope) add(`${at}.errorEnvelope.requestId`, row.errorEnvelope.requestId);
  });
  if (source.ui) {
    add("ui.surface", source.ui.surface);
    each("ui.states", source.ui.states, (row, at) => fields(row, at, ["key", "shows", "next"]));
    add("ui.accessibility.standard", source.ui.accessibility?.standard);
    each("ui.accessibility.rows", source.ui.accessibility?.rows,
      (row, at) => fields(row, at, ["criterion", "how", "check"]));
  }
  each("dataModel", source.dataModel, (row, at) => {
    fields(row, at, ["entity", "migration", "rollback"]);
    strings(`${at}.fields`, row.fields);
  });
  if (source.rollout) {
    fields(source.rollout, "rollout", ["strategy", "rollback", "rollbackProof"]);
    strings("rollout.deployOrder", source.rollout.deployOrder);
  }
  each("nfr", source.nfr, (row, at) => fields(row, at, ["key", "stimulus", "response", "measure"]));
  if (source.threatModel) {
    strings("threatModel.assets", source.threatModel.assets);
    strings("threatModel.trustBoundaries", source.threatModel.trustBoundaries);
    each("threatModel.threats", source.threatModel.threats,
      (row, at) => fields(row, at, ["key", "threat", "control"]));
  }
  if (source.observability) {
    add("observability.correlation", source.observability.correlation);
    each("observability.rows", source.observability.rows,
      (row, at) => fields(row, at, ["failure", "signal", "sli", "slo", "alert", "runbook", "owner"]));
  }
  return items;
}

// Every non-empty, non-heading line of v5 prose is an authored item.
function proseItems(prose = {}) {
  return Object.entries(prose).flatMap(([document, sections]) =>
    Object.entries(sections || {}).flatMap(([key, body]) =>
      String(body).split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line, index) => ({ path: `prose.${document}.${key}[${index}]`, value: line }))));
}

// Returns the authored items absent from every packet document.
function missingAuthoredItems(items, documents) {
  const packet = documents.join("\n");
  return items.filter(({ value }) => !packet.includes(value));
}

function assertPacketComplete(items, documents) {
  const missing = missingAuthoredItems(items, documents);
  assert.deepEqual(missing, [], `compiled packet dropped authored items:\n${
    missing.map(({ path, value }) => `  - ${path}: ${value}`).join("\n")}`);
}

const MODIFIED_BASE_SPEC = [
  "# refund-api", "", "## Purpose", "", "Refunds.", "", "## Requirements", "",
  "### Requirement: Refund status is shown", "", "The system SHALL show refund status.", "",
  "#### Scenario: Earlier status", "", "- **WHEN** a refund exists", "- **THEN** its status shows", "",
  "### Requirement: Manual refund form", "", "The system SHALL offer a manual form.", "",
  "#### Scenario: Manual form", "", "- **WHEN** support opens the form", "- **THEN** it shows", ""
].join("\n");

// A temp project with the schema templates and lifecycle wiring of
// draft-folder.test.mjs, plus a canonical spec so modified and removed
// requirements compile.
function completeProject(t) {
  const root = mkdtempSync(join(tmpdir(), "draft-complete-packet-"));
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
    writeJson(join(templates, "evidence.yaml"), { version: 2, claims: [] });
    writeJson(join(templates, "execution.yaml"), { version: 1, providers: {}, services: {} });
    writeJson(join(templates, "repositories.yaml"), {
      version: 1, repositories: [{ id: "root", mode: "write", dependsOn: [] }]
    });
    writeJson(join(templates, "handoffs.yaml"), { version: 1, operations: [] });
    writeFileSync(join(templates, "design.md"), "# Design for <title>\n");
    writeFileSync(join(templates, "spec.md"), "## ADDED Requirements\n");
  }
  mkdirSync(join(root, "openspec", "specs", "refund-api"), { recursive: true });
  writeFileSync(join(root, "openspec", "specs", "refund-api", "spec.md"), MODIFIED_BASE_SPEC);
  const lifecycle = createChangeLifecycle({
    root,
    policy: () => ({ workflow: { grounding: "optional" }, land: {} }),
    securityTerms: [],
    fail: (message) => { throw new Error(message); },
    pathInside: () => true,
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    writeJson,
    slugify: (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    changePath: (id) => join(changes, id),
    loadRuntime: (id) => JSON.parse(readFileSync(join(runtime, `${id}.json`), "utf8")),
    saveRuntime: (state) => writeJson(join(runtime, `${state.id}.json`), state),
    setOperationChangeId: () => {}, initialBudget: () => ({}), gitHead: () => "head",
    preexistingDirty: () => ({}), now: () => "2026-10-15T00:00:00.000Z",
    bindClaudeSession: () => {}, validate: () => {}, createSandbox: () => {}, showPacket: () => {},
    measureStage: (_stage, operation) => operation(), trapFailures: (operation) => operation(),
    rollbackStart: (id) => {
      rmSync(join(changes, id), { recursive: true, force: true });
      rmSync(join(runtime, `${id}.json`), { force: true });
      return [];
    }
  });
  return { root, changes, lifecycle };
}

// Compiles a fixture through the real start path and returns its documents.
function compileFixture(t, fixture) {
  const { root, changes, lifecycle } = completeProject(t);
  const relative = `.foundation/drafts/${fixture}`;
  cpSync(new URL(fixture, COMPLETE_FIXTURES), join(root, relative), { recursive: true });
  const inspected = lifecycle.inspectDraft(relative);
  assert.equal(inspected.action, "DONE", JSON.stringify(inspected.intake?.issues ?? inspected));
  lifecycle.startAtomic(relative);
  const [id] = readdirSync(changes);
  const packet = join(changes, id);
  const read = (...parts) => readFileSync(join(packet, ...parts), "utf8");
  return {
    proposal: read("proposal.md"),
    design: read("design.md"),
    tasks: read("tasks.md"),
    specs: readdirSync(join(packet, "specs")).map((name) => read("specs", name, "spec.md"))
  };
}

const packetDocuments = (packet) => [packet.proposal, packet.design, packet.tasks, ...packet.specs];

function v4Fixture() {
  return JSON.parse(readFileSync(new URL("v4-draft.json", COMPLETE_FIXTURES), "utf8"));
}

function v5Items() {
  const dir = fileURLToPath(new URL("v5-folder/", COMPLETE_FIXTURES));
  const { draft, issues } = loadDraftFolder(dir);
  assert.deepEqual(issues, []);
  const items = [...authoredItems(draft), ...proseItems(draft.prose)];
  assert.ok(items.some(({ path }) => path.startsWith("prose.design")), "v5 fixture carries design prose");
  return items;
}

test("completeness: every authored item of the v4 draft appears in the compiled packet", (t) => {
  const items = authoredItems(v4Fixture());
  assert.ok(items.length > 100, `fixture covers many items (${items.length})`);
  for (const prefix of ["requirements", "decisions", "constraints", "nonGoals", "userStories",
    "decisionLog", "releaseNote", "demo", "apiContracts", "ui", "dataModel", "rollout", "nfr",
    "threatModel", "observability"])
    assert.ok(items.some(({ path }) => path.startsWith(prefix)), `fixture authors ${prefix}`);
  const packet = compileFixture(t, "v4-draft.json");
  assert.ok(packet.specs.join("\n").includes("## MODIFIED Requirements"));
  assert.ok(packet.specs.join("\n").includes("## REMOVED Requirements"));
  assertPacketComplete(items, packetDocuments(packet));
});

test("completeness: every authored item and prose line of the v5 folder appears in the compiled packet", (t) => {
  const items = v5Items();
  const packet = compileFixture(t, "v5-folder");
  assertPacketComplete(items, packetDocuments(packet));
});

test("completeness: a renderer that drops the non-goals fails naming the dropped item", (t) => {
  const items = authoredItems(v4Fixture());
  const packet = compileFixture(t, "v4-draft.json");
  // A broken proposal renderer: same output without the Non-goals section.
  const broken = packet.proposal.replace(/\n## Non-goals\n[\s\S]*?(?=\n## )/, "\n");
  assert.notEqual(broken, packet.proposal, "the fixture renders a Non-goals section");
  const missing = missingAuthoredItems(items, packetDocuments({ ...packet, proposal: broken }));
  assert.deepEqual(missing.map(({ path }) => path), ["nonGoals[0]", "nonGoals[1]"]);
  assert.throws(() => assertPacketComplete(items, packetDocuments({ ...packet, proposal: broken })),
    (error) => {
      assert.match(error.message, /dropped authored items/);
      assert.match(error.message, /nonGoals\[0\]: ไม่รองรับคืนเงินบางส่วน/);
      return true;
    });
});
