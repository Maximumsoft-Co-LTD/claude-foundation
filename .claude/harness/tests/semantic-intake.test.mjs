import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createChangeLifecycle, documentSectionInvalidation, sectionsOnlyAmendment, v5QualityGrounding
} from "../runtime/workflow/change-lifecycle.mjs";
import { durableDecisionMetadataIssues } from "../runtime/workflow/change-validation.mjs";
import { groundingFromQuality } from "../runtime/workflow/validation/quality-fields.mjs";
import {
  CORE_DISCOVERY_DIMENSIONS,
  decisionFrontier,
  normalizeDiscovery,
  requiredDiscoveryDimensions,
  semanticIntakeAction,
  semanticIntakeIssues
} from "../runtime/workflow/validation/semantic-intake.mjs";
import { intakeDecisions } from "../runtime/workflow/validation/reader-guide.mjs";
import { classifyReviewRisk } from "../runtime/evidence/review-routing.mjs";
import { planSemanticIntakeDepth } from
  "../runtime/workflow/validation/semantic-intake-intelligence.mjs";

function source(overrides = {}) {
  return {
    version: 4,
    intent: "Add bounded contact search",
    impact: "low",
    requirements: [{ key: "search", capability: "contacts", operation: "added" }],
    discovery: {
      coverage: CORE_DISCOVERY_DIMENSIONS.map((dimension) => ({
        dimension,
        status: "covered",
        covers: ["search"]
      })),
      decisions: []
    },
    ...overrides
  };
}

test("semantic intake requires every core dimension at high impact and rejects unresolved coverage", () => {
  const value = source({ impact: "high" });
  value.discovery.coverage = value.discovery.coverage
    .filter((row) => row.dimension !== "compatibility");
  value.discovery.coverage.find((row) => row.dimension === "failure-path").status =
    "needs-investigation";
  const message = semanticIntakeIssues(value).join("\n");
  assert.match(message, /missing required dimension 'compatibility'/);
  assert.match(message, /remains unresolved with status 'needs-investigation'/);
});

test("semantic intake validates coverage mappings and sourced N/A rationale", () => {
  const value = source();
  const current = value.discovery.coverage
    .find((row) => row.dimension === "current-behavior");
  current.covers = ["missing"];
  const boundary = value.discovery.coverage
    .find((row) => row.dimension === "input-boundary");
  boundary.status = "not-applicable";
  delete boundary.covers;
  const message = semanticIntakeIssues(value).join("\n");
  assert.match(message, /unknown requirement\(s\): missing/);
  assert.match(message, /not-applicable status requires rationale/);
});

test("semantic intake rejects unknown dimensions and accepts a rationale for risk N/A", () => {
  const value = source({ securityTriggers: ["authorization"] });
  value.discovery.coverage.push(
    { dimension: "security-privacy", status: "not-applicable", rationale: "No trust boundary changes" },
    { dimension: "permission-rejection", status: "covered", covers: ["search"] },
    { dimension: "made-up", status: "covered", covers: ["search"] }
  );
  const message = semanticIntakeIssues(value).join("\n");
  assert.doesNotMatch(message, /security-privacy|grounded source/);
  assert.match(message, /dimension 'made-up' is unknown/);
});

test("prose keywords and modified requirements add no discovery dimensions", () => {
  const required = requiredDiscoveryDimensions(source({
    intent: "Show the author name and uid on the schema page",
    requirements: [{
      key: "search", capability: "contacts", operation: "modified",
      description: "The UI SHALL persist the database author and uid"
    }]
  }));
  assert.deepEqual(required, []);
});

// A paid regression fix that declared no input risk covered only the reported
// 1000-point boundary and missed the analogous 5000 one.
test("a declared regression fix requires input-boundary coverage without raising review", () => {
  const draft = {
    version: 5, intent: "Give the 5% loyalty discount at exactly 1000 points",
    fixes: ["add-loyalty-discount"],
    requirements: [{ key: "boundary", capability: "pricing", operation: "modified" }]
  };
  assert.ok(requiredDiscoveryDimensions(draft).includes("input-boundary"));
  assert.match(semanticIntakeIssues(draft).join("\n"), /missing required dimension 'input-boundary'/);
  assert.deepEqual(requiredDiscoveryDimensions({ ...draft, fixes: undefined }), []);
  const route = classifyReviewRisk({ state: { impact: "low", fixes: draft.fixes, securityTriggers: [] },
    claims: [], capabilities: new Set(), grounding: null });
  assert.equal(route.tier, "low");
  assert.deepEqual(route.triggers, []);
});

test("an ordinary draft without discovery reaches DONE; high impact still needs coverage", () => {
  const minimal = source();
  delete minimal.discovery;
  assert.deepEqual(semanticIntakeIssues(minimal), []);
  assert.equal(semanticIntakeAction(minimal).action, "DONE");
  const high = source({ impact: "high" });
  delete high.discovery;
  const action = semanticIntakeAction(high);
  assert.equal(action.action, "EDIT");
  assert.match(action.intake.issues.join("\n"), /missing required dimension 'current-behavior'/);
});

test("risk signals add dimensions without allowing the agent to downgrade them", () => {
  const required = requiredDiscoveryDimensions(source({
    impact: "high",
    securityTriggers: ["authorization"],
    integrations: [{ key: "billing" }],
    externalOperations: [{ key: "deploy" }]
  }));
  for (const dimension of [
    "security-privacy", "permission-rejection", "integration-contract",
    "timeout-retry-idempotency", "operability", "recoverability", "external-authority"
  ]) assert.ok(required.includes(dimension), dimension);
});

