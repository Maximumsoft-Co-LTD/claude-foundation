import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { createApprovalPackageRuntime, previewSuggestions } from "../runtime/workflow/approval-package.mjs";
import { approvalPackageLine } from "../runtime/workflow/change-lifecycle.mjs";
import { routeChange } from "../runtime/contracts/scratch-router.mjs";

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function fixture(t, { state = {}, providers = {}, receipts = {}, previews = [] } = {}) {
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
  const runtime = createApprovalPackageRuntime({
    root, runtimeDir, packagesDir, previewsDir,
    loadRuntime: (changeId) => JSON.parse(readFileSync(join(runtimeDir, `${changeId}.json`), "utf8")),
    activeChangePath: (changeId) => join(root, "openspec", "changes", changeId),
    changeWorkTypes: () => ["docs"],
    evidence: () => ({ providers }),
    providerCapability: (name, config) => config?.capability || name,
    receiptValidity: (changeId, provider) => receipts[provider] || { provider, validity: "missing" },
    fail: (message) => { throw new Error(message); }
  });
  return { root, id, runtime, runtimeDir, packagesDir, statePath: join(runtimeDir, `${id}.json`) };
}

test("package writes one section per role and one mermaid block per diagram", (t) => {
  const { root, id, runtime, packagesDir } = fixture(t);
  const result = runtime.writePackage(id);
  assert.equal(result.path, join(".foundation", "packages", `${id}.html`));
  const html = readFileSync(join(packagesDir, `${id}.html`), "utf8");
  for (const role of routeChange({ workTypes: ["feature", "ui"], impact: "medium" }).roles)
    assert.match(html, new RegExp(`id="role-${role}"`));
  assert.equal((html.match(/<pre class="mermaid">/g) || []).length, 2);
  assert.match(html, /Show the board\./);
  assert.doesNotMatch(html, /<script|https?:\/\//, "self-contained, nothing loaded from outside");
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

test("the approval output links the package or warns without failing", (t) => {
  assert.equal(approvalPackageLine({ path: ".foundation/packages/demo.html" }),
    "  approval package: .foundation/packages/demo.html\n");
  assert.match(approvalPackageLine({ error: "boom" }), /warning: approval package not written \(boom\)/);
  assert.equal(approvalPackageLine(null), "");
  const { runtime } = fixture(t);
  assert.match(runtime.tryWritePackage("missing-change").error, /missing-change/);
});
