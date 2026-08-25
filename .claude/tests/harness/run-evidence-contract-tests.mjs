import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEvidenceContract } from "../../harness/runtime/evidence/evidence-contract.mjs";

const capabilities = new Set([
  "test", "discovery", "mutation", "browser", "review", "acceptance",
  "cross-repo-contract"
]);
const adapters = new Set([
  "external", "command", "contract-digest", "test-discovery", "playwright"
]);
const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");
const fail = (message) => { throw new Error(message); };

function fixture(evidenceValue, executionValue = { version: 1, providers: {}, services: {} },
  overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "evidence-contract-unit-"));
  const changeDir = join(root, "changes", "change");
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, "execution.yaml"), "fixture\n");
  writeFileSync(join(root, "tracked-command.js"), "// fixture\n");
  const repositories = [
    { id: "root", path: root, workspacePath: root },
    { id: "repo2", path: root, workspacePath: root }
  ];
  const repositoryById = (_id, repositoryId) => {
    const repository = repositories.find((row) => row.id === repositoryId);
    if (!repository) fail(`unknown repository '${repositoryId}'`);
    return repository;
  };
  return createEvidenceContract({
    ROOT: root,
    PROVIDERS: capabilities,
    ADAPTERS: adapters,
    INPUT_MODES: new Set(["browser-automation", "dom-event", "os-input", "both"]),
    EXCLUDED_WORKSPACE_DIRS: new Set([".foundation", "coverage"]),
    ADAPTER_PROTOCOL_VERSION: 3,
    PROVIDER_PROTOCOL_VERSION: 4,
    activeChangePath: () => changeDir,
    readJson: (path) => path.endsWith("execution.yaml") ? executionValue : evidenceValue,
    repositoryById,
    selectedRepositories: () => repositories,
    providerCapability: (provider, config) => config?.capability || provider,
    canonicalPath: (path) => path,
    loadRuntime: () => ({ workspace: { path: root } }),
    relevantHash: () => "relevant",
    relevantSnapshot: () => ({
      codeHash: "code", reviewHash: "review", workspaceHash: "workspace",
      repositories: {}
    }),
    singleRelevantSnapshot: () => ({
      codeHash: "code", reviewHash: "review", workspaceHash: "workspace"
    }),
    fileDigest: () => "file",
    stableHash,
    filesystemEntryIdentity: () => ({ kind: "file" }),
    policyCapabilities: () => [],
    foundationPolicy: () => ({ workflow: {}, review: {} }),
    handoffContract: () => ({}),
    git: () => ({ status: 0 }),
    declaredSurfaceMatcher: () => () => false,
    die: fail,
    ...overrides
  });
}

function completeEvidence() {
  return {
    version: 2,
    claims: [
      { id: "test-claim", scenario: "test", capabilities: ["test"] },
      { id: "mutation-claim", scenario: "mutation", capabilities: ["mutation"] },
      { id: "browser-claim", scenario: "browser", capabilities: ["browser"] },
      { id: "review-claim", scenario: "review", capabilities: ["review"], impact: "high" },
      { id: "acceptance-claim", scenario: "accept", capabilities: ["acceptance"] },
      { id: "contract-claim", scenario: "contract", capabilities: ["cross-repo-contract"] }
    ],
    providers: {
      external: {
        capability: "test", adapter: "external", timeoutMs: 1000,
        resources: ["workspace"], claims: ["test-claim"],
        env: { MODE: "test", RETRIES: 1, ENABLED: true }, envFrom: ["CI_TOKEN"],
        report: "coverage/result.json", reportFormat: "json",
        ci: { issuer: "ci.example", publicKey: "-----BEGIN PUBLIC KEY-----" }
      },
      tests: {
        capability: "test", adapter: "test-discovery", command: ["npm", "test"],
        discoveryProvider: "discovery", inputs: ["src/**"],
        criticalCases: ["case-test"], outputs: ["discovery"],
        readiness: {
          url: "http://127.0.0.1:3000", expectStatus: 200,
          expectBody: "ready", expectHeader: { "x-ready": "yes" }
        }
      },
      discovery: {
        capability: "discovery", adapter: "test-discovery", command: ["npm", "test"]
      },
      mutation: {
        capability: "mutation", adapter: "command", command: ["tracked-command.js"],
        resultProtocol: "foundation-mutation-v2", requiredMutants: ["mutant-1"],
        mutantKillers: { "mutant-1": "case-test" }, classification: "behavioral-kill"
      },
      browser: {
        capability: "browser", adapter: "playwright", command: ["npm", "run", "browser"],
        inputMode: "browser-automation"
      },
      review: { capability: "review", adapter: "external" },
      acceptance: { capability: "acceptance", adapter: "external" },
      contract: {
        capability: "cross-repo-contract", adapter: "contract-digest",
        contract: { root: "api/root.json", repo2: "api/repo2.json" },
        repositories: ["root", "repo2"], inputs: ["root:api/**", "repo2:api/**"]
      }
    }
  };
}

