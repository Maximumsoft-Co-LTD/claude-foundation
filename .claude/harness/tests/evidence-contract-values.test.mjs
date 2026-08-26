import assert from "node:assert/strict";
import test from "node:test";

import {
  createEvidenceContract,
  normalizedAcceptanceValue,
  providerRepositoryIds
} from "../runtime/evidence/evidence-contract.mjs";

test("provider repository IDs preserve explicit scopes and derive adapter defaults", () => {
  let selectedCalls = 0;
  const selected = () => { selectedCalls += 1; return ["root", "api", "root"]; };
  assert.deepEqual(providerRepositoryIds({ repositories: ["web", "api", "web"] },
    selected), ["api", "web"]);
  assert.deepEqual(providerRepositoryIds({
    adapter: "contract-digest", contract: { web: {}, api: {} }
  }, selected), ["api", "web"]);
  assert.deepEqual(providerRepositoryIds({ repository: "api" }, selected), ["api"]);
  assert.deepEqual(providerRepositoryIds({}, selected), ["api", "root"]);
  assert.deepEqual(providerRepositoryIds(null), []);
  assert.equal(selectedCalls, 1);
});

test("acceptance normalization preserves required evidence and legacy defaults", () => {
  assert.deepEqual(normalizedAcceptanceValue({}), {
    version: 1, decision: "legacy-not-required", required: false,
    reason: null, claimIds: [], scopeOrigin: null
  });
  assert.deepEqual(normalizedAcceptanceValue({ acceptance: {
    version: "2", required: true, reason: "  approved by owner  ",
    claimIds: ["claim-b", "claim-a", "claim-b"], scopeOrigin: "proposal"
  } }), {
    version: 2, decision: "required", required: true,
    reason: "approved by owner", claimIds: ["claim-a", "claim-b"],
    scopeOrigin: "proposal"
  });
  assert.deepEqual(normalizedAcceptanceValue({ acceptance: {
    version: 0, decision: "waived", required: false,
    reason: "ignored", claimIds: ["ignored"], scopeOrigin: ""
  } }), {
    version: 1, decision: "waived", required: false,
    reason: null, claimIds: [], scopeOrigin: null
  });
  assert.equal(normalizedAcceptanceValue({
    acceptance: { required: true, reason: "   " }
  }).reason, null);
});

test("contract facade maps repository IDs through the authoritative catalog", () => {
  const calls = [];
  const noop = () => ({});
  const contract = createEvidenceContract({
    ROOT: "/root", PROVIDERS: new Set(), ADAPTERS: new Set(), INPUT_MODES: new Set(),
    EXCLUDED_WORKSPACE_DIRS: new Set(), ADAPTER_PROTOCOL_VERSION: 1,
    PROVIDER_PROTOCOL_VERSION: 1,
    activeChangePath: noop, readJson: noop,
    repositoryById: (id, repositoryId) => {
      calls.push([id, repositoryId]);
      return { id: repositoryId };
    },
    selectedRepositories: () => [{ id: "web" }, { id: "api" }],
    providerCapability: noop, canonicalPath: (value) => value,
    loadRuntime: noop, relevantHash: noop, relevantSnapshot: noop,
    singleRelevantSnapshot: noop, fileDigest: noop,
    stableHash: (value) => JSON.stringify(value), filesystemEntryIdentity: noop,
    policyCapabilities: () => [], foundationPolicy: () => ({ workflow: {} }),
    handoffContract: () => ({ operations: [] }), git: noop,
    declaredSurfaceMatcher: () => () => true,
    die: (message) => { throw new Error(message); }
  });
  assert.deepEqual(contract.providerRepositories("change", "tests", {
    repositories: ["web", "api", "web"]
  }), [{ id: "api" }, { id: "web" }]);
  assert.deepEqual(contract.providerRepositories("change", "tests", {}),
    [{ id: "api" }, { id: "web" }]);
  assert.deepEqual(calls, [
    ["change", "api"], ["change", "web"],
    ["change", "api"], ["change", "web"]
  ]);
  assert.equal(contract.normalizedAcceptance({ acceptance: { required: true } }).required,
    true);
});
