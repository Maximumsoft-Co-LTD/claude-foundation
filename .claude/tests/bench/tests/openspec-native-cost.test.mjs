import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { parseHostOutput, runClaude, streamUsage } from "../openspec-native/run.mjs";
import { buildScorecard } from "../openspec-native/scorecard.mjs";

// Cost measurement for hosts the runner stops at `proven`/`archived`: the host
// result envelope carries cost, so it gets a short grace to finish; without it
// the streamed per-request token usage fills the token counts, and anything
// unmeasured stays unknown rather than zero.

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

function projectFixture() {
  const project = mkdtempSync(join(tmpdir(), "foundation-native-cost-"));
  write(join(project, ".foundation-benchmark.json"), { disposable: true });
  write(join(project, ".claude/harness/foundation.mjs"), "#!/usr/bin/env node\n");
  return project;
}

function scorecardInput(overrides = {}) {
  return {
    scenario: "todolist-r2", repeat: 1, runId: "todolist-r2-1",
    stopwatch: { wallMs: 120000, startedAt: "2026-08-28T01:00:00.000Z",
      finishedAt: "2026-08-28T01:02:00.000Z" },
    outcome: { status: "completed", changeId: "todo", workflowStatus: "archived",
      pendingTasks: 0, requiredEvidencePassed: true, proofStatus: "pass", landStatus: "archived" },
    ...overrides
  };
}

test("a final-envelope grace captures the host result without inflating wall time", async () => {
  const project = projectFixture();
  const runtime = join(project, ".foundation/runtime/todo.json");
  write(runtime, { id: "todo", status: "proven" });
  const host = join(project, "fake-narrating-host.sh");
  const envelope = JSON.stringify({ type: "result", total_cost_usd: 1.5, num_turns: 2 });
  write(host, [
    "#!/bin/sh",
    "sleep 1",
    `printf '%s\\n' '{"type":"assistant","message":{"id":"before","content":[]}}'`,
    `printf '%s\\n' '{"id":"todo","status":"archived"}' > ${JSON.stringify(runtime)}`,
    "sleep 1",
    `printf '%s\\n' '{"type":"assistant","message":{"id":"closing","content":[]}}'`,
    "sleep 1",
    `printf '%s\\n' '${envelope}'`,
    "sleep 30"
  ].join("\n"));
  chmodSync(host, 0o755);
  try {
    const graced = await runClaude({
      project, prompt: "finish", claudeBin: host, claudeArgs: [],
      timeoutMs: 20000, stopOnArchived: true, finalEnvelopeGraceMs: 8000
    });
    assert.equal(graced.terminalReached?.status, "archived");
    assert.equal(parseHostOutput(graced.stdout).envelope.total_cost_usd, 1.5);
    assert.ok(graced.stopwatch.wallMs < 2500, `wall ${graced.stopwatch.wallMs} includes narration`);
    assert.ok(graced.stopwatch.finalEnvelopeWaitMs >= 1000);
    assert.equal(graced.observedModelRequests, 1, "requests count up to the terminal state");
    assert.equal(graced.postTerminalModelRequests, 1, "closing narration is reported apart");
    write(runtime, { id: "todo", status: "proven" });
    const immediate = await runClaude({
      project, prompt: "finish", claudeBin: host, claudeArgs: [],
      timeoutMs: 20000, stopOnArchived: true
    });
    assert.doesNotMatch(immediate.stdout, /total_cost_usd/, "no grace stops at once");
    assert.equal(immediate.stopwatch.finalEnvelopeWaitMs, 0);
  } finally { rmSync(project, { recursive: true, force: true }); }
});

test("streamed per-request usage is summed once per request and never invented", () => {
  const row = (id, usage) => ({ type: "assistant", message: { id, usage, content: [] } });
  assert.equal(streamUsage([]), null);
  assert.equal(streamUsage([{ type: "assistant", message: { id: "a", content: [] } }]), null);
  assert.deepEqual(streamUsage([
    row("a", { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 100 }),
    row("a", { input_tokens: 10, output_tokens: 7, cache_read_input_tokens: 100 }),
    row("b", { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 40 })
  ]), { inputTokens: 15, outputTokens: 10, cacheCreationTokens: 40, cacheReadTokens: 100 });
  assert.equal(parseHostOutput(JSON.stringify(row("a", { input_tokens: 4 })))
    .observedUsage.streamUsage.inputTokens, 4);
});

test("a host stopped before its envelope reports stream-derived tokens, never dollars", () => {
  const scorecard = buildScorecard(scorecardInput({
    envelope: {},
    hostUsage: {
      observedModelRequests: 3, forcedTermination: false,
      streamUsage: { inputTokens: 15, outputTokens: 10, cacheCreationTokens: null,
        cacheReadTokens: 100 }
    }
  }));
  assert.equal(scorecard.usage.tokenSource, "stream-derived");
  assert.equal(scorecard.usage.inputTokens, 15);
  assert.equal(scorecard.usage.cacheCreationTokens, null, "an unmeasured count stays unknown");
  assert.equal(scorecard.usage.costUsd, null);
  assert.equal(scorecard.usage.costMeasurement, "unavailable");
  const withEnvelope = buildScorecard(scorecardInput({
    envelope: { total_cost_usd: 2, usage: { input_tokens: 99, output_tokens: 9 } },
    hostUsage: { streamUsage: { inputTokens: 15, outputTokens: 10 } }
  }));
  assert.equal(withEnvelope.usage.inputTokens, 99, "the host envelope wins over the stream");
  assert.equal(withEnvelope.usage.tokenSource, "host-result-envelope");
  assert.equal(withEnvelope.usage.costMeasurement, "measured");
  const none = buildScorecard(scorecardInput({ envelope: {}, hostUsage: {} }));
  assert.equal(none.usage.inputTokens, null);
  assert.equal(none.usage.tokenSource, null);
});

test("envelope turns are conversation turns: observed requests win, turns are only a floor", () => {
  const input = (hostUsage) => scorecardInput({
    envelope: { total_cost_usd: 0.3, num_turns: 15, usage: { input_tokens: 1, output_tokens: 1 } },
    hostUsage
  });
  const observed = buildScorecard(input({ observedModelRequests: 9, postTerminalModelRequests: 2 }));
  assert.equal(observed.usage.modelRequests, 9);
  assert.equal(observed.usage.postTerminalModelRequests, 2);
  assert.equal(observed.usage.hostReportedModelRequests, 15);
  assert.equal(buildScorecard(input({})).usage.modelRequests, 15);
});
