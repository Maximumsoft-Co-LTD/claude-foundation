import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { createPreviewRuntime, previewReceiptPath } from "../runtime/workflow/preview-runtime.mjs";
import { createApprovalPackageRuntime } from "../runtime/workflow/approval-package.mjs";
import { assertSpecApproval } from "../runtime/core/user-decisions.mjs";

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(t, { state = {}, providers = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foundation-preview-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtimeDir = join(root, ".foundation", "runtime");
  const previewsDir = join(root, ".foundation", "previews");
  const id = "demo";
  write(join(runtimeDir, `${id}.json`), { id, status: "change", contractRevision: 1, ...state });
  write(join(root, "src", "plan.txt"), "target bytes\n");
  const spawned = [];
  const runtime = createPreviewRuntime({
    root, runtimeDir, previewsDir,
    loadRuntime: (changeId) => JSON.parse(readFileSync(join(runtimeDir, `${changeId}.json`), "utf8")),
    evidence: () => ({ providers }),
    providerCapability: (name, config) => config?.capability || name,
    copyWorkspace: (source, destination) => cpSync(join(source, "src"), join(destination, "src"), { recursive: true }),
    now: () => "2026-10-18T00:00:00.000Z",
    fail: (message, code, details) => { throw Object.assign(new Error(message), details || {}); },
    spawn: (...args) => { spawned.push(args); return spawnSync(...args); }
  });
  return { root, id, runtime, previewsDir, runtimeDir, spawned };
}

const node = (script) => [process.execPath, "-e", script];

test("a declared provider runs in the preview copy and records a preview receipt", (t) => {
  const { root, id, runtime, previewsDir, spawned } = fixture(t, {
    providers: { "plan-check": { command: node("require('fs').writeFileSync('src/plan.txt','changed'); console.log('plan ok')") } }
  });
  const result = runtime.runPreview(id, { provider: "plan-check" });
  const receipt = JSON.parse(readFileSync(previewReceiptPath(previewsDir, id, "plan-check"), "utf8"));
  assert.equal(receipt.kind, "preview");
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.contractRevision, 1);
  assert.match(receipt.outputTail, /plan ok/);
  assert.equal(spawned[0][2].cwd, join(previewsDir, id, "workspace"));
  assert.equal(readFileSync(join(root, "src", "plan.txt"), "utf8"), "target bytes\n", "target untouched");
  assert.equal(result.path, join(".foundation", "previews", id, "receipts", "plan-check.json"));
});

test("an undeclared provider fails naming it", (t) => {
  const { id, runtime, previewsDir } = fixture(t);
  assert.throws(() => runtime.runPreview(id, { provider: "ghost" }), /ghost/);
  assert.equal(existsSync(join(previewsDir, id)), false);
});

test("an external provider without the user's decision is refused before anything runs", (t) => {
  const { id, runtime, spawned, previewsDir } = fixture(t, {
    providers: { sandbox: { external: true, command: node("process.exit(0)") } }
  });
  assert.throws(() => runtime.runPreview(id, { provider: "sandbox" }),
    (error) => error.code === "PREVIEW_AUTHORITY_REQUIRED" && /decision-ref/.test(error.message));
  assert.equal(spawned.length, 0);
  assert.equal(existsSync(join(previewsDir, id)), false);
});

test("an external provider with the user's decision runs and records it", (t) => {
  const { id, runtime, previewsDir } = fixture(t, {
    providers: { sandbox: { external: true, environment: "payment-sandbox", command: node("process.exit(0)") } }
  });
  runtime.runPreview(id, { provider: "sandbox", decisionRef: "user-ok" });
  const receipt = JSON.parse(readFileSync(previewReceiptPath(previewsDir, id, "sandbox"), "utf8"));
  assert.equal(receipt.decisionRef, "user-ok");
  assert.equal(receipt.environment, "payment-sandbox");
});

test("a failing provider records a failed preview without throwing", (t) => {
  const { id, runtime } = fixture(t, { providers: { check: { command: node("process.exit(3)") } } });
  assert.equal(runtime.runPreview(id, { provider: "check" }).receipt.status, "fail");
});

test("preview is refused once Build owns the workspace", (t) => {
  const { id, runtime } = fixture(t, {
    state: { status: "building", workspace: { path: "x" } },
    providers: { check: { command: node("process.exit(0)") } }
  });
  assert.throws(() => runtime.runPreview(id, { provider: "check" }), /only before Build/);
});

test("a preview from an earlier revision is shown as stale in the package", (t) => {
  const { root, id, runtime, previewsDir, runtimeDir } = fixture(t, {
    state: { impact: "high", draftSource: { contractRevision: 1, draft: { workType: ["ui"] } } },
    providers: { shots: { capability: "browser", command: node("process.exit(0)") } }
  });
  runtime.runPreview(id, { provider: "shots" });
  write(join(runtimeDir, `${id}.json`), {
    id, status: "change", contractRevision: 2, impact: "high",
    draftSource: { contractRevision: 2, draft: { workType: ["ui"] } }
  });
  const packages = createApprovalPackageRuntime({
    root, runtimeDir, packagesDir: join(root, ".foundation", "packages"), previewsDir,
    loadRuntime: (changeId) => JSON.parse(readFileSync(join(runtimeDir, `${changeId}.json`), "utf8")),
    activeChangePath: (changeId) => join(root, "openspec", "changes", changeId),
    changeWorkTypes: () => [], evidence: () => ({ providers: { shots: { capability: "browser" } } }),
    providerCapability: (name, config) => config?.capability || name,
    receiptValidity: () => ({ validity: "missing" }), fail: (message) => { throw new Error(message); }
  });
  assert.equal(packages.buildModel(id).artifacts.find((row) => row.id === "shot").evidence, "stale");
});

test("a Critical change without any preview still passes the approval gate", (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundation-preview-optional-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = { id: "demo", impact: "high", riskSignals: ["financial"], specApproval: null };
  assert.doesNotThrow(() => assertSpecApproval(root, "demo", state));
  assert.equal(existsSync(join(root, ".foundation", "previews")), false);
});
