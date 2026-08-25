import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createPacketRuntime } from "../runtime/workflow/packet-runtime.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-packet-value-"));
let activePath = join(root, "openspec", "changes", "packet-test");
const leasesRoot = join(root, "leases");
mkdirSync(join(activePath, "specs"), { recursive: true });
for (const name of ["proposal.md", "tasks.md", "evidence.yaml"])
  writeFileSync(join(activePath, name), `${name}\n`);

const state = {
  intent: "test packets", schema: "foundation-standard", status: "BUILDING",
  revision: 2, contractRevision: 3, executionRevision: 4,
  impact: "medium", coupling: "connected", reviewRequired: true,
  workspace: { path: root }
};
const repositories = {
  root: {
    id: "root", type: "control", mode: "worktree", relativePath: ".",
    workspacePath: root, dependsOn: []
  },
  other: {
    id: "other", type: "service", mode: "worktree", relativePath: "other",
    workspacePath: join(root, "other"), dependsOn: ["root"]
  }
};
const baseTasks = [
  {
    id: "T1", done: false, kind: "implementation", repository: "root",
    dependsOn: [], paths: ["src/**"], resources: ["workspace-write"],
    claims: ["c1"], text: "implement root"
  },
  {
    id: "T2", done: true, kind: "implementation", repository: "other",
    dependsOn: ["T1"], paths: ["other/**"], resources: [], claims: ["c2"],
    text: "implement other"
  },
  {
    id: "T3", done: false, kind: "inventory", repository: "root",
    dependsOn: [], paths: [], resources: [], claims: [], text: "inventory"
  }
];
let tasks = structuredClone(baseTasks);
let contract = {
  claims: [
    { id: "c1", scenario: "root scenario", capabilities: ["test"], repositories: ["root"] },
    { id: "c2", scenario: "other scenario", capabilities: ["test"], repositories: ["other"] }
  ],
  invariants: ["preserve packet behavior"]
};
let providers = ["global", "root-provider", "other-provider", "uncovered"];
let surface = [
  { repositoryId: "root", path: "src/a.js" },
  { repositoryId: "root", path: "docs/readme.md" },
  { repositoryId: "other", path: "lib/b.js" }
];
let attempts = [];
let compositeHash = "composite-hash";
const receiptHashes = [];
const configs = {
  "root-provider": { adapter: "command", repository: "root" },
  "other-provider": { adapter: "command", repository: "other" },
  uncovered: { adapter: "command", repository: "root" }
};
const providerClaims = {
  global: [], "root-provider": [{ id: "c1" }],
  "other-provider": [{ id: "c2" }], uncovered: [{ id: "missing" }]
};
const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");
const readJson = (path, fallback) => {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
};
const compactList = (rows, limit) => rows.length <= limit ? rows : {
  count: rows.length, preview: rows.slice(0, limit), digest: stableHash(rows)
};

