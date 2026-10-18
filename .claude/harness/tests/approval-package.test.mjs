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
    assert.match(html, /Risk level <strong>Critical<\/strong>|Risk level <strong>High<\/strong>/);
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
