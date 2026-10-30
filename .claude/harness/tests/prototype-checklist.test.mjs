import assert from "node:assert/strict";
import test from "node:test";

import { WORK_TYPES } from "../runtime/contracts/work-types.mjs";
import {
  SURFACE_KEYS, SURFACE_ORDER, TYPE_SURFACES, checklistFor, checklistNoteLine, coverageReport, coversIssues
} from "../runtime/workflow/prototype-checklist.mjs";
import { scratchFieldIssues } from "../runtime/workflow/scratch-fields.mjs";

const keys = (items) => items.map((item) => item.key);

test("every work type in the catalog has surfaces, and a new type without a row fails here", () => {
  const missing = WORK_TYPES.filter((type) => !Array.isArray(TYPE_SURFACES[type]) || !TYPE_SURFACES[type].length);
  assert.deepEqual(missing, [], `work types without prototype surfaces: ${missing.join(", ")}`);
  // A row for a type that is not in the catalog is stale.
  assert.deepEqual(Object.keys(TYPE_SURFACES).filter((type) => !WORK_TYPES.includes(type)), []);
  assert.equal(Object.keys(TYPE_SURFACES).length, WORK_TYPES.length);
});

test("each of the 26 types lists at least one surface, each with its source, and always before and after", () => {
  assert.equal(WORK_TYPES.length, 26);
  for (const type of WORK_TYPES) {
    const items = checklistFor({ workType: [type] });
    assert.ok(items.length >= 1, `${type} has an empty list`);
    assert.ok(keys(items).includes("ba"), `${type} owes before and after`);
    for (const item of items) {
      assert.ok(SURFACE_KEYS.includes(item.key), `${type}: unknown surface ${item.key}`);
      assert.ok(item.source, `${type}/${item.key} names no source field`);
      assert.ok(item.label.th && item.label.en, `${type}/${item.key} lacks a label`);
    }
  }
});

test("an api change owes the API panel, the user path, failures with recovery, and before and after", () => {
  const draft = { workType: ["api"], apiContracts: [{ method: "POST", path: "/api/cards", errors: [{ status: 400 }] }] };
  const items = checklistFor(draft);
  assert.deepEqual(keys(items), ["flow", "api", "ba", "fail"]);
  assert.equal(items.find((item) => item.key === "api").source, "apiContracts");
  assert.equal(items.find((item) => item.key === "api").present, true);
});

test("a migration owes schema, release order, rollback, before and after, and failures", () => {
  const items = checklistFor({ workType: ["migration"], migrationPlan: { from: "a", to: "b" }, rollout: { strategy: "flag" } });
  assert.deepEqual(keys(items), ["schema", "rollout", "ba", "fail"]);
  assert.equal(items.find((item) => item.key === "rollout").present, true);
  assert.equal(items.find((item) => item.key === "schema").present, false, "no dataModel was declared");
});

test("a ui change owes every state of every screen", () => {
  const items = checklistFor({ workType: ["ui"], uiStates: [{ screen: "Board", states: [{ state: "loading" }] }] });
  assert.ok(keys(items).includes("states"));
  assert.equal(items.find((item) => item.key === "states").present, true);
});

test("several types give one ordered list with no duplicates, each surface naming its source", () => {
  const items = checklistFor({ workType: ["feature", "api", "data"] });
  assert.deepEqual(keys(items), ["flow", "api", "schema", "ba", "fail"]);
  assert.equal(new Set(keys(items)).size, items.length);
  assert.deepEqual(keys(items), SURFACE_ORDER.filter((key) => keys(items).includes(key)), "the order is the fixed one");
});

test("a surface the draft does not specify is reported as absent, with nothing invented", () => {
  const items = checklistFor({ workType: ["api"] });
  const api = items.find((item) => item.key === "api");
  assert.equal(api.present, false);
  assert.equal(api.source, "apiContracts");
});

