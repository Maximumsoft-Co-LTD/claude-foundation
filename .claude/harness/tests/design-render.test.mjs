import assert from "node:assert/strict";
import test from "node:test";
import { proposalOpenQuestions, renderDraftDesign } from "../runtime/workflow/change-lifecycle.mjs";
import { normalizeSemanticDraft } from "../runtime/workflow/semantic-draft.mjs";
import { designBlueprintIssues } from "../runtime/workflow/validation/design-blueprints.mjs";
import { packetWorkTypes } from "../runtime/workflow/validation/dev-document.mjs";
import { outlineSections, sectionHeading } from "../runtime/workflow/validation/outline-contract.mjs";
import { durableDecisionMetadataIssues } from "../runtime/workflow/change-validation.mjs";

const slugify = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// One marker per typed field: each must appear exactly once in design.md.
const FIELDS = {
  boundaries: [{ from: "web", to: "orders-api", mode: "sync", why: "MK-boundaries", timeout: "800ms",
    retry: "none", consistency: "strong", owner: "orders", correlation: "x-request-id" }],
  tenancy: { key: "tenant_id", source: "JWT claim", layers: ["data: row-level security"],
    noisyNeighbor: "100 rps", metering: "per tenant", crossTenantTest: "MK-tenancy" },
  domain: { types: [{ name: "Money", rule: "MK-domain" }], illegalStates: ["negative total"] },
  apiContracts: [{ method: "POST", path: "/orders", auth: "session", request: "cart",
    response: "MK-apiContracts", errors: [{ status: 409, when: "duplicate" }],
    idempotency: { header: "Idempotency-Key", scope: "user", retention: "24h", replay: "same body",
      inFlight: "409" } }],
  eventContracts: [{ name: "order.placed", version: 2, channel: "orders", action: "send",
    payload: { orderId: "uuid" }, delivery: "at-least-once", dedupKey: "eventId", orderingKey: "orderId",
    correlation: "x-request-id", retry: "MK-eventContracts", compatibility: "backward", consumers: ["billing"] }],
  dataModel: { store: "postgres", owner: "orders team", entities: [{ name: "Order",
    columns: [{ name: "id", type: "uuid", nullable: false, change: "existing" }],
    invariants: ["MK-dataModel"] }] },
  ui: { surface: "Checkout", entryInfo: ["cart total"], states: [{ key: "loading", shows: "MK-ui", next: "wait" }] },
  configContract: [{ key: "CARD_LIMIT", default: "100", validation: "MK-configContract", type: "int",
    secret: false, reload: "restart", owner: "ops" }],
  integrations: [{ key: "stripe", kind: "payment", documentation: { source: "https://stripe.com/docs",
    version: "2024-06-20" }, concerns: ["MK-integrations"] }],
  libraryContract: { package: "@acme/parser", semver: "minor", runtimes: ["node 22"],
    symbols: [{ name: "parse", signature: "MK-libraryContract", errors: "ParseError", change: "added" }] },
  migrationPlan: { from: "v1 jobs", to: "queue", seam: "JobPort", dualRun: "7 days",
    parity: { check: "same results", tolerance: "0" }, cutover: "MK-migrationPlan", rollbackWindow: "14 days",
    decommissionTask: "T009" },
  performanceAnalysis: { baseline: { value: "p95 480ms", method: "k6" }, profile: "flamegraph",
    hypothesis: "MK-performanceAnalysis", target: "p95 < 200ms",
    benchmark: { runs: 5, variance: "3%", environment: "staging" }, tradeoffs: "+20MB", regressionBudget: "+5%" },
  dependencyChange: { package: "express", from: "4.19.2", to: "4.21.0", breakingChanges: "MK-dependencyChange",
    cve: "none", license: "MIT", transitive: "none", lockfile: "3 lines", rollbackPin: "4.19.2",
    provenance: "attested", sbom: "updated" },
  deprecationPlan: { what: "GET /v1/items", replacement: "GET /v2/items", consumers: ["mobile"],
    announce: "2026-11-01", warning: "Deprecation header", usageMetric: "v1 calls",
    removalCondition: "MK-deprecationPlan" },
  infraPlan: { iac: "terraform", planDiff: "MK-infraPlan", environments: ["staging", "prod"], capacity: "1k/s",
    costDelta: "+$4", blastRadius: "jobs only", secrets: "none", provisioningOrder: ["queue"], drift: "nightly" },
  privacyAssessment: { personalData: [{ data: "email", class: "personal" }], purpose: "MK-privacyAssessment",
    lawfulBasis: "contract", minimization: "no name", retention: "30 days", deletion: "job",
    subjectRequests: "export", crossBorder: "none", telemetryPii: "hashed" },
  experimentDesign: { hypothesis: "MK-experimentDesign", primaryMetric: "conversion", guardrails: ["refunds"],
    unit: "user", allocation: "50/50", sampleOrDuration: "14 days", stopRules: ["errors"],
    exposureEvent: "viewed", decisionRule: "ship if +1%", cleanupTask: "T012" },
  releasePlan: { minimumVersion: "5.2", coexistence: "MK-releasePlan", serverWindow: "90 days",
    storeReview: "3 days", stages: ["1%", "100%"], forcedUpgrade: "below 4.0", gate: "crash-free 99.5%" },
  modelCard: { intendedUse: "MK-modelCard", outOfScope: "legal", model: { provider: "x", version: "2026-01-01" },
    data: "tickets", evaluation: { set: "evals.jsonl", thresholds: ["quality >= 0.85"] },
    limitations: ["long threads"], oversight: "review", costLatency: "$0.002", monitoring: "weekly",
    fallback: "raw ticket" },
  bugfix: { reproduction: "MK-bugfix", rootCause: "missing index", regression: "orders.test.js" },
  refactor: { invariants: ["MK-refactor"], characterization: "npm test" },
  nfr: [{ key: "NFR-1", characteristic: "Performance efficiency", source: "member", stimulus: "100 rps",
    environment: "normal", response: "results", measure: "MK-nfr", claim: "claim-a" }],
  threatModel: { assets: ["session token"], trustBoundaries: ["browser → API"], threats: [
    { key: "THR-1", stride: "spoofing", threat: "MK-threatModel", likelihood: "medium", impact: "high",
      control: "short tokens", residual: "low" }] },
  observability: { correlation: "request_id", rows: [{ failure: "MK-observability", signal: "log", sli: "success",
    slo: "99.5%", alert: "burn", runbook: "switch", owner: "payments" }] },
  trackingPlan: [{ measure: "MK-trackingPlan", event: "search_submitted", properties: ["tenant_id"], owner: "growth" }],
  rollout: { strategy: "MK-rollout", rollback: "disable flag", rollbackProof: "staging drill" },
  capacity: { load: "100 rps", exhaustsAt: "MK-capacity", cost: "$40/mo" },
  recovery: { backup: "MK-recovery", rpo: "1h", rto: "4h", restoreTest: "quarterly" },
  testStrategy: { levels: [{ level: "unit", proves: "MK-testStrategy", why: "pure" }] },
  dependencies: [{ name: "payments", type: "team", need: "MK-dependencies", before: "T003" }]
};

