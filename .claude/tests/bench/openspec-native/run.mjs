#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync,
  realpathSync, statSync, writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { buildScorecard, digest } from "./scorecard.mjs";
import { benchmarkWorkspace, collectBenchmarkQuality } from "./quality.mjs";
import {
  messageToolCalls, toolCallProfile
} from "../../../harness/runtime/observability/telemetry.mjs";

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
      : state.status === "proven" ? "awaiting-user"
        : state.status === "applied" ? "interrupted-resumable" : null
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
    quality: qualityReport, operationRows: operations,
    hostTelemetry: { ...hostTelemetry, guardrail: guardrailOutcomes(project, stopwatch) },
    hostUsage,
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

// Land continues past `proven` inside one `advance --through archived`, so a
// runner watching for `proven` must also accept the states Land moves through.
export function watchedStatusReached(watched, status) {
  if (!watched || !status) return false;
  return status === watched ||
    (watched === "proven" && ["applied", "archived"].includes(status));
}

function parentPid(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]) || null;
  } catch { return null; }
}

// Processes still working inside the disposable project. Claude Code runs each
// Bash tool command in its own process group, so stopping the host group can
// leave a harness command (for example a Land) running on. Linux-only; other
// platforms report none rather than guess.
export function projectProcessIds(project) {
  if (process.platform !== "linux" || !existsSync("/proc")) return [];
  let root;
  try { root = realpathSync(project); } catch { return []; }
  const excluded = new Set();
  for (let pid = process.pid; pid && !excluded.has(pid); pid = parentPid(pid))
    excluded.add(pid);
  const ids = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry) || excluded.has(Number(entry))) continue;
    let cwd;
    try { cwd = readlinkSync(`/proc/${entry}/cwd`); } catch { continue; }
    if (cwd === root || cwd.startsWith(`${root}/`)) ids.push(Number(entry));
  }
  return ids;
}

// Wait for host-orphaned project processes before anything reads, lands in, or
// removes the project; force-stop only what outlives the bound.
export async function settleProjectProcesses(project, { timeoutMs = 60000, pollMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let ids = projectProcessIds(project);
  const observed = ids.length;
  while (ids.length && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, pollMs));
    ids = projectProcessIds(project);
  }
  for (const pid of ids) { try { process.kill(pid, "SIGKILL"); } catch {} }
  return { observed, killed: ids.length };
}

export function runClaude({ project, prompt, claudeBin, claudeArgs, timeoutMs,
  maxModelRequests = null, maxToolCalls = null, selfReviewAuthorized = false,
  stopOnArchived = false, stopOnProven = false, terminalGraceMs = 120000,
  settleTimeoutMs = 60000, finalEnvelopeGraceMs = 0 }) {
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
    const toolUseIds = new Set();
    const pendingToolUseIds = new Set();
    let terminalSeenAt = null;
    let terminalWallMs = null;
    let sawResult = false;
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
      if (!watchedStatusReached(watchedStatus, state.status)) {
        sawNonWatchedStatus = true;
        terminalSeenAt = null;
        return;
      }
      if (!sawNonWatchedStatus && state.status === initialStatus) return;
      // A tool call still in flight may be the lifecycle command carrying the
      // change through Land. Stopping the host now would orphan that command
      // mid-Land and race the backend Land, so let it return first.
      terminalSeenAt ??= Date.now();
      if (pendingToolUseIds.size && Date.now() - terminalSeenAt < terminalGraceMs) return;
      // The host's final result envelope carries the run's cost. Give it a short
      // grace to finish its closing message, but the measured wall time is the
      // moment the backend reached the terminal state, not the narration after.
      terminalWallMs ??= performance.now() - started;
      if (finalEnvelopeGraceMs > 0 && !sawResult &&
          Date.now() - terminalSeenAt < finalEnvelopeGraceMs) return;
      terminalReached = { changeId, status: state.status, observedAt: new Date().toISOString() };
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
        if (row?.type === "result") sawResult = true;
        const requestId = row?.type === "assistant"
          ? row.message?.id || row.request_id || null : null;
        if (requestId) requestIds.add(requestId);
        for (const toolUseId of streamToolUseIds(row)) {
          toolUseIds.add(toolUseId);
          pendingToolUseIds.add(toolUseId);
        }
        for (const toolUseId of streamToolResultIds(row)) pendingToolUseIds.delete(toolUseId);
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
      if (!decisionBoundary && !budgetExhausted && Number.isInteger(maxToolCalls) &&
          maxToolCalls > 0 && toolUseIds.size >= maxToolCalls) {
        budgetExhausted = { kind: "tool-calls", used: toolUseIds.size,
          target: maxToolCalls };
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
        observedToolCalls: toolUseIds.size || null,
        stopwatch: {
          wallMs: performance.now() - started, startedAt,
          finishedAt: new Date().toISOString(), startedEpochMs
        }
      });
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      if (terminalTimer) clearInterval(terminalTimer);
      if (forceTimer) clearTimeout(forceTimer);
      const settled = await settleProjectProcesses(project, { timeoutMs: settleTimeoutMs });
      if (settled.observed) stderr.push(Buffer.from(
        `bench: waited for ${settled.observed} host-orphaned project process(es); ` +
        `force-stopped ${settled.killed}\n`));
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
        observedToolCalls: toolUseIds.size || null,
        stopwatch: {
          wallMs: terminalReached && terminalWallMs !== null && finalEnvelopeGraceMs > 0
            ? terminalWallMs : performance.now() - started,
          finalEnvelopeWaitMs: terminalReached && terminalWallMs !== null && finalEnvelopeGraceMs > 0
            ? Math.max(0, performance.now() - started - terminalWallMs) : 0,
          startedAt, finishedAt: new Date().toISOString(), startedEpochMs
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
  const profile = toolCallProfile(rows.flatMap((row) => row?.type === "assistant"
    ? messageToolCalls(row.message) || [] : []));
  return { total: unique.length, browserCalls: browser.length,
    taskMirrorOperations: taskMirror.length,
    byTool: profile.byTool, byCategory: profile.byCategory,
    friction: hostFriction(rows) };
}

