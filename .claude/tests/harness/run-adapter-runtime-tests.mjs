import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertReadRepositoriesUnchanged, createAdapterRuntime, criticalCaseResult,
  discoveryCountRepair, providerRepositoryManifestValue, repositoryStatus
} from "../../harness/runtime/evidence/adapter-runtime.mjs";
import {
  numericReportValue, parseExecutedTestEvidence, parseNodeTestSpecOutput, parseTapOutput,
  playwrightReportSummary
} from "../../harness/runtime/evidence/evidence-results.mjs";

const stableHash = (value) => createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");
const fail = (message) => { throw new Error(message); };

test("read-only postcondition ignores writes and rejects dirty reads", () => {
  const rows = [{ id: "write", mode: "write" }, { id: "read", mode: "read" }];
  assert.doesNotThrow(() => assertReadRepositoriesUnchanged({
    repositoryStatus: () => "", die: fail
  }, "test", rows));
  assert.throws(() => assertReadRepositoriesUnchanged({
    repositoryStatus: () => " M lockfile", die: fail
  }, "test", rows), /modified read-only repository 'read'/);
});

test("repository status distinguishes clean, dirty, and unavailable workspaces", (t) => {
  const root = mkdtempSync(join(tmpdir(), "adapter-repository-status-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  assert.equal(repositoryStatus({ workspacePath: root }), "");
  writeFileSync(join(root, "dirty.txt"), "dirty\n");
  assert.match(repositoryStatus({ workspacePath: root }), /\?\? dirty\.txt/);
  assert.equal(repositoryStatus({ workspacePath: join(root, "missing") }), null);
});

test("repository manifest validates workspaces, setup, and read-only state", () => {
  const root = { id: "root", workspacePath: "/root", mode: "write", baseHead: "row-root" };
  const child = { id: "child", workspacePath: "/child", mode: "read", baseHead: "row-child" };
  const context = {
    pathExists: () => true,
    repositoryStatus: () => "",
    die: fail
  };
  const value = providerRepositoryManifestValue(context, "change", "test", {
    workspace: { baseHead: "runtime-root" },
    repositories: { child: { baseHead: "runtime-child" } }
  }, [root, child]);
  assert.deepEqual(value, {
    version: 1, changeId: "change", provider: "test",
    repositories: {
      root: { path: "/root", access: "write", baseHead: "runtime-root" },
      child: { path: "/child", access: "read", baseHead: "runtime-child" }
    }
  });

  assert.throws(() => providerRepositoryManifestValue({
    ...context, pathExists: () => false
  }, "change", "test", {}, [root]), /workspace is missing/);
  assert.throws(() => providerRepositoryManifestValue(context, "change", "test", {
    repositories: { child: { setup: { status: "failed" } } }
  }, [child]), /setup failed/);
  assert.throws(() => providerRepositoryManifestValue({
    ...context, repositoryStatus: () => " M generated.txt"
  }, "change", "test", {}, [child]), /read-only repository 'child' changed/);
});

test("repository manifest uses selected heads and rejects an unbound child", () => {
  const context = { pathExists: () => true, repositoryStatus: () => null, die: fail };
  const value = providerRepositoryManifestValue(context, "change", "test", {}, [{
    id: "child", workspacePath: "/child", mode: "read", baseHead: "selected"
  }]);
  assert.equal(value.repositories.child.baseHead, "selected");
  assert.throws(() => providerRepositoryManifestValue(context, "change", "test", {}, [{
    id: "empty", workspacePath: "/empty", mode: "write"
  }]), /repository 'empty' has no recorded baseHead/);
});

function result(patch = {}) {
  return {
    status: 0, signal: null, timedOut: false, error: null,
    durationMs: 10, startedAt: new Date().toISOString(),
    stdout: "{}", stderr: "", readinessObserved: true,
    ...patch
  };
}

function fixture(config, resultValue = result(), overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "adapter-runtime-unit-"));
  const logs = join(root, ".foundation", "logs");
  mkdirSync(logs, { recursive: true });
  const receipts = [];
  let executions = 0;
  const configs = { provider: config, discovery: {
    capability: "discovery", adapter: "test-discovery"
  }, browser: config };
  const repository = {
    id: "root", workspacePath: root, path: root, mode: "write", baseHead: "base"
  };
  const runtime = createAdapterRuntime({
    ROOT: root, LOGS: logs,
    PROVIDERS: new Set(["test", "discovery", "browser", "mutation"]),
    providerCapability: (provider, configured) => configured?.capability || provider,
    providerConfig: (_id, provider) => configs[provider] || null,
    parseFlags: () => ({ flags: {}, rest: [] }),
    providerWorkspace: () => root,
    recordReceipt: (id, provider, status, flags, options) =>
      receipts.push({ id, provider, status, flags: structuredClone(flags), options }),
    startServiceSession: async () => ({ stop: () => {} }),
    evidence: () => ({ execution: { services: {} } }),
    resultAdapterResources: () => [],
    loadRuntime: () => ({
      workspace: { path: root, baseHead: "base" },
      repositories: { root: { baseHead: "base" } },
      activeProofRun: { workspaceHash: "workspace" }
    }),
    providerRepository: () => repository,
    repositoryById: () => repository,
    configuredCommand: () => ({ command: "node", args: ["test.js"], display: "node test.js" }),
    providerRepositories: () => [repository],
    fileDigest: (path) => stableHash(path),
    pathInside: () => true,
    stableHash,
    runCommand: () => { executions += 1; return Promise.resolve(resultValue); },
    providerWorkspaceHash: () => "workspace",
    providerClaims: (_id, provider) => provider === "discovery"
      ? ["test-claim"] : ["test-claim"],
    parseJsonOutput: (value) => {
      try { return JSON.parse(value); } catch { return null; }
    },
    parseTapOutput: () => null,
    parseNodeTestSpecOutput: () => null,
    numericReportValue: (report) => Number.isFinite(report?.numTotalTests)
      ? report.numTotalTests : null,
    playwrightReportSummary: (report) => report.summary || null,
    requiredProviders: () => ["provider", "browser"],
    mutationProtocolResult: () => "behavioral-kill",
    now: () => "2026-08-25T00:00:00.000Z",
    serviceResourcesConflict: () => false,
    maxParallelServices: () => 4,
    recordScheduler: () => {},
    timestamp: Date.now,
    die: fail,
    ...overrides
  });
  return { runtime, root, receipts, executions: () => executions };
}

