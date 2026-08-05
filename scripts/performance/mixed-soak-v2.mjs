#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { publishJsonAtomic } from "./atomic-record.mjs";
import { sourceTreeSha256 } from "./source-tree-integrity.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const integrationMode = ["--integration", "--integration-cycles"].includes(process.argv[2]);
const integrationCycles = process.argv[2] === "--integration-cycles"
  ? positiveInteger(process.argv[3], "integration cycles") : 1;
const durationSeconds = integrationMode
  ? 1 : positiveInteger(process.argv[2] ?? "28800", "duration");
const outputArgument = process.argv[process.argv[2] === "--integration-cycles" ? 4 : 3];
const output = path.resolve(root, outputArgument ?? "target/performance/mixed-soak-v2.json");
const probe = path.join(root, "target/release/changeloop-performance-probes");
const cloop = path.join(root, "target/release/cloop");
const fixture = mkdtempSync(path.join(os.tmpdir(), "changeloop-mixed-soak-v2-"));
const limits = {
  maxProcessTreeRssKiB: 512 * 1024, maxProcessFileDescriptors: 256,
  maxFixtureGrowthKiB: 64, maxRssSlopeKiBPerCycle: 2_048,
  maxFileDescriptorSlopePerCycle: 1,
};
const workload = [
  ["queue", probe, ["queue"]],
  ["relay", probe, ["relay"]],
  ["router", probe, ["router"]],
  ["shutdown", probe, ["shutdown", "--repetitions", "1"]],
  ["status", cloop, ["status"]],
  ["readOnlyConversations", probe, ["mixed", "read-only-conversation"], 3_000, true],
  ["disposableWorktreeMutations", probe, ["mixed", "disposable-worktree-mutation"], 3_000, true],
  ["reconnectReplay", probe, ["mixed", "reconnect-replay"], 3_000, true],
  ["childCancellation", probe, ["mixed", "child-cancellation"], 3_000, true],
  ["jobs", probe, ["mixed", "jobs"], 3_000, true],
  ["projectCreateDispose", probe, ["mixed", "project-create-dispose"], 3_000, true],
];
const requiredWorkloads = [
  "queue", "relay", "router", "shutdown", "status",
  "readOnlyConversations", "disposableWorktreeMutations", "reconnectReplay",
  "childCancellation", "jobs", "projectCreateDispose",
];
const integrityAtStart = integritySnapshot();
const state = {
  cycles: 0,
  failures: [],
  workloadRuns: Object.fromEntries(requiredWorkloads.map((name) => [name, 0])),
  successfulWorkloadRuns: Object.fromEntries(requiredWorkloads.map((name) => [name, 0])),
  maxProcessTreeRssKiB: 0,
  maxProcessFileDescriptors: 0,
  orphanProcessGroups: [],
  resourceSamples: 0,
  samples: [],
};
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => { interrupted = true; });
}

writeFileSync(path.join(fixture, "changeloop.json"), "{}\n");
mkdirSync(path.dirname(output), { recursive: true });
const startedNs = process.hrtime.bigint();
const startedAt = new Date().toISOString();
const deadlineNs = startedNs + BigInt(durationSeconds) * 1_000_000_000n;
const baselineFixtureDiskKiB = diskKiB(fixture);

