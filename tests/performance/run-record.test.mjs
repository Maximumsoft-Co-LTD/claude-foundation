import assert from "node:assert/strict";
import {
  closeSync, ftruncateSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  assessMixedSoak, assessNonSoakGates, assessReleaseEvidence, assessStorageSoak,
  loadEvidence, referenceMachineFingerprint, REQUIRED_MIXED_WORKLOADS,
  REQUIRED_ROUTER_CASES, validateRunRecord,
} from "../../scripts/performance/release-evidence.mjs";
import { publishJsonAtomic } from "../../scripts/performance/atomic-record.mjs";
import {
  SOURCE_TREE_LIMITS, sourceTreeSha256, splitNullInventory,
} from "../../scripts/performance/source-tree-integrity.mjs";
import { detectSoakProcesses, parseProcessTable } from "../../scripts/performance/process-status.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const hash = (character) => character.repeat(64);
const revision = "e".repeat(40);
const samples = (count, value = 1_000_000) => Array.from({ length: count }, () => value);
const validEnvironment = () => ({
  os: "darwin", kernel: "25.0", architecture: "arm64", cpuModel: "Test CPU",
  logicalCpuCount: 8, physicalMemoryBytes: 16_000_000_000, filesystemType: "apfs",
});

function validGates() {
  const observation = { correct: true, exitStatus: 0, durationNs: 1_000_000 };
  const startup = (name) => ({
    name, correctnessPassed: true, failureCount: 0, warmups: 5, repetitions: 30,
    observations: Array.from({ length: 30 }, () => ({ ...observation })),
    samplesNs: samples(30),
  });
  const transport = (name) => ({
    transport: name,
    variants: ["idle", "steady_concurrency"].map((variant) => ({
      variant, delivered: 10_000, ordered: true, silentDrops: 0,
      maxQueueDepth: 1_024, queueCapacity: 2_048,
      backpressureObserved: true,
      concurrency: variant === "idle" ? 1 : 4,
      samplesNs: samples(10_000),
    })),
  });
  const state = (name) => ({ state: name, terminal: true, samplesNs: samples(20) });
  const routerCase = (caseId) => ({
    caseId,
    provider: caseId.startsWith("openai-") ? "openai" : "anthropic",
    scenario: ({ short: "short_response", long: "long_response", tool: "tool_call",
      large: "large_payload", non: "non_streaming" })[caseId.split("-")[1]],
    delivery: caseId.endsWith("non-streaming") ? "non_streaming" : "streaming",
    supported: true, repetitions: 30,
    directSamplesNs: samples(30, 1_000_000),
    routedSamplesNs: samples(30, 1_010_000),
    aggregateOverheadRatio: 0.01,
    correctness: { identicalProviderEvents: true, attempts: 1 },
  });
  const routerCases = REQUIRED_ROUTER_CASES.map(routerCase);
  return {
    cliStartup: { samples: [startup("help"), startup("status")], passed: true },
    eventReplay10k: {
      coverageComplete: true, coverageGaps: [],
      variants: [
        { cacheVariant: "process-reopen-cold", eventCount: 10_000, warmups: 0 },
        { cacheVariant: "process-reopen-warm", eventCount: 10_000, warmups: 5 },
      ].map((variant) => ({
        ...variant, repetitions: 20, samplesNs: samples(20),
        memorySamplesKiB: samples(20, 1_024), maxRssGrowthKiB: 1_024,
        memoryLimitKiB: 65_536, memoryBounded: true,
        correctness: { exactCount: true, exactOrder: true, duplicates: 0 },
      })),
    },
    tuiReady: {
      samplesNs: samples(30), passed: true, warmups: 5,
      observations: Array.from({ length: 30 }, () => ({
        ready: true, statusReady: true, quitSent: true, exitStatus: 0, durationNs: 1_000_000,
      })),
      correctness: { completeFrame: true, cleanQuit: true, noProviderGuidance: true, keyboardResponse: "/status card with ready JSON" },
    },
    localTransportRelay: {
      eventCountPerTransport: 10_000, passed: true, coverageComplete: true, coverageGaps: [],
      correctness: { exactCount: true, exactOrder: true, silentDrops: 0 },
      transports: [transport("stdio"), transport("unix"), transport("http_sse")],
    },
    clientQueueRelay: {
      events: 10_000, capacity: 1_024, samplesNs: samples(10_000), passed: true,
      correctness: { delivered: 10_000, ordered: true, silentDrops: 0, backpressureSignalsDisconnect: true },
    },
    gracefulShutdownStates: {
      passed: true, correctness: { allTerminal: true, forcedCleanupTimeouts: 0 },
      coverageComplete: true, coverageGaps: [],
      states: [
        "idle", "streaming-provider-mock", "child-agent-resources", "pty-and-background-jobs",
        "project-owned-lsp", "backpressured-client",
      ].map(state),
    },
    durableShutdownRecovery: {
      repetitions: 20, samplesNs: samples(20), passed: true,
      correctness: { state: "interrupted", terminalMarkersPerOperation: 1 },
    },
    providerRouterOverhead: {
      recordVersion: 2, workloadVersion: "dual-provider-router-matrix-v2",
      fixtureScope: "bounded hermetic adapter/router comparison; not upstream provider performance",
      coverageComplete: true, coverageGaps: [], releaseEligible: true,
      cases: routerCases,
      directSamplesNs: routerCases.flatMap((item) => item.directSamplesNs),
      routedSamplesNs: routerCases.flatMap((item) => item.routedSamplesNs),
      aggregateOverheadRatio: 0.01, retryBackoffNs: 0, passed: true,
      correctness: { identicalProviderEvents: true, attempts: 1 },
    },
  };
}

