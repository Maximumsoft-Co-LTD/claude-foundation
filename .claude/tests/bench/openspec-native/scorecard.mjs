import { createHash } from "node:crypto";

export const SCORECARD_PROTOCOL = "foundation-openspec-native-scorecard-v1";
export const MEASUREMENT_STATES = new Set(["measured", "partial", "unavailable"]);
export const OUTCOME_STATES = new Set([
  "completed", "blocked", "incomplete", "failed", "timeout", "cancelled", "error"
]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function measured(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function count(value) {
  const number = measured(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredText(value, field) {
  const result = text(value);
  if (!result) throw new Error(`${field} is required`);
  return result;
}

function positiveCount(value, field) {
  const result = count(value);
  if (result === null || result < 1) throw new Error(`${field} must be a positive integer`);
  return result;
}

function timestamp(value) {
  const valueText = text(value);
  return valueText && Number.isFinite(Date.parse(valueText))
    ? new Date(valueText).toISOString() : null;
}

function status(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function measurement(value, fallback = "unavailable") {
  return status(value, MEASUREMENT_STATES, fallback);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function digest(value) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

export function costMeasurement(envelope = {}, metrics = {}) {
  const envelopeCost = measured(envelope.total_cost_usd ?? envelope.cost_usd);
  if (envelopeCost !== null)
    return { value: envelopeCost, status: "measured", source: "host-result-envelope" };
  const metricCost = measured(metrics.cost);
  if (metricCost === null)
    return { value: null, status: "unavailable", source: null };
  const classification = metrics.usageAvailability?.classification;
  return {
    value: metricCost,
    status: ["measured", "no-usage"].includes(classification) ? "measured" : "partial",
    source: "foundation-metrics"
  };
}

function qualitySummary(report) {
  const functions = Array.isArray(report?.functions) ? report.functions : [];
  if (!functions.length) return {
    measurement: "unavailable", functions: null, mappedFunctions: null,
    coverageMinimum: null, coverageMean: null, crapMaximum: null,
    pass: null, warn: null, fail: null, unmapped: null
  };
  const coverage = functions.map((fn) => measured(fn.coveragePercent))
    .filter((value) => value !== null);
  const crap = functions.map((fn) => measured(fn.crap))
    .filter((value) => value !== null);
  const summary = object(report.summary);
  const unmapped = count(summary.unmapped) ?? functions.filter((fn) =>
    fn.coveragePercent === null || fn.crap === null || fn.status === "unmapped").length;
  return {
    measurement: coverage.length && crap.length
      ? (unmapped ? "partial" : "measured") : "unavailable",
    functions: functions.length,
    mappedFunctions: crap.length,
    coverageMinimum: coverage.length ? Math.min(...coverage) : null,
    coverageMean: coverage.length
      ? Number((coverage.reduce((sum, value) => sum + value, 0) / coverage.length).toFixed(2))
      : null,
    crapMaximum: crap.length ? Math.max(...crap) : null,
    pass: count(summary.pass) ?? functions.filter((fn) => fn.status === "pass").length,
    warn: count(summary.warn) ?? functions.filter((fn) => fn.status === "warn").length,
    fail: count(summary.fail) ?? functions.filter((fn) => fn.status === "fail").length,
    unmapped
  };
}

function operationSummary(rows, metrics) {
  const operations = Array.isArray(rows) ? rows : [];
  const byCommand = {};
  for (const row of operations) {
    const command = text(row.operation) || "unknown";
    byCommand[command] = Number(byCommand[command] || 0) + 1;
  }
  const total = operations.length || Object.values(object(metrics.phases))
    .map((phase) => count(phase.operations)).filter((value) => value !== null)
    .reduce((sum, value) => sum + value, 0) || null;
  return {
    measurement: total === null ? "unavailable" : "measured",
    total,
    failed: operations.length
      ? operations.filter((row) => row.status === "failed").length : null,
    blocked: operations.length
      ? operations.filter((row) => row.status === "blocked").length : null,
    byCommand,
    duplicateCandidates: null,
    duplicateMeasurement: "unavailable",
    browserCalls: null,
    taskMirrorOperations: null
  };
}

function normalizeOutcome(input = {}) {
  const pendingTasks = count(input.pendingTasks);
  const requiredEvidencePassed = typeof input.requiredEvidencePassed === "boolean"
    ? input.requiredEvidencePassed : null;
  const outcomeStatus = status(input.status, OUTCOME_STATES, "incomplete");
  const complete = outcomeStatus === "completed" && pendingTasks === 0 &&
    requiredEvidencePassed === true;
  return {
    status: outcomeStatus,
    complete,
    failureClass: text(input.failureClass),
    changeId: text(input.changeId),
    workflowStatus: text(input.workflowStatus),
    pendingTasks,
    requiredEvidencePassed,
    proofStatus: text(input.proofStatus),
    landStatus: text(input.landStatus)
  };
}

export function buildScorecard(input) {
  const metrics = object(input.metrics);
  const envelope = object(input.envelope);
  const stopwatch = object(input.stopwatch);
  const cost = costMeasurement(envelope, metrics);
  const wallMs = measured(stopwatch.wallMs);
  const usageClass = metrics.usageAvailability?.classification;
  const requestCount = count(metrics.requests);
  const usageStatus = requestCount === null ? "unavailable"
    : ["measured", "no-usage"].includes(usageClass) ? "measured" : "partial";
  const startedAt = timestamp(stopwatch.startedAt);
  const finishedAt = timestamp(stopwatch.finishedAt);
  return {
    protocol: SCORECARD_PROTOCOL,
    scenario: requiredText(input.scenario, "scenario"),
    repeat: positiveCount(input.repeat, "repeat"),
    runId: requiredText(input.runId, "runId"),
    provenance: {
      commit: text(input.provenance?.commit),
      dirty: typeof input.provenance?.dirty === "boolean" ? input.provenance.dirty : null,
      host: text(input.provenance?.host),
      requestedModel: text(input.provenance?.requestedModel),
      actualModel: text(input.provenance?.actualModel),
      configDigest: input.config ? digest(input.config) : null,
      startedAt,
      finishedAt
    },
    outcome: normalizeOutcome(input.outcome),
    timing: {
      wallMs,
      wallMeasurement: wallMs === null ? "unavailable" : "measured",
      wallSource: wallMs === null ? null : "runner-monotonic-stopwatch",
      modelActiveMs: null,
      harnessActiveMs: measured(metrics.activeTimeMs),
      providerMs: measured(metrics.evidenceExecutionTimeMs),
      externalExecutionMs: measured(metrics.externalExecutionTimeMs),
      humanWaitMs: measured(metrics.humanWaitMs),
      externalWaitMs: null,
      unattributedWaitMs: measured(metrics.unattributedWaitMs),
      hostEnvelopeDurationMs: measured(envelope.duration_ms ?? envelope.durationMs)
    },
    usage: {
      measurement: usageStatus,
      classification: text(usageClass),
      costUsd: cost.value,
      costMeasurement: measurement(cost.status),
      costSource: cost.source,
      modelRequests: requestCount,
      inputTokens: measured(metrics.inputTokens),
      outputTokens: measured(metrics.outputTokens),
      cacheCreationTokens: measured(metrics.cacheCreationTokens),
      cacheReadTokens: measured(metrics.cacheReadTokens)
    },
    operations: operationSummary(input.operationRows, metrics),
    quality: qualitySummary(input.quality),
    evidenceReuse: {
      count: count(metrics.evidenceReuse?.count),
      byReason: object(metrics.evidenceReuse?.byReason)
    }
  };
}