function fullDraft(overrides = {}) {
  return {
    workType: ["feature", "api", "library", "migration", "performance", "dependency", "deprecation", "infra",
      "privacy", "experiment", "client-release", "ml", "bugfix", "refactor"],
    overview: "MK-overview",
    currentState: "MK-currentState",
    domainLanguage: [{ term: "Order", meaning: "MK-glossary", avoid: "Purchase" }],
    assumptions: ["MK-assumptions"],
    openQuestions: [{ question: "MK-openQuestion", owner: "user" }],
    diagram: { purpose: "MK-diagram", source: "graph LR\n  A --> B" },
    userFlow: { purpose: "MK-userFlow", source: "flowchart LR\n  A --> B" },
    diagrams: [{ key: "seq", title: "Retry", type: "mermaid", purpose: "MK-runtimeDiagram",
      source: "sequenceDiagram\n  A->>B: x" }],
    componentMap: [{ component: "Checkout", responsibility: "MK-componentMap", files: ["src/checkout.ts"] }],
    jobContract: [{ key: "MK-jobContract", states: ["queued", "done"], retry: "3x", timeout: "30s",
      idempotency: "job id" }],
    uiStates: [{ screen: "MK-screenStates", states: ["loading", "error"], accessibility: "focus trap" }],
    decisions: [{ id: "DEC-001", key: "store", choice: "MK-decision", why: "fits", consequences: "none" }],
    failureMatrix: [{ failure: "MK-failureMatrix", userSees: "banner", recovery: "retry" }],
    compatibility: "MK-compatibility",
    risks: [{ risk: "MK-risk", mitigation: "test", owner: "agent" }],
    testMap: [{ scenario: "MK-testMap", level: "unit", file: "test/a.test.js", task: "T001" }],
    prototypeSelection: { selected: "MK-prototype", reference: "proto/a", reason: "fits" },
    tasks: [{ id: "T001", outcome: "Build checkout", paths: ["src/checkout.ts"], verify: "npm test" }],
    ...FIELDS,
    ...overrides
  };
}