try {
  while (!interrupted && (integrationMode
    ? state.cycles < integrationCycles : process.hrtime.bigint() < deadlineNs)) {
    const cycle = {
      cycle: state.cycles + 1, elapsedSeconds: elapsedSeconds(startedNs), rssKiB: 0,
      fileDescriptors: 0, fixtureDiskKiB: 0, workloadOutcomes: [],
    };
    for (const [name, executable, arguments_, timeoutMs, capture] of workload) {
      const result = await measuredProcess(
        executable, arguments_, name === "status" ? fixture : root, timeoutMs, capture,
      );
      state.workloadRuns[name] += 1;
      cycle.rssKiB = Math.max(cycle.rssKiB, result.maxProcessTreeRssKiB);
      cycle.fileDescriptors = Math.max(cycle.fileDescriptors, result.maxProcessFileDescriptors);
      state.maxProcessTreeRssKiB = Math.max(state.maxProcessTreeRssKiB, result.maxProcessTreeRssKiB);
      state.maxProcessFileDescriptors = Math.max(state.maxProcessFileDescriptors, result.maxProcessFileDescriptors);
      state.resourceSamples += result.resourceSamples;
      if (result.orphanPids.length > 0) state.orphanProcessGroups.push({ name, pgid: result.pgid, pids: result.orphanPids });
      const semanticPassed = !capture || verifyMixedFixture(result.stdout, arguments_[1]);
      const passed = result.status === 0 && semanticPassed
        && !result.timedOut && !result.outputOverflow;
      cycle.workloadOutcomes.push({
        name, passed, exitStatus: result.status, timedOut: result.timedOut,
        outputOverflow: result.outputOverflow, durationNs: result.durationNs,
      });
      if (passed) {
        state.successfulWorkloadRuns[name] += 1;
      } else {
        state.failures.push({
          cycle: cycle.cycle, workload: name, status: result.status, signal: result.signal,
          timedOut: result.timedOut, outputOverflow: result.outputOverflow, semanticPassed,
          durationNs: result.durationNs,
          errorExcerpt: result.stderr.slice(0, 4_096),
        });
      }
      if (interrupted) break;
    }
    cycle.fixtureDiskKiB = diskKiB(fixture);
    state.samples.push(cycle);
    state.cycles += 1;
    if (!integrationMode && !interrupted && process.hrtime.bigint() < deadlineNs) await delay(1_000);
  }
} finally {
  const elapsed = elapsedSeconds(startedNs);
  const finalFixtureDiskKiB = diskKiB(fixture);
  const fixtureGrowthKiB = Math.max(0, finalFixtureDiskKiB - baselineFixtureDiskKiB);
  const rssSlopeKiBPerCycle = linearSlope(state.samples.map((sample) => sample.rssKiB));
  const fileDescriptorSlopePerCycle = linearSlope(
    state.samples.map((sample) => sample.fileDescriptors),
  );
  // A three-cycle integration run proves workload/resource-bound semantics,
  // but it is too short to make a truthful leak-trend claim. Release soaks
  // evaluate the trend only after the required minimum sample window.
  const resourceTrendEvaluated = !integrationMode && state.cycles >= 100;
  const stableResourceTrend = resourceTrendEvaluated
    ? rssSlopeKiBPerCycle <= limits.maxRssSlopeKiBPerCycle
      && fileDescriptorSlopePerCycle <= limits.maxFileDescriptorSlopePerCycle
    : null;
  const coverageGaps = requiredWorkloads.filter((name) =>
    state.workloadRuns[name] === 0
      || state.successfulWorkloadRuns[name] !== state.workloadRuns[name]);
  const coverageComplete = coverageGaps.length === 0;
  const correctness = {
    coverageComplete,
    allWorkloadsPassed: state.failures.length === 0,
    rssWithinLimit: state.maxProcessTreeRssKiB <= limits.maxProcessTreeRssKiB,
    fileDescriptorsWithinLimit: state.maxProcessFileDescriptors <= limits.maxProcessFileDescriptors,
    boundedFixtureGrowth: fixtureGrowthKiB <= limits.maxFixtureGrowthKiB,
    noOrphanProcesses: state.orphanProcessGroups.length === 0,
    resourceSamplingComplete: state.resourceSamples > 0,
    resourceTrendEvaluated,
    stableResourceTrend,
    coverageGaps,
  };
  const commonContractPassed = coverageComplete
    && correctness.allWorkloadsPassed
    && correctness.rssWithinLimit
    && correctness.fileDescriptorsWithinLimit
    && correctness.boundedFixtureGrowth
    && correctness.noOrphanProcesses
    && correctness.resourceSamplingComplete;
  const integrationContractPassed = integrationMode && commonContractPassed;
  const soakContractPassed = !integrationMode && commonContractPassed
    && resourceTrendEvaluated && stableResourceTrend === true;
  const integrityAtEnd = integritySnapshot();
  const integrity = {
    start: integrityAtStart,
    end: integrityAtEnd,
    unchanged: JSON.stringify(integrityAtStart) === JSON.stringify(integrityAtEnd),
  };
  const releaseEligible = durationSeconds >= 28_800
    && elapsed >= 28_800
    && state.cycles >= 100
    && !interrupted
    && soakContractPassed
    && integrity.unchanged;
  const record = {
    schema: "dev.changeloop.mixed-resource-soak",
    recordVersion: 2,
    workloadVersion: "mixed-resource-soak-v2",
    mode: integrationMode ? "integration" : "soak",
    requestedIntegrationCycles: integrationMode ? integrationCycles : null,
    startedAt,
    finishedAt: new Date().toISOString(),
    requestedDurationSeconds: durationSeconds,
    elapsedSeconds: elapsed,
    cycles: state.cycles,
    workloadRuns: state.workloadRuns,
    successfulWorkloadRuns: state.successfulWorkloadRuns,
    failures: { total: state.failures.length, observations: state.failures },
    resources: {
      limits,
      maxProcessTreeRssKiB: state.maxProcessTreeRssKiB,
      maxProcessFileDescriptors: state.maxProcessFileDescriptors,
      baselineFixtureDiskKiB,
      finalFixtureDiskKiB,
      fixtureGrowthKiB,
      resourceSamples: state.resourceSamples,
      rssSlopeKiBPerCycle,
      fileDescriptorSlopePerCycle,
      samples: state.samples,
    },
    orphanProcessGroups: state.orphanProcessGroups,
    interrupted,
    integrity,
    correctness,
    integrationContractPassed: integrationMode ? integrationContractPassed : null,
    soakContractPassed: integrationMode ? null : soakContractPassed,
    releaseEligible,
  };
  publishJsonAtomic(output, record);
  rmSync(fixture, { recursive: true, force: true });
  console.log(JSON.stringify({
    output, elapsedSeconds: elapsed, cycles: state.cycles,
    failures: state.failures.length, coverageGaps,
    failedCorrectness: Object.entries(correctness)
      .filter(([, value]) => value === false)
      .map(([name]) => name),
    integrationContractPassed: integrationMode ? integrationContractPassed : null,
    soakContractPassed: integrationMode ? null : soakContractPassed,
    releaseEligible,
  }, null, 2));
  if (integrationMode ? !integrationContractPassed : !soakContractPassed) process.exitCode = 1;
}

