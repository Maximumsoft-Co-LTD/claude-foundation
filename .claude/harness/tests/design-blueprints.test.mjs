import assert from "node:assert/strict";
import test from "node:test";
import {
  designBlueprintIssues, designBlueprintWarnings, renderDesignBlueprints, requiredBlueprints
} from "../runtime/workflow/validation/design-blueprints.mjs";
import { draftNeedsDesign, renderDraftDesign } from "../runtime/workflow/change-lifecycle.mjs";

function draft(overrides = {}) {
  return {
    version: 4,
    workType: ["feature", "api", "ui"],
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
  testMap: [{ scenario: "timeout", level: "integration", file: "route.test.ts" }],
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
  const warnings = designBlueprintWarnings(draft());
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

  assert.match(designBlueprintWarnings({ version: 4 })[0], /^declare workType/);
  assert.deepEqual(designBlueprintWarnings({ version: 3 }), []);
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
  assert.ok(design.indexOf("## File map") < design.indexOf("## Domain language"));
  assert.equal(renderDesignBlueprints({ version: 4 }), "");
  assert.equal(draftNeedsDesign({ workType: ["docs"] }), false);
  assert.match(renderDraftDesign({ ...value, decisions: [{ choice: "a", reason: "b" }] }),
    /\*\*Consequences:\*\* Not stated in the draft/);
});
