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
  derivedByHarness, derivedFailureMatrix, derivedFileMap, derivedTestMap, devDocumentIssues, devDocumentShapeIssues,
  docsOnlyDraft, inferWorkTypes,
  mermaidLabelIssues, renderComponentMap, renderFileTree, renderUserFlow,
  requiredDevSections, withNewPaths
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
    ["why", "failureMatrix", "userFlow", "uiStates", "componentMap"]);
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
  const tree = renderFileTree(value);
  // The tree has no heading of its own: it renders inside design.md's file map.
  assert.doesNotMatch(tree, /^## /);
  assert.match(tree, /└── src\/\n {4}├── ~ board\/\n {4}│ {3}└── \+ Board\.tsx/);
  assert.match(tree, /- legacy\.js/);
  assert.match(tree, /~ store\.ts/);

  assert.deepEqual(derivedFileMap({ tasks: value.tasks }).map((row) => [row.path, row.tasks]),
    [["src/board/", ["T001"]], ["src/store.ts", ["T002"]]]);
  assert.deepEqual(derivedTestMap(value).map((row) => [row.scenario, row.task]),
    [["add-card", "T001"], ["Store", "T002"]]);
  assert.match(renderUserFlow(value), /## User flow\n\nAdd a card\n\n```mermaid\nflowchart LR/);
  assert.match(renderComponentMap(value), /\| Board \| Shows cards \| src\/board\/Board\.tsx \| T001 \|/);
  assert.equal(renderFileTree({}), "");
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
  const order = ["## Summary", "## Scope", "## User flow", "## Failure matrix",
    "## Definition of done", "## Impact"].map((heading) => proposal.indexOf(heading));
  assert.ok(order.every((index, position) => index > (order[position - 1] ?? -1)), proposal);
  // Plan, What changes, and Folder tree have one home each elsewhere.
  for (const heading of ["## Plan", "## What changes", "## Folder tree"])
    assert.ok(!proposal.includes(heading), heading);
  assert.equal(semanticDraftKeepsDesign(value, true), false);
  const standard = renderDraftProposal(value, { schema: "foundation-standard" });
  assert.ok(!standard.includes("## Plan") && !standard.includes("## User flow") &&
    !standard.includes("## Folder tree"));
});

// Each fact is written once: failure scenarios fill the failure matrix, and
// 'why' gives the reader the lead a separate summary would only repeat.
test("an unclassified scenario that states a rejection fills the matrix; a classified one is never reread", () => {
  const base = { version: 4, intent: "Add notes", tasks: [{ key: "t", paths: ["src/notes.js"] }] };
  const scenarios = [
    { when: "a note is created", then: "201 returns the note" },
    { when: "the title is blank", then: "400 names the field" },
    { when: "the id is unknown", then: "the service refuses it with not found" },
    { when: "a note is deleted", then: "204 and a later read returns 404" }
  ];
  const value = { ...base, requirements: [{ key: "notes", scenarios }] };
  assert.deepEqual(derivedFailureMatrix(value).map((row) => row.failure),
    ["the title is blank", "the id is unknown"]);
  assert.deepEqual(devDocumentIssues(value), []);
  assert.match(derivedByHarness(value).join("\n"),
    /Why:.*intent[\s\S]*Failure matrix:.*rejection or error \(2\)/);
  // An explicit kind wins: a success or boundary scenario is never second-guessed,
  // and authored failure scenarios replace the word-based fallback.
  const classified = { ...base, requirements: [{ key: "notes", scenarios: [
    { kind: "success", when: "a note is created", then: "201 returns it, no error shown" },
    { kind: "failure", name: "Blank", when: "the title is blank", then: "400 names the field" },
    { when: "the id is unknown", then: "404 not found" }
  ] }] };
  assert.deepEqual(derivedFailureMatrix(classified).map((row) => row.failure), ["Blank"]);
  assert.match(derivedByHarness(classified).join("\n"), /read from the failure scenarios/);
  // Nothing to read from means the agent is still asked, never an invented row.
  const none = { ...base, requirements: [{ key: "notes",
    scenarios: [{ when: "a note is created", then: "201 returns the note" }] }] };
  assert.deepEqual(derivedFailureMatrix(none), []);
  assert.match(devDocumentIssues(none).join("\n"), /needs 'failureMatrix'.*"kind": "failure"/);
  // Authored text is never noted as derived, and the rapid lane records nothing.
  const authored = { ...value, why: "Notes persist", failureMatrix: [{ failure: "f", userSees: "u", recovery: "r" }] };
  assert.deepEqual(derivedByHarness(authored), []);
  assert.deepEqual(derivedByHarness(value, { standard: false }), []);
});