test("typed risk signals derive dimensions without depending on requirement language", () => {
  const required = requiredDiscoveryDimensions(source({
    intent: "ปรับหน้าจอและเปลี่ยนข้อมูลที่บันทึกไว้",
    riskSignals: ["user-interface", "persisted-data-change", "performance-slo"]
  }));
  for (const dimension of [
    "accessibility", "data-migration", "rollout-rollback", "recoverability",
    "performance-capacity-availability"
  ]) assert.ok(required.includes(dimension), dimension);
  assert.ok(requiredDiscoveryDimensions(source({ riskSignals: ["input-domain"] }))
    .includes("input-boundary"), "input-domain requires input-boundary coverage");
  const invalid = source({ riskSignals: ["invented-risk"] });
  assert.match(semanticIntakeIssues(invalid).join("\n"), /unknown signal\(s\): invented-risk/);
});

test("decision frontier exposes only decisions whose prerequisites are resolved", () => {
  const decisions = [
    { key: "scope", status: "open", prerequisites: [] },
    { key: "retention", status: "open", prerequisites: ["scope"] },
    { key: "storage", status: "resolved", prerequisites: [], choice: "disk", reason: "durable" },
    { key: "format", status: "open", prerequisites: ["storage"] }
  ];
  assert.deepEqual(decisionFrontier(decisions).map((row) => row.key), ["scope", "format"]);
  assert.deepEqual(decisionFrontier([
    ...decisions,
    { key: "audit", status: "open", prerequisites: [] },
    { key: "export", status: "open", prerequisites: [] }
  ], 3).map((row) => row.key), ["scope", "format", "audit"]);
});

test("semantic intake rejects decision cycles and reports the ready frontier", () => {
  const value = source();
  value.discovery.decisions = [
    {
      key: "scope", status: "open", prerequisites: [], question: "Which scope?",
      alternatives: ["one", "all"], recommended: "one"
    },
    {
      key: "a", status: "open", prerequisites: ["b"], question: "A?",
      alternatives: ["yes", "no"], recommended: "no"
    },
    {
      key: "b", status: "open", prerequisites: ["a"], question: "B?",
      alternatives: ["yes", "no"], recommended: "no"
    }
  ];
  const message = semanticIntakeIssues(value).join("\n");
  assert.match(message, /prerequisites contain a cycle/);
  assert.match(message, /ready frontier: scope/);
});

test("semantic intake requires unresolved coverage to link its decisions", () => {
  const value = source();
  value.discovery.coverage.find((row) => row.dimension === "affected-actor").status =
    "needs-user-decision";
  const message = semanticIntakeIssues(value).join("\n");
  assert.match(message, /decisionKeys must link needs-user-decision coverage/);
});

test("semantic intake action investigates repository facts before asking the user", () => {
  const value = source();
  value.discovery.coverage.find((row) => row.dimension === "current-behavior").status =
    "needs-investigation";
  const affected = value.discovery.coverage.find((row) => row.dimension === "affected-actor");
  affected.status = "needs-user-decision";
  affected.decisionKeys = ["actor"];
  value.discovery.decisions = [{
    key: "actor", status: "open", prerequisites: [], question: "Which actor?",
    alternatives: ["user", "operator"], recommended: "user"
  }];
  const action = semanticIntakeAction(value, { resume: "inspect draft.json" });
  assert.equal(action.action, "EDIT");
  assert.equal(action.owner, "agent");
  assert.equal(action.intake.kind, "investigate-sources");
  assert.deepEqual(action.intake.dimensions.map((row) => row.dimension), ["current-behavior"]);
  assert.equal(action.resume, "inspect draft.json");
});

test("semantic intake action exposes a bounded linked user frontier", () => {
  const value = source();
  const dimensions = ["affected-actor", "failure-path", "input-boundary", "non-goals"];
  value.discovery.decisions = dimensions.map((key) => ({
    key, status: "open", prerequisites: [], question: `${key}?`,
    alternatives: ["one", "two"], recommended: "one"
  }));
  for (const dimension of dimensions) {
    const row = value.discovery.coverage.find((candidate) => candidate.dimension === dimension);
    row.status = "needs-user-decision";
    row.decisionKeys = [dimension];
  }
  const action = semanticIntakeAction(value);
  assert.equal(action.action, "ASK_USER");
  assert.equal(action.owner, "user");
  assert.deepEqual(action.decision.items.map((row) => row.key), dimensions.slice(0, 3));
  const focused = semanticIntakeAction(value, { frontierLimit: 2 });
  assert.deepEqual(focused.decision.items.map((row) => row.key), dimensions.slice(0, 2));
});

test("semantic intake action reports ready and normalization retains decision links", () => {
  const value = source();
  value.discovery.coverage[0].decisionKeys = ["prior-decision"];
  value.discovery.decisions = [{
    key: "prior-decision", status: "resolved", prerequisites: [],
    choice: "retain", reason: "compatible"
  }];
  assert.equal(semanticIntakeAction(value).action, "DONE");
  assert.deepEqual(normalizeDiscovery(value).coverage[0].decisionKeys, ["prior-decision"]);
});

