import assert from "node:assert/strict";
import test from "node:test";
import { expandMinimalSemanticDraft, normalizeSemanticDraft } from "../runtime/workflow/semantic-draft.mjs";
import {
  draftNeedsDesign, renderDraftDesign, renderDraftProposal, reviewRouteLabel,
  synchronizeProposalClassification
} from "../runtime/workflow/change-lifecycle.mjs";
import { coverageNoteLine } from "../runtime/workflow/validation/packet-overview.mjs";
import {
  durableDecisionMetadataIssues
} from "../runtime/workflow/change-validation.mjs";
import {
  fileMapWithTasks, openQuestionItems, readerGuideWarnings
} from "../runtime/workflow/validation/reader-guide.mjs";

const slugify = (value) => String(value).toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const DIMENSIONS = [
  "current-behavior", "affected-actor", "desired-behavior", "success-path",
  "failure-path", "input-boundary", "compatibility", "non-goals", "verification",
  "data-migration", "rollout-rollback", "recoverability"
];

function draft(overrides = {}) {
  return {
    version: 4,
    intent: "Kanban board",
    impact: "medium",
    coupling: "isolated",
    workType: ["feature", "ui"],
    requirements: [
      { key: "add-card", capability: "board", scenarios: [{ name: "Add", when: "a title is submitted" }], outcome: "the card appears" },
      { key: "move-card", capability: "board", scenarios: [{ name: "Move", when: "a card is dragged" }], outcome: "the card moves" },
      { key: "persist", capability: "storage", scenarios: [{ name: "Reload", when: "the page reloads" }], outcome: "cards remain" }
    ],
    tasks: [
      { key: "state", outcome: "Board state", covers: ["add-card", "move-card"], paths: ["src/board/**"], verify: "npm test" },
      { key: "store", outcome: "Local storage", covers: ["persist"], dependsOn: ["state"], paths: ["src/storage.ts", "tsconfig*.json"], verify: "npm test" }
    ],
    evidence: {
      "add-card": { capabilities: ["test"] },
      "move-card": { capabilities: ["test"] },
      persist: { capabilities: ["test"] }
    },
    fileMap: [
      { path: "src/board/reducer.ts", change: "added", responsibility: "State" },
      { path: "tsconfig.json", change: "added", responsibility: "Config" },
      { path: "README.md", change: "modified", responsibility: "Docs" }
    ],
    failureMatrix: [{ failure: "blank title", userSees: "message", recovery: "retry" }],
    summary: "Users add and move cards on one board that survives reloads.",
    userFlow: { purpose: "Adding a card", source: "flowchart LR\n  A[Type title] --> B{Blank?}\n  B -->|no| C[Card shown]\n  B -->|yes| D[Message]" },
    uiStates: [{ screen: "Board", states: ["empty", "loaded", "error"], accessibility: "Keyboard moves" }],
    componentMap: [{ component: "Board reducer", responsibility: "Card state", files: ["src/board/reducer.ts"] }],
    testMap: [{ scenario: "add", level: "unit", file: "src/board/reducer.test.ts", task: "state" }],
    discovery: {
      coverage: DIMENSIONS.map((dimension) => ({
        dimension, status: "covered", covers: ["add-card"],
        ...(dimension === "compatibility" ? { rationale: "none" } : {})
      })),
      decisions: [{
        key: "stack", status: "resolved", prerequisites: [],
        question: "Which stack?", alternatives: ["Vite + React", "Plain HTML"],
        recommended: "Vite + React", choice: "Vite + React", reason: "User chose the default",
        decisionRef: "chat://defaults"
      }]
    },
    ...overrides
  };
}

function compile(overrides) {
  const result = normalizeSemanticDraft(draft(overrides), slugify);
  assert.deepEqual(result.issues, []);
  return result.draft;
}

