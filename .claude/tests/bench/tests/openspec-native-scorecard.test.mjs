import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  SCORECARD_PROTOCOL, buildScorecard, costMeasurement, digest
} from "../openspec-native/scorecard.mjs";

const schema = JSON.parse(readFileSync(new URL(
  "../config/openspec-native-scorecard.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function fixture(overrides = {}) {
  return {
    scenario: "todolist-r2",
    repeat: 1,
    runId: "todolist-r2-1",
    config: { prompt: "/dev create app todolist", timeoutMs: 1800000 },
    provenance: {
      commit: "abc123", dirty: false, host: "claude-code",
      requestedModel: "sonnet", actualModel: "sonnet"
    },
    stopwatch: {
      wallMs: 120000,
      startedAt: "2026-08-28T01:00:00.000Z",
      finishedAt: "2026-08-28T01:02:00.000Z"
    },
    envelope: { total_cost_usd: 4.25, duration_ms: 30000 },
    metrics: {
      requests: 12, inputTokens: 100, outputTokens: 50,
      cacheCreationTokens: 20, cacheReadTokens: 40, cost: 3,
      activeTimeMs: 40000, evidenceExecutionTimeMs: 10000,
      externalExecutionTimeMs: 12000, humanWaitMs: null,
      unattributedWaitMs: 80000,
      usageAvailability: { classification: "measured" },
      evidenceReuse: { count: 2, byReason: { fingerprint: 2 } },
      budget: { window: { extensionNumber: 2 } }
    },
    operationRows: [
      { operation: "change-validate", status: "completed" },
      { operation: "proof-run", status: "completed" },
      { operation: "land-check", status: "blocked" }
    ],
    hostTelemetry: { total: 12, browserCalls: 3, taskMirrorOperations: 0 },
    quality: {
      summary: { functions: 2, pass: 1, warn: 1, fail: 0, unmapped: 0 },
      functions: [
        { coveragePercent: 100, crap: 2, status: "pass" },
        { coveragePercent: 75, crap: 14.71, status: "warn" }
      ]
    },
    outcome: {
      status: "completed", changeId: "todo", workflowStatus: "proven",
      pendingTasks: 0, requiredEvidencePassed: true, proofStatus: "pass",
      landStatus: "awaiting-user"
    },
    ...overrides
  };
}

test("scorecard validates and keeps runner walltime separate from host duration", () => {
  const scorecard = buildScorecard(fixture());
  assert.equal(scorecard.protocol, SCORECARD_PROTOCOL);
  assert.equal(scorecard.timing.wallMs, 120000);
  assert.equal(scorecard.timing.wallSource, "runner-monotonic-stopwatch");
  assert.equal(scorecard.timing.hostEnvelopeDurationMs, 30000);
  assert.equal(scorecard.usage.costUsd, 4.25);
  assert.equal(scorecard.usage.costSource, "host-result-envelope");
  assert.equal(scorecard.operations.total, 3);
  assert.equal(scorecard.operations.browserCalls, 3);
  assert.equal(scorecard.operations.taskMirrorOperations, 0);
  assert.deepEqual(scorecard.operations.byCommand, {
    "change-validate": 1, "proof-run": 1, "land-check": 1
  });
  assert.equal(scorecard.quality.crapMaximum, 14.71);
  assert.equal(scorecard.quality.coverageMinimum, 75);
  assert.equal(scorecard.oracle.configured, false);
  assert.equal(scorecard.evidenceReuse.resumptions, 2);
  assert.equal(scorecard.outcome.complete, true);
  assert.equal(validate(scorecard), true, JSON.stringify(validate.errors));
  const legacy = structuredClone(scorecard);
  delete legacy.oracle;
  assert.equal(validate(legacy), true,
    "the additive oracle field keeps historical v1 scorecards schema-valid");
});

test("scorecard preserves measured oracle results", () => {
  const scorecard = buildScorecard(fixture({
    oracle: {
      configured: true, measurement: "measured", verdict: "pass",
      score: 2, max: 2, results: { AC1: "pass", AC2: "pass" },
      reason: null, source: "oracle.sh"
    }
  }));
  assert.deepEqual(scorecard.oracle.results, { AC1: "pass", AC2: "pass" });
  assert.equal(scorecard.oracle.verdict, "pass");
  assert.equal(validate(scorecard), true, JSON.stringify(validate.errors));
});

test("a failing configured oracle overrides a claimed completed outcome", () => {
  const scorecard = buildScorecard(fixture({
    oracle: {
      configured: true, measurement: "measured", verdict: "fail",
      score: 1, max: 2, results: { AC1: "pass", AC2: "fail" },
      source: "oracle.sh"
    }
  }));
  assert.equal(scorecard.outcome.status, "failed");
  assert.equal(scorecard.outcome.complete, false);
  assert.equal(scorecard.outcome.failureClass, "task-oracle-failed");
});

test("unknown measurements stay null and cannot make incomplete work complete", () => {
  const scorecard = buildScorecard(fixture({
    stopwatch: {}, envelope: {}, metrics: {}, quality: null, operationRows: [],
    outcome: { status: "completed", pendingTasks: null, requiredEvidencePassed: null }
  }));
  assert.equal(scorecard.timing.wallMs, null);
  assert.equal(scorecard.usage.costUsd, null);
  assert.equal(scorecard.usage.modelRequests, null);
  assert.equal(scorecard.operations.total, null);
  assert.equal(scorecard.quality.crapMaximum, null);
  assert.equal(scorecard.outcome.complete, false);
  assert.equal(validate(scorecard), true, JSON.stringify(validate.errors));
});

test("metrics cost is partial unless usage completeness is established", () => {
  assert.deepEqual(costMeasurement({}, {
    cost: 2.5, usageAvailability: { classification: "partial-measurement" }
  }), { value: 2.5, status: "partial", source: "foundation-metrics" });
  assert.deepEqual(costMeasurement({}, {
    cost: 0, usageAvailability: { classification: "no-usage" }
  }), { value: 0, status: "measured", source: "foundation-metrics" });
});

test("forced termination preserves observed requests and rejects a synthetic zero envelope", () => {
  const scorecard = buildScorecard(fixture({
    envelope: {
      total_cost_usd: 0,
      num_turns: 0,
      usage: { input_tokens: 0, output_tokens: 0 }
    },
    metrics: {
      requests: 147,
      cost: 0,
      usageAvailability: { classification: "no-usage" }
    },
    hostUsage: {
      observedModelRequests: 30,
      capConsumedModelRequests: 30,
      forcedTermination: true
    }
  }));
  assert.equal(scorecard.usage.modelRequests, 30);
  assert.equal(scorecard.usage.observedModelRequests, 30);
  assert.equal(scorecard.usage.hostReportedModelRequests, 0);
  assert.equal(scorecard.usage.capConsumedModelRequests, 30);
  assert.equal(scorecard.usage.modelRequestsMeasurement, "measured");
  assert.equal(scorecard.usage.measurement, "partial");
  assert.equal(scorecard.usage.classification, "partial-measurement");
  assert.equal(scorecard.usage.costUsd, null);
  assert.equal(scorecard.usage.costMeasurement, "unavailable");
  assert.equal(scorecard.usage.costSource, null);
  assert.equal(scorecard.usage.inputTokens, null);
  assert.equal(scorecard.usage.outputTokens, null);
  assert.equal(validate(scorecard), true, JSON.stringify(validate.errors));
});

test("partial quality distinguishes unmapped functions from zero coverage", () => {
  const scorecard = buildScorecard(fixture({
    quality: {
      summary: { functions: 2, pass: 0, warn: 0, fail: 1, unmapped: 1 },
      functions: [
        { coveragePercent: 0, crap: 31, status: "fail" },
        { coveragePercent: null, crap: null, status: "unmapped" }
      ]
    }
  }));
  assert.equal(scorecard.quality.measurement, "partial");
  assert.equal(scorecard.quality.coverageMinimum, 0);
  assert.equal(scorecard.quality.crapMaximum, 31);
  assert.equal(scorecard.quality.unmapped, 1);
});

test("config digests are key-order stable and identities are required", () => {
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
  assert.throws(() => buildScorecard(fixture({ scenario: "" })), /scenario is required/);
  assert.throws(() => buildScorecard(fixture({ repeat: 0 })), /repeat must be/);
  assert.throws(() => buildScorecard(fixture({ runId: null })), /runId is required/);
});