test("semantic intake ready action is blocked by non-discovery draft issues", () => {
  const action = semanticIntakeAction(source(), {
    additionalIssues: ["semantic draft tasks[0].verify is required"]
  });
  assert.equal(action.action, "EDIT");
  assert.equal(action.intake.kind, "repair-draft");
  assert.deepEqual(action.intake.issues, ["semantic draft tasks[0].verify is required"]);
  // Without a named route agents batch the repair through python, `sed -i`, or
  // a heredoc, and the host refuses each one as a permission prompt.
  assert.match(action.instruction, /Edit tool/);
  assert.match(action.instruction, /\.foundation\/drafts\/\*\* is pre-allowed/);
  assert.match(action.instruction, /python.*sed -i.*heredoc/);
});

test("semantic intake routes changed grounded sources back to the agent", () => {
  const action = semanticIntakeAction(source(), {
    sourceFreshnessFindings: [{ code: "source-digest-changed", path: "README.md" }]
  });
  assert.equal(action.action, "EDIT");
  assert.equal(action.owner, "agent");
  assert.equal(action.intake.kind, "refresh-source-coverage");
  assert.equal(action.intake.findings[0].path, "README.md");
});

test("semantic draft v3 keeps its compatibility path without discovery", () => {
  assert.deepEqual(semanticIntakeIssues({ version: 3 }), []);
});

test("a settled decision needs only its choice; reason is owed only among alternatives", () => {
  const value = source();
  value.discovery.decisions = [
    { key: "format", question: "Which format?", choice: "json" },
    { key: "storage", status: "resolved", choice: "disk" },
    { key: "fact", choice: "The API already paginates" }
  ];
  assert.deepEqual(semanticIntakeIssues(value), []);
  assert.equal(semanticIntakeAction(value).action, "DONE");
  assert.deepEqual(normalizeDiscovery(value).decisions.map((row) => row.status),
    ["resolved", "resolved", "resolved"]);

  value.discovery.decisions = [
    { key: "retention", status: "resolved", alternatives: ["30d", "90d"] },
    { key: "empty", status: "resolved" },
    { key: "fact", status: "resolved", question: "Does the API already paginate?" }
  ];
  const message = semanticIntakeIssues(value).join("\n");
  assert.match(message, /decisions\[0\]\.choice is required/);
  assert.match(message, /decisions\[0\]\.reason is required/);
  assert.match(message, /decisions\[1\]\.choice is required/);
  assert.match(message, /decisions\[2\]\.choice is required/);
  assert.doesNotMatch(message, /prerequisites must be an array/);
});

test("an unanswered question without status or choice is never settled", () => {
  const value = source();
  value.discovery.decisions = [
    { key: "retain-invoices", question: "Should deleted users keep their invoices?" }
  ];
  assert.equal(normalizeDiscovery(value).decisions[0].status, "open");
  assert.equal(normalizeDiscovery(value).decisions[0].choice, undefined);
  // An open row never becomes a durable decision with an undefined choice.
  assert.deepEqual(intakeDecisions({ discovery: normalizeDiscovery(value) }), []);
  const action = semanticIntakeAction(value);
  assert.notEqual(action.action, "DONE");
  assert.equal(action.action, "EDIT");
  const message = action.intake.issues.join("\n");
  assert.match(message, /decisions\[0\]\.alternatives must name at least two choices.*add 'choice' if it is settled/);
  assert.match(message, /decisions\[0\]\.recommended is required/);

  value.discovery.decisions[0] = {
    ...value.discovery.decisions[0], alternatives: ["keep", "delete"], recommended: "keep"
  };
  const ask = semanticIntakeAction(value);
  assert.equal(ask.action, "ASK_USER");
  assert.deepEqual(ask.decision.items.map((row) => row.key), ["retain-invoices"]);
});

test("a decision with alternatives and no choice stays an open user question", () => {
  const value = source();
  value.discovery.decisions = [{
    key: "scope", question: "Which scope?", alternatives: ["one", "all"], recommended: "one"
  }];
  const action = semanticIntakeAction(value);
  assert.equal(action.action, "ASK_USER");
  assert.deepEqual(action.decision.items.map((row) => row.key), ["scope"]);
});

// Answering a decision used to cost two or three more draft edits to mark the
// linked coverage rows. The harness projects them itself once every linked
// decision is resolved; a row still waiting on an open decision stays open.
test("resolved decisions settle their linked coverage without another draft edit", () => {
  const value = source();
  value.discovery.decisions = [
    { key: "actor", status: "resolved", choice: "admins", reason: "owners", alternatives: ["admins", "all"] },
    { key: "limit", status: "open", question: "limit?", alternatives: ["10", "50"], recommended: "10" }
  ];
  const actor = value.discovery.coverage.find((row) => row.dimension === "affected-actor");
  actor.status = "needs-user-decision";
  actor.decisionKeys = ["actor"];
  delete actor.covers;
  assert.deepEqual(semanticIntakeIssues(value).filter((issue) => issue.includes("coverage[")), []);
  assert.equal(semanticIntakeAction(value).action, "ASK_USER", "the open decision is still asked");
  value.discovery.decisions[1] = { ...value.discovery.decisions[1], status: "resolved", choice: "10",
    reason: "default" };
  const boundary = value.discovery.coverage.find((row) => row.dimension === "input-boundary");
  boundary.status = "needs-user-decision";
  boundary.decisionKeys = ["limit"];
  const ready = semanticIntakeAction(value);
  assert.equal(ready.action, "DONE");
  const normalized = normalizeDiscovery(value).coverage;
  const projected = normalized.find((row) => row.dimension === "affected-actor");
  assert.equal(projected.status, "covered");
  assert.deepEqual(projected.sources, ["decision:actor"]);
  assert.equal(value.discovery.coverage.find((row) => row.dimension === "affected-actor").status,
    "needs-user-decision", "the projection never rewrites the agent's draft object");
});