function validStorage() {
  const snapshot = {
    probeExecutableSha256: hash("a"), probeSourceSha256: hash("b"),
    cargoLockSha256: hash("c"), gitRevision: revision, sourceTreeSha256: hash("d"),
  };
  return {
    recordVersion: 2, probe: "storage-replay-soak", workloadVersion: "storage-soak-v2",
    requestedDurationSeconds: 28_800, elapsedNs: 28_800e9, cycles: 100,
    startedUnixMs: 1_000, finishedUnixMs: 28_801_000,
    eventsPerCycle: 1_000, initialDatabaseBytes: 4_096, finalDatabaseBytes: 4_096,
    databaseGrowthBytes: 0, releaseEligible: true, interrupted: false,
    correctness: { exactCountEveryCycle: true },
    integrity: { unchanged: true, start: snapshot, end: { ...snapshot } },
  };
}

function validMixed() {
  const snapshot = {
    cloopSha256: hash("a"), probeSha256: hash("b"), cargoLockSha256: hash("c"),
    runnerSha256: hash("d"), gitRevision: revision, sourceTreeSha256: hash("e"),
  };
  return {
    schema: "dev.changeloop.mixed-resource-soak", recordVersion: 2,
    workloadVersion: "mixed-resource-soak-v2", mode: "soak", requestedDurationSeconds: 28_800,
    elapsedSeconds: 28_800, cycles: 100, failures: { total: 0, observations: [] },
    startedAt: "2026-08-04T00:00:00.000Z", finishedAt: "2026-08-04T08:00:00.000Z",
    releaseEligible: true,
    workloadRuns: Object.fromEntries(REQUIRED_MIXED_WORKLOADS.map((name) => [name, 100])),
    successfulWorkloadRuns: Object.fromEntries(
      REQUIRED_MIXED_WORKLOADS.map((name) => [name, 100]),
    ),
    resources: {
      limits: {
        maxProcessTreeRssKiB: 100, maxProcessFileDescriptors: 20,
        maxFixtureGrowthKiB: 4, maxRssSlopeKiBPerCycle: 1,
        maxFileDescriptorSlopePerCycle: 1,
      },
      maxProcessTreeRssKiB: 90, maxProcessFileDescriptors: 10, resourceSamples: 500,
      baselineFixtureDiskKiB: 4, finalFixtureDiskKiB: 4, fixtureGrowthKiB: 0,
      rssSlopeKiBPerCycle: 0, fileDescriptorSlopePerCycle: 0,
      samples: Array.from({ length: 100 }, (_, index) => ({
        cycle: index + 1, elapsedSeconds: index, rssKiB: 90,
        fileDescriptors: 10, fixtureDiskKiB: 4,
        workloadOutcomes: REQUIRED_MIXED_WORKLOADS.map((name) => ({
          name, passed: true, exitStatus: 0, timedOut: false, outputOverflow: false,
          durationNs: 1_000_000,
        })),
      })),
    },
    orphanProcessGroups: [], interrupted: false,
    integrity: { unchanged: true, start: snapshot, end: { ...snapshot } },
    correctness: {
      coverageComplete: true, allWorkloadsPassed: true, rssWithinLimit: true,
      fileDescriptorsWithinLimit: true, boundedFixtureGrowth: true,
      noOrphanProcesses: true, resourceSamplingComplete: true,
      resourceTrendEvaluated: true,
      stableResourceTrend: true,
      coverageGaps: [],
    },
  };
}

