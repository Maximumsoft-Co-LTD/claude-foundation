import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertValidationPreflight,
  createChangeValidationRuntime,
  lockValidatedGrounding,
  normalizeValidationAcceptance,
  reportDeclaredSurfaceForecast,
  reportValidationReviewAssurance,
  validateImplementationTasks,
  validationChangeDirectory,
  validationDocumentBudgets,
  validationPreflightIssues,
  warnValidationDocumentBudgets
} from "../runtime/workflow/change-validation.mjs";

const fail = (message) => { throw new Error(message); };

function validationRuntimeFixture() {
  const root = mkdtempSync(join(tmpdir(), "foundation-validation-phases-"));
  const packet = join(root, "change-a");
  const state = {
    id: "change-a",
    status: "change",
    schema: "foundation-rapid",
    impact: "medium",
    coupling: "isolated",
    size: "s",
    groundingRequired: false,
    acceptance: { decision: "not-required" }
  };
  const contract = {
    claims: [{ id: "claim-a", impact: "medium", capabilities: [] }],
    providers: {}
  };
  const saved = [];
  const handoffs = [];
  mkdirSync(packet, { recursive: true });
  writeFileSync(join(packet, "proposal.md"), "# Proposal\nBounded change.\n");
  writeFileSync(join(packet, "tasks.md"),
    "- [ ] T001 Implement behavior [claims:claim-a] [paths:src/runtime.mjs]\n");
  writeFileSync(join(packet, "evidence.yaml"), "version: 1\n");
  const runtime = createChangeValidationRuntime({
    root,
    activeChangePath: () => packet,
    changePath: () => packet,
    walk: () => {},
    loadRuntime: () => state,
    saveRuntime: (value) => saved.push(structuredClone(value)),
    evidence: () => contract,
    selectedRepositories: () => [{ id: "root", workspacePath: root }],
    providerCapability: (provider, config) => config?.capability || provider,
    providerConfig: (_id, provider) => contract.providers[provider],
    resolvedAcceptance: () => ({ required: false, version: 2, claimIds: [] }),
    reviewPolicy: () => ({ required: true, independenceWaived: false }),
    reviewAssurancePosture: () => ({ summary: "fresh independent review" }),
    policyCapabilities: () => [],
    policyCapabilityTrigger: () => null,
    changedSurfaceResolvable: () => true,
    forecastCapabilities: () => ({ capabilities: ["review"] }),
    rawExecution: () => ({ providers: {} }),
    handoffContract: (id, value) => handoffs.push({ id, value }),
    contractFingerprint: () => "fingerprint",
    commandExists: () => true,
    stableHash: () => "hash",
    fileDigest: () => "digest",
    pathInside: () => true,
    knownProviders: new Set(),
    writeJson: () => {},
    now: () => "2026-08-26T00:00:00Z",
    fail
  });
  return { runtime, state, contract, saved, handoffs, packet };
}

test("validation preflight reports every unresolved prerequisite", () => {
  assert.deepEqual(validationPreflightIssues("change-a", {
    impact: "", coupling: "", acceptance: { decision: "undecided" }
  }, ["design.md", "tasks.md"]), [
    "missing change artifacts: design.md, tasks.md",
    "resolve impact for 'change-a'",
    "resolve coupling for 'change-a'",
    "acceptance decision is unresolved for 'change-a'; ask the user whether subjective human acceptance is required, then resolve with --acceptance-required or --acceptance-not-required"
  ]);
  assert.deepEqual(validationPreflightIssues("change-a", {
    impact: "medium", coupling: "isolated", acceptance: { decision: "not-required" }
  }), []);
  assert.throws(() => assertValidationPreflight("change-a", {
    status: "archived", impact: "medium", coupling: "isolated"
  }, [], fail), /already archived/);
  assert.throws(() => assertValidationPreflight("change-a", {
    status: "change", impact: "", coupling: "isolated"
  }, [], fail), /validation preflight failed/);
  assert.doesNotThrow(() => assertValidationPreflight("change-a", {
    status: "change", impact: "medium", coupling: "isolated"
  }, [], fail));
});