// A high-impact draft used to restate its own content as nine-plus coverage
// rows. The harness derives a row when the draft already says it, and only
// then; everything else stays missing, and an authored row always wins.
function rich(overrides = {}) {
  return {
    version: 4,
    intent: "Import contacts from a partner",
    impact: "high",
    currentState: "Contacts are typed in by hand",
    compatibility: "Existing contacts keep their IDs",
    nonGoals: ["Two-way sync"],
    userStories: [{ asA: "an admin", iWant: "to import contacts", covers: ["import"] }],
    requirements: [{
      key: "import", capability: "contacts", outcome: "Contacts are imported",
      scenarios: [
        { name: "Valid file", kind: "success", when: "a CSV is uploaded", then: "rows appear" },
        { name: "Bad row", kind: "failure", when: "a row has no email", then: "the row is listed",
          recovery: "Fix the row and re-upload" },
        { name: "Empty file", kind: "boundary", when: "the CSV has no rows", then: "nothing changes" }
      ]
    }, {
      key: "audit", capability: "contacts", outcome: "Imports are audited",
      scenarios: [{ name: "Logged", when: "an import ends", then: "one audit entry exists" }]
    }],
    tasks: [{ key: "t", covers: ["import", "audit"], verify: "npm test", paths: ["src/**"] }],
    evidence: { import: { capabilities: ["test"] }, audit: { capabilities: ["test"] } },
    discovery: { coverage: [
      { dimension: "operability", status: "not-applicable", rationale: "Batch job, existing logs" },
      { dimension: "recoverability", status: "covered", covers: ["import"] }
    ], decisions: [] },
    ...overrides
  };
}

test("required coverage the draft already states is derived, marked, and linked", () => {
  const value = rich();
  assert.deepEqual(semanticIntakeIssues(value), []);
  assert.equal(semanticIntakeAction(value).action, "DONE");
  const rows = new Map(normalizeDiscovery(value).coverage.map((row) => [row.dimension, row]));
  const derived = (dimension) => {
    const row = rows.get(dimension);
    assert.equal(row?.derived, true, dimension);
    assert.equal(row.status, "covered", dimension);
    return [row.covers, row.derivedFrom];
  };
  assert.deepEqual(derived("current-behavior"), [[], ["currentState"]]);
  assert.deepEqual(derived("affected-actor"), [["import"], ["userStories"]]);
  assert.deepEqual(derived("desired-behavior"), [["import", "audit"], ["requirements"]]);
  assert.deepEqual(derived("success-path"), [["import"], ["requirements[].scenarios kind:success"]]);
  assert.deepEqual(derived("failure-path"), [["import"], ["requirements[].scenarios kind:failure"]]);
  assert.deepEqual(derived("input-boundary"), [["import"], ["requirements[].scenarios kind:boundary"]]);
  assert.deepEqual(derived("compatibility"), [[], ["compatibility"]]);
  assert.deepEqual(derived("non-goals"), [[], ["nonGoals"]]);
  assert.deepEqual(derived("verification"), [["import", "audit"], ["tasks[].verify", "evidence"]]);
  // Authored rows are kept as written and never marked derived.
  assert.equal(rows.get("operability").derived, undefined);
  assert.equal(rows.get("recoverability").derived, undefined);
  assert.equal(value.discovery.coverage.length, 2, "the draft object is not rewritten");
});

test("coverage is never derived without backing content", () => {
  const value = rich({
    currentState: "none", compatibility: "", nonGoals: [], userStories: [],
    requirements: rich().requirements.map((row) => ({
      ...row, scenarios: row.scenarios.map(({ kind, ...scenario }) => scenario)
    })),
    evidence: { import: { capabilities: ["test"] } }
  });
  const message = semanticIntakeIssues(value).join("\n");
  for (const dimension of ["current-behavior", "affected-actor", "success-path", "failure-path",
    "input-boundary", "compatibility", "non-goals", "verification"])
    assert.match(message, new RegExp(`missing required dimension '${dimension}'`), dimension);
  // Requirements with statements and scenarios still state the desired behavior.
  assert.doesNotMatch(message, /'desired-behavior'/);
  // Unrequired dimensions are not derived, so an ordinary draft gains no rows.
  assert.deepEqual(normalizeDiscovery({ ...rich(), impact: "low", discovery: undefined }).coverage, []);
  assert.deepEqual(semanticIntakeIssues({ ...rich(), version: 3 }), []);
  assert.equal(normalizeDiscovery({ ...rich(), version: 3 }), undefined);
});

test("an authored row wins over derivation and its user decision is still asked", () => {
  const value = rich();
  value.discovery.coverage.push({
    dimension: "non-goals", status: "needs-user-decision", decisionKeys: ["scope"]
  });
  value.discovery.decisions = [{
    key: "scope", question: "Include sync?", alternatives: ["no", "yes"], recommended: "no"
  }];
  const action = semanticIntakeAction(value);
  assert.equal(action.action, "ASK_USER");
  assert.deepEqual(action.decision.items.map((row) => row.key), ["scope"]);
  const row = normalizeDiscovery(value).coverage.find((entry) => entry.dimension === "non-goals");
  assert.equal(row.status, "needs-user-decision");
  assert.equal(row.derived, undefined);
  // A `derived` flag written into the draft is ignored.
  const forged = rich({ discovery: { coverage: [
    { dimension: "current-behavior", status: "covered", derived: true, derivedFrom: ["x"] }
  ], decisions: [] } });
  assert.match(semanticIntakeIssues(forged).join("\n"), /covered status requires covers or sources/);
});

