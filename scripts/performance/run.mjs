#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  assessReleaseEvidence, loadEvidence, referenceMachineFingerprint, validateRunRecord,
} from "./release-evidence.mjs";
import { publishJsonAtomic } from "./atomic-record.mjs";
import { sourceTreeSha256 } from "./source-tree-integrity.mjs";

const RECORD_VERSION = 2;
const WORKLOAD_VERSION = "local-performance-gates-v2";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const options = parseOptions(process.argv.slice(2));
const profile = options.mode === "release" ? "release" : "smoke";
const startupWarmups = numberOption(options, "startup-warmups", profile === "release" ? 5 : 1);
const startupRepetitions = numberOption(options, "startup-repetitions", profile === "release" ? 30 : 5);
const replayWarmups = numberOption(options, "replay-warmups", profile === "release" ? 5 : 1);
const replayRepetitions = numberOption(options, "replay-repetitions", profile === "release" ? 20 : 3);
const shutdownRepetitions = numberOption(options, "shutdown-repetitions", profile === "release" ? 20 : 3);
const soakSeconds = numberOption(options, "soak-seconds", profile === "release" ? 28_800 : 5);

if (profile === "release" && soakSeconds >= 28_800 && !options["confirm-8h"]) {
  fail("release mode runs for at least eight hours; pass --confirm-8h or set a shorter --soak-seconds diagnostic duration");
}

const cloop = path.resolve(root, options.cloop ?? "target/release/cloop");
const storageProbe = path.resolve(root, "target/release/examples/reliability_probe");
const queueProbe = path.resolve(root, "target/release/changeloop-performance-probes");
const commands = [];

if (!options["skip-build"]) {
  run("cargo", ["build", "--release", "-p", "changeloop-cli"]);
  run("cargo", ["build", "--release", "-p", "changeloop-storage", "--example", "reliability_probe"]);
  run("cargo", ["build", "--release", "-p", "changeloop-performance-probes"]);
}
const runIntegrityStart = revisionMetadata(cloop);

const fixture = mkdtempSync(path.join(os.tmpdir(), "changeloop-performance-"));
writeFileSync(path.join(fixture, "changeloop.json"), "{}\n");

