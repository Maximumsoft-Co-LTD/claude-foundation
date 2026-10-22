import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSemanticDraft } from "../runtime/workflow/semantic-draft.mjs";
import { semanticIntakeAction } from "../runtime/workflow/validation/semantic-intake.mjs";
import {
  devDocumentIssues, requiredDevSections
} from "../runtime/workflow/validation/dev-document.mjs";

const slugify = (value) => String(value).toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// A standard (medium impact) v4 draft of the given work types.
function typed(workType, extra = {}) {
  return {
    version: 4, impact: "medium", workType,
    summary: "Users get the change described here.",
    failureMatrix: [{ failure: "bad input", userSees: "an error", recovery: "retry" }],
    tasks: [{ key: "t", paths: ["src/a.ts"] }],
    ...extra
  };
}

function missing(draft) {
  return devDocumentIssues(draft).map((issue) => issue.match(/needs '([\w.]+)'/)?.[1]);
}

test("api with apiContracts, boundaries, and a release note passes", () => {
  const draft = typed(["api"], {
    apiContracts: [{ method: "GET", path: "/items", auth: "session", request: "none",
      response: "200 list", errors: [{ status: 404, when: "missing" }] }],
    boundaries: [{ from: "api", to: "store", mode: "sync", why: "read", timeout: "1s",
      retry: "none", consistency: "strong", owner: "core" }],
    releaseNote: "Items can be listed."
  });
  assert.deepEqual(requiredDevSections(draft),
    ["summary", "failureMatrix", "apiContracts", "boundaries", "releaseNote"]);
  assert.deepEqual(devDocumentIssues(draft), []);
  // Without boundaries and the release note, each is named.
  assert.deepEqual(missing({ ...draft, boundaries: undefined, releaseNote: undefined }),
    ["boundaries", "releaseNote"]);
});

test("docs, test, and chore owe only a summary and no design", () => {
  for (const type of ["docs", "test", "chore"]) {
    const draft = { version: 4, impact: "medium", workType: [type], summary: "s",
      tasks: [{ key: "t", paths: ["README.md"] }] };
    assert.deepEqual(requiredDevSections(draft), ["summary"], type);
    assert.deepEqual(devDocumentIssues(draft), [], type);
  }
});

