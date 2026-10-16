import assert from "node:assert/strict";
import test from "node:test";

import {
  addRequiredCapability,
  missingHighRiskQualityCapabilities,
  postReleaseRolloutGates,
  providersForCapability,
  requiredProvidersOperation,
  reviewCoveredAdvisories
} from "../runtime/workflow/change-validation.mjs";
import { providerCapability as catalogCapability, proofRolloutGates } from
  "../runtime/evidence/provider-catalog.mjs";

test("a waived post-release capability is recorded as a waived gate, not a deferred one", () => {
  const state = { waivers: [{ capability: "release-health", reason: "no telemetry yet" }] };
  const gates = postReleaseRolloutGates({
    evidence: () => ({ providers: {}, claims: [] }),
    providerCapability: catalogCapability,
    policyRolloutCapabilities: () => ["release-health", "experiment-guardrail"],
    loadRuntime: () => state
  }, "change-a");
  assert.deepEqual(gates.map((gate) => [gate.capability, gate.status]),
    [["experiment-guardrail", "deferred"], ["release-health", "waived"]]);
  assert.deepEqual(proofRolloutGates({ rolloutGates: gates }, { deferred: true })
    .map((gate) => gate.capability), ["experiment-guardrail"]);
});

test("a proof finalized before rollout gates existed owes none", () => {
  assert.deepEqual(proofRolloutGates({ version: 2, status: "pass" }), []);
  assert.deepEqual(proofRolloutGates(null, { deferred: true }), []);
  assert.deepEqual(proofRolloutGates({ rolloutGates: "bad" }), []);
});

const providers = {
  "test-global": { capability: "test" },
  "test-api": { capability: "test", repository: "api" },
  "test-web": { capability: "test", repository: "web" },
  discovery: { capability: "discovery", repository: "api" },
  review: { capability: "review" },
  acceptance: { capability: "acceptance" },
  security: { capability: "security-static" },
  quality: { capability: "changed-quality" },
  mutants: { capability: "mutation" }
};
const capability = (provider, config) => config.capability || provider;

test("provider catalog resolves configured, built-in, and unknown capabilities", () => {
  assert.equal(catalogCapability("custom", { capability: "test" }), "test");
  assert.equal(catalogCapability("review"), "review");
  assert.equal(catalogCapability("changed-quality"), "changed-quality");
  assert.equal(catalogCapability("unknown"), null);
  assert.equal(catalogCapability("test", null), "test");
  for (const name of ["evaluation", "release-health", "parity", "plan-check",
    "experiment-guardrail"]) assert.equal(catalogCapability(name), name);
});

test("enforced high-risk policy requires changed quality and mutation providers", () => {
  const result = requiredProvidersOperation({
    loadRuntime: () => ({ impact: "high", securityTriggers: [], waivers: [] }),
    evidence: () => ({ providers, claims: [] }),
    providerCapability: capability,
    reviewPolicy: () => ({ required: false }),
    resolvedAcceptance: () => ({ required: false }),
    policyCapabilitySplit: () => ({ enforced: [] }),
    foundationPolicy: () => ({ quality: { changeGate: "enforce-high-risk" } })
  }, "change-a");
  assert.deepEqual(result, ["mutants", "quality"]);
});

test("high-risk claim validation follows the configured quality mode", () => {
  const enforce = { quality: { changeGate: "enforce-high-risk" } };
  assert.deepEqual(missingHighRiskQualityCapabilities(
    { impact: "high" }, [{ capabilities: ["mutation"] }], enforce),
  ["changed-quality"]);
  assert.deepEqual(missingHighRiskQualityCapabilities(
    { impact: "low", securityTriggers: ["auth"] }, [{ capabilities: [
      "changed-quality", "mutation"
    ] }], enforce), []);
  assert.deepEqual(missingHighRiskQualityCapabilities(
    { impact: "low" }, [], enforce), []);
  assert.deepEqual(missingHighRiskQualityCapabilities(
    { impact: "high" }, [], { quality: { changeGate: "warn" } }), []);
});

test("provider capability matching honors global and repository-scoped instances", () => {
  assert.deepEqual(providersForCapability(
    providers, capability, "test", ["api"]), ["test-global", "test-api"]);
  assert.deepEqual(providersForCapability(
    providers, capability, "test", ["missing"]), ["test-global"]);
  assert.deepEqual(providersForCapability(
    providers, capability, "test"), ["test-global", "test-api", "test-web"]);
  assert.deepEqual(providersForCapability(
    providers, capability, "unknown"), []);
});