const ADVANCE_ACTIONS = ["EDIT", "REPAIR", "RUN_EXTERNAL", "WAIT", "ASK_USER", "DONE"];

function toolResultText(item) {
  return typeof item?.content === "string" ? item.content
    : Array.isArray(item?.content) ? item.content.map((part) => part?.text || "").join("\n") : "";
}

// What the run cost the agent in friction, read from the host stream: hook
// refusals, host permission prompts, failed tool calls, and the harness actions
// it was handed. The harness goal is zero hook refusals in a normal run.
// A failed result that no later assistant turn of its session follows, before
// the turn's `result` row, is the bench stopping the host mid-tool (exit
// 137/143) or the turn ending, which the agent never saw.
// Host safety denials ("Contains brace…") are approval prompts too.
export function hostFriction(rows) {
  const results = rows.flatMap((row) => row?.type === "user" &&
    Array.isArray(row.message?.content) ? row.message.content : [])
    .filter((item) => item?.type === "tool_result");
  const denied = new Set(rows.filter((row) => row?.type === "system" &&
    row.subtype === "permission_denied").map((row) => row.tool_use_id).filter(Boolean));
  const seen = [];
  let pending = [];
  for (const row of rows) {
    if (row?.type === "assistant") { seen.push(...pending); pending = []; }
    else if (row?.type === "result" ||
      (row?.type === "system" && row.subtype === "init")) pending = [];
    else if (row?.type === "user" && Array.isArray(row.message?.content))
      pending.push(...row.message.content.filter((item) =>
        item?.type === "tool_result" && item.is_error === true));
  }
  const errors = seen.map((item) => ({ body: toolResultText(item),
    denied: denied.has(item.tool_use_id) }));
  const actions = Object.fromEntries(ADVANCE_ACTIONS.map((action) => [action, 0]));
  for (const body of results.map(toolResultText))
    for (const match of body.matchAll(/"action"\s*:\s*"([A-Z_]+)"/g))
      if (Object.hasOwn(actions, match[1])) actions[match[1]] += 1;
  return {
    toolErrors: errors.length,
    hookBlocks: errors.filter(({ body }) => /hook error: BLOCKED|BLOCKED by secrets guard|BLOCKED: phase guard/
      .test(body)).length,
    permissionPrompts: errors.filter(({ body, denied }) =>
      denied || /requires approval/i.test(body)).length,
    advanceActions: actions
  };
}

// The guard's own audit of what it did instead of refusing, inside the run window.
export function guardrailOutcomes(project, stopwatch = {}) {
  const rows = operationRowsInWindow(readJsonLines(join(project, ".foundation/logs/guardrail-audit.jsonl"))
    .map((row) => ({ ...row, startedAt: row.timestamp })), stopwatch);
  const outcomes = {};
  for (const row of rows) outcomes[row.outcome || "unknown"] = (outcomes[row.outcome || "unknown"] || 0) + 1;
  return outcomes;
}

// Counts distinct tool_use ids in one stream-json row for the live stop.
export function streamToolUseIds(row) {
  if (row?.type !== "assistant") return [];
  return (messageToolCalls(row.message) || []).map((call) => call.id).filter(Boolean);
}