test("smoke runner writes a truthful versioned record with raw samples", () => {
  const output = path.join(os.tmpdir(), `changeloop-performance-test-${process.pid}.json`);
  try {
    const result = spawnSync(process.execPath, [
      "scripts/performance/run.mjs", "--mode", "smoke", "--skip-build",
      "--startup-repetitions", "2", "--replay-repetitions", "1",
      "--shutdown-repetitions", "1", "--soak-seconds", "1", "--output", output,
    ], { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const record = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(record.schema, "dev.changeloop.performance-run");
    assert.equal(record.recordVersion, 2);
    assert.equal(record.evidenceClass, "diagnostic-smoke");
    assert.equal(record.gates.cliStartup.samples[0].samplesNs.length, 2);
    assert.equal(record.gates.cliStartup.samples[0].observations.length, 2);
    assert.equal(record.gates.cliStartup.samples[0].failureCount, 0);
    assert.equal(record.gates.eventReplay10k.variants[0].eventCount, 10_000);
    assert.equal(record.gates.eventReplay10k.variants[0].correctness.exactOrder, true);
    assert.equal(record.gates.eventReplay10k.coverageComplete, true);
    assert.equal(record.gates.eventReplay10k.variants[0].cacheVariant, "process-reopen-cold");
    assert.equal(record.gates.eventReplay10k.variants[0].memoryBounded, true);
    assert.equal(record.gates.clientQueueRelay.correctness.silentDrops, 0);
    assert.equal(record.gates.clientQueueRelay.roadmapGateEvaluated, true);
    assert.equal(record.gates.tuiReady.correctness.keyboardResponse, "/status card with ready JSON");
    assert.equal(record.gates.localTransportRelay.correctness.silentDrops, 0);
    assert.equal(record.gates.localTransportRelay.coverageComplete, true);
    assert.equal(record.gates.localTransportRelay.transports[0].variants[1].concurrency, 4);
    assert.equal(record.gates.localTransportRelay.transports[0].variants[1].backpressureObserved, true);
    assert.equal(record.gates.gracefulShutdownStates.correctness.allTerminal, true);
    assert.equal(record.gates.gracefulShutdownStates.coverageComplete, true);
    assert.ok(record.gates.gracefulShutdownStates.states.some((state) => state.state === "idle"));
    assert.equal(record.gates.providerRouterOverhead.passed, true);
    assert.equal(record.gates.durableShutdownRecovery.correctness.state, "interrupted");
    assert.equal(record.gates.storageSoak.releaseEligible, false);
    assert.equal(record.gates.storageSoak.roadmapGateEvaluated, false);
    assert.equal(record.gates.mixedResourceSoak.passed, false);
    assert.equal(record.overall.roadmapPerformanceGatesComplete, false);
    assert.equal(record.overall.releaseEvidence, false);
  } finally {
    rmSync(output, { force: true });
  }
});

test("mixed-soak integration mode repeats every semantic workload for three cycles", () => {
  const output = path.join(os.tmpdir(), `changeloop-mixed-integration-${process.pid}.json`);
  try {
    const result = spawnSync(process.execPath, [
      "scripts/performance/mixed-soak-v2.mjs", "--integration-cycles", "3", output,
    ], { cwd: root, encoding: "utf8", timeout: 120_000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const record = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(record.mode, "integration");
    assert.equal(record.cycles, 3);
    assert.deepEqual(record.correctness.coverageGaps, []);
    for (const name of REQUIRED_MIXED_WORKLOADS) {
      assert.equal(record.workloadRuns[name], 3, name);
      assert.equal(record.successfulWorkloadRuns[name], 3, name);
    }
    assert.equal(record.correctness.coverageComplete, true);
    assert.equal(record.correctness.allWorkloadsPassed, true);
    const relayOutcomes = record.resources.samples.map((sample) =>
      sample.workloadOutcomes.find((outcome) => outcome.name === "relay"));
    assert.equal(relayOutcomes.length, 3);
    assert.ok(relayOutcomes.every((outcome) => outcome?.passed === true
      && outcome.outputOverflow === false));
    assert.equal(record.correctness.noOrphanProcesses, true);
    assert.equal(record.correctness.resourceTrendEvaluated, false);
    assert.equal(record.correctness.stableResourceTrend, null);
    assert.equal(record.integrationContractPassed, true);
    assert.equal(record.releaseEligible, false);
    assert.equal(assessMixedSoak(record).passed, false);
  } finally {
    rmSync(output, { force: true });
  }
});

test("performance records publish atomically and truncated evidence is rejected", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "changeloop-atomic-record-"));
  try {
    const output = path.join(directory, "record.json");
    publishJsonAtomic(output, { version: 1, complete: true });
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), { version: 1, complete: true });
    assert.equal(readdirSync(directory).some((name) => name.includes(".stage-")), false);
    if (process.platform !== "win32") assert.equal(statSync(output).mode & 0o777, 0o600);

    const truncated = path.join(directory, "truncated.json");
    writeFileSync(truncated, '{"schema":"dev.changeloop.mixed-resource-soak"');
    const loaded = loadEvidence(truncated);
    assert.match(loaded.evidenceLoadError, /truncated/);
    assert.equal(assessMixedSoak(loaded).passed, false);
    assert.equal(assessStorageSoak(loaded).passed, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("source integrity streams bytes, hashes non-UTF8 paths, rejects sparse excess, and never follows symlinks", {
  skip: process.platform === "win32",
}, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "changeloop-source-integrity-"));
  const outside = mkdtempSync(path.join(os.tmpdir(), "changeloop-source-outside-"));
  try {
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: directory }).status, 0);
    writeFileSync(path.join(directory, "regular.txt"), "regular");
    const outsideFile = path.join(outside, "secret.txt");
    writeFileSync(outsideFile, "secret-one");
    symlinkSync(outsideFile, path.join(directory, "outside-link"));
    const rawNonUtf8 = Buffer.from([0xff, 0x2e, 0x74]);
    assert.deepEqual(splitNullInventory(Buffer.concat([rawNonUtf8, Buffer.from([0])])), [rawNonUtf8]);
    const nonUtf8 = Buffer.concat([Buffer.from(`${directory}/`), rawNonUtf8]);
    if (process.platform === "linux") writeFileSync(nonUtf8, "non-utf8-one");

    const first = sourceTreeSha256(directory);
    writeFileSync(outsideFile, "secret-two");
    assert.equal(sourceTreeSha256(directory), first, "symlink target content must not be followed");
    if (process.platform === "linux") {
      writeFileSync(nonUtf8, "non-utf8-two");
      assert.notEqual(sourceTreeSha256(directory), first, "non-UTF8 file bytes must affect identity");
    } else {
      writeFileSync(path.join(directory, "regular.txt"), "changed");
      assert.notEqual(sourceTreeSha256(directory), first);
    }
    assert.throws(
      () => sourceTreeSha256(directory, { ...SOURCE_TREE_LIMITS, maxTotalBytes: 5 }),
      /total bytes/,
    );
    assert.throws(
      () => sourceTreeSha256(directory, { ...SOURCE_TREE_LIMITS, maxEntries: 0 }),
      /entries/,
    );

    const sparse = path.join(directory, "oversized-sparse.bin");
    const descriptor = openSync(sparse, "wx", 0o600);
    ftruncateSync(descriptor, SOURCE_TREE_LIMITS.maxFileBytes + 1);
    closeSync(descriptor);
    assert.throws(() => sourceTreeSha256(directory), /source file exceeds/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("release assessment requires both distinct eight-hour soak records", () => {
  const gates = validGates();
  const storage = validStorage();
  const mixed = validMixed();
  const environment = validEnvironment();
  const context = {
    releaseProfile: true, referenceMachineId: "reference-mac",
    referenceSeries: "macos-arm64-v1", environment,
    referenceMachineFingerprintSha256: referenceMachineFingerprint(environment),
    storageIdentity: { ...storage.integrity.end }, mixedIdentity: { ...mixed.integrity.end },
  };
  const assess = (storageRecord, mixedRecord, override = context) =>
    assessReleaseEvidence(gates, storageRecord, mixedRecord, undefined, override);
  const complete = assess(storage, mixed);
  assert.equal(complete.roadmapPerformanceGatesComplete, true);
  assert.deepEqual(complete.referenceMachine, {
    passed: true, machineId: "reference-mac", seriesId: "macos-arm64-v1", reason: null,
    fingerprintSha256: referenceMachineFingerprint(environment),
  });
  assert.equal(assess(storage, null).roadmapPerformanceGatesComplete, false);
  assert.equal(assess(storage, { ...mixed, recordVersion: 1 }).roadmapPerformanceGatesComplete, false);
  assert.equal(assess({ ...storage, requestedDurationSeconds: 60 }, mixed).roadmapPerformanceGatesComplete, false);
  assert.equal(assess(storage, { ...mixed, cycles: 1 }).roadmapPerformanceGatesComplete, false);
  assert.equal(assess(storage, {
    ...mixed,
    resources: { ...mixed.resources, maxProcessTreeRssKiB: 101 },
  }).roadmapPerformanceGatesComplete, false);
  assert.equal(assess(storage, {
    ...mixed,
    integrity: undefined,
  }).roadmapPerformanceGatesComplete, false);
  assert.equal(assess(storage, mixed, {}).roadmapPerformanceGatesComplete, false);
});

test("pre-freeze soak records are rejected when source or release binaries differ", () => {
  const storage = validStorage();
  const mixed = validMixed();
  assert.equal(assessStorageSoak(storage, {
    ...storage.integrity.end, probeExecutableSha256: hash("f"),
  }).checks.provenanceBinding, false);
  assert.equal(assessMixedSoak(mixed, {
    ...mixed.integrity.end, sourceTreeSha256: hash("f"),
  }).checks.provenanceBinding, false);

  const environment = validEnvironment();
  const assessment = assessReleaseEvidence(validGates(), storage, mixed, undefined, {
    releaseProfile: true, referenceMachineId: "reference-mac",
    referenceSeries: "macos-arm64-v1", environment,
    referenceMachineFingerprintSha256: hash("f"),
    storageIdentity: storage.integrity.end, mixedIdentity: mixed.integrity.end,
  });
  assert.equal(assessment.referenceMachine.passed, false);
  assert.equal(assessment.roadmapPerformanceGatesComplete, false);
});

test("release verifier recomputes p95 and rejects incomplete self-reported gates", () => {
  assert.equal(assessNonSoakGates(Object.fromEntries([
    "cliStartup", "eventReplay10k", "tuiReady", "localTransportRelay",
    "clientQueueRelay", "gracefulShutdownStates", "durableShutdownRecovery",
    "providerRouterOverhead",
  ].map((name) => [name, { passed: true }]))).passed, false);

  const gates = validGates();
  gates.cliStartup.samples[0].samplesNs.splice(28, 2, 300_000_000, 300_000_000);
  gates.cliStartup.samples[0].summary = { p95Ms: 1 };
  assert.equal(assessNonSoakGates(gates).checks.cliStartup, false);
  assert.equal(assessNonSoakGates(validGates()).passed, true);
});

test("router overhead gate rejects missing, unsupported, duplicated, and forged matrix cases", () => {
  const missing = validGates();
  missing.providerRouterOverhead.cases.pop();
  assert.equal(assessNonSoakGates(missing).checks.providerRouterOverhead, false);

  const unsupported = validGates();
  unsupported.providerRouterOverhead.cases[0].supported = false;
  unsupported.providerRouterOverhead.coverageComplete = true;
  assert.equal(assessNonSoakGates(unsupported).checks.providerRouterOverhead, false);

  const duplicated = validGates();
  duplicated.providerRouterOverhead.cases[9] = {
    ...duplicated.providerRouterOverhead.cases[8],
  };
  assert.equal(assessNonSoakGates(duplicated).checks.providerRouterOverhead, false);

  const forgedRatio = validGates();
  forgedRatio.providerRouterOverhead.cases[0].routedSamplesNs = samples(30, 1_100_000);
  forgedRatio.providerRouterOverhead.cases[0].aggregateOverheadRatio = 0.01;
  assert.equal(assessNonSoakGates(forgedRatio).checks.providerRouterOverhead, false);

  const upstreamClaim = validGates();
  upstreamClaim.providerRouterOverhead.fixtureScope = "upstream provider benchmark";
  assert.equal(assessNonSoakGates(upstreamClaim).checks.providerRouterOverhead, false);

  const mislabeledScenario = validGates();
  mislabeledScenario.providerRouterOverhead.cases[0].scenario = "large_payload";
  assert.equal(assessNonSoakGates(mislabeledScenario).checks.providerRouterOverhead, false);

  const unrelatedAggregate = validGates();
  unrelatedAggregate.providerRouterOverhead.directSamplesNs[0] = 2_000_000;
  unrelatedAggregate.providerRouterOverhead.routedSamplesNs[0] = 2_020_000;
  assert.equal(assessNonSoakGates(unrelatedAggregate).checks.providerRouterOverhead, false);
});

test("non-soak release gates reject missing warmups, variants, memory, concurrency, and idle shutdown", () => {
  const cli = validGates();
  cli.cliStartup.samples[0].warmups = 4;
  assert.equal(assessNonSoakGates(cli).checks.cliStartup, false);

  const tui = validGates();
  tui.tuiReady.warmups = 4;
  assert.equal(assessNonSoakGates(tui).checks.tuiReady, false);

  const cold = validGates();
  cold.eventReplay10k.variants.shift();
  assert.equal(assessNonSoakGates(cold).checks.eventReplay10k, false);
  const memory = validGates();
  memory.eventReplay10k.variants[0].memoryBounded = false;
  assert.equal(assessNonSoakGates(memory).checks.eventReplay10k, false);
  const forgedMemory = validGates();
  forgedMemory.eventReplay10k.variants[0].maxRssGrowthKiB = 70_000;
  assert.equal(assessNonSoakGates(forgedMemory).checks.eventReplay10k, false);

  const concurrency = validGates();
  concurrency.localTransportRelay.transports[0].variants.pop();
  assert.equal(assessNonSoakGates(concurrency).checks.localTransportRelay, false);
  const queueDepth = validGates();
  queueDepth.localTransportRelay.transports[0].variants[0].maxQueueDepth = 2_049;
  assert.equal(assessNonSoakGates(queueDepth).checks.localTransportRelay, false);
  const forgedConcurrency = validGates();
  forgedConcurrency.localTransportRelay.transports[0].variants[1].concurrency = 1;
  assert.equal(assessNonSoakGates(forgedConcurrency).checks.localTransportRelay, false);
  const missingBackpressure = validGates();
  delete missingBackpressure.localTransportRelay.transports[0].variants[1].backpressureObserved;
  assert.equal(assessNonSoakGates(missingBackpressure).checks.localTransportRelay, false);

  const idle = validGates();
  idle.gracefulShutdownStates.states = idle.gracefulShutdownStates.states
    .filter((state) => state.state !== "idle");
  assert.equal(assessNonSoakGates(idle).checks.gracefulShutdownStates, false);
});

test("performance schema binds router release eligibility to the complete hermetic matrix", () => {
  const schema = JSON.parse(readFileSync(
    path.join(root, "tests/performance/run-record.schema.json"), "utf8",
  ));
  const router = schema.properties.gates.properties.providerRouterOverhead;
  assert.equal(
    router.properties.fixtureScope.const,
    "bounded hermetic adapter/router comparison; not upstream provider performance",
  );
  const release = router.allOf.find((item) =>
    item?.if?.properties?.releaseEligible?.const === true).then.properties;
  assert.equal(release.coverageComplete.const, true);
  assert.equal(release.coverageGaps.maxItems, 0);
  assert.equal(release.cases.minItems, REQUIRED_ROUTER_CASES.length);
  assert.equal(release.cases.maxItems, REQUIRED_ROUTER_CASES.length);
  const schemaCaseIds = release.cases.allOf.map((item) =>
    item.contains.properties.caseId.const);
  assert.deepEqual([...schemaCaseIds].sort(), [...REQUIRED_ROUTER_CASES].sort());
  assert.equal(release.cases.items.properties.supported.const, true);
  assert.equal(release.cases.items.properties.repetitions.const, 30);
});

test("performance schema binds every initial gate and reference machine for release evidence", () => {
  const schema = JSON.parse(readFileSync(
    path.join(root, "tests/performance/run-record.schema.json"), "utf8",
  ));
  const release = schema.allOf.find((item) =>
    item?.if?.properties?.evidenceClass?.const === "release-candidate-local").then.properties;
  assert.deepEqual(release.environment.required, [
    "referenceMachineId", "referenceSeries", "referenceMachineFingerprintSha256",
  ]);
  assert.equal(release.revision.properties.dirty.const, false);
  assert.equal(release.revision.properties.buildProfile.const, "release");
  assert.equal(release.revision.properties.executablePath.const, "target/release/cloop");
  assert.equal(release.releaseAssessment.properties.referenceMachine.properties.passed.const, true);
  assert.deepEqual(
    release.releaseAssessment.properties.referenceMachine.required,
    ["passed", "machineId", "seriesId", "fingerprintSha256"],
  );
  const gates = release.gates.properties;
  assert.equal(gates.cliStartup.properties.samples.minItems, 2);
  assert.equal(gates.cliStartup.properties.samples.items.properties.warmups.minimum, 5);
  assert.equal(gates.tuiReady.properties.observations.minItems, 30);
  assert.equal(gates.eventReplay10k.properties.coverageComplete.const, true);
  assert.equal(gates.eventReplay10k.properties.variants.minItems, 2);
  assert.deepEqual(
    gates.eventReplay10k.properties.variants.allOf.map((rule) =>
      rule.contains.properties.cacheVariant.const),
    ["process-reopen-cold", "process-reopen-warm"],
  );
  assert.equal(gates.localTransportRelay.properties.transports.minItems, 3);
  assert.equal(gates.localTransportRelay.properties.transports.items.properties.variants.minItems, 2);
  assert.deepEqual(
    gates.localTransportRelay.properties.transports.allOf.map((rule) =>
      rule.contains.properties.transport.const),
    ["stdio", "unix", "http_sse"],
  );
  assert.equal(gates.gracefulShutdownStates.properties.states.minItems, 6);
  assert.equal(gates.gracefulShutdownStates.properties.states.allOf.length, 6);
});

test("soak verifier rejects coercible units, interruption, missing samples, and tampered freeze", () => {
  assert.equal(assessStorageSoak({ ...validStorage(), elapsedNs: String(28_800e9) }).passed, false);
  assert.equal(assessStorageSoak({ ...validStorage(), finishedUnixMs: 2_000 }).passed, false);
  assert.equal(assessStorageSoak({ ...validStorage(), interrupted: true }).passed, false);
  assert.equal(assessStorageSoak({ ...validStorage(), integrity: undefined }).passed, false);

  const noSamples = validMixed();
  noSamples.resources.samples = [];
  assert.equal(assessMixedSoak(noSamples).passed, false);
  const unevaluatedTrend = validMixed();
  unevaluatedTrend.correctness.resourceTrendEvaluated = false;
  unevaluatedTrend.correctness.stableResourceTrend = null;
  assert.equal(assessMixedSoak(unevaluatedTrend).checks.boundedResources, false);
  const interrupted = validMixed();
  interrupted.interrupted = true;
  assert.equal(assessMixedSoak(interrupted).passed, false);
  const falseDuration = validMixed();
  falseDuration.finishedAt = "2026-08-04T00:01:00.000Z";
  assert.equal(assessMixedSoak(falseDuration).passed, false);
  const orphan = validMixed();
  orphan.orphanProcessGroups.push({ pgid: 123, pids: [124] });
  assert.equal(assessMixedSoak(orphan).passed, false);
  const tampered = validMixed();
  tampered.integrity.end.sourceTreeSha256 = hash("f");
  assert.equal(assessMixedSoak(tampered).passed, false);
  assert.equal(assessMixedSoak(validMixed(), hash("f")).passed, false);
});

test("mixed soak rejects synthetic-only and self-reported workload coverage", () => {
  const syntheticOnly = validMixed();
  syntheticOnly.workloadRuns = {
    queue: 100, relay: 100, router: 100, shutdown: 100, status: 100,
  };
  syntheticOnly.successfulWorkloadRuns = { ...syntheticOnly.workloadRuns };
  assert.equal(assessMixedSoak(syntheticOnly).checks.requiredWorkloadCoverage, false);
  assert.match(assessMixedSoak(syntheticOnly).reasons.join("\n"), /readOnlyConversations/);

  const attemptedButFailed = validMixed();
  attemptedButFailed.successfulWorkloadRuns.jobs = 99;
  assert.equal(assessMixedSoak(attemptedButFailed).passed, false);

  const claimedCompleteWithGap = validMixed();
  claimedCompleteWithGap.correctness.coverageGaps = ["projectCreateDispose"];
  assert.equal(assessMixedSoak(claimedCompleteWithGap).checks.workloadCoverage, false);

  const mutableSource = validMixed();
  mutableSource.integrity.unchanged = true;
  mutableSource.integrity.end.runnerSha256 = hash("f");
  assert.equal(assessMixedSoak(mutableSource).checks.binaryIntegrity, false);

  const aggregateOnly = validMixed();
  delete aggregateOnly.resources.samples[0].workloadOutcomes;
  assert.equal(assessMixedSoak(aggregateOnly).checks.boundedResources, false);

  const duplicated = validMixed();
  duplicated.resources.samples[0].workloadOutcomes[10] = {
    ...duplicated.resources.samples[0].workloadOutcomes[0],
  };
  assert.equal(assessMixedSoak(duplicated).checks.boundedResources, false);
});

test("mixed soak schema binds release eligibility to complete workload coverage", () => {
  const schema = JSON.parse(readFileSync(
    path.join(root, "tests/performance/mixed-soak.schema.json"), "utf8",
  ));
  assert.equal(schema.required.includes("successfulWorkloadRuns"), true);
  assert.deepEqual(
    [...schema.properties.workloadRuns.required].sort(),
    [...REQUIRED_MIXED_WORKLOADS].sort(),
  );
  assert.deepEqual(
    [...schema.properties.successfulWorkloadRuns.required].sort(),
    [...REQUIRED_MIXED_WORKLOADS].sort(),
  );
  const releaseConstraint = schema.allOf.find((item) =>
    item?.if?.properties?.releaseEligible?.const === true);
  assert.ok(releaseConstraint);
  for (const name of REQUIRED_MIXED_WORKLOADS) {
    assert.equal(releaseConstraint.then.properties.workloadRuns.properties[name].minimum, 100);
    assert.equal(
      releaseConstraint.then.properties.successfulWorkloadRuns.properties[name].minimum,
      100,
    );
  }
  assert.equal(
    releaseConstraint.then.properties.correctness.properties.coverageGaps.maxItems,
    0,
  );
  const outcomes = schema.properties.resources.properties.samples.items.properties.workloadOutcomes;
  assert.equal(outcomes.minItems, REQUIRED_MIXED_WORKLOADS.length);
  assert.equal(outcomes.maxItems, REQUIRED_MIXED_WORKLOADS.length);
  assert.deepEqual(outcomes.allOf.map((rule) => rule.contains.properties.name.const).sort(),
    [...REQUIRED_MIXED_WORKLOADS].sort());
  assert.equal(outcomes.items.properties.passed.const, true);
  assert.equal(outcomes.items.properties.exitStatus.const, 0);
  assert.equal(outcomes.items.properties.durationNs.minimum, 1);
});

test("run record validation prevents diagnostic evidence promotion and inconsistent labels", () => {
  const record = {
    schema: "dev.changeloop.performance-run", recordVersion: 2,
    workloadVersion: "local-performance-gates-v2", evidenceClass: "diagnostic-smoke",
    configuration: { profile: "smoke" },
    gates: validGates(),
    revision: {
      gitRevision: revision, dirtyTreeDigestSha256: hash("a"),
      cargoLockSha256: hash("b"), executableSha256: hash("c"),
    },
    integrity: {
      unchanged: true,
      start: {
        gitRevision: revision, dirtyTreeDigestSha256: hash("a"),
        cargoLockSha256: hash("b"), executableSha256: hash("c"),
      },
      end: {
        gitRevision: revision, dirtyTreeDigestSha256: hash("a"),
        cargoLockSha256: hash("b"), executableSha256: hash("c"),
      },
    },
    releaseAssessment: {
      roadmapPerformanceGatesComplete: false, releaseProfile: false,
      runIntegrityUnchanged: true, nonSoak: assessNonSoakGates(validGates()),
      referenceMachine: { passed: false, machineId: null, seriesId: null },
    },
    environment: { referenceMachineId: null, referenceSeries: null },
    overall: { releaseEvidence: false, roadmapPerformanceGatesComplete: false },
  };
  assert.equal(validateRunRecord(record).passed, true);
  record.overall.releaseEvidence = true;
  assert.equal(validateRunRecord(record).passed, false);

  record.overall.releaseEvidence = false;
  record.integrity.start.executableSha256 = hash("d");
  record.integrity.unchanged = false;
  record.releaseAssessment.runIntegrityUnchanged = false;
  assert.equal(validateRunRecord(record).passed, true);
  record.evidenceClass = "release-candidate-local";
  record.configuration.profile = "release";
  record.releaseAssessment.releaseProfile = true;
  const validation = validateRunRecord(record);
  assert.equal(validation.passed, false);
  assert.equal(validation.checks.releaseArtifactIdentity, false);
  assert.equal(validation.checks.referenceMachineFingerprint, false);
});

test("eight-hour release run requires explicit confirmation", () => {
  const result = spawnSync(process.execPath, ["scripts/performance/run.mjs", "--mode", "release"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--confirm-8h/);
});

test("soak process detector recognizes absolute/relative workloads through wrapper chains", () => {
  const table = parseProcessTable(`
  3598 33939 3598 01:30:19 rtk proxy sh -c target/release/examples/reliability_probe soak --duration-seconds 28800 --events 1000 > target/performance/storage.json
  3615 3598 3598 01:30:19 /bin/sh -c target/release/examples/reliability_probe soak --duration-seconds 28800 --events 1000 > target/performance/storage.json
  3617 3615 3598 01:30:16 /workspace/target/release/examples/reliability_probe soak --duration-seconds 28800 --events 1000
 71538 33939 71538 01:31:01 rtk proxy node scripts/performance/mixed-soak-v2.mjs 28800 target/performance/mixed.json
 71552 71538 71538 01:30:58 /opt/homebrew/bin/node /workspace/scripts/performance/mixed-soak-v2.mjs 28800 target/performance/mixed.json
 90000 33939 90000 00:00:01 grep reliability_probe soak
`);
  const detected = detectSoakProcesses(table);
  assert.deepEqual(detected.map((item) => [item.pid, item.kind]), [
    [3617, "storage-replay-soak"], [71552, "mixed-resource-soak"],
  ]);
  assert.equal(detected[0].output, "target/performance/storage.json");
  assert.equal(detected[0].parentChain[0].pid, 3615);
  assert.equal(detected[1].output, "target/performance/mixed.json");
  assert.equal(detected[1].parentChain[0].pid, 71538);
});
