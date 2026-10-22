import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createApprovalPackageRuntime, previewSuggestions, renderApprovalPackage } from "../runtime/workflow/approval-package.mjs";
import { scratchFieldIssues } from "../runtime/workflow/scratch-fields.mjs";
import { approvalPackageLine } from "../runtime/workflow/change-lifecycle.mjs";
import { routeChange } from "../runtime/contracts/scratch-router.mjs";
import { packageText } from "../runtime/workflow/scratch-blocks.mjs";

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const FOUNDATION = fileURLToPath(new URL("../foundation.mjs", import.meta.url));

function fixture(t, { state = {}, providers = {}, previewProviders = {}, receipts = {}, previews = [],
  storedReceipts = {}, receiptValidity = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foundation-approval-package-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtimeDir = join(root, ".foundation", "runtime");
  const packagesDir = join(root, ".foundation", "packages");
  const previewsDir = join(root, ".foundation", "previews");
  const id = "demo";
  const value = {
    id, contractRevision: 1, impact: "medium", riskSignals: [], coupling: "isolated",
    draftSource: {
      contractRevision: 1,
      draft: {
        language: "en", workType: ["feature", "ui"],
        userFlow: { purpose: "Flow", source: "flowchart LR\n  A --> B" },
        diagrams: [{ key: "states", type: "mermaid", purpose: "States", source: "stateDiagram-v2\n  [*] --> a" }]
      }
    },
    ...state
  };
  write(join(runtimeDir, `${id}.json`), value);
  write(join(root, "openspec", "changes", id, "proposal.md"), "## Summary\n\nShow the board.\n\n## Why\n\nBecause.\n");
  for (const row of previews) write(join(previewsDir, id, "receipts", `${row.provider}.json`), row);
  const receiptsDir = join(root, ".foundation", "receipts");
  for (const [provider, receipt] of Object.entries(storedReceipts)) write(join(receiptsDir, id, `${provider}.json`), receipt);
  const runtime = createApprovalPackageRuntime({
    root, runtimeDir, packagesDir, previewsDir, receiptsDir,
    loadRuntime: (changeId) => JSON.parse(readFileSync(join(runtimeDir, `${changeId}.json`), "utf8")),
    activeChangePath: (changeId) => join(root, "openspec", "changes", changeId),
    changeWorkTypes: () => ["docs"],
    evidence: () => ({ providers, previewProviders }),
    providerCapability: (name, config) => config?.capability || name,
    receiptValidity: receiptValidity || ((changeId, provider) => receipts[provider] || { provider, validity: "missing" }),
    fail: (message) => { throw new Error(message); }
  });
  return { root, id, runtime, runtimeDir, packagesDir, statePath: join(runtimeDir, `${id}.json`) };
}

const LANDED = { status: "archived", land: { assurance: { status: "passed" } } };
const goneSandbox = () => { throw new Error("workspace no longer exists; run change abandon"); };

test("a landed change labels proof from the receipts Land accepted, without sandbox warnings", (t) => {
  const { id, runtime } = fixture(t, {
    state: LANDED, providers: { test: {} }, receiptValidity: goneSandbox,
    storedReceipts: { test: { provider: "test", status: "pass" } }
  });
  const model = runtime.buildModel(id);
  assert.equal(model.artifacts.find((row) => row.id === "testmap").evidence, "proof");
  assert.deepEqual(model.notices, []);
});

test("a landed change whose receipt failed is not labeled proof", (t) => {
  const { id, runtime } = fixture(t, {
    state: LANDED, providers: { test: {} }, receiptValidity: goneSandbox,
    storedReceipts: { test: { provider: "test", status: "fail" } }
  });
  assert.equal(runtime.buildModel(id).artifacts.find((row) => row.id === "testmap").evidence, "none");
});

test("concurrency shows only the failures about concurrency, or says none match", (t) => {
  const { id, runtime, packagesDir } = fixture(t, {
    state: { impact: "high", riskSignals: ["financial"], draftSource: { contractRevision: 1, draft: WITHDRAWAL_DRAFT } }
  });
  runtime.writePackage(id);
  const concurOf = (html) => html.split("<summary>Concurrency and double-submit test</summary>")[1].split("</details>")[0];
  assert.match(concurOf(readFileSync(join(packagesDir, `${id}.html`), "utf8")), /No failure scenario in the agreement concerns this/);
  const draft = { ...WITHDRAWAL_DRAFT, requirements: [...WITHDRAWAL_DRAFT.requirements, { key: "no-double", scenarios: [
    { name: "Two at once", kind: "failure", when: "two withdrawals of 80 at the same time race", then: "one deducts", recovery: "second gets the first result" }] }] };
  const second = fixture(t, { state: { impact: "high", riskSignals: ["financial"], draftSource: { contractRevision: 1, draft } } });
  second.runtime.writePackage(second.id);
  const concur = concurOf(readFileSync(join(second.packagesDir, `${second.id}.html`), "utf8"));
  assert.match(concur, /two withdrawals of 80/);
  assert.doesNotMatch(concur, /withdraw 150/);
});

test("package writes one section per role and one mermaid block per diagram", (t) => {
  const { root, id, runtime, packagesDir } = fixture(t);
  const result = runtime.writePackage(id);
  assert.equal(result.path, join(".foundation", "packages", `${id}.html`));
  const html = readFileSync(join(packagesDir, `${id}.html`), "utf8");
  for (const role of routeChange({ workTypes: ["feature", "ui"], impact: "medium" }).roles)
    assert.match(html, new RegExp(`id="role-${role}"`));
  assert.equal((html.match(/<pre class="mermaid">/g) || []).length, 2);
  assert.match(html, /Show the board\./);
  // Nothing over the network; the only script is the harness's own Mermaid file.
  assert.doesNotMatch(html, /https?:\/\//, "nothing loaded over the network");
  const scripts = html.match(/<script\b[^>]*>/g) || [];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /^<script src="[^"]*\.claude\/harness\/vendor\/mermaid\.min\.js"><\/script>$|^<script src="[^"]*\.claude\/harness\/vendor\/mermaid\.min\.js">$/);
  assert.ok(existsSync(join(root, ".foundation", "packages")));
});

test("package leaves lifecycle state byte-identical", (t) => {
  const { id, runtime, statePath } = fixture(t);
  const before = digest(statePath);
  runtime.writePackage(id);
  assert.equal(digest(statePath), before);
});

test("a change without a current typed draft renders from the packet with a notice", (t) => {
  const { id, runtime, packagesDir } = fixture(t, { state: { draftSource: null } });
  runtime.writePackage(id);
  const html = readFileSync(join(packagesDir, `${id}.html`), "utf8");
  assert.match(html, /detail is limited/);
  assert.match(html, /Show the board\./);
});

test("an unknown change fails naming the id and writes nothing", (t) => {
  const { runtime, packagesDir } = fixture(t);
  assert.throws(() => runtime.writePackage("missing-change"), /missing-change/);
  assert.equal(existsSync(join(packagesDir, "missing-change.html")), false);
});

test("only a valid passing receipt earns the proof label", (t) => {
  const { id, runtime } = fixture(t, {
    providers: { test: { adapter: "test-discovery" } },
    receipts: { test: { provider: "test", validity: "valid", receipt: { provider: "test", status: "pass" } } }
  });
  const model = runtime.buildModel(id);
  assert.equal(model.artifacts.find((row) => row.id === "testmap").evidence, "proof");
});

test("a valid receipt that did not pass, or an invalid passing one, is not proof", (t) => {
  for (const result of [
    { provider: "test", validity: "valid", receipt: { provider: "test", status: "fail" } },
    { provider: "test", validity: "contract-stale", status: "pass" }
  ]) {
    const { id, runtime } = fixture(t, { providers: { test: {} }, receipts: { test: result } });
    assert.equal(runtime.buildModel(id).artifacts.find((row) => row.id === "testmap").evidence, "none");
  }
});

test("a preview receipt is labeled preview, never proof, and stale after a revision", (t) => {
  const { id, runtime } = fixture(t, {
    state: { impact: "high" },
    providers: { shots: { capability: "browser" } },
    previews: [{ kind: "preview", provider: "shots", capability: "browser", contractRevision: 1, status: "pass" }]
  });
  const shot = runtime.buildModel(id).artifacts.find((row) => row.id === "shot");
  assert.equal(shot.evidence, "preview");
  const stale = fixture(t, {
    state: { impact: "high", contractRevision: 2, draftSource: { contractRevision: 2, draft: { workType: ["ui"] } } },
    providers: { shots: { capability: "browser" } },
    previews: [{ kind: "preview", provider: "shots", capability: "browser", contractRevision: 1, status: "pass" }]
  });
  const staleShot = stale.runtime.buildModel(stale.id).artifacts.find((row) => row.id === "shot");
  assert.equal(staleShot.evidence, "stale");
});

test("a Critical change suggests the matching provider with its preview command", (t) => {
  const { id, runtime, packagesDir } = fixture(t, {
    state: { impact: "high", riskSignals: ["financial"] },
    providers: { race: { capability: "concurrency" }, sandbox: { capability: "browser", external: true } }
  });
  runtime.writePackage(id);
  const html = readFileSync(join(packagesDir, `${id}.html`), "utf8");
  assert.match(html, /Suggested previews/);
  assert.match(html, /claude-foundation preview demo --provider race/);
  assert.match(html, /--provider sandbox --decision-ref/);
});

test("a High change without a matching provider names the capability to declare", () => {
  const route = routeChange({ workTypes: ["data", "migration"], impact: "high" });
  const rows = previewSuggestions(route, [], "demo");
  const migration = rows.find((row) => row.capability === "data-migration");
  assert.ok(migration);
  assert.deepEqual(migration.providers, []);
});

test("a Medium change has no suggested previews", (t) => {
  const { id, runtime, packagesDir } = fixture(t, { providers: { race: { capability: "concurrency" } } });
  runtime.writePackage(id);
  assert.doesNotMatch(readFileSync(join(packagesDir, `${id}.html`), "utf8"), /Suggested previews/);
});

const WITHDRAWAL_DRAFT = {
  language: "en", workType: ["feature", "api", "data"],
  apiContracts: [{ method: "POST", path: "/wallets/{account}/withdrawals", auth: "owner",
    request: { amount: "integer" }, response: { balance: "integer" },
    errors: [{ status: 409, when: "balance too low" }] }],
  requirements: [
    { key: "withdraw", scenarios: [
      { name: "Withdraw ok", kind: "success", given: "balance 100", when: "withdraw 30", then: "balance 70" },
      { name: "Too much", kind: "failure", given: "balance 100", when: "withdraw 150", then: "409", recovery: "withdraw less" }
    ] },
    { key: "owner-only", scenarios: [
      { name: "<script>alert(1)</script>", kind: "failure", access: "deny", when: "bob withdraws", then: "403", recovery: "owner withdraws" }
    ] }
  ],
  tasks: [{ key: "implement", outcome: "Withdraw safely", paths: ["src/wallet.js"] }]
};

test("package shows the agreement's content under each artifact", (t) => {
  const { id, runtime, packagesDir } = fixture(t, {
    state: { impact: "high", riskSignals: ["financial", "access-control"],
      draftSource: { contractRevision: 1, draft: WITHDRAWAL_DRAFT } }
  });
  runtime.writePackage(id);
  const html = readFileSync(join(packagesDir, `${id}.html`), "utf8");
  const section = (role) => html.split(`id="role-${role}"`)[1].split("</section>")[0];
  assert.match(section("tech-lead"), /\/wallets\/\{account\}\/withdrawals/);
  assert.match(section("tech-lead"), /409: balance too low/);
  assert.match(section("tech-lead"), /src\/wallet\.js/);
  assert.equal((section("qa").match(/<tr><td>(withdraw|owner-only)<\/td>/g) || []).length, 3);
  assert.match(section("security"), /<td>deny<\/td>/);
  assert.match(section("security"), /owner withdraws/);
});

test("an undeclared artifact says so and content is escaped", (t) => {
  const { id, runtime, packagesDir } = fixture(t, {
    state: { impact: "high", riskSignals: ["financial", "access-control"],
      draftSource: { contractRevision: 1, draft: WITHDRAWAL_DRAFT } }
  });
  runtime.writePackage(id);
  const html = readFileSync(join(packagesDir, `${id}.html`), "utf8");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const erd = html.split("<summary>ERD and schema diff</summary>")[1];
  assert.ok(erd, "the ERD artifact is listed");
  assert.match(erd.slice(0, 200), /Not declared in the agreement/);
});

test("a preview's status and output appear under its artifact, escaped and labeled", (t) => {
  const previews = [{ kind: "preview", provider: "race", capability: "concurrency", contractRevision: 1,
    status: "fail", outputTail: "RACE pays out twice <img src=x onerror=alert(1)>" }];
  const { id, runtime, packagesDir } = fixture(t, {
    state: { impact: "high", riskSignals: ["financial"], draftSource: { contractRevision: 1, draft: WITHDRAWAL_DRAFT } },
    providers: { race: { capability: "concurrency" } }, previews
  });
  runtime.writePackage(id);
  const html = readFileSync(join(packagesDir, `${id}.html`), "utf8");
  const concur = html.split("<summary>Concurrency and double-submit test</summary>")[1].split("</details>")[0];
  assert.match(concur, /Preview <code>race<\/code>: <span class="label label-preview">fail<\/span>/);
  assert.match(concur, /RACE pays out twice/);
  assert.match(concur, /never proof/);
  assert.doesNotMatch(html, /<img/);

  const stale = fixture(t, {
    state: { impact: "high", riskSignals: ["financial"], contractRevision: 2,
      draftSource: { contractRevision: 2, draft: WITHDRAWAL_DRAFT } },
    providers: { race: { capability: "concurrency" } }, previews
  });
  stale.runtime.writePackage(stale.id);
  assert.match(readFileSync(join(stale.packagesDir, `${stale.id}.html`), "utf8"), /fail, stale/);
});

// The shipped runtime fails through die(), which exits the process unless the
// call is trapped; only a real CLI run shows that the package survives it.
function cliProject(t, evidenceText) {
  const root = mkdtempSync(join(tmpdir(), "foundation-approval-package-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(join(root, "openspec", "config.yaml"), "schema: foundation-standard\n");
  write(join(root, ".claude", "harness", "foundation.mjs"), "// project marker\n");
  write(join(root, ".foundation", "runtime", "demo.json"),
    { id: "demo", status: "change", contractRevision: 0, impact: "high", riskSignals: ["financial"] });
  write(join(root, "openspec", "changes", "demo", "proposal.md"), "## Summary\n\nPay out.\n");
  write(join(root, "openspec", "changes", "demo", "evidence.yaml"), evidenceText);
  const run = (...args) => spawnSync(process.execPath, [FOUNDATION, ...args], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, CLAUDE_FOUNDATION_PROJECT: root, FOUNDATION_TELEMETRY: "0" }
  });
  return { root, run };
}

test("package is written with a warning when evidence wiring is invalid", (t) => {
  for (const evidenceText of [
    JSON.stringify({ version: 2, claims: [], providers: { race: { capability: "concurrency", command: ["true"] } } }),
    "{ not json"
  ]) {
    const { root, run } = cliProject(t, evidenceText);
    const result = run("package", "demo");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /warning: evidence not read/);
    const html = readFileSync(join(root, ".foundation", "packages", "demo.html"), "utf8");
    assert.match(html, /evidence not read/);
    assert.match(html, /class="chip risk risk-(Critical|High)">Risk level: /);
  }
});

