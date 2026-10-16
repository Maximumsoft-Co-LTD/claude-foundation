import assert from "node:assert/strict";
import test from "node:test";
import {
  OUTLINE,
  OUTLINE_VERSION,
  VOLATILE_FIELDS,
  derivedSectionKeys,
  outlineRow,
  outlineSections,
  sectionHeading
} from "../runtime/workflow/validation/outline-contract.mjs";

const fullDraft = {
  intent: "Let customers request refunds", summary: "Refund requests", why: "Support load",
  userStories: [{ as: "customer", want: "refund", so: "money back" }],
  successCriteria: [{ criterion: "refund in 1 day" }], successMeasure: "time to refund",
  surfaces: ["api"], nonGoals: ["partial refunds"], constraints: ["no new db"],
  impact: "medium", coupling: "low", riskSignals: ["financial"], securityTriggers: ["auth"], consumers: ["web"],
  openQuestions: ["limit?"], decisionLog: [{ question: "q" }], communication: [{ audience: "support" }],
  releaseNote: "Refunds", demo: ["open refunds"],
  capabilityOverviews: [{ capability: "refunds" }, { capability: "billing" }],
  requirements: [
    { key: "a", capability: "refunds", outcome: "x", scenarios: [{ kind: "failure" }] },
    { key: "b", capability: "billing", operation: "modified", outcome: "y" },
    { key: "c", capability: "billing", operation: "removed" }
  ],
  tasks: [{ key: "t" }], investigation: { id: "inv" }, discovery: { rows: [1] }, amendments: [{ revision: 2 }],
  provenance: { source: "draft" }, compliance: { approver: "lead" },
  overview: "Approach", currentState: "Manual", domainLanguage: [{ term: "refund" }], assumptions: ["a"],
  workType: ["api", "ml"], diagram: "flowchart LR\nA-->B", boundaries: [{ boundary: "api" }], tenancy: { model: "pool" },
  userFlow: "flowchart LR\nA-->B", diagrams: [{ source: "sequenceDiagram" }], domain: { types: [1] },
  componentMap: [{ component: "c" }], apiContracts: [{ method: "POST" }], eventContracts: [{ channel: "c" }],
  dataModel: [{ entity: "refund" }], ui: { states: [1] }, configContract: [{ key: "k" }], integrations: [{ system: "psp" }],
  libraryContract: { x: 1 }, migrationPlan: { x: 1 }, performanceAnalysis: { x: 1 }, dependencyChange: { x: 1 },
  deprecationPlan: { x: 1 }, infraPlan: { x: 1 }, privacyAssessment: { x: 1 }, experimentDesign: { x: 1 },
  releasePlan: { x: 1 }, modelCard: { x: 1 }, bugfix: { rootCause: "r" }, refactor: { invariants: ["i"] },
  decisions: [{ id: "DEC-1", status: "accepted", durable: true }], nfr: [{ id: "NFR-1" }], threatModel: { assets: [1] },
  failureMatrix: [{ failure: "f" }], observability: [{ failure: "f" }], trackingPlan: [{ event: "e" }],
  compatibility: "none", rollout: { strategy: "flag" }, capacity: { load: 1 }, recovery: { rpo: "1h" },
  testStrategy: { levels: ["unit"] }, dependencies: [{ name: "psp" }], risks: ["r"], fileMap: [{ path: "a" }],
  testMap: [{ claim: "c" }], prototypeSelection: { id: "p" }
};

const keys = (document, draft, context) => outlineSections(document, draft, context).map((row) => row.key);

test("outline version and documents are exposed", () => {
  assert.equal(OUTLINE_VERSION, 1);
  assert.deepEqual(Object.keys(OUTLINE), ["proposal", "design", "spec", "tasks"]);
});

test("proposal sections follow the reader order with appendices after Definition of done", () => {
  assert.deepEqual(keys("proposal", fullDraft, { workTypes: ["api"], archived: true }), [
    "header", "summary", "why", "userStories", "successCriteria", "scope", "capabilities", "impact",
    "decisionsToRatify", "decisionLog", "communication", "demo", "acceptance", "definitionOfDone",
    "investigation", "discovery", "derived", "provenance", "amendments", "reviewRecord", "complianceRecord"
  ]);
  const rows = outlineSections("proposal", fullDraft, { archived: true });
  const done = rows.findIndex((row) => row.key === "definitionOfDone");
  rows.forEach((row, index) => assert.equal(Boolean(row.appendix), index > done, row.key));
});

test("design sections follow the outline order for a draft with every field", () => {
  assert.deepEqual(keys("design", fullDraft, { workTypes: ["api", "library", "migration", "performance",
    "dependency", "deprecation", "infra", "privacy", "experiment", "client-release", "ml"] }), [
    "overview", "currentState", "domainLanguage", "assumptions", "workType", "architecture", "tenancy",
    "userFlow", "runtime", "domainModel", "apiContracts", "eventContracts", "dataModel", "uiContract",
    "configContract", "integrations", "libraryContract", "migrationPlan", "performanceAnalysis",
    "dependencyChange", "deprecationPlan", "infraPlan", "privacyAssessment", "experimentDesign", "releasePlan",
    "modelCard", "bugfix", "refactor", "decisions", "nfr", "threatModel", "failureMatrix", "observability",
    "rollout", "capacity", "recovery", "testStrategy", "dependencies", "risks", "fileMap", "testMap", "prototype"
  ]);
});