test("the dev document fills its failure matrix and lead from facts already written", () => {
  const value = {
    version: 4, why: "Users can add two numbers without a calculator.",
    tasks: [{ key: "t", paths: ["src/sum.js"], verify: "npm test" }],
    requirements: [{ key: "sum", scenarios: [
      { name: "Two numbers", kind: "success", when: "2 and 3 are given", then: "5 is shown" },
      { name: "Non-number", kind: "failure", when: "a letter is given", then: "an error is shown",
        recovery: "Re-enter a number" },
      { name: "Overflow", kind: "failure", when: "a huge value is given", then: "a limit message is shown" }
    ] }]
  };
  assert.deepEqual(devDocumentIssues(value), []);
  assert.deepEqual(derivedFailureMatrix(value), [
    { failure: "Non-number", userSees: "an error is shown", recovery: "Re-enter a number", covers: ["sum"] },
    { failure: "Overflow", userSees: "a limit message is shown",
      recovery: "No separate step; the outcome is the handling", covers: ["sum"] }
  ]);
  const authored = [{ failure: "Disk full", userSees: "Banner", recovery: "Free space" }];
  assert.equal(derivedFailureMatrix({ ...value, failureMatrix: authored }), authored);
  // Without failure scenarios or a matrix, and without why or summary, both are asked.
  const bare = { ...value, why: "", requirements: [{ key: "sum", scenarios: [{ when: "w", then: "t" }] }] };
  assert.deepEqual(devDocumentIssues(bare).map((issue) => issue.match(/needs '(\w+)'/)[1]),
    ["why", "failureMatrix"]);
  assert.deepEqual(devDocumentIssues({ ...bare, summary: "s", failureMatrix: authored }), []);

  const design = renderDraftDesign({ ...value, workType: ["feature"], tasks: [] });
  assert.match(design, /## Failure matrix[\s\S]*\| Non-number \| an error is shown \| Re-enter a number \| sum \|/);
  const proposal = renderDraftProposal({ ...value, _semanticVersion: 4, claims: [], changes: [],
    tasks: [{ id: "T001", outcome: "Sum", paths: ["src/sum.js"], verify: "npm test" }] },
  { schema: "foundation-rapid" });
  assert.match(proposal, /## Failure matrix[\s\S]*\| Overflow \|/);
});

// Dogfooding a disposable consumer: new files showed `~`, the tree had no root.
test("task paths missing at the base read as additions in the tree and file map", () => {
  const value = { tasks: [{ id: "T001", outcome: "Sum", paths: ["src/sum.js", "src/index.js", "lib/**"] }] };
  const documented = withNewPaths(value, (path) => path === "src/index.js");
  assert.deepEqual([...documented._newPaths].sort(), ["lib/", "src/sum.js"]);
  assert.match(renderFileTree(documented),
    /```text\n\.\n├── \+ lib\/\n└── src\/\n {4}├── ~ index\.js\n {4}└── \+ sum\.js/);
  assert.deepEqual(derivedFileMap(documented).map((row) => [row.path, row.change]),
    [["src/sum.js", "add"], ["src/index.js", "change"], ["lib/", "add"]]);
  // An authored delete keeps `-`; another repository's path stays a change.
  assert.match(renderFileTree({ ...documented, fileMap: [{ path: "src/sum.js", change: "delete" }] }),
    /- sum\.js/);
  assert.equal(withNewPaths({ tasks: [{ repository: "api", paths: ["x.js"] }] }, () => false)._newPaths,
    undefined);
});

test("descriptive dev-document sections keep a small low-risk draft rapid", () => {
  const base = { _semanticVersion: 4, title: "Limit", changes: ["Limit"], claims: [],
    tasks: [{ id: "T001", outcome: "Limit", paths: ["src/config.ts"], verify: "npm test" }] };
  const descriptive = {
    fileMap: [{ path: "src/config.ts", change: "modify", responsibility: "Limit" }],
    configContract: [{ key: "LIMIT", default: "10", validation: "1-100" }],
    refactor: { invariants: ["Same output"], characterization: "npm test" },
    componentMap: [{ component: "Config", responsibility: "Reads LIMIT", files: ["src/config.ts"] }],
    testMap: [{ scenario: "Limit", level: "unit", file: "test/config.test.ts", task: "T001" }],
    userFlow: "flowchart LR\n  A --> B"
  };
  for (const [key, section] of Object.entries(descriptive))
    assert.equal(semanticDraftKeepsDesign({ ...base, [key]: section }, true), false, key);
  // A contract still earns design.md; risk-based lane selection is unchanged.
  assert.equal(semanticDraftKeepsDesign({ ...base, apiContracts: COMPLETE.apiContracts }, true), true);
  const proposal = renderDraftProposal({ ...base, ...descriptive }, { schema: "foundation-rapid" });
  for (const heading of ["## Component map", "## Refactor invariants", "## Config contract",
    "## File map", "## Test map"]) assert.ok(proposal.includes(heading), heading);
});

test("refactor, config, and docs work owe no failure matrix; behavior work still does", () => {
  const typed = (...workType) => ({ version: 4, workType, tasks: [{ key: "t", paths: ["src/a.ts"] }] });
  assert.deepEqual(requiredDevSections(typed("refactor")), ["summary", "refactor", "componentMap"]);
  assert.deepEqual(requiredDevSections(typed("config")), ["summary", "configContract"]);
  assert.deepEqual(requiredDevSections(typed("refactor", "config")),
    ["summary", "refactor", "componentMap", "configContract"]);
  assert.deepEqual(requiredDevSections(typed("docs")), ["summary"]);
  // Inferred config paths behave like a declared config change.
  assert.deepEqual(requiredDevSections({ version: 4, tasks: [{ key: "t", paths: ["src/config.ts"] }] }),
    ["summary", "configContract"]);
  for (const types of [["bugfix"], ["refactor", "api"], ["config", "feature"]])
    assert.ok(requiredDevSections(typed(...types)).includes("failureMatrix"), types.join(","));
  assert.deepEqual(devDocumentIssues({ ...typed("refactor"), why: "Split the parser",
    refactor: { invariants: ["Same output"], characterization: "npm test" },
    componentMap: [{ component: "Parser", responsibility: "Parses" }] }), []);
});

test("a bugfix section keeps a small low-risk draft rapid and renders in its proposal", () => {
  const base = { _semanticVersion: 4, title: "Fix", changes: ["Fix"], claims: [],
    tasks: [{ id: "T001", outcome: "Fix", paths: ["src/sum.js"], verify: "npm test" }] };
  const bugfix = { reproduction: "sum([]) throws", rootCause: "No empty guard",
    regression: "test/sum.test.js covers []" };
  assert.equal(semanticDraftKeepsDesign({ ...base, workType: ["bugfix"], bugfix }, true), false);
  assert.match(renderDraftProposal({ ...base, bugfix }, { schema: "foundation-rapid" }),
    /## Bugfix analysis\n\n- \*\*Reproduction:\*\* sum\(\[\]\) throws/);
  // Risk, not the section, still decides the lane.
  assert.equal(semanticDraftKeepsDesign({ ...base, bugfix, dataModel: [{ entity: "Sum" }] }, true), true);
});

test("only declared docs-only work that adds requirements skips the delta spec", () => {
  const added = [{ name: "readme", operation: "added" }];
  assert.equal(docsOnlyDraft({ workType: ["docs"], specs: added }), true);
  assert.equal(docsOnlyDraft({ workType: ["docs"], specs: [{ name: "readme" }] }), true);
  assert.equal(docsOnlyDraft({ workType: ["docs", "feature"], specs: added }), false);
  assert.equal(docsOnlyDraft({ workType: ["docs"], specs: [{ name: "readme", operation: "modified" }] }),
    false);
  // A markdown path alone may be product behavior (a prompt or a skill).
  assert.equal(docsOnlyDraft({ tasks: [{ paths: ["README.md"] }], specs: added }), false);
  assert.match(renderDraftProposal({ _semanticVersion: 4, workType: ["docs"], specs: added, changes: ["Reword"],
    tasks: [] }, { schema: "foundation-rapid" }), /- \*\*Specs:\*\* none; docs-only work modifies no living spec/);
  assert.doesNotMatch(renderDraftProposal({ _semanticVersion: 4, workType: ["docs"], specs: added,
    changes: ["Reword"], tasks: [] }, { schema: "foundation-standard" }), /\*\*Specs:\*\*/);
});

test("an unquoted parenthesis or quote in a flowchart node label is a draft shape issue", () => {
  assert.deepEqual(mermaidLabelIssues("flowchart LR\n  A[mean(values)] --> B{ok?}", "userFlow"), [
    "semantic draft userFlow node label 'A[mean(values)]' has an unquoted ( ) or \"; " +
    "quote it: A[\"mean(values)\"]"
  ]);
  for (const ok of ["A[\"mean(values)\"] --> B", "A[(Database)] --> B([Stadium])", "A{{Hex}} --> B"])
    assert.deepEqual(mermaidLabelIssues(`flowchart LR\n  ${ok}`, "userFlow"), [], ok);
  assert.deepEqual(mermaidLabelIssues("sequenceDiagram\n  A->>B: f(x)", "diagram"), []);
  assert.equal(devDocumentShapeIssues({ diagram: { source: "graph TD\n  A[f(x)]" },
    diagrams: [{ type: "mermaid", source: "graph TD\n  B[say \"hi\"]" }] }).length, 2);
});

test("derived maps name scenarios and checks, and omit columns nobody supplied", () => {
  const value = {
    specs: [{ scenarios: [{ name: "Adds numbers" }, { name: "Rejects letters" }] }],
    _requirementKeys: ["sum"],
    claims: [{ id: "sum", requirementKey: "sum" }],
    tasks: [{ id: "T001", outcome: "Sum", paths: ["src/sum.js"], verify: "npm test", claims: ["sum"] }]
  };
  assert.deepEqual(derivedTestMap(value), [{ scenario: "Adds numbers; Rejects letters",
    level: "task check", check: "`npm test`", task: "T001" }]);
  const design = renderDesignBlueprints({ testMap: derivedTestMap(value),
    failureMatrix: [{ failure: "Letter", userSees: "Error", recovery: "Re-enter" }],
    apiContracts: [{ method: "GET", path: "/sum", auth: "none", request: "q", response: "n",
      errors: ["400 on letters"] }] });
  assert.match(design, /\| Scenario \| Level \| Check \| Task \|\n\|---\|---\|---\|---\|/);
  assert.match(design, /\| Failure \| User sees \| Recovery \|\n/);
  assert.ok(!design.includes("Idempotency") && !design.includes("Compatibility") && !design.includes("—"));
});

test("inferred work types are stated and overridable; light paths owe no failure matrix", () => {
  const paths = (...list) => ({ version: 4, tasks: [{ id: "T001", key: "t", paths: list }] });
  assert.deepEqual(inferWorkTypes(paths("app/routes/board.tsx")), ["ui"]);
  assert.deepEqual(inferWorkTypes(paths("app/routes/cards.ts")), ["api"]);
  assert.deepEqual(inferWorkTypes(paths("src/config.ts")), ["config"]);
  assert.deepEqual(inferWorkTypes(paths("config.yaml")), ["config"]);
  assert.deepEqual(inferWorkTypes(paths("test/sum.test.js")), ["test"]);
  assert.deepEqual(inferWorkTypes(paths("package.json")), ["chore"]);
  assert.deepEqual(inferWorkTypes(paths("src/sum.js", "tests/components/Sum.test.tsx")), ["code"]);
  assert.deepEqual(requiredDevSections(paths("test/sum.test.js", "package.json")), ["summary"]);
  assert.match(devDocumentIssues(paths("src/components/Board.tsx"))[0],
    /^dev document \(ui, inferred from paths; or declare workType to override\) needs/);
  assert.match(renderDraftDesign(paths("src/components/Board.tsx")),
    /^# Design\n\n## Work type\n\nui \(inferred from paths; declare workType to override\)/);
});

test("design.md reads flow, components, contracts, failures, file map (with its tree), then tests", () => {
  const design = renderDraftDesign({ ...draft(COMPLETE), userFlow: "flowchart LR\n  A --> B",
    componentMap: [{ component: "Import", responsibility: "Dialog" }],
    tasks: [{ id: "T001", outcome: "Import", paths: ["apps/editor/src/app/api/**"], verify: "npm test" }] });
  const order = ["## Work type", "## User flow", "## Component map", "## API contracts", "## UI states",
    "## Failure matrix", "## File map", "## Test map"].map((heading) => design.indexOf(heading));
  assert.ok(order.every((index, position) => index > (order[position - 1] ?? -1)), design);
  assert.ok(!design.includes("## Plan") && !design.includes("## Folder tree"));
  // The derived tree sits inside the file map, before the next section.
  assert.ok(design.indexOf("```text") > design.indexOf("## File map") &&
    design.indexOf("```text") < design.indexOf("## Test map"), design);
});