export function streamToolResultIds(row) {
  if (row?.type !== "user" || !Array.isArray(row.message?.content)) return [];
  return row.message.content
    .filter((item) => item?.type === "tool_result" && item.tool_use_id)
    .map((item) => item.tool_use_id);
}

// Token usage the host streamed per model request: the largest value each
// request reported (a request repeats its usage per content block), summed over
// distinct request ids. It covers a host stopped before its result envelope;
// the last request's output count may still be growing, so it is a floor.
// Null when the stream carries no usage; dollars are never derived from it.
export function streamUsage(rows) {
  const byRequest = new Map();
  for (const row of rows) {
    const usage = row?.type === "assistant" ? row.message?.usage : null;
    const id = row?.message?.id || row?.request_id;
    if (!usage || !id) continue;
    const seen = byRequest.get(id) || {};
    for (const [key, field] of [["inputTokens", "input_tokens"], ["outputTokens", "output_tokens"],
      ["cacheCreationTokens", "cache_creation_input_tokens"],
      ["cacheReadTokens", "cache_read_input_tokens"]]) {
      const value = Number(usage[field]);
      if (Number.isFinite(value) && value >= 0) seen[key] = Math.max(seen[key] ?? 0, value);
    }
    byRequest.set(id, seen);
  }
  if (!byRequest.size) return null;
  const total = (key) => {
    const values = [...byRequest.values()].map((row) => row[key]).filter(Number.isFinite);
    return values.length ? values.reduce((left, right) => left + right, 0) : null;
  };
  return { inputTokens: total("inputTokens"), outputTokens: total("outputTokens"),
    cacheCreationTokens: total("cacheCreationTokens"), cacheReadTokens: total("cacheReadTokens") };
}

