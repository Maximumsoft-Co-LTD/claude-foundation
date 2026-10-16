import { createHash } from "node:crypto";

import { TOOL_CALL_CATEGORIES } from "../../../harness/runtime/observability/telemetry.mjs";

export const SCORECARD_PROTOCOL = "foundation-openspec-native-scorecard-v1";
export const MEASUREMENT_STATES = new Set(["measured", "partial", "unavailable"]);
// The bench arm that produced a row. `change-loop` is the installed harness;
// `baseline` is the same seed and task with no harness installed.
export const BENCH_ARMS = Object.freeze(["change-loop", "baseline"]);
export const DEFAULT_ARM = "change-loop";

export function benchArm(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_ARM;
  if (!BENCH_ARMS.includes(value))
    throw new Error(`arm must be one of ${BENCH_ARMS.join(", ")}`);
  return value;
}

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
  if (hostUsage.sessionCost) return hostUsage.sessionCost;
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

function countMap(value) {
  const input = object(value);
  const entries = Object.entries(input).map(([key, entry]) => [key, count(entry)]);
  return entries.every(([, entry]) => entry !== null) ? Object.fromEntries(entries) : null;
}

// Host tool calls come only from the host stream. A missing stream is unknown:
// every count stays null rather than becoming a misleading zero.
function hostToolCallSummary(hostTelemetry = {}) {
  const total = count(hostTelemetry.total);
  const categories = object(hostTelemetry.byCategory);
  const byCategory = Object.fromEntries(TOOL_CALL_CATEGORIES.map((key) =>
    [key, total === null ? null : count(categories[key])]));
  const categorized = Object.values(byCategory).every((value) => value !== null);
  return {
    measurement: total === null ? "unavailable" : categorized ? "measured" : "partial",
    total,
    byTool: total === null ? null : countMap(hostTelemetry.byTool),
    byCategory
  };
}

// Friction is measured only from a host stream; without one every count is
// unknown, never a reassuring zero.
function frictionSummary(hostTelemetry = {}) {
  const friction = object(hostTelemetry.friction);
  const measuredStream = count(friction.toolErrors) !== null;
  return {
    measurement: measuredStream ? "measured" : "unavailable",
    hookBlocks: measuredStream ? count(friction.hookBlocks) : null,
    permissionPrompts: measuredStream ? count(friction.permissionPrompts) : null,
    toolErrors: measuredStream ? count(friction.toolErrors) : null,
    advanceActions: measuredStream ? countMap(friction.advanceActions) : null,
    guardrail: countMap(hostTelemetry.guardrail)
  };
}

// Skill loading is measured only from a host stream; without one the counts
// are unknown, never zero.
function skillUsageSummary(hostTelemetry = {}) {
  const usage = hostTelemetry.skillUsage;
  const measured = usage && count(usage.skillToolCalls) !== null &&
    Array.isArray(usage.skillsLoaded) && Array.isArray(usage.skillFilesRead);
  return measured ? {
    measurement: "measured",
    skillToolCalls: count(usage.skillToolCalls),
    skillsLoaded: [...usage.skillsLoaded],
    skillFilesRead: [...usage.skillFilesRead]
  } : {
    measurement: "unavailable",
    reason: "host-stream-unavailable",
    skillToolCalls: null,
    skillsLoaded: null,
    skillFilesRead: null
  };
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
    taskMirrorOperations: count(hostTelemetry.taskMirrorOperations),
    hostToolCalls: hostToolCallSummary(hostTelemetry)
  };
}

// Change intake rounds from the harness's own command rows: every start or
// revise the harness rejected (an EDIT) before the one that reached AGREED.
const CHANGE_INTAKE_OPERATIONS = new Set(["start", "revise", "change-start", "change-revise"]);