test("generic command execution is deduplicated while receipts remain provider-specific", async () => {
  const world = fixture({ capability: "test", adapter: "command" });
  const cache = new Map();
  assert.deepEqual(await world.runtime.executeAdapter(
    "change", "provider", { capability: "test", adapter: "command" }, "run", cache
  ), { version: 1, provider: "provider", status: "pass", observations: [] });
  await world.runtime.executeAdapter(
    "change", "provider", { capability: "test", adapter: "command" }, "run", cache);
  assert.equal(world.executions(), 1);
  assert.equal(world.receipts.length, 2);
  assert.equal(world.receipts[0].flags.commandExecutionId,
    world.receipts[1].flags.commandExecutionId);
});

test("critical cases normalize structured and test-runner reports", () => {
  assert.equal(criticalCaseResult({
    testResults: [{ assertionResults: [{
      ancestorTitles: ["suite"], title: "[case-1] works", status: "passed"
    }] }]
  }, ["case-1"]).status, "pass");
  assert.equal(criticalCaseResult({ criticalCases: [
    { id: "case-1", status: "failed" }
  ] }, ["case-1"]).status, "fail");
  assert.deepEqual(criticalCaseResult({ criticalCases: [
    { id: "descriptive test title", status: "passed" }
  ] }, ["case-1"]), {
    status: "pass", observations: [{ id: "case-1", status: "passed" }]
  });
  assert.deepEqual(criticalCaseResult({ foundation: { criticalCases: [
    null, { id: "", status: "pass" }, { id: 42, status: "OK" }
  ] } }, ["42"]), { status: "pass", observations: [{ id: "42", status: "ok" }] });
  assert.deepEqual(criticalCaseResult({ testResults: [null, {
    assertionResults: [{ fullName: "case-full", status: "SUCCESS" }]
  }] }, ["case-full"]), {
    status: "pass", observations: [{ id: "case-full", status: "success" }]
  });
  assert.deepEqual(criticalCaseResult({
    testResults: [{ assertionResults: [{}] }]
  }, ["case-missing"]), {
    status: "fail", observations: [{ id: "case-missing", status: "missing" }]
  });
  assert.deepEqual(criticalCaseResult({}, []), { status: "pass", observations: [] });
  assert.deepEqual(criticalCaseResult({ criticalCases: [{
    id: "unknown id is rejected [unknown-id-rejected]", status: "pass"
  }] }, ["unknown-id-rejected"]), {
    status: "pass", observations: [{ id: "unknown-id-rejected", status: "pass" }]
  });
});