async function measuredProcess(executable, arguments_, cwd, timeoutMs = 60_000, capture = false) {
  const startedNs = process.hrtime.bigint();
  const child = spawn(executable, arguments_, {
    // Most workloads communicate success through their exit status and can emit
    // large evidence records. Discard that unrequested stdout at the OS boundary
    // instead of buffering it and then classifying a successful probe as an
    // output overflow. Captured semantic fixtures and stderr remain bounded.
    cwd, detached: true, stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"],
  });
  const pgid = child.pid;
  let stdout = "";
  let stderr = "";
  let outputOverflow = false;
  const collect = (field, chunk) => {
    // Non-captured stdout is intentionally drained without retention. Several
    // probes emit complete latency vectors, so treating their expected output
    // volume as a capture overflow would turn a successful workload into a
    // false failure and grow no useful diagnostic state.
    if (field === "stdout" && !capture) return;
    const value = chunk.toString("utf8");
    if ((field === "stdout" ? stdout.length : stderr.length) + value.length > 64 * 1024) {
      outputOverflow = true;
    } else if (field === "stdout") stdout += value;
    else stderr += value;
  };
  child.stdout?.on("data", (chunk) => collect("stdout", chunk));
  child.stderr.on("data", (chunk) => collect("stderr", chunk));
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    try { process.kill(-pgid, "SIGKILL"); }
    catch {}
  }, timeoutMs);
  let maxProcessTreeRssKiB = 0;
  let maxProcessFileDescriptors = 0;
  let resourceSamples = 0;
  const sample = () => {
    const tree = processTree(child.pid);
    maxProcessTreeRssKiB = Math.max(maxProcessTreeRssKiB, tree.reduce((sum, item) => sum + item.rssKiB, 0));
    const descriptors = tree.map((item) => fileDescriptors(item.pid));
    if (tree.length > 0 && descriptors.every((count) => count !== null)) {
      resourceSamples += 1;
      maxProcessFileDescriptors = Math.max(maxProcessFileDescriptors, descriptors.reduce((sum, count) => sum + count, 0));
    }
  };
  sample();
  const timer = setInterval(sample, 20);
  const outcome = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (status, signal) => resolve({ status, signal }));
  });
  clearTimeout(timeout);
  clearInterval(timer);
  sample();
  await delay(25);
  return {
    ...outcome, pgid, maxProcessTreeRssKiB, maxProcessFileDescriptors, resourceSamples,
    orphanPids: processGroupPids(pgid), stdout: capture ? stdout : "", stderr,
    timedOut, outputOverflow, durationNs: Number(process.hrtime.bigint() - startedNs),
  };
}

