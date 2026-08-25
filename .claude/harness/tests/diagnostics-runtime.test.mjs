import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDiagnosticsRuntime } from "../runtime/core/diagnostics-runtime.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-diagnostics-"));
mkdirSync(join(root, ".claude", "hooks"), { recursive: true });
for (const hook of ["protect-secrets.sh", "lint.sh"])
  writeFileSync(join(root, ".claude", "hooks", hook), "#!/bin/sh\n");
writeFileSync(join(root, ".claude", "settings.json"), "{}\n");
const availableRepo = join(root, "available");
mkdirSync(availableRepo);
let orphanRows = [];
let protocolMatch = true;
let unattendedSafe = false;
let topologyRows = ["cycle"];
let transactionRows = [
  { transactionId: "t1", status: "rolling-back" }, { transactionId: "t2", status: "pending" }
];
let settings = {};
let contractVersion = 1;
let policyRows = ["security"];
let policyTrigger = "src/app.js";
let driftRows = [{ reason: "host missing" }];
let catalogDrift = [{ path: "unregistered" }];
let assurance = { summary: "assured" };
let reviewer = { ok: false, detail: "unavailable" };
let defaultReviewer = "reviewer";
let legacyPacketBytes;
let openspecStatus = { level: "error", detail: "missing" };
let providerNames = ["none", "nonebad", "external", "externalbad", "command", "missing", "browser", "browserbad"];
let runtimeState = { status: "change", impact: "high", workspace: { path: root }, declaredSurface: ["src/app.js"] };
let output = "";
const priorLog = console.log;
const priorExit = process.exitCode;
console.log = (message) => { output += `${message}\n`; };
const fail = (message) => { throw new Error(message); };
const versions = {
  runtimeApiVersion: "1", providerProtocolVersion: "1", adapterProtocolVersion: "1",
  proofProtocolVersion: "1", packetSchemaVersion: "1", agentPlanSchemaVersion: "1",
  contextEventSchemaVersion: "1", reviewProtocolVersion: "1", acceptanceProtocolVersion: "1",
  reviewPacketSchemaVersion: "1", attestationProtocolVersion: "1", authorityProtocolVersion: "1",
  ciEvidenceProtocolVersion: "1"
};
const configs = {
  external: { adapter: "external" },
  externalbad: { adapter: "external" },
  command: { adapter: "test", command: ["node"] },
  missing: { adapter: "test", command: ["missing-command"] },
  browser: { adapter: "playwright", command: ["node"], readiness: { url: "http://test" } },
  browserbad: { adapter: "playwright", command: ["node"] }
};
const runtime = createDiagnosticsRuntime({
  root, version: "test", ...versions,
  providerContracts: { test: "contract" }, activeChanges: () => [],
  orphanRuntimeChanges: () => orphanRows,
  runtimePath: (id) => join(root, `${id}.json`), proofPath: (id) => join(root, `${id}.proof.json`),
  readJson: (path, fallback) => path.endsWith("settings.json") ? settings : fallback,
  readJsonOrNull: () => null, relevantHash: () => "hash",
  protocolDescriptor: () => Object.fromEntries(Object.keys(versions).map((key) => [
    key.replace("Version", ""), protocolMatch ? "1" : "bad"
  ])),
  repositoryCatalog: () => ({ drift: catalogDrift, repositories: [{ id: "root" }] }),
  foundationPolicy: () => ({
    models: { fast: { family: "f" }, standard: { family: "s" }, deep: { family: "d" } },
    execution: { maxParallelAgents: 2, legacyNumericPacketBytes: legacyPacketBytes,
      packetBytes: { task: 1, review: 2, repository: 3, global: 4 } },
    review: { defaultReviewer }
  }),
  reviewAssurancePosture: () => assurance,
  isolationInspection: () => ({ execution: { safeForUnattended: unattendedSafe, reasons: ["hazard"] }, securityBoundary: { kind: "copy" } }),
  openSpecCliStatus: () => openspecStatus,
  loadRuntime: () => runtimeState,
  evidence: () => ({ version: contractVersion }),
  selectedRepositories: () => [
    { id: "missing", path: join(root, "missing"), type: "git", mode: "write", relativePath: "missing" },
    { id: "external", path: availableRepo, type: "external", mode: "read", relativePath: "available" },
    { id: "git", path: availableRepo, type: "git", mode: "read", relativePath: "available" }
  ],
  gitHead: () => null,
  playwrightAvailability: (cwd) => cwd === root
    ? { packageOwned: false, binaryAvailable: false, config: null }
    : { packageOwned: true, binaryAvailable: true, config: "playwright.config.js" },
  requiredProviders: () => providerNames,
  providerConfig: (_id, provider) => configs[provider] || null,
  receiptValidity: (_id, provider) => ({ validity: provider === "none" || provider === "external" ? "valid" : "missing" }),
  providerWorkspace: (_id, provider) => provider === "browserbad" ? root : availableRepo,
  commandExists: (command) => command === "node",
  topologyIssues: () => topologyRows, policyCapabilities: () => policyRows,
  policyCapabilityTrigger: () => policyTrigger, forecastCapabilities: () => ({
    capabilities: ["security", "test"], triggers: { security: ["src/app.js"] }
  }),
  reviewForcingCapabilities: ["security"], reviewDiversityCapabilities: ["security"],
  providerCapability: (provider) => provider === "command" ? "mutation" : provider,
  reviewerStatus: () => reviewer,
  unverifiedDrift: () => driftRows,
  unresolvedApplyTransactions: () => transactionRows,
  parseFlags: () => ({}), parseStrictCommandFlags: () => ({ flags: {}, rest: [] }), fail
});