test("playwright critical-case annotations bind receipts without title conventions", async () => {
  const summary = {
    claims: ["test-claim"], attachments: [], skippedClaims: [],
    criticalCases: [{ id: "CC-DRAWER-NARROW", status: "pass" }],
    tests: 1, failed: 0, skipped: 0
  };
  const config = {
    capability: "browser", adapter: "playwright",
    command: ["playwright", "test"], reportFormat: "json",
    criticalCases: ["CC-DRAWER-NARROW"]
  };
  const world = fixture(config, result({
    stdout: JSON.stringify({ summary })
  }));
  const outcome = await world.runtime.executeAdapter(
    "change", "provider", config, "run", new Map());
  assert.equal(outcome.status, "pass");
  assert.deepEqual(world.receipts[0].flags.criticalCases,
    [{ id: "CC-DRAWER-NARROW", status: "pass" }]);
});

test("contract digest compares repository artifacts without a command process", async () => {
  const config = {
    capability: "test", adapter: "contract-digest",
    contract: { root: "contract.json", repo2: "contract.json" }
  };
  const world = fixture(config);
  writeFileSync(join(world.root, "contract.json"), "same contract\n");
  const outcome = await world.runtime.executeAdapter(
    "change", "provider", config, "run", new Map());
  assert.equal(outcome.status, "pass");
  assert.equal(world.executions(), 0);
  assert.equal(world.receipts[0].flags.adapter, "contract-digest");
});

