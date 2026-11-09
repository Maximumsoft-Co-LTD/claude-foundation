import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readVisualBinding, reconcileVisualBinding, runVisualReview, visualProviderConfig,
  withVisualRequirement
} from "../runtime/evidence/visual-review.mjs";
import { providerCapability } from "../runtime/evidence/provider-catalog.mjs";
import { requiredProvidersOperation } from "../runtime/workflow/change-validation.mjs";

const CLAIMS = [
  { id: "C-a", requirementKey: "A", scenario: "a", capabilities: ["test"] },
  { id: "C-b", requirementKey: "B", scenario: "b", capabilities: ["test"] }
];
const IDS = CLAIMS.map((claim) => claim.id);

function packet(t, claims, { mode } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "visual-claims-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "prototype"));
  const bytes = "<html><button>Save</button></html>";
  writeFileSync(join(dir, "prototype", "screen.html"), bytes);
  writeFileSync(join(dir, "shot.png"), "png");
  writeFileSync(join(dir, "prototype", "binding.json"), JSON.stringify({
    version: 1, file: "prototype/screen.html", source: ".foundation/prototypes/x/screen.html",
    sha256: createHash("sha256").update(bytes).digest("hex"), claims, ...(mode ? { mode } : {})
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

// Reads the binding the way the evidence contract does, then runs the review
// from the provider spec the harness writes.
function check(dir) {
  const binding = reconcileVisualBinding(readVisualBinding(dir), IDS);
  const contract = withVisualRequirement({ version: 2, claims: CLAIMS, providers: {} }, binding);
  const config = visualProviderConfig({
    changeId: "change", packetPath: dir, packetRelative: "openspec/changes/change",
    binding, scriptPath: "visual-review.mjs", base: { screenshots: ["shot.png"] }
  });
  const spec = JSON.parse(config.command.at(-1));
  let asked = 0;
  const result = runVisualReview({
    workspace: dir, prototype: spec.prototype, prototypeSha256: spec.prototypeSha256,
    prototypeSource: spec.prototypeSource, bindingIssue: spec.bindingIssue,
    screenshots: ["shot.png"], claimIds: spec.claims,
    runner: () => { asked += 1; return { status: "pass", summary: "same", findings: [] }; }
  });
  const bound = contract.claims.filter((claim) => claim.capabilities.includes("visual"))
    .map((claim) => claim.id);
  return { bound, required: required(contract), result, asked };
}

test("a strict binding with no claims binds every claim and errors without the reviewer", (t) => {
  const { bound, required: providers, result, asked } = check(packet(t, []));
  assert.deepEqual(bound, IDS);
  assert.ok(providers.includes("visual"));
  assert.equal(result.status, "error");
  assert.match(result.summary, /binds no claim/);
  assert.match(result.summary, /change revise before Build/);
  assert.equal(asked, 0);
});

test("a strict binding naming only unknown claims binds every claim and names them", (t) => {
  const { bound, result, asked } = check(packet(t, ["ghost"]));
  assert.deepEqual(bound, IDS);
  assert.equal(result.status, "error");
  assert.match(result.summary, /does not have: ghost/);
  assert.equal(asked, 0);
});

test("a strict binding mixing known and unknown claims binds every claim and names the unknown", (t) => {
  const { bound, result, asked } = check(packet(t, ["C-a", "ghost"]));
  assert.deepEqual(bound, IDS);
  assert.equal(result.status, "error");
  assert.match(result.summary, /does not have: ghost/);
  assert.doesNotMatch(result.summary, /C-a/);
  assert.equal(asked, 0);
});

test("a strict binding naming known claims binds only them and is reviewed as before", (t) => {
  const { bound, result, asked } = check(packet(t, ["C-a"]));
  assert.deepEqual(bound, ["C-a"]);
  assert.equal(result.status, "pass");
  assert.equal(asked, 1);
});

test("an advisory binding with no claims is left to report without requiring visual", (t) => {
  const binding = reconcileVisualBinding(readVisualBinding(packet(t, [], { mode: "advisory" })), IDS);
  assert.equal(binding.bindingIssue, undefined);
  const contract = withVisualRequirement({ version: 2, claims: CLAIMS, providers: {} }, binding);
  assert.ok(!required(contract).includes("visual"));
});