test("infra without infraPlan names infraPlan and its shape", () => {
  const draft = typed(["infra"], { rollout: { deployOrder: ["queue", "api"] } });
  const issues = devDocumentIssues(draft);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /^dev document \(infra\) needs 'infraPlan': \{ planDiff, environments,/);
  assert.match(issues[0], /e\.g\. \{ "planDiff"/);
});

test("a security bugfix owes disclosure; a hotfix owes incident and backport", () => {
  const bugfix = { reproduction: "r", rootCause: "c", regression: "t" };
  assert.deepEqual(missing(typed(["bugfix"], { bugfix })), []);
  assert.deepEqual(missing(typed(["bugfix"], { bugfix: { ...bugfix, variant: "security" } })),
    ["bugfix.disclosure"]);
  assert.match(devDocumentIssues(typed(["bugfix"], { bugfix: { ...bugfix, variant: "security" } }))[0],
    /needs 'bugfix\.disclosure' \(security fix\): \{ class, affectedVersions/);
  assert.deepEqual(missing(typed(["bugfix"], { bugfix: { ...bugfix, variant: "security",
    disclosure: { class: "IDOR", owner: "security" } } })), []);
  assert.deepEqual(missing(typed(["bugfix"], { bugfix: { ...bugfix, variant: "hotfix" } })),
    ["bugfix.incident", "bugfix.backport"]);
});

test("dependency work requires dependencyChange but no failure matrix", () => {
  const draft = { version: 4, impact: "medium", summary: "s",
    tasks: [{ key: "t", paths: ["package.json"] }] };
  assert.deepEqual(requiredDevSections(draft), ["summary", "dependencyChange"]);
  assert.deepEqual(missing(draft), ["dependencyChange"]);
  assert.deepEqual(devDocumentIssues({ ...draft,
    dependencyChange: [{ package: "express", from: "4.19.2", to: "4.21.0" }] }), []);
});

test("ui is satisfied by either uiStates or ui; async by jobContract or eventContracts", () => {
  const base = typed(["ui"], { userFlow: "flowchart LR\n  A --> B",
    componentMap: [{ component: "Board", responsibility: "r" }], releaseNote: "New board." });
  assert.deepEqual(missing(base), ["uiStates"]);
  assert.match(devDocumentIssues(base)[0], /needs 'uiStates' \(or 'ui'\)/);
  assert.deepEqual(devDocumentIssues({ ...base, uiStates: [{ screen: "Board" }] }), []);
  assert.deepEqual(devDocumentIssues({ ...base, ui: { states: [{ screen: "Board" }] } }), []);
  const async = typed(["async"], { diagrams: [{ source: "sequenceDiagram\n  A->>B: x" }] });
  assert.deepEqual(missing(async), ["jobContract"]);
  assert.deepEqual(missing({ ...async, eventContracts: [{ name: "item.created" }] }), []);
});

test("every catalog type asks only for its catalog sections", () => {
  const expected = {
    feature: ["userFlow", "releaseNote"], library: ["libraryContract", "releaseNote"],
    data: ["dataModel"], migration: ["migrationPlan", "rollout"],
    integration: ["integrations"], config: ["configContract"],
    performance: ["nfr", "performanceAnalysis"], deprecation: ["deprecationPlan", "releaseNote"],
    infra: ["infraPlan", "rollout"], observability: ["observability"],
    privacy: ["privacyAssessment", "threatModel"], experiment: ["experimentDesign", "rollout"],
    "client-release": ["releasePlan", "releaseNote"], ml: ["modelCard"],
    refactor: ["refactor", "componentMap"]
  };
  for (const [type, sections] of Object.entries(expected)) {
    const required = requiredDevSections(typed([type]));
    assert.deepEqual(required.filter((key) => !["summary", "failureMatrix"].includes(key)),
      sections, type);
    // Every required key has help, so no issue reads "needs undefined".
    for (const issue of devDocumentIssues({ ...typed([type]), summary: "" }))
      assert.doesNotMatch(issue, /undefined/, type);
  }
});

// gates-always-resumable: a missing required section is an agent draft repair
// with a resume route at change start, never a user decision.
test("missing required sections reach change start as an agent EDIT with a resume route", () => {
  const draft = {
    version: 4, intent: "Provision a job queue", impact: "medium", workType: ["infra"],
    summary: "Jobs get a durable queue.",
    rollout: { deployOrder: ["queue", "worker"] },
    requirements: [{ key: "queue", capability: "jobs", operation: "added",
      scenarios: [{ name: "Queue exists", kind: "success", when: "apply runs", then: "the queue exists" },
        { name: "Apply fails", kind: "failure", when: "apply fails", then: "no partial queue remains" }] }],
    tasks: [{ key: "provision", outcome: "Provision the queue", covers: ["queue"],
      paths: ["terraform/main.tf"], verify: "terraform validate" }],
    evidence: { queue: { capabilities: ["test"] } }
  };
  const { issues } = normalizeSemanticDraft(draft, slugify);
  const sectionIssues = issues.filter((issue) => /^dev document/.test(issue));
  assert.equal(sectionIssues.length, 1);
  assert.match(sectionIssues[0], /needs 'infraPlan'/);
  const resume = "claude-foundation change start draft.json --inspect";
  const action = semanticIntakeAction(draft, { resume, additionalIssues: issues });
  assert.equal(action.action, "EDIT");
  assert.equal(action.owner, "agent");
  assert.equal(action.intake.kind, "repair-draft");
  assert.equal(action.resume, resume);
  assert.ok(action.intake.issues.includes(sectionIssues[0]));
});

// Work types added with data-fix, security, and cicd, and the stricter fields.
const FIX = { scope: "1,204 rows", snapshot: "table copy", dryRun: "diff on staging", rerunSafe: "yes", rollback: "restore the copy" };
const HARD = { weakness: "sessions never expire", control: "8 hour expiry", verification: "expired token test" };
const PIPE = { changes: "add a deploy job", permissions: "id-token write", blastRadius: "staging only", rollback: "revert the file" };
const THREAT = { assets: ["sessions"], trustBoundaries: ["browser to api"], threats: [{ key: "t1", stride: "spoofing",
  threat: "stolen token", likelihood: "low", impact: "high", control: "expiry", residual: "low" }] };

function issuesOf(draft) {
  return normalizeSemanticDraft({ version: 5, intent: "x", impact: "medium", scratch: SCRATCH4, ...draft }, slugify).issues;
}
const SCRATCH4 = { get: "g", asIs: "a", toBe: "t", ifFail: "f" };

test("data-fix, security, and cicd each name their required sections", () => {
  assert.deepEqual(requiredDevSections(typed(["data-fix"])), ["summary", "failureMatrix", "dataFix"]);
  assert.deepEqual(requiredDevSections(typed(["security"])), ["summary", "failureMatrix", "threatModel", "hardening"]);
  assert.deepEqual(requiredDevSections(typed(["cicd"])), ["summary", "failureMatrix", "pipelinePlan"]);
  assert.deepEqual(missing(typed(["data-fix"])), ["dataFix"]);
  assert.deepEqual(missing(typed(["security"])), ["threatModel", "hardening"]);
  assert.deepEqual(missing(typed(["cicd"])), ["pipelinePlan"]);
  assert.deepEqual(devDocumentIssues(typed(["data-fix"], { dataFix: FIX })), []);
  assert.deepEqual(devDocumentIssues(typed(["security"], { threatModel: THREAT, hardening: HARD })), []);
  assert.deepEqual(devDocumentIssues(typed(["cicd"], { pipelinePlan: PIPE })), []);
});

test("a field missing from a new section is named, and each section's fields are all required", () => {
  const named = (draft) => issuesOf(draft).filter((issue) => /dataFix|hardening|pipelinePlan/.test(issue));
  for (const field of Object.keys(FIX)) {
    const { [field]: _drop, ...rest } = FIX;
    assert.ok(named({ dataFix: rest }).some((issue) => issue.includes(`dataFix.${field} is required`)), field);
  }
  for (const field of Object.keys(HARD)) {
    const { [field]: _drop, ...rest } = HARD;
    assert.ok(named({ hardening: rest }).some((issue) => issue.includes(`hardening.${field} is required`)), field);
  }
  for (const field of Object.keys(PIPE)) {
    const { [field]: _drop, ...rest } = PIPE;
    assert.ok(named({ pipelinePlan: rest }).some((issue) => issue.includes(`pipelinePlan.${field} is required`)), field);
  }
  assert.deepEqual(named({ dataFix: FIX, hardening: HARD, pipelinePlan: PIPE }), []);
});

test("every required field of the new and stricter sections accepts none or unknown with a reason", () => {
  const unknown = "unknown: not known until the first dry run";
  const all = (fields) => Object.fromEntries(Object.keys(fields).map((field) => [field, unknown]));
  const clean = (draft) => issuesOf(draft).filter((issue) =>
    /dataFix|hardening|pipelinePlan|infraPlan|experimentDesign|modelCard/.test(issue));
  assert.deepEqual(clean({ dataFix: all(FIX), hardening: all(HARD), pipelinePlan: all(PIPE) }), []);
  assert.deepEqual(clean({ dataFix: { ...FIX, rollback: "none: the old rows are not kept" } }), []);
  assert.deepEqual(clean({ experimentDesign: { hypothesis: "h", primaryMetric: "m", allocation: "a", decisionRule: "d",
    guardrails: "unknown: not chosen yet", stopRules: "none: runs for a fixed week" } }), []);
  assert.deepEqual(clean({ infraPlan: { planDiff: "+1 queue", blastRadius: "jobs", environments: ["staging"],
    costDelta: "unknown: pricing not published" } }), []);
  assert.deepEqual(clean({ modelCard: { intendedUse: "u", model: "m", fallback: "f", versionPin: "1",
    evaluation: "none: no labelled set exists yet" } }), []);
});

test("none or unknown without a reason is a repair that names the field", () => {
  for (const bare of ["unknown", "none", "unknown:", "none:  ", "ไม่ทราบ", "ไม่มี:"]) {
    const issues = issuesOf({ dataFix: { ...FIX, scope: bare } }).filter((issue) => issue.includes("dataFix.scope"));
    assert.equal(issues.length, 1, bare);
    assert.match(issues[0], /says none or unknown without a reason; write 'unknown: <reason>'/);
  }
  // Text that merely starts with the word is an ordinary answer.
  assert.deepEqual(issuesOf({ dataFix: { ...FIX, scope: "none in the archive table; 3 rows elsewhere" } })
    .filter((issue) => issue.includes("dataFix")), []);
});

test("ml, experiment, and infra require the fields that were only recommended", () => {
  const ml = { intendedUse: "u", model: "m", fallback: "f", versionPin: "1" };
  assert.ok(issuesOf({ modelCard: ml }).some((issue) => issue.includes("modelCard.evaluation is required")));
  assert.deepEqual(issuesOf({ modelCard: { ...ml, evaluation: { set: "s", thresholds: [{ metric: "acc", threshold: ">= 0.9" }] } } })
    .filter((issue) => issue.includes("modelCard")), []);
  const experiment = { hypothesis: "h", primaryMetric: "m", allocation: "a", decisionRule: "d" };
  const named = issuesOf({ experimentDesign: { ...experiment, guardrails: ["errors"] } })
    .filter((issue) => issue.includes("experimentDesign"));
  assert.deepEqual(named, ["semantic draft experimentDesign.stopRules is required"].map((text) => named[0]).slice(0, 1));
  assert.match(named[0], /experimentDesign\.stopRules/);
  assert.ok(issuesOf({ infraPlan: { planDiff: "+1", blastRadius: "b", environments: ["staging"] } })
    .some((issue) => issue.includes("infraPlan.costDelta is required")));
});
