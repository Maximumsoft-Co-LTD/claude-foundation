import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  assertDisposableProject, collectNativeScorecard, discoverChangeId,
  observedOutcome, pendingTaskCount
} from "../openspec-native/run.mjs";

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
    id: "todo", status: "proven"
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
    functions: [{ coveragePercent: 100, crap: 1, status: "pass" }]
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
    write(join(project, "openspec/changes/todo/tasks.md"), "- [ ] unfinished\n");
    const incomplete = observedOutcome({
      project, changeId: "todo", envelope: {}, exitCode: 0, timedOut: false
    });
    assert.equal(incomplete.status, "incomplete");
    assert.equal(incomplete.failureClass, "required-work-or-proof-incomplete");
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
    assert.equal(scorecard.usage.costUsd, 2);
    assert.equal(validate(scorecard), true, JSON.stringify(validate.errors));
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
