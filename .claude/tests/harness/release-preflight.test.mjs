import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyReleasePath, protocolPinIssues, structuralReleaseChecks
} from "../../../scripts/release/preflight.mjs";

test("release lanes classify runtime, instruction, shipping, and repository work", () => {
  assert.equal(classifyReleasePath(".claude/harness/runtime/core/a.mjs"), "runtime");
  assert.equal(classifyReleasePath(".claude/commands/build.md"), "instruction");
  assert.equal(classifyReleasePath("Formula/claude-foundation.rb"), "shipping");
  assert.equal(classifyReleasePath("scripts/release/upgrade-matrix.mjs"), "shipping");
  assert.equal(classifyReleasePath(".claude/tests/run-all.sh"), "repository-only");
  assert.equal(classifyReleasePath("dashboard/app.js"), "release-review");
});

test("protocol reconciliation fails on a missing or divergent runtime pin", () => {
  const source = `const VERSION = "1.2.3";\nconst RUNTIME_API_VERSION = "4";`;
  const issues = protocolPinIssues({
    protocol: { runtime: "1.2.3", runtimeApi: "5" }, foundationSource: source
  });
  assert.ok(issues.some((row) => row.includes("runtimeApi")));
  assert.ok(issues.some((row) => row.includes("providerProtocol")));
});

test("structural release checks require canonical changelog and matching artifacts", () => {
  const constants = [
    ["VERSION", "1.2.3"], ["RUNTIME_API_VERSION", "1"],
    ["PROVIDER_PROTOCOL_VERSION", "1"], ["ADAPTER_PROTOCOL_VERSION", "1"],
    ["PROOF_PROTOCOL_VERSION", "1"], ["PACKET_SCHEMA_VERSION", "1"],
    ["AGENT_PLAN_SCHEMA_VERSION", "1"], ["CONTEXT_EVENT_SCHEMA_VERSION", "1"],
    ["REVIEW_PROTOCOL_VERSION", "1"], ["ACCEPTANCE_PROTOCOL_VERSION", "1"],
    ["SEMANTIC_ACCEPTANCE_PROTOCOL_VERSION", "1"], ["REVIEW_PACKET_SCHEMA_VERSION", "1"],
    ["ATTESTATION_PROTOCOL_VERSION", "1"], ["AUTHORITY_PROTOCOL_VERSION", "1"],
    ["CI_EVIDENCE_PROTOCOL_VERSION", "1"], ["QUALITY_CAPABILITIES_PROTOCOL_VERSION", "1"],
    ["CRAP_PROTOCOL_VERSION", "1"], ["AUTOMATED_MUTATION_PROTOCOL_VERSION", "1"]
  ].map(([name, value]) => `const ${name} = "${value}";`).join("\n");
  const protocol = Object.fromEntries([
    ["runtime", "1.2.3"], ["runtimeApi", "1"], ["providerProtocol", "1"],
    ["adapterProtocol", "1"], ["proofProtocol", "1"], ["packetSchema", "1"],
    ["agentPlanSchema", "1"], ["contextEventSchema", "1"], ["reviewProtocol", "1"],
    ["acceptanceProtocol", "1"], ["semanticAcceptanceProtocol", "1"],
    ["reviewPacketSchema", "1"], ["attestationProtocol", "1"],
    ["authorityProtocol", "1"], ["ciEvidenceProtocol", "1"],
    ["qualityCapabilitiesProtocol", "1"], ["crapProtocol", "1"],
    ["automatedMutationProtocol", "1"]
  ]);
  const checks = structuralReleaseChecks({
    version: "1.2.3", protocol, foundationSource: constants,
    changelog: "# Changelog\n\n## [Unreleased]\n\n- Change\n\n## [1.2.2]\n",
    formula: `  url "https://example/v1.2.3.tar.gz"\n  sha256 "${"a".repeat(64)}"\n  head "https://example/repo.git", branch: "main"`,
    workflow: "dry_run DRY\nnode-version: \"24\"", packageJson: { engines: { node: ">=20.19.0" } }
  });
  assert.ok(checks.every((row) => row.status === "pass"), JSON.stringify(checks));
});