function changeIntakeSummary(rows) {
  const intake = (Array.isArray(rows) ? rows : []).filter((row) =>
    row?.phase === "change" && row.kind !== "inspection" &&
    CHANGE_INTAKE_OPERATIONS.has(String(row.operation || "")))
    .sort((left, right) => String(left.startedAt || "").localeCompare(String(right.startedAt || "")));
  if (!intake.length) return {
    editRounds: null, editRoundsMeasurement: "unavailable",
    compileMs: null, compileMeasurement: "unavailable", compileSource: null
  };
  const agreed = intake.findIndex((row) => row.status === "completed");
  const row = agreed >= 0 ? intake[agreed] : null;
  const stages = Array.isArray(row?.stageSpans) ? row.stageSpans
    .filter((span) => String(span?.stage || "").startsWith("change."))
    .map((span) => measured(span.durationMs)).filter((value) => value !== null) : [];
  const compileMs = stages.length ? stages.reduce((sum, value) => sum + value, 0)
    : measured(row?.durationMs);
  return {
    // Without an AGREED row the count is only a floor.
    editRounds: agreed >= 0 ? agreed : intake.length,
    editRoundsMeasurement: agreed >= 0 ? "measured" : "partial",
    compileMs,
    compileMeasurement: compileMs === null ? "unavailable" : "measured",
    compileSource: compileMs === null ? null
      : stages.length ? "change-stage-spans" : "change-start-duration"
  };
}

function packetCount(value) {
  const input = object(value);
  const total = count(input.count);
  return total === null ? null : {
    count: total, sections: Array.isArray(input.sections) ? input.sections.map(object) : []
  };
}

// Packet quality: the collector's document metrics plus the intake rounds and
// compile time from the run's operation rows. Unknown stays null.
export function packetSummary(packet, operationRows) {
  const input = object(packet);
  const words = object(input.words);
  const known = ["measured", "partial"].includes(input.measurement);
  return {
    measurement: known ? input.measurement : "unavailable",
    reason: text(input.reason) || (known ? null : "packet-unavailable"),
    path: text(input.path),
    outlineSource: text(input.outlineSource),
    missingSections: known ? packetCount(input.missingSections) : null,
    duplicateSections: known ? packetCount(input.duplicateSections) : null,
    words: {
      proposal: known ? count(words.proposal) : null,
      design: known ? count(words.design) : null,
      tasks: known ? count(words.tasks) : null
    },
    ...changeIntakeSummary(operationRows)
  };
}

function normalizeOutcome(input = {}, oracle = {}, arm = DEFAULT_ARM) {
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
  // The baseline has no task ledger: its evidence is its own green project
  // command, so completion cannot wait on a pending-task count.
  const ledgerDone = arm === "baseline" || pendingTasks === 0;
  const complete = outcomeStatus === "completed" && ledgerDone &&
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
  // The envelope's num_turns counts conversation turns (tool results plus the
  // closing message), not model requests: only a floor when nothing was observed.
  const requestCandidates = [observedRequests, capConsumedRequests]
    .filter((value) => value !== null);
  if (!requestCandidates.length && hostUsage.requests !== null)
    requestCandidates.push(hostUsage.requests);
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
  const streamUsage = object(observedUsage.streamUsage);
  const streamTokens = { used: false };
  // The envelope (or Foundation metrics) wins; the stream fills only a missing
  // count, and a count nobody measured stays null, never zero.
  const tokenValue = (field, metricValue) => {
    const value = attemptUsageValue(hostUsage[field], metricValue, {
      noModelDispatch, forcedTermination, observedRequests
    });
    if (value !== null) return value;
    const streamed = noModelDispatch ? null : measured(streamUsage[field]);
    if (streamed !== null) streamTokens.used = true;
    return streamed;
  };
  const startedAt = timestamp(stopwatch.startedAt);
  const finishedAt = timestamp(stopwatch.finishedAt);
  const oracle = oracleSummary(input.oracle);
  const arm = benchArm(input.arm);
  return {
    protocol: SCORECARD_PROTOCOL,
    scenario: requiredText(input.scenario, "scenario"),
    arm,
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
    outcome: normalizeOutcome(input.outcome, oracle, arm),
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
      postTerminalModelRequests: count(observedUsage.postTerminalModelRequests),
      inputTokens: tokenValue("inputTokens", metrics.inputTokens),
      outputTokens: tokenValue("outputTokens", metrics.outputTokens),
      cacheCreationTokens: tokenValue("cacheCreationTokens", metrics.cacheCreationTokens),
      cacheReadTokens: tokenValue("cacheReadTokens", metrics.cacheReadTokens),
      // Where the token counts came from. A host stopped before its result
      // envelope still streamed per-request usage: a floor, so `partial`.
      tokenSource: streamTokens.used ? "stream-derived"
        : hostUsage.inputTokens !== null ? "host-result-envelope" : null
    },
    operations: operationSummary(input.operationRows, metrics, input.hostTelemetry),
    friction: frictionSummary(input.hostTelemetry),
    skillUsage: skillUsageSummary(input.hostTelemetry),
    quality: qualitySummary(input.quality),
    oracle,
    // Present when the runner collected the packet (see quality.mjs
    // collectPacketMetrics); a run without a packet reports `unavailable`.
    ...(input.packet === undefined ? {} : { packet: packetSummary(input.packet, input.operationRows) }),
    evidenceReuse: {
      count: count(metrics.evidenceReuse?.count),
      byReason: object(metrics.evidenceReuse?.byReason),
      resumptions: count(metrics.budget?.window?.extensionNumber)
    }
  };
}

