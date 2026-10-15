import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  benchmarkSettings, createBenchmarkRuntime, median, performanceRegressionFinding,
  receiptRegressionFinding, regressionPercent
} from "../runtime/evidence/benchmark-runtime.mjs";
import { ADAPTERS } from "../runtime/evidence/provider-catalog.mjs";
import { prepareBaseTree } from "../runtime/evidence/test-discrimination.mjs";
import { createAdapterRuntime } from "../runtime/evidence/adapter-runtime.mjs";
import { configuredCommand } from "../runtime/evidence/evidence-results.mjs";
import { createProcessRuntime } from "../runtime/core/process-runtime.mjs";
import { createProofExecutionRuntime } from "../runtime/evidence/proof-execution-runtime.mjs";
import { createReceiptRuntime } from "../runtime/evidence/receipt-runtime.mjs";

const stableHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// A runCommand double whose durations the test controls: `base` and `head`
// are per-run duration lists keyed by the cwd the adapter chose.
function fakeRuns({ base = [], head = [], baseResult = null, headResult = null }) {
  const calls = [];
  const counters = { base: 0, head: 0 };
  const runCommand = async (command, args, options) => {
    const side = options.cwd === "/base-tree" ? "base" : "head";
    calls.push({ side, command, args, env: options.env, cwd: options.cwd });
    const index = counters[side]++;
    const override = side === "base" ? baseResult : headResult;
    if (override) return { stdout: "", stderr: "", durationMs: 1, ...override(index) };
    return { status: 0, error: null, timedOut: false, stdout: `${side} ${index}\n`, stderr: "",
      durationMs: (side === "base" ? base : head)[index] };
  };
  return { runCommand, calls };
}

function benchmarkRuntime(runs, { tree = true } = {}) {
  const removed = [];
  const runtime = createBenchmarkRuntime({
    prepareBaseTree: () => (tree ? { scratch: "/scratch", tree: "/base-tree" } : null),
    isProductPath: () => true,
    fileDigest: () => "digest",
    runCommand: runs.runCommand,
    removeTree: (path) => removed.push(path),
    stableHash
  });
  return { runtime, removed };
}

const request = (config = {}, extra = {}) => ({
  config: { adapter: "benchmark", command: ["node", "bench.mjs"], ...config },
  workspace: "/head", baseHead: "abc123", command: "node", args: ["bench.mjs"],
  env: { PATH: "/bin", FOUNDATION_CHANGE_ID: "change-a" }, timeoutMs: 1000, ...extra
});

test("benchmark is a declared provider adapter with documented defaults", () => {
  assert.ok(ADAPTERS.has("benchmark"));
  assert.deepEqual(benchmarkSettings({}), { runs: 5, maxRegressionPercent: 10, issues: [] });
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(regressionPercent(100, 104), 4);
  assert.equal(regressionPercent(3, 4), 33.33);
  assert.equal(regressionPercent(0, 4), null);
});

test("head within threshold passes with five samples per side, alternating, one environment", async () => {
  const runs = fakeRuns({ base: [100, 101, 99, 100, 100], head: [104, 103, 105, 104, 104] });
  const { runtime, removed } = benchmarkRuntime(runs);
  const result = await runtime.measure(request());
  assert.equal(result.status, "pass");
  assert.equal(result.benchmark.baseSamples.length, 5);
  assert.equal(result.benchmark.headSamples.length, 5);
  assert.deepEqual(runs.calls.map((call) => call.side),
    ["base", "head", "base", "head", "base", "head", "base", "head", "base", "head"]);
  assert.equal(result.benchmark.comparison.status, "compared");
  assert.equal(result.benchmark.comparison.baseMedianMs, 100);
  assert.equal(result.benchmark.comparison.headMedianMs, 104);
  assert.equal(result.benchmark.comparison.regressionPercent, 4);
  assert.equal(result.benchmark.comparison.regressed, false);
  // One descriptor: the same command and environment ran on both sides.
  assert.equal(typeof result.benchmark.environment, "object");
  assert.ok(result.benchmark.environment.identity);
  assert.ok(runs.calls.every((call) => call.env === runs.calls[0].env &&
    call.command === "node"));
  assert.equal(result.benchmark.baseHead, "abc123");
  assert.deepEqual(removed, ["/scratch"], "the base scratch tree is removed");
  assert.equal(performanceRegressionFinding("perf", result.benchmark), null);
});

