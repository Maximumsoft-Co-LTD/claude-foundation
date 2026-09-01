import { createHash } from "node:crypto";

export const SCORECARD_PROTOCOL = "foundation-openspec-native-scorecard-v1";
export const MEASUREMENT_STATES = new Set(["measured", "partial", "unavailable"]);
export const OUTCOME_STATES = new Set([
  "completed", "blocked", "needs-user-decision", "incomplete", "failed",
  "timeout", "cancelled", "error"
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

export function costMeasurement(envelope = {}, metrics = {}, hostUsage = {}) {
  if (hostUsage.noModelDispatch === true)
    return { value: 0, status: "measured", source: "runner-preflight" };
  const envelopeCost = measured(envelope.total_cost_usd ?? envelope.cost_usd);
  const observedRequests = count(hostUsage.observedModelRequests);
  const forcedTermination = hostUsage.forcedTermination === true;
  if (envelopeCost !== null) {
    if (forcedTermination && envelopeCost === 0 && observedRequests > 0)
      return { value: null, status: "unavailable", source: null };
    return { value: envelopeCost, status: forcedTermination ? "partial" : "measured",
      source: "host-result-envelope" };
  }
  if (forcedTermination)
    return { value: null, status: "unavailable", source: null };
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

function functionQualitySummary(functions, reportSummary = {}) {
  if (!functions.length) return {
    measurement: "unavailable", functions: null, mappedFunctions: null,
    coverageMinimum: null, coverageMean: null, crapMaximum: null,
    pass: null, warn: null, fail: null, unmapped: null
  };
  const coverage = functions.map((fn) => measured(fn.coveragePercent))
    .filter((value) => value !== null);
  const crap = functions.map((fn) => measured(fn.crap))
    .filter((value) => value !== null);
  const summary = object(reportSummary);
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

function qualitySummary(report) {
  const functions = Array.isArray(report?.functions) ? report.functions : [];
  const aggregate = functionQualitySummary(functions, report?.summary);
  const tooling = functions.filter((fn) => fn.surface === "tooling" ||
    /^(?:tools|scripts)\//.test(String(fn.path || "")));
  const product = functions.filter((fn) => !tooling.includes(fn));
  return {
    ...aggregate,
    product: functionQualitySummary(product),
    tooling: functionQualitySummary(tooling)
  };
}

function oracleSummary(input) {
  const configured = input?.configured === true;
  const results = object(input?.results);
  const verdict = ["pass", "fail"].includes(input?.verdict) ? input.verdict : null;
  const score = count(input?.score);
  const max = count(input?.max);
  const resultValues = Object.values(results);
  const measuredOracle = configured && input?.measurement === "measured" && verdict &&
    score !== null && max !== null && max > 0 && score <= max &&
    resultValues.length === max && resultValues.every((value) =>
      ["pass", "fail"].includes(value)) &&
    score === resultValues.filter((value) => value === "pass").length &&
    verdict === (score === max ? "pass" : "fail");
  return {
    configured,
    measurement: measuredOracle ? "measured" : "unavailable",
    verdict: measuredOracle ? verdict : null,
    score: measuredOracle ? score : null,
    max: measuredOracle ? max : null,
    results: measuredOracle ? results : {},
    reason: text(input?.reason) || (configured && !measuredOracle
      ? "oracle-summary-invalid" : null),
    source: text(input?.source)
  };
}

function envelopeUsage(envelope) {
  const usage = object(envelope.usage);
  return {
    requests: count(envelope.num_turns ?? envelope.numTurns),
    inputTokens: measured(usage.input_tokens ?? usage.inputTokens),
    outputTokens: measured(usage.output_tokens ?? usage.outputTokens),
    cacheCreationTokens: measured(
      usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens),
    cacheReadTokens: measured(
      usage.cache_read_input_tokens ?? usage.cacheReadInputTokens)
  };
}

function attemptUsageValue(hostValue, metricValue, {
  noModelDispatch, forcedTermination, observedRequests
}) {
  if (noModelDispatch) return 0;
  if (forcedTermination) {
    if (hostValue === null || (hostValue === 0 && observedRequests > 0)) return null;
    return hostValue;
  }
  return hostValue ?? measured(metricValue);
}

function operationActiveTime(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const durations = rows.map((row) => measured(row.durationMs))
    .filter((value) => value !== null);
  return durations.length ? durations.reduce((sum, value) => sum + value, 0) : null;
}

function boundedByWall(value, wallMs) {
  const result = measured(value);
  return result !== null && (wallMs === null || result <= wallMs) ? result : null;
}

function operationSummary(rows, metrics, hostTelemetry = {}) {
  const operations = Array.isArray(rows) ? rows : [];
  const profile = object(metrics.commandProfile);
  const byCommand = {};
  for (const row of operations) {
    const command = text(row.operation) || "unknown";
    byCommand[command] = Number(byCommand[command] || 0) + 1;
  }
  const total = operations.length || count(profile.totalInvocations) || Object.values(object(metrics.phases))
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
    duplicateCandidates: count(profile.sameInputCheckCandidates),
    duplicateMeasurement: profile.measurement
      ? measurement(profile.measurement) : "unavailable",
    browserCalls: count(hostTelemetry.browserCalls),
    taskMirrorOperations: count(hostTelemetry.taskMirrorOperations)
  };
}

function normalizeOutcome(input = {}, oracle = {}) {
  const pendingTasks = count(input.pendingTasks);
  const requiredEvidencePassed = typeof input.requiredEvidencePassed === "boolean"
    ? input.requiredEvidencePassed : null;
  let outcomeStatus = status(input.status, OUTCOME_STATES, "incomplete");
  let failureClass = text(input.failureClass);
  const oracleFailed = oracle.configured &&
    (oracle.measurement !== "measured" || oracle.verdict !== "pass");
  if (outcomeStatus === "completed" && oracleFailed) {
    outcomeStatus = "failed";
    failureClass = oracle.measurement === "measured"
      ? "task-oracle-failed" : "task-oracle-unavailable";
  }
  const complete = outcomeStatus === "completed" && pendingTasks === 0 &&
    requiredEvidencePassed === true && !oracleFailed;
  return {
    status: outcomeStatus,
    complete,
    failureClass,
    changeId: text(input.changeId),
    workflowStatus: text(input.workflowStatus),
    pendingTasks,
    requiredEvidencePassed,
    proofStatus: text(input.proofStatus),
    landStatus: text(input.landStatus),
    decisionProvider: text(input.decisionProvider),
    decisionKind: text(input.decisionKind),
    decisionFingerprint: text(input.decisionFingerprint),
    decisionDetectionSource: text(input.decisionDetectionSource),
    decisionFirstSeenWallMs: measured(input.decisionFirstSeenWallMs),
    requestsAtDecision: count(input.requestsAtDecision),
    requestsAfterDecision: count(input.requestsAfterDecision),
    suppressedDuplicateDecisions: count(input.suppressedDuplicateDecisions)
  };
}

export function buildScorecard(input) {
  const metrics = object(input.metrics);
  const envelope = object(input.envelope);
  const observedUsage = object(input.hostUsage);
  const stopwatch = object(input.stopwatch);
  const cost = costMeasurement(envelope, metrics, observedUsage);
  const wallMs = measured(stopwatch.wallMs);
  const usageClass = metrics.usageAvailability?.classification;
  const hostUsage = envelopeUsage(envelope);
  const observedRequests = count(observedUsage.observedModelRequests);
  const capConsumedRequests = count(observedUsage.capConsumedModelRequests);
  const requestCandidates = [observedRequests, capConsumedRequests, hostUsage.requests]
    .filter((value) => value !== null);
  const requestCount = requestCandidates.length ? Math.max(...requestCandidates)
    : count(metrics.requests);
  const forcedTermination = observedUsage.forcedTermination === true;
  const noModelDispatch = observedUsage.noModelDispatch === true;
  const modelRequestsMeasurement = requestCount === null ? "unavailable"
    : requestCandidates.length || ["measured", "no-usage"].includes(usageClass)
      ? "measured" : "partial";
  const usageStatus = requestCount === null ? "unavailable"
    : forcedTermination || (observedRequests !== null && hostUsage.requests === null &&
      observedRequests > 0) ? "partial" : modelRequestsMeasurement;
  const usageClassification = forcedTermination ? "partial-measurement"
    : observedRequests === 0 && hostUsage.requests === null ? "no-usage" : text(usageClass);
  const startedAt = timestamp(stopwatch.startedAt);
  const finishedAt = timestamp(stopwatch.finishedAt);
  const oracle = oracleSummary(input.oracle);
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
    outcome: normalizeOutcome(input.outcome, oracle),
    timing: {
      wallMs,
      wallMeasurement: wallMs === null ? "unavailable" : "measured",
      wallSource: wallMs === null ? null : "runner-monotonic-stopwatch",
      modelActiveMs: null,
      harnessActiveMs: operationActiveTime(input.operationRows) ??
        boundedByWall(metrics.activeTimeMs, wallMs),
      providerMs: boundedByWall(metrics.evidenceExecutionTimeMs, wallMs),
      externalExecutionMs: boundedByWall(metrics.externalExecutionTimeMs, wallMs),
      humanWaitMs: boundedByWall(metrics.humanWaitMs, wallMs),
      externalWaitMs: null,
      unattributedWaitMs: boundedByWall(metrics.unattributedWaitMs, wallMs),
      hostEnvelopeDurationMs: measured(envelope.duration_ms ?? envelope.durationMs)
    },
    usage: {
      measurement: usageStatus,
      classification: usageClassification,
      costUsd: cost.value,
      costMeasurement: measurement(cost.status),
      costSource: cost.source,
      modelRequests: requestCount,
      modelRequestsMeasurement,
      observedModelRequests: observedRequests,
      hostReportedModelRequests: hostUsage.requests,
      capConsumedModelRequests: capConsumedRequests,
      inputTokens: attemptUsageValue(hostUsage.inputTokens, metrics.inputTokens, {
        noModelDispatch, forcedTermination, observedRequests
      }),
      outputTokens: attemptUsageValue(hostUsage.outputTokens, metrics.outputTokens, {
        noModelDispatch, forcedTermination, observedRequests
      }),
      cacheCreationTokens: attemptUsageValue(hostUsage.cacheCreationTokens,
        metrics.cacheCreationTokens, { noModelDispatch, forcedTermination, observedRequests }),
      cacheReadTokens: attemptUsageValue(hostUsage.cacheReadTokens, metrics.cacheReadTokens, {
        noModelDispatch, forcedTermination, observedRequests
      })
    },
    operations: operationSummary(input.operationRows, metrics, input.hostTelemetry),
    quality: qualitySummary(input.quality),
    oracle,
    evidenceReuse: {
      count: count(metrics.evidenceReuse?.count),
      byReason: object(metrics.evidenceReuse?.byReason)
    }
  };
}