test("docs-only work owes only before and after, and says nothing more", () => {
  const draft = { workType: ["docs"], scratch: { asIs: "a", toBe: "b" } };
  assert.deepEqual(keys(checklistFor(draft)), ["ba"]);
  assert.equal(checklistNoteLine(draft), "");
});

test("a draft with no work type still owes before and after", () => {
  assert.deepEqual(keys(checklistFor({})), ["ba"]);
});

test("coverage: no prototype, none declared, complete, and incomplete are told apart", () => {
  const base = { workType: ["ui"], uiStates: [{ screen: "s" }] };
  assert.equal(coverageReport(base).state, "none");
  assert.ok(coverageReport(base).items.every((item) => item.status === "none"));

  const noCovers = { ...base, examples: [{ type: "prototype", title: "p", path: "prototype.html" }] };
  const unknown = coverageReport(noCovers);
  assert.equal(unknown.state, "unknown");
  assert.ok(unknown.items.every((item) => item.status === "unknown"), "no covers means unknown, never complete");

  const all = { ...base, examples: [{ type: "prototype", title: "p", path: "prototype.html", covers: ["flow", "states", "ba", "fail"] }] };
  const complete = coverageReport(all);
  assert.equal(complete.state, "complete");
  assert.equal(complete.covered, complete.total);

  const some = { ...base, examples: [{ type: "prototype", title: "p", path: "prototype.html", covers: ["flow", "states", "ba"] }] };
  const partial = coverageReport(some);
  assert.equal(partial.state, "incomplete");
  assert.deepEqual(partial.items.filter((item) => item.status === "missing").map((item) => item.key), ["fail"]);
});

test("a declared coverage is the agent's claim and is marked advisory", () => {
  const draft = { workType: ["ui"], examples: [{ type: "prototype", title: "p", path: "p.html", covers: ["flow", "states", "ba", "fail"] }] };
  assert.equal(coverageReport(draft).advisory, true);
});

test("a covers key outside this change's surfaces names its path in one issue", () => {
  const draft = { workType: ["api"], examples: [{ type: "prototype", title: "p", path: "p.html", covers: ["api", "schema"] }] };
  const issues = coversIssues(draft);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /examples\[0\]\.covers\[1\]/);
  assert.match(issues[0], /"schema"/);
});

test("intake reports an unknown covers key through the draft field check", () => {
  const draft = {
    workType: ["ui"],
    examples: [{ type: "prototype", title: "p", path: "p.html", covers: ["states", "nope"] }]
  };
  const issues = scratchFieldIssues(draft);
  assert.ok(issues.some((issue) => /examples\[0\]\.covers\[1\]/.test(issue)), issues.join("\n"));
  assert.equal(scratchFieldIssues({ ...draft, examples: [{ ...draft.examples[0], covers: ["states", "flow"] }] }).length, 0);
});

test("covers must be an array", () => {
  const issues = coversIssues({ workType: ["ui"], examples: [{ type: "prototype", title: "p", path: "p.html", covers: "flow" }] });
  assert.match(issues[0], /examples\[0\]\.covers must be an array/);
});

test("a ui change without a prototype gets an advisory line naming what to show, and nothing blocks", () => {
  const line = checklistNoteLine({ workType: ["ui"] });
  assert.match(line, /^prototype \(advisory, approval page\): no prototype yet/);
  assert.match(line, /flow, states, ba, fail/);
});

test("a prototype that declares no covers, or misses one, gets an advisory line; a complete one gets none", () => {
  const proto = (covers) => ({ workType: ["ui"], examples: [{ type: "prototype", title: "p", path: "p.html", ...(covers ? { covers } : {}) }] });
  assert.match(checklistNoteLine(proto()), /declares no 'covers'/);
  assert.match(checklistNoteLine(proto(["flow", "states", "ba"])), /does not yet cover fail/);
  assert.equal(checklistNoteLine(proto(["flow", "states", "ba", "fail"])), "");
});
