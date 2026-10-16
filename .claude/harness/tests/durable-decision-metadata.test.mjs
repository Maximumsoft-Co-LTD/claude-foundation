import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  materializeDraftSpecs, renderDraftDesign, renderDraftProposal
} from "../runtime/workflow/change-lifecycle.mjs";
import {
  normalizeSemanticDraft, renderRequirementMarkdown
} from "../runtime/workflow/semantic-draft.mjs";

import {
  durableDecisionBlockIssues,
  durableDecisionGraphIssues,
  durableDecisionMetadataIssues,
  durableDecisionReciprocityIssues,
  durableDecisionReferenceIssues,
  durableDecisionSection,
  durableDecisionStatusIssues,
  durableDecisionValues,
  localDecisionReference,
  parseDurableDecisions
} from "../runtime/workflow/change-validation.mjs";

const fields = [
  "Status", "Decision", "Why", "Rejected", "Consequences",
  "Supersedes", "Superseded by"
];

function decisionBlock(id, overrides = {}, extra = "") {
  const values = {
    Status: "accepted",
    Decision: "Use bounded packets",
    Why: "Keep execution deterministic",
    Rejected: "Unbounded execution",
    Consequences: "Packets are explicit",
    Supersedes: "none",
    "Superseded by": "none",
    ...overrides
  };
  const metadata = fields
    .filter((field) => values[field] !== null)
    .map((field) => `  - **${field}:** ${values[field]}`)
    .join("\n");
  return `- **Decision ID:** ${id}\n${metadata}${extra}`;
}

function design(section) {
  return `## Decisions\n\n${section}\n\n## Compatibility and migration\n\nnone\n`;
}

function parsed(section) {
  const value = durableDecisionSection(design(section));
  assert.equal(value.issues, null);
  return parseDurableDecisions(value.section, value.starts);
}

test("decision section recognizes missing, none, legacy, and unidentified content", () => {
  // A compiled design omits the section when no durable decision exists.
  assert.deepEqual(durableDecisionMetadataIssues(""), []);
  assert.deepEqual(durableDecisionMetadataIssues("## Decisions\n\n## Risks\n"),
    ["design.md Decisions section is empty; list decisions or `none`"]);
  assert.deepEqual(durableDecisionMetadataIssues(design("`none`.")), []);
  assert.match(durableDecisionMetadataIssues(design(
    "- **Decision:** legacy"))[0], /legacy Decision entries/);
  assert.match(durableDecisionMetadataIssues(design(
    "<!-- template only -->"))[0], /stable Decision ID/);
});

test("decision blocks report prefix, identity, duplication, fields, and status issues", () => {
  const malformed = [
    "intro outside a block",
    decisionBlock("bad", { Status: "proposed", Why: null }, "\nfree text"),
    decisionBlock("bad")
  ].join("\n");
  const result = parsed(malformed);
  assert.ok(result.issues.some((issue) => /outside a Decision ID block/.test(issue)));
  assert.ok(result.issues.some((issue) => /ID must match/.test(issue)));
  assert.ok(result.issues.some((issue) => /is duplicated/.test(issue)));
  assert.ok(result.issues.some((issue) => /outside its metadata fields/.test(issue)));
  assert.ok(result.issues.some((issue) => /requires Why/.test(issue)));
  assert.ok(result.issues.some((issue) => /Status must be/.test(issue)));
});

test("decision value and block helpers preserve valid metadata", () => {
  const block = decisionBlock("DEC-ONE");
  const values = durableDecisionValues(block);
  assert.equal(values.Status, "accepted");
  assert.deepEqual(durableDecisionBlockIssues(
    block, "DEC-ONE", new Set(), values), []);
});

test("decision references accept none and external IDs but reject invalid local IDs", () => {
  const decision = {
    id: "DEC-ONE", label: "decision 'DEC-ONE'", values: {}
  };
  const byId = new Map([[decision.id, decision]]);
  assert.deepEqual(durableDecisionReferenceIssues(
    decision, "Supersedes", "none", byId), []);
  assert.deepEqual(durableDecisionReferenceIssues(
    decision, "Supersedes", "other-change#DEC-TWO", byId), []);
  assert.match(durableDecisionReferenceIssues(
    decision, "Supersedes", "prose", byId)[0], /must be none/);
  assert.match(durableDecisionReferenceIssues(
    decision, "Supersedes", "DEC-ONE", byId)[0], /cannot reference itself/);
  assert.match(durableDecisionReferenceIssues(
    decision, "Supersedes", "DEC-MISSING", byId)[0], /unknown local decision/);
  assert.equal(localDecisionReference("DEC-ONE"), "DEC-ONE");
  assert.equal(localDecisionReference("change#DEC-ONE"), null);
});