test("package still refuses an unknown change from the CLI", (t) => {
  const { root, run } = cliProject(t, JSON.stringify({ version: 2, claims: [] }));
  const result = run("package", "missing-change");
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(root, ".foundation", "packages", "missing-change.html")), false);
});

test("the approval output links the package or warns without failing", (t) => {
  assert.equal(approvalPackageLine({ path: ".foundation/packages/demo.html" }),
    "  approval package: .foundation/packages/demo.html\n");
  assert.match(approvalPackageLine({ error: "boom" }), /warning: approval package not written \(boom\)/);
  assert.equal(approvalPackageLine(null), "");
  const { runtime } = fixture(t);
  assert.match(runtime.tryWritePackage("missing-change").error, /missing-change/);
});

// Decision-first page: the order, the collapsed reviewer details, and the
// copy-only decision bar.
const SCRATCH = { get: "G line", asIs: "A line", toBe: "T line", ifFail: "F line" };
const REQUIREMENTS = [{ key: "r", scenarios: [{ kind: "success" }, { kind: "failure" }, { kind: "failure" }] }];
const TERMINAL = (title) => ({ type: "terminal", title, lines: ["ok"] });
function pageDraft(extra = {}) {
  return { draftSource: { contractRevision: 1, draft: {
    language: "en", intent: "Show the board", workType: ["feature", "ui"], scratch: SCRATCH,
    tasks: [{ paths: ["a/**", "b.mjs"] }, { paths: ["a/**"] }], openQuestions: [], requirements: REQUIREMENTS,
    diagrams: [{ key: "d", type: "mermaid", purpose: "States", source: "stateDiagram-v2\n  [*] --> a" }], ...extra } } };
}
function pageOf(t, state, language) {
  const value = fixture(t, { state });
  value.runtime.writePackage(value.id);
  return readFileSync(join(value.packagesDir, `${value.id}.html`), "utf8");
}

