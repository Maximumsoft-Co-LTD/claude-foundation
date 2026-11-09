import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readVisualBinding, runVisualReview, visualProviderConfig, withVisualRequirement
} from "../runtime/evidence/visual-review.mjs";
import { providerCapability } from "../runtime/evidence/provider-catalog.mjs";
import { requiredProvidersOperation } from "../runtime/workflow/change-validation.mjs";

const CLAIMS = [
  { id: "C-a", requirementKey: "A", scenario: "a", capabilities: ["test"] },
  { id: "C-b", requirementKey: "B", scenario: "b", capabilities: ["test"] }
];

function packet(t, binding) {
  const dir = mkdtempSync(join(tmpdir(), "visual-record-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "prototype"));
  writeFileSync(join(dir, "prototype", "screen.html"), "<html><button>Save</button></html>");
  writeFileSync(join(dir, "shot.png"), "png");
  writeFileSync(join(dir, "prototype", "binding.json"),
    typeof binding === "string" ? binding : JSON.stringify(binding));
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

// The review the provider command runs from the spec the harness writes.
function review(dir, binding) {
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
  return { result, asked, config };
}

for (const [name, record] of [
  ["unparseable", "{not json"],
  ["unsupported version", { version: 9, file: "prototype/screen.html", claims: ["C-a"] }]
]) {
  test(`an ${name} binding.json binds every claim to visual and errors without the reviewer`, (t) => {
    const dir = packet(t, record);
    const binding = readVisualBinding(dir);
    assert.equal(binding.corrupt, true, "an unreadable record is never read as no prototype");
    const contract = withVisualRequirement({ version: 2, claims: CLAIMS, providers: {} }, binding);
    for (const claim of contract.claims) assert.ok(claim.capabilities.includes("visual"), claim.id);
    assert.ok(required(contract).includes("visual"));
    const { result, asked, config } = review(dir, binding);
    assert.equal(result.status, "error");
    assert.match(result.summary, /binding\.json/);
    assert.match(result.summary, /change revise before Build/);
    assert.equal(asked, 0);
    assert.deepEqual(config.inputs, ["openspec/changes/change/prototype/binding.json", "shot.png"]);
  });
}

for (const [name, sha256] of [["no", undefined], ["a malformed", "abc"]]) {
  test(`a strict binding with ${name} sha256 keeps visual required and errors without the reviewer`, (t) => {
    const dir = packet(t, { version: 1, file: "prototype/screen.html", claims: ["C-a"],
      ...(sha256 === undefined ? {} : { sha256 }) });
    const binding = readVisualBinding(dir);
    assert.equal(binding.intact, false);
    const contract = withVisualRequirement({ version: 2, claims: CLAIMS, providers: {} }, binding);
    assert.ok(contract.claims.find((claim) => claim.id === "C-a").capabilities.includes("visual"));
    assert.ok(!contract.claims.find((claim) => claim.id === "C-b").capabilities.includes("visual"));
    assert.ok(required(contract).includes("visual"));
    const { result, asked } = review(dir, binding);
    assert.equal(result.status, "error");
    assert.match(result.summary, /no valid sha256/);
    assert.equal(asked, 0);
  });
}