test("evidence validates the complete provider contract matrix", () => {
  const value = fixture(completeEvidence()).evidence("change");
  assert.equal(Object.keys(value.providers).length, 8);
  assert.deepEqual(value.providers.contract.repositories, ["root", "repo2"]);
  assert.equal(value.execution.version, 1);
});

test("execution providers override evidence providers", () => {
  const evidenceValue = completeEvidence();
  const execution = {
    version: 1, services: {}, providers: {
      external: { capability: "test", adapter: "external", claims: ["test-claim"] }
    }
  };
  const value = fixture(evidenceValue, execution).evidence("change");
  assert.equal(value.providers.external.report, undefined);
});

test("claim and provider validation preserve actionable failures", () => {
  const invalidClaims = [
    [{ version: 2, claims: [] }, /at least one claim/],
    [{ version: 2, claims: [{ id: "", scenario: "x", capabilities: ["test"] }] }, /non-empty and unique/],
    [{ version: 2, claims: [{ id: "x", capabilities: ["test"] }] }, /needs scenario/],
    [{ version: 2, claims: [{ id: "x", scenario: "x", capabilities: ["unknown"] }] }, /unknown provider/]
  ];
  for (const [value, expected] of invalidClaims)
    assert.throws(() => fixture(value).evidence("change"), expected);

  const invalidProvider = completeEvidence();
  invalidProvider.providers.external.adapter = "unknown";
  assert.throws(() => fixture(invalidProvider).evidence("change"), /unknown adapter/);
});

function expectProviderFailure(mutator, expected, execution) {
  const value = completeEvidence();
  mutator(value.providers, value);
  assert.throws(() => fixture(value, execution).evidence("change"), expected);
}

test("provider identity, repositories, commands, and contracts fail closed", () => {
  expectProviderFailure((providers) => {
    providers["Bad Provider"] = providers.external;
    delete providers.external;
  }, /invalid provider instance id/);
  expectProviderFailure((providers) => { providers.external = null; }, /configuration must be an object/);
  expectProviderFailure((providers) => { providers.external.capability = "unknown"; }, /known capability/);
  expectProviderFailure((providers) => {
    providers.contract.repositories = ["root", "root"];
  }, /non-empty array of unique/);
  expectProviderFailure((providers) => { providers.mutation.command = []; }, /non-empty command/);
  expectProviderFailure((providers) => { providers.contract.contract = { root: "api.json" }; }, /at least two/);
  expectProviderFailure((providers) => { providers.contract.contract.repo2 = ""; }, /non-empty string/);
  expectProviderFailure((providers) => {
    providers.contract.repositories = ["root", "repo2", "third"];
  }, /unknown repository/);
});