test("required capability addition uses configured providers, fallback names, and waivers", () => {
  const context = {
    providers,
    providerCapability: capability,
    waived: new Set(["review"]),
    required: new Set()
  };
  addRequiredCapability(context, "test", ["api"]);
  addRequiredCapability(context, "deployment");
  addRequiredCapability(context, "review");
  assert.deepEqual([...context.required].sort(),
    ["deployment", "test-api", "test-global"]);
});

test("required provider operation combines claims, discovery, review, acceptance, and policy", () => {
  const contract = {
    providers,
    claims: [{
      id: "claim-a",
      capabilities: ["test", "security-static"],
      repositories: ["api"]
    }]
  };
  const result = requiredProvidersOperation({
    loadRuntime: () => ({ waivers: [] }),
    evidence: () => contract,
    providerCapability: capability,
    reviewPolicy: () => ({ required: true }),
    resolvedAcceptance: () => ({ required: true }),
    policyCapabilitySplit: () => ({ enforced: ["deployment", "security-static"] })
  }, "change-a");
  assert.deepEqual(result, [
    "acceptance", "deployment", "discovery", "review", "security",
    "test-api", "test-global"
  ]);
});

test("waiving test also suppresses automatic discovery while optional gates stay absent", () => {
  const result = requiredProvidersOperation({
    loadRuntime: () => ({ waivers: [{ capability: "test" }] }),
    evidence: () => ({ claims: [{ capabilities: ["test"] }] }),
    providerCapability: capability,
    reviewPolicy: () => ({ required: false }),
    resolvedAcceptance: () => ({ required: false }),
    policyCapabilitySplit: () => ({ enforced: [] })
  }, "change-a");
  assert.deepEqual(result, []);
});

test("review covers a specialist provider that only repeats the test command", () => {
  const command = ["sh", "-c", "npm test"];
  const contract = {
    providers: {
      test: { adapter: "test-discovery", command },
      "security-static": { adapter: "command", capability: "security-static", command },
      resilience: { adapter: "command", capability: "resilience", command: ["npm", "run", "chaos"] }
    },
    claims: [{ id: "a", capabilities: ["test", "security-static", "resilience"] }]
  };
  const required = (reviewRequired, waivers = []) => requiredProvidersOperation({
    loadRuntime: () => ({ waivers }),
    evidence: () => contract,
    providerCapability: capability,
    reviewPolicy: () => ({ required: reviewRequired }),
    resolvedAcceptance: () => ({ required: false }),
    policyCapabilitySplit: () => ({ enforced: [] })
  }, "change-a");
  // Never run, never credited: review replaces it; a real command stays required.
  assert.deepEqual(required(true), ["discovery", "resilience", "review", "test"]);
  // Without review nothing covers it, so it stays required.
  assert.deepEqual(required(false), ["discovery", "resilience", "security-static", "test"]);
  assert.deepEqual(required(true, [{ capability: "review" }]),
    ["discovery", "resilience", "security-static", "test"]);

  assert.deepEqual(reviewCoveredAdvisories(contract, true), [{
    capability: "security-static", provider: "security-static",
    reason: "covered-by-review", status: "covered-by-review", aliasOf: "test",
    detail: "its provider only repeats test provider 'test', so the required review " +
      "covers it; no receipt claims it passed",
    next: "wire a project-owned security-static command in execution.yaml to observe it"
  }]);
  assert.deepEqual(reviewCoveredAdvisories(contract, false), []);
});

test("rollout gates cover configured, work-type, and claim post-release capabilities", () => {
  const gates = (contract, owed = []) => postReleaseRolloutGates({
    evidence: () => contract,
    providerCapability: catalogCapability,
    policyRolloutCapabilities: () => owed
  }, "change-a").map((gate) => gate.capability);
  const claim = (capabilities) => ({ id: "c", capabilities });
  // A client-release change with no release-health provider still owes the gate.
  assert.deepEqual(gates({ providers: {}, claims: [claim(["test"])] },
    ["release-health"]), ["release-health"]);
  // A claim that declares release-health with no provider instance owes it too.
  assert.deepEqual(gates({ providers: {}, claims: [claim(["release-health"])] }),
    ["release-health"]);
  // A configured provider is listed once, never duplicated by policy or claims.
  assert.deepEqual(gates({
    providers: { health: { capability: "release-health" } },
    claims: [claim(["release-health"])]
  }, ["release-health", "experiment-guardrail"]),
  ["release-health", "experiment-guardrail"]);
  // Pre-land capabilities are never rollout gates.
  assert.deepEqual(gates({ providers: {}, claims: [claim(["test"])] }), []);
});