try {
  assert.throws(() => runtime.doctor({ stage: "invalid" }), /change\|build\|prove/);
  assert.throws(() => runtime.doctor({ unattended: true }), /requires --change/);
  runtime.doctor({ stage: "change" });
  assert.match(output, /protocol-bundle/);
  assert.match(output, /hook:protect-secrets.sh/);
  output = "";
  process.exitCode = 0;
  runtime.doctor({ stage: "prove", change: "c", unattended: true, "require-archive": true });
  assert.match(output, /unattended-security-boundary/);
  assert.match(output, /repository:missing/);
  assert.match(output, /provider:browser:command/);
  assert.match(output, /playwright:readiness/);
  assert.match(output, /apply-transactions/);
  assert.match(output, /mutation-coverage|evidence-schema/);
  assert.equal(process.exitCode, 1);
  output = "";
  unattendedSafe = true;
  topologyRows = [];
  transactionRows = [{ transactionId: "t3", status: "pending" }];
  providerNames = ["nonebad", "externalbad", "browserbad"];
  runtimeState = { status: "change", impact: "high", workspace: { path: root }, declaredSurface: [] };
  contractVersion = 2;
  runtime.doctor({ stage: "build", change: "c", unattended: true });
  assert.match(output, /detected without host-control hazards/);
  assert.match(output, /recovers on the next apply/);
  transactionRows = [];
  settings = { hooks: ["no-direct-main-commit.sh"] };
  policyRows = [];
  policyTrigger = null;
  driftRows = [];
  mkdirSync(join(root, ".claude", "hooks", "tests"), { recursive: true });
  writeFileSync(join(root, ".claude", "hooks", "tests", "run-hook-tests.sh"), "#!/bin/sh\n");
  rmSync(join(root, ".claude", "hooks", "lint.sh"));
  output = "";
  runtime.doctor({ stage: "change", change: "c" });
  assert.match(output, /hook:lint.sh: missing/);
  assert.match(output, /legacy-hook-tests/);
  assert.match(output, /no-direct-main: enabled/);
  catalogDrift = [];
  assurance = null;
  reviewer = { ok: true, detail: "ready" };
  legacyPacketBytes = 1000;
  openspecStatus = { level: "ok", detail: "ready" };
  output = "";
  runtime.doctor({ stage: "prove" });
  assert.match(output, /legacy numeric limit/);
  defaultReviewer = null;
  runtime.doctor({ stage: "prove" });
  output = "";
  orphanRows = [{ id: "orphan", reason: "packet missing" }];
  protocolMatch = false;
  runtime.doctor({ stage: "build", change: "orphan", json: true });
  assert.match(output, /"checks"/);
  assert.match(output, /change:orphan/);
  console.log = priorLog;
  priorLog("diagnostics runtime tests: PASS");
} finally {
  console.log = priorLog;
  process.exitCode = priorExit;
  rmSync(root, { recursive: true, force: true });
}
