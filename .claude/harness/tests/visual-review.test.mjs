import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  NO_SCREENSHOT_SUMMARY, VISUAL_REVIEW_PROTOCOL, matchScreenshots, readVisualBinding,
  runVisualReview, visualProviderConfig, visualReceiptResult, visualReviewOutcome,
  visualReviewPrompt, withVisualRequirement
} from "../runtime/evidence/visual-review.mjs";
import { claimsForCapability } from "../runtime/evidence/evidence-contract.mjs";
import { PROVIDERS, providerCapability } from "../runtime/evidence/provider-catalog.mjs";
import { requiredProvidersOperation } from "../runtime/workflow/change-validation.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "runtime", "evidence", "visual-review.mjs");

const CLAIMS = [
  { id: "C-a", requirementKey: "A", scenario: "a", capabilities: ["test"] },
  { id: "C-b", requirementKey: "B", scenario: "b", capabilities: ["test"] }
];

function packet({ mode } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "visual-packet-"));
  mkdirSync(join(dir, "prototype"));
  const bytes = "<html><button>Save</button></html>";
  writeFileSync(join(dir, "prototype", "screen.html"), bytes);
  writeFileSync(join(dir, "prototype", "binding.json"), JSON.stringify({
    version: 1, file: "prototype/screen.html", source: ".foundation/prototypes/x/screen.html",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...(mode ? { mode } : {}), requirements: ["A"], claims: ["C-a"], tasks: ["T001"]
  }));
  return dir;
}

function required(contract) {
  return requiredProvidersOperation({
    loadRuntime: () => ({}),
    evidence: () => contract,
    providerCapability,
    reviewPolicy: () => ({ required: false }),
    resolvedAcceptance: () => ({ required: false }),
    policyCapabilitySplit: () => ({ enforced: [] })
  }, "change");
}

function covered(contract, capability) {
  return claimsForCapability({
    evidence: () => contract,
    policyCapabilities: () => []
  }, "change", contract.claims, capability).map((claim) => claim.id);
}

test("visual is a known capability", () => {
  assert.ok(PROVIDERS.has("visual"));
});

