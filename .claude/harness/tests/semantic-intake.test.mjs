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
