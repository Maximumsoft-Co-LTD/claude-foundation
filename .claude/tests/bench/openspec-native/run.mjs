#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { buildScorecard, digest } from "./scorecard.mjs";
import { benchmarkWorkspace, collectBenchmarkQuality } from "./quality.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const DEFAULT_OUTPUT = join(ROOT, ".claude/tests/bench/results/openspec-native-scorecards.jsonl");

function parseArgs(argv) {
  const result = { _: [], "claude-arg": [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) { result._.push(value); continue; }
    const key = value.slice(2);
    if (key === "collect-only") { result[key] = true; continue; }
    if (key === "claude-arg") {
      if (index + 1 >= argv.length) throw new Error("--claude-arg requires a value");
      result[key].push(argv[++index]);
      continue;
    }
    if (index + 1 >= argv.length) throw new Error(`--${key} requires a value`);
    result[key] = argv[++index];
  }
  return result;
}

function readJson(path, fallback = null) {
  if (!path || !existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function readJsonLines(path) {
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)
    .flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}

export function operationRowsInWindow(rows, stopwatch = {}) {
  const started = Number(stopwatch.startedEpochMs ?? Date.parse(stopwatch.startedAt));
  const finished = Number(Date.parse(stopwatch.finishedAt));
  if (!Number.isFinite(started) && !Number.isFinite(finished)) return rows;
  return rows.filter((row) => {
    const timestamp = Date.parse(row.startedAt || row.finishedAt || "");
    if (!Number.isFinite(timestamp)) return true;
    return (!Number.isFinite(started) || timestamp >= started - 1000) &&
      (!Number.isFinite(finished) || timestamp <= finished + 1000);
  });
}

function required(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function git(args, cwd = ROOT) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function assertDisposableProject(project) {
  const marker = readJson(join(project, ".foundation-benchmark.json"));
  if (marker?.disposable !== true)
    throw new Error("benchmark project must contain .foundation-benchmark.json with disposable=true");
  if (!existsSync(join(project, ".claude/harness/foundation.mjs")))
    throw new Error("benchmark project must contain an installed Change Loop harness");
}

export function discoverChangeId(project, explicit = null, startedAtMs = null) {
  if (explicit) return explicit;
  const runtime = join(project, ".foundation/runtime");
  if (!existsSync(runtime)) return null;
  const candidates = readdirSync(runtime, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => ({
      id: entry.name.slice(0, -5),
      mtimeMs: statSync(join(runtime, entry.name)).mtimeMs
    }))
    .filter((entry) => startedAtMs === null || entry.mtimeMs >= startedAtMs - 1000)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates.length === 1 ? candidates[0].id : null;
}

export function pendingTaskCount(content) {
  if (typeof content !== "string") return null;
  return content.split(/\r?\n/).filter((line) => /^\s*-\s*\[\s\]/.test(line)).length;
}

function activeChangePath(project, changeId) {
  const direct = join(project, "openspec/changes", changeId);
  if (existsSync(direct)) return direct;
  const state = readJson(join(project, ".foundation/runtime", `${changeId}.json`), {});
  const recordedArchive = state.archivedChangePath
    ? join(project, state.archivedChangePath) : null;
  if (recordedArchive && existsSync(recordedArchive)) return recordedArchive;
  const archived = join(project, "openspec/changes/archive", changeId);
  return existsSync(archived) ? archived : null;
}

function taskContent(project, changeId, change) {
  const sandboxTasks = join(project, ".foundation/sandboxes", changeId,
    "openspec/changes", changeId, "tasks.md");
  if (existsSync(sandboxTasks)) return readFileSync(sandboxTasks, "utf8");
  const controlTasks = change && join(change, "tasks.md");
  return controlTasks && existsSync(controlTasks)
    ? readFileSync(controlTasks, "utf8") : null;
}

export function observedOutcome({
  project, changeId, envelope, exitCode, timedOut, oracle = null,
  budgetExhausted = null, decisionBoundary = null
}) {
  if (decisionBoundary) {
    const state = changeId
      ? readJson(join(project, ".foundation/runtime", `${changeId}.json`), {}) : {};
    const change = changeId ? activeChangePath(project, changeId) : null;
    const tasks = changeId ? pendingTaskCount(taskContent(project, changeId, change)) : null;
    return {
      status: "needs-user-decision",
      failureClass: `external-authority-${decisionBoundary.provider || "unknown"}`,
      changeId, workflowStatus: decisionBoundary.workflowStatus ?? state.status ?? null,
      pendingTasks: decisionBoundary.pendingTasks ?? tasks,
      requiredEvidencePassed: false, proofStatus: null, landStatus: null,
      decisionProvider: decisionBoundary.provider,
      decisionKind: decisionBoundary.kind,
      decisionFingerprint: decisionBoundary.fingerprint,
      decisionDetectionSource: decisionBoundary.detectionSource,
      decisionFirstSeenWallMs: decisionBoundary.firstSeenWallMs ?? null,
      requestsAtDecision: decisionBoundary.requestsAtDecision ?? null,
      requestsAfterDecision: decisionBoundary.requestsAfterDecision ?? null,
      suppressedDuplicateDecisions: decisionBoundary.suppressedDuplicateCount ?? 0
    };
  }
  if (!changeId) return {
    status: budgetExhausted ? "needs-user-decision"
      : timedOut ? "timeout" : exitCode === 0 ? "incomplete" : "failed",
    failureClass: budgetExhausted ? `budget-exhausted-${budgetExhausted.kind}`
      : timedOut ? "host-timeout" : exitCode === 0 ? "change-not-discovered" : "host-exit",
    changeId: null, workflowStatus: null, pendingTasks: null,
    requiredEvidencePassed: null, proofStatus: null, landStatus: null
  };
  const state = readJson(join(project, ".foundation/runtime", `${changeId}.json`), {});
  const change = activeChangePath(project, changeId);
  const tasks = pendingTaskCount(taskContent(project, changeId, change));
  const proof = readJson(join(project, ".foundation/receipts", changeId, "proof.json"));
  const requiredEvidencePassed = proof?.status === "pass";
  const hostFailed = !budgetExhausted &&
    (timedOut || exitCode !== 0 || envelope?.is_error === true);
  const oracleRequired = oracle?.configured === true;
  const oracleUnavailable = oracleRequired && oracle?.measurement !== "measured";
  const oracleFailed = oracleRequired && oracle?.verdict !== "pass";
  const landed = state.status === "archived";
  const complete = !hostFailed && tasks === 0 && requiredEvidencePassed &&
    !oracleFailed && landed;
  return {
    status: budgetExhausted ? "needs-user-decision"
      : timedOut ? "timeout" : hostFailed || oracleFailed
      ? "failed" : complete ? "completed" : "incomplete",
    failureClass: budgetExhausted ? `budget-exhausted-${budgetExhausted.kind}`
      : timedOut ? "host-timeout"
      : exitCode !== 0 ? `host-exit-${exitCode}`
        : envelope?.is_error === true ? "host-result-error"
          : oracleUnavailable ? "task-oracle-unavailable"
            : oracleFailed ? "task-oracle-failed"
          : complete ? null
            : tasks === 0 && requiredEvidencePassed && !oracleFailed && !landed
              ? "land-not-archived"
              : "required-work-or-proof-incomplete",
    changeId,
    workflowStatus: state.status || null,
    pendingTasks: tasks,
    requiredEvidencePassed,
    proofStatus: proof?.status || null,
    landStatus: state.status === "archived" ? "archived"
      : state.status === "proven" ? "awaiting-user" : null
  };
}

function boundaryFromReadiness(readiness, detectionSource = "readiness-json") {
  if (readiness?.status !== "NEEDS_USER_DECISION") return null;
  const next = Array.isArray(readiness.next) ? readiness.next : [];
  const boundary = next.find((item) => item?.kind === "user-decision");
  const externalBudget = readiness?.budget?.class === "external-authority";
  if (!externalBudget && !boundary) return null;
  const selected = boundary || next[0] || {};
  const decision = selected?.decision && typeof selected.decision === "object"
    ? selected.decision : {};
  const options = Array.isArray(decision.options)
    ? decision.options.map((option) => option?.id).filter(Boolean).sort() : [];
  const identity = {
    status: readiness.status,
    budgetClass: "external-authority",
    provider: selected.provider || null,
    kind: decision.kind || "external-authority",
    options
  };
  return {
    provider: identity.provider,
    kind: identity.kind,
    fingerprint: digest(identity),
    recommended: decision.recommended || null,
    options,
    reason: readiness?.budget?.reason || null,
    workflowStatus: null,
    pendingTasks: Array.isArray(readiness.pendingTasks)
      ? readiness.pendingTasks.length : null,
    detectionSource
  };
}

function balancedJsonAt(value, start) {
  const opening = value[start];
  const closing = opening === "{" ? "}" : opening === "[" ? "]" : null;
  if (!closing) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === opening) depth += 1;
    else if (character === closing && --depth === 0) return value.slice(start, index + 1);
  }
  return null;
}