const runtime = createPacketRuntime({
  ROOT: root, PACKET_SCHEMA_VERSION: "4", REVIEW_PACKET_SCHEMA_VERSION: "1",
  leasesRoot, loadRuntime: () => state, foundationVersion: "1.0.0",
  installedCliVersion: "1.0.0", readJson, activeChangePath: () => activePath,
  canonicalChangedSurface: () => surface, evidence: () => contract,
  taskBlocks: () => tasks, taskMetadata: (task) => task,
  repositoryById: (_id, repositoryId) => repositories[repositoryId],
  claimsForProvider: (_id, provider) => providerClaims[provider] || [],
  relevantSnapshot: () => ({ workspaceHash: compositeHash }),
  snapshotPath: () => "snapshot", singleRelevantSnapshot: () => ({ workspaceHash: "repo-hash" }),
  requiredProviders: () => providers,
  receiptValidity: (_id, provider, hash) => {
    receiptHashes.push([provider, hash]);
    return { validity: "fresh", status: "pass" };
  },
  providerConfig: (_id, provider) => configs[provider] || null,
  adapterResources: (provider) => [`resource:${provider}`], stableHash,
  compactStrings: (values = [], limit) => values.slice(0, limit),
  providerRepositories: (_id, _provider, config) => config?.repository
    ? [repositories[config.repository]] : [repositories.root, repositories.other],
  modelForTask: () => ({ tier: "standard" }), compactList,
  fileDigest: (path) => `file:${basename(path)}`, directoryHash: () => "directory:specs",
  ensureBudgetState: () => ({ mode: "active" }), budgetDecision: () => ({ allowed: true }),
  scopedReviewClaims: (claims) => claims, relevantHash: () => "review-hash",
  providerCapability: () => "test", receiptPath: () => join(root, "missing-receipt.json"),
  contractFingerprint: () => "fingerprint", reviewPolicy: () => ({}),
  resolvedAcceptance: () => ({}), handoffReadiness: () => ({ status: "ready" }),
  deliveredAiAttempts: () => attempts, serializedJson: JSON.stringify,
  foundationPolicy: () => ({ execution: { packetBytes: {
    global: 1_000_000, repository: 1_000_000, task: 1_000_000, review: 1_000_000
  } } }),
  recordContextMetric: () => {}, recordInstructionManifest: () => null,
  fail: (message) => { throw new Error(message); }
});

