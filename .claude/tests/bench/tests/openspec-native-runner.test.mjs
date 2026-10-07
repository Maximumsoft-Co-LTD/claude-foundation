import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  assertDisposableProject, backendLandArgs, collectNativeScorecard, discoverChangeId,
  externalAuthorityBoundary, guardrailOutcomes, hostFriction, observedOutcome, operationRowsInWindow,
  mergeHostExecutions, parseHostOutput, pendingTaskCount,
  provenLandReady, remainingTimeoutMs, runBenchmarkOracle, runClaude, terminalChangeId
} from "../openspec-native/run.mjs";
import { collectBenchmarkQuality } from "../openspec-native/quality.mjs";

const schema = JSON.parse(readFileSync(new URL(
  "../config/openspec-native-scorecard.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

function projectFixture() {
  const project = mkdtempSync(join(tmpdir(), "foundation-native-bench-"));
  write(join(project, ".foundation-benchmark.json"), { disposable: true });
  write(join(project, ".claude/harness/foundation.mjs"), `#!/usr/bin/env node
if (process.argv[2] === "metrics") process.stdout.write(JSON.stringify({
  requests: 3,
  cost: 1.25,
  usageAvailability: { classification: "measured" },
  activeTimeMs: 20,
  phases: { change: { operations: 2 } }
}));
`);
  write(join(project, ".foundation/runtime/todo.json"), {
    id: "todo", status: "archived"
  });
  write(join(project, "openspec/changes/todo/tasks.md"), [
    "# Tasks", "", "- [x] T1 implementation", "- [x] T2 tests", ""
  ].join("\n"));
  write(join(project, ".foundation/receipts/todo/proof.json"), {
    version: 2, status: "pass"
  });
  write(join(project, ".foundation/logs/todo/operations.jsonl"), [
    JSON.stringify({ operation: "change-validate", status: "completed" }),
    JSON.stringify({ operation: "proof-run", status: "completed" }), ""
  ].join("\n"));
  write(join(project, ".foundation/test-results/quality/crap.json"), {
    summary: { functions: 1, pass: 1, warn: 0, fail: 0, unmapped: 0 },
    functions: [{ path: "app.py", coveragePercent: 100, crap: 1, status: "pass" }]
  });
  return project;
}

test("disposable marker and unambiguous runtime identity protect live runs", () => {
  const project = projectFixture();
  try {
    assert.doesNotThrow(() => assertDisposableProject(project));
    assert.equal(discoverChangeId(project), "todo");
    write(join(project, ".foundation/runtime/second.json"), { id: "second" });
    assert.equal(discoverChangeId(project), null);
    assert.equal(discoverChangeId(project, "todo"), "todo");
    write(join(project, ".foundation-benchmark.json"), { disposable: false });
    assert.throws(() => assertDisposableProject(project), /disposable=true/);
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test("paid Land runner stops the host after backend reaches archived", async () => {
  const project = projectFixture();
  const runtime = join(project, ".foundation/runtime/todo.json");
  write(runtime, { id: "todo", status: "proven" });
  const fakeClaude = join(project, "fake-claude.sh");
  write(fakeClaude, [
    "#!/bin/sh",
    "sleep 1",
    `printf '%s\\n' '{"id":"todo","status":"archived"}' > ${JSON.stringify(runtime)}`,
    "sleep 30"
  ].join("\n"));
  chmodSync(fakeClaude, 0o755);
  const started = Date.now();
  try {
    const result = await runClaude({
      project, prompt: "finish", claudeBin: fakeClaude, claudeArgs: [],
      timeoutMs: 10000, stopOnArchived: true
    });
    assert.equal(result.terminalReached?.status, "archived");
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    assert.ok(Date.now() - started < 5000,
      "runner waited for host narration after terminal backend state");
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test("oracle-backed runner stops at proven before allowing Land", async () => {
  const project = projectFixture();
  const runtime = join(project, ".foundation/runtime/todo.json");
  write(runtime, { id: "todo", status: "building" });
  const fakeClaude = join(project, "fake-prover.sh");
  write(fakeClaude, [
    "#!/bin/sh",
    "sleep 1",
    `printf '%s\\n' '{"id":"todo","status":"proven"}' > ${JSON.stringify(runtime)}`,
    "sleep 30"
  ].join("\n"));
  chmodSync(fakeClaude, 0o755);
  try {
    const result = await runClaude({
      project, prompt: "prove", claudeBin: fakeClaude, claudeArgs: [],
      timeoutMs: 10000, stopOnProven: true
    });
    assert.equal(result.terminalReached?.status, "proven");
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test("repair continuation must leave the initial proven state before it can finish", async () => {
  const project = projectFixture();
  const runtime = join(project, ".foundation/runtime/todo.json");
  write(runtime, { id: "todo", status: "proven" });
  const fakeClaude = join(project, "fake-repair.sh");
  write(fakeClaude, [
    "#!/bin/sh",
    "sleep 1",
    `printf '%s\\n' '{"id":"todo","status":"building"}' > ${JSON.stringify(runtime)}`,
    "sleep 1",
    `printf '%s\\n' '{"id":"todo","status":"proven"}' > ${JSON.stringify(runtime)}`,
    "sleep 30"
  ].join("\n"));
  chmodSync(fakeClaude, 0o755);
  try {
    const result = await runClaude({
      project, prompt: "repair", claudeBin: fakeClaude, claudeArgs: [],
      timeoutMs: 10000, stopOnProven: true
    });
    assert.equal(result.terminalReached?.status, "proven");
    assert.ok(result.stopwatch.wallMs >= 1500,
      "runner mistook the pre-existing proven state for repaired proof");
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test("host continuation accounting preserves total requests and wall time", () => {
  const merged = mergeHostExecutions({
    stdout: "first\n", stderr: "", observedModelRequests: 3,
    stopwatch: { wallMs: 100, startedAt: "start", finishedAt: "middle" }
  }, {
    exitCode: 0, timedOut: false, stdout: "second\n", stderr: "warning\n",
    observedModelRequests: 4, terminalReached: { status: "proven" },
    stopwatch: { wallMs: 250, startedAt: "middle", finishedAt: "finish" }
  });
  assert.equal(merged.observedModelRequests, 7);
  assert.equal(merged.stopwatch.wallMs, 350);
  assert.equal(merged.stopwatch.startedAt, "start");
  assert.equal(merged.stopwatch.finishedAt, "finish");
  assert.equal(merged.stdout, "first\nsecond\n");
});

test("backend Land receives an integer remaining timeout", () => {
  assert.equal(remainingTimeoutMs(1800000, 712603.532083), 1087396);
  assert.equal(remainingTimeoutMs(100, 999.5), 1000);
});

test("a no-dispatch proven resume keeps its preflight change identity", () => {
  assert.equal(terminalChangeId({ terminalReached: { changeId: "existing" } }, null),
    "existing");
  assert.equal(terminalChangeId({}, "discovered"), "discovered");
});

test("runner uses the registered internal Land operation", () => {
  assert.deepEqual(backendLandArgs("change"), ["land-advance", "change"]);
});

test("proven resume fast-path requires a passing backend Land check", () => {
  const project = projectFixture();
  try {
    write(join(project, ".claude/harness/foundation.mjs"), `#!/usr/bin/env node
process.exit(process.argv[2] === "land-check" ? 0 : 1);
`);
    assert.equal(provenLandReady(project, "todo"), true);
    write(join(project, ".claude/harness/foundation.mjs"), `#!/usr/bin/env node
process.stderr.write("stale proof\\n"); process.exit(1);
`);
    assert.equal(provenLandReady(project, "todo"), false);
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test("outcome requires checked tasks and passing proof", () => {
  const project = projectFixture();
  try {
    assert.equal(pendingTaskCount("- [ ] one\n- [x] two\n  - [ ] three\n"), 2);
    const complete = observedOutcome({
      project, changeId: "todo", envelope: {}, exitCode: 0, timedOut: false
    });
    assert.equal(complete.status, "completed");
    assert.equal(complete.requiredEvidencePassed, true);
    assert.equal(complete.pendingTasks, 0);
    write(join(project, ".foundation/runtime/todo.json"), {
      id: "todo", status: "proven"
    });
    const notLanded = observedOutcome({
      project, changeId: "todo", envelope: {}, exitCode: 0, timedOut: false
    });
    assert.equal(notLanded.status, "incomplete");
    assert.equal(notLanded.failureClass, "land-not-archived");
    assert.equal(notLanded.landStatus, "awaiting-user");
    write(join(project, "openspec/changes/todo/tasks.md"), "- [ ] unfinished\n");
    const incomplete = observedOutcome({
      project, changeId: "todo", envelope: {}, exitCode: 0, timedOut: false
    });
    assert.equal(incomplete.status, "incomplete");
    assert.equal(incomplete.failureClass, "required-work-or-proof-incomplete");
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test("outcome follows the runtime's dated OpenSpec archive path", () => {
  const project = projectFixture();
  try {
    const dated = "openspec/changes/archive/2026-09-03-todo";
    write(join(project, dated, "tasks.md"), "# Tasks\n\n- [x] implementation\n");
    rmSync(join(project, "openspec/changes/todo"), { recursive: true, force: true });
    write(join(project, ".foundation/runtime/todo.json"), {
      id: "todo", status: "archived", archivedChangePath: dated
    });
    const outcome = observedOutcome({
      project, changeId: "todo", envelope: {}, exitCode: 0, timedOut: false
    });
    assert.equal(outcome.pendingTasks, 0);
    assert.equal(outcome.status, "completed");
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test("a configured task oracle is required in addition to workflow proof", () => {
  const project = projectFixture();
  try {
    const failed = observedOutcome({
      project, changeId: "todo", envelope: {}, exitCode: 0, timedOut: false,
      oracle: { configured: true, measurement: "measured", verdict: "fail" }
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.failureClass, "task-oracle-failed");
    const unavailable = observedOutcome({
      project, changeId: "todo", envelope: {}, exitCode: 0, timedOut: false,
      oracle: { configured: true, measurement: "unavailable", verdict: null }
    });
    assert.equal(unavailable.failureClass, "task-oracle-unavailable");
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test("deterministic oracles are parsed and invalid output stays unavailable", () => {
  const project = projectFixture();
  const scripts = mkdtempSync(join(tmpdir(), "foundation-native-oracle-"));
  try {
    const passing = join(scripts, "pass.sh");
    write(passing, "printf '%s\\n' '{\"verdict\":\"pass\",\"score\":2,\"max\":2,\"results\":{\"AC1\":\"pass\",\"AC2\":\"pass\"}}'\n");
    const measured = runBenchmarkOracle({
      project, changeId: "todo", oraclePath: passing
    });
    assert.equal(measured.measurement, "measured");
    assert.equal(measured.verdict, "pass");
    assert.equal(measured.score, 2);
    const invalid = join(scripts, "invalid.sh");
    write(invalid, "printf '%s\\n' 'not-json'\n");
    assert.equal(runBenchmarkOracle({
      project, changeId: "todo", oraclePath: invalid
    }).reason, "oracle-output-invalid");
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(scripts, { recursive: true, force: true });
  }
});

test("outcome reads Build task completion from the active sandbox", () => {
  const project = projectFixture();
  try {
    write(join(project, "openspec/changes/todo/tasks.md"), "- [ ] implementation\n");
    write(join(project, ".foundation/sandboxes/todo/openspec/changes/todo/tasks.md"),
      "- [x] implementation\n");
    const outcome = observedOutcome({
      project, changeId: "todo", envelope: {}, exitCode: 0, timedOut: false
    });
    assert.equal(outcome.pendingTasks, 0,
      "the isolated Build workspace is authoritative while its sandbox is active");
    assert.equal(outcome.status, "completed");
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test("collector joins metrics, operations, quality, and completion truth", () => {
  const project = projectFixture();
  try {
    const scorecard = collectNativeScorecard({
      scenario: "todolist-r2", repeat: 1, runId: "run-1", project,
      config: { prompt: "/dev create app todolist" },
      envelope: { total_cost_usd: 2, model: "sonnet" },
      stopwatch: {
        wallMs: 5000, startedAt: "2026-08-28T01:00:00Z",
        finishedAt: "2026-08-28T01:00:05Z"
      },
      metrics: {
        requests: 3, cost: 1.25,
        usageAvailability: { classification: "measured" }
      },
      provenance: { commit: "abc", dirty: false }
    });
    assert.equal(scorecard.outcome.complete, true);
    assert.equal(scorecard.operations.total, 2);
    assert.equal(scorecard.quality.crapMaximum, 1);
    assert.equal(scorecard.quality.product.functions, 1);
    assert.equal(scorecard.quality.tooling.measurement, "unavailable");
    assert.equal(scorecard.usage.costUsd, 2);
    assert.equal(validate(scorecard), true, JSON.stringify(validate.errors));
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test("resume scorecards isolate operations and prefer per-run host usage", () => {
  const project = projectFixture();
  try {
  const rows = [
    { operation: "old", status: "completed",
      startedAt: "2026-08-28T00:59:00Z", durationMs: 9000 },
    { operation: "current", status: "completed",
      startedAt: "2026-08-28T01:00:02Z", durationMs: 25 }
  ];
  const stopwatch = {
    wallMs: 5000, startedAt: "2026-08-28T01:00:00Z",
    finishedAt: "2026-08-28T01:00:05Z",
    startedEpochMs: Date.parse("2026-08-28T01:00:00Z")
  };
  assert.deepEqual(operationRowsInWindow(rows, stopwatch), [rows[1]]);
  const scorecard = collectNativeScorecard({
    scenario: "resume", repeat: 1, runId: "resume-1",
    project, changeId: "todo", stopwatch,
    envelope: { total_cost_usd: 0.5, num_turns: 4, usage: {
      input_tokens: 3, output_tokens: 9,
      cache_creation_input_tokens: 11, cache_read_input_tokens: 13
    } },
    metrics: { requests: 99, inputTokens: 999, outputTokens: 999,
      cacheCreationTokens: 999, cacheReadTokens: 999,
      activeTimeMs: 9999, unattributedWaitMs: 9999 },
    operationRows: rows, provenance: { commit: "abc", dirty: false }
  });
  assert.equal(scorecard.operations.total, 1);
  assert.deepEqual(scorecard.operations.byCommand, { current: 1 });
  assert.equal(scorecard.timing.harnessActiveMs, 25);
  assert.equal(scorecard.timing.unattributedWaitMs, null);
  assert.equal(scorecard.usage.modelRequests, 4);
  assert.equal(scorecard.usage.outputTokens, 9);
  assert.equal(scorecard.usage.cacheReadTokens, 13);
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test("completed greenfield Node projects produce measured CRAP quality", async () => {
  const project = projectFixture();
  try {
    rmSync(join(project, ".foundation/test-results/quality"),
      { recursive: true, force: true });
    const sandbox = join(project, ".foundation/sandboxes/todo");
    write(join(sandbox, "package.json"), {
      type: "module", scripts: { test: "node --test" }
    });
    write(join(sandbox, "src/math.mjs"),
      "export function absolute(value) { return value < 0 ? -value : value; }\n");
    write(join(sandbox, "test/math.test.mjs"), [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "import { absolute } from '../src/math.mjs';",
      "test('covers both branches', () => {",
      "  assert.equal(absolute(-2), 2); assert.equal(absolute(2), 2);",
      "});", ""
    ].join("\n"));
    const report = await collectBenchmarkQuality({ project, changeId: "todo" });
    assert.equal(report.protocol, "foundation-quality-v1");
    assert.equal(report.collector, "openspec-native-node-quality-v1");
    assert.equal(report.summary.unmapped, 0);
    assert.ok(report.summary.functions >= 1);
    assert.ok(report.functions.every((fn) => fn.coveragePercent !== null));
    assert.ok(report.functions.every((fn) => fn.crap !== null));
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test("bare CommonJS sandboxes produce measured CRAP without package.json", async () => {
  const project = projectFixture();
  try {
    rmSync(join(project, ".foundation/test-results/quality"),
      { recursive: true, force: true });
    const sandbox = join(project, ".foundation/sandboxes/todo");
    write(join(sandbox, "window.js"), [
      "function lastN(items, n) { return n <= 0 ? [] : items.slice(-n); }",
      "module.exports = { lastN };", ""
    ].join("\n"));
    write(join(sandbox, "window.test.js"), [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const { lastN } = require('./window');",
      "test('zero and positive windows', () => {",
      "  assert.deepEqual(lastN([1, 2], 0), []);",
      "  assert.deepEqual(lastN([1, 2], 1), [2]);",
      "});", ""
    ].join("\n"));
    const report = await collectBenchmarkQuality({ project, changeId: "todo" });
    assert.equal(report.protocol, "foundation-quality-v1");
    assert.ok(report.summary.functions >= 1);
    assert.ok(report.functions.every((fn) => fn.coveragePercent !== null));
    assert.ok(report.functions.every((fn) => fn.crap !== null));
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test("dependency-free Python sandboxes produce measured CRAP quality", async () => {
  const project = projectFixture();
  try {
    rmSync(join(project, ".foundation/test-results/quality"),
      { recursive: true, force: true });
    const sandbox = join(project, ".foundation/sandboxes/todo");
    write(join(sandbox, "calculator.py"), [
      "def absolute(value):",
      "    if value < 0:",
      "        return -value",
      "    return value", ""
    ].join("\n"));
    write(join(sandbox, "tools/check_evidence.py"), [
      "def evidence_ok(value):", "    return bool(value)", ""
    ].join("\n"));
    write(join(sandbox, "tests/test_calculator.py"), [
      "import unittest", "from calculator import absolute",
      "from tools.check_evidence import evidence_ok", "",
      "class CalculatorTests(unittest.TestCase):",
      "    def test_both_branches(self):",
      "        self.assertEqual(absolute(-2), 2)",
      "        self.assertEqual(absolute(2), 2)",
      "        self.assertTrue(evidence_ok('receipt'))", ""
    ].join("\n"));
    const report = await collectBenchmarkQuality({ project, changeId: "todo" });
    assert.equal(report.protocol, "foundation-quality-v1");
    assert.equal(report.collector, "openspec-native-python-stdlib-quality-v1");
    assert.equal(report.summary.unmapped, 0);
    assert.ok(report.summary.functions >= 1);
    assert.ok(report.functions.every((fn) => fn.coveragePercent === 100));
    assert.ok(report.functions.every((fn) => fn.crap !== null));
    assert.deepEqual(new Set(report.functions.map((fn) => fn.surface)),
      new Set(["product", "tooling"]));
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test("Python API oracle requires the boundary fix and a regression test", () => {
  const project = mkdtempSync(join(tmpdir(), "foundation-python-oracle-"));
  const task = fileURLToPath(new URL("../tasks/15-python-api-validation", import.meta.url));
  try {
    cpSync(join(task, "seed"), project, { recursive: true });
    const before = runBenchmarkOracle({
      project, oraclePath: join(task, "oracle/run.sh")
    });
    assert.equal(before.verdict, "fail");
    assert.equal(before.results.AC1_regression_first, "fail");

    const apiPath = join(project, "user_api.py");
    write(apiPath, readFileSync(apiPath, "utf8").replace(
      "not isinstance(seat_count, int)", "type(seat_count) is not int"));
    const testPath = join(project, "tests/test_user_api.py");
    write(testPath, `${readFileSync(testPath, "utf8")}\nclass BoundaryRegression(unittest.TestCase):\n` +
      "    def test_boolean_seat_count_is_rejected(self):\n" +
      "        self.assertIn('seat_count', validate_workspace({'seat_count': True}))\n");
    const after = runBenchmarkOracle({
      project, oraclePath: join(task, "oracle/run.sh")
    });
    assert.equal(after.verdict, "pass");
    assert.equal(after.score, 5);
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test("collect-only CLI emits a schema-valid scorecard without a paid host run", () => {
  const project = projectFixture();
  const outputDir = mkdtempSync(join(tmpdir(), "foundation-native-scorecard-"));
  const output = join(outputDir, "rows.jsonl");
  try {
    const runner = new URL("../openspec-native/run.mjs", import.meta.url);
    const result = spawnSync(process.execPath, [
      runner.pathname,
      "--collect-only",
      "--scenario", "todolist-r2",
      "--project", project,
      "--change-id", "todo",
      "--run-id", "fixture-run",
      "--wall-ms", "4000",
      "--started-at", "2026-08-28T01:00:00Z",
      "--finished-at", "2026-08-28T01:00:04Z",
      "--output", output
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const scorecard = JSON.parse(readFileSync(output, "utf8").trim());
    assert.equal(scorecard.outcome.status, "completed");
    assert.equal(scorecard.usage.costUsd, 1.25);
    assert.equal(scorecard.timing.wallMs, 4000);
    assert.equal(scorecard.operations.hostToolCalls.measurement, "unavailable",
      "no host stream means unknown tool calls, not zero");
    assert.equal(validate(scorecard), true, JSON.stringify(validate.errors));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("collect-only CLI persists categorized host tool calls from a saved stream", () => {
  const project = projectFixture();
  const outputDir = mkdtempSync(join(tmpdir(), "foundation-native-tool-calls-"));
  const output = join(outputDir, "rows.jsonl");
  const stream = join(outputDir, "host.stream.jsonl");
  const call = (id, name, input) => ({ type: "assistant", message: { id: `m-${id}`,
    content: [{ type: "tool_use", id, name, input }] } });
  write(stream, `${[
    call("t1", "Bash", { command: "node .claude/harness/foundation.mjs advance todo" }),
    call("t2", "Read", { file_path: ".claude/skills/build/SKILL.md" }),
    call("t3", "Read", { file_path: ".foundation/runtime/todo.json" }),
    call("t4", "Write", { file_path: "openspec/changes/todo/draft.json" }),
    call("t5", "Edit", { file_path: "src/cart.js" }),
    call("t6", "Bash", { command: "node --test" }),
    call("t7", "TodoWrite", { todos: [] }),
    { type: "result", total_cost_usd: 1.25, num_turns: 7 }
  ].map(JSON.stringify).join("\n")}\n`);
  try {
    const runner = new URL("../openspec-native/run.mjs", import.meta.url);
    const result = spawnSync(process.execPath, [
      runner.pathname, "--collect-only", "--scenario", "tiny-feature",
      "--project", project, "--change-id", "todo", "--run-id", "tool-calls",
      "--envelope", stream, "--wall-ms", "4000", "--output", output
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const scorecard = JSON.parse(readFileSync(output, "utf8").trim());
    assert.deepEqual(scorecard.operations.hostToolCalls, {
      measurement: "measured", total: 7,
      byTool: { Bash: 2, Read: 2, Write: 1, Edit: 1, TodoWrite: 1 },
      byCategory: {
        harnessCli: 1, harnessDocReads: 1, stateReads: 1, harnessArtifactWrites: 1,
        productWrites: 1, testRuns: 1, other: 1
      }
    });
    assert.equal(validate(scorecard), true, JSON.stringify(validate.errors));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("collect-only CLI refuses completed status when its oracle fails", () => {
  const project = projectFixture();
  const outputDir = mkdtempSync(join(tmpdir(), "foundation-native-oracle-cli-"));
  const output = join(outputDir, "rows.jsonl");
  const oracle = join(outputDir, "oracle.sh");
  write(oracle, "printf '%s\\n' '{\"verdict\":\"fail\",\"score\":1,\"max\":2,\"results\":{\"AC1\":\"pass\",\"AC2\":\"fail\"}}'\n");
  try {
    const runner = new URL("../openspec-native/run.mjs", import.meta.url);
    const result = spawnSync(process.execPath, [
      runner.pathname,
      "--collect-only",
      "--scenario", "brownfield",
      "--project", project,
      "--change-id", "todo",
      "--run-id", "oracle-fail",
      "--wall-ms", "4000",
      "--oracle", oracle,
      "--output", output
    ], { encoding: "utf8" });
    assert.equal(result.status, 1, "a task-correctness failure fails the benchmark command");
    const scorecard = JSON.parse(readFileSync(output, "utf8").trim());
    assert.equal(scorecard.outcome.failureClass, "task-oracle-failed");
    assert.equal(scorecard.outcome.requiredEvidencePassed, true);
    assert.equal(scorecard.oracle.verdict, "fail");
    assert.equal(validate(scorecard), true, JSON.stringify(validate.errors));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("live CLI path launches the configured host and measures whole-run walltime", () => {
  const project = projectFixture();
  const outputDir = mkdtempSync(join(tmpdir(), "foundation-native-live-stub-"));
  const output = join(outputDir, "rows.jsonl");
  const host = join(outputDir, "claude-stub");
  write(host, `#!/bin/sh
printf '%s' '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":2.75,"duration_ms":5,"model":"stub-model"}'
`);
  chmodSync(host, 0o755);
  try {
    const runner = new URL("../openspec-native/run.mjs", import.meta.url);
    const result = spawnSync(process.execPath, [
      runner.pathname,
      "--scenario", "todolist-r2",
      "--project", project,
      "--prompt", "/dev create app todolist",
      "--change-id", "todo",
      "--run-id", "live-stub",
      "--claude-bin", host,
      "--timeout-ms", "5000",
      "--output", output
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const scorecard = JSON.parse(readFileSync(output, "utf8").trim());
    assert.equal(scorecard.outcome.complete, true);
    assert.equal(scorecard.usage.costUsd, 2.75);
    assert.equal(scorecard.provenance.actualModel, "stub-model");
    assert.ok(scorecard.timing.wallMs >= 0);
    assert.equal(scorecard.timing.wallSource, "runner-monotonic-stopwatch");
    assert.equal(validate(scorecard), true, JSON.stringify(validate.errors));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("live request ceilings stop the host at a resumable user-decision boundary", () => {
  const project = projectFixture();
  const outputDir = mkdtempSync(join(tmpdir(), "foundation-native-budget-stub-"));
  const output = join(outputDir, "rows.jsonl");
  const host = join(outputDir, "claude-stub");
  write(host, `#!/bin/sh
printf '%s\n' '{"type":"assistant","message":{"id":"request-1","content":[]}}'
printf '%s\n' '{"type":"assistant","message":{"id":"request-2","content":[]}}'
sleep 30
`);
  chmodSync(host, 0o755);
  try {
    const runner = new URL("../openspec-native/run.mjs", import.meta.url);
    const result = spawnSync(process.execPath, [
      runner.pathname,
      "--scenario", "budget-boundary",
      "--project", project,
      "--prompt", "/dev bounded work",
      "--change-id", "todo",
      "--run-id", "budget-stub",
      "--claude-bin", host,
      "--max-model-requests", "2",
      "--timeout-ms", "5000",
      "--output", output
    ], { encoding: "utf8" });
    assert.equal(result.status, 1, "a user-decision boundary is not completion");
    const scorecard = JSON.parse(readFileSync(output, "utf8").trim());
    assert.equal(scorecard.outcome.status, "needs-user-decision");
    assert.equal(scorecard.outcome.complete, false);
    assert.equal(scorecard.outcome.failureClass, "budget-exhausted-model-requests");
    // Process-group termination and child reaping can add a few seconds on a
    // loaded CI runner. The behavioral contract is that the request ceiling
    // ends the run well before the stub's 30-second sleep completes.
    assert.ok(scorecard.timing.wallMs < 15000);
    assert.equal(scorecard.usage.modelRequests, 2);
    assert.equal(scorecard.usage.observedModelRequests, 2);
    assert.equal(scorecard.usage.hostReportedModelRequests, null);
    assert.equal(scorecard.usage.capConsumedModelRequests, 2);
    assert.equal(scorecard.usage.modelRequestsMeasurement, "measured");
    assert.equal(scorecard.usage.measurement, "partial");
    assert.equal(scorecard.usage.costUsd, null,
      "a forced stop without a trustworthy final envelope has unknown cost");
    assert.equal(validate(scorecard), true, JSON.stringify(validate.errors));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("live tool-call ceilings stop the host at a resumable user-decision boundary", () => {
  const project = projectFixture();
  const outputDir = mkdtempSync(join(tmpdir(), "foundation-native-tool-stub-"));
  const output = join(outputDir, "rows.jsonl");
  const host = join(outputDir, "claude-stub");
  write(host, `#!/bin/sh
printf '%s\n' '{"type":"assistant","message":{"id":"request-1","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"node .claude/harness/foundation.mjs advance todo"}}]}}'
printf '%s\n' '{"type":"assistant","message":{"id":"request-2","content":[{"type":"tool_use","id":"t2","name":"Read","input":{"file_path":".claude/skills/build/SKILL.md"}}]}}'
sleep 30
`);
  chmodSync(host, 0o755);
  try {
    const runner = new URL("../openspec-native/run.mjs", import.meta.url);
    const result = spawnSync(process.execPath, [
      runner.pathname,
      "--scenario", "tool-budget-boundary",
      "--project", project,
      "--prompt", "/dev bounded work",
      "--change-id", "todo",
      "--run-id", "tool-budget-stub",
      "--claude-bin", host,
      "--max-tool-calls", "2",
      "--timeout-ms", "5000",
      "--output", output
    ], { encoding: "utf8" });
    assert.equal(result.status, 1, "a user-decision boundary is not completion");
    const scorecard = JSON.parse(readFileSync(output, "utf8").trim());
    assert.equal(scorecard.outcome.status, "needs-user-decision");
    assert.equal(scorecard.outcome.failureClass, "budget-exhausted-tool-calls");
    assert.ok(scorecard.timing.wallMs < 15000);
    assert.equal(scorecard.operations.hostToolCalls.total, 2);
    assert.equal(scorecard.operations.hostToolCalls.byCategory.harnessCli, 1);
    assert.equal(scorecard.operations.hostToolCalls.byCategory.harnessDocReads, 1);
    assert.equal(validate(scorecard), true, JSON.stringify(validate.errors));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("stream parser preserves partial tool telemetry before a final result", () => {
  const output = [
    { type: "assistant", message: { content: [{
      type: "tool_use", id: "one", name: "mcp__browseros-neo__run", input: {}
    }] } },
    { type: "assistant", message: { content: [{
      type: "tool_use", id: "two", name: "Bash",
      input: { command: "foundation task-mirror sync" }
    }] } },
    { type: "assistant", message: { content: [{
      type: "tool_use", id: "one", name: "mcp__browseros-neo__run", input: {}
    }] } }
  ].map(JSON.stringify).join("\n");
  const parsed = parseHostOutput(output);
  assert.deepEqual(parsed.envelope, {});
  assert.deepEqual(parsed.hostTelemetry, {
    total: 2, browserCalls: 1, taskMirrorOperations: 1,
    byTool: { "mcp__browseros-neo__run": 1, Bash: 1 },
    byCategory: {
      harnessCli: 0, harnessDocReads: 0, stateReads: 0, harnessArtifactWrites: 0,
      productWrites: 0, testRuns: 0, other: 2
    },
    friction: { toolErrors: 0, hookBlocks: 0, permissionPrompts: 0, advanceActions: {
      EDIT: 0, REPAIR: 0, RUN_EXTERNAL: 0, WAIT: 0, ASK_USER: 0, DONE: 0 } }
  });
  assert.equal(parsed.observedUsage.observedModelRequests, null,
    "tool-use rows sharing no message id are not model-request identities");
});

test("missing collect-only host telemetry remains unknown rather than zero", () => {
  const parsed = parseHostOutput("{}");
  assert.deepEqual(parsed.hostTelemetry, {
    total: null, browserCalls: null, taskMirrorOperations: null,
    byTool: null, byCategory: null
  });
  assert.equal(parsed.observedUsage.observedModelRequests, null);
});

test("external-authority parser accepts command prefixes and typed summaries only in tool results", () => {
  const readiness = {
    status: "NEEDS_USER_DECISION",
    budget: { class: "external-authority", reason: "review required" },
    next: [{ provider: "review", kind: "user-decision", decision: {
      kind: "independent-review", options: [{ id: "pause" }, { id: "prepare" }]
    }}]
  };
  const prefixed = externalAuthorityBoundary({
    type: "user", message: { content: [{
      type: "tool_result", content: `EXIT=2\n${JSON.stringify(readiness)}`
    }] }
  });
  assert.equal(prefixed.provider, "review");
  assert.equal(prefixed.detectionSource, "embedded-json");

  const summary = externalAuthorityBoundary({
    type: "user", message: { content: [{ type: "tool_result", content: [
      { type: "text", text: [
        'status = "NEEDS_USER_DECISION"',
        `next = ${JSON.stringify(readiness.next)}`
      ].join("\n") }
    ] }] }
  });
  assert.equal(summary.kind, "independent-review");
  assert.equal(summary.detectionSource, "readiness-summary");
  assert.equal(summary.fingerprint, prefixed.fingerprint,
    "equivalent full and summarized readiness must share an identity");

  assert.equal(externalAuthorityBoundary({
    type: "assistant", message: { content: [{ type: "text", text:
      `Example only: ${JSON.stringify(readiness)}` }] }
  }), null, "assistant prose and prompts must not stop the host");
  assert.equal(externalAuthorityBoundary({
    type: "user", message: { content: [{ type: "tool_result", content:
      'status = "NEEDS_USER_DECISION"\nnext = [{"kind":"command"}]' }] }
  }), null, "a status string without a typed user-decision is not an authority boundary");
});

test("external-authority readiness stops before host dispatch and repeats deterministically", () => {
  const project = projectFixture();
  const outputDir = mkdtempSync(join(tmpdir(), "foundation-native-authority-stub-"));
  const output = join(outputDir, "rows.jsonl");
  const host = join(outputDir, "claude-stub");
  const marker = join(outputDir, "host-invoked");
  write(join(project, ".claude/harness/foundation.mjs"), `#!/usr/bin/env node
if (process.argv[2] === "proof-readiness") process.stdout.write(JSON.stringify({
  status: "NEEDS_USER_DECISION",
  pendingTasks: [],
  budget: { eligible: false, class: "external-authority", reason: "needs review" },
  next: [{ provider: "review", kind: "user-decision", decision: {
    kind: "independent-review", recommended: "prepare-for-reviewer",
    options: [{ id: "prepare-for-user" }, { id: "prepare-for-reviewer" }]
  }}]
}));
else if (process.argv[2] === "metrics") process.stdout.write(JSON.stringify({
  requests: 99, cost: 9, usageAvailability: { classification: "measured" }
}));
`);
  write(host, `#!/usr/bin/env node
require("node:fs").writeFileSync(${JSON.stringify(marker)}, "invoked");
`);
  chmodSync(host, 0o755);
  try {
    const runner = new URL("../openspec-native/run.mjs", import.meta.url);
    for (const runId of ["authority-first", "authority-repeat"]) {
      const result = spawnSync(process.execPath, [
        runner.pathname,
        "--scenario", "authority-boundary",
        "--project", project,
        "--prompt", "/dev continue",
        "--change-id", "todo",
        "--run-id", runId,
        "--claude-bin", host,
        "--timeout-ms", "5000",
        "--output", output
      ], { encoding: "utf8" });
      assert.equal(result.status, 1, "a user decision is not benchmark completion");
    }
    assert.equal(existsSync(marker), false, "the paid host must never be dispatched");
    const scorecards = readFileSync(output, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(scorecards.length, 2);
    assert.equal(scorecards[0].outcome.failureClass, "external-authority-review");
    assert.equal(scorecards[0].outcome.decisionProvider, "review");
    assert.equal(scorecards[0].outcome.decisionKind, "independent-review");
    assert.equal(scorecards[0].outcome.decisionFingerprint,
      scorecards[1].outcome.decisionFingerprint);
    assert.equal(scorecards[0].usage.modelRequests, 0);
    assert.equal(scorecards[0].usage.costUsd, 0);
    assert.equal(scorecards[0].usage.costSource, "runner-preflight");
    assert.equal(scorecards[0].usage.inputTokens, 0);
    assert.equal(scorecards[0].usage.outputTokens, 0);
    assert.equal(scorecards[0].usage.cacheCreationTokens, 0);
    assert.equal(scorecards[0].usage.cacheReadTokens, 0);
    assert.equal(scorecards[0].operations.byCommand["stopped-before-model-dispatch"], 1);
    assert.equal(validate(scorecards[0]), true, JSON.stringify(validate.errors));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("streamed external-authority output stops the active host before it can loop", () => {
  const project = projectFixture();
  const outputDir = mkdtempSync(join(tmpdir(), "foundation-native-stream-authority-"));
  const output = join(outputDir, "rows.jsonl");
  const host = join(outputDir, "claude-stub");
  write(host, `#!/usr/bin/env node
console.log(JSON.stringify({ type: "assistant", message: { id: "request-1", content: [] } }));
console.log(JSON.stringify({ type: "user", message: { content: [{
  type: "tool_result", content: "EXIT=2\\n" + JSON.stringify({
    status: "NEEDS_USER_DECISION", pendingTasks: [],
    budget: { eligible: false, class: "external-authority", reason: "review required" },
    next: [{ provider: "review", kind: "user-decision", decision: {
      kind: "independent-review", recommended: "prepare-for-reviewer",
      options: [{ id: "prepare-for-reviewer" }, { id: "pause" }]
    }}]
  })
}] } }));
console.log(JSON.stringify({ type: "user", message: { content: [{
  type: "tool_result", content: 'status = "NEEDS_USER_DECISION"\\nnext = ' + JSON.stringify([
    { provider: "review", kind: "user-decision", decision: {
      kind: "independent-review", recommended: "prepare-for-reviewer",
      options: [{ id: "prepare-for-reviewer" }, { id: "pause" }]
    }}
  ])
}] } }));
setTimeout(() => {}, 30000);
`);
  chmodSync(host, 0o755);
  try {
    const runner = new URL("../openspec-native/run.mjs", import.meta.url);
    const result = spawnSync(process.execPath, [
      runner.pathname,
      "--scenario", "stream-authority-boundary",
      "--project", project,
      "--prompt", "/dev continue",
      "--change-id", "todo",
      "--run-id", "stream-authority",
      "--claude-bin", host,
      "--max-model-requests", "10",
      "--timeout-ms", "5000",
      "--output", output
    ], { encoding: "utf8" });
    assert.equal(result.status, 1);
    const scorecard = JSON.parse(readFileSync(output, "utf8").trim());
    assert.equal(scorecard.outcome.status, "needs-user-decision");
    assert.equal(scorecard.outcome.failureClass, "external-authority-review");
    assert.equal(scorecard.outcome.decisionDetectionSource, "embedded-json");
    assert.equal(scorecard.outcome.requestsAtDecision, 1);
    assert.equal(scorecard.outcome.requestsAfterDecision, 0);
    assert.equal(scorecard.outcome.suppressedDuplicateDecisions, 1);
    assert.equal(scorecard.usage.modelRequests, 1);
    assert.equal(scorecard.usage.capConsumedModelRequests, null);
    assert.equal(scorecard.usage.costUsd, null,
      "a live external-authority stop must not look like a zero-cost preflight");
    assert.equal(scorecard.usage.inputTokens, null);
    assert.equal(scorecard.usage.outputTokens, null);
    assert.equal(scorecard.operations.byCommand["stopped-at-external-authority"], 1);
    assert.ok(scorecard.timing.wallMs < 5000);
    assert.equal(validate(scorecard), true, JSON.stringify(validate.errors));
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});

// The baseline paid run lost a turn in every lane to a hook refusal and waited
// on host approval prompts; the stream must count both exactly.
test("host friction counts hook refusals, approval prompts, and harness actions", () => {
  const result = (content, isError = true) => ({ type: "user", message: { content: [
    { type: "tool_result", is_error: isError, content } ] } });
  const rows = [
    result("PreToolUse:Bash hook error: BLOCKED: phase guard (unknown/Bash): active phase is unavailable"),
    result("This Bash command contains multiple operations. The following part requires approval: node --test"),
    result("Exit code 2"),
    result('{"protocol":6,"action":"EDIT"}', false),
    result([{ type: "text", text: '{"action":"REPAIR"} {"action":"DONE"}' }], false),
    { type: "assistant", message: { content: [{ type: "text", text: "done" }] } }
  ];
  assert.deepEqual(hostFriction(rows), {
    toolErrors: 3, hookBlocks: 1, permissionPrompts: 1,
    advanceActions: { EDIT: 1, REPAIR: 1, RUN_EXTERNAL: 0, WAIT: 0, ASK_USER: 0, DONE: 1 }
  });
});

// The 2026-10-07 paid run counted the bench's own stop-on-proven kill of the
// in-flight advance (exit 137) as a tool error in every lane, and missed the
// host's heredoc safety denial as an approval prompt.
test("host friction ignores bench-stopped tool calls and counts host safety denials", () => {
  const assistant = { type: "assistant", message: { content: [{ type: "text", text: "next" }] } };
  const result = (id, content) => ({ type: "user", message: { content: [
    { type: "tool_result", tool_use_id: id, is_error: true, content } ] } });
  const rows = [
    { type: "system", subtype: "init" },
    { type: "system", subtype: "permission_denied", tool_use_id: "heredoc" },
    result("heredoc", "Contains brace with quote character (expansion obfuscation)"),
    assistant,
    result("advance-1", "Exit code 137"),
    { type: "system", subtype: "init" },
    assistant,
    result("advance-2", "Exit code 143")
  ];
  assert.deepEqual(hostFriction(rows), {
    toolErrors: 1, hookBlocks: 0, permissionPrompts: 1,
    advanceActions: { EDIT: 0, REPAIR: 0, RUN_EXTERNAL: 0, WAIT: 0, ASK_USER: 0, DONE: 0 }
  });
});

// A host stream always ends with a `result` row, but the agent saw a failed
// tool result only if an assistant turn followed it; a result row alone means
// the turn ended (stop, max turns) before the agent read it.
test("host friction counts a failed tool result only when an assistant turn follows it", () => {
  const assistant = { type: "assistant", message: { content: [{ type: "text", text: "next" }] } };
  const failed = (id) => ({ type: "user", message: { content: [
    { type: "tool_result", tool_use_id: id, is_error: true, content: "Exit code 1" } ] } });
  const end = { type: "result", subtype: "success" };
  const none = { EDIT: 0, REPAIR: 0, RUN_EXTERNAL: 0, WAIT: 0, ASK_USER: 0, DONE: 0 };
  assert.deepEqual(hostFriction([{ type: "system", subtype: "init" }, failed("seen"),
    assistant, end]), { toolErrors: 1, hookBlocks: 0, permissionPrompts: 0, advanceActions: none });
  assert.deepEqual(hostFriction([{ type: "system", subtype: "init" }, failed("unseen"), end,
    assistant]), { toolErrors: 0, hookBlocks: 0, permissionPrompts: 0, advanceActions: none });
});

test("guard outcomes are counted inside the run window", () => {
  const project = mkdtempSync(join(tmpdir(), "bench-guardrail-"));
  try {
    mkdirSync(join(project, ".foundation/logs"), { recursive: true });
    writeFileSync(join(project, ".foundation/logs/guardrail-audit.jsonl"), [
      { timestamp: "2026-10-06T08:00:00.000Z", outcome: "blocked" },
      { timestamp: "2026-10-06T09:00:00.000Z", outcome: "redirected" },
      { timestamp: "2026-10-06T09:00:01.000Z", outcome: "redirected" },
      { timestamp: "2026-10-06T09:00:02.000Z", outcome: "guided" }
    ].map((row) => JSON.stringify(row)).join("\n"));
    assert.deepEqual(guardrailOutcomes(project, {
      startedAt: "2026-10-06T08:59:00.000Z", finishedAt: "2026-10-06T09:10:00.000Z"
    }), { redirected: 2, guided: 1 });
  } finally { rmSync(project, { recursive: true, force: true }); }
});