test("strict is the default: the bound claim requires visual", () => {
  const dir = packet();
  try {
    const binding = readVisualBinding(dir);
    assert.equal(binding.mode, "strict");
    assert.equal(binding.intact, true);
    const contract = withVisualRequirement({ version: 2, claims: CLAIMS, providers: {} }, binding);
    assert.deepEqual(contract.claims.find((claim) => claim.id === "C-a").capabilities, ["test", "visual"]);
    assert.deepEqual(contract.claims.find((claim) => claim.id === "C-b").capabilities, ["test"]);
    assert.ok(required(contract).includes("visual"));
    assert.deepEqual(covered(contract, "visual"), ["C-a"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a prototype edited after binding no longer counts as intact", () => {
  const dir = packet();
  try {
    writeFileSync(join(dir, "prototype", "screen.html"), "<html>edited</html>");
    assert.equal(readVisualBinding(dir).intact, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("advisory reports only: visual is not required, but a visual provider still covers and reports", () => {
  const dir = packet({ mode: "advisory" });
  try {
    const contract = withVisualRequirement({ version: 2, claims: CLAIMS, providers: {} },
      readVisualBinding(dir));
    assert.ok(contract.claims.every((claim) => !claim.capabilities.includes("visual")));
    assert.ok(!required(contract).includes("visual"));
    assert.deepEqual(covered(contract, "visual"), ["C-a"]);
    const outcome = runVisualReview({
      workspace: dir, prototype: join(dir, "prototype", "screen.html"),
      screenshots: ["shot.png"], claimIds: ["C-a"],
      runner: () => ({ status: "fail", summary: "moved", findings: [{
        id: "V1", screen: "settings", difference: "Save button is top-left, prototype shows bottom-right",
        severity: "major", claimIds: ["C-a"] }] })
    });
    assert.equal(outcome.status, "fail");
    assert.equal(outcome.findings.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("no prototype: no claim requires visual and no visual provider is proposed", () => {
  const dir = mkdtempSync(join(tmpdir(), "visual-none-"));
  try {
    assert.equal(readVisualBinding(dir), null);
    const contract = { version: 2, claims: CLAIMS, providers: {} };
    assert.equal(withVisualRequirement(contract, null), contract);
    assert.ok(!required(contract).includes("visual"));
    assert.deepEqual(covered(contract, "visual"), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("matching screens pass with no differences", () => {
  let prompt = null;
  const dir = packet();
  try {
    const outcome = runVisualReview({
      workspace: dir, prototype: join(dir, "prototype", "screen.html"),
      screenshots: ["test-results/settings.png"], claimIds: ["C-a"],
      runner: (request) => { prompt = request.prompt; return { status: "pass", summary: "same", findings: [] }; }
    });
    assert.equal(outcome.status, "pass");
    assert.deepEqual(outcome.findings, []);
    assert.match(prompt, /prototype\/screen\.html/);
    assert.match(prompt, /test-results\/settings\.png/);
    const receipt = visualReceiptResult({ protocol: VISUAL_REVIEW_PROTOCOL, ...outcome }, "pass");
    assert.equal(receipt.status, "pass");
    assert.deepEqual(receipt.visual.findings, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a mismatch fails with the screen, the difference, and its severity", () => {
  const review = { status: "fail", summary: "primary action moved", findings: [{
    id: "V1", screen: "settings", difference: "primary button sits in the header, not the footer",
    severity: "major", claimIds: ["C-a"] }] };
  const outcome = visualReviewOutcome(review, { claimIds: ["C-a"] });
  assert.equal(outcome.status, "fail");
  assert.deepEqual(outcome.findings[0], review.findings[0]);
  const receipt = visualReceiptResult({ protocol: VISUAL_REVIEW_PROTOCOL, ...outcome }, "fail");
  assert.equal(receipt.status, "fail");
  assert.equal(receipt.visual.findings[0].screen, "settings");
  assert.equal(receipt.visual.findings[0].severity, "major");
  // A pass that still carries a blocking difference is refused, never recorded as pass.
  assert.equal(visualReviewOutcome({ ...review, status: "pass" }).status, "error");
  assert.equal(visualReceiptResult({ protocol: VISUAL_REVIEW_PROTOCOL, status: "pass",
    summary: "x", findings: review.findings }, "pass").status, "error");
  // A fail must name what differs, and findings must cite bound claims.
  assert.equal(visualReviewOutcome({ status: "fail", summary: "x", findings: [] }).status, "error");
  assert.equal(visualReviewOutcome(review, { claimIds: ["C-b"] }).status, "error");
});

test("minor differences alone pass but stay listed", () => {
  const outcome = visualReviewOutcome({ status: "fail", summary: "spacing", findings: [{
    id: "V2", screen: "settings", difference: "8px wider gap", severity: "minor", claimIds: ["C-a"] }] });
  assert.equal(outcome.status, "pass");
  const receipt = visualReceiptResult({ protocol: VISUAL_REVIEW_PROTOCOL, ...outcome }, "pass");
  assert.equal(receipt.visual.findings.length, 1);
  assert.match(receipt.observed, /not an exact match/);
});

test("no screenshot is inconclusive, never a pass, and asks for screenshot wiring", () => {
  let called = false;
  const dir = packet();
  try {
    const outcome = runVisualReview({
      workspace: dir, prototype: join(dir, "prototype", "screen.html"), screenshots: [],
      runner: () => { called = true; return { status: "pass", summary: "x", findings: [] }; }
    });
    assert.equal(called, false);
    assert.equal(outcome.status, "inconclusive");
    assert.equal(outcome.summary, NO_SCREENSHOT_SUMMARY);
    assert.equal(visualReceiptResult({ protocol: VISUAL_REVIEW_PROTOCOL, ...outcome }, "fail").status,
      "inconclusive");
    // A hand-recorded or report-less pass cannot stand in for the review.
    assert.equal(visualReceiptResult(null, "pass").status, "inconclusive");
    // The harness-run command reports the same and exits non-zero without a model call.
    const result = spawnSync(process.execPath, [SCRIPT, JSON.stringify({
      prototype: join(dir, "prototype", "screen.html"), screenshots: ["test-results"],
      report: ".foundation/visual/change.json"
    })], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 1);
    const report = JSON.parse(readFileSync(join(dir, ".foundation", "visual", "change.json"), "utf8"));
    assert.equal(report.protocol, VISUAL_REVIEW_PROTOCOL);
    assert.equal(report.status, "inconclusive");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("screenshots are matched with the provider-input pattern language", () => {
  const dir = mkdtempSync(join(tmpdir(), "visual-shots-"));
  try {
    mkdirSync(join(dir, "test-results", "nested"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
    writeFileSync(join(dir, "test-results", "a.png"), "a");
    writeFileSync(join(dir, "test-results", "nested", "b.jpeg"), "b");
    writeFileSync(join(dir, "test-results", "trace.zip"), "z");
    writeFileSync(join(dir, "node_modules", "x", "c.png"), "c");
    assert.deepEqual(matchScreenshots(dir, ["test-results/**"]),
      ["test-results/a.png", "test-results/nested/b.jpeg"]);
    assert.deepEqual(matchScreenshots(dir, ["test-results/*"]), ["test-results/a.png"]);
    assert.deepEqual(matchScreenshots(dir, []), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the visual provider declares the prototype and screenshots as its inputs", () => {
  const dir = packet();
  try {
    const config = visualProviderConfig({
      changeId: "change", packetPath: dir, packetRelative: "openspec/changes/change",
      binding: readVisualBinding(dir), scriptPath: SCRIPT,
      base: { screenshots: ["test-results/**"] }
    });
    assert.equal(config.adapter, "command");
    assert.equal(config.capability, "visual");
    assert.deepEqual(config.inputs, ["openspec/changes/change/prototype/screen.html", "test-results/**"]);
    assert.equal(config.report, ".foundation/visual/change.json");
    const spec = JSON.parse(config.command[2]);
    assert.equal(spec.prototypeSha256, readVisualBinding(dir).sha256);
    assert.match(visualReviewPrompt({ prototype: spec.prototype, screenshots: ["s.png"] }), /s\.png/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
