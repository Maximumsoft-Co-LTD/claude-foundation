import assert from "node:assert/strict";
import test from "node:test";
import {
  CORE_DISCOVERY_DIMENSIONS,
  decisionFrontier,
  normalizeDiscovery,
  requiredDiscoveryDimensions,
  semanticIntakeAction,
  semanticIntakeIssues
} from "../runtime/workflow/validation/semantic-intake.mjs";
import { intakeDecisions } from "../runtime/workflow/validation/reader-guide.mjs";

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