function verifyMixedFixture(output, expectedFixture) {
  try {
    const record = JSON.parse(output);
    return record?.recordVersion === 1 && record?.probe === "mixed-soak-workload"
      && record?.fixture === expectedFixture && record?.hermetic === true
      && typeof record?.semanticVerification === "string"
      && record.semanticVerification.length > 0
      && Number.isSafeInteger(record?.timeoutMs) && record.timeoutMs > 0
      && Number.isSafeInteger(record?.durationNs) && record.durationNs > 0;
  } catch {
    return false;
  }
}

function processTree(rootPid) {
  if (!rootPid) return [];
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,rss="], { encoding: "utf8" });
  if (result.status !== 0) return [];
  const rows = result.stdout.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([pid, ppid, rss]) => Number.isInteger(pid) && Number.isInteger(ppid) && Number.isFinite(rss));
  const included = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, ppid] of rows) if (included.has(ppid) && !included.has(pid)) { included.add(pid); changed = true; }
  }
  return rows.filter(([pid]) => included.has(pid)).map(([pid, , rssKiB]) => ({ pid, rssKiB }));
}

function processGroupPids(pgid) {
  if (!pgid) return [];
  const result = spawnSync("ps", ["-axo", "pid=,pgid="], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([pid, group]) => Number.isInteger(pid) && group === pgid).map(([pid]) => pid);
}

function fileDescriptors(pid) {
  if (os.platform() === "linux") {
    try { return readdirSync(`/proc/${pid}/fd`).length; }
    catch { return null; }
  }
  const result = spawnSync("lsof", ["-p", String(pid), "-Fn"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.split("\n").filter((line) => line.startsWith("f")).length : null;
}

function diskKiB(directory) {
  const result = spawnSync("du", ["-sk", directory], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`could not measure fixture disk usage: ${result.stderr}`);
  return Number(result.stdout.trim().split(/\s+/)[0]);
}

function elapsedSeconds(started) { return Number(process.hrtime.bigint() - started) / 1e9; }
function linearSlope(values) {
  if (values.length < 2) return 0;
  const meanX = (values.length - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    numerator += (index - meanX) * (values[index] - meanY);
    denominator += (index - meanX) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function integritySnapshot() {
  return {
    gitRevision: commandOutput("git", ["rev-parse", "HEAD"]),
    sourceTreeSha256: sourceTreeSha256(root),
    cloopSha256: fileSha256(cloop),
    probeSha256: fileSha256(probe),
    cargoLockSha256: fileSha256(path.join(root, "Cargo.lock")),
    runnerSha256: fileSha256(new URL(import.meta.url)),
  };
}
function commandOutput(executable, arguments_) {
  const result = spawnSync(executable, arguments_, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${executable} ${arguments_.join(" ")} failed`);
  return result.stdout.trim();
}
function fileSha256(file) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
