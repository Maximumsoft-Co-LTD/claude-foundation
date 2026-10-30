import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createEvidenceContract } from "../runtime/evidence/evidence-contract.mjs";
import { requiredProvidersOperation } from "../runtime/workflow/change-validation.mjs";

// The shipped evidence contract, through the CLI: a previewOnly provider is
// outside the proof contract, so Prove's wiring rules never reach it.
const FOUNDATION = fileURLToPath(new URL("../foundation.mjs", import.meta.url));

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

function project(t, providers) {
  const root = mkdtempSync(join(tmpdir(), "foundation-preview-only-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(join(root, "openspec", "config.yaml"), "schema: foundation-standard\n");
  write(join(root, ".claude", "harness", "foundation.mjs"), "// project marker\n");
  write(join(root, ".foundation", "runtime", "demo.json"), { id: "demo", status: "change", contractRevision: 0, impact: "high" });
  write(join(root, "openspec", "changes", "demo", "proposal.md"), "## Summary\n\nDemo.\n");
  write(join(root, "openspec", "changes", "demo", "evidence.yaml"), {
    version: 2,
    claims: [{ id: "a11y-1", requirementKey: "a11y", scenario: "announced", impact: "high", capabilities: ["accessibility"] }],
    providers
  });
  write(join(root, "scratch", "prototype.html"), "<p>prototype</p>\n");
  const run = (...args) => spawnSync(process.execPath, [FOUNDATION, ...args], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, CLAUDE_FOUNDATION_PROJECT: root, FOUNDATION_TELEMETRY: "0" }
  });
  return { root, run };
}

const A11Y = { adapter: "command", capability: "accessibility", command: ["true"], claims: "declared" };

test("a previewOnly provider needs no claims or inputMode and runs as a preview", (t) => {
  const { run } = project(t, {
    accessibility: A11Y,
    "a11y-preview": { previewOnly: true, adapter: "command", capability: "accessibility",
      command: [process.execPath, "-e", "console.log('labels ok')"] },
    shots: { previewOnly: true, adapter: "command", capability: "browser", command: [process.execPath, "-e", "0"] }
  });
  const preview = run("preview", "demo", "--provider", "a11y-preview");
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  assert.match(preview.stdout, /a11y-preview: pass/);
  const pkg = run("package", "demo");
  assert.equal(pkg.status, 0, pkg.stderr || pkg.stdout);
  assert.doesNotMatch(pkg.stdout, /evidence not read/);
});

test("the proof contract and Prove's required providers exclude previewOnly providers", () => {
  const EVIDENCE = { version: 2, claims: [
    { id: "a11y-1", requirementKey: "a11y", scenario: "announced", impact: "low", capabilities: ["accessibility"] }
  ], providers: {
    "a11y-preview": { previewOnly: true, adapter: "command", capability: "accessibility", command: ["true"] }
  } };
  const noop = () => ({});
  const contract = createEvidenceContract({
    ROOT: "/root", PROVIDERS: new Set(["accessibility"]), ADAPTERS: new Set(["command"]), INPUT_MODES: new Set(),
    EXCLUDED_WORKSPACE_DIRS: new Set(), ADAPTER_PROTOCOL_VERSION: 1, PROVIDER_PROTOCOL_VERSION: 1,
    activeChangePath: () => "/root/openspec/changes/demo",
    readJson: (path) => path.endsWith("evidence.yaml") ? EVIDENCE : { version: 1, providers: {}, services: {} },
    repositoryById: noop, selectedRepositories: () => [], providerCapability: (name, config) => config?.capability || name,
    canonicalPath: (value) => value, loadRuntime: noop, relevantHash: noop, relevantSnapshot: noop,
    singleRelevantSnapshot: noop, fileDigest: noop, stableHash: (value) => JSON.stringify(value),
    filesystemEntryIdentity: noop, policyCapabilities: () => [], foundationPolicy: () => ({ workflow: {} }),
    handoffContract: () => ({ operations: [] }), git: noop, declaredSurfaceMatcher: () => () => true,
    die: (message) => { throw new Error(message); }
  });
  const value = contract.evidence("demo");
  assert.deepEqual(Object.keys(value.providers), []);
  assert.deepEqual(Object.keys(value.previewProviders), ["a11y-preview"]);
  const required = requiredProvidersOperation({
    loadRuntime: () => ({}), evidence: () => ({ ...value, claims: [{ capabilities: ["accessibility"] }] }),
    providerCapability: (name, config) => config?.capability || name,
    reviewPolicy: () => ({ required: false }), resolvedAcceptance: () => ({ required: false }),
    policyCapabilitySplit: () => ({ enforced: [] }), foundationPolicy: () => ({})
  }, "demo");
  assert.ok(![...required].includes("a11y-preview"), "Prove never selects the preview-only provider");
});

test("a previewOnly provider without a command is refused", (t) => {
  const { run } = project(t, { accessibility: A11Y, broken: { previewOnly: true, adapter: "command", capability: "browser" } });
  const result = run("preview", "demo", "--provider", "broken");
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /no command/);
});

test("a previewOnly provider named like a path is refused and never touches Prove receipts", (t) => {
  const { root, run } = project(t, {
    accessibility: A11Y,
    "../../../receipts/demo/test": { previewOnly: true, adapter: "command", capability: "browser",
      command: [process.execPath, "-e", "0"] }
  });
  write(join(root, ".foundation", "receipts", "demo", "test.json"), { provider: "test", status: "pass" });
  const result = run("preview", "demo", "--provider", "../../../receipts/demo/test");
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /invalid provider (instance id|name)/);
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".foundation", "receipts", "demo", "test.json"), "utf8")),
    { provider: "test", status: "pass" }, "the Prove receipt is untouched");
});

test("the preview artifact is kept and linked; a path outside the workspace is refused", (t) => {
  const { root, run } = project(t, {
    accessibility: A11Y,
    shots: { previewOnly: true, adapter: "command", capability: "browser",
      command: [process.execPath, "-e", "0"], previewArtifact: "scratch/prototype.html" },
    escape: { previewOnly: true, adapter: "command", capability: "browser",
      command: [process.execPath, "-e", "require('fs').writeFileSync('ran','1')"], previewArtifact: "../secret.txt" }
  });
  assert.equal(run("preview", "demo", "--provider", "shots").status, 0);
  const refused = run("preview", "demo", "--provider", "escape");
  assert.notEqual(refused.status, 0);
  assert.match(`${refused.stderr}${refused.stdout}`, /outside the preview workspace/);
  assert.equal(existsSync(join(root, ".foundation", "previews", "demo", "workspace", "ran")), false, "nothing ran");
  write(join(root, ".foundation", "runtime", "demo.json"),
    { id: "demo", status: "change", contractRevision: 0, impact: "high", draftSource: { contractRevision: 0, draft: { workType: ["ui"] } } });
  const packaged = run("package", "demo");
  assert.equal(packaged.status, 0, packaged.stderr || packaged.stdout);
  assert.ok(existsSync(join(root, ".foundation", "previews", "demo", "artifacts", "shots-prototype.html")));
  // `package` prints the kept copy as a path inside the preview folder and writes no page.
  const listed = JSON.parse(packaged.stdout).previews.find((row) => row.provider === "shots");
  assert.equal(listed.artifact, ".foundation/previews/demo/artifacts/shots-prototype.html");
  assert.equal(existsSync(join(root, ".foundation", "packages")), false, "the harness writes no approval page");
});