test("validation selects root or active packet without hiding state", () => {
  const state = { id: "change-a" };
  assert.equal(validationChangeDirectory("change-a", "root", state,
    () => "/active", () => "/root"), "/root");
  assert.equal(validationChangeDirectory("change-a", "active", state,
    (id, received) => `/active/${id}/${received.id}`, () => "/root"),
  "/active/change-a/change-a");
});

test("implementation task validation preserves IDs and rejects malformed gates", () => {
  const tasks = [
    { id: "T001", done: false, text: "Implement runtime/workflow/land-runtime.mjs" },
    { id: "T002", done: true, text: "Run /prove" }
  ];
  assert.deepEqual(validateImplementationTasks(tasks, fail), ["T001", "T002"]);
  assert.throws(() => validateImplementationTasks([
    { id: "", done: false, text: "Implement" }
  ], fail), /stable ID/);
  assert.throws(() => validateImplementationTasks([
    { id: "T001", done: false, text: "First" },
    { id: "T001", done: false, text: "Second" }
  ], fail), /duplicate task IDs/);
  assert.throws(() => validateImplementationTasks([
    { id: "T001", done: false, text: "Then run `/land`" }
  ], fail), /lifecycle gate/);
});

test("acceptance normalization validates scope and persists resolved policy", () => {
  const claims = [{ id: "claim-a" }, { id: "claim-b" }];
  assert.throws(() => normalizeValidationAcceptance("change-a", {}, claims, {
    required: true, version: 2, claimIds: ["unknown"]
  }, fail), /unknown claim/);
  assert.throws(() => normalizeValidationAcceptance("change-a", {}, claims, {
    required: true, version: 2, claimIds: []
  }, fail), /nothing is in scope/);

  const warnings = [];
  const legacyState = {};
  const legacy = normalizeValidationAcceptance("change-a", legacyState, claims, {
    required: true, version: 1, claimIds: [], reason: "human sign-off"
  }, fail, (message) => warnings.push(message), "2026-08-26T00:00:00Z");
  assert.deepEqual(legacy.claimIds, ["claim-a", "claim-b"]);
  assert.equal(legacyState.acceptance.scopeOrigin, "legacy-all");
  assert.equal(legacyState.acceptance.declaredAt, "2026-08-26T00:00:00Z");
  assert.match(warnings[0], /migrated legacy acceptance scope/);

  const capabilityState = { acceptance: { declaredAt: "existing" } };
  normalizeValidationAcceptance("change-a", capabilityState, claims, {
    required: true,
    version: 2,
    claimIds: ["claim-a"],
    scopeOrigin: "claim-capability"
  }, fail, (message) => warnings.push(message), "ignored");
  assert.equal(capabilityState.acceptance.reason, "declared evidence capability");
  assert.equal(capabilityState.acceptance.declaredAt, "existing");
  assert.match(warnings.at(-1), /claim-capability|acceptance stays required/);

  const untouched = {};
  assert.equal(normalizeValidationAcceptance("change-a", untouched, claims, {
    required: false, version: 2, claimIds: []
  }, fail).required, false);
  assert.equal(untouched.acceptance, undefined);
});

test("document budgets follow size and impact policy", () => {
  assert.equal(validationDocumentBudgets({ size: "XS", impact: "high" })["design.md"], 1400);
  assert.equal(validationDocumentBudgets({ size: "m", impact: "low" })["tasks.md"], 900);
  assert.equal(validationDocumentBudgets({ size: "m", impact: "high" })["proposal.md"], 1600);
});

test("document budget warnings inspect only existing oversized artifacts", () => {
  const warnings = [];
  const content = new Map([
    ["/packet/proposal.md", Array(901).fill("word").join(" ")],
    ["/packet/tasks.md", "short"]
  ]);
  warnValidationDocumentBudgets("/packet", { size: "s", impact: "high" },
    (path) => content.has(path), (path) => content.get(path),
    (message) => warnings.push(message));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /proposal\.md is 901 words/);
});

