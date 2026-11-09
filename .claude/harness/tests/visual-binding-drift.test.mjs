import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readVisualBinding, runVisualReview, visualProviderConfig, withVisualRequirement
} from "../runtime/evidence/visual-review.mjs";
import { providerCapability } from "../runtime/evidence/provider-catalog.mjs";
import { requiredProvidersOperation } from "../runtime/workflow/change-validation.mjs";

const SOURCE = ".foundation/prototypes/x/screen.html";
const CLAIMS = [{ id: "C-a", requirementKey: "A", scenario: "a", capabilities: ["test"] }];

function packet(t, { mode } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "visual-drift-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "prototype"));
  const bytes = "<html><button>Save</button></html>";
  writeFileSync(join(dir, "prototype", "screen.html"), bytes);
  writeFileSync(join(dir, "shot.png"), "png");
  writeFileSync(join(dir, "prototype", "binding.json"), JSON.stringify({
    version: 1, file: "prototype/screen.html", source: SOURCE,
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

// Runs the review the way the provider command does: from the spec the
// harness writes, with a runner that records whether the reviewer was asked.
function review(dir) {
  const binding = readVisualBinding(dir);
  const config = visualProviderConfig({
    changeId: "change", packetPath: dir, packetRelative: "openspec/changes/change",
    binding, scriptPath: "visual-review.mjs", base: { screenshots: ["shot.png"] }
  });
  const spec = JSON.parse(config.command.at(-1));
  let asked = 0;
  const result = runVisualReview({
    workspace: dir, prototype: spec.prototype, prototypeSha256: spec.prototypeSha256,
    prototypeSource: spec.prototypeSource, screenshots: ["shot.png"], claimIds: spec.claims,
    runner: () => { asked += 1; return { status: "pass", summary: "same", findings: [] }; }
  });
  return { result, asked };
}

test("an edited strict copy keeps visual required and errors without asking the reviewer", (t) => {
  const dir = packet(t);
  writeFileSync(join(dir, "prototype", "screen.html"), "<html>edited</html>");
  const binding = readVisualBinding(dir);
  assert.equal(binding.intact, false);
  const contract = withVisualRequirement({ version: 2, claims: CLAIMS, providers: {} }, binding);
  assert.deepEqual(contract.claims[0].capabilities, ["test", "visual"]);
  assert.ok(required(contract).includes("visual"));
  const { result, asked } = review(dir);
  assert.equal(result.status, "error");
  assert.match(result.summary, /does not match its bound digest/);
  assert.match(result.summary, new RegExp(`restore it from ${SOURCE.replaceAll(".", "\\.")}`));
  assert.match(result.summary, /change revise before Build/);
  assert.equal(asked, 0);
});

test("a missing strict copy keeps visual required and errors naming the missing copy", (t) => {
  const dir = packet(t);
  rmSync(join(dir, "prototype", "screen.html"));
  const binding = readVisualBinding(dir);
  assert.equal(binding.present, false);
  const contract = withVisualRequirement({ version: 2, claims: CLAIMS, providers: {} }, binding);
  assert.ok(required(contract).includes("visual"));
  const { result, asked } = review(dir);
  assert.equal(result.status, "error");
  assert.match(result.summary, /bound prototype copy is missing/);
  assert.match(result.summary, /restore it from/);
  assert.equal(asked, 0);
});

test("an edited advisory copy is still reported as an error without becoming required", (t) => {
  const dir = packet(t, { mode: "advisory" });
  writeFileSync(join(dir, "prototype", "screen.html"), "<html>edited</html>");
  const contract = withVisualRequirement({ version: 2, claims: CLAIMS, providers: {} },
    readVisualBinding(dir));
  assert.equal(contract.visualAdvisory, true, "the advisory provider still runs");
  assert.ok(!required(contract).includes("visual"));
  const { result, asked } = review(dir);
  assert.equal(result.status, "error");
  assert.equal(asked, 0);
});

test("an intact copy is reviewed as before", (t) => {
  const dir = packet(t);
  const { result, asked } = review(dir);
  assert.equal(result.status, "pass");
  assert.equal(asked, 1);
});