test("settled intake answers become durable decisions a validator accepts", () => {
  const compiled = compile();
  assert.ok(draftNeedsDesign(compiled));
  const design = renderDraftDesign(compiled);
  assert.match(design, /## Decisions[\s\S]*DEC-STACK[\s\S]*Context:\*\* Which stack\?/);
  assert.match(design, /\*\*Decision:\*\* Vite \+ React/);
  assert.match(design, /\*\*Rejected:\*\* Plain HTML/);
  assert.match(design, /\*\*Decided by:\*\* user/);
  assert.match(design, /\*\*Decision ref:\*\* chat:\/\/defaults/);
  assert.doesNotMatch(design, /Supersedes/);
  assert.deepEqual(durableDecisionMetadataIssues(design), []);
});

test("design omits placeholder sections and fills the file map task column", () => {
  const design = renderDraftDesign(compile());
  for (const placeholder of ["## Current state", "## Domain language", "## Risks",
    "## Compatibility and migration", "| none | none | none |", "`none`"])
    assert.ok(!design.includes(placeholder), `unexpected ${placeholder}`);
  assert.match(design, /\| src\/board\/reducer\.ts \| added \| State \| T001 \|/);
  assert.match(design, /\| tsconfig\.json \| added \| Config \| T002 \|/);
  // Tasks live in tasks.md only; the derived tree sits inside the file map.
  assert.doesNotMatch(design, /## Plan/);
  assert.match(design, /## File map[\s\S]*`\+` add[\s\S]*```text[\s\S]*reducer\.ts/);
  // A design with no decisions at all is valid, not a missing section.
  assert.deepEqual(durableDecisionMetadataIssues("# Design\n\n## Risks\n"), []);
});

test("proposal leads with summary, stories, criteria, and a capability index", () => {
  const compiled = compile({
    summary: "ผู้ใช้จัดการการ์ดบนบอร์ดได้",
    why: "Work items are lost without one shared board",
    userStories: [
      { priority: "P2", story: "As a user, I want cards kept after reload.", covers: ["persist"] },
      { priority: "P1", asA: "a user", iWant: "to add and move cards", soThat: "I track work",
        covers: ["add-card", "move-card"], test: "Add a card and drag it" }
    ],
    successCriteria: ["A card is added in under 3 actions", { criterion: "Reload keeps cards", measure: "100% of cards" }]
  });
  const proposal = renderDraftProposal(compiled, { intent: compiled.intent });
  const order = ["## Summary", "## Why", "## User stories", "## Success criteria",
    "## Capabilities", "## Scope", "## Acceptance traceability", "## Definition of done",
    "## Appendix: discovery coverage"].map((heading) =>
    proposal.indexOf(heading));
  assert.ok(order.every((index, position) => index > (order[position - 1] ?? -1)), proposal);
  assert.ok(proposal.indexOf("**P1**") < proposal.indexOf("**P2**"));
  assert.match(proposal, /As a user, I want to add and move cards so that I track work\. Requirements: add-card, move-card\./);
  assert.match(proposal, /Independent check: Add a card and drag it/);
  assert.match(proposal, /Reload keeps cards \(100% of cards\)/);
  assert.match(proposal, /\| board \| .+ \| T001 \|/);
  assert.match(proposal, /\| storage \| .+ \| T002 \|/);
  assert.match(proposal, /Security triggers:\*\* none detected/);
  assert.doesNotMatch(proposal, /## Non-goals/);
  // The appendix drops `none` rationale instead of repeating it.
  assert.match(proposal, /\| compatibility \| covered \| add-card \| {2}\| {2}\|/);
});

test("the appendix marks coverage the harness derived from the draft", () => {
  const compiled = compile({
    impact: "high", compatibility: "Boards saved before this change still load",
    discovery: {
      coverage: [...DIMENSIONS.filter((dimension) => dimension !== "compatibility"), "operability"]
        .map((dimension) => ({ dimension, status: "covered", covers: ["add-card"] })),
      decisions: []
    }
  });
  const proposal = renderDraftProposal(compiled, { intent: compiled.intent });
  assert.match(proposal, /\| compatibility \| covered \(derived\) \| {2}\| {2}\| Derived from compatibility \|/);
  assert.match(proposal, /\| current-behavior \| covered \| add-card \| {2}\| {2}\|/);
  // 'why' already leads the proposal, so a missing summary is not prompted.
  const warnings = readerGuideWarnings({ ...compiled, summary: undefined, why: "Cards get lost" });
  assert.equal(warnings.some((warning) => /summary/.test(warning)), false);
});

test("long appendix lists are counted instead of dumped", () => {
  const keys = Array.from({ length: 9 }, (_, index) => `req-${index}`);
  const compiled = compile({
    requirements: keys.map((key) => ({ key, capability: "board",
      scenarios: [{ name: `Case ${key}`, when: "s" }], outcome: "o" })),
    tasks: [{ key: "all", outcome: "All", covers: keys, paths: ["src/**"], verify: "npm test" }],
    evidence: Object.fromEntries(keys.map((key) => [key, { capabilities: ["test"] }])),
    fileMap: undefined,
    discovery: {
      coverage: DIMENSIONS.map((dimension) => ({ dimension, status: "covered", covers: keys })),
      decisions: []
    }
  });
  const proposal = renderDraftProposal(compiled, { intent: compiled.intent });
  assert.match(proposal, /9: req-0, req-1, req-2, req-3, req-4, req-5, … \+3 more/);
});

test("reader fields are shape-checked and missing guidance only warns", () => {
  const bad = normalizeSemanticDraft(draft({
    userStories: [{ priority: "P7", covers: ["missing"] }],
    successCriteria: "fast",
    diagram: { title: "no source" }
  }), slugify);
  assert.ok(bad.issues.some((issue) => /userStories\[0\] needs story/.test(issue)));
  assert.ok(bad.issues.some((issue) => /priority must be P1\|P2\|P3/.test(issue)));
  assert.ok(bad.issues.some((issue) => /unknown requirement\(s\): missing/.test(issue)));
  assert.ok(bad.issues.some((issue) => /successCriteria must be an array/.test(issue)));
  assert.ok(bad.issues.some((issue) => /diagram needs Mermaid source/.test(issue)));
  const warnings = readerGuideWarnings({ ...compile(), summary: undefined });
  assert.ok(warnings.some((warning) => /summary/.test(warning)));
  assert.ok(warnings.some((warning) => /userStories/.test(warning)));
  assert.ok(warnings.some((warning) => /successCriteria/.test(warning)));
  assert.ok(warnings.some((warning) => /currentState/.test(warning)));
  assert.deepEqual(readerGuideWarnings({ ...compile(), version: 3 }), []);
  // A small rapid-lane draft gets no reader scaffolding prompts.
  const tiny = readerGuideWarnings({ ...compile(), impact: "low", fileMap: [] });
  assert.equal(tiny.some((warning) => /summary|userStories|successCriteria/.test(warning)), false);
});

test("assumptions, open questions, and the overview diagram render in design", () => {
  const compiled = compile({
    assumptions: ["One browser per user"],
    openQuestions: [{ question: "Keep deleted cards?", owner: "user" }],
    diagram: { purpose: "Data flow", source: "graph LR\n  UI --> Store" }
  });
  const design = renderDraftDesign(compiled);
  assert.match(design, /## Overview\n\nData flow\n\n```mermaid\ngraph LR\n {2}UI --> Store\n```/);
  assert.match(design, /### Assumptions\n\n- One browser per user/);
  assert.match(design, /### Open questions\n\n- Keep deleted cards\? \(owner: user\)/);
  assert.deepEqual(openQuestionItems(design), ["Keep deleted cards? (owner: user)"]);
  assert.deepEqual(openQuestionItems("# Design\n\n### Assumptions\n\n- x\n"), []);
});

test("file map keeps an explicit task column", () => {
  assert.deepEqual(fileMapWithTasks([{ path: "a.ts", tasks: ["T009"] }],
    [{ id: "T001", paths: ["a.ts"] }]), [{ path: "a.ts", tasks: ["T009"] }]);
  assert.deepEqual(fileMapWithTasks([{ path: "src/x" }], [{ id: "T001", paths: ["src/**"] }]),
    [{ path: "src/x", tasks: ["T001"] }]);
  assert.deepEqual(fileMapWithTasks([{ path: "lib/**" }], [{ id: "T001", paths: ["lib/a.ts"] }]),
    [{ path: "lib/**", tasks: ["T001"] }]);
});

// ---- Packet overview: header, scope, acceptance table, definition of done ----

const scenario = (when, then, kind) => ({ when, then, ...(kind ? { kind } : {}) });

function rapidCompiled({ requirements, tasks, ...rest } = {}) {
  const value = {
    intent: "Format money",
    requirements: requirements || [
      { description: "The system SHALL round half up", scenarios: [scenario("a total ends in 5", "it rounds up", "success"),
        scenario("a total is invalid", "an error is returned", "failure")] },
      { description: "The system SHALL keep two decimals", scenarios: [scenario("a total is whole", "two zeros are shown")] }],
    tasks: tasks || [
      { outcome: "Round totals", paths: ["src/money.js", "test/money.test.js"], verify: "npm test", covers: ["round-half-up"] },
      { outcome: "Pad decimals", paths: ["src/pad.js"], verify: "npm test", covers: ["keep-two-decimals"] }],
    ...rest
  };
  const result = normalizeSemanticDraft(expandMinimalSemanticDraft(value), slugify, { defaultRapidEvidence: true });
  assert.deepEqual(result.issues, []);
  return result.draft;
}

const RAPID = { schema: "foundation-rapid", id: "format-money", createdAt: "2026-10-07T01:00:00.000Z", intent: "Format money" };

test("every proposal states id, lane and its reason, owner, created date, and status", () => {
  const compiled = rapidCompiled();
  const rapid = renderDraftProposal(compiled, RAPID);
  assert.match(rapid, /^- \*\*Change:\*\* `format-money` · \*\*Lane:\*\* rapid \(low risk; see Impact\)$/m);
  assert.match(rapid, /^- \*\*Owner:\*\* unassigned · \*\*Created:\*\* 2026-10-07 · \*\*Status:\*\* `claude-foundation changes`$/m);
  const standard = renderDraftProposal({ ...compiled, impact: "medium", securityTriggers: ["authentication"] },
    { ...RAPID, schema: "foundation-standard" });
  assert.match(standard, /\*\*Lane:\*\* standard \(impact or coupling above the rapid limit \(see Impact\); security triggers: authentication\)/);
  // A fact the harness does not hold is left out, never invented.
  const bare = renderDraftProposal(compiled, { intent: "x" });
  assert.doesNotMatch(bare, /\*\*Created:\*\*|\*\*Lane:\*\*|\*\*Change:\*\*/);
  assert.match(bare, /\*\*Owner:\*\* unassigned/);
});

test("the acceptance table has one row per claim linking requirement, kind, task, and test files", () => {
  const compiled = rapidCompiled();
  const proposal = renderDraftProposal(compiled, RAPID);
  const table = proposal.split("## Acceptance traceability")[1].split("\n## ")[0];
  const rows = table.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Requirement"));
  assert.equal(rows.length, compiled.claims.length);
  for (const claim of compiled.claims) {
    const taskIds = compiled.tasks.filter((task) => task.claims.includes(claim.id)).map((task) => task.id);
    const row = rows.find((line) => line.startsWith(`| ${claim.requirementKey}`) &&
      (claim.id === claim.requirementKey || line.includes(`› ${claim.id.slice(claim.requirementKey.length + 1)} |`)));
    assert.ok(row, claim.id);
    assert.ok(row.includes(` | ${taskIds.join(", ")} | `), row);
  }
  assert.match(proposal, /\| round-half-up › a-total-ends-in-5 \| happy \| T001 \| test\/money\.test\.js \|/);
  assert.match(proposal, /\| round-half-up › a-total-is-invalid \| failure \| T001 \| test\/money\.test\.js \|/);
  // Unclassified stays unclassified; no test path is invented for a task without one.
  assert.match(proposal, /\| keep-two-decimals \| unclassified \| T002 \| — \|/);
  // Scenario text is referenced by id, never copied into the table.
  assert.doesNotMatch(table, /rounds up|two zeros/);
});

test("out of scope is derived from enforced boundaries and is never empty or invented", () => {
  const compiled = rapidCompiled();
  const proposal = renderDraftProposal(compiled, RAPID, { unselectedRepositories: ["billing"] });
  assert.match(proposal, /^- \*\*Out of scope:\*\* edits outside `src\/money\.js`, `test\/money\.test\.js`, `src\/pad\.js`; repositories not selected: billing$/m);
  // Authored non-goals keep their own section and Scope points at it once.
  const goals = renderDraftProposal({ ...compiled, nonGoals: ["No rounding modes"] }, RAPID);
  assert.match(goals, /the authored Non-goals below/);
  assert.equal(goals.split("No rounding modes").length - 1, 1);
  // No task paths, no non-goals, no repositories: no Out of scope line at all.
  const none = renderDraftProposal({ ...compiled, tasks: compiled.tasks.map((task) => ({ ...task, paths: [] })) }, RAPID);
  assert.doesNotMatch(none, /Out of scope/);
  assert.match(none, /^## Scope\n\n- \*\*In scope/m);
  const empty = renderDraftProposal({ ...compiled, changes: [], specs: [], tasks: [] }, RAPID);
  assert.doesNotMatch(empty, /## Scope/);
});

test("the definition of done states only what the policy enforces, per lane", () => {
  const compiled = rapidCompiled();
  const label = (state) => reviewRouteLabel({
    reviewPolicy: "risk-tiered", lowRiskModel: "fast",
    state: { ...RAPID, impact: "low", coupling: "isolated", ...state }, claims: compiled.claims
  });
  const quiet = label({});
  const dod = (draft, reviewLabel) => renderDraftProposal(draft, RAPID, { reviewLabel })
    .split("## Definition of done\n\n")[1].split("\n\n")[0];
  const quietDone = dod(compiled, quiet);
  assert.match(quietDone, /Review: not required \(rapid lane, low tier: deterministic evidence only\)\./);
  assert.doesNotMatch(quietDone, /risk-tiered AI review/);
  assert.match(quietDone, /Changed tests fail on the original code\./);
  assert.match(quietDone, /Land archives it; Land never commits\./);
  assert.ok(quietDone.split("\n").length <= 6);
  // Standard or security work is reviewed, and the line is the policy's own label.
  const secure = label({ schema: "foundation-standard", securityTriggers: ["authentication"], impact: "medium" });
  assert.match(secure, /^risk-tiered AI review \(high tier/);
  const secureDone = dod({ ...compiled, securityTriggers: ["authentication"] }, secure);
  assert.ok(secureDone.includes(`Review: ${secure}.`));
  // Behavior-neutral work owes no failing-on-original test; a missing label owes no review line.
  const docs = rapidCompiled({ workType: ["docs"], requirements: [
    { description: "The system SHALL explain rounding", scenarios: [scenario("a reader opens the page", "rounding is explained")] }],
  tasks: [{ outcome: "Words", paths: ["docs/a.md"], verify: "node check.mjs", covers: ["explain-rounding"] }] });
  assert.doesNotMatch(dod(docs, quiet), /Changed tests fail/);
  assert.doesNotMatch(renderDraftProposal(compiled, RAPID), /Review:/);
  // Acceptance is listed only when the draft requires it.
  assert.doesNotMatch(quietDone, /User acceptance/);
  assert.match(dod({ ...compiled, acceptance: { required: true, claimIds: [] } }, secure), /User acceptance is recorded\./);
});

test("the success line is the authored measure, a pointer to authored criteria, or the plain default", () => {
  const compiled = rapidCompiled();
  assert.match(renderDraftProposal({ ...compiled, successMeasure: "Totals match the ledger to the cent" }, RAPID),
    /^- Success: Totals match the ledger to the cent\.$/m);
  assert.match(renderDraftProposal({ ...compiled, successCriteria: ["Under 3 clicks"] }, RAPID),
    /^- Success: the Success criteria above hold\.$/m);
  assert.match(renderDraftProposal(compiled, RAPID), /^- Success: acceptance scenarios above pass\.$/m);
  const bad = normalizeSemanticDraft({ version: 4, intent: "x", successMeasure: 5 }, slugify);
  assert.equal(bad.issues.filter((issue) => /successMeasure/.test(issue)).length, 1);
});

test("coverage notes are advisory and read only what the scenarios say", () => {
  const compiled = rapidCompiled({ requirements: [
    { description: "The system SHALL round half up", scenarios: [scenario("a total ends in 5", "it rounds up", "success")] }],
  tasks: [{ outcome: "Round", paths: ["src/money.js"], verify: "npm test", covers: ["round-half-up"] }] });
  assert.equal(coverageNoteLine(compiled), "coverage (advisory, no repair needed): no failure scenario; " +
    "no edge/boundary scenario; no success measure stated (optional 'successMeasure')");
  assert.equal(coverageNoteLine({ ...compiled, successMeasure: "ok" }).includes("success measure"), false);
  // Failure inferred from a scenario's own words, and a boundary read from its text, silence the notes.
  const signalled = rapidCompiled({ successMeasure: "ok", requirements: [
    { description: "The system SHALL round half up", scenarios: [scenario("a total ends in 5", "it rounds up"),
      scenario("the total is invalid", "an error is returned"), scenario("the total is empty", "zero is shown")] }],
  tasks: [{ outcome: "Round", paths: ["src/money.js"], verify: "npm test", covers: ["round-half-up"] }] });
  assert.equal(coverageNoteLine(signalled), "");
  // Docs work owes no failure or boundary scenario.
  const docs = rapidCompiled({ workType: ["docs"], successMeasure: "ok", requirements: [
    { description: "The system SHALL explain rounding", scenarios: [scenario("a reader opens the page", "rounding is explained")] }],
  tasks: [{ outcome: "Words", paths: ["docs/a.md"], verify: "node check.mjs", covers: ["explain-rounding"] }] });
  assert.equal(coverageNoteLine(docs), "");
});

test("resolve keeps the lane and review line current and leaves an older layout untouched", () => {
  const proposal = renderDraftProposal(rapidCompiled(), RAPID, { reviewLabel: "not required (x)" });
  const upgraded = synchronizeProposalClassification(proposal,
    { impact: "medium", coupling: "isolated", upgradedFrom: "foundation-rapid" },
    { reviewLabel: "risk-tiered AI review (medium tier, fast model)" });
  assert.match(upgraded, /\*\*Lane:\*\* standard \(upgraded from rapid at resolve; see Impact\)/);
  assert.match(upgraded, /^- Review: risk-tiered AI review \(medium tier, fast model\)\.$/m);
  assert.match(upgraded, /^- \*\*Impact:\*\* medium$/m);
  assert.equal(upgraded.split("- Review:").length, 2);
  const older = "# Change: x\n\n## What changes\n\n- a\n\n## Plan\n\n| T |\n\n## Impact\n\n- **Impact:** low\n- **Coupling:** isolated\n";
  assert.equal(synchronizeProposalClassification(older, { impact: "low", coupling: "isolated" },
    { reviewLabel: "required" }), older);
});

test("a typical rapid proposal stays compact and design.md has no plan, impact, or duplicate tree", () => {
  const proposal = renderDraftProposal(rapidCompiled(), RAPID, { reviewLabel: "not required (x)" });
  assert.ok(proposal.split("\n").length <= 40, `${proposal.split("\n").length} lines`);
  for (const heading of ["## Plan", "## What changes", "## Folder tree", "## Non-goals"])
    assert.ok(!proposal.includes(heading), heading);
  const design = renderDraftDesign(compile());
  for (const absent of ["## Plan", "## Folder tree", "## Impact", "**Coupling:**", "**Security triggers:**"])
    assert.ok(!design.includes(absent), absent);
  assert.equal(design.split("```text").length - 1, 1);
});
