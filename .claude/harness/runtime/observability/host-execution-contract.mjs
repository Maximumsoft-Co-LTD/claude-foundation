import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const HOST_EXECUTION_SCHEMA_VERSION = 1;
const STATUSES = new Set(["completed", "failed", "timeout", "cancelled", "error"]);
const ATTEMPT_STATUSES = new Set(["completed", "failed", "timeout", "cancelled", "error"]);

function nullableFinite(value, field, { nonNegative = true } = {}) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || (nonNegative && number < 0))
    throw new Error(`${field} must be a ${nonNegative ? "non-negative " : ""}number or null`);
  return number;
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function nullableString(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${field} must be a string or null`);
  return value || null;
}

function nullableTimestamp(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error(`${field} must be an ISO timestamp or null`);
  return new Date(value).toISOString();
}

function normalizedUsage(usage = {}) {
  if (usage === null) usage = {};
  if (typeof usage !== "object" || Array.isArray(usage))
    throw new Error("usage must be an object or null");
  return {
    inputTokens: nullableFinite(usage.inputTokens ?? usage.input_tokens, "usage.inputTokens"),
    outputTokens: nullableFinite(usage.outputTokens ?? usage.output_tokens, "usage.outputTokens"),
    cacheTokens: nullableFinite(usage.cacheTokens ?? usage.cache_tokens, "usage.cacheTokens"),
    cost: nullableFinite(usage.cost ?? usage.cost_usd, "usage.cost")
  };
}

function nullableCount(value, field) {
  const count = nullableFinite(value, field);
  if (count !== null && !Number.isInteger(count)) throw new Error(`${field} must be an integer or null`);
  return count;
}

function normalizedAttempt(attempt, index) {
  const number = nullableFinite(attempt?.attempt ?? index + 1, `attempts[${index}].attempt`);
  if (!Number.isInteger(number) || number < 1)
    throw new Error(`attempts[${index}].attempt must be a positive integer`);
  const status = requiredString(attempt?.status, `attempts[${index}].status`);
  if (!ATTEMPT_STATUSES.has(status))
    throw new Error(`attempts[${index}].status is unsupported`);
  return {
    attempt: number,
    model: nullableString(attempt.model, `attempts[${index}].model`),
    status,
    startedAt: nullableTimestamp(attempt.startedAt ?? attempt.started_at,
      `attempts[${index}].startedAt`),
    finishedAt: nullableTimestamp(attempt.finishedAt ?? attempt.finished_at,
      `attempts[${index}].finishedAt`),
    durationMs: nullableFinite(attempt.durationMs ?? attempt.duration_ms,
      `attempts[${index}].durationMs`),
    fallbackReason: nullableString(attempt.fallbackReason ?? attempt.fallback_reason,
      `attempts[${index}].fallbackReason`),
    failureClass: nullableString(attempt.failureClass ?? attempt.failure_class,
      `attempts[${index}].failureClass`),
    usage: normalizedUsage(attempt.usage)
  };
}

/**
 * Normalize a host result to the fields Foundation is allowed to persist.
 * Unknown fields and payload-shaped fields (prompt, messages, tool arguments,
 * output text) are ignored by construction rather than copied and redacted.
 */
export function normalizeHostExecution(input, { changeId = null, importedAt = null } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("host execution result must be an object");
  if (input.schemaVersion !== undefined && Number(input.schemaVersion) !== HOST_EXECUTION_SCHEMA_VERSION)
    throw new Error(`unsupported host execution schema: ${input.schemaVersion}`);
  const dispatchId = requiredString(input.dispatchId ?? input.dispatch_id, "dispatchId");
  const status = requiredString(input.result?.status ?? input.status, "result.status");
  if (!STATUSES.has(status)) throw new Error(`unsupported result.status: ${status}`);
  const attempts = (Array.isArray(input.attempts) ? input.attempts : [])
    .map(normalizedAttempt).sort((left, right) => left.attempt - right.attempt);
  if (new Set(attempts.map((attempt) => attempt.attempt)).size !== attempts.length)
    throw new Error("attempt numbers must be unique");

  return {
    schemaVersion: HOST_EXECUTION_SCHEMA_VERSION,
    dispatchId,
    changeId: nullableString(changeId || input.changeId || input.change_id, "changeId"),
    host: nullableString(input.host ?? input.source, "host"),
    requestedModel: nullableString(input.requestedModel ?? input.requested_model,
      "requestedModel"),
    actualModel: nullableString(input.actualModel ?? input.actual_model, "actualModel"),
    instructionManifestDigest: nullableString(
      input.instructionManifestDigest ?? input.instruction_manifest_digest,
      "instructionManifestDigest"),
    startedAt: nullableTimestamp(input.startedAt ?? input.started_at, "startedAt"),
    finishedAt: nullableTimestamp(input.finishedAt ?? input.finished_at, "finishedAt"),
    durationMs: nullableFinite(input.durationMs ?? input.duration_ms, "durationMs"),
    attempts,
    usage: normalizedUsage(input.usage),
    tools: {
      calls: nullableCount(input.tools?.calls, "tools.calls"),
      failures: nullableCount(input.tools?.failures, "tools.failures")
    },
    result: {
      status,
      failureClass: nullableString(
        input.result?.failureClass ?? input.result?.failure_class, "result.failureClass")
    },
    importedAt: nullableTimestamp(importedAt, "importedAt") || new Date().toISOString()
  };
}

export function hostExecutionTelemetryRows(execution) {
  return execution.attempts.map((attempt) => ({
    version: 2,
    runId: execution.dispatchId,
    operationId: "host-execution",
    agentId: execution.host,
    modelId: attempt.model || execution.actualModel,
    requestId: `${execution.dispatchId}:attempt:${attempt.attempt}`,
    timestamp: attempt.finishedAt || attempt.startedAt || execution.importedAt,
    inputTokens: attempt.usage.inputTokens,
    outputTokens: attempt.usage.outputTokens,
    cacheTokens: attempt.usage.cacheTokens,
    cost: attempt.usage.cost,
    durationMs: attempt.durationMs,
    changeId: execution.changeId,
    instructionManifestDigest: execution.instructionManifestDigest,
    attempt: attempt.attempt,
    attemptStatus: attempt.status,
    fallbackReason: attempt.fallbackReason,
    failureClass: attempt.failureClass,
    source: "host-execution-contract"
  }));
}

export function createHostExecutionStore({ root, now = () => new Date().toISOString() }) {
  function safeIdentifier(value, field) {
    const safe = requiredString(value, field);
    if (!/^[A-Za-z0-9._-]+$/.test(safe))
      throw new Error(`${field} contains unsafe characters`);
    return safe;
  }

  function executionPath(changeId, dispatchId) {
    const safeDispatch = safeIdentifier(dispatchId, "dispatchId");
    const safeChange = safeIdentifier(changeId, "changeId");
    return join(root, ".foundation", "logs", safeChange,
      "host-executions", `${safeDispatch}.json`);
  }

  function importExecution(changeId, input) {
    const execution = normalizeHostExecution(input, { changeId, importedAt: now() });
    const path = executionPath(changeId, execution.dispatchId);
    mkdirSync(dirname(path), { recursive: true });
    const existing = readExisting(path);
    if (existing) return { imported: false, duplicate: true, path, execution: existing };
    try {
      writeFileSync(path, `${JSON.stringify(execution, null, 2)}\n`, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      return { imported: false, duplicate: true, path, execution: readExisting(path) };
    }
    return { imported: true, duplicate: false, path, execution };
  }

  function readExisting(path) {
    try { return JSON.parse(readFileSync(path, "utf8")); } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  return { executionPath, importExecution };
}
