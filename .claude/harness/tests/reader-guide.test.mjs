import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSemanticDraft } from "../runtime/workflow/semantic-draft.mjs";
import {
  draftNeedsDesign, renderDraftDesign, renderDraftProposal
} from "../runtime/workflow/change-lifecycle.mjs";
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
  assert.match(design, /## Plan[\s\S]*\| T002 \| Local storage \| src\/storage\.ts, tsconfig\*\.json \| `npm test` \| T001 \| persist \|/);
  assert.match(design, /```mermaid\ngraph TD\n {2}T001 --> T002\n```/);
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
    "## Capabilities", "## What changes", "## Appendix: discovery coverage"].map((heading) =>
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
