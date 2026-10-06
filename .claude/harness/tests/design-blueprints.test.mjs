import assert from "node:assert/strict";
import test from "node:test";
import {
  designBlueprintIssues, designBlueprintWarnings, lightweightDraft, renderDesignBlueprints,
  requiredBlueprints
} from "../runtime/workflow/validation/design-blueprints.mjs";
import {
  draftNeedsDesign, renderDraftDesign, renderDraftProposal, semanticDraftKeepsDesign
} from "../runtime/workflow/change-lifecycle.mjs";
import {
  derivedFileMap, derivedTestMap, devDocumentIssues, devDocumentShapeIssues, inferWorkTypes,
  renderComponentMap, renderFolderTree, renderPlan, renderUserFlow, requiredDevSections
} from "../runtime/workflow/validation/dev-document.mjs";

function draft(overrides = {}) {
  return {
    version: 4,
    workType: ["feature", "api", "ui"],
    impact: "medium",
    coupling: "isolated",
    tasks: [{ key: "api", paths: ["apps/editor/src/app/api/**"] }],
    ...overrides
  };
}

const COMPLETE = {
  fileMap: [{ path: "apps/editor/src/app/api/import/route.ts", change: "new",
    responsibility: "Create an import job", tasks: ["api"] }],
  failureMatrix: [{ failure: "Extractor times out", userSees: "Retry banner",
    recovery: "Job marked failed; user retries" }],
  testMap: [{ scenario: "timeout", level: "integration", task: "api",
    file: "apps/editor/src/app/api/import/route.test.ts" }],
  apiContracts: [{ method: "POST", path: "/api/import", auth: "internal session",
    request: { url: "string" }, response: { jobId: "string" },
    errors: [{ status: 400, when: "URL rejected by guard" }], idempotency: "none" }],
  uiStates: [{ screen: "Import dialog", accessibility: "focus trap, labelled input",
    states: [{ state: "loading", shows: "spinner" }, { state: "error", shows: "message" }] }]
};

// A consumer design.md listed four endpoints by path alone, with no request,
// response, or error contract, and every decision read "No consequence".
test("declared work types select the design sections a change needs", () => {
  assert.deepEqual(requiredBlueprints(draft()).sort(),
    ["apiContracts", "failureMatrix", "fileMap", "testMap", "uiStates"]);
  assert.deepEqual(requiredBlueprints(draft({ workType: ["docs"] })), []);
  assert.ok(requiredBlueprints(draft({ workType: ["async"], coupling: "coupled" }))
    .includes("diagrams"));
  assert.ok(requiredBlueprints(draft({ workType: ["bugfix"] })).includes("bugfix"));
});

test("missing or thin blueprints warn without blocking compilation", () => {
  // v3 is prompted here; a v4 draft's missing sections are dev document repairs.
  const warnings = designBlueprintWarnings(draft({ version: 3 }));
  for (const key of ["apiContracts", "uiStates", "fileMap", "failureMatrix", "testMap"])
    assert.ok(warnings.some((warning) => warning.includes(`'${key}'`)), key);
  assert.deepEqual(designBlueprintIssues(draft()), []);
  assert.deepEqual(designBlueprintWarnings(draft(COMPLETE)), []);

  const thin = designBlueprintWarnings(draft({ ...COMPLETE,
    apiContracts: [{ method: "GET", path: "/api/import/<id>" }],
    uiStates: [{ screen: "Review", accessibility: "labels", states: ["loading", "ready"] }],
    fileMap: [{ path: "packages/core/src/x.ts", change: "new", responsibility: "Logic" }],
    decisions: [{ key: "pin", choice: "Pin 0.36", reason: "PoC" }] }));
  assert.ok(thin.includes("apiContracts[0] is missing auth, request, response, errors"));
  assert.ok(thin.includes("apiContracts[0] contains placeholder text"));
  assert.ok(thin.includes("uiStates[0] has no error state"));
  assert.ok(thin.includes("fileMap[0] 'packages/core/src/x.ts' is outside every task's paths"));
  assert.ok(thin.includes("decisions[0] states no consequences"));

  assert.deepEqual(designBlueprintWarnings({ version: 4, impact: "medium" }), []);
  assert.deepEqual(designBlueprintWarnings(draft()), []);
  assert.deepEqual(designBlueprintWarnings({ version: 3 }), []);
});