test("declared surface forecast reports wiring actions and review consequence", () => {
  const warnings = [];
  reportDeclaredSurfaceForecast("change-a", {}, false, new Set(),
    () => ({ capabilities: ["test"] }), (message) => warnings.push(message));
  assert.deepEqual(warnings, []);
  reportDeclaredSurfaceForecast("change-a", { declaredSurface: ["src/**"] }, true,
    new Set(), () => ({ capabilities: ["test"] }),
    (message) => warnings.push(message));
  assert.deepEqual(warnings, []);
  reportDeclaredSurfaceForecast("change-a", { declaredSurface: ["src/**"] }, false,
    new Set(["test"]), () => ({ capabilities: ["test"] }),
    (message) => warnings.push(message));
  assert.deepEqual(warnings, []);
  reportDeclaredSurfaceForecast("change-a", { declaredSurface: ["src/**"] }, false,
    new Set(), () => ({ capabilities: ["test", "review"] }),
    (message) => warnings.push(message));
  assert.equal(warnings.length, 5);
  assert.match(warnings[1], /evidence init change-a --write/);
  assert.match(warnings[3], /fresh reviewer/);
});

test("review assurance report is quiet when unavailable and explains active gates", () => {
  const notes = [];
  assert.equal(reportValidationReviewAssurance(true, true,
    { required: true }, { summary: "high" }, (message) => notes.push(message)), null);
  assert.equal(reportValidationReviewAssurance(false, false,
    { required: true }, null, (message) => notes.push(message)), null);
  assert.equal(reportValidationReviewAssurance(false, true,
    { required: false }, null, (message) => notes.push(message)), null);
  const assurance = { summary: "independent reviewer configured" };
  assert.equal(reportValidationReviewAssurance(false, true,
    { required: true, independenceWaived: false }, assurance,
    (message) => notes.push(message)), assurance);
  assert.equal(notes.length, 3);
  assert.match(notes[0], /assurance posture/);
  assert.match(notes[1], /requires review evidence/);
});

test("grounding lock records first lock and closes a pending reopen", () => {
  const untouched = { id: "change-a" };
  lockValidatedGrounding(untouched, null, null, null);
  assert.deepEqual(untouched, { id: "change-a" });

  const locked = {};
  lockValidatedGrounding(locked, {
    firstLock: true, digest: "digest-a", lockedAt: "locked-at"
  }, "fingerprint", "completed-at");
  assert.equal(locked.groundingDigest, "digest-a");
  assert.equal(locked.groundingReopens, undefined);

  const reopened = {
    groundingReopens: [{ reason: "prior" }],
    groundingReopenPending: { reason: "scope changed" }
  };
  lockValidatedGrounding(reopened, {
    firstLock: true, digest: "digest-b", lockedAt: "new-lock"
  }, "fingerprint", "completed-at");
  assert.deepEqual(reopened.groundingReopens.at(-1), {
    reason: "scope changed",
    newDigest: "digest-b",
    newLockedAt: "new-lock",
    contractFingerprint: "fingerprint",
    completedAt: "completed-at"
  });
  assert.equal(reopened.groundingReopenPending, undefined);
});

test("validation runtime orchestrates contract, state, advisory, and review phases", () => {
  const fixture = validationRuntimeFixture();
  const quiet = fixture.runtime.validate("change-a", "root", { quiet: true });
  assert.deepEqual(quiet, {
    version: 1, changeId: "change-a", reviewAssurance: null
  });
  assert.equal(fixture.saved.length, 1);
  assert.equal(fixture.handoffs[0].id, "change-a");
  assert.deepEqual(fixture.state.evidenceCapabilities, []);

  fixture.state.declaredSurface = ["src/**"];
  fixture.contract.claims[0].impact = "high";
  const messages = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (message) => messages.push(String(message));
  console.log = (message) => messages.push(String(message));
  try {
    const visible = fixture.runtime.validate("change-a", "active");
    assert.equal(visible.reviewAssurance.summary, "fresh independent review");
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
  assert.equal(fixture.state.reviewRequired, true);
  assert.equal(fixture.saved.length, 2);
  assert.ok(messages.some((message) => message.includes("review assurance posture")));
  assert.ok(messages.some((message) => message.includes("VALID change-a")));

  writeFileSync(join(fixture.packet, "design.md"),
    "# Design\n\n## Decisions\n\nnone\n\n## Compatibility and migration\n\nnone\n");
  fixture.state.decisionMetadataRequired = true;
  assert.equal(fixture.runtime.validate("change-a", "root", { quiet: true }).changeId,
    "change-a");
});
