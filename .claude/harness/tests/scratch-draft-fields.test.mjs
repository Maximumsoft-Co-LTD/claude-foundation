import assert from "node:assert/strict";
import test from "node:test";

import { EXAMPLE_TYPES, SCRATCH_TEXT_MAX, scratchFieldIssues } from "../runtime/workflow/scratch-fields.mjs";
import { normalizeSemanticDraft, semanticDraftTemplate } from "../runtime/workflow/semantic-draft.mjs";

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-");

// The smallest valid block of every supported type.
const MINIMAL = {
  prototype: { path: "board.html" },
  examples: { rules: [{ rule: "r", rows: [{ name: "n", when: "w", then: "t" }] }] },
  api: { endpoints: [{ method: "POST", path: "/cards", cases: [{ status: 201, request: "{}", response: "{}" }] }] },
  timeline: { events: [{ t: "09:00", event: "e" }] },
  dataDiff: { table: "cards", before: { cols: ["id"], rows: [["1"]] }, after: { cols: ["id", "rank"], rows: [["1", "0"]] } },
  lineage: { steps: [{ name: "orders", sample: "{}" }] },
  mermaid: { source: "flowchart LR\n  A --> B" },
  failures: { rows: [{ failure: "f", system: "s", user: "u" }] },
  permission: { roles: ["owner"], actions: [{ action: "delete", allow: ["owner"] }] },
  plan: { items: [{ op: "+", resource: "bucket" }] },
  snapshot: { cases: [{ input: "i", before: "b", after: "b" }] },
  repro: { steps: ["open"], actual: "spins", expected: "error shown" },
  perf: { metrics: [{ name: "p95", now: 480, target: 200, unit: "ms" }] },
  golden: { cases: [{ name: "n", input: "i", good: "g" }] },
  adr: { question: "q", options: [{ name: "a" }] },
  rollout: { stages: [{ stage: "10%" }] },
  apiDiff: { changes: [{ op: "+", signature: "get(id)" }] },
  strings: { locales: ["th", "en"], rows: [{ key: "save", th: "บันทึก", en: "Save" }] },
  alert: { rule: "rate > 0.02", title: "Error rate high" },
  privacy: { fields: [{ field: "email" }] },
  coverage: { rows: [{ scenario: "s", test: "t.test.js" }] },
  consumers: { rows: [{ consumer: "ios < 4.2" }] },
  messages: { items: [{ subject: "Shipped", body: "Your order shipped" }] },
  terminal: { lines: ["$ shop export"] },
  doc: { sections: [{ heading: "Install", text: "npm i" }] },
  pipeline: { before: ["test"], after: ["test", "scan"] },
  search: { queries: [{ q: "shirt", results: ["White shirt"] }] },
  report: { kpis: [{ label: "Sales", value: "38M" }], table: { cols: ["sku"], rows: [["A"]] } },
  diffSummary: { items: [{ op: "~", path: "src/a.js" }] }
};
const block = (type, extra = {}) => ({ type, title: `${type} example`, ...MINIMAL[type], ...extra });

test("every one of the 29 example types has a minimal valid shape", () => {
  assert.equal(EXAMPLE_TYPES.length, 29);
  assert.deepEqual(Object.keys(MINIMAL).sort(), [...EXAMPLE_TYPES].sort());
  assert.deepEqual(scratchFieldIssues({ examples: EXAMPLE_TYPES.map((type) => block(type)) }), []);
});

test("a complete scratch summary passes and every field stays optional", () => {
  const scratch = { get: "A board", asIs: "Cards in a text file (412 cards)", toBe: "A /board page", ifFail: "Retry shown" };
  assert.deepEqual(scratchFieldIssues({ scratch }), []);
  assert.deepEqual(scratchFieldIssues({ scratch: {} }), []);
  assert.deepEqual(scratchFieldIssues({}), []);
});

test("a scratch line over the limit names the field and the limit", () => {
  const issues = scratchFieldIssues({ scratch: { get: "x".repeat(SCRATCH_TEXT_MAX + 1) } });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /scratch\.get/);
  assert.match(issues[0], /240/);
  assert.deepEqual(scratchFieldIssues({ scratch: { get: "x".repeat(SCRATCH_TEXT_MAX) } }), [], "the limit itself passes");
  assert.match(scratchFieldIssues({ scratch: { ifFail: "one\ntwo" } })[0], /scratch\.ifFail/);
});

test("a scratch that is not an object is refused", () => {
  assert.match(scratchFieldIssues({ scratch: "summary" }).join("\n"), /scratch must be an object/);
  assert.match(scratchFieldIssues({ scratch: ["summary"] }).join("\n"), /scratch must be an object/);
});

test("an unknown example type names its index and the supported types", () => {
  const [issue] = scratchFieldIssues({ examples: [{ type: "video", title: "t" }] });
  assert.match(issue, /examples\[0\]\.type/);
  for (const type of ["prototype", "api", "diffSummary"]) assert.match(issue, new RegExp(type));
  assert.match(scratchFieldIssues({ examples: "api" }).join("\n"), /examples must be an array/);
});

test("a missing required field names the exact path", () => {
  const issues = scratchFieldIssues({ examples: [block("mermaid"), { type: "api", title: "API" }] });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /examples\[1\]\.endpoints/);
  const nested = scratchFieldIssues({ examples: [block("api", { endpoints: [{ method: "GET", cases: [] }] })] });
  assert.match(nested.join("\n"), /examples\[0\]\.endpoints\[0\]\.path is required/);
  assert.match(nested.join("\n"), /examples\[0\]\.endpoints\[0\]\.cases is required/);
  assert.match(scratchFieldIssues({ examples: [{ ...block("adr"), title: " " }] }).join("\n"), /examples\[0\]\.title/);
});

test("a prototype path must stay inside the change's previews folder", () => {
  for (const path of ["../../secret.html", "/etc/passwd", "a/../../b.html", "C:\\x.html", "https://evil.test/a.html", "file:///x"]) {
    const issues = scratchFieldIssues({ examples: [block("prototype", { path })] });
    assert.match(issues.join("\n"), /\.foundation\/previews\/<change>\//, path);
  }
  assert.deepEqual(scratchFieldIssues({ examples: [block("prototype", { path: "ui/board.html" })] }), []);
});

test("optional text fields must be strings", () => {
  assert.match(scratchFieldIssues({ examples: [block("plan", { capability: 3 })] }).join("\n"), /examples\[0\]\.capability must be a string/);
});

test("the semantic draft reports scratch issues and the template sample compiles", () => {
  const template = semanticDraftTemplate();
  assert.ok(template.scratch && Array.isArray(template.examples));
  const bad = normalizeSemanticDraft({ ...structuredClone(template), examples: [{ type: "video", title: "t" }] }, slug).issues;
  assert.ok(bad.some((issue) => /examples\[0\]\.type/.test(issue)));
  const good = normalizeSemanticDraft(structuredClone(template), slug).issues;
  assert.ok(!good.some((issue) => /scratch|examples/.test(issue)), good.join("\n"));
});
