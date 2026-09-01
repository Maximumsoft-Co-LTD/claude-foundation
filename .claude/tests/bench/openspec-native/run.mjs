#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { buildScorecard } from "./scorecard.mjs";
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
    throw new Error("benchmark project must contain an installed Foundation harness");
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
  budgetExhausted = null
}) {
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
  const complete = !hostFailed && tasks === 0 && requiredEvidencePassed && !oracleFailed;
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
          : complete ? null : "required-work-or-proof-incomplete",
    changeId,
    workflowStatus: state.status || null,
    pendingTasks: tasks,
    requiredEvidencePassed,
    proofStatus: proof?.status || null,
    landStatus: state.status === "archived" ? "archived"
      : state.status === "proven" ? "awaiting-user" : null
  };
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
  quality = null, operationRows = null, stopwatch = {}, exitCode = 0,
  timedOut = false, budgetExhausted = null, changeId = null, provenance = {},
  hostTelemetry = {}, oracle = null
}) {
  const discovered = discoverChangeId(project, changeId, stopwatch.startedEpochMs ?? null);
  const resolvedMetrics = metrics ?? metricsFor(project, discovered) ?? {};
  const operationCandidates = operationRows ?? (discovered ? [
    ...readJsonLines(join(project, ".foundation/logs", discovered, "operations.jsonl")),
    ...readJsonLines(join(project, ".foundation/logs", discovered, "inspections.jsonl"))
  ] : []);
  const operations = operationRowsInWindow(operationCandidates, stopwatch);
  const qualityReport = quality ?? readJson(
    join(project, ".foundation/test-results/quality/crap.json"));
  return buildScorecard({
    scenario, repeat, runId, config, envelope, metrics: resolvedMetrics,
    quality: qualityReport, operationRows: operations, hostTelemetry,
    stopwatch,
    outcome: observedOutcome({
      project, changeId: discovered, envelope, exitCode, timedOut, oracle,
      budgetExhausted
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

function runClaude({ project, prompt, claudeBin, claudeArgs, timeoutMs,
  maxModelRequests = null }) {
  return new Promise((resolveRun) => {
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
    const terminate = () => {
      try {
        if (process.platform === "win32") child.kill("SIGTERM");
        else process.kill(-child.pid, "SIGTERM");
      } catch { child.kill("SIGTERM"); }
    };
    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      if (!Number.isInteger(maxModelRequests) || maxModelRequests < 1 || budgetExhausted)
        return;
      const lines = `${partialLine}${chunk}`.split(/\r?\n/);
      partialLine = lines.pop() || "";
      for (const line of lines) {
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        const requestId = row?.type === "assistant"
          ? row.message?.id || row.request_id || null : null;
        if (requestId) requestIds.add(requestId);
      }
      if (requestIds.size >= maxModelRequests) {
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
      forceTimer = setTimeout(() => {
        try {
          if (process.platform === "win32") child.kill("SIGKILL");
          else process.kill(-child.pid, "SIGKILL");
        } catch { child.kill("SIGKILL"); }
      }, 5000);
    }, timeoutMs);
    let forceTimer = null;
    child.on("error", (error) => {
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      resolveRun({
        exitCode: 127, timedOut: false, budgetExhausted,
        stdout: "", stderr: error.message,
        stopwatch: {
          wallMs: performance.now() - started, startedAt,
          finishedAt: new Date().toISOString(), startedEpochMs
        }
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      resolveRun({
        exitCode: code ?? 1, timedOut, budgetExhausted,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
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
  const isStream = rows.some((row) =>
    ["system", "assistant", "user", "result"].includes(row?.type));
  if (!isStream) {
    try {
      const envelope = JSON.parse(stdout);
      return { envelope, hostTelemetry: { total: null, browserCalls: null,
        taskMirrorOperations: null }, rows: [envelope] };
    } catch {
      return { envelope: {}, hostTelemetry: { total: null, browserCalls: null,
        taskMirrorOperations: null }, rows: [] };
    }
  }
  const envelope = [...rows].reverse().find((row) => row?.type === "result") || {};
  return { envelope, hostTelemetry: hostToolCalls(rows), rows };
}

function writeResult(output, scorecard) {
  mkdirSync(dirname(output), { recursive: true });
  appendFileSync(output, `${JSON.stringify(scorecard)}\n`);
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
    const claudeArgs = args["max-cost-usd"]
      ? [...args["claude-arg"], "--max-budget-usd", args["max-cost-usd"]]
      : args["claude-arg"];
    execution = await runClaude({
      project,
      prompt: required(args.prompt, "--prompt"),
      claudeBin: args["claude-bin"] || "claude",
      claudeArgs,
      timeoutMs: Number(args["timeout-ms"] || 1800000),
      maxModelRequests: args["max-model-requests"]
        ? Number(args["max-model-requests"]) : null
    });
  }
  const parsedHost = parseHostOutput(execution.stdout);
  const envelope = parsedHost.envelope;
  const discoveredChangeId = discoverChangeId(
    project, args["change-id"] || null, execution.stopwatch.startedEpochMs ?? null);
  const preliminaryOutcome = observedOutcome({
    project, changeId: discoveredChangeId, envelope,
    exitCode: execution.exitCode, timedOut: execution.timedOut,
    budgetExhausted: execution.budgetExhausted
  });
  const oracle = args.oracle && preliminaryOutcome.status !== "completed"
    ? {
      configured: true, measurement: "unavailable", verdict: null,
      score: null, max: null, results: {}, reason: "workflow-incomplete",
      source: resolve(args.oracle)
    }
    : runBenchmarkOracle({
      project, changeId: discoveredChangeId, oraclePath: args.oracle || null,
      timeoutMs: Number(args["oracle-timeout-ms"] || 120000)
    });
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
    changeId: discoveredChangeId, hostTelemetry: parsedHost.hostTelemetry, quality, oracle,
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