test("provider resources, inputs, and protocols reject malformed contracts", () => {
  expectProviderFailure((providers) => { providers.external.timeoutMs = 0; }, /positive number/);
  expectProviderFailure((providers) => { providers.external.resources = [""]; }, /array of strings/);
  expectProviderFailure((providers) => { providers.external.inputs = ["../secret"]; }, /workspace-relative/);
  expectProviderFailure((providers) => {
    providers.contract.inputs = ["outside:api/**"];
  }, /outside its repository scope/);
  expectProviderFailure((providers) => { providers.review.inputs = ["src/**"]; }, /cannot declare reusable/);
  expectProviderFailure((providers) => { providers.external.reportFormat = "xml"; }, /reportFormat/);
  expectProviderFailure((providers) => { providers.external.resultProtocol = "custom"; }, /resultProtocol/);
  expectProviderFailure((providers) => { providers.external.criticalCases = [""]; }, /criticalCases/);
  expectProviderFailure((providers) => { providers.external.criticalCases = ["case"]; }, /cannot execute criticalCases/);
  expectProviderFailure((providers) => {
    providers.external.resultProtocol = "foundation-mutation-v2";
  }, /requires capability 'mutation'/);
  expectProviderFailure((providers) => { providers.mutation.requiredMutants = []; }, /unique requiredMutants/);
  expectProviderFailure((providers) => { providers.mutation.mutantKillers = {}; }, /one mutantKillers mapping/);
});

test("command adapters reject uncovered untracked workspace files", () => {
  const value = completeEvidence();
  assert.throws(() => fixture(value, undefined, {
    git: () => ({ status: 1 })
  }).evidence("change"), /untracked workspace file/);
});

test("provider relationships, environment, and readiness reject unsafe values", () => {
  expectProviderFailure((providers) => { providers.external.dependsOn = ["missing"]; }, /dependsOn/);
  expectProviderFailure((providers) => { providers.external.dependsOn = ["external"]; }, /depend on itself/);
  expectProviderFailure((providers) => { providers.external.outputs = ["missing"]; }, /outputs/);
  expectProviderFailure((providers) => { providers.external.service = "missing"; }, /unknown service/);
  expectProviderFailure((providers) => { providers.external.env = { VALUE: null }; }, /scalar values/);
  expectProviderFailure((providers) => { providers.external.envFrom = ["bad-name"]; }, /environment variable names/);
  expectProviderFailure((providers) => { providers.external.env = { API_TOKEN: "secret" }; }, /must use envFrom/);
  expectProviderFailure((providers) => { providers.external.report = "/tmp/report"; }, /workspace-relative path/);
  expectProviderFailure((providers) => { providers.tests.readiness = { url: "not a url" }; }, /URL is invalid/);
  expectProviderFailure((providers) => {
    providers.tests.readiness = { url: "http://localhost", expectStatus: 99 };
  }, /HTTP status/);
  expectProviderFailure((providers) => {
    providers.tests.readiness = { url: "http://localhost", expectBody: 42 };
  }, /expectBody/);
  expectProviderFailure((providers) => {
    providers.tests.readiness = { url: "http://localhost", expectHeader: [] };
  }, /expectHeader/);
});

test("capability and claim coverage validation reject incompatible wiring", () => {
  expectProviderFailure((providers) => { providers.browser.inputMode = "invalid"; }, /invalid inputMode/);
  expectProviderFailure((providers) => {
    providers.browser.adapter = "command";
    providers.browser.inputMode = undefined;
  }, /valid inputMode/);
  expectProviderFailure((providers) => {
    providers.mutation.resultProtocol = undefined;
    providers.mutation.classification = undefined;
  }, /requires classification/);
  expectProviderFailure((providers) => {
    providers.review.adapter = "command";
    providers.review.command = ["tracked-command.js"];
  }, /review capability requires an external/);
  expectProviderFailure((providers) => { providers.external.ci = {}; }, /ci verification/);
  expectProviderFailure((providers) => { providers.external.claims = "custom"; }, /array or 'declared'/);
  expectProviderFailure((providers) => { providers.external.claims = ["browser-claim"]; }, /undeclared claim/);
  expectProviderFailure((providers) => { providers.external.claims = []; }, /cover every declared claim/);
});

test("discovery receipt writer identities cannot collide", () => {
  expectProviderFailure((providers) => {
    providers.test = { ...providers.tests, discoveryProvider: "test" };
    delete providers.tests;
    delete providers.discovery;
  }, /cannot write both test and discovery/);
  expectProviderFailure((providers) => {
    providers.tests2 = { ...providers.tests, discoveryProvider: "discovery" };
  }, /multiple writers/);
});