test("the page leads with the summary and scope, then collapsed reviewer details, and ends there", (t) => {
  for (const language of ["en", "th"]) {
    const html = pageOf(t, pageDraft({ language, diagrams: undefined }));
    const at = (needle) => html.indexOf(needle);
    const order = ['id="risk-why"', 'id="scratch"', 'id="scope"', 'id="reviewer-details"'].map(at);
    assert.ok(order.every((index) => index > 0), language);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), language);
    assert.match(html, /<details id="reviewer-details"><summary>/);
    for (const inside of ['id="roles"', 'id="domains"'])
      assert.ok(at(inside) > at('id="reviewer-details"') && at(inside) < at("</main>"), inside);
    assert.match(html, language === "th" ? /ต้องตัดสินใจ/ : /Decision needed/);
  }
});

test("scope counts come from the draft and unknown stays unknown, never zero", (t) => {
  const known = pageOf(t, pageDraft());
  assert.match(known, /<b>2<\/b> files touched/);
  assert.match(known, /<b>0<\/b> open questions/);
  assert.match(known, /<b>2<\/b> failure cases/);
  const unknown = pageOf(t, pageDraft({ tasks: undefined, openQuestions: undefined, requirements: undefined }));
  assert.equal((unknown.match(/<b>unknown<\/b>/g) || []).length, 3);
  assert.doesNotMatch(unknown, /<b>0<\/b>/);
  const legacy = pageOf(t, { draftSource: null });
  assert.doesNotMatch(legacy, /id="scope"/);
});

