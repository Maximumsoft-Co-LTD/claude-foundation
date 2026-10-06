import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAdapterRuntime } from "../runtime/evidence/adapter-runtime.mjs";
import { configuredCommand } from "../runtime/evidence/evidence-results.mjs";
import {
  sameArgv, taskCheckArgv, taskCheckReuseRefusal
} from "../runtime/evidence/task-check-evidence.mjs";

const stableHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (message) => { throw new Error(message); };
const TEST = {
  capability: "test", adapter: "test-discovery", command: ["node", "test.js"], minimum: 1
};
const OUTPUT = JSON.stringify({ numTotalTests: 3 });

function world(t, config = TEST, { exit = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "task-check-evidence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logs = join(root, ".foundation", "logs");
  mkdirSync(logs, { recursive: true });
  const repository = { id: "root", workspacePath: root, mode: "write", baseHead: "base" };
  const configs = { test: config, discovery: { capability: "discovery", adapter: "test-discovery" } };
  const receipts = [];
  const spawns = [];
  const live = { hash: "code-1", proveRuns: 0, editDuringCheck: false };
  const runtime = createAdapterRuntime({
    ROOT: root, LOGS: logs, PROVIDERS: new Set(["test", "discovery"]),
    providerCapability: (provider, configured) => configured?.capability || provider,
    providerConfig: (_id, provider) => configs[provider] || null,
    parseFlags: () => ({ flags: {}, rest: [] }), providerWorkspace: () => root,
    recordReceipt: (id, provider, status, flags) =>
      receipts.push({ provider, status, flags: structuredClone(flags) }),
    startServiceSession: async () => ({ stop: () => {} }),
    evidence: () => ({ execution: { services: {} } }), resultAdapterResources: () => [],
    loadRuntime: () => ({
      workspace: { path: root, baseHead: "base" },
      repositories: { root: { path: root, baseHead: "base" } },
      activeProofRun: { workspaceHash: "whole-workspace" }
    }),
    providerRepository: () => repository, repositoryById: () => repository,
    providerRepositories: () => [repository], configuredCommand,
    fileDigest: (path) => stableHash(path), pathInside: () => true, stableHash,
    runCommand: () => {
      live.proveRuns += 1;
      return Promise.resolve({ status: 0, signal: null, timedOut: false, error: null,
        durationMs: 5, startedAt: "2026-10-06T00:00:01.000Z", stdout: OUTPUT, stderr: "",
        readinessObserved: true });
    },
    providerWorkspaceHash: () => live.hash,
    providerClaims: () => ["claim-test"],
    parseJsonOutput: (value) => { try { return JSON.parse(value); } catch { return null; } },
    parseTapOutput: () => null, parseNodeTestSpecOutput: () => null,
    numericReportValue: (report) => report?.numTotalTests ?? null,
    playwrightReportSummary: () => null, requiredProviders: () => ["test"],
    mutationProtocolResult: () => null, now: () => "2026-10-06T00:00:00.000Z",
    serviceResourcesConflict: () => false, maxParallelServices: () => 1,
    recordScheduler: () => {}, timestamp: Date.now, die: fail,
    clearSnapshotCache: () => {},
    spawnCommandSync: (command, args, options) => {
      spawns.push({ command, args, options });
      if (live.editDuringCheck) live.hash = "code-edited-by-check";
      return { status: exit, signal: null, stdout: OUTPUT, stderr: "" };
    }
  });
  const check = (command = "node test.js") =>
    runtime.runTaskCheckAsEvidence("change", { taskId: "T1", command, repository: "root" });
  const prove = () => runtime.executeAdapter("change", "test", configs.test, "run-1", new Map());
  const records = () => {
    const dir = join(logs, "change", "task-check-executions");
    try { return readdirSync(dir).map((name) => join(dir, name)); } catch { return []; }
  };
  return { runtime, root, live, receipts, spawns, check, prove, records, configs };
}

test("a task check that is the provider's command becomes Prove's execution", async (t) => {
  const w = world(t);
  const outcome = w.check();
  assert.equal(outcome.status, "pass");
  assert.equal(outcome.provider, "test");
  assert.deepEqual([w.spawns[0].command, ...w.spawns[0].args], ["node", "test.js"],
    "runs the provider argv, not a shell line");
  assert.equal(w.spawns[0].options.cwd, w.root);
  assert.equal(w.spawns[0].options.env.FOUNDATION_CHANGE_ID, "change",
    "runs in the provider environment class");
  assert.equal(w.records().length, 1);
  const result = await w.prove();
  assert.equal(w.live.proveRuns, 0, "Prove did not run the suite again");
  assert.equal(result.status, "pass");
  const test = w.receipts.find((row) => row.provider === "test");
  const discovery = w.receipts.find((row) => row.provider === "discovery");
  assert.equal(test.status, "pass");
  assert.equal(test.flags.workspaceHash, "code-1", "receipt binds the content the check ran on");
  assert.match(test.flags.observed, /reused Build task check T1/);
  assert.match(test.flags.commandExecutionId, /^taskcheck-/);
  assert.equal(discovery.status, "pass", "report parsing comes from the same captured output");
  assert.equal(discovery.flags.discovered, 3);
  assert.match(readFileSync(join(w.root, test.flags.log), "utf8"), /numTotalTests/,
    "the command log is captured the same way");
});

test("any later edit invalidates the prepared execution", async (t) => {
  const w = world(t);
  assert.equal(w.check().status, "pass");
  w.live.hash = "code-2";
  await w.prove();
  assert.equal(w.live.proveRuns, 1, "content moved: Prove reruns");
  assert.equal(w.receipts.find((row) => row.provider === "test").flags.workspaceHash, "code-2");
});

test("a check that changes content while it runs is not kept", async (t) => {
  const w = world(t);
  w.live.editDuringCheck = true;
  assert.equal(w.check().status, "pass");
  assert.equal(w.records().length, 0);
  await w.prove();
  assert.equal(w.live.proveRuns, 1);
});

test("a failing task check is a failing check and is never kept", (t) => {
  const w = world(t, TEST, { exit: 1 });
  const outcome = w.check();
  assert.equal(outcome.status, "fail");
  assert.equal(outcome.exitCode, 1);
  assert.equal(w.records().length, 0);
});

test("a different command or a shell line does not match a provider", (t) => {
  const w = world(t);
  assert.equal(w.check("node test.js --watch"), null, "falls back to the plain check");
  assert.equal(w.check("npm test && node test.js"), null);
  assert.equal(w.spawns.length, 0);
});

test("a different environment reruns", async (t) => {
  const key = "FOUNDATION_TASK_CHECK_ENV_PROBE";
  const w = world(t);
  process.env[key] = "build";
  t.after(() => { delete process.env[key]; });
  assert.equal(w.check().status, "pass");
  process.env[key] = "prove";
  await w.prove();
  assert.equal(w.live.proveRuns, 1);
});

test("a provider that needs a report file the check did not capture reruns", async (t) => {
  const w = world(t);
  assert.equal(w.check().status, "pass", "kept for the report-free provider");
  w.configs.test = { ...TEST, report: "report.json" };
  await w.prove();
  assert.equal(w.live.proveRuns, 1, "same command, but the report file was not captured");
  assert.equal(w.check(), null, "a report-file provider is never matched by Build");
});

test("an altered prepared execution is never used", async (t) => {
  const w = world(t);
  assert.equal(w.check().status, "pass");
  const [path] = w.records();
  const record = JSON.parse(readFileSync(path, "utf8"));
  record.result.stdout = JSON.stringify({ numTotalTests: 99 });
  writeFileSync(path, JSON.stringify(record));
  await w.prove();
  assert.equal(w.live.proveRuns, 1);
});

test("argv matching and reuse refusals", () => {
  assert.deepEqual(taskCheckArgv("npm test -- --run"), ["npm", "test", "--", "--run"]);
  for (const line of ["CI=1 npm test", "npm test | tee x", "echo \"$X\"", "a > b", ""])
    assert.equal(taskCheckArgv(line), null, line);
  assert.equal(sameArgv(["npm", "test"], { command: "npm", args: ["test"] }), true);
  assert.equal(sameArgv(["npm", "test"], { command: "npm", args: ["test", "x"] }), false);
  assert.equal(taskCheckReuseRefusal(TEST, "test"), null);
  assert.equal(taskCheckReuseRefusal({ ...TEST, adapter: "playwright" }, "browser"), "adapter");
  assert.equal(taskCheckReuseRefusal({ ...TEST, readiness: { url: "http://x" } }, "test"), "service");
  assert.equal(taskCheckReuseRefusal({ ...TEST, dependsOn: ["build"] }, "test"), "depends-on");
  assert.equal(taskCheckReuseRefusal({ adapter: "command" }, "mutation"), "capability");
});