try {
  const startup = [
    measureCommand("help", cloop, ["--help"], fixture, startupWarmups, startupRepetitions,
      (result) => result.status === 0 && /Usage:/i.test(result.stdout)),
    measureCommand("status", cloop, ["status"], fixture, startupWarmups, startupRepetitions,
      (result) => result.status === 0 && result.stdout.trim().length > 0),
  ];
  const replayCold = probeJson(storageProbe, ["replay", "--events", "10000", "--warmups", "0", "--repetitions", String(replayRepetitions)]);
  const replayWarm = probeJson(storageProbe, ["replay", "--events", "10000", "--warmups", String(replayWarmups), "--repetitions", String(replayRepetitions)]);
  const queue = probeJson(queueProbe, []);
  const tui = probeJson("python3", ["-B", path.join(root, "scripts/performance/tui_probe.py"), cloop, String(startupRepetitions), String(startupWarmups)]);
  const transports = probeJson(queueProbe, ["relay"]);
  const router = probeJson(queueProbe, ["router"]);
  const shutdownStates = probeJson(queueProbe, ["shutdown", "--repetitions", String(shutdownRepetitions)]);
  const shutdown = probeJson(storageProbe, ["shutdown", "--repetitions", String(shutdownRepetitions)]);
  const soak = probeJson(storageProbe, ["soak", "--duration-seconds", String(soakSeconds), "--events", "1000"]);
  const gates = {
    cliStartup: { thresholdMs: 250, samples: startup, passed: startup.every((sample) => sample.correctnessPassed && sample.summary.p95Ms < 250) },
    eventReplay10k: {
      thresholdMs: 2_000,
      coverageComplete: true,
      coverageGaps: [],
      variants: [measuredGate(replayCold, 2_000), measuredGate(replayWarm, 2_000)],
      passed: [replayCold, replayWarm].every((variant) =>
        variant.memoryBounded === true && summarize(variant.samplesNs).p95Ms < 2_000),
    },
    tuiReady: measuredGate(tui, 750),
    localTransportRelay: {
      ...transportGate(transports),
      coverageComplete: true,
      coverageGaps: [],
    },
    clientQueueRelay: { ...measuredGate(queue, 50), roadmapGateEvaluated: true },
    gracefulShutdownStates: {
      ...shutdownGate(shutdownStates),
      coverageComplete: true,
      coverageGaps: [],
    },
    durableShutdownRecovery: { ...measuredGate(shutdown, 2_000), roadmapGateEvaluated: true },
    providerRouterOverhead: { ...router, roadmapGateEvaluated: true },
    storageSoak: { ...soak, passedDiagnostic: soak.correctness.exactCountEveryCycle && soak.databaseGrowthBytes === 0, roadmapGateEvaluated: false, reason: "The external eight-hour storage and mixed-soak records are validated separately." },
  };
  const externalStorageSoak = loadEvidence(options["storage-soak-record"] && path.resolve(root, options["storage-soak-record"]));
  const externalMixedSoak = loadEvidence(options["mixed-soak-record"] && path.resolve(root, options["mixed-soak-record"]));
  const revision = revisionMetadata(cloop);
  const environment = environmentMetadata();
  environment.referenceMachineId = options["reference-machine-id"] ?? null;
  environment.referenceSeries = options["reference-series"] ?? null;
  environment.referenceMachineFingerprintSha256 = referenceMachineFingerprint(environment);
  const runIntegrityEnd = revision;
  const runIntegrityUnchanged = revisionIdentity(runIntegrityStart) === revisionIdentity(runIntegrityEnd);
  const releaseAssessment = assessReleaseEvidence(
    gates, externalStorageSoak, externalMixedSoak, revision.executableSha256,
    {
      releaseProfile: profile === "release",
      referenceMachineId: options["reference-machine-id"],
      referenceSeries: options["reference-series"],
      referenceMachineFingerprintSha256: environment.referenceMachineFingerprintSha256,
      environment,
      storageIdentity: {
        gitRevision: revision.gitRevision,
        cargoLockSha256: revision.cargoLockSha256,
        probeExecutableSha256: sha256(readFileSync(storageProbe)),
        probeSourceSha256: sha256(readFileSync(path.join(
          root, "crates/changeloop-storage/examples/reliability_probe.rs",
        ))),
      },
      mixedIdentity: {
        gitRevision: revision.gitRevision,
        sourceTreeSha256: revision.dirtyTreeDigestSha256,
        cargoLockSha256: revision.cargoLockSha256,
        probeSha256: sha256(readFileSync(queueProbe)),
        runnerSha256: sha256(readFileSync(new URL("./mixed-soak-v2.mjs", import.meta.url))),
      },
    },
  );
  releaseAssessment.evidenceRecords = {
    storage: evidenceMetadata(options["storage-soak-record"]),
    mixed: evidenceMetadata(options["mixed-soak-record"]),
  };
  releaseAssessment.releaseProfile = profile === "release";
  releaseAssessment.runIntegrityUnchanged = runIntegrityUnchanged;
  releaseAssessment.roadmapPerformanceGatesComplete &&= runIntegrityUnchanged;
  releaseAssessment.roadmapPerformanceGatesComplete &&= releaseAssessment.releaseProfile;
  gates.storageSoak.externalEvidence = releaseAssessment.storage;
  gates.storageSoak.roadmapGateEvaluated = releaseAssessment.storage.supplied;
  gates.storageSoak.passed = releaseAssessment.storage.passed;
  gates.mixedResourceSoak = {
    ...releaseAssessment.mixed,
    roadmapGateEvaluated: releaseAssessment.mixed.supplied,
    passed: releaseAssessment.mixed.passed,
  };
  const record = {
    schema: "dev.changeloop.performance-run",
    recordVersion: RECORD_VERSION,
    workloadVersion: WORKLOAD_VERSION,
    evidenceClass: profile === "release" ? "release-candidate-local" : "diagnostic-smoke",
    capturedAt: new Date().toISOString(),
    reproduceCommand: [process.execPath, ...process.argv.slice(1)].join(" "),
    revision,
    integrity: { start: runIntegrityStart, end: runIntegrityEnd, unchanged: runIntegrityUnchanged },
    environment,
    workload: {
      providerModelSnapshot: "not-applicable-hermetic-local",
      pricingCatalogVersion: "not-applicable",
      redactionProfile: "no-provider-credentials",
      runnerSha256: sha256(readFileSync(new URL(import.meta.url))),
      storageProbeSha256: sha256(readFileSync(path.join(root, "crates/changeloop-storage/examples/reliability_probe.rs"))),
      storageProbeExecutableSha256: sha256(readFileSync(storageProbe)),
      queueProbeSha256: sha256(readFileSync(path.join(root, "tests/performance/src/main.rs"))),
      queueProbeExecutableSha256: sha256(readFileSync(queueProbe)),
      mixedSoakRunnerSha256: sha256(readFileSync(new URL("./mixed-soak-v2.mjs", import.meta.url))),
    },
    configuration: { profile, warmCache: true, isolation: "temporary config directory; no provider credentials or network workload", startupWarmups, startupRepetitions, replayWarmups, replayRepetitions, shutdownRepetitions, soakSeconds },
    commands,
    gates,
    releaseAssessment,
    overall: {
      measuredDiagnosticsPassed: startup.every((sample) => sample.correctnessPassed)
        && [replayCold, replayWarm].every((variant) =>
          variant.correctness.exactCount && variant.correctness.exactOrder && variant.memoryBounded)
        && queue.correctness.silentDrops === 0
        && tui.correctness.keyboardResponse === "/status card with ready JSON"
        && transports.correctness.silentDrops === 0 && router.passed
        && shutdownStates.correctness.allTerminal
        && shutdown.correctness.state === "interrupted"
        && soak.correctness.exactCountEveryCycle,
      roadmapPerformanceGatesComplete: releaseAssessment.roadmapPerformanceGatesComplete,
      releaseEvidence: releaseAssessment.roadmapPerformanceGatesComplete,
      note: releaseAssessment.roadmapPerformanceGatesComplete
        ? "All non-soak gates and independently recorded eight-hour storage and mixed-resource soaks passed."
        : "No short smoke, legacy mixed soak, or partial local probe is promoted to GA evidence.",
    },
  };
  const output = path.resolve(root, options.output ?? `target/performance/run-${Date.now()}.json`);
  const validation = validateRunRecord(record, {
    storageRecord: externalStorageSoak, mixedRecord: externalMixedSoak,
  });
  if (!validation.passed) fail(`generated performance record failed validation: ${JSON.stringify({ checks: validation.checks, integrity: record.integrity })}`);
  publishJsonAtomic(output, record);
  console.log(JSON.stringify({
    output,
    cliStartupP95Ms: Object.fromEntries(startup.map((sample) => [sample.name, sample.summary.p95Ms])),
    tuiReadyP95Ms: measuredGate(tui, 750).summary.p95Ms,
    replay10kP95Ms: Object.fromEntries([replayCold, replayWarm]
      .map((variant) => [variant.cacheVariant, summarize(variant.samplesNs).p95Ms])),
    transportRelayP95Ms: Object.fromEntries(transportGate(transports).transports.map((item) => [
      item.transport,
      Object.fromEntries(item.variants.map((variant) => [variant.variant, variant.summary.p95Ms])),
    ])),
    queueRelayP95Ms: measuredGate(queue, 50).summary.p95Ms,
    routerOverheadRatio: router.aggregateOverheadRatio,
    shutdownP95Ms: Object.fromEntries(shutdownGate(shutdownStates).states.map((item) => [item.state, item.summary.p95Ms])),
    shutdownRecoveryP95Ms: measuredGate(shutdown, 2_000).summary.p95Ms,
    soakCycles: soak.cycles,
    soakSeconds,
    measuredDiagnosticsPassed: record.overall.measuredDiagnosticsPassed,
    roadmapPerformanceGatesComplete: record.overall.roadmapPerformanceGatesComplete,
  }, null, 2));
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

function parseOptions(arguments_) {
  const parsed = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith("--")) fail(`unexpected argument: ${argument}`);
    const name = argument.slice(2);
    if (name === "skip-build" || name === "confirm-8h") parsed[name] = true;
    else {
      const value = arguments_[index + 1];
      if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
      parsed[name] = value;
      index += 1;
    }
  }
  if (parsed.mode && !["smoke", "release"].includes(parsed.mode)) fail("--mode must be smoke or release");
  return parsed;
}

