import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  createChangeValidationRuntime, durableDecisionMetadataIssues
} from "../runtime/workflow/change-validation.mjs";
import { renderDraftDecisions } from "../runtime/workflow/change-lifecycle.mjs";

const fixture = mkdtempSync(join(tmpdir(), "foundation-grounding-policy-"));
const packet = join(fixture, "change");
mkdirSync(packet, { recursive: true });
writeFileSync(join(fixture, "requirement.md"), "approved requirement\n");
writeFileSync(join(fixture, "production.mjs"), "export const behavior = true;\n");
writeFileSync(join(fixture, "production.test.mjs"), "// test topology\n");
writeFileSync(join(fixture, "wire.json"), "{}\n");
writeFileSync(join(fixture, "activation.mjs"), "export const enabled = true;\n");
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const stableHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (message) => { throw new Error(message); };
const repositorySelections = [];
const state = { id: "change-a", groundingRequired: true, status: "change",
  intent: "bounded change", impact: "medium", coupling: "isolated" };
let contract = {
  claims: [{ id: "claim-a", impact: "medium", capabilities: ["test", "review"] }]
};
let executionProviders = { test: { capability: "test", criticalCases: ["CASE-WIRE"] } };
let evidenceProviders = {};
const valid = () => ({
  version: 1,
  decisionBatch: {
    status: "locked", source: "user-batch", reference: "decision:1",
    mode: "single-batch", lockedAt: "2026-08-13T00:00:00Z",
    decisions: [{ id: "d1", question: "scope?", answer: "bounded", source: "user-batch" }]
  },
  readSet: [
    { repository: "root", path: "requirement.md", role: "requirement", mode: "full", sha256: digest(join(fixture, "requirement.md")) },
    { repository: "root", path: "production.mjs", role: "production-path", mode: "full", sha256: digest(join(fixture, "production.mjs")) },
    { repository: "root", path: "production.test.mjs", role: "test-topology", mode: "full", sha256: digest(join(fixture, "production.test.mjs")) }
  ],
  claims: [{
    id: "claim-a",
    productionPath: [{ repository: "root", path: "production.mjs" }],
    failurePaths: [{ repository: "root", path: "production.mjs", failure: "negative branch" }],
    evidenceClass: ["test", "review"],
    testDoubleGap: "none"
  }],
  derivedFacts: []
});
const writeGrounding = (value) =>
  writeFileSync(join(packet, "grounding.yaml"), `${JSON.stringify(value, null, 2)}\n`);