test("risk dimensions derive from the typed dev document sections", () => {
  const value = rich({
    impact: "low", riskSignals: ["persisted-data-change", "user-interface", "external-integration"],
    dataModel: [{ entity: "Contact", fields: ["email"], migration: "add column", rollback: "drop column" }],
    uiStates: [{ screen: "Import", states: ["error"], accessibility: "Labelled file input" }],
    jobContract: [{ key: "import", states: ["queued"], retry: "3x", timeout: "60s", idempotency: "file hash" }],
    integrations: [{ key: "partner", documentation: { source: "https://x.test/v1", version: "1" },
      relatesTo: ["import"], concerns: ["timeout on large files"] }]
  });
  value.discovery.coverage = [];
  const rows = new Map(normalizeDiscovery(value).coverage.map((row) => [row.dimension, row]));
  assert.deepEqual(rows.get("data-migration").derivedFrom, ["dataModel[].migration"]);
  assert.deepEqual(rows.get("rollout-rollback").derivedFrom, ["dataModel[].rollback"]);
  assert.deepEqual(rows.get("accessibility").derivedFrom, ["uiStates[].accessibility"]);
  assert.deepEqual([rows.get("integration-contract").covers, rows.get("integration-contract").derivedFrom],
    [["import"], ["integrations"]]);
  assert.deepEqual(rows.get("timeout-retry-idempotency").derivedFrom,
    ["integrations[].concerns", "jobContract"]);
  // Judgment-only dimensions are never derived.
  assert.equal(rows.has("operability"), false);
  assert.equal(rows.has("recoverability"), false);
  const partial = rich({ impact: "low", riskSignals: ["persisted-data-change"],
    dataModel: [{ entity: "A", migration: "m", rollback: "r" }, { entity: "B", migration: "m" }] });
  partial.discovery.coverage = [];
  assert.match(semanticIntakeIssues(partial).join("\n"), /missing required dimension 'rollout-rollback'/);
});

function accessDraft(accessValues, overrides = {}) {
  const value = source({
    riskSignals: ["access-control"],
    requirements: [{
      key: "search", capability: "contacts", operation: "added",
      scenarios: accessValues.map((access, index) => ({
        name: `Case ${index + 1}`, when: `request ${index + 1}`, then: `result ${index + 1}`,
        ...(access === undefined ? {} : { access })
      }))
    }],
    ...overrides
  });
  value.discovery.coverage.push({ dimension: "security-privacy", status: "covered", covers: ["search"] });
  return value;
}

test("an access-control draft with allow and deny scenarios derives permission-rejection", () => {
  const value = accessDraft(["allow", "deny"]);
  assert.deepEqual(semanticIntakeIssues(value), []);
  assert.equal(semanticIntakeAction(value).action, "DONE");
  const row = normalizeDiscovery(value).coverage
    .find((entry) => entry.dimension === "permission-rejection");
  assert.equal(row.status, "covered");
  assert.equal(row.derived, true);
  assert.deepEqual(row.covers, ["search"]);
  assert.deepEqual(row.derivedFrom, ["requirements[].scenarios access:deny"]);
});

test("an access-control draft missing one side returns an agent draft edit naming it", () => {
  for (const [present, missing] of [["deny", "allow"], ["allow", "deny"]]) {
    const action = semanticIntakeAction(accessDraft([present]));
    assert.equal(action.action, "EDIT", missing);
    assert.equal(action.owner, "agent");
    assert.equal(action.boundary, "draft-validation");
    assert.ok(action.intake.issues.includes("semantic draft riskSignals access-control " +
      `requires at least one scenario with access '${missing}'`), missing);
    assert.ok(!action.intake.issues.some((issue) =>
      issue.includes(`access '${present}'`)), present);
  }
  // Prose that reads as a refusal never stands in for the typed tag.
  const prose = accessDraft(["allow", undefined]);
  prose.requirements[0].scenarios[1].then = "the request is denied with 403 forbidden";
  assert.match(semanticIntakeIssues(prose).join("\n"), /access 'deny'/);
  assert.match(semanticIntakeIssues(prose).join("\n"),
    /missing required dimension 'permission-rejection'/);
});

test("an unknown access value is a draft edit and tags stay optional without the signal", () => {
  const unknown = semanticIntakeAction(accessDraft(["allow", "deny", "maybe"]));
  assert.equal(unknown.action, "EDIT");
  assert.equal(unknown.boundary, "draft-validation");
  assert.ok(unknown.intake.issues.includes(
    "semantic draft requirements[0].scenarios[2].access must be allow or deny"));
  // The value is checked even when the draft declares no access-control signal.
  assert.match(semanticIntakeIssues(accessDraft(["maybe"], { riskSignals: [] })).join("\n"),
    /access must be allow or deny/);
  const untagged = accessDraft([undefined], { riskSignals: [] });
  assert.deepEqual(semanticIntakeIssues(untagged), []);
  assert.equal(semanticIntakeAction(untagged).action, "DONE");
});

