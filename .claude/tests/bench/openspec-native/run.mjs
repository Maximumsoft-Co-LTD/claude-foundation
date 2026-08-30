#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { buildScorecard } from "./scorecard.mjs";

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

export function observedOutcome({ project, changeId, envelope, exitCode, timedOut }) {
  if (!changeId) return {
    status: timedOut ? "timeout" : exitCode === 0 ? "incomplete" : "failed",
    failureClass: timedOut ? "host-timeout" : exitCode === 0 ? "change-not-discovered" : "host-exit",
    changeId: null, workflowStatus: null, pendingTasks: null,
    requiredEvidencePassed: null, proofStatus: null, landStatus: null
  };
  const state = readJson(join(project, ".foundation/runtime", `${changeId}.json`), {});
  const change = activeChangePath(project, changeId);
  const tasks = change ? pendingTaskCount(
    existsSync(join(change, "tasks.md")) ? readFileSync(join(change, "tasks.md"), "utf8") : null
  ) : null;
  const proof = readJson(join(project, ".foundation/receipts", changeId, "proof.json"));
  const requiredEvidencePassed = proof?.status === "pass";
  const hostFailed = timedOut || exitCode !== 0 || envelope?.is_error === true;
  const complete = !hostFailed && tasks === 0 && requiredEvidencePassed;
  return {
    status: timedOut ? "timeout" : hostFailed ? "failed" : complete ? "completed" : "incomplete",
    failureClass: timedOut ? "host-timeout"
      : exitCode !== 0 ? `host-exit-${exitCode}`
        : envelope?.is_error === true ? "host-result-error"
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
  timedOut = false, changeId = null, provenance = {}, hostTelemetry = {}
}) {
  const discovered = discoverChangeId(project, changeId, stopwatch.startedEpochMs ?? null);
  const resolvedMetrics = metrics ?? metricsFor(project, discovered) ?? {};
  const operations = operationRows ?? (discovered ? [
    ...readJsonLines(join(project, ".foundation/logs", discovered, "operations.jsonl")),
    ...readJsonLines(join(project, ".foundation/logs", discovered, "inspections.jsonl"))
  ] : []);
  const qualityReport = quality ?? readJson(
    join(project, ".foundation/test-results/quality/crap.json"));
  return buildScorecard({
    scenario, repeat, runId, config, envelope, metrics: resolvedMetrics,
    quality: qualityReport, operationRows: operations, hostTelemetry,
    stopwatch,
    outcome: observedOutcome({
      project, changeId: discovered, envelope, exitCode, timedOut
    }),
    provenance: {
      commit: provenance.commit ?? git(["rev-parse", "HEAD"]),
      dirty: provenance.dirty ?? Boolean(git(["status", "--porcelain"])),
      host: provenance.host ?? "claude-code",
      requestedModel: provenance.requestedModel ?? null,
      actualModel: provenance.actualModel ?? envelope.model ?? null
    }
  });
}

function runClaude({ project, prompt, claudeBin, claudeArgs, timeoutMs }) {
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
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === "win32") child.kill("SIGTERM");
        else process.kill(-child.pid, "SIGTERM");
      } catch { child.kill("SIGTERM"); }
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
        exitCode: 127, timedOut: false, stdout: "", stderr: error.message,
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
        exitCode: code ?? 1, timedOut,
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
    execution = await runClaude({
      project,
      prompt: required(args.prompt, "--prompt"),
      claudeBin: args["claude-bin"] || "claude",
      claudeArgs: args["claude-arg"],
      timeoutMs: Number(args["timeout-ms"] || 1800000)
    });
  }
  const parsedHost = parseHostOutput(execution.stdout);
  const envelope = parsedHost.envelope;
  const scorecard = collectNativeScorecard({
    scenario, repeat, runId, project,
    config: {
      prompt: args.prompt || null,
      timeoutMs: args["timeout-ms"] ? Number(args["timeout-ms"]) : null,
      claudeArgs: args["claude-arg"]
    },
    envelope, stopwatch: execution.stopwatch,
    exitCode: execution.exitCode, timedOut: execution.timedOut,
    changeId: args["change-id"] || null, hostTelemetry: parsedHost.hostTelemetry,
    provenance: { requestedModel: args.model || null }
  });
  writeResult(output, scorecard);
  const artifactDir = join(dirname(output), "openspec-native-runs", runId);
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, "host-result.json"), `${JSON.stringify(envelope, null, 2)}\n`);
  writeFileSync(join(artifactDir, "host.stream.jsonl"), execution.stdout);
  writeFileSync(join(artifactDir, "host.stderr.log"), execution.stderr);
  writeFileSync(join(artifactDir, "scorecard.json"), `${JSON.stringify(scorecard, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(scorecard, null, 2)}\n`);
  if (!["completed", "blocked"].includes(scorecard.outcome.status)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
