import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  MERMAID_VENDOR, confinedHref, createApprovalPackageRuntime, renderApprovalPackage, routeForState
} from "../runtime/workflow/approval-package.mjs";
import { RENDERED_TYPES, packageText, renderExample } from "../runtime/workflow/scratch-blocks.mjs";
import { EXAMPLE_TYPES } from "../runtime/workflow/scratch-fields.mjs";

const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
};

const SAMPLE = {
  prototype: { path: "board.html", note: "drag a card" },
  examples: { rules: [{ rule: "Discount 5% from 1,000", rows: [{ name: "1,290", kind: "success", when: "Cart 1,290", then: "Pays 1,225.50" }] }] },
  api: { endpoints: [{ method: "POST", path: "/checkout", auth: "Bearer", cases: [
    { status: 201, label: "paid", request: '{"cartId":"c_77"}', response: '{"orderId":"ord_1"}' },
    { status: 409, label: "double", request: '{"cartId":"c_77"}', response: '{"error":"in_progress"}' }] }] },
  timeline: { events: [{ t: "09:00", event: "Submitted", state: "pending" }] },
  dataDiff: { table: "tasks", before: { cols: ["id"], rows: [["1"]] }, after: { cols: ["id", "priority"], rows: [["1", "0"]] }, rollback: "DROP COLUMN priority" },
  lineage: { steps: [{ name: "orders", sample: "{qty: 2}" }, { name: "daily", how: "sum", sample: "{qty: 412}" }] },
  mermaid: { source: "flowchart LR\n  A --> B" },
  failures: { rows: [{ failure: "timeout", system: "retry", user: "waiting" }] },
  permission: { roles: ["owner", "viewer"], actions: [{ action: "delete", allow: ["owner"] }] },
  plan: { summary: "1 to add", items: [{ op: "+", resource: "bucket", detail: "asia" }] },
  snapshot: { cases: [{ input: "load()", before: "[1]", after: "[1]" }] },
  repro: { steps: ["open /login"], actual: "spins", expected: "error shown" },
  perf: { load: "100 rps", metrics: [{ name: "p95", now: 480, target: 200, unit: "ms" }, { name: "p99", now: 1300, target: null, unit: "ms" }] },
  golden: { rubric: "accurate", cases: [{ name: "normal", input: "cards", good: "summary" }] },
  adr: { question: "Queue or thread?", options: [{ name: "Queue", pros: "durable", cons: "ops", chosen: true }] },
  rollout: { stages: [{ stage: "1", who: "10%", when: "day 1", stop: "crash > 0.5%" }] },
  apiDiff: { changes: [{ op: "+", signature: "tasks.get(id)" }], before: "get(id, cb)", after: "await tasks.get(id)" },
  strings: { locales: ["th", "en"], rows: [{ key: "save", th: "บันทึก", en: "Save" }] },
  alert: { rule: "rate > 0.02", title: "Checkout errors", message: "3.4%", dashboard: [{ label: "p95", value: "2.8s" }] },
  privacy: { fields: [{ field: "email", pii: "yes", where: "users", retention: "account" }] },
  coverage: { rows: [{ scenario: "paid", test: "paid.spec.ts", level: "e2e" }, { scenario: "offline", test: "—", level: "none" }] },
  consumers: { rows: [{ consumer: "iOS < 4.2", usage: "18,400", action: "force update" }] },
  messages: { items: [{ when: "now", subject: "Shipped", body: "Line one\nLine two", cta: "Track" }] },
  terminal: { lines: ["$ shop export", "+ saved", "! bad date"] },
  doc: { sections: [{ heading: "Install", text: "Run it", code: "npm i", expect: "added 1 package" }] },
  pipeline: { before: ["test"], after: ["test", "scan"] },
  search: { queries: [{ q: "shirt", results: ["White shirt"] }] },
  report: { kpis: [{ label: "Sales", value: "38M", delta: "+4%" }], table: { cols: ["sku"], rows: [["A"]] } },
  diffSummary: { items: [{ op: "~", path: "src/a.js", note: "format" }] }
};
const example = (type, extra = {}) => ({ type, title: `${type} block`, ...structuredClone(SAMPLE[type]), ...extra });
const ALL = () => EXAMPLE_TYPES.map((type) => example(type));

