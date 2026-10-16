import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { planAmendmentInvalidation } from
  "../runtime/workflow/validation/amendment-invalidation.mjs";
import { formatInvalidatedWaivers, invalidatedWaivers } from
  "../runtime/workflow/change-lifecycle.mjs";
import { compileSemanticAmendment, writeSemanticAmendment } from
  "../runtime/workflow/semantic-amendment.mjs";

// Waivers bind to the contract revision; an amendment that moves it must say
// which gates came back instead of letting them reappear silently (issue #40).
test("an amendment names the waivers its new contract revision invalidates", () => {
  const waivers = [
    { capability: "test", binding: { workspaceHash: "h", contractRevision: 2 } },
    { capability: "review", binding: { workspaceHash: "h", contractRevision: 2 } },
    { capability: "legacy" },
    { capability: "current", binding: { workspaceHash: "h", contractRevision: 3 } }
  ];
  assert.deepEqual(invalidatedWaivers(waivers, 3), ["review", "test"]);
  const line = formatInvalidatedWaivers("demo", waivers, 3);
  assert.match(line, /^ {2}waivers no longer apply: review, test \(.*now 3\)/);
  assert.match(line, /claude-foundation change waive demo --capability <capability>/);
  assert.equal(formatInvalidatedWaivers("demo", [], 3), "");
  assert.equal(formatInvalidatedWaivers("demo", undefined, 3), "");
  assert.equal(formatInvalidatedWaivers("demo", waivers.slice(2), 3), "");
});

function fixture(overrides = {}) {
  return {
    claims: [
      { id: "profile-read", capabilities: ["test"] },
      { id: "profile-write", capabilities: ["test", "browser"] },
      { id: "audit-log", capabilities: ["test"] }
    ],
    tasks: [
      { id: "T001", claims: ["profile-read"] },
      { id: "T002", claims: ["profile-write"] },
      { id: "T003", claims: ["audit-log"] }
    ],
    providers: {
      test: { capability: "test" },
      browser: { capability: "browser", claims: ["profile-write"] },
      discovery: { capability: "discovery" },
      review: { capability: "review" },
      deploy: { capability: "live", dependsOn: ["browser"] }
    },
    coverageDelta: { changedClaimIds: ["profile-write"] },
    ...overrides
  };
}

test("planner invalidates affected and packet-bound providers selectively", () => {
  const result = planAmendmentInvalidation(fixture());
  assert.equal(result.status, "READY");
  assert.deepEqual(result.affectedClaims, ["profile-write"]);
  assert.deepEqual(result.affectedTasks, ["T002"]);
  assert.deepEqual(result.affectedProviders,
    ["browser", "deploy", "discovery", "review", "test"]);
  assert.deepEqual(result.preservedProviders, []);
  assert.deepEqual(result.approval,
    { invalidate: true, reasons: ["semantic-coverage-changed"] });
  assert.deepEqual(result.proof.invalidateReceipts,
    ["browser", "deploy", "discovery", "review", "test"]);
});

test("test changes invalidate derived discovery coverage", () => {
  const result = planAmendmentInvalidation(fixture({
    coverageDelta: { changedClaimIds: ["audit-log"] },
    providers: {
      discovery: { capability: "discovery" },
      audit: { capability: "test", claims: ["audit-log"] },
      browser: { capability: "browser", claims: ["profile-write"] }
    }
  }));
  assert.deepEqual(result.affectedProviders, ["audit", "discovery"]);
  assert.deepEqual(result.proof.preserveReceipts, ["browser"]);
});

test("global coverage changes conservatively affect every claim", () => {
  const result = planAmendmentInvalidation(fixture({
    coverageDelta: {
      coverageChanges: [{ dimension: "compatibility", beforeStatus: "covered",
        afterStatus: "needs-investigation" }]
    }
  }));
  assert.equal(result.coverage.global, true);
  assert.deepEqual(result.affectedClaims,
    ["audit-log", "profile-read", "profile-write"]);
  assert.deepEqual(result.affectedTasks, ["T001", "T002", "T003"]);
});