test("without scratch the page warns instead of leaving the top empty", (t) => {
  const html = pageOf(t, pageDraft({ scratch: undefined }));
  assert.match(html, /No plain-language summary yet/);
  assert.match(html, /<b>What you get<\/b>/);
});

test("only the first two examples are open; the rest are collapsed", (t) => {
  const few = pageOf(t, pageDraft({ examples: [TERMINAL("one"), TERMINAL("two")] }));
  assert.doesNotMatch(few, /id="more-examples"/);
  const many = pageOf(t, pageDraft({ examples: [TERMINAL("one"), TERMINAL("two"), TERMINAL("three")] }));
  assert.match(many, /<details id="more-examples"><summary>More examples \(1\)<\/summary>[\s\S]*three/);
  assert.ok(many.indexOf("one") < many.indexOf('id="more-examples"'));
});

test("the page has no decision section, reply lines, form, script, or handler", (t) => {
  for (const language of ["en", "th"]) {
    const html = pageOf(t, pageDraft({ language, diagrams: undefined }));
    assert.doesNotMatch(html, /id="decision"|class="decision"|<textarea|class="replies"/);
    assert.doesNotMatch(html, /<script|<form|<button|\son[a-z]+=/);
    assert.doesNotMatch(html, /การตัดสินใจของคุณ|Your decision|คัดลอกหนึ่งบรรทัด|Copy one line/);
  }
});

test("a quiet status line says approved, or names the roles still to approve, and is absent otherwise", (t) => {
  const approved = pageOf(t, { ...pageDraft(), specApproval: { required: true, identity: "x", revision: 1 } });
  assert.match(approved, /id="approval-status"[^>]*>Approved for this revision\./);
  assert.doesNotMatch(approved, /<textarea/);
  const stale = pageOf(t, { ...pageDraft(), specApproval: { required: true, identity: "x", revision: 0 } });
  assert.doesNotMatch(stale, /id="approval-status"|id="pending-lanes"/);
  const lanes = pageOf(t, { ...pageDraft(), specApproval: { required: true, requiredLanes: ["qa", "security"], lanes: {} } });
  assert.match(lanes, /id="pending-lanes"[^>]*>Still waiting for approval from: qa, security/);
  assert.doesNotMatch(lanes, /id="approval-status"/);
  assert.ok(lanes.indexOf('id="pending-lanes"') < lanes.indexOf('id="scratch"'));
});