function fixture(t, { draft = {}, state = {}, providers = {}, receipts = {}, previews = [], files = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foundation-scratch-blocks-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const id = "demo";
  const runtimeDir = join(root, ".foundation", "runtime");
  const packagesDir = join(root, ".foundation", "packages");
  const previewsDir = join(root, ".foundation", "previews");
  write(join(runtimeDir, `${id}.json`), {
    id, contractRevision: 1, impact: "medium", riskSignals: [], coupling: "isolated", intent: "Show the board",
    draftSource: { contractRevision: 1, draft: { language: "en", workType: ["feature", "ui"], ...draft } }, ...state
  });
  write(join(root, "openspec", "changes", id, "proposal.md"), "## Summary\n\nShow the board.\n");
  for (const [path, value] of Object.entries(files)) write(join(root, path), value);
  for (const row of previews) write(join(previewsDir, id, "receipts", `${row.provider}.json`), row);
  const runtime = createApprovalPackageRuntime({
    root, runtimeDir, packagesDir, previewsDir, receiptsDir: join(root, ".foundation", "receipts"),
    loadRuntime: (changeId) => JSON.parse(readFileSync(join(runtimeDir, `${changeId}.json`), "utf8")),
    activeChangePath: (changeId) => join(root, "openspec", "changes", changeId),
    changeWorkTypes: () => [], evidence: () => ({ providers }),
    providerCapability: (name, config) => config?.capability || name,
    receiptValidity: (changeId, provider) => receipts[provider] || { provider, validity: "missing" },
    fail: (message) => { throw new Error(message); }
  });
  const html = () => { runtime.writePackage(id); return readFileSync(join(packagesDir, `${id}.html`), "utf8"); };
  return { root, id, runtime, packagesDir, previewsDir, html };
}
const blockOf = (html, index) => html.split(`id="example-${index}"`)[1].split('<section class="block"')[0];

test("the renderer and the validator agree on all 29 types", () => {
  assert.deepEqual([...RENDERED_TYPES].sort(), [...EXAMPLE_TYPES].sort());
  assert.deepEqual(Object.keys(SAMPLE).sort(), [...EXAMPLE_TYPES].sort());
});

test("a complete scratch summary shows its four lines in order at the top", (t) => {
  const { html } = fixture(t, { draft: { scratch: {
    get: "A board with three columns", asIs: "Cards live in a text file", toBe: "A /board page", ifFail: "A retry banner appears" } } });
  const page = html();
  const top = page.split('id="scratch"')[1].split("</section>")[0];
  const order = ["A board with three columns", "Cards live in a text file", "A /board page", "A retry banner appears"]
    .map((text) => top.indexOf(text));
  assert.ok(order.every((index) => index > 0), "every line is in the summary");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in order");
  assert.ok(page.indexOf('id="scratch"') < page.indexOf('id="roles"'), "before the role sections");
});

test("without a scratch summary the top shows the intent and says it is missing", (t) => {
  const top = fixture(t).html().split('id="scratch"')[1].split("</section>")[0];
  assert.match(top, /Show the board/);
  assert.match(top, /No plain-language summary yet/);
});

test("an API example shows both cases and switches without a script", (t) => {
  const page = fixture(t, { draft: { examples: [example("api")] } }).html();
  const block = blockOf(page, 0);
  for (const text of ["201", "409", "ord_1", "in_progress", "/checkout"]) assert.match(block, new RegExp(text));
  assert.equal((block.match(/<details class="case"/g) || []).length, 2);
  assert.doesNotMatch(page, /<script(?![^>]*vendor\/mermaid\.min\.js)/);
});

test("all 29 types render as non-empty blocks", (t) => {
  const page = fixture(t, { draft: { examples: ALL() } }).html();
  assert.equal((page.match(/<section class="block" id="example-\d+"/g) || []).length, 29);
  for (const [index, type] of EXAMPLE_TYPES.entries()) {
    const agreed = blockOf(page, index).split('class="panel p1">')[1].split('<div class="panel p2">')[0];
    assert.ok(agreed.replace(/<[^>]+>/g, "").trim().length > 0, `${type} has visible content`);
  }
});

test("draft text with markup is shown as text in every type", (t) => {
  const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>"\'';
  const poison = (value) => typeof value === "string" ? `${value}${payload}` : Array.isArray(value) ? value.map(poison)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, poison(v)])) : value;
  const examples = ALL().map((row) => ({ ...poison(row), type: row.type }));
  const page = fixture(t, { draft: { examples, scratch: { get: payload, asIs: payload, toBe: payload, ifFail: payload } } }).html();
  assert.doesNotMatch(page, /<img/i);
  assert.doesNotMatch(page, /<[^>]*\sonerror=/i, "no handler attribute on any element");
  const scripts = page.match(/<script\b[^>]*>/g) || [];
  assert.ok(scripts.every((tag) => /vendor\/mermaid\.min\.js/.test(tag)), scripts.join(" "));
  assert.match(page, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("a passing valid receipt makes the after-Build tab proof with its artifact link", (t) => {
  const shot = ".foundation/evidence/demo/run1/artifacts/ui/ab12-shot.png";
  const page = fixture(t, {
    draft: { examples: [example("mermaid", { capability: "browser" })] },
    providers: { "ui-shot": { capability: "browser" } },
    receipts: { "ui-shot": { validity: "valid", receipt: { status: "pass", artifacts: [{ path: shot }] } } },
    files: { [shot]: "png" }
  }).html();
  const actual = blockOf(page, 0).split('<div class="panel p2">')[1];
  assert.match(actual, /label-proof/);
  assert.match(actual, /href="\.\.\/evidence\/demo\/run1\/artifacts\/ui\/ab12-shot\.png"/);
});

test("a preview of this revision is a preview with its output and link", (t) => {
  const page = fixture(t, {
    draft: { examples: [example("mermaid", { capability: "browser" })] },
    previews: [{ kind: "preview", provider: "shot", capability: "browser", status: "pass", contractRevision: 1, outputTail: "captured 390px", artifact: "artifacts/shot-board.png" }],
    files: { ".foundation/previews/demo/artifacts/shot-board.png": "png" }
  }).html();
  const actual = blockOf(page, 0).split('<div class="panel p2">')[1];
  assert.match(actual, /label-preview/);
  assert.doesNotMatch(actual, /label-proof/);
  assert.match(actual, /captured 390px/);
  assert.match(actual, /href="\.\.\/previews\/demo\/artifacts\/shot-board\.png"/);
});

test("a preview from an earlier revision is marked stale", (t) => {
  const page = fixture(t, {
    draft: { examples: [example("mermaid", { capability: "browser" })] },
    previews: [{ kind: "preview", provider: "shot", capability: "browser", status: "pass", contractRevision: 0 }]
  }).html();
  assert.match(blockOf(page, 0).split('<div class="panel p2">')[1], /label-stale/);
});

test("with no receipt or preview the tab says so and what Build will be compared against", (t) => {
  const page = fixture(t, { draft: { examples: [example("plan", { capability: "plan-check", postBuild: "terraform plan on staging" })] } }).html();
  const actual = blockOf(page, 0).split('<div class="panel p2">')[1];
  assert.match(actual, /label-none/);
  assert.match(actual, /No result yet/);
  assert.match(actual, /terraform plan on staging/);
});

test("a failing receipt is shown as failed and never as proof", (t) => {
  const page = fixture(t, {
    draft: { examples: [example("mermaid", { capability: "browser" })] },
    providers: { "ui-shot": { capability: "browser" } },
    receipts: { "ui-shot": { validity: "valid", receipt: { status: "fail", artifacts: [] } } }
  }).html();
  const actual = blockOf(page, 0).split('<div class="panel p2">')[1];
  assert.match(actual, /label-fail/);
  assert.doesNotMatch(actual, /label-proof/);
});

test("Thai drafts get Thai page text and other languages get English", (t) => {
  const th = fixture(t, { draft: { language: "th", examples: [example("plan")] } }).html();
  assert.match(th, /<html lang="th">/);
  assert.match(th, /จะได้อะไร/);
  assert.match(th, /ยังไม่มีผล/);
  // A High Thai page translates the role view, suggestions, and empty states too.
  const high = fixture(t, { draft: { language: "th", workType: ["api"], examples: [example("plan")] }, state: { impact: "high" } }).html();
  for (const english of ["Suggested previews", "no evidence yet", "Not declared in the agreement", "No approval needed",
    "Optional. A suggestion", "no provider yet", ">Artifact</th><th scope=\"col\">Domains", "Packet:</p>"])
    assert.ok(!high.includes(english), `no English '${english}' on a Thai page`);
  for (const thai of ["Preview ที่แนะนำ", "ยังไม่มีหลักฐาน", "ไม่ได้ประกาศใน agreement", "บทบาทนี้ไม่ต้องอนุมัติ", "ตามบทบาทผู้อนุมัติ", "ลองเรียก API (mock)"])
    assert.ok(high.includes(thai), `Thai '${thai}'`);
  const ja = fixture(t, { draft: { language: "ja", examples: [example("plan")] } }).html();
  assert.match(ja, /What you get/);
  assert.match(ja, /no result yet/);
  assert.doesNotMatch(ja, /จะได้อะไร/);
  assert.equal(packageText("th-TH"), packageText("th"));
});

test("diagrams load the shipped Mermaid file by relative path and fall back to text without it", (t) => {
  const { html, packagesDir } = fixture(t, { draft: { userFlow: { purpose: "Flow", source: "flowchart LR\n  A --> B" },
    diagrams: [{ key: "s", type: "mermaid", purpose: "States", source: "stateDiagram-v2\n  [*] --> a" }] } });
  const page = html();
  const scripts = page.match(/<script\b[^>]*>/g) || [];
  assert.equal(scripts.length, 1);
  const src = scripts[0].match(/src="([^"]+)"/)[1];
  assert.ok(!/^[a-z]+:|^\//i.test(src), "relative");
  assert.equal(realpathSync(join(packagesDir, decodeURIComponent(src))), realpathSync(MERMAID_VENDOR), "resolves to the shipped file");
  assert.equal((page.match(/<pre class="mermaid">/g) || []).length, 2);
  assert.doesNotMatch(page, /https?:\/\//);
  const model = fixture(t, { draft: { userFlow: { purpose: "Flow", source: "flowchart LR\n  A --> B" } } }).runtime.buildModel("demo");
  const offline = renderApprovalPackage({ ...model, mermaidHref: null });
  assert.doesNotMatch(offline, /<script/);
  assert.match(offline, /<pre class="mermaid">flowchart LR/);
});

test("a page without diagrams carries no script at all", (t) => {
  const page = fixture(t, { draft: { examples: [example("plan")] } }).html();
  assert.doesNotMatch(page, /<script/);
});

test("prototype and artifact links never leave the change's folder", (t) => {
  const { root, packagesDir, previewsDir, html } = fixture(t, {
    draft: { examples: [example("prototype", { path: "board.html" }), example("prototype", { path: "escape.html" })] },
    files: { ".foundation/previews/demo/board.html": "<p>board</p>", "secret.html": "secret" }
  });
  mkdirSync(packagesDir, { recursive: true });
  symlinkSync(join(root, "secret.html"), join(previewsDir, "demo", "escape.html"));
  const base = join(previewsDir, "demo");
  assert.equal(confinedHref(packagesDir, base, "board.html"), "../previews/demo/board.html");
  assert.equal(confinedHref(packagesDir, base, "escape.html"), null, "symlink out of the folder");
  assert.equal(confinedHref(packagesDir, base, "../../secret.html"), null);
  assert.equal(confinedHref(packagesDir, base, "/etc/hosts"), null);
  assert.equal(confinedHref(packagesDir, base, "missing.html"), null);
  const page = html();
  assert.match(blockOf(page, 0), /<iframe[^>]+sandbox="allow-scripts allow-forms" src="\.\.\/previews\/demo\/board\.html"/);
  assert.doesNotMatch(blockOf(page, 1), /<iframe/);
  assert.match(blockOf(page, 1), /prototype file is not there yet/);
});

test("browser-only data and example types reach the router", () => {
  const route = routeForState({
    impact: "medium", riskSignals: ["user-interface", "persisted-data-change"], contractRevision: 1,
    draftSource: { contractRevision: 1, draft: { workType: ["feature", "ui", "data"],
      dataModel: [{ entity: "Card", fields: ["id"], store: "browser" }], examples: [{ type: "report" }] } }
  });
  assert.equal(route.level, "Medium");
  assert.ok(!route.domains.some((row) => row.id === 15));
  assert.ok(route.domains.some((row) => row.id === 17));
});

test("an unknown example type renders nothing instead of throwing", () => {
  assert.equal(renderExample({ type: "video", title: "x" }, packageText("en")), "");
});