test("decision status requires superseded and accepted states to match replacement metadata", () => {
  assert.match(durableDecisionStatusIssues({
    label: "decision 'DEC-ONE'", values: { Status: "superseded" }
  }, "none")[0], /must name its replacement/);
  assert.match(durableDecisionStatusIssues({
    label: "decision 'DEC-ONE'", values: { Status: "accepted" }
  }, "DEC-TWO")[0], /must have superseded status/);
  assert.deepEqual(durableDecisionStatusIssues({
    label: "decision 'DEC-ONE'", values: { Status: "accepted" }
  }, "none"), []);
});

test("decision graph validates both directions of reciprocal local links", () => {
  const oldDecision = {
    id: "DEC-OLD",
    label: "decision 'DEC-OLD'",
    values: { Status: "superseded", Supersedes: "none", "Superseded by": "DEC-NEW" }
  };
  const newDecision = {
    id: "DEC-NEW",
    label: "decision 'DEC-NEW'",
    values: { Status: "accepted", Supersedes: "none", "Superseded by": "none" }
  };
  const byId = new Map([[oldDecision.id, oldDecision], [newDecision.id, newDecision]]);
  assert.match(durableDecisionReciprocityIssues(
    oldDecision, "none", "DEC-NEW", byId)[0], /reciprocal Supersedes/);
  oldDecision.values["Superseded by"] = "none";
  newDecision.values.Supersedes = "DEC-OLD";
  assert.match(durableDecisionReciprocityIssues(
    newDecision, "DEC-OLD", "none", byId)[0], /reciprocal Superseded by/);

  oldDecision.values["Superseded by"] = "DEC-NEW";
  assert.deepEqual(durableDecisionGraphIssues([oldDecision, newDecision]), []);
  assert.deepEqual(durableDecisionMetadataIssues(design([
    decisionBlock("DEC-OLD", { Status: "superseded", "Superseded by": "DEC-NEW" }),
    decisionBlock("DEC-NEW", { Supersedes: "DEC-OLD" })
  ].join("\n"))), []);
});

test("decision graph treats absent supersession links as none", () => {
  const issues = durableDecisionGraphIssues([{
    id: "DEC-ONE",
    label: "decision 'DEC-ONE'",
    values: {}
  }]);
  assert.deepEqual(issues, []);
  assert.equal(durableDecisionGraphIssues([{
    id: "DEC-ONE", label: "decision 'DEC-ONE'", values: { Supersedes: "" }
  }]).length, 0);
  assert.deepEqual(durableDecisionGraphIssues([]), []);
});

const slugify = (value) => String(value).toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function semanticDraft(decisions) {
  return {
    version: 4,
    intent: "Export reports",
    impact: "medium",
    coupling: "isolated",
    requirements: [
      { key: "export-csv", capability: "reports", requirement: "Export as CSV",
        description: "The system SHALL export the report as CSV",
        outcome: "a CSV downloads",
        scenarios: [{ name: "Export", when: "the user exports", then: "a CSV downloads" }] },
      { key: "list-reports", capability: "reports", requirement: "List reports",
        description: "The system SHALL list saved reports",
        outcome: "reports are listed",
        scenarios: [{ name: "List", when: "the user opens reports", then: "reports are listed" }] }
    ],
    tasks: [{ key: "build", outcome: "Export", covers: ["export-csv", "list-reports"],
      paths: ["src/**"], verify: "npm test" }],
    evidence: { "export-csv": { capabilities: ["test"] }, "list-reports": { capabilities: ["test"] } },
    decisions
  };
}

// Other validators (dev-document sections) may warn on this small draft; the
// decision tests assert only decision issues.
function compiled(decisions) {
  const result = normalizeSemanticDraft(semanticDraft(decisions), slugify);
  return { ...result, issues: result.issues.filter((issue) => /decision/.test(issue)) };
}