const headingsOf = (markdown) => [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
const count = (haystack, needle) => haystack.split(needle).length - 1;

test("a full draft's design headings follow the outline order, each once", () => {
  const draft = fullDraft();
  const design = renderDraftDesign(draft);
  const expected = outlineSections("design", draft, { workTypes: draft.workType, language: "en" })
    .map((row) => sectionHeading(row, "en"));
  assert.deepEqual(headingsOf(design), expected);
  for (const heading of expected) assert.equal(count(design, `\n## ${heading}\n`), 1, heading);
});

test("every typed field renders under its own heading exactly once", () => {
  const draft = fullDraft();
  const design = renderDraftDesign(draft);
  const sectionOf = (marker) => {
    const at = design.indexOf(marker);
    return at < 0 ? null : design.slice(0, at).match(/^## (.+)$/gm).pop().slice(3);
  };
  const homes = {
    boundaries: "Architecture", diagram: "Architecture", tenancy: "Tenancy", domain: "Domain model and modules",
    componentMap: "Domain model and modules", apiContracts: "API contract", eventContracts: "Event and job contract",
    jobContract: "Event and job contract", dataModel: "Data model and migration", ui: "UI contract",
    screenStates: "UI contract", configContract: "Config contract", integrations: "Integration contract",
    libraryContract: "Public interface contract", migrationPlan: "Migration plan",
    performanceAnalysis: "Performance analysis", dependencyChange: "Dependency change",
    deprecationPlan: "Deprecation plan", infraPlan: "Infrastructure plan",
    privacyAssessment: "Privacy assessment", experimentDesign: "Experiment design",
    releasePlan: "Client release plan", modelCard: "Model card and evaluation plan",
    bugfix: "Bugfix analysis", refactor: "Refactor invariants", decision: "Decisions",
    nfr: "Quality attributes", threatModel: "Threat model", failureMatrix: "Failure matrix",
    observability: "Observability and usage", trackingPlan: "Observability and usage",
    compatibility: "Compatibility and rollout", rollout: "Compatibility and rollout",
    capacity: "Capacity and cost", recovery: "Backup and recovery", testStrategy: "Test strategy",
    dependencies: "Dependencies", risk: "Risks", testMap: "Test map", prototype: "Selected prototype",
    overview: "Overview", currentState: "Current state", glossary: "Domain language",
    assumptions: "Assumptions", userFlow: "User flow", runtimeDiagram: "Runtime behavior"
  };
  for (const [field, heading] of Object.entries(homes)) {
    const marker = `MK-${field}`;
    assert.equal(count(design, marker), 1, `${field} renders once`);
    assert.equal(sectionOf(marker), heading, `${field} renders under ${heading}`);
  }
  assert.doesNotMatch(design, /\[object Object\]/);
  // Open questions live only in the proposal; assumptions stay in design.
  assert.doesNotMatch(design, /MK-openQuestion|Open questions/);
  // Parser markers survive: work type line, Decision ID blocks.
  assert.deepEqual(packetWorkTypes({ design }), fullDraft().workType);
  assert.match(design, /^- \*\*Decision ID:\*\* DEC-001$/m);
  assert.deepEqual(durableDecisionMetadataIssues(design), []);
});

test("Thai design headings come from the outline; parser markers stay English", () => {
  const draft = fullDraft({ language: "th" });
  const design = renderDraftDesign(draft);
  const markers = new Set(["workType", "decisions", "bugfix", "refactor"]);
  const expected = outlineSections("design", draft, { workTypes: draft.workType, language: "th" })
    .map((row) => markers.has(row.key) ? row.heading.en : sectionHeading(row, "th"));
  assert.deepEqual(headingsOf(design), expected);
  assert.match(design, /^## ภาพรวม$/m);
  assert.match(design, /^## สัญญา API$/m);
  assert.match(design, /^## Work type$/m);
  assert.match(design, /^## Decisions$/m);
});

const semanticBase = (overrides = {}) => ({
  version: 3, intent: "Keep payment retries safe", impact: "medium", coupling: "coupled",
  requirements: [{ key: "payment-retry", capability: "payment-control", operation: "added",
    scenarios: [{ key: "success", kind: "success", name: "Retry succeeds", when: "a retry succeeds",
      then: "one payment is recorded" }], outcome: "record at most one payment" }],
  tasks: [{ key: "implement-retry", outcome: "Implement bounded retry handling", covers: ["payment-retry"],
    paths: ["src/payment/**"], verify: "npm test -- payment-retry" }],
  evidence: { "payment-retry": { capabilities: ["test"] } },
  ...overrides
});

test("a high-impact rollout without rollbackProof is a start-level issue", () => {
  const rollout = { strategy: "canary", rollback: "disable flag" };
  const { issues } = normalizeSemanticDraft(semanticBase({ impact: "high", rollout }), slugify);
  assert.ok(issues.includes("rollout.rollbackProof is required for a high-impact change"), issues.join("\n"));
  const medium = normalizeSemanticDraft(semanticBase({ rollout }), slugify).issues;
  assert.ok(!medium.some((issue) => issue.startsWith("rollout.")), medium.join("\n"));
});

test("field module issues are reported once and the dataModel object form is accepted", () => {
  assert.deepEqual(designBlueprintIssues({ apiContracts: {} }), ["semantic draft apiContracts must be an array"]);
  assert.deepEqual(designBlueprintIssues({ dataModel: FIELDS.dataModel }), []);
  assert.deepEqual(designBlueprintIssues({ boundaries: [{ from: "a" }] }).filter((issue) =>
    issue.startsWith("boundaries[0]")).length > 0, true);
  const all = designBlueprintIssues(fullDraft({ bugfix: { ...FIELDS.bugfix, variant: "nope" } }));
  assert.ok(all.some((issue) => issue.startsWith("bugfix.variant")), all.join("\n"));
  assert.equal(new Set(all).size, all.length);
});

test("new typed fields survive normalizeSemanticDraft", () => {
  const extras = {
    ...FIELDS,
    decisionLog: [{ question: "q", choice: "c", by: "user" }],
    communication: { audience: "support" },
    releaseNote: { added: ["x"] },
    demo: ["Open the page"],
    compliance: { requester: "a", approver: "b", approvedBefore: "build" }
  };
  const { draft } = normalizeSemanticDraft(semanticBase(extras), slugify);
  for (const [key, value] of Object.entries(extras)) assert.deepEqual(draft[key], value, key);
});

test("a derived file map refers to a task by id and never copies its outcome", () => {
  const paths = Array.from({ length: 9 }, (_, index) => `src/part${index + 1}.ts`);
  const design = renderDraftDesign({ tasks: [{ id: "T001", outcome: "Split the parser into parts", paths,
    verify: "npm test" }] });
  const fileMap = design.split("## File map")[1].split("\n## ")[0];
  // The outcome's single home is tasks.md: design.md must not repeat it anywhere.
  assert.equal(count(design, "Split the parser into parts"), 0, design);
  assert.match(fileMap, /T001/);
  for (const path of paths) assert.ok(fileMap.includes(`\`${path}\``), path);
});

test("an authored file map renders as given", () => {
  const fileMap = [
    { path: "src/a.ts", change: "modify", responsibility: "Shared parser", tasks: ["T001"] },
    { path: "src/b.ts", change: "add", responsibility: "Shared parser", tasks: ["T001"] }
  ];
  const design = renderDraftDesign({ fileMap,
    tasks: [{ id: "T001", outcome: "Parse", paths: ["src/**"], verify: "npm test" }] });
  assert.match(design, /^\| src\/a\.ts \| modify \| Shared parser \| T001 \|$/m);
  assert.match(design, /^\| src\/b\.ts \| add \| Shared parser \| T001 \|$/m);
});

test("open questions are read back from the proposal for approval", () => {
  const proposal = "# Change: x\n\n## Decisions to ratify and open questions\n\n" +
    "- **store:** postgres — fits\n- Keep deleted cards? (owner: user)\n\n## Acceptance traceability\n\n- y\n";
  assert.deepEqual(proposalOpenQuestions(proposal), ["Keep deleted cards? (owner: user)"]);
  assert.deepEqual(proposalOpenQuestions("# Change: x\n\n## Summary\n\n- a\n"), []);
});