test("head slower than the default threshold fails with a regression finding", async () => {
  // Five first-round runs per side, then ten confirmation runs per side.
  const runs = fakeRuns({ base: Array(15).fill(100), head: Array(15).fill(125) });
  const { runtime } = benchmarkRuntime(runs);
  const result = await runtime.measure(request());
  assert.equal(result.status, "fail");
  assert.equal(result.benchmark.maxRegressionPercent, 10);
  assert.equal(result.benchmark.comparison.regressed, true);
  assert.equal(result.benchmark.confirmation.runs, 10);
  assert.equal(result.benchmark.confirmation.headSamples.length, 10);
  assert.equal(result.benchmark.firstComparison.regressed, true);
  assert.equal(runs.calls.length, 30, "first round plus a twice-as-long confirmation");
  const finding = performanceRegressionFinding("perf", result.benchmark);
  assert.equal(finding.id, "perf:performance-regression");
  assert.equal(finding.provider, "perf");
  assert.equal(finding.baseMedianMs, 100);
  assert.equal(finding.headMedianMs, 125);
  assert.equal(finding.regressionPercent, 25);
  assert.equal(finding.threshold, 10);
  assert.deepEqual(receiptRegressionFinding("perf", {
    status: "fail", adapter: "benchmark", benchmark: result.benchmark
  }), finding);
  assert.equal(receiptRegressionFinding("perf", {
    status: "fail", adapter: "command", benchmark: result.benchmark
  }), null, "only a benchmark receipt carries a regression");
});

test("a regression exactly at the threshold passes", async () => {
  const runs = fakeRuns({ base: [100, 100, 100, 100, 100], head: [110, 110, 110, 110, 110] });
  const result = await benchmarkRuntime(runs).runtime.measure(request());
  assert.equal(result.benchmark.comparison.regressionPercent, 10);
  assert.equal(result.status, "pass");
});

test("an authored threshold replaces the default", async () => {
  const runs = fakeRuns({ base: Array(9).fill(100), head: Array(9).fill(103) });
  const result = await benchmarkRuntime(runs).runtime.measure(
    request({ runs: 3, maxRegressionPercent: 2 }));
  assert.equal(result.benchmark.runs, 3);
  assert.equal(result.benchmark.comparison.regressionPercent, 3);
  assert.equal(result.status, "fail");
  assert.equal(performanceRegressionFinding("perf", result.benchmark).threshold, 2);
});

test("a regression the confirmation round does not reproduce passes and keeps both rounds", async () => {
  // A noisy first round (head 125) that a fresh ten-run round does not confirm.
  const runs = fakeRuns({ base: Array(15).fill(100),
    head: [...Array(5).fill(125), ...Array(10).fill(102)] });
  const { runtime, removed } = benchmarkRuntime(runs);
  const result = await runtime.measure(request());
  assert.equal(result.status, "pass");
  assert.equal(result.benchmark.firstComparison.regressed, true);
  assert.equal(result.benchmark.firstComparison.regressionPercent, 25);
  assert.equal(result.benchmark.comparison.regressed, false);
  assert.equal(result.benchmark.comparison.regressionPercent, 2);
  assert.deepEqual(result.benchmark.headSamples, Array(5).fill(125),
    "the first round's samples stay in the receipt");
  assert.equal(performanceRegressionFinding("perf", result.benchmark), null);
  assert.deepEqual(removed, ["/scratch"], "one base tree serves both rounds");
});

test("a round that does not regress runs no confirmation", async () => {
  const runs = fakeRuns({ base: Array(5).fill(100), head: Array(5).fill(101) });
  const result = await benchmarkRuntime(runs).runtime.measure(request());
  assert.equal(result.benchmark.confirmation, undefined);
  assert.equal(result.benchmark.firstComparison, undefined);
  assert.equal(runs.calls.length, 10);
});