// A headless E2E of a three-line rapid feature warned on every inspect that
// workType feature expects fileMap, failureMatrix, and testMap.
test("small rapid-lane drafts get no missing-section prompts", () => {
  const tiny = { version: 4, workType: ["feature"], impact: "low", coupling: "isolated",
    requirements: [{ key: "sum" }], tasks: [{ key: "sum", paths: ["src/sum.js"] }] };
  assert.equal(lightweightDraft(tiny), true);
  assert.deepEqual(designBlueprintWarnings(tiny), []);
  assert.deepEqual(designBlueprintWarnings({ ...tiny, workType: undefined }), []);
  // Authored sections are still checked.
  assert.deepEqual(designBlueprintWarnings({ ...tiny,
    fileMap: [{ path: "lib/x.js", change: "new", responsibility: "x" }] }),
  ["fileMap[0] 'lib/x.js' is outside every task's paths"]);
  // Risk, declared size, or breadth restores the prompts.
  const many = Array.from({ length: 4 }, (_, index) => ({ key: `k${index}` }));
  for (const override of [{ impact: "medium" }, { coupling: "coupled" },
    { securityTriggers: ["auth"] }, { reviewRequired: true },
    { acceptance: { required: true } }, { size: "m" },
    { requirements: many, tasks: many }]) {
    assert.equal(lightweightDraft({ ...tiny, ...override }), false, JSON.stringify(override));
    assert.ok(designBlueprintWarnings({ ...tiny, version: 3, ...override })
      .some((warning) => warning.includes("'fileMap'")), JSON.stringify(override));
  }
  assert.equal(lightweightDraft({ ...tiny, size: "s", requirements: many, tasks: many }), true);
  assert.equal(lightweightDraft({ ...tiny, securityTriggers: ["none"] }), true);
});

// A consumer plan kept every spec in a final test task: T006 changed card
// behavior but its spec belonged to T012, so Build refused the spec update.
test("a task must own the tests that verify the behavior it changes", () => {
  const tasks = [
    { key: "cards", paths: ["pages/campaign/**"],
      verify: "npx vitest run tests/unit/campaignPageCards.spec.js" },
    { key: "tests", paths: ["tests/**"], verify: "npx vitest run" }
  ];
  const warnings = designBlueprintWarnings(draft({ ...COMPLETE, tasks,
    fileMap: [], testMap: [{ scenario: "cards", level: "unit", task: "cards",
      file: "tests/unit/campaignPageCards.spec.js" }] }));
  assert.deepEqual(warnings.filter((warning) => warning.startsWith("task ")), [
    "task 'cards' verifies with 'tests/unit/campaignPageCards.spec.js' outside its paths " +
    "(owned by 'tests'); add it to the task that changes the behavior"
  ]);
  const owned = designBlueprintWarnings(draft({ ...COMPLETE, fileMap: [], tasks: [{
    ...tasks[0], paths: ["pages/campaign/**", "tests/unit/campaignPageCards.spec.js"] }] }));
  assert.equal(owned.some((warning) => warning.startsWith("task ")), false);
});

test("a typo in workType or a wrong section shape is a draft error", () => {
  assert.deepEqual(designBlueprintIssues(draft({ workType: ["apii"] })),
    ["semantic draft workType 'apii' is unknown; use feature|bugfix|refactor|api|ui|data|config|async|integration|chore|docs"]);
  assert.deepEqual(designBlueprintIssues(draft({ workType: [], apiContracts: {}, bugfix: [] })), [
    "semantic draft workType must be a non-empty array",
    "semantic draft apiContracts must be an array",
    "semantic draft bugfix must be an object"
  ]);
});

