import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createApprovalPackageRuntime, previewSuggestions } from "../runtime/workflow/approval-package.mjs";
import { approvalPackageLine } from "../runtime/workflow/change-lifecycle.mjs";
import { routeChange } from "../runtime/contracts/scratch-router.mjs";

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const FOUNDATION = fileURLToPath(new URL("../foundation.mjs", import.meta.url));

const DRAFT = {
  language: "en", workType: ["feature", "ui"], intent: "Show the board",
  userFlow: { purpose: "Flow", source: "flowchart LR\n  A --> B" },
  diagrams: [{ key: "states", type: "mermaid", purpose: "States", source: "stateDiagram-v2\n  [*] --> a" }]
};

function fixture(t, { state = {}, providers = {}, previewProviders = {}, receipts = {}, previews = [],
  storedReceipts = {}, receiptValidity = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foundation-approval-data-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtimeDir = join(root, ".foundation", "runtime");
  const previewsDir = join(root, ".foundation", "previews");
  const id = "demo";
  const statePath = join(runtimeDir, `${id}.json`);
  write(statePath, {
    id, contractRevision: 1, impact: "medium", riskSignals: [], coupling: "isolated",
    draftSource: { contractRevision: 1, draft: DRAFT },
    ...state
  });
  write(join(root, "openspec", "changes", id, "proposal.md"), "## Summary\n\nShow the board.\n\n## Why\n\nBecause.\n");
  for (const row of previews) write(join(previewsDir, id, "receipts", `${row.provider}.json`), row);
  const receiptsDir = join(root, ".foundation", "receipts");
  for (const [provider, receipt] of Object.entries(storedReceipts)) write(join(receiptsDir, id, `${provider}.json`), receipt);
  const runtime = createApprovalPackageRuntime({
    root, runtimeDir, previewsDir, receiptsDir,
    loadRuntime: (changeId) => JSON.parse(readFileSync(join(runtimeDir, `${changeId}.json`), "utf8")),
    saveRuntime: (value) => write(join(runtimeDir, `${value.id}.json`), value),
    activeChangePath: (changeId) => join(root, "openspec", "changes", changeId),
    changeWorkTypes: () => ["docs"],
    evidence: () => ({ providers, previewProviders }),
    providerCapability: (name, config) => config?.capability || name,
    receiptValidity: receiptValidity || ((changeId, provider) => receipts[provider] || { provider, validity: "missing" }),
    fail: (message) => { throw new Error(message); }
  });
  const page = (text, name = "prototype.html") => write(join(previewsDir, id, name), text);
  return { root, id, runtime, runtimeDir, previewsDir, statePath, page, packagesDir: join(root, ".foundation", "packages") };
}
const withDraft = (draft) => ({ draftSource: { contractRevision: 1, draft } });
const PROTOTYPE = { type: "prototype", title: "page", path: "prototype.html" };

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

test("only a valid passing receipt earns the proof label", (t) => {
  const { id, runtime } = fixture(t, {
    providers: { test: { adapter: "test-discovery" } },
    receipts: { test: { provider: "test", validity: "valid", receipt: { provider: "test", status: "pass" } } }
  });
  assert.equal(runtime.buildModel(id).artifacts.find((row) => row.id === "testmap").evidence, "proof");
  assert.deepEqual(runtime.packageData(id).facts.proven, ["test"]);
});

test("a valid receipt that did not pass, or an invalid passing one, is not proof", (t) => {
  for (const result of [
    { provider: "test", validity: "valid", receipt: { provider: "test", status: "fail" } },
    { provider: "test", validity: "contract-stale", status: "pass" }
  ]) {
    const { id, runtime } = fixture(t, { providers: { test: {} }, receipts: { test: result } });
    assert.equal(runtime.buildModel(id).artifacts.find((row) => row.id === "testmap").evidence, "none");
    assert.deepEqual(runtime.packageData(id).facts.proven, []);
  }
});

test("a preview receipt is labeled preview, never proof, and stale after a revision", (t) => {
  const { id, runtime } = fixture(t, {
    state: { impact: "high" },
    providers: { shots: { capability: "browser" } },
    previews: [{ kind: "preview", provider: "shots", capability: "browser", contractRevision: 1, status: "pass" }]
  });
  assert.equal(runtime.buildModel(id).artifacts.find((row) => row.id === "shot").evidence, "preview");
  assert.deepEqual(runtime.packageData(id).facts.proven, [], "a preview is never proof");
  const stale = fixture(t, {
    state: { impact: "high", contractRevision: 2, draftSource: { contractRevision: 2, draft: { workType: ["ui"] } } },
    providers: { shots: { capability: "browser" } },
    previews: [{ kind: "preview", provider: "shots", capability: "browser", contractRevision: 1, status: "pass" }]
  });
  assert.equal(stale.runtime.buildModel(stale.id).artifacts.find((row) => row.id === "shot").evidence, "stale");
});

test("a Critical change suggests the matching provider with its preview command", (t) => {
  const { id, runtime } = fixture(t, {
    state: { impact: "high", riskSignals: ["financial"] },
    providers: { race: { capability: "concurrency" }, sandbox: { capability: "browser", external: true } }
  });
  const commands = runtime.packageData(id).suggestions.flatMap((row) => row.providers.map((provider) => provider.command));
  assert.ok(commands.includes("claude-foundation preview demo --provider race"));
  assert.ok(commands.some((command) => /--provider sandbox --decision-ref/.test(command)));
});

test("a High change without a matching provider names the capability to declare", () => {
  const rows = previewSuggestions(routeChange({ workTypes: ["data", "migration"], impact: "high" }), [], "demo");
  const migration = rows.find((row) => row.capability === "data-migration");
  assert.ok(migration);
  assert.deepEqual(migration.providers, []);
});

test("a Medium change has no suggested previews", (t) => {
  const { id, runtime } = fixture(t, { providers: { race: { capability: "concurrency" } } });
  assert.deepEqual(runtime.packageData(id).suggestions, []);
});

test("the data carries risk, domains, roles, labels, scratch lines, scope, failures, and the checklists", (t) => {
  const { id, runtime } = fixture(t, {
    state: withDraft({
      language: "en", intent: "Pay out", workType: ["api"], impact: "medium",
      scratch: { get: "G", asIs: "A", toBe: "T", ifFail: "F", undo: "off", who: "owners" },
      tasks: [{ paths: ["a/**", "b.mjs"] }, { paths: ["a/**"] }], openQuestions: ["Which currency?"],
      apiContracts: [{ method: "POST", path: "/p", errors: [{ status: 400, when: "empty" }] }],
      requirements: [{ key: "r", scenarios: [
        { kind: "success" }, { kind: "failure", when: "empty", then: "400", recovery: "retry" }] }]
    })
  });
  const data = runtime.packageData(id);
  assert.equal(data.change, id);
  assert.equal(data.revision, 1);
  assert.ok(["Low", "Medium", "High", "Critical"].includes(data.risk.level));
  assert.ok(Array.isArray(data.risk.reasons) && Array.isArray(data.domains) && Array.isArray(data.roles));
  assert.ok(data.artifacts.length >= 2 && data.artifacts.every((row) => "evidence" in row));
  assert.deepEqual({ get: data.scratch.get, asIs: data.scratch.asIs, toBe: data.scratch.toBe, ifFail: data.scratch.ifFail },
    { get: "G", asIs: "A", toBe: "T", ifFail: "F" });
  assert.equal(data.scratch.undo.value, "off");
  assert.equal(data.scratch.who.value, "owners");
  assert.deepEqual(data.scope, { files: 2, questions: 1, failures: 1 });
  assert.deepEqual(data.openQuestions, ["Which currency?"]);
  assert.deepEqual(data.failures, [{ when: "empty", sees: "400", recovery: "retry" }]);
  assert.ok(Array.isArray(data.requiredSections));
  assert.deepEqual(data.approval, { approved: false, missingLanes: [] });
  assert.match(data.factsDigest, /^[0-9a-f]{16}$/);
  assert.equal(data.prototype.checklist.items.find((row) => row.key === "api").present, true);
});

test("a count the draft cannot give is unknown, never zero, and a missing field stays null", (t) => {
  const { id, runtime } = fixture(t, { state: withDraft({ language: "en", workType: ["docs"] }) });
  const data = runtime.packageData(id);
  assert.deepEqual(data.scope, { files: null, questions: null, failures: null });
  assert.equal(data.scratch.get, null);
  assert.equal(data.scratch.undo, null);
});

test("a change without a current typed draft still prints data, marked legacy with a limited view", (t) => {
  const { id, runtime } = fixture(t, { state: { draftSource: null } });
  const data = runtime.packageData(id);
  assert.equal(data.legacy, true);
  assert.equal(data.intent, "Show the board.");
  assert.equal(data.prototype.checklist, null);
  assert.deepEqual(data.requiredSections, []);
});

test("an unknown change fails naming the id", (t) => {
  const { runtime } = fixture(t);
  assert.throws(() => runtime.packageData("missing-change"), /missing-change/);
});

test("the data never writes a file or changes lifecycle state, and no packages folder appears", (t) => {
  const { id, runtime, statePath, packagesDir, root } = fixture(t);
  const before = digest(statePath);
  runtime.packageData(id);
  runtime.approvalPageLink(id);
  assert.equal(digest(statePath), before);
  assert.equal(existsSync(packagesDir), false);
  assert.equal(existsSync(join(root, ".foundation", "packages", `${id}.html`)), false);
});

test("a page that claims everything passed does not raise a proof count or change the facts digest", (t) => {
  const { id, runtime, page } = fixture(t, { state: withDraft({ ...DRAFT, examples: [PROTOTYPE] }) });
  page("<p>all tests passed, proof: 99</p>");
  const data = runtime.packageData(id);
  assert.deepEqual(data.facts.proven, []);
  assert.ok(data.artifacts.every((row) => row.evidence !== "proof"));
  const same = fixture(t, { state: withDraft({ ...DRAFT, examples: [PROTOTYPE] }) });
  same.page("<p>a different page</p>");
  assert.equal(same.runtime.packageData(same.id).factsDigest, data.factsDigest, "the page text is not an input to the facts");
});

test("the facts digest changes when a receipt starts to pass", (t) => {
  const failing = fixture(t, { providers: { test: {} }, receipts: { test: { provider: "test", validity: "missing" } } });
  const passing = fixture(t, { providers: { test: {} }, receipts: {
    test: { provider: "test", validity: "valid", receipt: { provider: "test", status: "pass" } } } });
  assert.notEqual(failing.runtime.packageData(failing.id).factsDigest, passing.runtime.packageData(passing.id).factsDigest);
});

test("the prototype checklist is none without a page, unknown without covers, and complete with them", (t) => {
  const ui = { language: "en", workType: ["ui"], uiStates: [{ screen: "s" }], userFlow: DRAFT.userFlow,
    scratch: { asIs: "a", toBe: "b" }, requirements: [{ key: "r", scenarios: [{ kind: "failure" }] }] };
  const none = fixture(t, { state: withDraft(ui) });
  assert.equal(none.runtime.packageData(none.id).prototype.checklist.state, "none");
  const unknown = fixture(t, { state: withDraft({ ...ui, examples: [PROTOTYPE] }) });
  assert.equal(unknown.runtime.packageData(unknown.id).prototype.checklist.state, "unknown");
  const complete = fixture(t, { state: withDraft({ ...ui, examples: [{ ...PROTOTYPE, covers: ["flow", "states", "ba", "fail"] }] }) });
  const report = complete.runtime.packageData(complete.id).prototype.checklist;
  assert.equal(report.state, "complete");
  assert.equal(report.advisory, true, "a declaration is a claim, not proof");
});

test("the approval page link names the file the skill wrote, in the draft's language", (t) => {
  const { id, runtime, page } = fixture(t, { state: withDraft({ ...DRAFT, language: "th", examples: [PROTOTYPE] }) });
  page("page");
  const link = runtime.approvalPageLink(id);
  assert.equal(link.path, join(".foundation", "previews", id, "prototype.html"));
  assert.equal(link.language, "th");
  assert.match(approvalPackageLine(link), /^  หน้าอนุมัติ: \.foundation\/previews\/demo\/prototype\.html\n/);
  assert.doesNotMatch(approvalPackageLine(link), /package/);
});

test("with no page yet, the link gives the summary as text and says to use the skill, without failing", (t) => {
  const { id, runtime } = fixture(t, { state: withDraft({
    ...DRAFT, scratch: { get: "Get line", asIs: "As line", toBe: "To line", ifFail: "Fail line" } }) });
  const link = runtime.approvalPageLink(id);
  assert.equal(link.missing, true);
  assert.deepEqual(link.summary, ["Get line", "As line", "To line", "Fail line"]);
  const text = approvalPackageLine(link);
  assert.match(text, /approval page: none yet; the prototype skill writes it/);
  assert.match(text, /Get line/);
});

test("the approval line formats a path with warnings, a missing page, an error, and nothing", () => {
  assert.equal(approvalPackageLine({ path: "x.html", language: "en", warnings: [] }), "  approval page: x.html\n");
  assert.match(approvalPackageLine({ path: "x.html", language: "en", warnings: ["edited"] }), /warning: edited/);
  assert.match(approvalPackageLine({ error: "boom" }), /warning: approval page not checked \(boom\)/);
  assert.equal(approvalPackageLine(null), "");
  assert.match(approvalPackageLine({ error: "boom", language: "th" }), /หน้าอนุมัติ/);
});

test("a link for an unknown change reports an error instead of throwing", (t) => {
  assert.match(fixture(t).runtime.approvalPageLink("missing-change").error, /missing-change/);
});

test("recording stores the page digest, an edit then shows as drift, and recording again clears it", (t) => {
  const { id, runtime, page, runtimeDir } = fixture(t, { state: withDraft({ ...DRAFT, examples: [PROTOTYPE] }) });
  const facts = () => runtime.packageData(id).factsDigest;
  page(`v1 ${facts()}`);
  const snapshot = runtime.recordPrototypeSync(id);
  assert.equal(snapshot.revision, 1);
  assert.equal(JSON.parse(readFileSync(join(runtimeDir, `${id}.json`), "utf8")).prototypeSync.pageDigest, snapshot.pageDigest);
  assert.equal(runtime.packageData(id).prototype.sync.drift, false);
  page(`v2 edited ${facts()}`);
  const drifted = runtime.packageData(id);
  assert.equal(drifted.prototype.sync.drift, true);
  assert.ok(drifted.warnings.some((line) => /edited after revision 1/.test(line)));
  assert.ok(runtime.approvalPageLink(id).warnings.some((line) => /edited after revision 1/.test(line)));
  runtime.recordPrototypeSync(id);
  assert.equal(runtime.packageData(id).prototype.sync.drift, false);
});

test("a page without the current facts digest is stale and a page carrying it is not", (t) => {
  const { id, runtime, page } = fixture(t, { state: withDraft({ ...DRAFT, examples: [PROTOTYPE] }) });
  page("an old page");
  runtime.recordPrototypeSync(id);
  assert.equal(runtime.packageData(id).prototype.sync.factsStale, true);
  page(`a page with ${runtime.packageData(id).factsDigest}`);
  assert.equal(runtime.packageData(id).prototype.sync.factsStale, false);
});

// The shipped runtime fails through die(), which exits the process unless the
// call is trapped; only a real CLI run shows that the data survives it.
function cliProject(t, evidenceText) {
  const root = mkdtempSync(join(tmpdir(), "foundation-approval-data-cli-"));
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

test("package prints JSON, writes no file, and warns when evidence wiring is invalid", (t) => {
  for (const evidenceText of [
    JSON.stringify({ version: 2, claims: [], providers: { race: { capability: "concurrency", command: ["true"] } } }),
    "{ not json"
  ]) {
    const { root, run } = cliProject(t, evidenceText);
    const result = run("package", "demo");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const data = JSON.parse(result.stdout);
    assert.equal(data.change, "demo");
    assert.ok(["Critical", "High"].includes(data.risk.level));
    assert.ok(data.warnings.some((line) => /evidence not read/.test(line)), data.warnings.join("\n"));
    assert.equal(existsSync(join(root, ".foundation", "packages")), false, "no packages folder is written");
    assert.doesNotMatch(result.stdout, /^PACKAGE /m);
  }
});

test("package --pretty indents the same JSON", (t) => {
  const { run } = cliProject(t, JSON.stringify({ version: 2, claims: [] }));
  const compact = run("package", "demo");
  const pretty = run("package", "demo", "--pretty");
  assert.equal(compact.status, 0);
  assert.deepEqual(JSON.parse(pretty.stdout), JSON.parse(compact.stdout));
  assert.match(pretty.stdout, /\n  "change": "demo"/);
});

test("package still refuses an unknown change from the CLI", (t) => {
  const { root, run } = cliProject(t, JSON.stringify({ version: 2, claims: [] }));
  const result = run("package", "missing-change");
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(root, ".foundation", "packages", "missing-change.html")), false);
});