test("a financial risk signal requires retry and recovery coverage in any language", () => {
  const english = source({ intent: "Charge the card once", riskSignals: ["financial"] });
  const thai = source({ intent: "เรียกเก็บเงินจากบัตรเพียงครั้งเดียว", riskSignals: ["Financial"] });
  assert.deepEqual(requiredDiscoveryDimensions(english),
    ["timeout-retry-idempotency", "recoverability"]);
  assert.deepEqual(requiredDiscoveryDimensions(thai), requiredDiscoveryDimensions(english));
  const action = semanticIntakeAction(english);
  assert.equal(action.action, "EDIT");
  assert.equal(action.boundary, "draft-validation");
  assert.match(action.intake.issues.join("\n"),
    /missing required dimension 'timeout-retry-idempotency'/);
  assert.doesNotMatch(action.intake.issues.join("\n"), /unknown signal/);
  // An unknown signal is still rejected and the known list names financial.
  const money = semanticIntakeIssues(source({ riskSignals: ["money"] })).join("\n");
  assert.match(money, /unknown signal\(s\): money \(known: [^)]*\bfinancial\b/);
  // Intake depth weighs financial like the other trust-boundary signals.
  assert.ok(planSemanticIntakeDepth(english).reasons.includes("risk:financial"));
  assert.equal(planSemanticIntakeDepth(english).score,
    planSemanticIntakeDepth(source({ riskSignals: ["access-control"] })).score);
});

// --- v5 lifecycle wiring: intake gate, compliance, warnings, grounding, amend ---

test("a user question is asked once after agent repairs and keeps the resume route", () => {
  const question = { key: "compliance.approver", question: "Who approves?", kind: "compliance-approver" };
  const asked = semanticIntakeAction(source(), { resume: "resume-route", userQuestion: question });
  assert.equal(asked.action, "ASK_USER");
  assert.equal(asked.owner, "user");
  assert.equal(asked.resume, "resume-route");
  assert.equal(asked.decision.kind, "compliance-approver");
  assert.deepEqual(asked.decision.items.map((item) => item.key), ["compliance.approver"]);
  const repair = semanticIntakeAction(source(), {
    resume: "resume-route", userQuestion: question, additionalIssues: ["tasks[0].outcome is required"]
  });
  assert.equal(repair.action, "EDIT");
  assert.equal(repair.owner, "agent");
  assert.equal(repair.resume, "resume-route");
});