test("spec follows Purpose then ADDED, MODIFIED, REMOVED, and tasks is one ledger", () => {
  assert.deepEqual(keys("spec", fullDraft), ["purpose", "added", "modified", "removed", "rationale"]);
  assert.deepEqual(keys("tasks", fullDraft), ["ledger"]);
  assert.deepEqual(keys("spec", { requirements: [{ key: "a", outcome: "x" }] }), ["purpose", "added"]);
});

test("rows whose condition is false are absent", () => {
  const { tenancy, investigation, constraints, ...rest } = fullDraft;
  assert.ok(!keys("design", rest, { workTypes: ["api"] }).includes("tenancy"));
  assert.ok(!keys("proposal", rest).includes("investigation"));
  const minimal = keys("proposal", { intent: "x" });
  for (const key of ["userStories", "capabilities", "decisionsToRatify", "decisionLog", "communication", "demo",
    "investigation", "discovery", "amendments"]) assert.ok(!minimal.includes(key), key);
  assert.ok(keys("proposal", { decisions: [{ status: "proposed" }] }).includes("decisionsToRatify"));
});

test("work-type detail sections appear only for their work type", () => {
  assert.ok(!keys("design", fullDraft, { workTypes: ["api"] }).includes("modelCard"));
  assert.ok(keys("design", fullDraft, { workTypes: ["ml"] }).includes("modelCard"));
  assert.ok(keys("design", fullDraft).includes("modelCard"), "falls back to draft.workType");
  assert.ok(!keys("design", { workType: "ml" }, {}).includes("modelCard"), "type without the field adds no empty heading");
  assert.ok(!keys("design", { infraPlan: { x: 1 } }, { workTypes: ["feature"] }).includes("infraPlan"));
});

test("no volatile data renders before Land", () => {
  for (const [document, rows] of Object.entries(OUTLINE))
    for (const row of rows.filter((candidate) => candidate.fields.some((field) => VOLATILE_FIELDS.includes(field))))
      assert.ok(row.appendix && row.archiveOnly, `${document}.${row.key} carries volatile data before Land`);
  assert.deepEqual([...VOLATILE_FIELDS].sort(), ["approvers", "evidenceFreshness", "reviewRecord", "status"]);
  const before = outlineSections("proposal", fullDraft, { workTypes: ["api"] });
  assert.ok(before.every((row) => !row.archiveOnly));
  assert.ok(!before.some((row) => row.fields.some((field) => VOLATILE_FIELDS.includes(field))));
  assert.deepEqual(outlineRow("proposal", "header").fields, ["id", "lane", "reviewTier", "owner", "created"]);
  const archived = keys("proposal", fullDraft, { archived: true });
  assert.ok(archived.includes("reviewRecord") && archived.includes("complianceRecord"));
  assert.ok(!keys("proposal", { ...fullDraft, compliance: undefined }, { archived: true }).includes("complianceRecord"));
});

test("headings localize to Thai and default to English", () => {
  for (const rows of Object.values(OUTLINE)) for (const row of rows) {
    assert.ok(row.heading.en && row.heading.th, `${row.document}.${row.key}`);
  }
  const why = outlineRow("proposal", "why");
  assert.equal(sectionHeading(why, "th"), "เหตุผล");
  assert.equal(sectionHeading(why, "en"), "Why");
  assert.equal(sectionHeading(why, "fr"), "Why");
  assert.equal(sectionHeading(why), "Why");
});

test("each fact has one home: keys unique and a field feeds at most one author row", () => {
  const homes = new Map();
  for (const [document, rows] of Object.entries(OUTLINE)) {
    assert.equal(new Set(rows.map((row) => row.key)).size, rows.length, `${document} keys unique`);
    for (const row of rows) {
      assert.equal(row.document, document);
      assert.ok(["author", "derived", "machine"].includes(row.owner));
      if (row.owner !== "author") continue;
      for (const field of row.fields) {
        assert.ok(!homes.has(field), `${field} feeds ${homes.get(field)} and ${document}.${row.key}`);
        homes.set(field, `${document}.${row.key}`);
      }
    }
  }
});

test("lookup helpers", () => {
  assert.equal(outlineRow("design", "nope"), null);
  assert.equal(outlineRow("design", "tenancy").heading.en, "Tenancy");
  assert.deepEqual(derivedSectionKeys("design"), ["workType", "fileMap", "testMap"]);
  assert.ok(derivedSectionKeys("proposal").includes("acceptance"));
  assert.ok(!derivedSectionKeys("proposal").includes("summary"));
  assert.throws(() => outlineSections("readme", {}), /unknown outline document/);
});