test("blueprints render into design.md and force its creation", () => {
  const value = { ...draft(COMPLETE), currentState: "none", compatibility: "none",
    decisions: [], risks: [], domainLanguage: [] };
  assert.equal(draftNeedsDesign(value), true);
  const design = renderDraftDesign(value);
  for (const heading of ["## Work type", "## File map", "## API contracts", "## UI states",
    "## Failure matrix", "## Test map"])
    assert.ok(design.includes(heading), heading);
  assert.match(design, /### POST \/api\/import/);
  assert.match(design, /- `400` URL rejected by guard/);
  assert.match(design, /\| error \| message \|/);
  // Placeholder sections are omitted instead of rendering `none`.
  assert.ok(!design.includes("## Domain language") && !design.includes("## Risks"));
  assert.equal(renderDesignBlueprints({ version: 4 }), "");
  assert.equal(draftNeedsDesign({ workType: ["docs"] }), false);
  assert.match(renderDraftDesign({ ...value, decisions: [{ choice: "a", reason: "b" }] }),
    /\*\*Consequences:\*\* Not stated in the draft/);
});

// A Change is a conversation that produces the document Build executes and a
// reviewer approves: what they get, what changes, and the plan to get there.
test("the dev document infers work type from paths and names missing sections", () => {
  const paths = (...list) => ({ version: 4, tasks: [{ key: "t", paths: list }] });
  assert.deepEqual(inferWorkTypes(paths("src/components/Board.tsx")), ["ui"]);
  assert.deepEqual(inferWorkTypes(paths("src/routes/cards.ts", "db/migrations/001.sql")),
    ["api", "data"]);
  assert.deepEqual(inferWorkTypes(paths("docs/guide.md", "README.md")), ["docs"]);
  assert.deepEqual(inferWorkTypes(paths("src/sum.js")), ["code"]);
  assert.deepEqual(inferWorkTypes({ ...paths("src/sum.js"), workType: ["bugfix"] }), ["bugfix"]);

  assert.deepEqual(requiredDevSections(paths("docs/guide.md")), ["summary"]);
  assert.deepEqual(requiredDevSections(paths("src/sum.js")), ["summary", "failureMatrix"]);
  assert.deepEqual(requiredDevSections(paths("src/components/Board.tsx")),
    ["summary", "failureMatrix", "userFlow", "uiStates", "componentMap"]);

  const ui = paths("src/components/Board.tsx");
  assert.deepEqual(devDocumentIssues(ui, { standard: false }), []);
  assert.deepEqual(devDocumentIssues({ ...ui, version: 3 }), []);
  assert.deepEqual(devDocumentIssues(ui).map((issue) => issue.match(/needs '(\w+)'/)[1]),
    ["summary", "failureMatrix", "userFlow", "uiStates", "componentMap"]);
  assert.deepEqual(devDocumentIssues({ ...ui, summary: "s",
    failureMatrix: [{ failure: "f" }], userFlow: "flowchart LR\n  A --> B",
    uiStates: [{ screen: "Board" }], componentMap: [{ component: "Board", responsibility: "r" }] }), []);

  assert.deepEqual(devDocumentShapeIssues({ userFlow: { purpose: "p" }, componentMap: [{}] }), [
    "semantic draft userFlow needs Mermaid source (a string or { purpose, source })",
    "semantic draft componentMap[0].component is required",
    "semantic draft componentMap[0].responsibility is required"
  ]);
});

test("the dev document derives its folder tree, plan, and maps from the tasks", () => {
  const value = {
    fileMap: [{ path: "src/board/Board.tsx", change: "new" },
      { path: "src/legacy.js", change: "delete" }],
    claims: [{ id: "add-card", requirementKey: "add-card" }],
    tasks: [
      { id: "T001", outcome: "Board UI", paths: ["src/board/**"], verify: "npm test -- board",
        claims: ["add-card"] },
      { id: "T002", outcome: "Store", paths: ["src/store.ts"], dependsOn: ["T001"], verify: "npm test" }
    ],
    componentMap: [{ component: "Board", responsibility: "Shows cards", files: ["src/board/Board.tsx"] }],
    userFlow: { purpose: "Add a card", source: "flowchart LR\n  A --> B" }
  };
  const tree = renderFolderTree(value);
  assert.match(tree, /^## Folder tree/);
  assert.match(tree, /└── src\/\n {4}├── ~ board\/\n {4}│ {3}└── \+ Board\.tsx/);
  assert.match(tree, /- legacy\.js/);
  assert.match(tree, /~ store\.ts/);

  const plan = renderPlan(value);
  assert.match(plan, /\| T001 \| Board UI \| src\/board\/\*\* \| `npm test -- board` \| — \| add-card \|/);
  assert.match(plan, /```mermaid\ngraph TD\n {2}T001 --> T002\n```/);

  assert.deepEqual(derivedFileMap({ tasks: value.tasks }).map((row) => [row.path, row.tasks]),
    [["src/board/", ["T001"]], ["src/store.ts", ["T002"]]]);
  assert.deepEqual(derivedTestMap(value).map((row) => [row.scenario, row.task]),
    [["add-card", "T001"], ["Store", "T002"]]);
  assert.match(renderUserFlow(value), /## User flow\n\nAdd a card\n\n```mermaid\nflowchart LR/);
  assert.match(renderComponentMap(value), /\| Board \| Shows cards \| src\/board\/Board\.tsx \| T001 \|/);
  assert.equal(renderFolderTree({}), "");
  assert.equal(renderPlan({}), "");
});

// A rapid change has no design.md: its compact dev document is the proposal.
test("a rapid proposal carries the compact dev document and keeps the rapid lane", () => {
  const value = {
    _semanticVersion: 4, title: "Sum", summary: "Users can add two numbers.",
    changes: ["Add a sum helper"], userFlow: "flowchart LR\n  A[Input] --> B[Sum]",
    failureMatrix: [{ failure: "Non-number input", userSees: "An error", recovery: "Re-enter" }],
    claims: [], tasks: [{ id: "T001", outcome: "Sum helper", paths: ["src/sum.js"], verify: "npm test" }]
  };
  const proposal = renderDraftProposal(value, { schema: "foundation-rapid" });
  const order = ["## Summary", "## User flow", "## What changes", "## Folder tree",
    "## Failure matrix", "## Plan", "## Impact"].map((heading) => proposal.indexOf(heading));
  assert.ok(order.every((index, position) => index > (order[position - 1] ?? -1)), proposal);
  assert.equal(semanticDraftKeepsDesign(value, true), false);
  const standard = renderDraftProposal(value, { schema: "foundation-standard" });
  assert.ok(standard.includes("## Folder tree"));
  assert.ok(!standard.includes("## Plan") && !standard.includes("## User flow"));
});