const mdCell = (value) => value === null || value === undefined ? "unknown" : String(value);

// One run as markdown: outcome, speed, usage, oracle, and packet quality.
export function formatScorecardMarkdown(scorecard) {
  const card = object(scorecard);
  const usage = object(card.usage);
  const tokens = [usage.inputTokens, usage.outputTokens, usage.cacheCreationTokens, usage.cacheReadTokens];
  const lines = [
    `## ${card.scenario} (${card.arm}, repeat ${card.repeat})`, "",
    "| Metric | Value |", "|---|---|",
    `| Outcome | ${mdCell(card.outcome?.status)}${card.outcome?.complete ? " (complete)" : ""} |`,
    `| Oracle | ${card.oracle?.measurement === "measured"
      ? `${card.oracle.verdict} ${card.oracle.score}/${card.oracle.max}` : "unknown"} |`,
    `| Wall time ms | ${mdCell(card.timing?.wallMs)} |`,
    `| Tokens | ${tokens.every((value) => Number.isFinite(value))
      ? tokens.reduce((sum, value) => sum + value, 0) : "unknown"} |`,
    `| Cost USD | ${mdCell(usage.costUsd)} |`
  ];
  const packet = card.packet;
  if (packet) {
    const sections = (entry) => entry ? `${entry.count}${entry.sections?.length ? ` (${entry.sections
      .map((row) => `${row.document}: ${row.heading}`).join(", ")})` : ""}` : "unknown";
    lines.push(
      `| Packet | ${packet.measurement}${packet.outlineSource ? `, outline from ${packet.outlineSource}` : ""}${
        packet.reason ? ` (${packet.reason})` : ""} |`,
      `| Missing required sections | ${sections(packet.missingSections)} |`,
      `| Duplicate sections | ${sections(packet.duplicateSections)} |`,
      `| Words proposal / design / tasks | ${mdCell(packet.words?.proposal)} / ${
        mdCell(packet.words?.design)} / ${mdCell(packet.words?.tasks)} |`,
      `| EDIT rounds before AGREED | ${mdCell(packet.editRounds)}${
        packet.editRoundsMeasurement === "partial" ? " (floor: never AGREED)" : ""} |`,
      `| Change start compile ms | ${mdCell(packet.compileMs)} |`);
  }
  return `${lines.join("\n")}\n`;
}