test("an unavailable base never blocks: head exit codes decide", async () => {
  // No baseHead: the base side never runs.
  const noBase = fakeRuns({ head: [200, 200, 200, 200, 200] });
  const missing = await benchmarkRuntime(noBase).runtime.measure(request({}, { baseHead: null }));
  assert.equal(missing.status, "pass");
  assert.deepEqual(missing.benchmark.comparison, { status: "unavailable", reason: "no-base-head" });
  assert.ok(noBase.calls.every((call) => call.side === "head"));
  assert.equal(missing.benchmark.headSamples.length, 5);

  // The base command cannot spawn.
  const spawnFails = fakeRuns({ head: [200, 200, 200, 200, 200],
    baseResult: () => ({ status: null, error: new Error("ENOENT") }) });
  const spawnFailure = await benchmarkRuntime(spawnFails).runtime.measure(request());
  assert.equal(spawnFailure.status, "pass");
  assert.deepEqual(spawnFailure.benchmark.comparison,
    { status: "unavailable", reason: "base-spawn-error" });
  assert.equal(spawnFails.calls.filter((call) => call.side === "base").length, 1,
    "a failed base is not retried on every run");

  // The base tree cannot be built.
  const noTree = fakeRuns({ head: [200, 200, 200, 200, 200] });
  const treeFailure = await benchmarkRuntime(noTree, { tree: false }).runtime.measure(request());
  assert.equal(treeFailure.status, "pass");
  assert.deepEqual(treeFailure.benchmark.comparison,
    { status: "unavailable", reason: "base-tree-unavailable" });

  // A base that fails on the original code is no comparison either.
  const baseExit = fakeRuns({ head: [200, 200, 200, 200, 200],
    baseResult: () => ({ status: 1, error: null }) });
  const exited = await benchmarkRuntime(baseExit).runtime.measure(request());
  assert.equal(exited.status, "pass");
  assert.equal(exited.benchmark.comparison.reason, "base-exit-1");
  assert.equal(performanceRegressionFinding("perf", exited.benchmark), null);
});

test("a failing head run is ordinary failed evidence, not a regression", async () => {
  const runs = fakeRuns({ base: [100, 100, 100, 100, 100],
    headResult: (index) => ({ status: index === 1 ? 2 : 0, error: null, durationMs: 100 }) });
  const result = await benchmarkRuntime(runs).runtime.measure(request());
  assert.equal(result.status, "fail");
  assert.deepEqual(result.benchmark.comparison, { status: "not-evaluated", reason: "head-exit-2" });
  assert.deepEqual(result.benchmark.headExitCodes, [0, 2], "measurement stops at the failure");
  assert.equal(performanceRegressionFinding("perf", result.benchmark), null);
  assert.equal(receiptRegressionFinding("perf", {
    status: "fail", adapter: "benchmark", benchmark: result.benchmark
  }), null);

  const timedOut = fakeRuns({ base: [100],
    headResult: () => ({ status: null, error: null, timedOut: true }) });
  assert.equal((await benchmarkRuntime(timedOut).runtime.measure(request())).status, "error");
});

test("fewer than three runs is a configuration error, never a measurement", async () => {
  assert.deepEqual(benchmarkSettings({ runs: 1 }).issues, ["runs must be an integer of at least 3"]);
  const runs = fakeRuns({});
  const result = await benchmarkRuntime(runs).runtime.measure(request({ runs: 1 }));
  assert.equal(result.status, "error");
  assert.match(result.observed, /runs must be an integer of at least 3/);
  assert.equal(runs.calls.length, 0);
});