// Readable page: risk scale, before/after cards, questions, failure cards. The
// tests above are the first approval-page change's and are kept as written.
test("the risk shows as a four-step scale with words, and each reason in plain words", (t) => {
  const critical = pageOf(t, { ...pageDraft(), impact: "high", riskSignals: ["financial"] });
  assert.equal((critical.match(/<li class="on"><\/li>/g) || []).length, 4);
  assert.match(critical, /risk-Critical">Risk level: ▲▲ Critical/);
  assert.match(critical, /level 4 of 4/);
  assert.match(critical, /<ul class="why" id="risk-why"[^>]*><li>High impact<\/li><li>Involves money<\/li>/);
  assert.doesNotMatch(critical, /risk:financial|impact:high/);
  const low = pageOf(t, { ...pageDraft(), impact: "low", riskSignals: [] });
  assert.equal((low.match(/<li class="on"><\/li>/g) || []).length, 1);
  const thai = pageOf(t, { ...pageDraft({ language: "th" }), impact: "high", riskSignals: ["financial"] });
  assert.match(thai, /ระดับที่ 4 จาก 4/);
  assert.match(thai, /<li>เกี่ยวกับเงิน<\/li>/);
});

test("a path-derived reason names the path and what it implies", (t) => {
  const html = pageOf(t, { ...pageDraft({ tasks: [{ paths: ["db/migrations/0042.sql"] }] }), riskSignals: [] });
  assert.match(html, /<li>Touches db\/migrations\/0042\.sql \(Changes stored data\)<\/li>/);
});

test("before and after are paired cards; one side alone is not padded; open questions are listed in full", (t) => {
  const both = pageOf(t, pageDraft({ openQuestions: ["Partial refunds?", { question: "Who signs off?" }, "  "] }));
  assert.match(both, /<div class="card before"><span class="side-tag">Before<\/span>A line<\/div><div class="arrow" aria-hidden="true">→<\/div><div class="card after"><span class="side-tag">After<\/span>T line<\/div>/);
  assert.match(both, /id="open-questions"[^>]*><h2>Questions to answer before approving \(2\)<\/h2><ul><li>Partial refunds\?<\/li><li>Who signs off\?<\/li><\/ul>/);
  const one = pageOf(t, pageDraft({ scratch: { ...SCRATCH, toBe: undefined } }));
  assert.match(one, /class="ba single"/);
  assert.doesNotMatch(one, /class="card after"/);
  const none = pageOf(t, pageDraft({ openQuestions: [] }));
  assert.doesNotMatch(none, /id="open-questions"/);
  const unsafe = pageOf(t, pageDraft({ openQuestions: ["<img src=x onerror=1>"] }));
  assert.match(unsafe, /&lt;img src=x onerror=1&gt;/);
  assert.doesNotMatch(unsafe, /<img src=x/);
});

test("failure scenarios become cards with the trigger, what happens, and recovery only when stated", (t) => {
  const html = pageOf(t, pageDraft({ requirements: [{ key: "r", scenarios: [
    { kind: "success", when: "ok", then: "fine" },
    { kind: "failure", name: "Provider down", when: "the provider is slow", then: "the customer sees a wait message", recovery: "retry is safe" },
    { kind: "failure", when: "unknown order", then: "rejected naming the order" }] }] }));
  const section = html.slice(html.indexOf('id="failure-cards"'), html.indexOf('id="failure-cards"') + 1200);
  assert.match(section, /<div class="trig">the provider is slow<\/div><div><span>What happens<\/span>the customer sees a wait message<\/div><div><span>Recovery<\/span>retry is safe<\/div>/);
  assert.match(section, /<div class="trig">unknown order<\/div><div><span>What happens<\/span>rejected naming the order<\/div><\/div>/);
  assert.equal((html.match(/<span>Recovery<\/span>/g) || []).length, 1);
  assert.doesNotMatch(pageOf(t, pageDraft({ requirements: [{ key: "r", scenarios: [{ kind: "success", when: "a", then: "b" }] }] })), /id="failure-cards"/);
});

// Cards by work type.
const MIGRATION = {
  workType: ["migration"],
  migrationPlan: { from: "v1 refunds", to: "v2 refunds", seam: "port", cutover: "7 days parity", rollbackWindow: "14 days", parity: { check: "same rows", tolerance: "0" } },
  rollout: { strategy: "flag at 10%", rollback: "turn the flag off", rollbackProof: "enable/disable test passes" }
};
test("a migration shows the data card with its plan, rollout, and where undo came from", (t) => {
  const html = pageOf(t, pageDraft(MIGRATION));
  assert.match(html, /id="card-E" data-card="E"><div class="head"><span class="badge">E · Data<\/span>/);
  assert.match(html, /Can data be damaged, and can it be undone\?/);
  assert.match(html, /<dt>Cutover<\/dt><dd>7 days parity<\/dd>/);
  assert.match(html, /<dt>Can go back within<\/dt><dd>14 days<\/dd>/);
  assert.match(html, /<dt>Rollback<\/dt><dd>turn the flag off<\/dd>/);
  assert.match(html, /<b>How to undo<\/b>turn the flag off<span class="src">rollout<\/span>/);
});

test("mixed work types show each matching card once in a fixed order", (t) => {
  const html = pageOf(t, pageDraft({ workType: ["feature", "api", "data", "ui"] }));
  const order = [...html.matchAll(/data-card="([A-G])"/g)].map((match) => match[1]);
  assert.deepEqual(order, ["E", "D", "A"]);
});

test("docs-only work gets the light card and a checklist of the summary alone", (t) => {
  const html = pageOf(t, pageDraft({ workType: ["docs"], tasks: [{ paths: ["README.md"] }] }));
  assert.deepEqual([...html.matchAll(/data-card="([A-G])"/g)].map((match) => match[1]), ["C"]);
  const checklist = html.slice(html.indexOf('id="checklist"'));
  assert.match(checklist.slice(0, checklist.indexOf("</section>")), /<li class="y">.*Summary \(why\)/);
  assert.doesNotMatch(checklist.slice(0, checklist.indexOf("</section>")), /Failure table|Release note/);
});

test("a field the draft lacks reads unknown on its card instead of a guess", (t) => {
  const html = pageOf(t, pageDraft({ workType: ["privacy"] }));
  const card = html.slice(html.indexOf('data-card="G"'), html.indexOf('id="checklist"'));
  assert.match(card, /<h3>Personal data<\/h3>[\s\S]*<span class="unknown">unknown<\/span>/);
  assert.doesNotMatch(card, /retention<\/dt><dd>[^<]*[a-z]{3}/);
});

test("the checklist marks present and missing required sections and keeps recommendations apart", (t) => {
  // A rapid-lane or older draft can reach the page without a required section.
  const missing = pageOf(t, pageDraft({ workType: ["bugfix"] }));
  assert.match(missing, /<li class="n"><span class="mk" aria-hidden="true">✕<\/span><span>Bug analysis <span class="why">missing<\/span>/);
  assert.match(missing, /<li class="y"><span class="mk" aria-hidden="true">✓<\/span><span>Summary \(why\)/);
  assert.match(missing, /id="checklist"><h2>Required sections <span class="muted small">\d of 3<\/span>/);
  const complete = pageOf(t, pageDraft({ workType: ["bugfix"], bugfix: { reproduction: "r", rootCause: "c", regression: "g" } }));
  assert.doesNotMatch(complete.slice(complete.indexOf('id="checklist"'), complete.indexOf("</section>", complete.indexOf('id="checklist"'))), /<li class="n">Bug/);
  assert.match(complete, /<li class="y"><span class="mk" aria-hidden="true">✓<\/span><span>Bug analysis<\/span>/);
  // A field that used to be advice (ml evaluation) is now required, so it reads as missing.
  const ml = pageOf(t, pageDraft({ workType: ["ml"], modelCard: { intendedUse: "u", model: { provider: "p" }, fallback: "f", versionPin: "1" } }));
  assert.match(ml, /<li class="n"><span class="mk" aria-hidden="true">✕<\/span><span>Model card <span class="why">missing: Evaluation set<\/span>/);
  assert.doesNotMatch(ml, /class="tag rec"/);
  const none = pageOf(t, pageDraft({ workType: undefined, tasks: undefined }));
  assert.doesNotMatch(none, /id="checklist"/);
});

test("undo and who come from the author first, then from fields the draft has, else unknown", (t) => {
  const own = pageOf(t, pageDraft({ ...MIGRATION, scratch: { ...SCRATCH, undo: "Turn the flag off", who: "Customers" } }));
  assert.match(own, /<b>How to undo<\/b>Turn the flag off<span class="src">scratch\.undo<\/span>/);
  assert.match(own, /<b>Who is affected<\/b>Customers<span class="src">scratch\.who<\/span>/);
  const derived = pageOf(t, pageDraft({ ...MIGRATION, userStories: [{ asA: "a customer" }, { asA: "an admin" }] }));
  assert.match(derived, /<b>Who is affected<\/b>a customer, an admin<span class="src">userStories<\/span>/);
  const unknown = pageOf(t, pageDraft({ workType: ["feature"] }));
  assert.match(unknown, /<b>How to undo<\/b><span class="unknown">unknown<\/span>/);
  assert.match(unknown, /<b>Who is affected<\/b><span class="unknown">unknown<\/span>/);
});

test("card text and checklist labels exist in Thai and English with the same keys", (t) => {
  const thai = pageOf(t, pageDraft({ ...MIGRATION, language: "th" }));
  assert.match(thai, /ข้อมูลก่อน|ข้อมูลตั้งต้น|ข้อมูล<\/span>/);
  assert.match(thai, /ย้อนกลับได้ไหม/);
  assert.match(thai, /ส่วนที่ต้องมี/);
  const keys = (value, prefix = "") => Object.entries(value).flatMap(([key, item]) =>
    item && typeof item === "object" ? keys(item, `${prefix}${key}.`) : [`${prefix}${key}`]);
  assert.deepEqual(keys(packageText("th").cards).sort(), keys(packageText("en").cards).sort());
  assert.deepEqual(keys(packageText("th").reasons).sort(), keys(packageText("en").reasons).sort());
});

test("Thai text uses installed sans fonts in order and loads nothing from the network", (t) => {
  const html = pageOf(t, pageDraft({ language: "th", diagrams: undefined }));
  assert.match(html, /--sans: "Sukhumvit Set", "Leelawadee UI", "Noto Sans Thai", Thonburi, Tahoma, system-ui, sans-serif;/);
  assert.match(html, /font: 17px\/1\.75 var\(--sans\)/);
  assert.doesNotMatch(html, /@import|<link |url\(http|(?<!sans-)serif/);
  assert.match(html, /@media \(max-width: 640px\)/);
  assert.doesNotMatch(html, /<script|<form|<button|\son[a-z]+=/);
});

// Review repairs: sub-field checks, partial scratch, matching counts, no fallbacks.
test("the checklist names the missing fields of a section that is only partly written", (t) => {
  const bug = pageOf(t, pageDraft({ workType: ["bugfix"], bugfix: { reproduction: "r", rootCause: "c" } }));
  assert.match(bug, /<li class="n"><span class="mk" aria-hidden="true">✕<\/span><span>Bug analysis <span class="why">missing: Guards against return<\/span>/);
  assert.doesNotMatch(bug, /<li class="y"><span class="mk" aria-hidden="true">✓<\/span><span>Bug analysis/);
  const refactor = pageOf(t, pageDraft({ workType: ["refactor"], componentMap: [{ component: "c" }], refactor: { invariants: ["same"] } }));
  assert.match(refactor, /Refactor invariants <span class="why">missing: Proof of sameness<\/span>/);
  const whole = pageOf(t, pageDraft({ workType: ["bugfix"], bugfix: { reproduction: "r", rootCause: "c", regression: "g" } }));
  assert.match(whole, /<li class="y"><span class="mk" aria-hidden="true">✓<\/span><span>Bug analysis<\/span>/);
});

test("partial scratch without before and after still warns and shows no empty cards", (t) => {
  const html = pageOf(t, pageDraft({ scratch: { get: "G line", ifFail: "F line" } }));
  assert.match(html, /<p class="notice warn small">No plain-language summary yet/);
  assert.doesNotMatch(html, /class="ba(?: single)?"/);
  assert.match(html, /<p class="get"><b>What you get<\/b>G line<\/p>/);
  assert.doesNotMatch(pageOf(t, pageDraft()), /No plain-language summary yet/);
});

test("the scope strip counts the same questions the box lists", (t) => {
  const html = pageOf(t, pageDraft({ openQuestions: ["Partial refunds?", { question: "Who signs off?" }, "  ", { text: "  " }] }));
  assert.match(html, /<b>2<\/b> open questions/);
  assert.match(html, /Questions to answer before approving \(2\)/);
  const blank = pageOf(t, pageDraft({ openQuestions: ["  "] }));
  assert.match(blank, /<b>0<\/b> open questions/);
  assert.doesNotMatch(blank, /id="open-questions"/);
});

test("failure cards come only from failure scenarios, never from an authored matrix", (t) => {
  const html = pageOf(t, pageDraft({
    requirements: [{ key: "r", scenarios: [{ kind: "success", when: "a", then: "b" }] }],
    failureMatrix: [{ failure: "disk full", userSees: "an error", recovery: "free space" }]
  }));
  assert.doesNotMatch(html, /id="failure-cards"/);
  assert.doesNotMatch(html, /disk full/);
  assert.match(html, /<b>0<\/b> failure cases/);
});

test("with no reasons the page shows the level and scale but no reason list", (t) => {
  const { runtime, id } = fixture(t, { state: pageDraft() });
  const model = runtime.buildModel(id);
  const html = renderApprovalPackage({ ...model, route: { ...model.route, reasons: [] } });
  assert.match(html, /class="meter lvl-/);
  assert.match(html, /class="chip risk risk-/);
  assert.doesNotMatch(html, /id="risk-why"/);
});

test("optional undo and who never make a draft fail, at any impact", () => {
  const four = { get: "g", asIs: "a", toBe: "t", ifFail: "f" };
  for (const impact of ["low", "medium", "high"]) {
    for (const scratch of [{ ...four }, { ...four, undo: "u", who: "w" }, ...(impact === "low" ? [{ undo: "u", who: "w" }, {}] : [])])
      assert.deepEqual(scratchFieldIssues({ impact, scratch }), [], `${impact} ${Object.keys(scratch)}`);
  }
});

// Cards and checklist for data-fix, security, and cicd; none and unknown answers are shown with their reason.
test("a data fix shows the data card, takes undo from its rollback, and says unknown with the reason given", (t) => {
  const html = pageOf(t, pageDraft({ workType: ["data-fix"], dataFix: { scope: "unknown: needs a dry run to count",
    snapshot: "table copy refunds_bak", dryRun: "diff on staging", rerunSafe: "yes, keyed by id", rollback: "restore from refunds_bak" } }));
  assert.match(html, /data-card="E"/);
  assert.match(html, /<h3>Data fix<\/h3>/);
  assert.match(html, /<dt>Scope<\/dt><dd><span class="unknown">unknown<\/span> needs a dry run to count<\/dd>/);
  assert.match(html, /<dt>Snapshot before<\/dt><dd>table copy refunds_bak<\/dd>/);
  assert.match(html, /<b>How to undo<\/b>restore from refunds_bak<span class="src">dataFix<\/span>/);
  assert.match(html, /<li class="y"><span class="mk" aria-hidden="true">✓<\/span><span>Data fix plan<\/span>/);
});

test("a pipeline change shows the back-end card and security work shows the compliance card with its threat model", (t) => {
  const pipeline = pageOf(t, pageDraft({ workType: ["cicd"], pipelinePlan: { changes: "add a deploy job",
    permissions: "id-token write", blastRadius: "staging only", rollback: "revert the workflow" } }));
  assert.match(pipeline, /data-card="F"/);
  assert.match(pipeline, /<dt>Permissions and secrets<\/dt><dd>id-token write<\/dd>/);
  assert.match(pipeline, /<b>How to undo<\/b>revert the workflow<span class="src">pipelinePlan<\/span>/);
  const security = pageOf(t, pageDraft({ workType: ["security"],
    threatModel: { threats: [{ threat: "stolen token", likelihood: "low", impact: "high", control: "expiry", residual: "low" }] },
    hardening: { weakness: "sessions never expire", control: "8 hour expiry", verification: "none: no test harness yet" } }));
  assert.match(security, /data-card="G"/);
  assert.match(security, /<h3>Threats<\/h3>/);
  assert.match(security, /<dt>How it is verified<\/dt><dd><span class="unknown">none<\/span> no test harness yet<\/dd>/);
});

test("a section that must answer fixed fields reads missing, naming each field, until they are answered", (t) => {
  const half = pageOf(t, pageDraft({ workType: ["cicd"], pipelinePlan: { changes: "c", permissions: "p" } }));
  assert.match(half, /<li class="n">[^]*?Pipeline plan <span class="why">missing: [^<]*What changes[^<]*<\/span>|Pipeline plan <span class="why">missing: Blast radius, Rollback<\/span>/);
  const infra = pageOf(t, pageDraft({ workType: ["infra"], infraPlan: { planDiff: "+1", blastRadius: "b", environments: ["staging"] },
    rollout: { strategy: "s", rollback: "r" } }));
  assert.match(infra, /Infrastructure plan <span class="why">missing: Cost<\/span>/);
  const answered = pageOf(t, pageDraft({ workType: ["infra"], infraPlan: { planDiff: "+1", blastRadius: "b", environments: ["staging"],
    costDelta: "unknown: pricing not published" }, rollout: { strategy: "s", rollback: "r" } }));
  assert.doesNotMatch(answered, /Infrastructure plan <span class="why">/);
});

test("the checklist has no recommended entries while no section is only advised", (t) => {
  const html = pageOf(t, pageDraft({ workType: ["ml"], modelCard: { intendedUse: "u", model: "m", fallback: "f", versionPin: "1", evaluation: "unknown: no set yet" } }));
  assert.doesNotMatch(html, /class="skip"/);
  assert.match(html, /<dt>Evaluation set<\/dt><dd><span class="unknown">unknown<\/span> no set yet<\/dd>|Evaluation[^<]*<\/dt><dd><span class="unknown">unknown<\/span> no set yet/);
});

// Diagrams and prototype on the cards, no decision bar, and visual polish.
const FLOW = "flowchart LR\n  A --> B";
const SEQ = "sequenceDiagram\n  U->>S: go";
const STATE = "stateDiagram-v2\n  [*] --> a";
const section = (html, id) => {
  const start = html.indexOf(`id="card-${id}"`);
  if (start < 0) return "";
  const next = html.indexOf('<section class="type-card"', start + 1);
  const end = next > 0 ? next : html.indexOf('<div class="two">', start);
  return html.slice(start, end > 0 ? end : undefined);
};
const count = (html, text) => html.split(text).length - 1;
const diagramDraft = (extra = {}) => pageDraft({ diagrams: undefined, ...extra });
const mermaid = (type, key = "m") => ({ key, type: "mermaid", purpose: `P-${key}`, source: type });

test("the user flow is drawn inside card A, once, and not repeated in reviewer details", (t) => {
  const html = pageOf(t, diagramDraft({ userFlow: { purpose: "Flow", source: FLOW } }));
  const card = section(html, "A");
  assert.equal(count(card, 'class="mermaid"'), 1);
  assert.match(card, /<details class="diagram" open><summary>Flow<\/summary><div class="dg"><pre class="mermaid">flowchart LR/);
  assert.equal(count(html, "flowchart LR"), 1);
  assert.doesNotMatch(html.slice(html.indexOf('id="reviewer-details"')), /class="mermaid"/);
});

test("a user flow with a purpose but no source shows the purpose and no empty frame", (t) => {
  const html = pageOf(t, diagramDraft({ userFlow: { purpose: "Only words" } }));
  assert.match(section(html, "A"), /Only words/);
  assert.doesNotMatch(html, /class="diagram"|class="mermaid"/);
});

test("without the Mermaid file the diagram source stays readable text in its card", (t) => {
  const value = fixture(t, { state: diagramDraft({ userFlow: { purpose: "Flow", source: FLOW } }) });
  const model = { ...value.runtime.buildModel(value.id), mermaidHref: null };
  const html = renderApprovalPackage(model);
  assert.match(section(html, "A"), /<pre class="mermaid">flowchart LR\n  A --&gt; B<\/pre>/);
  assert.doesNotMatch(html, /<script/);
});

test("each diagram is placed once in the card it explains, by its kind", (t) => {
  const api = pageOf(t, diagramDraft({ workType: ["api", "feature"], apiContracts: [], diagrams: [mermaid(SEQ)] }));
  assert.equal(count(section(api, "D"), SEQ.split("\n")[0]), 1);
  assert.doesNotMatch(section(api, "A"), /sequenceDiagram/);
  assert.equal(count(api, "sequenceDiagram"), 1);
  const jobs = pageOf(t, diagramDraft({ workType: ["async"], diagrams: [mermaid(STATE)] }));
  assert.equal(count(section(jobs, "F"), "stateDiagram-v2"), 1);
  const docs = pageOf(t, diagramDraft({ workType: ["docs"], diagrams: [mermaid(SEQ)] }));
  assert.equal(count(section(docs, "C"), "sequenceDiagram"), 1);
  assert.equal(count(docs, "sequenceDiagram"), 1);
});

test("a diagram with no card to take it stays in the reviewer details", (t) => {
  const html = pageOf(t, diagramDraft({ workType: undefined, diagrams: [mermaid(SEQ)] }));
  assert.doesNotMatch(html, /id="card-/);
  const details = html.slice(html.indexOf('id="reviewer-details"'));
  assert.equal(count(details, "sequenceDiagram"), 1);
  assert.match(details, /id="diagrams"/);
});

test("a diagram frame is titled, open, and scrolls sideways; the page adds no script beyond the Mermaid loader", (t) => {
  const html = pageOf(t, diagramDraft({ userFlow: { purpose: "Flow", source: FLOW } }));
  assert.match(html, /\.diagram \.dg \{ overflow-x: auto;/);
  assert.equal(count(html, "<script"), count(html, "<script src="));
  assert.doesNotMatch(html, /<form|<button|\son[a-z]+=/);
});

test("a prototype leads the examples and stays open; other examples keep their order", (t) => {
  const examples = [TERMINAL("first"), TERMINAL("second"), { type: "prototype", title: "Proto", path: "p.html" }];
  const html = pageOf(t, diagramDraft({ examples }));
  const order = ["Proto", "first", "second"].map((title) => html.indexOf(`<h3>${title}</h3>`));
  assert.ok(order.every((index) => index > 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(html.indexOf('<h3>Proto</h3>') < html.indexOf('id="more-examples"') || !html.includes('id="more-examples"'));
  assert.match(html.slice(html.indexOf('id="example-0"')), /^id="example-0"><div class="block-h"><h3>Proto<\/h3>/);
});

test("card A says there is no prototype yet only when it is shown without one", (t) => {
  assert.match(section(pageOf(t, diagramDraft({ workType: ["ui"] })), "A"), /id="no-prototype"[^>]*>No prototype yet\./);
  assert.match(pageOf(t, diagramDraft({ workType: ["ui"], language: "th" })), /id="no-prototype"[^>]*>ยังไม่มี prototype/);
  const withProto = pageOf(t, diagramDraft({ workType: ["ui"], examples: [{ type: "prototype", title: "P", path: "p.html" }] }));
  assert.doesNotMatch(withProto, /id="no-prototype"/);
  assert.doesNotMatch(pageOf(t, diagramDraft({ workType: ["bugfix"] })), /id="no-prototype"/);
});

test("a ui draft without a prototype raises no issue about prototypes", () => {
  const issues = scratchFieldIssues({ language: "en", workType: ["ui"], examples: [] });
  assert.doesNotMatch(JSON.stringify(issues), /prototype/i);
});

test("before and after tags are compact, and the two personal-data cards have different headings", (t) => {
  const html = pageOf(t, diagramDraft());
  assert.doesNotMatch(html.slice(html.indexOf('class="ba'), html.indexOf('id="scope"')), /class="tag"/);
  assert.match(html, /\.ba \.side-tag \{ display: block; width: fit-content;/);
  const privacy = { privacyAssessment: { purpose: "p", retention: "r", data: [{ field: "email", class: "pii" }] } };
  for (const language of ["en", "th"]) {
    const card = section(pageOf(t, diagramDraft({ language, workType: ["privacy"], ...privacy })), "G");
    const heads = [...card.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
    assert.ok(heads.length >= 2 && new Set(heads).size === heads.length, `${language}: ${heads}`);
  }
});

test("the risk meter is coloured by level with the level also in words, and the page wraps long chips in both themes", (t) => {
  const html = pageOf(t, diagramDraft());
  assert.match(html, /class="meter lvl-(Low|Medium|High|Critical)"/);
  for (const level of ["Low", "Medium", "High", "Critical"]) assert.match(html, new RegExp(`\\.meter\\.lvl-${level} li\\.on`));
  assert.match(html, /class="chip risk risk-/);
  assert.match(html, /\.why li \{[^}]*overflow-wrap: anywhere/);
  assert.match(html, /\.chips li \{[^}]*max-width: 100%/);
  assert.match(html, /@media \(prefers-color-scheme: dark\) \{ :root \{[^}]*--high:[^}]*--shadow: none/);
  assert.doesNotMatch(html, /\.meter\.lvl-[A-Za-z]+ li\.on \{ background: #/);
});