try {
  const global = runtime.packetValue("packet-test");
  assert.equal(global.packetType, "global");
  assert.equal(global.tasks.count, 3);
  assert.deepEqual(global.tasks.byRepository, [
    { repository: "other", count: 1 }, { repository: "root", count: 2 }
  ]);
  assert.equal(global.claims.length, 2);
  assert.equal(global.claims[0].scenario, undefined);
  assert.equal(global.references["proposal.md"].sha256, "file:proposal.md");
  assert.equal(global.references.specs.sha256, "directory:specs");
  assert.deepEqual(global.invariants, {
    count: 1, digest: stableHash(contract.invariants), reference: "evidence.yaml#invariants"
  });
  assert.equal(global.repairContext, undefined);

  receiptHashes.length = 0;
  const repository = runtime.packetValue("packet-test", "root");
  assert.equal(repository.packetType, "repository");
  assert.equal(repository.repository.id, "root");
  assert.deepEqual(repository.changedFiles, ["src/a.js", "docs/readme.md"]);
  assert.deepEqual(repository.claims.map((claim) => claim.id), ["c1"]);
  assert.equal(repository.claims[0].scenario, "root scenario");
  assert.equal(repository.providers.some((row) => row.provider === "other-provider"), false);
  assert.equal(repository.providers.some((row) => row.provider === "uncovered"), false);
  assert.equal(receiptHashes.find(([provider]) => provider === "global")[1], "composite-hash");
  assert.equal(receiptHashes.find(([provider]) => provider === "root-provider")[1], "repo-hash");

  const savedActivePath = activePath;
  const savedWorkspace = state.workspace;
  const savedRootWorkspace = repositories.root.workspacePath;
  const savedDependsOn = repositories.root.dependsOn;
  const savedRevision = state.revision;
  const savedContractRevision = state.contractRevision;
  const savedExecutionRevision = state.executionRevision;
  activePath = root;
  writeFileSync(join(root, "tasks.md"), "# Tasks\n");
  state.workspace = {};
  delete state.revision;
  delete state.contractRevision;
  delete state.executionRevision;
  delete repositories.root.workspacePath;
  delete repositories.root.dependsOn;
  compositeHash = null;
  const defaults = runtime.packetValue("packet-test", "root");
  assert.equal(defaults.revision, 0);
  assert.equal(defaults.contractRevision, 0);
  assert.equal(defaults.executionRevision, 0);
  assert.equal(defaults.changePath, ".");
  assert.deepEqual(defaults.repository.dependsOn, []);
  assert.equal(defaults.workspacePath, root);
  assert.equal(defaults.compositeWorkspaceHash, null);
  activePath = savedActivePath;
  state.workspace = savedWorkspace;
  state.revision = savedRevision;
  state.contractRevision = savedContractRevision;
  state.executionRevision = savedExecutionRevision;
  repositories.root.workspacePath = savedRootWorkspace;
  repositories.root.dependsOn = savedDependsOn;
  compositeHash = "composite-hash";

  const task = runtime.packetValue("packet-test", null, "t1");
  assert.equal(task.packetType, "task");
  assert.deepEqual(task.changedFiles, ["src/a.js"]);
  assert.equal(task.tasks[0].model.tier, "standard");
  assert.equal(task.executionAuthority.status, "unleased");
  assert.equal(task.workerContract.role, "leased-task-worker");

  const leasePath = join(leasesRoot, "tasks", "packet-test", "T1.json");
  mkdirSync(dirname(leasePath), { recursive: true });
  writeFileSync(leasePath, JSON.stringify({
    leaseId: "lease-1", graphRevision: 1, graphIdentity: "graph", planDigest: "plan",
    contractRevision: 3, workspaceHash: "repo-hash", fencingGeneration: 2,
    executionAttempt: 1, repository: "root", paths: ["src/**"], claimIds: ["c1"],
    outputSchema: "result-v1", expiresAt: "2099-01-01T00:00:00.000Z"
  }));
  assert.equal(runtime.packetValue("packet-test", null, "T1").executionAuthority.leaseId, "lease-1");
  writeFileSync(leasePath, JSON.stringify({ graphRevision: 1 }));
  assert.equal(runtime.packetValue("packet-test", null, "T1").executionAuthority.status, "unleased");

  attempts = [{
    resultStatus: "fail", attempt: 2, digest: "review-digest", workspaceHash: "repo-hash",
    findings: [
      { id: "F1", severity: "major", path: "src/a.js", message: "repair me", claimIds: ["c1"] },
      { id: "F2", severity: "blocker", path: null, message: "global blocker" },
      { id: "F3", severity: "minor", path: "src/a.js", message: "minor" },
      { id: "F4", severity: "major", path: "other/lib.js", message: "other repo" }
    ]
  }];
  const repair = runtime.packetValue("packet-test", "root").repairContext;
  assert.deepEqual(repair.findings.map((finding) => finding.id), ["F1", "F2"]);
  attempts = [{ resultStatus: "pass", findings: [] }];
  assert.equal(runtime.packetValue("packet-test").repairContext, undefined);
  attempts = [{ resultStatus: "fail", findings: [{ id: "F", severity: "minor" }] }];
  assert.equal(runtime.packetValue("packet-test").repairContext, undefined);

  surface = Array.from({ length: 55 }, (_, index) => ({
    repositoryId: "root", path: `src/group-${index % 2}/file-${index}.js`
  }));
  const compacted = runtime.packetValue("packet-test", null, "T1").changedFiles;
  assert.equal(compacted.count, 55);
  assert.equal(compacted.groups.length, 2);

  assert.throws(() => runtime.packetValue("packet-test", null, "missing"), /unknown task/);
  assert.throws(() => runtime.packetValue("packet-test", "other", "T1"), /not assigned/);
  tasks = [{ ...baseTasks[0], claims: ["unknown"] }];
  assert.throws(() => runtime.packetValue("packet-test", null, "T1"), /unknown claim/);
  tasks = [{ ...baseTasks[0], claims: [] }];
  contract = { claims: [], invariants: null };
  assert.throws(() => runtime.packetValue("packet-test", null, "T1"), /has no claims/);
  tasks = [{ ...baseTasks[2] }];
  assert.equal(runtime.packetValue("packet-test", null, "T3").claims.length, 0);

  tasks = [structuredClone(baseTasks[0])];
  contract = { claims: [structuredClone(contract.claims?.[0] || {
    id: "c1", scenario: "root scenario", capabilities: ["test"], repositories: ["root"]
  })], invariants: [] };
  providers = ["uncovered"];
  assert.throws(() => runtime.packetValue("packet-test", null, "T1"), /no provider coverage/);

  console.log("packet value tests: PASS");
} finally {
  rmSync(root, { recursive: true, force: true });
}