test("execution context binds declared and resolved environment inputs", async () => {
  const key = "FOUNDATION_ADAPTER_TEST_ENV";
  const prior = process.env[key];
  process.env[key] = "resolved";
  try {
    const config = {
      capability: "test", adapter: "command", envFrom: [key, "MISSING_ADAPTER_ENV"],
      env: { LOCAL_VALUE: "configured" }, timeoutMs: 50,
      readiness: { url: "http://localhost" }
    };
    const world = fixture(config);
    await world.runtime.executeAdapter("change", "provider", config, "run", new Map());
    assert.equal(world.executions(), 1);
  } finally {
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
});

test("execution context supports repository, workspace, and root fallbacks", async () => {
  const config = { capability: "test", adapter: "command" };
  const workspaceFallback = fixture(config, result(), {
    providerRepository: () => null,
    loadRuntime: () => ({ workspace: { path: "/workspace-fallback" }, repositories: {} })
  });
  await workspaceFallback.runtime.executeAdapter(
    "change", "provider", config, "run", new Map());

  const rootFallback = fixture(config, result(), {
    providerRepository: () => null,
    loadRuntime: () => ({ workspace: {}, repositories: {} })
  });
  await rootFallback.runtime.executeAdapter(
    "change", "provider", config, "run", new Map());

  const rowFallback = fixture(config, result(), {
    loadRuntime: () => ({ workspace: {}, repositories: {} }),
    providerRepositories: () => [{
      id: "root", workspacePath: rootFallback.root,
      path: rootFallback.root, mode: "write", baseHead: "row-base"
    }]
  });
  await rowFallback.runtime.executeAdapter(
    "change", "provider", config, "run", new Map());
  assert.equal(workspaceFallback.executions(), 1);
  assert.equal(rootFallback.executions(), 1);
  assert.equal(rowFallback.executions(), 1);
});

test("fresh reports are evidence and stale reports are ignored", async () => {
  const config = {
    capability: "test", adapter: "command", report: "result.json", reportFormat: "json"
  };
  const fresh = fixture(config, result({ startedAt: "2020-01-01T00:00:00.000Z" }));
  writeFileSync(join(fresh.root, "result.json"), JSON.stringify({ ok: true }));
  await fresh.runtime.executeAdapter("change", "provider", config, "run", new Map());
  assert.equal(fresh.receipts[0].flags.artifacts.some((row) =>
    row.type === "structured-report"), true);

  const stale = fixture(config, result({ startedAt: "2999-01-01T00:00:00.000Z" }));
  writeFileSync(join(stale.root, "result.json"), JSON.stringify({ stale: true }));
  await stale.runtime.executeAdapter("change", "provider", config, "run", new Map());
  assert.equal(stale.receipts[0].flags.artifacts.length, 1);

  const tapConfig = { capability: "test", adapter: "command", reportFormat: "tap" };
  const tap = fixture(tapConfig, result({ stdout: "1..1\nok 1 - works" }), {
    parseTapOutput: () => ({ tests: 1 })
  });
  await tap.runtime.executeAdapter("change", "provider", tapConfig, "run", new Map());
  assert.equal(tap.receipts[0].status, "pass");
});

test("test-discovery records test and discovery outcomes", async () => {
  const config = {
    capability: "test", adapter: "test-discovery",
    discoveryProvider: "discovery", minimum: 2
  };
  const world = fixture(config, result({ stdout: JSON.stringify({ numTotalTests: 3 }) }));
  const outcome = await world.runtime.executeAdapter(
    "change", "provider", config, "run", new Map());
  assert.equal(outcome.status, "pass");
  assert.deepEqual(world.receipts.map((row) => [row.provider, row.status]), [
    ["provider", "pass"], ["discovery", "pass"]
  ]);
  assert.equal(world.receipts[1].flags.discovered, 3);
});

test("test-discovery falls back to Node spec output for the built-in runner", async () => {
  const config = {
    capability: "test", adapter: "test-discovery", command: ["node", "--test"],
    discoveryProvider: "discovery", minimum: 1, reportFormat: "tap"
  };
  const world = fixture(config, result({ stdout: "✔ works (1ms)\nℹ tests 1\nℹ pass 1\nℹ fail 0" }), {
    parseNodeTestSpecOutput: () => ({ totalTests: 1, criticalCases: [] }),
    numericReportValue: (report) => report?.totalTests ?? null
  });
  const outcome = await world.runtime.executeAdapter(
    "change", "provider", config, "run", new Map());
  assert.equal(outcome.status, "pass");
  assert.equal(world.receipts[1].flags.discovered, 1);
});

test("auto format reads Node spec output behind an npm test wrapper", async () => {
  const config = {
    capability: "test", adapter: "test-discovery", command: ["sh", "-c", "npm test"],
    discoveryProvider: "discovery", minimum: 1, reportFormat: "auto"
  };
  const world = fixture(config, result({ stdout: "✔ works (1ms)\nℹ tests 8\nℹ pass 8\nℹ fail 0" }), {
    parseNodeTestSpecOutput: () => ({ totalTests: 8, criticalCases: [] }),
    numericReportValue: (report) => report?.totalTests ?? null
  });
  const outcome = await world.runtime.executeAdapter(
    "change", "provider", config, "run", new Map());
  assert.equal(outcome.status, "pass");
  assert.equal(world.receipts[1].flags.discovered, 8);
});

test("test-discovery reads counted shell summaries retained by RTK", async () => {
  const config = { capability: "test", adapter: "test-discovery", minimum: 1 };
  for (const [stdout, status, count, expected] of [
    ["OUTPUT:\na: ALL PASS (5/5 assertions)\nb: ALL PASS (7/7 assertions)", 0, 12, "pass"],
    ["a: 2/5 assertion(s) FAILED", 1, 5, "fail"],
    ["a: ALL PASS (4/5 assertions)", 0, null, "inconclusive"]
  ]) {
    const world = fixture(config, result({ stdout, status }), {
      numericReportValue: (report) => report?.totalTests ?? null
    });
    assert.equal((await world.runtime.executeAdapter(
      "change", "provider", config, "run", new Map())).status, expected);
    assert.equal(world.receipts[1].flags.discovered, count);
  }
});

test("test-discovery distinguishes unavailable counts and infrastructure errors", async () => {
  const config = { capability: "test", adapter: "test-discovery", minimum: 1 };
  const unknown = fixture(config, result({ stdout: "not-json" }));
  assert.equal((await unknown.runtime.executeAdapter(
    "change", "provider", config, "run", new Map())).status, "inconclusive");

  const unavailable = fixture({ ...config, readiness: { url: "http://localhost" } },
    result({ readinessObserved: false }));
  assert.equal((await unavailable.runtime.executeAdapter(
    "change", "provider", { ...config, readiness: { url: "http://localhost" } },
    "run", new Map())).status, "error");

  const belowMinimum = fixture(config,
    result({ stdout: JSON.stringify({ numTotalTests: 0 }) }));
  assert.equal((await belowMinimum.runtime.executeAdapter(
    "change", "provider", config, "run", new Map())).status, "fail");
  const failedTest = fixture(config,
    result({ status: 1, stdout: JSON.stringify({ numTotalTests: 2 }) }));
  assert.equal((await failedTest.runtime.executeAdapter(
    "change", "provider", config, "run", new Map())).status, "fail");
});

function laneLoadRuntime(schema) {
  return () => ({
    schema,
    workspace: { path: "/tmp", baseHead: "base" },
    repositories: { root: { baseHead: "base" } },
    activeProofRun: { workspaceHash: "workspace" }
  });
}

test("rapid lane accepts exit 0 with executed-test evidence as exit-code measurement", async () => {
  const config = { capability: "test", adapter: "test-discovery", minimum: 1 };
  const world = fixture(config, result({ stdout: "running\n✔ adds (0.4ms)\n# tests 1\ndone" }),
    { loadRuntime: laneLoadRuntime("foundation-rapid") });
  const outcome = await world.runtime.executeAdapter(
    "change", "provider", config, "run", new Map());
  assert.equal(outcome.status, "pass");
  const discovery = world.receipts[1];
  assert.equal(discovery.status, "pass");
  assert.equal(discovery.flags.discovered, null);
  assert.equal(discovery.flags.countMeasurement, "exit-code");
  assert.match(discovery.flags.observed, /exit 0 with executed-test marker node-spec-pass/);
  assert.equal(outcome.observations.at(-1).countMeasurement, "exit-code");
});

test("rapid lane without executed-test evidence stays inconclusive with the repair", async () => {
  const config = { capability: "test", adapter: "test-discovery", minimum: 1 };
  for (const stdout of ["build complete", "no tests found\n✔ lint", "Ran 0 tests in 0.0s",
    "✔ No problems found", "✔ Compiled successfully\n✔ Linted 12 files"]) {
    const world = fixture(config, result({ stdout }),
      { loadRuntime: laneLoadRuntime("foundation-rapid") });
    assert.equal((await world.runtime.executeAdapter(
      "change", "provider", config, "run", new Map())).status, "inconclusive", stdout);
    assert.equal(world.receipts[1].flags.countMeasurement, null);
    assert.match(world.receipts[1].flags.observed, /structured test count unavailable/);
  }
});

test("exit-code measurement is rapid-only, minimum-1-only, and never excuses a failure", async () => {
  const config = { capability: "test", adapter: "test-discovery", minimum: 1 };
  const stdout = "ok 1 - adds";
  const standard = fixture(config, result({ stdout }),
    { loadRuntime: laneLoadRuntime("foundation-standard") });
  assert.equal((await standard.runtime.executeAdapter(
    "change", "provider", config, "run", new Map())).status, "inconclusive");
  assert.equal(standard.receipts[1].flags.countMeasurement, null);

  const floor = { ...config, minimum: 2 };
  const aboveOne = fixture(floor, result({ stdout }),
    { loadRuntime: laneLoadRuntime("foundation-rapid") });
  assert.equal((await aboveOne.runtime.executeAdapter(
    "change", "provider", floor, "run", new Map())).status, "inconclusive");

  const failed = fixture(config, result({ stdout, status: 1 }),
    { loadRuntime: laneLoadRuntime("foundation-rapid") });
  assert.equal((await failed.runtime.executeAdapter(
    "change", "provider", config, "run", new Map())).status, "fail");
  assert.deepEqual(failed.receipts.map((row) => row.status), ["fail", "inconclusive"]);
});

test("executed-test evidence recognizes runner pass lines and rejects empty runs", () => {
  for (const text of [
    "✔ works (1ms)\nℹ tests 1", "✔ works\n# pass 2", "ok 3 - parses", "PASS src/a.test.js", "--- PASS: TestAdd (0.00s)",
    "ok  \texample.com/pkg\t0.012s", "test_add (tests.Math) ... ok",
    "test tests::adds ... ok", "===== 5 passed in 0.12s =====", "  3 passing (8ms)",
    "Ran 4 tests in 0.001s", "2 examples, 0 failures", "\x1b[32m✔\x1b[39m colored\nℹ tests 1"
  ]) assert.ok(parseExecutedTestEvidence(text), text);
  for (const text of [
    "", "build complete", "PASS", "0 passed", "Ran 0 tests in 0.0s", "0 examples, 0 failures",
    "No tests found, exiting with code 0", "ok  \tpkg\t0.01s [no tests to run]",
    "?   \tpkg\t[no test files]", "all good ✔", "ok",
    "✔ No problems", "✔ Build complete\n✔ Linted 3 files", "✔ works\nℹ tests 0"
  ]) assert.equal(parseExecutedTestEvidence(text), null, text);
});

for (const results of [null, {}, [], [{}], [null], [{ status: "unknown" }],
  [{ status: "passed" }, {}], [{ status: "skipped" }]])
test(`Playwright does not prove annotated unexecuted or invalid outcomes: ${JSON.stringify(results)}`, async (t) => {
  const config = { capability: "browser", adapter: "playwright", criticalCases: ["case-1"] };
  const report = { suites: [{ specs: [{ tests: [{
    annotations: [{ type: "claim", description: "test-claim" },
      { type: "critical-case", description: "case-1" }], results
  }] }] }] };
  const world = fixture(config, result({ stdout: JSON.stringify(report) }), { playwrightReportSummary });
  t.after(() => rmSync(world.root, { recursive: true, force: true }));
  const outcome = await world.runtime.executeAdapter("change", "provider", config, "run", new Map());
  assert.equal(outcome.status, "inconclusive");
  assert(world.receipts.every((row) => row.status === "inconclusive"));
  assert(!playwrightReportSummary(report).claims.includes("test-claim"));
});

test("Playwright zero executions cannot pass even without required claims", async (t) => {
  const config = { capability: "browser", adapter: "playwright" };
  const world = fixture(config, result({ stdout: '{"suites":[]}' }), {
    playwrightReportSummary, providerClaims: () => []
  });
  t.after(() => rmSync(world.root, { recursive: true, force: true }));
  assert.equal((await world.runtime.executeAdapter("change", "provider", config, "run", new Map())).status,
    "inconclusive");
});

test("Playwright repaired reporter resumes to pass while failed retries remain failures", async (t) => {
  const config = { capability: "browser", adapter: "playwright", criticalCases: ["case-1"] };
  const output = result();
  const world = fixture(config, output, { playwrightReportSummary });
  t.after(() => rmSync(world.root, { recursive: true, force: true }));
  for (const [results, expected] of [[[], "inconclusive"],
    [[{ status: "failed" }, { status: "passed" }], "fail"],
    [[{ status: "passed" }], "pass"]]) {
    output.stdout = JSON.stringify({ tests: [{
      annotations: [{ type: "claim", description: "test-claim" },
        { type: "critical-case", description: "case-1" }], results
    }] });
    assert.equal((await world.runtime.executeAdapter("change", "provider", config,
      `run-${expected}`, new Map())).status, expected);
  }
});

test("playwright emits covered output receipts and attachments", async () => {
  const config = {
    capability: "browser", adapter: "playwright", inputMode: "browser-automation",
    foregroundRequired: true, foregroundAvailable: true
  };
  const report = { summary: {
    tests: 1, failed: 0, skipped: 0, claims: ["test-claim"],
    skippedClaims: [], attachments: ["trace.zip"]
  } };
  const configured = fixture(config, result({ stdout: JSON.stringify(report) }));
  writeFileSync(join(configured.root, "trace.zip"), "trace");
  const outcome = await configured.runtime.executeAdapter(
    "change", "provider", config, "run", new Map());
  assert.equal(outcome.status, "pass");
  assert.equal(configured.receipts[0].flags["input-mode"], "browser-automation");
  assert.equal(configured.receipts[0].flags.artifacts.some((row) =>
    row.type === "playwright-attachment"), true);
});

test("playwright reports missing, skipped, failed, and unavailable evidence", async () => {
  const config = { capability: "browser", adapter: "playwright" };
  const missingReport = fixture(config, result({ stdout: "not-json" }));
  assert.equal((await missingReport.runtime.executeAdapter(
    "change", "provider", config, "run", new Map())).status, "inconclusive");
  assert.match(missingReport.receipts[0].flags.observed, /unavailable/);

  const missingClaimReport = { summary: {
    tests: 2, failed: 0, skipped: 1, claims: [],
    skippedClaims: ["test-claim"], attachments: []
  } };
  const missingClaim = fixture(config,
    result({ stdout: JSON.stringify(missingClaimReport) }));
  assert.equal((await missingClaim.runtime.executeAdapter(
    "change", "provider", config, "run", new Map())).status, "inconclusive");
  assert.match(missingClaim.receipts[0].flags.observed, /missing test-claim/);
  assert.match(missingClaim.receipts[0].flags.observed, /claimed only by skipped/);

  const failedReport = { summary: {
    tests: 1, failed: 1, skipped: 0, claims: ["test-claim"],
    skippedClaims: [], attachments: []
  } };
  const failed = fixture(config, result({ stdout: JSON.stringify(failedReport) }));
  assert.equal((await failed.runtime.executeAdapter(
    "change", "provider", config, "run", new Map())).status, "fail");
});

test("mutation v1 and v2 map protocol evidence into passing receipts", async () => {
  const v1 = { capability: "mutation", adapter: "command",
    resultProtocol: "foundation-mutation-v1" };
  const legacy = fixture(v1, result({ stdout: "FOUNDATION_MUTATION_RESULT=behavioral-kill" }));
  assert.equal((await legacy.runtime.executeAdapter(
    "change", "provider", v1, "run", new Map())).status, "pass");
  assert.equal(legacy.receipts[0].flags.classification, "behavioral-kill");

  const v2 = {
    capability: "mutation", adapter: "command", resultProtocol: "foundation-mutation-v2",
    requiredMutants: ["m1"], mutantKillers: { m1: "case-1" }
  };
  const report = {
    mutants: [{ id: "m1", applied: true, compiled: true, result: "killed", killedBy: "case-1" }],
    criticalCases: [{ id: "case-1", status: "pass" }]
  };
  const modern = fixture(v2, result({ stdout: JSON.stringify(report) }));
  assert.equal((await modern.runtime.executeAdapter(
    "change", "provider", v2, "run", new Map())).status, "pass");
});

test("generic command and mutation failures preserve failure semantics", async () => {
  const command = { capability: "test", adapter: "command" };
  const failed = fixture(command, result({ status: 2 }));
  assert.equal((await failed.runtime.executeAdapter(
    "change", "provider", command, "run", new Map())).status, "fail");

  const timedOut = fixture(command, result({ timedOut: true, readinessObserved: false }));
  assert.equal((await timedOut.runtime.executeAdapter(
    "change", "provider", command, "run", new Map())).status, "error");
  assert.match(timedOut.receipts[0].flags.observed, /timeout/);

  const errored = fixture(command, result({ error: new Error("spawn failed") }));
  assert.equal((await errored.runtime.executeAdapter(
    "change", "provider", command, "run", new Map())).status, "error");
  assert.match(errored.receipts[0].flags.observed, /spawn failed/);

  const mutation = {
    capability: "mutation", adapter: "command", resultProtocol: "foundation-mutation-v1"
  };
  const crash = fixture(mutation, result(), { mutationProtocolResult: () => "crash" });
  assert.equal((await crash.runtime.executeAdapter(
    "change", "provider", mutation, "run", new Map())).status, "error");
  const survived = fixture(mutation, result(), { mutationProtocolResult: () => "survived" });
  assert.equal((await survived.runtime.executeAdapter(
    "change", "provider", mutation, "run", new Map())).status, "fail");

  const decorated = {
    capability: "test", adapter: "command", inputMode: "dom-event",
    foregroundRequired: true, foregroundAvailable: true,
    classification: "behavioral-kill", environment: { browser: "test" }, project: "web"
  };
  const decoratedWorld = fixture(decorated);
  await decoratedWorld.runtime.executeAdapter(
    "change", "provider", decorated, "run", new Map());
  assert.equal(decoratedWorld.receipts[0].flags["foreground-required"], "yes");

  const unspecifiedMutation = { capability: "mutation", adapter: "command" };
  const unspecified = fixture(unspecifiedMutation);
  assert.equal((await unspecified.runtime.executeAdapter(
    "change", "provider", unspecifiedMutation, "run", new Map())).status, "pass");

  const emptyV2 = fixture({
    capability: "mutation", adapter: "command",
    resultProtocol: "foundation-mutation-v2", requiredMutants: ["missing"],
    mutantKillers: { missing: "case" }
  }, result({ stdout: "not-json" }));
  assert.equal((await emptyV2.runtime.executeAdapter(
    "change", "provider", {
      capability: "mutation", adapter: "command",
      resultProtocol: "foundation-mutation-v2", requiredMutants: ["missing"],
      mutantKillers: { missing: "case" }
    }, "run", new Map())).status, "fail");
});

const realParsers = { parseTapOutput, parseNodeTestSpecOutput, numericReportValue };

function npmNodeTestOutput(t, script) {
  const project = mkdtempSync(join(tmpdir(), "adapter-npm-node-test-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  writeFileSync(join(project, "package.json"), JSON.stringify({
    name: "fixture", private: true, scripts: { test: script }
  }));
  writeFileSync(join(project, "a.test.mjs"),
    "import test from 'node:test';\ntest('adds', () => {});\ntest('subtracts', () => {});\n");
  const env = { ...process.env, NO_COLOR: "1" };
  delete env.FORCE_COLOR;
  // This suite runs under node --test; the child must not report to it.
  delete env.NODE_TEST_CONTEXT;
  return execFileSync("npm", ["test", "--silent"], { cwd: project, encoding: "utf8", env });
}

