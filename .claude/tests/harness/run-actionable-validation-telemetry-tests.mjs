import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  claimContractIssues, taskContractIssues
} from "../../harness/runtime/workflow/change-validation.mjs";
import {
  eventUsageRecoveryActions, usageAvailability
} from "../../harness/runtime/observability/metrics-runtime.mjs";
import {
  createTelemetryRuntime
} from "../../harness/runtime/observability/telemetry-runtime.mjs";
import {
  packetOverflowSummary
} from "../../harness/runtime/workflow/packet-runtime.mjs";

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
  assert.equal(value.classification, "not-ingested");
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

test("request-only events expose missing usage without inventing totals", () => {
  const value = usageAvailability([
    { source: "codex", agentId: "orchestrator" },
    { agentId: "worker-without-host-provenance" }
  ], [], "change-id");
  assert.equal(value.status, "measured");
  assert.equal(value.classification, "correlation-missing");
  assert.equal(value.reason, "correlation-missing");
  assert.deepEqual(value.correlatedHosts, ["codex"]);
  assert.match(value.recoveryActions[0].command, /--format codex/);
});

test("event recovery routes every correlated host without adding irrelevant actions", () => {
  assert.deepEqual(eventUsageRecoveryActions("measured", ["codex"], "change-id"), []);
  assert.deepEqual(eventUsageRecoveryActions("correlation-missing", [
    "codex", "claude-code", "generic-host"
  ], "change-id").map((action) => action.type), [
    "import-codex-events", "sync-claude-transcript", "import-generic-events"
  ]);
  assert.deepEqual(eventUsageRecoveryActions(
    "source-unsupported", [], "change-id").map((action) => action.type),
  ["import-generic-events"]);
});

test("Cursor imports retain measured generic-host attribution", () => {
  const value = usageAvailability([
    { source: "cursor", inputTokens: 42, outputTokens: 7 }
  ]);
  assert.equal(value.status, "measured");
  assert.equal(value.classification, "measured");
  assert.deepEqual(value.correlatedHosts, ["generic-host"]);
});

test("explicit zero usage is distinguished from missing usage", () => {
  const value = usageAvailability([
    { source: "generic", inputTokens: 0, outputTokens: 0, cost: 0 }
  ]);
  assert.equal(value.classification, "no-usage");
  assert.equal(value.reason, null);
});

test("a zero cost without token totals is partial rather than no usage", () => {
  const value = usageAvailability([
    { source: "generic", cost: 0 }
  ], [], "change-id");
  assert.equal(value.classification, "partial-measurement");
  assert.match(value.recoveryActions[0].command, /--format generic/);
});

test("one complete event cannot hide another request-only event", () => {
  const value = usageAvailability([
    { source: "codex", inputTokens: 10, outputTokens: 4 },
    { source: "codex", inputTokens: null, outputTokens: null }
  ], [], "change-id");
  assert.equal(value.classification, "partial-measurement");
  assert.match(value.recoveryActions[0].command, /--format codex/);
});

test("junk usage fields stay missing rather than becoming measurements", () => {
  for (const junk of ["", "  ", true, false, [], [7], {}, -1, "-2"]) {
    const value = usageAvailability([
      { source: "generic", inputTokens: junk, outputTokens: junk }
    ], [], "change-id");
    assert.equal(value.classification, "correlation-missing",
      `${JSON.stringify(junk)} was treated as usage`);
  }
});

test("numeric strings are measured but do not weaken event completeness", () => {
  assert.equal(usageAvailability([
    { source: "generic", inputTokens: "0", outputTokens: "0" }
  ]).classification, "no-usage");
  assert.equal(usageAvailability([
    { source: "generic", inputTokens: "4", outputTokens: "2" }
  ]).classification, "measured");
  assert.equal(usageAvailability([
    { source: "generic", inputTokens: "4", outputTokens: "2" },
    { source: "generic", inputTokens: "", outputTokens: "" }
  ]).classification, "partial-measurement");
});

test("unsupported event sources retain an actionable classification", () => {
  const value = usageAvailability([
    { source: "future-editor", inputTokens: 12 }
  ], [], "change-id");
  assert.equal(value.classification, "source-unsupported");
  assert.equal(value.reason, "source-unsupported");
  assert.match(value.recoveryActions[0].command, /--format generic/);
});

test("oversized review display stays valid and names durable persistence", () => {
  const value = packetOverflowSummary({
    packetType: "review",
    changeId: "wide-review",
    packetDigest: "digest-1",
    references: { tasks: { path: "tasks.md" } }
  }, 12_000, 8_192, [{ field: "changedSurface", bytes: 9_000 }]);
  assert.equal(value.packetValidity, "valid");
  assert.equal(value.display.status, "truncated");
  assert.equal(value.display.bytes, 12_000);
  assert.equal(value.durableAuthorityRequest.status, "not-requested");
  assert.equal(value.durableAuthorityRequest.next,
    "claude-foundation authority request wide-review --type review");
  assert.deepEqual(value.references, { tasks: { path: "tasks.md" } });
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