export function parseHostOutput(stdout) {
  const rows = streamRows(stdout);
  const observedRequestIds = new Set(rows.flatMap((row) => row?.type === "assistant"
    ? [row.message?.id || row.request_id].filter(Boolean) : []));
  const observedUsage = {
    observedModelRequests: observedRequestIds.size || null,
    streamUsage: streamUsage(rows)
  };
  const isStream = rows.some((row) =>
    ["system", "assistant", "user", "result"].includes(row?.type));
  if (!isStream) {
    try {
      const envelope = JSON.parse(stdout);
      return { envelope, hostTelemetry: { total: null, browserCalls: null,
        taskMirrorOperations: null, byTool: null, byCategory: null },
      observedUsage, rows: [envelope] };
    } catch {
      return { envelope: {}, hostTelemetry: { total: null, browserCalls: null,
        taskMirrorOperations: null, byTool: null, byCategory: null },
      observedUsage, rows: [] };
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
    observedToolCalls: Number(base.observedToolCalls || 0) +
      Number(next.observedToolCalls || 0),
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

// Raw test runners are deliberately not pre-allowed in consumers, so the
// initial and repair routes verify only through harness commands the seeded
// rules cover; projectCommand is the draft's `verify` value, not a shell step.
export const BENCHMARK_VERIFY_AUTHORITY = "Use .foundation-benchmark.json projectCommand " +
  "as each draft task's verify value; do not probe alternate runner paths, globs, or " +
  "reporters. Run verification only through each Build task's returned checkCommand " +
  "(claude-foundation exec ...) and claude-foundation advance, never a raw test runner " +
  "(npm test, node --test, pytest), which is not pre-allowed.";

// With a task oracle the backend owns the pre-Land oracle and Land, so the
// host gets no Land authority and stops at `proven`. Granting it Land made the
// host run one `advance --through archived` straight past the oracle while the
// runner stopped it at `proven` and landed concurrently.
export function benchmarkLandAuthority({ landAuthorized = false, oracleConfigured = false } = {}) {
  if (!landAuthorized) return "";
  return oracleConfigured
    ? "This disposable benchmark does not grant Land authority to this session: the " +
      "backend runs a pre-Land oracle and then lands. Carry the change to proven with " +
      "claude-foundation advance <change> --through proven and stop there; do not Land."
    : "This disposable benchmark explicitly authorizes Land; continue until the change is landed and archived.";
}

function runtimeStatus(project, changeId) {
  return changeId
    ? readJson(join(project, ".foundation/runtime", `${changeId}.json`), {}).status || null
    : null;
}

export function oracleRepairPrompt(changeId, failedCases) {
  return `Resume existing change ${changeId}. The deterministic pre-Land oracle failed: ` +
    `${failedCases.join(", ")}. Run claude-foundation advance ${changeId} --through build, ` +
    "repair the complete root cause and adjacent cases as one batch, verify each task only " +
    "through its returned checkCommand (claude-foundation exec ...), then run " +
    `claude-foundation advance ${changeId} --through proven. Never run a test runner ` +
    "(npm test, node --test, pytest) directly; it is not pre-allowed. Do not Land; the " +
    "backend owns the oracle and Land boundary.";
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
        BENCHMARK_VERIFY_AUTHORITY,
        "Use change start --template as the sole draft schema contract; do not inspect managed .claude/harness files or openspec schema/templates. Keep tasks, claims, and critical cases to the smallest set that proves this scenario, let the backend derive mechanical IDs and unambiguous bindings, and apply any returned repair plan as one batch.",
        "Before Prove, cover zero, negative, fractional, finite oversized, non-finite, non-numeric/coercible, production-entry, no-collateral, and return-shape partitions when they apply to this recent-window defect.",
        selfReviewAuthorized
          ? "This disposable benchmark explicitly authorizes main-session self-review; record the waiver and continue without asking." : "",
        benchmarkLandAuthority({ landAuthorized, oracleConfigured: Boolean(args.oracle) })
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
        maxToolCalls: args["max-tool-calls"] ? Number(args["max-tool-calls"]) : null,
        selfReviewAuthorized,
        stopOnArchived: landAuthorized && !args.oracle,
        stopOnProven: landAuthorized && Boolean(args.oracle),
        finalEnvelopeGraceMs: args["final-envelope-grace-ms"] !== undefined
          ? Number(args["final-envelope-grace-ms"]) : 15000
      });
      decisionBoundary = execution.decisionBoundary || null;
    }
  }
  const discoveredChangeId = terminalChangeId(execution, discoverChangeId(
    project, args["change-id"] || null, execution.stopwatch.startedEpochMs ?? null));
  let oracle = null;
  let backendLandRan = false;
  const runBackendLand = () => {
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
    backendLandRan = true;
  };
  // `applied` means Land already started (the host's lifecycle command passed
  // `proven`); the sandbox is still present until archive, so the pre-Land
  // oracle still applies and the backend Land resumes it.
  if (["proven", "applied"].includes(execution.terminalReached?.status) && args.oracle) {
    const totalTimeoutMs = Number(args["timeout-ms"] || 1800000);
    const totalRequestCap = args["max-model-requests"]
      ? Number(args["max-model-requests"]) : null;
    do {
      oracle = runBenchmarkOracle({
        project, changeId: discoveredChangeId, oraclePath: args.oracle,
        timeoutMs: Number(args["oracle-timeout-ms"] || 120000)
      });
      if (oracle.verdict === "pass") break;
      if (runtimeStatus(project, discoveredChangeId) !== "proven") break;
      const remainingMs = totalTimeoutMs - execution.stopwatch.wallMs;
      const remainingRequests = Number.isInteger(totalRequestCap)
        ? totalRequestCap - Number(execution.observedModelRequests || 0) : null;
      const totalToolCallCap = args["max-tool-calls"]
        ? Number(args["max-tool-calls"]) : null;
      const remainingToolCalls = Number.isInteger(totalToolCallCap)
        ? totalToolCallCap - Number(execution.observedToolCalls || 0) : null;
      if (remainingMs <= 5000 || (remainingRequests !== null && remainingRequests <= 0) ||
          (remainingToolCalls !== null && remainingToolCalls <= 0))
        break;
      const failedCases = Object.entries(oracle.results || {})
        .filter(([, status]) => status !== "pass").map(([id]) => id);
      const repairArgs = args["max-cost-usd"]
        ? [...args["claude-arg"], "--max-budget-usd", args["max-cost-usd"]]
        : args["claude-arg"];
      const repair = await runClaude({
        project,
        prompt: [
          oracleRepairPrompt(discoveredChangeId, failedCases),
          "Use packets and returned repair plans only; do not inspect managed harness or schema files."
        ].join("\n\n"),
        claudeBin: args["claude-bin"] || "claude",
        claudeArgs: repairArgs,
        timeoutMs: remainingMs,
        maxModelRequests: remainingRequests,
        maxToolCalls: remainingToolCalls,
        selfReviewAuthorized: args["test-self-review"] === "true",
        stopOnProven: true
      });
      execution = mergeHostExecutions(execution, repair);
    } while (["proven", "applied"].includes(execution.terminalReached?.status));
    if (oracle.verdict === "pass") runBackendLand();
  }
  // A Land interrupted between code apply and archive resumes through the same
  // advance route (the documented crash recovery), never a user command. The
  // benchmark already authorized Land, so it carries that route once itself.
  if (!args["collect-only"] && args["test-land"] === "true" && !backendLandRan &&
      (!oracle || oracle.verdict === "pass") &&
      runtimeStatus(project, discoveredChangeId) === "applied") runBackendLand();
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
      maxToolCalls: args["max-tool-calls"] ? Number(args["max-tool-calls"]) : null,
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
      streamUsage: parsedHost.observedUsage.streamUsage ?? null,
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