function numberOption(parsed, name, fallback) {
  const value = parsed[name] === undefined ? fallback : Number(parsed[name]);
  if (!Number.isSafeInteger(value) || value <= 0) fail(`--${name} must be a positive integer`);
  return value;
}

function measureCommand(name, executable, arguments_, cwd, warmups, repetitions, oracle) {
  for (let index = 0; index < warmups; index += 1) execute(executable, arguments_, cwd);
  const samplesNs = [];
  const observations = [];
  let correctnessPassed = true;
  for (let index = 0; index < repetitions; index += 1) {
    const started = process.hrtime.bigint();
    const result = execute(executable, arguments_, cwd);
    const durationNs = Number(process.hrtime.bigint() - started);
    const correct = oracle(result);
    observations.push({ durationNs, exitStatus: result.status, correct });
    if (correct) samplesNs.push(durationNs);
    correctnessPassed &&= correct;
  }
  return { name, warmups, repetitions, observations, samplesNs, failureCount: observations.filter((sample) => !sample.correct).length, correctnessPassed, summary: summarize(samplesNs) };
}

function probeJson(executable, arguments_) {
  const result = execute(executable, arguments_, root, 128 * 1024 * 1024);
  if (result.status !== 0) fail(`${executable} failed: ${result.stderr}`);
  try { return JSON.parse(result.stdout); }
  catch (error) { fail(`${executable} emitted invalid JSON: ${error.message}`); }
}