test("added claims are planned and removed claims fail closed without history", () => {
  const added = fixture({
    claims: [{ id: "new", capabilities: ["test"] }],
    tasks: [{ id: "T004", claims: ["new"] }],
    providers: [{ id: "test", capability: "test" }],
    coverageDelta: { addedClaimIds: ["new"] }
  });
  assert.equal(planAmendmentInvalidation(added).status, "READY");

  const removed = fixture({
    claims: [], tasks: [], providers: [{ id: "test", capability: "test" }],
    coverageDelta: { removedClaimIds: ["old"] }
  });
  const removedResult = planAmendmentInvalidation(removed);
  assert.equal(removedResult.status, "BLOCKED");
  assert.deepEqual(removedResult.affectedClaims, ["old"]);
  assert.ok(removedResult.findings.some((finding) =>
    finding.code === "REMOVED_CLAIM_HISTORY_REQUIRED"));
});

test("removed claims are planned from prior claims and their provider bindings", () => {
  const priorClaims = [
    { id: "profile-read", capabilities: ["test"] },
    { id: "legacy-export", capabilities: ["browser"] }
  ];
  const result = planAmendmentInvalidation({
    claims: [{ id: "profile-read", capabilities: ["test"] }],
    tasks: [{ id: "T001", claims: ["profile-read"] }],
    providers: {
      test: { capability: "test" },
      browser: { capability: "browser", claims: [] }
    },
    coverageDelta: { removedClaimIds: ["legacy-export"] },
    priorClaims
  });
  assert.equal(result.status, "READY");
  assert.deepEqual(result.affectedClaims, ["legacy-export"]);
  assert.deepEqual(result.affectedTasks, []);
  assert.deepEqual(result.affectedProviders, ["browser"]);
  assert.deepEqual(result.preservedProviders, ["test"]);

  const unknown = planAmendmentInvalidation({
    claims: [], tasks: [], providers: {},
    coverageDelta: { removedClaimIds: ["never-existed"] }, priorClaims
  });
  assert.ok(unknown.findings.some((finding) => finding.code === "UNKNOWN_REMOVED_CLAIM"));
  const present = planAmendmentInvalidation({
    claims: [{ id: "profile-read", capabilities: ["test"] }],
    tasks: [{ id: "T001", claims: ["profile-read"] }], providers: {},
    coverageDelta: { removedClaimIds: ["profile-read"] }, priorClaims
  });
  assert.ok(present.findings.some((finding) => finding.code === "REMOVED_CLAIM_STILL_PRESENT"));
});

test("planner fails closed for incomplete bindings and unknown identities", () => {
  const result = planAmendmentInvalidation({
    claims: [{ id: "changed" }],
    tasks: [{ id: "T001" }],
    providers: { test: {} },
    coverageDelta: { changedClaimIds: ["changed", "unknown"] }
  });
  assert.equal(result.status, "BLOCKED");
  const codes = result.findings.map((finding) => finding.code);
  for (const code of [
    "INVALID_CLAIM_CAPABILITIES", "MISSING_TASK_CLAIMS",
    "UNIMPLEMENTED_AFFECTED_CLAIM", "UNKNOWN_AFFECTED_CLAIM",
    "UNRESOLVED_PROVIDER_CAPABILITY"
  ]) assert.ok(codes.includes(code), code);
  assert.equal(result.approval.invalidate, true);
  assert.equal(result.proof.invalidate, true);
});

test("provider dependencies propagate transitively and terminate on cycles", () => {
  const result = planAmendmentInvalidation(fixture({
    providers: [
      { id: "test", capability: "test" },
      { id: "package", capability: "package", dependsOn: ["test", "publish"] },
      { id: "publish", capability: "live", dependsOn: ["package"] }
    ],
    coverageDelta: { changedClaimIds: ["profile-read"] }
  }));
  assert.equal(result.status, "READY");
  assert.deepEqual(result.affectedProviders, ["package", "publish", "test"]);
});

test("empty or malformed deltas cannot produce a ready no-op plan", () => {
  const empty = planAmendmentInvalidation(fixture({ coverageDelta: {} }));
  assert.equal(empty.status, "BLOCKED");
  assert.ok(empty.findings.some((finding) => finding.code === "EMPTY_COVERAGE_DELTA"));

  const malformed = planAmendmentInvalidation(fixture({ coverageDelta: null }));
  assert.equal(malformed.status, "BLOCKED");
  assert.ok(malformed.findings.some((finding) => finding.code === "INVALID_COVERAGE_DELTA"));
});

// --- Amendments replace packet sections in place (amendment-replaces, v5-revise-amend)

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const TASKS = "# Tasks\n\n- [x] **T001** Build A [key:impl] [claims:a] — verify: `npm test`\n";

