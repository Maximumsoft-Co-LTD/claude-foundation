import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  claimContractIssues, taskContractIssues
} from "../../harness/runtime/workflow/change-validation.mjs";
import {
  usageAvailability
} from "../../harness/runtime/observability/metrics-runtime.mjs";
import {
  createTelemetryRuntime
} from "../../harness/runtime/observability/telemetry-runtime.mjs";

const jsonLines = (path) => {
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  } catch {
    return [];
  }
};

test("claim contract returns every independent defect", () => {
  const issues = claimContractIssues([
    { id: "C1", impact: "", repositories: [], capabilities: [] },
    {
      id: "C2", impact: "medium", repositories: ["root", "missing"],
      capabilities: ["test"]
    }
  ], new Set(["root"]));
  assert.deepEqual(issues, [
    "claim 'C1' requires impact low|medium|high",
    "claim 'C1' repositories must reference selected repositories",
    "claim 'C2' repositories must reference selected repositories",
    "claim 'C2' spans repositories and requires cross-repo-contract"
  ]);
});

test("task contract returns claim and repository defects together", () => {
  const issues = taskContractIssues([
    {
      id: "T001", done: false,
      text: "T001 first [repo:child] [claims:unknown] [paths:../escape]"
    },
    {
      id: "T002", done: false,
      text: "T002 second [repo:root] [claims:child-only]"
    }
  ], [{
    id: "child-only", impact: "medium", capabilities: ["test"],
    repositories: ["child"]
  }], new Set(["root", "child"]), true);
  assert(issues.includes("task 'T001' references unknown claim(s): unknown"));
  assert(issues.includes("task 'T001' contains an unsafe path scope"));
  assert(issues.includes("task 'T002' references claim(s) outside repository 'root': child-only"));
  assert(issues.includes("multi-repository task 'T002' requires [paths:<repo-relative-paths>]"));
});

test("correlated Codex usage remains unavailable with supported recovery", () => {
  const value = usageAvailability([], [{
    sessionId: "thread-123", telemetryHost: "codex"
  }], "change-id");
  assert.equal(value.status, "unavailable");
  assert.equal(value.reason, "correlation-without-usage-events");
  assert.deepEqual(value.correlatedHosts, ["codex"]);
  assert(value.recoveryActions.some((action) =>
    action.command === "claude-foundation telemetry import change-id <events.jsonl> --format codex"));
});

test("missing host context names generic supported recovery", () => {
  const value = usageAvailability([], [], "change-id");
  assert.equal(value.reason, "host-telemetry-not-ingested");
  assert(value.recoveryActions.some((action) => action.type === "import-host-execution"));
  assert(value.recoveryActions.some((action) => action.type === "import-generic-events"));
});

test("measured events require no recovery", () => {
  const value = usageAvailability([
    { source: "codex", agentId: "orchestrator" },
    { agentId: "worker-without-host-provenance" }
  ], [], "change-id");
  assert.equal(value.status, "measured");
  assert.equal(value.reason, null);
  assert.deepEqual(value.correlatedHosts, ["codex"]);
  assert.deepEqual(value.recoveryActions, []);
});

test("phase context records Codex provenance without creating usage", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-actionable-telemetry-"));
  const isolatedVariables = [
    "CODEX_THREAD_ID", "FOUNDATION_CLAUDE_TRANSCRIPT_PATH",
    "FOUNDATION_CLAUDE_SESSION_ID", "FOUNDATION_SESSION_ID"
  ];
  const prior = Object.fromEntries(isolatedVariables.map((name) =>
    [name, process.env[name]]));
  for (const name of isolatedVariables) delete process.env[name];
  process.env.CODEX_THREAD_ID = "thread-123";
  try {
    const runtime = createTelemetryRuntime({
      root,
      logs: root,
      contextEventSchemaVersion: "2",
      stableHash: () => "digest",
      now: () => "2026-08-19T00:00:00.000Z",
      readJson: () => ({}),
      writeJson: (path, value) => writeFileSync(path, JSON.stringify(value)),
      readJsonLines: jsonLines,
      readJsonLinesTolerant: jsonLines,
      loadRuntime: () => ({}),
      saveRuntime: () => {},
      synchronizeBudgetUsage: () => {},
      reportBudget: () => {},
      snapshotPath: () => join(root, "snapshot.json"),
      parseFlags: () => ({ flags: {}, rest: [] }),
      activeChangePath: () => root,
      repositoryById: () => null,
      taskBlocks: () => [],
      fail: (message) => { throw new Error(message); }
    });
    runtime.recordPhaseContext("change", "build");
    const rows = jsonLines(join(root, "change", "phase-context.jsonl"));
    assert.equal(rows[0].telemetryHost, "codex");
    assert.equal(rows[0].telemetryMode, "explicit-import");
    assert.equal(jsonLines(join(root, "change", "events.jsonl")).length, 0);
  } finally {
    for (const name of isolatedVariables) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
  }
});