function measuredGate(probe, thresholdMs) {
  const summary = summarize(probe.samplesNs);
  return { ...probe, thresholdMs, summary, passed: summary.p95Ms < thresholdMs };
}

function transportGate(probe) {
  const transports = probe.transports.map((item) => {
    const variants = item.variants.map((variant) => ({
      ...variant,
      summary: summarize(variant.samplesNs),
      passed: variant.silentDrops === 0 && variant.ordered === true
        && variant.backpressureObserved === true
        && variant.maxQueueDepth > 0 && variant.maxQueueDepth <= variant.queueCapacity
        && summarize(variant.samplesNs).p95Ms < 50,
    }));
    return { ...item, variants, passed: variants.every((variant) => variant.passed) };
  });
  return { ...probe, thresholdMs: 50, transports, passed: transports.every((item) => item.passed), roadmapGateEvaluated: true };
}

function shutdownGate(probe) {
  const states = probe.states.map((item) => ({ ...item, summary: summarize(item.samplesNs), passed: item.terminal && summarize(item.samplesNs).p95Ms < 2_000 }));
  return { ...probe, states, passed: states.every((item) => item.passed), roadmapGateEvaluated: true };
}

function summarize(samplesNs) {
  const sorted = [...samplesNs].sort((left, right) => left - right);
  if (sorted.length === 0) return { validSamples: 0, medianMs: null, p95Ms: null, p99Ms: null };
  const percentile = (ratio) => sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] / 1e6;
  return { validSamples: sorted.length, medianMs: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99) };
}

function execute(executable, arguments_, cwd = root, maxBuffer = 16 * 1024 * 1024) {
  commands.push([executable, ...arguments_].join(" "));
  return spawnSync(executable, arguments_, { cwd, encoding: "utf8", maxBuffer });
}

function run(executable, arguments_, extraEnvironment = {}) {
  const result = spawnSync(executable, arguments_, { cwd: root, encoding: "utf8", stdio: "inherit", env: { ...process.env, ...extraEnvironment } });
  commands.push([executable, ...arguments_].join(" "));
  if (result.status !== 0) fail(`${executable} exited with ${result.status}`);
}

function revisionMetadata(executable) {
  const dirtyState = capture("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  const executablePath = path.relative(root, executable).split(path.sep).join("/");
  const buildProfile = executablePath.startsWith("target/release/") ? "release"
    : executablePath.startsWith("target/debug/") ? "debug" : "external";
  return { gitRevision: capture("git", ["rev-parse", "HEAD"]), dirty: dirtyState.length > 0, dirtyTreeDigestSha256: dirtyDigest(), cargoLockSha256: sha256(readFileSync(path.join(root, "Cargo.lock"))), executableSha256: sha256(readFileSync(executable)), executablePath, rustc: capture("rustc", ["-Vv"]), node: process.version, buildProfile, featureFlags: [], protocolVersion: "captured-by-probe-envelope", databaseSchemaVersion: 1 };
}

function revisionIdentity(revision) {
  return JSON.stringify({
    gitRevision: revision.gitRevision,
    dirtyTreeDigestSha256: revision.dirtyTreeDigestSha256,
    cargoLockSha256: revision.cargoLockSha256,
    executableSha256: revision.executableSha256,
  });
}

function dirtyDigest() {
  return sourceTreeSha256(root);
}

function environmentMetadata() {
  return { os: os.platform(), kernel: os.release(), architecture: os.arch(), cpuModel: os.cpus()[0]?.model ?? "unknown", logicalCpuCount: os.cpus().length, physicalMemoryBytes: os.totalmem(), filesystemType: filesystemType(), executionEnvironment: process.env.CI ? "ci" : "unclassified-local", powerMode: "unavailable", thermalState: "unavailable" };
}

function filesystemType() {
  const darwin = spawnSync("stat", ["-f", "%T", root], { encoding: "utf8" });
  if (darwin.status === 0) return darwin.stdout.trim();
  const linux = spawnSync("stat", ["-f", "-c", "%T", root], { encoding: "utf8" });
  return linux.status === 0 ? linux.stdout.trim() : "unavailable";
}

function capture(executable, arguments_) {
  const result = spawnSync(executable, arguments_, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unavailable";
}

function evidenceMetadata(relative) {
  if (!relative) return null;
  const absolute = path.resolve(root, relative);
  return { path: path.relative(root, absolute), sha256: sha256(readFileSync(absolute)) };
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function fail(message) { console.error(message); process.exit(2); }