// The real adapter path: a Git base, the shared scratch builder, real child
// processes, and the receipt fields the harness records.
function gitRepository(t) {
  const root = mkdtempSync(join(tmpdir(), "foundation-benchmark-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: workspace, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.email", "bench@example.test");
  git("config", "user.name", "bench");
  writeFileSync(join(workspace, "src", "delay.json"), JSON.stringify({ ms: 5 }));
  writeFileSync(join(workspace, "bench.cjs"),
    "const ms = require('./src/delay.json').ms; const end = Date.now() + ms; while (Date.now() < end);\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const baseHead = git("rev-parse", "HEAD");
  return { root, workspace, baseHead };
}

function adapterFixture(t, { slowMs, baseHead: recordBase = true, config = {} }) {
  const repo = gitRepository(t);
  writeFileSync(join(repo.workspace, "src", "delay.json"), JSON.stringify({ ms: slowMs }));
  const logs = join(repo.root, "logs");
  const receipts = [];
  const state = {
    status: "proving",
    workspace: { path: repo.workspace, mode: "worktree",
      ...(recordBase ? { baseHead: repo.baseHead } : {}) },
    activeProofRun: { workspaceHash: "workspace-a" }
  };
  const { runCommand } = createProcessRuntime({
    root: repo.root, logs, now: () => new Date().toISOString(), resolveServiceCwd: () => null
  });
  const benchmark = createBenchmarkRuntime({
    prepareBaseTree, isProductPath: (path) => path.startsWith("src/"),
    fileDigest: () => "digest", runCommand,
    removeTree: (path) => rmSync(path, { recursive: true, force: true }), stableHash
  });
  const unused = () => { throw new Error("unused in the benchmark path"); };
  const runtime = createAdapterRuntime({
    ROOT: repo.root, LOGS: logs, PROVIDERS: new Set(["performance"]),
    providerCapability: () => "performance", providerConfig: () => null, parseFlags: unused,
    providerWorkspace: () => repo.workspace,
    recordReceipt: (id, provider, status, flags, options) =>
      receipts.push({ id, provider, status, flags, options }),
    startServiceSession: unused, evidence: unused, resultAdapterResources: unused,
    loadRuntime: () => state, providerRepository: () => null, repositoryById: unused,
    configuredCommand,
    providerRepositories: () => [{ id: "root", mode: "write", workspacePath: repo.workspace }],
    fileDigest: () => "digest", pathInside: unused, stableHash, runCommand,
    providerWorkspaceHash: (_id, _provider, fallback) => fallback,
    providerClaims: () => ["perf-claim"], parseJsonOutput: unused, parseTapOutput: unused,
    parseNodeTestSpecOutput: unused, numericReportValue: unused,
    playwrightReportSummary: unused, requiredProviders: () => ["perf"],
    mutationProtocolResult: unused, now: () => new Date().toISOString(),
    die: (message) => { throw new Error(message); },
    serviceResourcesConflict: unused, maxParallelServices: () => 1,
    recordScheduler: () => {}, timestamp: Date.now,
    measureBenchmark: benchmark.measure
  });
  const providerConfig = {
    adapter: "benchmark", capability: "performance", runs: 3,
    command: [process.execPath, "bench.cjs"], ...config
  };
  return { ...repo, runtime, receipts, providerConfig, logs };
}

test("the benchmark adapter compares a real base archive with head and records the receipt", async (t) => {
  const fixture = adapterFixture(t, { slowMs: 150 });
  const result = await fixture.runtime.executeAdapter(
    "change-a", "perf", fixture.providerConfig, "proof-1", new Map());
  assert.equal(result.status, "fail");
  assert.equal(fixture.receipts.length, 1);
  const [receipt] = fixture.receipts;
  assert.equal(receipt.status, "fail");
  assert.equal(receipt.flags.adapter, "benchmark");
  assert.deepEqual(receipt.options, { executed: true });
  const recorded = receipt.flags.benchmark;
  assert.equal(recorded.baseSamples.length, 3);
  assert.equal(recorded.headSamples.length, 3);
  assert.equal(recorded.comparison.status, "compared");
  assert.ok(recorded.comparison.regressionPercent > 10, JSON.stringify(recorded.comparison));
  assert.equal(recorded.baseHead, fixture.baseHead);
  assert.ok(recorded.environment.identity);
  const finding = receiptRegressionFinding("perf",
    { status: receipt.status, adapter: "benchmark", benchmark: recorded });
  assert.equal(finding.id, "perf:performance-regression");
  assert.ok(existsSync(join(fixture.root, receipt.flags.log)), "the execution log is written");
  assert.match(receipt.flags.observed, /alternating base\/head runs/);
});

test("the benchmark adapter without a recorded base decides from head exits only", async (t) => {
  const fixture = adapterFixture(t, { slowMs: 1, baseHead: false });
  const result = await fixture.runtime.executeAdapter(
    "change-a", "perf", fixture.providerConfig, "proof-1", new Map());
  assert.equal(result.status, "pass");
  const recorded = fixture.receipts[0].flags.benchmark;
  assert.deepEqual(recorded.comparison, { status: "unavailable", reason: "no-base-head" });
  assert.equal(recorded.headSamples.length, 3);
  assert.equal(recorded.baseSamples.length, 0);
});

function receiptFixture() {
  const written = new Map();
  const config = { capability: "performance", adapter: "benchmark", command: ["node", "b.cjs"] };
  const runtime = createReceiptRuntime({
    ROOT: "/project", LOGS: "/project/logs", PROVIDERS: new Set(["performance"]),
    INPUT_MODES: new Set(["browser-automation"]), providerWorkspace: () => "/project",
    ADAPTER_PROTOCOL_VERSION: 3, PROVIDER_PROTOCOL_VERSION: 4,
    REVIEW_PROTOCOL_VERSION: 5, ACCEPTANCE_PROTOCOL_VERSION: 6,
    validate: () => {}, relevantHash: () => "hash", requiredProviders: () => [],
    advisoryCapabilities: () => [], receiptValidity: () => ({ validity: "valid" }),
    now: () => "2026-10-15T00:00:00.000Z",
    writeJson: (path, value) => written.set(path, structuredClone(value)),
    receiptPath: (id, provider) => `/receipts/${id}/${provider}.json`,
    providerConfig: () => config,
    providerCapability: (_provider, configured) => configured?.capability || null,
    loadRuntime: () => ({ activeProofRun: { id: "run", workspaceHash: "h", snapshotId: "s" } }),
    resolvedAcceptance: () => ({ required: false }),
    evidence: () => ({ claims: [{ id: "perf-claim" }] }),
    claimsForProvider: () => [{ id: "perf-claim" }], providerWorkspaceHash: () => "h",
    providerRepository: () => null, providerRepositories: () => [{ id: "root" }],
    rejectPrototypeEvidenceInputs: () => {},
    durableArtifact: (_id, _provider, _run, artifact) => artifact,
    providerInputIdentity: () => ({ mode: "workspace", files: ["src/a.mjs"] }),
    contractFingerprint: () => "contract", executionFingerprint: () => "execution",
    stableHash, relevantSnapshot: () => ({}), changeDiffIdentity: () => "diff",
    adapterFingerprint: () => "adapter", environmentDescriptor: () => ({ os: "test" }),
    reviewPolicy: () => ({}), subjectProvenance: () => [],
    reviewProvenanceResult: () => ({ complete: true }), readJson: () => ({}),
    flagValues: () => [], reviewHistoryState: () => ({}), reserveReviewAttempt: () => ({}),
    reviewAttemptByDigest: () => null, reviewAttemptIsValid: () => true,
    reviewReceiptBinding: () => ({}), recordRepairClosureAttempt: () => ({}),
    deliveredAiAttempts: () => [], groundingForReview: () => null,
    foundationPolicy: () => ({ workflow: { reviewCircuit: "legacy" } }),
    die: (message) => { throw new Error(message); }
  });
  return { runtime, receipt: () => written.get("/receipts/change-a/perf.json") };
}

test("an executed benchmark receipt keeps the comparison; a manual one cannot claim it", () => {
  const benchmark = { version: 1, runs: 3, baseSamples: [1, 1, 1], headSamples: [1, 1, 1],
    environment: { identity: "env" }, comparison: { status: "unavailable", reason: "no-base-head" } };
  const executed = receiptFixture();
  executed.runtime.recordReceipt("change-a", "perf", "pass", {
    adapter: "benchmark", benchmark,
    artifacts: [{ path: "run.log", type: "command-log", required: true }]
  }, { executed: true, quiet: true });
  assert.deepEqual(executed.receipt().benchmark, benchmark);
  assert.equal(executed.receipt().adapter, "benchmark");

  const manual = receiptFixture();
  assert.throws(() => manual.runtime.recordReceipt("change-a", "perf", "pass", {
    adapter: "benchmark", benchmark, observed: "fast", source: "human:x", reference: ["r"]
  }, { quiet: true }), /names an adapter the harness executes/);
  assert.throws(() => manual.runtime.recordReceipt("change-a", "perf", "pass", {
    benchmark, observed: "fast", source: "human:x", reference: ["r"]
  }, { quiet: true }), /must come from an execution/);
});

// Proof routing: a failed benchmark receipt with a regression becomes the
// performance-regression repair through the same convergent gate.
function proofFixture(regression) {
  const workspaceHash = "workspace-a";
  const runtime = createProofExecutionRuntime({
    proofReadinessValue: () => ({
      version: 1, changeId: "change-a", status: "READY", workspaceHash, issues: [],
      externalProviders: [], unavailableProviders: [], pendingTasks: [], next: []
    }),
    relevantSnapshot: () => ({ id: "snapshot-a", workspaceHash }),
    loadRuntime: () => ({ id: "change-a" }), saveRuntime: () => {},
    now: () => "2026-10-15T00:00:00.000Z",
    requiredProviders: () => ["perf"],
    receiptValidity: (_id, provider) => ({ provider, validity: "fail" }),
    rebindReusableReceipt: () => {}, rebindDiffBoundReceipt: () => {},
    executionNodes: () => ({ nodes: [], unconfigured: [], unavailable: [] }),
    collectableExecutionNodes: (_id, nodes) => ({ nodes, blocked: [] }),
    startRequiredServices: async () => [], runExecutionDag: async () => [],
    durableArtifact: () => null, pendingTasks: () => [], proofPreflight: () => {},
    prove: () => {}, proofAudit: () => ({ valid: false, reason: "missing-proof" }),
    readJson: () => null, proofPath: () => "proof.json",
    providerCapability: () => "performance",
    providerConfig: () => ({ adapter: "benchmark", capability: "performance" }),
    performanceRegression: (_id, provider) => regression ? {
      id: `${provider}:performance-regression`, provider, classification: "product",
      severity: "error", rootCause: "performance-regression",
      message: "head median 125ms is 25% slower than base median 100ms",
      baseMedianMs: 100, headMedianMs: 125, regressionPercent: 25, threshold: 10,
      claimIds: [], criticalCaseIds: []
    } : null,
    die: (message) => { throw new Error(message); }
  });
  return runtime;
}

async function quietly(operation) {
  const prior = console.log;
  const priorExit = process.exitCode;
  console.log = () => {};
  try { return await operation(); }
  finally { console.log = prior; process.exitCode = priorExit; }
}

test("Prove returns REPAIR performance-regression and repeats reach the recovery ladder", async () => {
  const runtime = proofFixture(true);
  const first = await quietly(() => runtime.proofAdvance("change-a"));
  assert.equal(first.status, "ACTION_REQUIRED");
  assert.equal(first.route, "AUTO_REPAIR");
  assert.equal(first.stage, "performance-regression");
  const finding = first.repairPlan.tasks.flatMap((task) => task.findingIds);
  assert.deepEqual(finding, ["perf:performance-regression"]);
  assert.match(first.next[0].reason, /25% slower than base/);
  const again = await quietly(() => runtime.proofAdvance("change-a"));
  assert.equal(again.status, "NEEDS_USER_DECISION");
  assert.equal(again.route, "NO_PROGRESS_DECISION",
    "an unchanged regression enters the existing no-progress decision");
});

test("Prove keeps evidence-failed when the benchmark head itself failed", async () => {
  const stop = await quietly(() => proofFixture(false).proofAdvance("change-a"));
  assert.equal(stop.stage, "evidence-failed");
  assert.equal(stop.repairPlan.tasks[0].findingIds[0], "perf:fail");
});