function writeJsonFile(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function project(t, { config = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foundation-intake-wiring-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const changes = join(root, "openspec", "changes");
  const runtime = join(root, ".foundation", "runtime");
  for (const schema of ["foundation-rapid", "foundation-standard"]) {
    const templates = join(root, "openspec", "schemas", schema, "templates");
    mkdirSync(templates, { recursive: true });
    writeFileSync(join(templates, "proposal.md"), "# <title>\n");
    writeFileSync(join(templates, "tasks.md"), "- [ ] **T001** replace-with-task\n");
    writeJsonFile(join(templates, "evidence.yaml"), { version: 2, claims: [] });
    writeJsonFile(join(templates, "execution.yaml"), { version: 1, providers: {}, services: {} });
    writeJsonFile(join(templates, "repositories.yaml"), {
      version: 1, repositories: [{ id: "root", mode: "write", dependsOn: [] }]
    });
    writeJsonFile(join(templates, "handoffs.yaml"), { version: 1, operations: [] });
    writeFileSync(join(templates, "design.md"), "# Design for <title>\n");
    writeFileSync(join(templates, "spec.md"), "## ADDED Requirements\n");
  }
  if (config !== null) writeFileSync(join(root, "openspec", "config.yaml"), config);
  const lifecycle = createChangeLifecycle({
    root,
    policy: () => ({ workflow: { grounding: "optional" }, land: {} }),
    securityTerms: [],
    fail: (message) => { throw new Error(message); },
    pathInside: () => true,
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    writeJson: writeJsonFile,
    slugify: (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    changePath: (id) => join(changes, id),
    loadRuntime: (id) => JSON.parse(readFileSync(join(runtime, `${id}.json`), "utf8")),
    saveRuntime: (state) => writeJsonFile(join(runtime, `${state.id}.json`), state),
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
  const packet = (name) => join(changes, "refund-api", name);
  return { root, changes, runtime, lifecycle, packet };
}

function v5Draft(extra = {}) {
  return {
    version: 5, id: "refund-api", intent: "Add a refund API", language: "en",
    why: "Customers wait days for refunds", impact: "low", coupling: "isolated",
    scratch: { get: "Refunds apply once", asIs: "A repeated request can refund twice",
      toBe: "A repeated request refunds once", ifFail: "An unknown order is rejected naming the order" },
    requirements: [{
      key: "refund-once", capability: "refund-api", operation: "added",
      outcome: "A refund is applied once",
      scenarios: [{ name: "Refund once", when: "a refund request arrives twice",
        then: "the refund is applied once" },
      { name: "Unknown order", kind: "failure", when: "the order does not exist",
        then: "the refund is rejected naming the order", recovery: "resend with a known order" }]
    }],
    tasks: [{
      key: "implement-refund", outcome: "Implement the refund API", covers: ["refund-once"],
      paths: ["src/**"], verify: "npm test"
    }],
    evidence: { "refund-once": { capabilities: ["test"] } },
    ...extra
  };
}

function writeDraftFolder(root, draft, design = "## Overview\nOne refund path.\n") {
  const dir = join(root, ".foundation", "drafts", "refund-api");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeJsonFile(join(dir, "change.json"), draft);
  writeFileSync(join(dir, "design.md"), design);
  return ".foundation/drafts/refund-api";
}

function captured(operation) {
  const log = console.log;
  const lines = [];
  console.log = (line) => lines.push(String(line));
  try { return { result: operation(), output: lines.join("\n") }; } finally { console.log = log; }
}

test("a v5 folder at high impact without operability coverage returns EDIT naming the dimension", (t) => {
  const { root, changes, lifecycle } = project(t);
  const coverage = [...CORE_DISCOVERY_DIMENSIONS, "recoverability"]
    .map((dimension) => ({ dimension, status: "covered", covers: ["refund-once"] }));
  const path = writeDraftFolder(root, v5Draft({ impact: "high", discovery: { coverage, decisions: [] } }));
  for (const run of [() => lifecycle.inspectDraft(path), () => lifecycle.startAtomic(path)]) {
    const { result } = captured(run);
    assert.equal(result.action, "EDIT");
    assert.equal(result.owner, "agent");
    assert.match(result.intake.issues.join("\n"), /missing required dimension 'operability'/);
    assert.doesNotMatch(result.intake.issues.join("\n"), /dimension 'recoverability'/);
    assert.equal(result.resume, `claude-foundation change start ${path} --inspect`);
  }
  assert.equal(existsSync(join(changes, "refund-api")), false);
});

test("new --draft gates a v5 folder like v4 and sends it to change start", (t) => {
  const { root, changes, lifecycle } = project(t);
  const path = writeDraftFolder(root, v5Draft());
  assert.throws(() => captured(() => lifecycle.createChange("Add a refund API", { draft: path })),
    /must use 'change start <draft\.json>' so repository intake is enforced/);
  assert.equal(existsSync(join(changes, "refund-api")), false);
});

const COMPLIANCE_ON = "schema: foundation-standard\ncompliance: change-record\n";

test("compliance enabled without an approver asks the user one question with a resume route", (t) => {
  const { root, changes, lifecycle } = project(t, { config: COMPLIANCE_ON });
  const path = writeDraftFolder(root, v5Draft({ compliance: { requester: "ops", implementer: "agent" } }));
  for (const run of [() => lifecycle.inspectDraft(path), () => lifecycle.startAtomic(path)]) {
    const { result } = captured(run);
    assert.equal(result.action, "ASK_USER");
    assert.equal(result.owner, "user");
    assert.deepEqual(result.decision.items.map((item) => item.key), ["compliance.approver"]);
    assert.equal(result.resume, `claude-foundation change start ${path} --inspect`);
  }
  assert.equal(existsSync(join(changes, "refund-api")), false);
});

test("compliance enabled with approver equal to implementer is an agent EDIT naming compliance.approver", (t) => {
  const { root, changes, lifecycle } = project(t, { config: COMPLIANCE_ON });
  const path = writeDraftFolder(root, v5Draft({
    compliance: { requester: "ops", approver: "Agent", implementer: "agent", approvedBefore: "build" }
  }));
  const { result } = captured(() => lifecycle.startAtomic(path));
  assert.equal(result.action, "EDIT");
  assert.equal(result.owner, "agent");
  assert.match(result.intake.issues.join("\n"), /compliance\.approver must differ from compliance\.implementer/);
  assert.equal(existsSync(join(changes, "refund-api")), false);
});

test("compliance disabled or satisfied adds no gate", (t) => {
  for (const [config, compliance] of [
    ["schema: foundation-standard\n", undefined],
    [COMPLIANCE_ON, { requester: "ops", approver: "lead", implementer: "agent", approvedBefore: "build" }]
  ]) {
    const { root, changes, lifecycle } = project(t, { config });
    const path = writeDraftFolder(root, v5Draft(compliance ? { compliance } : {}));
    const { result } = captured(() => lifecycle.startAtomic(path));
    assert.equal(result, "refund-api");
    assert.ok(existsSync(join(changes, "refund-api")));
  }
});

test("unknown task fields warn at start and in inspect without blocking", (t) => {
  const { root, changes, lifecycle } = project(t);
  const draft = v5Draft();
  draft.tasks[0].depends = ["other"];
  const path = writeDraftFolder(root, draft);
  const inspected = captured(() => lifecycle.inspectDraft(path)).result;
  assert.equal(inspected.action, "DONE");
  assert.ok(inspected.designWarnings.includes(
    "tasks[0].depends is not a known task field; did you mean dependsOn?"), inspected.designWarnings);
  const started = captured(() => lifecycle.startAtomic(path));
  assert.equal(started.result, "refund-api");
  assert.match(started.output, /task warning: tasks\[0\]\.depends is not a known task field; did you mean dependsOn\?/);
  assert.ok(existsSync(join(changes, "refund-api")));

  const clean = project(t);
  const cleanPath = writeDraftFolder(clean.root, v5Draft());
  assert.equal(captured(() => clean.lifecycle.inspectDraft(cleanPath)).result.designWarnings
    .some((warning) => /task field/.test(warning)), false);
  assert.doesNotMatch(captured(() => clean.lifecycle.startAtomic(cleanPath)).output, /task warning/);
});

test("a proposed decision compiles: design.md keeps valid decision metadata and the proposal lists it", (t) => {
  const { root, lifecycle, packet } = project(t);
  const path = writeDraftFolder(root, v5Draft({
    impact: "medium",
    decisions: [
      { key: "store", id: "DEC-STORE", choice: "Store refunds in Postgres", why: "Existing store", status: "accepted" },
      { key: "queue", id: "DEC-QUEUE", choice: "Queue refunds for retry", why: "Not yet agreed", status: "proposed" }
    ]
  }));
  const { result, output } = captured(() => lifecycle.startAtomic(path));
  assert.equal(result, "refund-api", output);
  const design = readFileSync(packet("design.md"), "utf8");
  assert.deepEqual(durableDecisionMetadataIssues(design), []);
  assert.doesNotMatch(design, /Queue refunds for retry/);
  assert.match(readFileSync(packet("proposal.md"), "utf8"), /Queue refunds for retry/);
});

const nfrRows = [{
  key: "refund-latency", characteristic: "time behaviour", stimulus: "100 refunds per second",
  response: "each refund is accepted", measure: "p95 under 300 ms", claim: "refund-fast"
}];
const observabilityValue = {
  correlation: "request id",
  rows: [{ failure: "refund stuck", signal: "refund.stuck", sli: "stuck ratio", slo: "< 0.1%",
    alert: "page on-call", runbook: "replay refund", owner: "payments" }]
};

test("a v5 draft with nfr and observability writes matching grounding.yaml without authored grounding", (t) => {
  const { root, lifecycle, packet } = project(t);
  const path = writeDraftFolder(root, v5Draft({
    impact: "medium", nfr: nfrRows, observability: observabilityValue
  }));
  const { result, output } = captured(() => lifecycle.startAtomic(path));
  assert.equal(result, "refund-api", output);
  const grounding = JSON.parse(readFileSync(packet("grounding.yaml"), "utf8"));
  const expected = groundingFromQuality({ nfr: nfrRows, observability: observabilityValue });
  assert.deepEqual(grounding.nfrAssessment, expected.nfrAssessment);
  assert.deepEqual(grounding.observability, expected.observability);
  const state = JSON.parse(readFileSync(join(root, ".foundation", "runtime", "refund-api.json"), "utf8"));
  assert.equal(state.groundingRequired, false);
});

test("quality grounding derivation leaves v4 drafts, v2 ledgers, and empty quality alone", () => {
  assert.equal(v5QualityGrounding({ _semanticVersion: 4, nfr: nfrRows }), null);
  assert.equal(v5QualityGrounding({ _semanticVersion: 5, nfr: nfrRows, grounding: { version: 2 } }), null);
  assert.equal(v5QualityGrounding({ _semanticVersion: 5 }), null);
  assert.equal(v5QualityGrounding({ _semanticVersion: 5, nfr: nfrRows }, { groundingRequired: true }), null);
  const v3 = v5QualityGrounding({ _semanticVersion: 5, observability: observabilityValue,
    grounding: { version: 3, decisions: [{ id: "D1", choice: "x", reason: "y" }] } });
  assert.equal(v3.version, 3);
  assert.deepEqual(v3.decisions, [{ id: "D1", choice: "x", reason: "y" }]);
  assert.deepEqual(v3.observability, groundingFromQuality({ observability: observabilityValue }).observability);
  assert.equal(v3.nfrAssessment, undefined);
});

test("document-section invalidation reruns only whole-packet review providers", () => {
  const plan = documentSectionInvalidation({
    test: { capability: "test", claims: ["c1"] },
    review: { capability: "review" },
    summary: { capability: "custom", dependsOn: ["review"] }
  });
  assert.equal(plan.status, "READY");
  assert.deepEqual(plan.affectedClaims, []);
  assert.deepEqual(plan.proof.invalidateReceipts, ["review", "summary"]);
  assert.deepEqual(plan.proof.preserveReceipts, ["test"]);
  assert.equal(plan.approval.invalidate, false);
  assert.equal(sectionsOnlyAmendment({ sections: [{ document: "design", key: "rollout", body: "x" }] }), true);
  assert.equal(sectionsOnlyAmendment({ sections: [{}], addTasks: [{}] }), false);
  assert.equal(sectionsOnlyAmendment({ addRequirements: [{}] }), false);
});

test("a sections-only amendment replaces a design section and numbers history by contract revision", (t) => {
  const { root, lifecycle, packet } = project(t);
  const design = "## Overview\nOne refund path.\n## Compatibility and rollout\nShip to everyone.\n";
  const path = writeDraftFolder(root, v5Draft({ impact: "medium" }), design);
  assert.equal(captured(() => lifecycle.startAtomic(path)).result, "refund-api");
  // A pre-Build revision moves the contract to revision 1, so the amendment is
  // revision 2 although it is the first amendment history line.
  writeDraftFolder(root, v5Draft({ impact: "medium", why: "Customers wait a week for refunds" }), design);
  captured(() => lifecycle.reviseChange("refund-api", path));
  const amendmentPath = join(root, ".foundation", "drafts", "amend.json");
  writeJsonFile(amendmentPath, {
    version: 1, reason: "Roll out behind a flag",
    sections: [{ document: "design", key: "rollout", body: "Dark launch behind a flag first." }]
  });
  const { result, output } = captured(() => lifecycle.amendChange("refund-api", amendmentPath));
  assert.match(output, /^AMENDED refund-api/m, JSON.stringify(result));
  const amended = readFileSync(packet("design.md"), "utf8");
  assert.equal(amended.match(/^## Compatibility and rollout$/gm)?.length, 1, amended);
  assert.match(amended, /Dark launch behind a flag first\./);
  assert.doesNotMatch(amended, /Ship to everyone/);
  const state = JSON.parse(readFileSync(join(root, ".foundation", "runtime", "refund-api.json"), "utf8"));
  assert.equal(state.contractRevision, 2);
  const amendment = state.amendments.at(-1);
  assert.equal(amendment.revision, 2);
  assert.deepEqual(amendment.invalidation.approval, { invalidate: false, reasons: [] });
  assert.deepEqual(amendment.invalidatedClaims ?? [], []);
  assert.match(readFileSync(packet("proposal.md"), "utf8"), /^- Revision 2 \([^)]*\): Roll out behind a flag$/m);
});