function readinessCandidates(value) {
  const candidates = [];
  const trimmed = String(value || "").trim();
  if (!trimmed) return candidates;
  try { candidates.push({ value: JSON.parse(trimmed), source: "exact-json" }); }
  catch { /* prefixed, fenced, or summarized output */ }
  for (let index = 0; index < trimmed.length; index += 1) {
    if (!["{", "["].includes(trimmed[index])) continue;
    const segment = balancedJsonAt(trimmed, index);
    if (!segment) continue;
    try {
      candidates.push({ value: JSON.parse(segment), source: "embedded-json" });
      index += segment.length - 1;
    } catch { /* keep scanning */ }
  }
  if (/\bstatus\s*=\s*["']NEEDS_USER_DECISION["']/.test(trimmed)) {
    const nextMatch = /\bnext\s*=\s*/.exec(trimmed);
    if (nextMatch) {
      const start = trimmed.indexOf("[", nextMatch.index + nextMatch[0].length);
      const segment = start >= 0 ? balancedJsonAt(trimmed, start) : null;
      if (segment) {
        try {
          candidates.push({
            value: { status: "NEEDS_USER_DECISION", next: JSON.parse(segment) },
            source: "readiness-summary"
          });
        } catch { /* malformed summary is not a boundary */ }
      }
    }
  }
  return candidates;
}

function toolResultValues(row) {
  if (!row || typeof row !== "object") return [];
  const values = [];
  const queue = [row];
  while (queue.length) {
    const candidate = queue.shift();
    if (!candidate || typeof candidate !== "object") continue;
    if (candidate.type === "tool_result") {
      values.push(candidate.content);
      continue;
    }
    if (Array.isArray(candidate)) queue.push(...candidate);
    else queue.push(...Object.values(candidate));
  }
  return values;
}

export function externalAuthorityBoundary(value) {
  const streamRow = value && typeof value === "object" && typeof value.type === "string";
  const queue = streamRow ? toolResultValues(value) : [value];
  while (queue.length) {
    const candidate = queue.shift();
    if (typeof candidate === "string") {
      for (const parsed of readinessCandidates(candidate)) {
        const boundary = boundaryFromReadiness(parsed.value, parsed.source);
        if (boundary) return boundary;
      }
      continue;
    }
    if (!candidate || typeof candidate !== "object") continue;
    const boundary = boundaryFromReadiness(candidate);
    if (boundary) return boundary;
    if (Array.isArray(candidate)) queue.push(...candidate);
    else queue.push(...Object.values(candidate));
  }
  return null;
}

export function proofDecisionBoundary(project, changeId) {
  if (!changeId) return null;
  const harness = join(project, ".claude/harness/foundation.mjs");
  if (!existsSync(harness)) return null;
  const result = spawnSync(process.execPath, [harness, "proof-readiness", changeId], {
    cwd: project, encoding: "utf8",
    env: { ...process.env, FOUNDATION_TELEMETRY: "0" },
    maxBuffer: 10 * 1024 * 1024
  });
  try { return boundaryFromReadiness(JSON.parse(String(result.stdout || "").trim())); }
  catch { return null; }
}

export function provenLandReady(project, changeId) {
  if (!changeId) return false;
  const harness = join(project, ".claude/harness/foundation.mjs");
  if (!existsSync(harness)) return false;
  const result = spawnSync(process.execPath, [harness, "land-check", changeId], {
    cwd: project, encoding: "utf8",
    env: { ...process.env, FOUNDATION_TELEMETRY: "0" },
    maxBuffer: 10 * 1024 * 1024
  });
  return result.status === 0;
}

export function runBenchmarkOracle({ project, changeId, oraclePath, timeoutMs = 120000 }) {
  if (!oraclePath) return {
    configured: false, measurement: "unavailable", verdict: null,
    score: null, max: null, results: {}, reason: "not-configured", source: null
  };
  const source = resolve(oraclePath);
  const workspace = benchmarkWorkspace(project, changeId);
  if (!existsSync(source)) return {
    configured: true, measurement: "unavailable", verdict: null,
    score: null, max: null, results: {}, reason: "oracle-not-found", source
  };
  const execution = spawnSync("sh", [source, workspace], {
    cwd: project, encoding: "utf8", timeout: timeoutMs,
    env: { ...process.env, FOUNDATION_TELEMETRY: "0" },
    maxBuffer: 10 * 1024 * 1024
  });
  if (execution.status !== 0) return {
    configured: true, measurement: "unavailable", verdict: null,
    score: null, max: null, results: {},
    reason: execution.error?.code === "ETIMEDOUT" ? "oracle-timeout" : "oracle-exit",
    source
  };
  let value;
  try { value = JSON.parse(String(execution.stdout || "").trim()); }
  catch { value = null; }
  const resultsValid = value?.results && typeof value.results === "object" &&
    !Array.isArray(value.results) && Object.values(value.results)
      .every((result) => ["pass", "fail"].includes(result));
  if (!value || !["pass", "fail"].includes(value.verdict) ||
      !Number.isInteger(value.score) || !Number.isInteger(value.max) ||
      value.score < 0 || value.max < 1 || value.score > value.max || !resultsValid ||
      value.score !== Object.values(value.results).filter((result) => result === "pass").length ||
      value.max !== Object.keys(value.results).length ||
      value.verdict !== (value.score === value.max ? "pass" : "fail"))
    return {
      configured: true, measurement: "unavailable", verdict: null,
      score: null, max: null, results: {}, reason: "oracle-output-invalid", source
    };
  return {
    configured: true, measurement: "measured", verdict: value.verdict,
    score: value.score, max: value.max, results: value.results,
    reason: null, source
  };
}

function metricsFor(project, changeId) {
  if (!changeId) return null;
  const result = spawnSync(process.execPath,
    [join(project, ".claude/harness/foundation.mjs"), "metrics", changeId], {
      cwd: project, encoding: "utf8", env: { ...process.env, FOUNDATION_TELEMETRY: "0" }
    });
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
}

export function collectNativeScorecard({
  scenario, repeat, runId, project, config = {}, envelope = {}, metrics = null,
  quality = null, operationRows = null, syntheticOperationRows = [], stopwatch = {}, exitCode = 0,
  timedOut = false, budgetExhausted = null, changeId = null, provenance = {},
  hostTelemetry = {}, hostUsage = {}, oracle = null, decisionBoundary = null
}) {
  const discovered = discoverChangeId(project, changeId, stopwatch.startedEpochMs ?? null);
  const resolvedMetrics = metrics ?? metricsFor(project, discovered) ?? {};
  const operationCandidates = operationRows ?? (discovered ? [
    ...readJsonLines(join(project, ".foundation/logs", discovered, "operations.jsonl")),
    ...readJsonLines(join(project, ".foundation/logs", discovered, "inspections.jsonl"))
  ] : []);
  const operations = operationRowsInWindow([
    ...operationCandidates,
    ...(Array.isArray(syntheticOperationRows) ? syntheticOperationRows : [])
  ], stopwatch);
  const qualityReport = quality ?? readJson(
    join(project, ".foundation/test-results/quality/crap.json"));
  return buildScorecard({
    scenario, repeat, runId, config, envelope, metrics: resolvedMetrics,
    quality: qualityReport, operationRows: operations, hostTelemetry, hostUsage,
    stopwatch,
    outcome: observedOutcome({
      project, changeId: discovered, envelope, exitCode, timedOut, oracle,
      budgetExhausted, decisionBoundary
    }),
    oracle,
    provenance: {
      commit: provenance.commit ?? git(["rev-parse", "HEAD"]),
      dirty: provenance.dirty ?? Boolean(git(["status", "--porcelain"])),
      host: provenance.host ?? "claude-code",
      requestedModel: provenance.requestedModel ?? null,
      actualModel: provenance.actualModel ?? envelope.model ?? null
    }
  });
}

export function runClaude({ project, prompt, claudeBin, claudeArgs, timeoutMs,
  maxModelRequests = null, selfReviewAuthorized = false,
  stopOnArchived = false, stopOnProven = false }) {
  return new Promise((resolveRun) => {
    const initialChangeId = discoverChangeId(project);
    const initialStatus = initialChangeId
      ? readJson(join(project, ".foundation/runtime", `${initialChangeId}.json`), {}).status
      : null;
    const startedAt = new Date().toISOString();
    const startedEpochMs = Date.now();
    const started = performance.now();
    const child = spawn(claudeBin,
      ["-p", prompt, "--output-format", "stream-json", "--verbose", ...claudeArgs], {
      cwd: project, env: process.env, detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    const requestIds = new Set();
    let partialLine = "";
    let budgetExhausted = null;
    let decisionBoundary = null;
    let terminalReached = null;
    let sawNonWatchedStatus = !stopOnProven || initialStatus !== "proven";
    let forceTimer = null;
    const terminate = () => {
      try {
        if (process.platform === "win32") child.kill("SIGTERM");
        else process.kill(-child.pid, "SIGTERM");
      } catch { child.kill("SIGTERM"); }
      if (!forceTimer) forceTimer = setTimeout(() => {
        try {
          if (process.platform === "win32") child.kill("SIGKILL");
          else process.kill(-child.pid, "SIGKILL");
        } catch { child.kill("SIGKILL"); }
      }, 5000);
    };
    const watchedStatus = stopOnProven ? "proven" : stopOnArchived ? "archived" : null;
    const terminalTimer = watchedStatus ? setInterval(() => {
      const changeId = discoverChangeId(project, null, startedEpochMs);
      if (!changeId) return;
      const state = readJson(join(project, ".foundation/runtime", `${changeId}.json`), {});
      if (state.status !== watchedStatus) {
        sawNonWatchedStatus = true;
        return;
      }
      if (!sawNonWatchedStatus) return;
      terminalReached = { changeId, status: watchedStatus, observedAt: new Date().toISOString() };
      clearInterval(terminalTimer);
      terminate();
    }, 250) : null;
    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      const lines = `${partialLine}${chunk}`.split(/\r?\n/);
      partialLine = lines.pop() || "";
      for (const line of lines) {
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        const requestId = row?.type === "assistant"
          ? row.message?.id || row.request_id || null : null;
        if (requestId) requestIds.add(requestId);
        const detected = externalAuthorityBoundary(row);
        const benchmarkSelfReview = selfReviewAuthorized &&
          detected?.kind === "independent-review" &&
          detected?.recommended === "prepare-for-reviewer";
        if (!decisionBoundary && detected && !benchmarkSelfReview) {
          decisionBoundary = {
            ...detected,
            firstSeenWallMs: performance.now() - started,
            requestsAtDecision: requestIds.size,
            requestsAfterDecision: 0,
            suppressedDuplicateCount: 0
          };
          terminate();
        } else if (decisionBoundary && detected?.fingerprint === decisionBoundary.fingerprint) {
          decisionBoundary.suppressedDuplicateCount += 1;
        }
      }
      if (!decisionBoundary && !budgetExhausted && Number.isInteger(maxModelRequests) &&
          maxModelRequests > 0 && requestIds.size >= maxModelRequests) {
        budgetExhausted = { kind: "model-requests", used: requestIds.size,
          target: maxModelRequests };
        terminate();
      }
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      if (terminalTimer) clearInterval(terminalTimer);
      if (forceTimer) clearTimeout(forceTimer);
      resolveRun({
        exitCode: terminalReached ? 0 : 127, timedOut: false, budgetExhausted,
        decisionBoundary, terminalReached,
        stdout: "", stderr: error.message,
        observedModelRequests: requestIds.size || null,
        stopwatch: {
          wallMs: performance.now() - started, startedAt,
          finishedAt: new Date().toISOString(), startedEpochMs
        }
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (terminalTimer) clearInterval(terminalTimer);
      if (forceTimer) clearTimeout(forceTimer);
      if (decisionBoundary)
        decisionBoundary.requestsAfterDecision = Math.max(0,
          requestIds.size - decisionBoundary.requestsAtDecision);
      resolveRun({
        exitCode: terminalReached ? 0 : code ?? 1,
        timedOut: terminalReached ? false : timedOut,
        budgetExhausted: terminalReached ? null : budgetExhausted,
        decisionBoundary: terminalReached ? null : decisionBoundary,
        terminalReached,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        observedModelRequests: requestIds.size || null,
        stopwatch: {
          wallMs: performance.now() - started, startedAt,
          finishedAt: new Date().toISOString(), startedEpochMs
        }
      });
    });
  });
}

function streamRows(stdout) {
  return String(stdout || "").split(/\r?\n/).filter(Boolean)
    .flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}

function hostToolCalls(rows) {
  const calls = rows.flatMap((row) => row?.type === "assistant" &&
    Array.isArray(row.message?.content) ? row.message.content : [])
    .filter((item) => item?.type === "tool_use");
  const unique = [...new Map(calls.map((call, index) =>
    [call.id || `anonymous-${index}`, call])).values()];
  const browser = unique.filter((call) =>
    /(?:^|__)(?:browseros(?:-neo)?|browser|chrome)(?:__|$)/i.test(call.name || ""));
  const taskMirror = unique.filter((call) => {
    const command = call.input?.command || "";
    return /(?:task(?:s)?[-_ ]mirror|mirror[-_ ]task(?:s)?|task[-_ ]ledger)/i
      .test(`${call.name || ""} ${command}`);
  });
  return { total: unique.length, browserCalls: browser.length,
    taskMirrorOperations: taskMirror.length };
}

export function parseHostOutput(stdout) {
  const rows = streamRows(stdout);
  const observedRequestIds = new Set(rows.flatMap((row) => row?.type === "assistant"
    ? [row.message?.id || row.request_id].filter(Boolean) : []));
  const observedUsage = {
    observedModelRequests: observedRequestIds.size || null
  };
  const isStream = rows.some((row) =>
    ["system", "assistant", "user", "result"].includes(row?.type));
  if (!isStream) {
    try {
      const envelope = JSON.parse(stdout);
      return { envelope, hostTelemetry: { total: null, browserCalls: null,
        taskMirrorOperations: null }, observedUsage, rows: [envelope] };
    } catch {
      return { envelope: {}, hostTelemetry: { total: null, browserCalls: null,
        taskMirrorOperations: null }, observedUsage, rows: [] };
    }
  }
  const envelope = [...rows].reverse().find((row) => row?.type === "result") || {};
  return { envelope, hostTelemetry: hostToolCalls(rows), observedUsage, rows };
}

function writeResult(output, scorecard) {
  mkdirSync(dirname(output), { recursive: true });
  appendFileSync(output, `${JSON.stringify(scorecard)}\n`);
}

export function mergeHostExecutions(base, next) {
  return {
    ...base,
    exitCode: next.exitCode,
    timedOut: next.timedOut,
    budgetExhausted: next.budgetExhausted,
    decisionBoundary: next.decisionBoundary,
    terminalReached: next.terminalReached,
    stdout: `${base.stdout || ""}${next.stdout || ""}`,
    stderr: `${base.stderr || ""}${next.stderr || ""}`,
    observedModelRequests: Number(base.observedModelRequests || 0) +
      Number(next.observedModelRequests || 0),
    stopwatch: {
      ...base.stopwatch,
      wallMs: Number(base.stopwatch?.wallMs || 0) + Number(next.stopwatch?.wallMs || 0),
      finishedAt: next.stopwatch?.finishedAt || base.stopwatch?.finishedAt
    }
  };
}

export function remainingTimeoutMs(total, used) {
  return Math.max(1000, Math.floor(Number(total) - Number(used || 0)));
}

export function terminalChangeId(execution, fallback = null) {
  return execution?.terminalReached?.changeId || fallback;
}

export function backendLandArgs(changeId) {
  return ["land-advance", changeId];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenario = required(args.scenario, "--scenario");
  const project = resolve(required(args.project, "--project"));
  const repeat = Number(args.repeat || 1);
  const runId = args["run-id"] || `${scenario}-${repeat}-${Date.now()}`;
  const output = resolve(args.output || DEFAULT_OUTPUT);
  assertDisposableProject(project);
  let execution;
  let decisionBoundary = null;
  if (args["collect-only"]) {
    execution = {
      exitCode: Number(args["exit-code"] || 0), timedOut: args["timed-out"] === "true",
      stdout: args.envelope ? readFileSync(resolve(args.envelope), "utf8") : "{}",
      stderr: "",
      stopwatch: {
        wallMs: args["wall-ms"] === undefined ? null : Number(args["wall-ms"]),
        startedAt: args["started-at"] || null,
        finishedAt: args["finished-at"] || null,
        startedEpochMs: args["started-epoch-ms"] === undefined
          ? null : Number(args["started-epoch-ms"])
      }
    };
  } else {
    const preflightChangeId = args["change-id"] || discoverChangeId(project);
    const preflightStartedAt = new Date().toISOString();
    const preflightStartedEpochMs = Date.now();
    const preflightStarted = performance.now();
    const preflightState = preflightChangeId
      ? readJson(join(project, ".foundation/runtime", `${preflightChangeId}.json`), {}) : {};
    const resumeArchived = Boolean(args.oracle) && args["test-land"] === "true" &&
      preflightState.status === "archived";
    const resumeProven = !resumeArchived && Boolean(args.oracle) &&
      args["test-land"] === "true" &&
      preflightState.status === "proven" && provenLandReady(project, preflightChangeId);
    const preflightBoundary = resumeProven || resumeArchived
      ? null : proofDecisionBoundary(project, preflightChangeId);
    const authorizedSelfReview = args["test-self-review"] === "true" &&
      preflightBoundary?.kind === "independent-review";
    decisionBoundary = authorizedSelfReview ? null : preflightBoundary;
    if (resumeProven || resumeArchived) {
      execution = {
        exitCode: 0, timedOut: false, budgetExhausted: null,
        observedModelRequests: 0, noModelDispatch: true, stdout: "", stderr: "",
        terminalReached: { changeId: preflightChangeId,
          status: resumeArchived ? "archived" : "proven",
          observedAt: new Date().toISOString() },
        stopwatch: {
          wallMs: performance.now() - preflightStarted,
          startedAt: preflightStartedAt, finishedAt: new Date().toISOString(),
          startedEpochMs: preflightStartedEpochMs
        }
      };
    } else if (decisionBoundary) {
      decisionBoundary = {
        ...decisionBoundary,
        firstSeenWallMs: performance.now() - preflightStarted,
        requestsAtDecision: 0,
        requestsAfterDecision: 0,
        suppressedDuplicateCount: 0
      };
      const finishedAt = new Date().toISOString();
      execution = {
        exitCode: 0, timedOut: false, budgetExhausted: null,
        observedModelRequests: 0, noModelDispatch: true, stdout: "", stderr: "",
        stopwatch: {
          wallMs: performance.now() - preflightStarted,
          startedAt: preflightStartedAt, finishedAt,
          startedEpochMs: preflightStartedEpochMs
        }
      };
    } else {
      const claudeArgs = args["max-cost-usd"]
        ? [...args["claude-arg"], "--max-budget-usd", args["max-cost-usd"]]
        : args["claude-arg"];
      const selfReviewAuthorized = args["test-self-review"] === "true";
      const landAuthorized = args["test-land"] === "true";
      const benchmarkAuthority = [
        "Use .foundation-benchmark.json projectCommand as the sole canonical project test command; do not probe alternate runner paths, globs, or reporters.",
        "Use change start --template as the sole draft schema contract; do not inspect managed .claude/harness files or openspec schema/templates. Keep tasks, claims, and critical cases to the smallest set that proves this scenario, let the backend derive mechanical IDs and unambiguous bindings, and apply any returned repair plan as one batch.",
        "Before Prove, cover zero, negative, fractional, finite oversized, non-finite, non-numeric/coercible, production-entry, no-collateral, and return-shape partitions when they apply to this recent-window defect.",
        selfReviewAuthorized
          ? "This disposable benchmark explicitly authorizes main-session self-review; record the waiver and continue without asking." : "",
        landAuthorized
          ? "This disposable benchmark explicitly authorizes Land; continue until the change is landed and archived." : ""
      ].filter(Boolean).join(" ");
      execution = await runClaude({
        project,
        prompt: [required(args.prompt, "--prompt"), benchmarkAuthority]
          .filter(Boolean).join("\n\n"),
        claudeBin: args["claude-bin"] || "claude",
        claudeArgs,
        timeoutMs: Number(args["timeout-ms"] || 1800000),
        maxModelRequests: args["max-model-requests"]
          ? Number(args["max-model-requests"]) : null,
        selfReviewAuthorized,
        stopOnArchived: landAuthorized && !args.oracle,
        stopOnProven: landAuthorized && Boolean(args.oracle)
      });
      decisionBoundary = execution.decisionBoundary || null;
    }
  }
  const discoveredChangeId = terminalChangeId(execution, discoverChangeId(
    project, args["change-id"] || null, execution.stopwatch.startedEpochMs ?? null));
  let oracle = null;
  if (execution.terminalReached?.status === "proven" && args.oracle) {
    const totalTimeoutMs = Number(args["timeout-ms"] || 1800000);
    const totalRequestCap = args["max-model-requests"]
      ? Number(args["max-model-requests"]) : null;
    do {
      oracle = runBenchmarkOracle({
        project, changeId: discoveredChangeId, oraclePath: args.oracle,
        timeoutMs: Number(args["oracle-timeout-ms"] || 120000)
      });
      if (oracle.verdict === "pass") break;
      const remainingMs = totalTimeoutMs - execution.stopwatch.wallMs;
      const remainingRequests = Number.isInteger(totalRequestCap)
        ? totalRequestCap - Number(execution.observedModelRequests || 0) : null;
      if (remainingMs <= 5000 || (remainingRequests !== null && remainingRequests <= 0))
        break;
      const failedCases = Object.entries(oracle.results || {})
        .filter(([, status]) => status !== "pass").map(([id]) => id);
      const repairArgs = args["max-cost-usd"]
        ? [...args["claude-arg"], "--max-budget-usd", args["max-cost-usd"]]
        : args["claude-arg"];
      const repair = await runClaude({
        project,
        prompt: [
          `Resume existing change ${discoveredChangeId}. The deterministic pre-Land oracle failed: ${failedCases.join(", ")}. Return to Build, repair the complete root cause and adjacent cases as one batch, run the canonical project test, then Prove again. Do not Land; the backend owns the oracle and Land boundary.`,
          "Use packets and returned repair plans only; do not inspect managed harness or schema files."
        ].join("\n\n"),
        claudeBin: args["claude-bin"] || "claude",
        claudeArgs: repairArgs,
        timeoutMs: remainingMs,
        maxModelRequests: remainingRequests,
        selfReviewAuthorized: args["test-self-review"] === "true",
        stopOnProven: true
      });
      execution = mergeHostExecutions(execution, repair);
    } while (execution.terminalReached?.status === "proven");
    if (oracle.verdict === "pass") {
      const harness = join(project, ".claude/harness/foundation.mjs");
      const remainingMs = remainingTimeoutMs(
        Number(args["timeout-ms"] || 1800000), execution.stopwatch.wallMs);
      const landed = spawnSync(process.execPath,
        [harness, ...backendLandArgs(discoveredChangeId)], {
          cwd: project, encoding: "utf8", env: process.env, timeout: remainingMs
        });
      execution.stdout += landed.stdout || "";
      execution.stderr += landed.stderr || "";
      execution.exitCode = landed.status ?? 1;
    }
  }
  const parsedHost = parseHostOutput(execution.stdout);
  const envelope = parsedHost.envelope;
  const preliminaryOutcome = observedOutcome({
    project, changeId: discoveredChangeId, envelope,
    exitCode: execution.exitCode, timedOut: execution.timedOut,
    budgetExhausted: execution.budgetExhausted, decisionBoundary, oracle
  });
  oracle = oracle || (args.oracle && preliminaryOutcome.status !== "completed"
    ? {
      configured: true, measurement: "unavailable", verdict: null,
      score: null, max: null, results: {}, reason: "workflow-incomplete",
      source: resolve(args.oracle)
    }
    : runBenchmarkOracle({
      project, changeId: discoveredChangeId, oraclePath: args.oracle || null,
      timeoutMs: Number(args["oracle-timeout-ms"] || 120000)
    }));
  const quality = !args["collect-only"] && preliminaryOutcome.status === "completed"
    ? await collectBenchmarkQuality({ project, changeId: discoveredChangeId })
    : null;
  const scorecard = collectNativeScorecard({
    scenario, repeat, runId, project,
    config: {
      prompt: args.prompt || null,
      timeoutMs: args["timeout-ms"] ? Number(args["timeout-ms"]) : null,
      maxCostUsd: args["max-cost-usd"] ? Number(args["max-cost-usd"]) : null,
      maxModelRequests: args["max-model-requests"]
        ? Number(args["max-model-requests"]) : null,
      claudeArgs: args["claude-arg"],
      oracle: args.oracle || null
    },
    envelope, stopwatch: execution.stopwatch,
    exitCode: execution.exitCode, timedOut: execution.timedOut,
    budgetExhausted: execution.budgetExhausted,
    changeId: discoveredChangeId, hostTelemetry: parsedHost.hostTelemetry,
    hostUsage: {
      observedModelRequests: execution.observedModelRequests ??
        parsedHost.observedUsage.observedModelRequests,
      capConsumedModelRequests: execution.budgetExhausted?.kind === "model-requests"
        ? execution.budgetExhausted.used : null,
      forcedTermination: Boolean(execution.budgetExhausted || execution.timedOut ||
        execution.decisionBoundary),
      noModelDispatch: execution.noModelDispatch === true
    },
    decisionBoundary, quality, oracle,
    syntheticOperationRows: decisionBoundary ? [{
      operation: execution.noModelDispatch
        ? "stopped-before-model-dispatch" : "stopped-at-external-authority",
      startedAt: execution.stopwatch.startedAt,
      finishedAt: execution.stopwatch.finishedAt,
      durationMs: execution.stopwatch.wallMs
    }] : [],
    provenance: { requestedModel: args.model || null }
  });
  writeResult(output, scorecard);
  const artifactDir = join(dirname(output), "openspec-native-runs", runId);
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, "host-result.json"), `${JSON.stringify(envelope, null, 2)}\n`);
  writeFileSync(join(artifactDir, "host.stream.jsonl"), execution.stdout);
  writeFileSync(join(artifactDir, "host.stderr.log"), execution.stderr);
  writeFileSync(join(artifactDir, "scorecard.json"), `${JSON.stringify(scorecard, null, 2)}\n`);
  if (oracle.configured)
    writeFileSync(join(artifactDir, "oracle.json"), `${JSON.stringify(oracle, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(scorecard, null, 2)}\n`);
  if (!["completed", "blocked"].includes(scorecard.outcome.status)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