try {
  const runtime = createChangeValidationRuntime({
    root: fixture,
    activeChangePath: () => packet,
    changePath: () => packet,
    walk: () => {},
    loadRuntime: () => state,
    saveRuntime: () => {},
    evidence: () => ({
      ...contract, providers: { ...evidenceProviders, ...executionProviders }
    }),
    selectedRepositories: (...args) => {
      repositorySelections.push(args);
      return [{ id: "root", workspacePath: fixture }];
    },
    providerCapability: (provider, config) => config?.capability || provider,
    providerConfig: () => null,
    resolvedAcceptance: () => ({ required: false, claimIds: [] }),
    reviewPolicy: () => ({ required: false, tier: state.groundingVersion === 2 ? "high" : "low" }),
    policyCapabilities: () => [],
    policyCapabilityTrigger: () => null,
    changedSurfaceResolvable: () => false,
    forecastCapabilities: () => ({ capabilities: [] }),
    rawExecution: () => ({ providers: executionProviders }),
    commandExists: () => true,
    stableHash,
    fileDigest: digest,
    pathInside: (base, path) => path === base || path.startsWith(`${base}/`),
    knownProviders: new Set(),
    writeJson: () => {},
    now: () => "2026-08-13T00:00:00Z",
    fail
  });

  writeGrounding(valid());
  assert.equal(runtime.groundingValue("change-a", state, packet).firstLock, true);
  assert.deepEqual(repositorySelections.at(-1)[3], {
    changeDir: packet,
    useTargetPaths: true
  }, "root validation selects repositories from the root packet and target tree");

  const sandboxPacket = join(fixture, "sandbox-change");
  mkdirSync(sandboxPacket, { recursive: true });
  writeFileSync(join(sandboxPacket, "grounding.yaml"),
    `${JSON.stringify(valid(), null, 2)}\n`);
  assert.equal(runtime.groundingValue("change-a", state, sandboxPacket).firstLock, true);
  assert.deepEqual(repositorySelections.at(-1)[3], {
    changeDir: sandboxPacket,
    useTargetPaths: false
  }, "active validation selects repositories from the active packet and sandbox tree");

  const missing = valid();
  missing.claims[0].productionPath[0].path = "missing.mjs";
  writeGrounding(missing);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    /does not resolve inside repository/);

  const outside = valid();
  outside.claims[0].productionPath[0].path = "../outside.mjs";
  writeGrounding(outside);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    /does not resolve inside repository/);

  const unselected = valid();
  unselected.claims[0].productionPath[0].repository = "other";
  writeGrounding(unselected);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    /unselected repository/);

  const unhashed = valid();
  unhashed.readSet[1].role = "runtime-path";
  writeGrounding(unhashed);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    /must appear in readSet with role production-path/);

  const locked = valid();
  writeGrounding(locked);
  state.groundingDigest = stableHash(locked);
  writeFileSync(join(fixture, "requirement.md"), "contradicted requirement\n");
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    /sha256 does not match the baseline file/,
    "immutable requirement inputs must be rehashed after the ledger is locked");

  writeFileSync(join(fixture, "requirement.md"), "approved requirement\n");
  state.groundingDigest = null;
  state.groundingVersion = 2;
  state.intent = "Activate RabbitMQ callback wire contract";
  contract = {
    claims: [{
      id: "claim-a", impact: "medium",
      capabilities: ["test", "integration", "review"]
    }]
  };
  const v2 = () => ({
    version: 2,
    decisionBatch: valid().decisionBatch,
    risk: { tier: "high", classes: ["queue", "activation"], rationale: "existing queue path" },
    productionEntry: {
      status: "applicable", sourceReason: "runtime entry",
      paths: [{ repository: "root", path: "production.mjs" }]
    },
    realWire: {
      status: "applicable", sourceReason: "message contract",
      contracts: [{ repository: "root", path: "wire.json" }]
    },
    activationSemantics: {
      status: "applicable", sourceReason: "existing path becomes live",
      activatedPaths: [{ repository: "root", path: "activation.mjs" }],
      failureSemanticChanges: ["malformed callback becomes indeterminate"]
    },
    serviceInteractions: {
      status: "applicable", sourceReason: "producer and consumer cross a broker",
      rows: [{
        id: "rabbit-callback", owner: "member", producer: "bank-test",
        consumer: "member", contract: "wire.json", delivery: "at-least-once",
        timeoutRetry: "bounded retry", idempotency: "source_ref",
        ordering: "per source_ref", consistency: "eventual",
        rollout: "dev flag", rollback: "disable consumer"
      }]
    },
    observability: {
      status: "applicable", sourceReason: "operated broker boundary",
      rows: [{
        interactionId: "rabbit-callback", correlation: "source_ref",
        structuredEvents: "received/rejected", sli: "valid callback rate",
        alert: "rejection spike", runbook: "callback recovery",
        operatorQuestion: "which source_ref failed?"
      }]
    },
    readSet: [
      { repository: "root", path: "requirement.md", role: "requirement", mode: "full", sha256: digest(join(fixture, "requirement.md")) },
      { repository: "root", path: "production.mjs", role: "production-path", mode: "full", sha256: digest(join(fixture, "production.mjs")) },
      { repository: "root", path: "production.test.mjs", role: "test-topology", mode: "full", sha256: digest(join(fixture, "production.test.mjs")) },
      { repository: "root", path: "wire.json", role: "contract", mode: "full", sha256: digest(join(fixture, "wire.json")) },
      { repository: "root", path: "activation.mjs", role: "runtime-path", mode: "full", sha256: digest(join(fixture, "activation.mjs")) }
    ],
    claims: [{
      id: "claim-a",
      productionPath: [{ repository: "root", path: "production.mjs" }],
      failurePaths: [{ repository: "root", path: "activation.mjs", failure: "malformed payload" }],
      evidenceClass: ["test", "integration", "review"], testDoubleGap: "none"
    }],
    criticalCases: [{
      id: "CASE-WIRE", claimIds: ["claim-a"], oracle: "real-wire"
    }],
    mutants: [], derivedFacts: []
  });
  const missingReadSet = v2();
  delete missingReadSet.readSet;
  writeGrounding(missingReadSet);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    /readSet must be non-empty/,
    "a missing Grounding v2 read set fails with a typed validation message");
  writeGrounding(v2());
  assert.equal(runtime.groundingValue("change-a", state, packet).value.version, 2);
  contract.claims[0].capabilities.push("deployment");
  const deploymentEvidence = v2();
  deploymentEvidence.claims[0].evidenceClass.push("deployment");
  writeGrounding(deploymentEvidence);
  assert.equal(runtime.groundingValue("change-a", state, packet)
    .value.claims[0].evidenceClass.includes("deployment"), true,
  "deployment handoff evidence maps to the declared deployment capability");
  const falseNa = v2();
  falseNa.serviceInteractions = {
    status: "not-applicable", sourceReason: "claimed local", rows: []
  };
  writeGrounding(falseNa);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    /serviceInteractions is required/,
    "queue-backed changes cannot self-assert service interactions as N/A");
  const missingWire = v2();
  missingWire.realWire.contracts[0].path = "missing-wire.json";
  writeGrounding(missingWire);
  assert.throws(() => runtime.groundingValue("change-a", state, packet),
    /does not resolve inside repository/,
    "real-wire references must resolve inside a selected repository");

  state.nfrAssessmentRequired = true;
  state.intent = "Keep p95 response latency below the approved performance budget";
  state.coupling = "isolated";
  contract = { claims: [{
    id: "claim-a", scenario: "p95 latency stays below 250 ms",
    impact: "medium", capabilities: ["test", "review", "performance"]
  }] };
  executionProviders = {
    test: { capability: "test", criticalCases: ["CASE-WIRE"] }
  };
  evidenceProviders = { performance: { capability: "performance" } };
  const nfr = v2();
  nfr.risk = { tier: "high", classes: ["performance"], rationale: "runtime latency budget" };
  nfr.realWire = { status: "not-applicable", sourceReason: "local function", contracts: [] };
  nfr.activationSemantics = {
    status: "not-applicable", sourceReason: "no dormant path",
    activatedPaths: [], failureSemanticChanges: []
  };
  nfr.serviceInteractions = {
    status: "not-applicable", sourceReason: "single process", rows: []
  };
  nfr.observability = {
    status: "not-applicable", sourceReason: "no operated boundary", rows: []
  };
  nfr.claims[0].evidenceClass = ["test", "review"];
  nfr.nfrAssessment = Object.fromEntries(Object.keys({
    performance: 1, capacity: 1, availability: 1, securityPrivacy: 1,
    accessibility: 1, operability: 1, compatibility: 1, recoverability: 1
  }).map((category) => [category, {
    status: category === "performance" ? "applicable" : "not-applicable",
    sourceReason: category === "performance" ? "approved latency budget" : `no ${category} risk`,
    target: category === "performance" ? "p95 <= 250 ms at 100 rps" : "none",
    claimIds: category === "performance" ? ["claim-a"] : []
  }]));
  const ownedTask = [{
    id: "T001", done: false,
    text: "Implement the latency budget [claims:claim-a] [paths:production.mjs]"
  }];
  writeGrounding(nfr);
  assert.equal(runtime.groundingValue("change-a", state, packet, ownedTask)
    .value.nfrAssessment.performance.status, "applicable");
  const missingTarget = structuredClone(nfr);
  missingTarget.nfrAssessment.performance.target = "none";
  writeGrounding(missingTarget);
  assert.throws(() => runtime.groundingValue("change-a", state, packet, ownedTask),
    /performance.target is required/,
    "applicable NFRs require an observable target");
  writeGrounding(nfr);
  assert.throws(() => runtime.groundingValue("change-a", state, packet, []),
    /no implementation task owner/,
    "applicable NFR claims require task ownership");
  const docsOnlyTask = [{
    id: "T002", done: false,
    text: "Document the latency budget [kind:mechanical-docs] [claims:claim-a]"
  }];
  assert.throws(() => runtime.groundingValue("change-a", state, packet, docsOnlyTask),
    /no implementation task owner/,
    "non-implementation tasks cannot own an applicable NFR claim");

  assert.deepEqual(durableDecisionMetadataIssues(`## Decisions\n\n- **Decision ID:** DEC-001\n  - **Status:** accepted\n  - **Decision:** Use bounded packets\n  - **Why:** Avoid transcript contamination\n  - **Rejected:** Parent transcript inheritance\n  - **Consequences:** Workers must regenerate packets\n  - **Supersedes:** none\n  - **Superseded by:** none\n\n## Compatibility and migration\n\nnone\n`), []);
  assert.match(durableDecisionMetadataIssues(`## Decisions\n\n- **Decision:** missing identity\n\n## Compatibility and migration\n`)[0], /Decision ID metadata/);
  assert.match(durableDecisionMetadataIssues(`## Decisions\n\n- **Decision:** legacy entry\n  - **Why:** old format\n\n- **Decision ID:** DEC-001\n  - **Status:** accepted\n  - **Decision:** Valid entry\n  - **Why:** grounded\n  - **Rejected:** none\n  - **Consequences:** bounded\n  - **Supersedes:** none\n  - **Superseded by:** none\n\n## Compatibility and migration\n`)[0], /legacy Decision entries/,
  "a valid decision cannot hide an unidentified legacy entry");
  const dangling = durableDecisionMetadataIssues(`## Decisions\n\n- **Decision ID:** DEC-001\n  - **Status:** superseded\n  - **Decision:** Old choice\n  - **Why:** historical\n  - **Rejected:** none\n  - **Consequences:** replaced\n  - **Supersedes:** none\n  - **Superseded by:** arbitrary prose\n\n## Compatibility and migration\n`);
  assert.ok(dangling.some((issue) => /must be none, DEC-<id>/.test(issue)),
    "supersession references use a stable navigable syntax");
  const reciprocal = durableDecisionMetadataIssues(`## Decisions\n\n- **Decision ID:** DEC-001\n  - **Status:** superseded\n  - **Decision:** Old choice\n  - **Why:** historical\n  - **Rejected:** none\n  - **Consequences:** replaced\n  - **Supersedes:** none\n  - **Superseded by:** DEC-002\n- **Decision ID:** DEC-002\n  - **Status:** accepted\n  - **Decision:** New choice\n  - **Why:** new evidence\n  - **Rejected:** old choice\n  - **Consequences:** migration\n  - **Supersedes:** DEC-001\n  - **Superseded by:** none\n\n## Compatibility and migration\n`);
  assert.deepEqual(reciprocal, [], "local supersession links are reciprocal");
  assert.equal(renderDraftDecisions([]), "`none`",
    "a standard atomic draft with no durable decision renders an explicit none section");
  console.log("grounding policy tests: PASS");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