function packet(t, { proposal = "# Change: Pay safely\n\n## Summary\n\nPay once.\n", design = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "amend-sections-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "proposal.md"), proposal);
  if (design !== null) writeFileSync(join(dir, "design.md"), design);
  writeFileSync(join(dir, "tasks.md"), TASKS);
  writeFileSync(join(dir, "evidence.yaml"), JSON.stringify({ version: 1, claims: [] }));
  return dir;
}

function agreement(goal) {
  return {
    language: "en",
    investigation: {
      version: 2, id: "inv-pay", outcome: "ready", summary: "Retry safely",
      intake: {
        intent: { goal },
        requirements: [{ key: "retry", revision: 1, kind: "functional", status: "confirmed",
          origin: "user", statement: "Retry once on timeout", material: true }]
      }
    },
    investigationCoverage: [{ sourceKey: "retry", sourceRevision: 1,
      targets: [{ kind: "requirement", key: "retry" }] }]
  };
}

function compiledFor(overrides = {}) {
  return {
    tasksContent: TASKS, claims: [], providers: {}, specs: [], revisedSpecs: [],
    removedRequirements: [], sections: [], amendmentReason: "Build found more", ...overrides
  };
}

const amend = (dir, compiled, options = {}) =>
  writeSemanticAmendment(dir, compiled, slug, { schema: "foundation-rapid", ...options });
const count = (text, pattern) => (text.match(pattern) || []).length;
const read = (dir, file) => readFileSync(join(dir, file), "utf8");

test("three amendments keep one investigation appendix and three history lines", (t) => {
  const dir = packet(t);
  for (const [index, goal] of ["Goal one", "Goal two", "Goal three"].entries())
    amend(dir, compiledFor({ investigationAgreement: agreement(goal), amendmentReason: `Reason ${index + 1}` }),
      { date: `2026-10-0${index + 1}` });
  const proposal = read(dir, "proposal.md");
  assert.equal(count(proposal, /^## Appendix: Investigation$/gm), 1);
  assert.doesNotMatch(proposal, /Latest amended investigation agreement/);
  assert.match(proposal, /Goal three/);
  assert.doesNotMatch(proposal, /Goal one|Goal two/);
  assert.equal(count(proposal, /^## Appendix: Amendment history$/gm), 1);
  assert.match(proposal, /- Revision 1 \(2026-10-01\): Reason 1\n- Revision 2 \(2026-10-02\): Reason 2\n- Revision 3 \(2026-10-03\): Reason 3\n/);
  assert.ok(proposal.indexOf("## Appendix: Investigation") < proposal.indexOf("## Appendix: Amendment history"));
  assert.match(proposal, /^## Summary\n\nPay once\.$/m);
  assert.equal(read(dir, "tasks.md"), TASKS);
});

test("a proposal with duplicated legacy investigation sections collapses to one", (t) => {
  const legacy = ["Old A", "Old B", "Old C"].map((goal) =>
    "## Latest amended investigation agreement\n\n## Investigation requirement coverage\n\n" +
    `| Source | Requirement | Targets |\n|---|---|---|\n| retry@1 | ${goal} | requirement: retry |\n\n` +
    `## Retained investigation context\n\nGoal: ${goal}\n`).join("\n");
  const dir = packet(t, { proposal: "# Change: Pay safely\n\n## Summary\n\nPay once.\n\n" +
    "## Operator notes\n\nKeep `## not a heading` text.\n\n```md\n## Fenced heading stays\n```\n\n" + legacy });
  amend(dir, compiledFor({ investigationAgreement: agreement("Current goal") }), { date: "2026-10-15" });
  const proposal = read(dir, "proposal.md");
  assert.equal(count(proposal, /^## Appendix: Investigation$/gm), 1);
  for (const heading of ["Latest amended investigation agreement", "Investigation requirement coverage",
    "Retained investigation context"])
    assert.doesNotMatch(proposal, new RegExp(`^## ${heading}$`, "m"), heading);
  assert.doesNotMatch(proposal, /Old [ABC]/);
  assert.match(proposal, /Current goal/);
  assert.match(proposal, /## Operator notes\n\nKeep `## not a heading` text\.\n\n```md\n## Fenced heading stays\n```/);
});

test("an amendment to a change without investigation adds no investigation section", (t) => {
  const dir = packet(t);
  amend(dir, compiledFor({ removedRequirements: [{ key: "b", migration: "Moves to a successor" }] }),
    { date: "2026-10-15" });
  amend(dir, compiledFor({ removedRequirements: [{ key: "c", migration: "Dropped" }],
    discovery: { coverage: [{ dimension: "compatibility", status: "covered", covers: ["a"] }] } }),
  { date: "2026-10-16" });
  amend(dir, compiledFor({
    discovery: { coverage: [{ dimension: "failure-path", status: "covered", covers: ["a"] }] } }),
  { date: "2026-10-17" });
  const proposal = read(dir, "proposal.md");
  assert.doesNotMatch(proposal, /investigation/i);
  assert.equal(count(proposal, /^## Amendment removed requirements$/gm), 1);
  assert.match(proposal, /\| b \| Moves to a successor \|\n\| c \| Dropped \|/);
  assert.equal(count(proposal, /^## Amendment discovery coverage$/gm), 1);
  assert.match(proposal, /\| failure-path \| covered \|/);
  assert.doesNotMatch(proposal, /\| compatibility \| covered \|/);
  assert.equal(count(proposal, /^- Revision \d+ /gm), 3);
});

const DESIGN = "# Design\n\n## Overview\n\nAuthored overview prose.\n\n" +
  "## Compatibility and rollout\n\nShip it all at once.\n\n## Risks\n\n| Risk | Mitigation | Evidence owner |\n" +
  "|---|---|---|\n| Retry storm | Cap | ops |\n";

test("an amendment replaces the design rollout section in place", (t) => {
  const dir = packet(t, { design: DESIGN });
  const compiled = compileSemanticAmendment({
    amendment: { version: 1, reason: "Roll out behind a flag", sections: [{
      document: "design", key: "rollout",
      value: { strategy: "Feature flag at 10% then 100%", rollback: "Turn the flag off" }
    }] },
    contract: { version: 1, claims: [], providers: {} }, tasksContent: TASKS, slugify: slug,
    renderTask: () => ""
  });
  assert.deepEqual(compiled.issues, []);
  amend(dir, compiled, { date: "2026-10-15" });
  const design = read(dir, "design.md");
  assert.equal(count(design, /^## Compatibility and rollout$/gm), 1);
  assert.match(design, /Feature flag at 10% then 100%/);
  assert.match(design, /Turn the flag off/);
  assert.doesNotMatch(design, /Ship it all at once/);
  assert.ok(design.indexOf("## Compatibility and rollout") < design.indexOf("## Risks"));
  assert.match(design, /## Overview\n\nAuthored overview prose\.\n\n## Compatibility/);
  assert.match(design, /\| Retry storm \| Cap \| ops \|/);

  amend(dir, compiledFor({ sections: [{ document: "design", key: "rollout", body: "Dark launch first." }] }));
  const again = read(dir, "design.md");
  assert.equal(count(again, /^## Compatibility and rollout$/gm), 1);
  assert.match(again, /## Compatibility and rollout\n\nDark launch first\.\n\n## Risks/);
  assert.equal(read(dir, "tasks.md"), TASKS);
});

test("an amendment naming an unknown outline section is rejected and the packet is unchanged", (t) => {
  const dir = packet(t, { design: DESIGN });
  const before = Object.fromEntries(["proposal.md", "design.md", "tasks.md", "evidence.yaml"]
    .map((file) => [file, read(dir, file)]));
  const compiled = compileSemanticAmendment({
    amendment: { version: 1, reason: "Rename", sections: [{ document: "design", key: "launchPlan", body: "x" }] },
    contract: { version: 1, claims: [], providers: {} }, tasksContent: TASKS, slugify: slug,
    renderTask: () => ""
  });
  assert.match(compiled.issues.join("\n"), /sections\[0\]\.key 'launchPlan' is not a design outline section/);
  assert.equal(compiled.tasksContent, undefined);
  for (const sections of [[{ document: "design", key: "launchPlan", body: "x" }],
    [{ document: "proposal", key: "acceptance", body: "x" }]])
    assert.throws(() => amend(dir, compiledFor({ sections, investigationAgreement: agreement("New") })),
      /not a design outline section|harness builds/);
  for (const [file, content] of Object.entries(before)) assert.equal(read(dir, file), content, file);
  const invalid = compileSemanticAmendment({
    amendment: { version: 1, sections: [{ document: "design", key: "rollout", value: { strategy: "x" } }] },
    contract: { version: 1, claims: [], providers: {} }, tasksContent: TASKS, slugify: slug,
    renderTask: () => ""
  });
  assert.match(invalid.issues.join("\n"), /sections\[0\]\.value: rollout\.rollback/);
});