for (const script of ["node --test", "node --test --test-reporter=tap"])
test(`real node --test output behind npm test proves discovery: ${script}`, async (t) => {
  const config = {
    capability: "test", adapter: "test-discovery", command: ["sh", "-c", "npm test"],
    discoveryProvider: "discovery", minimum: 1, reportFormat: "auto"
  };
  const world = fixture(config, result({ stdout: npmNodeTestOutput(t, script) }), realParsers);
  const outcome = await world.runtime.executeAdapter(
    "change", "provider", config, "run", new Map());
  assert.equal(outcome.status, "pass");
  assert.equal(world.receipts[1].flags.discovered, 2);
});

test("discovery repair names the exact reporter fix for node --test commands", () => {
  assert.match(discoveryCountRepair(["sh", "-c", "npm test"], { test: "node --test --test-reporter=dot" }),
    /package\.json scripts\.test .*'node --test --test-reporter=tap'/);
  assert.match(discoveryCountRepair(["sh", "-c", "pnpm run unit"], { unit: "node --test test/" }),
    /scripts\.unit .*'node --test --test-reporter=tap test\/'/);
  assert.match(discoveryCountRepair(["sh", "-c", "node --test --test-reporter=dot"]),
    /task verify .*'node --test --test-reporter=tap'/);
  assert.match(discoveryCountRepair(["sh", "-c", "node --test --test-reporter=tap | tail -1"]),
    /remove the pipe or redirection in the task verify/);
  assert.match(discoveryCountRepair(["sh", "-c", "npm test"], { test: "mocha" }),
    /counted result .*--test-reporter=tap/);
  assert.match(discoveryCountRepair(["sh", "-c", "make check"], null), /counted result/);
});

test("uncountable npm-wrapped node --test stays inconclusive and states the fix", async () => {
  const config = {
    capability: "test", adapter: "test-discovery", command: ["sh", "-c", "npm test"],
    discoveryProvider: "discovery", minimum: 1, reportFormat: "auto"
  };
  const world = fixture(config, result({ stdout: "..\n" }), realParsers);
  writeFileSync(join(world.root, "package.json"), JSON.stringify({
    scripts: { test: "node --test --test-reporter=dot" }
  }));
  const outcome = await world.runtime.executeAdapter(
    "change", "provider", config, "run", new Map());
  assert.equal(outcome.status, "inconclusive");
  assert.equal(world.receipts[0].status, "pass");
  assert.equal(world.receipts[1].status, "inconclusive");
  assert.match(world.receipts[1].flags.observed,
    /scripts\.test .*'node --test --test-reporter=tap'/);
});