function specFile(draft) {
  const base = mkdtempSync(join(tmpdir(), "decision-rationale-"));
  try {
    materializeDraftSpecs({ basePath: base, specs: draft.specs, slugify,
      renderRequirement: (spec) => renderRequirementMarkdown(spec) });
    return readFileSync(join(base, "specs", "reports", "spec.md"), "utf8");
  } finally { rmSync(base, { recursive: true, force: true }); }
}

test("object options render as readable text in design.md", () => {
  const design = renderDraftDesign({ decisions: [{
    key: "format", choice: "CSV", why: "Spreadsheets open it",
    rejected: [{ option: "XLSX", reason: "needs a library" }],
    options: [{ option: "CSV", chosen: true },
      { option: "JSON", pros: ["typed"], cons: ["not for spreadsheets"] }],
    drivers: ["spreadsheet users"], confirmation: "export test"
  }] });
  assert.doesNotMatch(design, /\[object Object\]/);
  assert.match(design, /\*\*Rejected:\*\* XLSX: needs a library; JSON: pros: typed; cons: not for spreadsheets/);
  assert.match(design, /Drivers: spreadsheet users/);
  assert.match(design, /Confirmation: export test/);
  assert.deepEqual(durableDecisionMetadataIssues(design), []);
  // String options keep rendering as before.
  assert.match(renderDraftDesign({ decisions: [{ key: "a", choice: "X", why: "y", rejected: ["X", "Y", "Z"] }] }),
    /\*\*Rejected:\*\* Y, Z\n/);
});

test("a proposed decision is listed for the user to ratify, not recorded in design.md", () => {
  const { draft, issues } = compiled([{ key: "format", choice: "CSV", reason: "Spreadsheets open it",
    status: "proposed", options: [{ option: "CSV" }, { option: "XLSX", cons: "library" }] }]);
  assert.deepEqual(issues, []);
  const proposal = renderDraftProposal(draft, { intent: draft.intent, schema: "foundation-standard" });
  assert.match(proposal, /## Decisions to ratify and open questions\n\n- \*\*format:\*\* CSV — Spreadsheets open it \(options: CSV; XLSX: cons: library\)/);
  assert.doesNotMatch(renderDraftDesign(draft), /Decision ID/);
  const thai = renderDraftProposal({ ...draft, language: "th" }, { intent: draft.intent, schema: "foundation-standard" });
  assert.match(thai, /## สิ่งที่ต้องตัดสินใจและคำถามที่ยังเปิด/);
});

test("an unknown decision status or malformed metadata is rejected", () => {
  const { issues } = compiled([{ key: "format", choice: "CSV", reason: "r", status: "draft",
    drivers: "one", durable: "yes", requirements: ["missing-key"] }]);
  assert.ok(issues.includes("semantic draft decisions[0].status must be proposed, accepted, or superseded"));
  assert.ok(issues.some((issue) => /decisions\[0\]\.drivers must be/.test(issue)));
  assert.ok(issues.some((issue) => /decisions\[0\]\.durable must be/.test(issue)));
  assert.ok(issues.some((issue) => /references unknown requirement 'missing-key'/.test(issue)));
});

test("an accepted durable decision adds a Rationale line to the requirement it governs", () => {
  const { draft, issues } = compiled([{ id: "DEC-CSV", key: "format", choice: "CSV",
    reason: "Spreadsheets open it", durable: true, requirements: ["export-csv"] }]);
  assert.deepEqual(issues, []);
  const spec = specFile(draft);
  assert.match(spec,
    /### Requirement: Export as CSV\n\nThe system SHALL export the report as CSV\n\n- \*\*Rationale \(DEC-CSV\):\*\* CSV — Spreadsheets open it\n\n#### Scenario/);
  assert.equal(spec.match(/Rationale/g).length, 1);
});

test("non-durable and proposed decisions add nothing to specs", () => {
  for (const decision of [
    { key: "format", choice: "CSV", reason: "r", requirements: ["export-csv"] },
    { key: "format", choice: "CSV", reason: "r", durable: false, requirements: ["export-csv"] },
    { key: "format", choice: "CSV", reason: "r", durable: true, status: "proposed", requirements: ["export-csv"] }
  ]) {
    const { draft, issues } = compiled([decision]);
    assert.deepEqual(issues, []);
    assert.doesNotMatch(specFile(draft), /Rationale/);
  }
});
