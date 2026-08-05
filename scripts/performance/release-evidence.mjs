import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const EIGHT_HOURS_SECONDS = 28_800;
export const REQUIRED_MIXED_WORKLOADS = [
  "queue", "relay", "router", "shutdown", "status",
  "readOnlyConversations", "disposableWorktreeMutations", "reconnectReplay",
  "childCancellation", "jobs", "projectCreateDispose",
];
export const REQUIRED_ROUTER_CASES = [
  "openai-short-streaming", "openai-long-streaming", "openai-tool-streaming",
  "openai-large-streaming", "openai-non-streaming",
  "anthropic-short-streaming", "anthropic-long-streaming", "anthropic-tool-streaming",
  "anthropic-large-streaming", "anthropic-non-streaming",
];
const ROUTER_SCENARIOS = {
  short: "short_response", long: "long_response", tool: "tool_call",
  large: "large_payload", non: "non_streaming",
};
const NS_PER_SECOND = 1_000_000_000;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const GIT_REVISION = /^[0-9a-f]{40,64}$/;
const EVIDENCE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const integer = (value) => Number.isSafeInteger(value);
const positiveInteger = (value) => integer(value) && value > 0;
const sha256 = (value) => typeof value === "string" && HEX_SHA256.test(value);
const gitRevision = (value) => typeof value === "string" && GIT_REVISION.test(value);
export function referenceMachineFingerprint(environment) {
  const identity = {
    os: environment?.os,
    kernel: environment?.kernel,
    architecture: environment?.architecture,
    cpuModel: environment?.cpuModel,
    logicalCpuCount: environment?.logicalCpuCount,
    physicalMemoryBytes: environment?.physicalMemoryBytes,
    filesystemType: environment?.filesystemType,
  };
  const valid = [identity.os, identity.kernel, identity.architecture, identity.cpuModel,
    identity.filesystemType].every((value) => typeof value === "string"
      && value.length > 0 && !["unknown", "unavailable", "unclassified-local"].includes(value))
    && positiveInteger(identity.logicalCpuCount) && positiveInteger(identity.physicalMemoryBytes);
  return valid
    ? createHash("sha256").update(JSON.stringify(identity)).digest("hex")
    : null;
}

function validNsSamples(samples, minimum) {
  return Array.isArray(samples) && samples.length >= minimum
    && samples.every((sample) => positiveInteger(sample));
}

function nearestRankP95Ms(samples) {
  if (!validNsSamples(samples, 1)) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] / 1_000_000;
}

function latency(samples, minimum, thresholdMs) {
  if (!validNsSamples(samples, minimum)) return false;
  const p95Ms = nearestRankP95Ms(samples);
  return p95Ms !== null && p95Ms < thresholdMs;
}

function integrityPair(integrity, fields) {
  if (integrity?.unchanged !== true || typeof integrity.start !== "object"
      || typeof integrity.end !== "object") return false;
  return fields.every((field) => {
    const start = integrity.start[field];
    const end = integrity.end[field];
    const valid = field === "gitRevision" ? gitRevision(start) : sha256(start);
    return valid && start === end;
  });
}

export function loadEvidence(file) {
  if (!file) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { evidenceLoadError: "evidence is missing, truncated, or invalid JSON" };
  }
}

export function assessStorageSoak(record, expected = {}) {
  const checks = {
    recognizedRecord: record?.recordVersion === 2 && record?.probe === "storage-replay-soak"
      && record?.workloadVersion === "storage-soak-v2",
    duration: positiveInteger(record?.requestedDurationSeconds)
      && record.requestedDurationSeconds >= EIGHT_HOURS_SECONDS
      && positiveInteger(record?.elapsedNs)
      && record.elapsedNs >= record.requestedDurationSeconds * NS_PER_SECOND
      && positiveInteger(record?.startedUnixMs) && positiveInteger(record?.finishedUnixMs)
      && record.finishedUnixMs - record.startedUnixMs >= record.requestedDurationSeconds * 1_000,
    sampling: positiveInteger(record?.cycles) && record.cycles >= 100
      && positiveInteger(record?.eventsPerCycle) && record.eventsPerCycle >= 1_000,
    exactReplay: record?.correctness?.exactCountEveryCycle === true,
    boundedDatabaseGrowth: integer(record?.initialDatabaseBytes) && record.initialDatabaseBytes > 0
      && integer(record?.finalDatabaseBytes) && record.finalDatabaseBytes >= record.initialDatabaseBytes
      && record?.databaseGrowthBytes === record.finalDatabaseBytes - record.initialDatabaseBytes
      && record.databaseGrowthBytes === 0,
    integrity: integrityPair(record?.integrity, [
      "probeExecutableSha256", "probeSourceSha256", "cargoLockSha256", "gitRevision",
      "sourceTreeSha256",
    ]),
    provenanceBinding: (!expected.gitRevision
        || record?.integrity?.end?.gitRevision === expected.gitRevision)
      && (!expected.cargoLockSha256
        || record?.integrity?.end?.cargoLockSha256 === expected.cargoLockSha256)
      && (!expected.probeExecutableSha256
        || record?.integrity?.end?.probeExecutableSha256 === expected.probeExecutableSha256)
      && (!expected.probeSourceSha256
        || record?.integrity?.end?.probeSourceSha256 === expected.probeSourceSha256),
    notInterrupted: record?.interrupted === false,
    producerReleaseEligible: record?.releaseEligible === true,
  };
  return { supplied: record !== null, checks, passed: Object.values(checks).every(Boolean) };
}

export function assessMixedSoak(record, expectedIdentity = {}) {
  if (typeof expectedIdentity === "string") {
    expectedIdentity = { cloopSha256: expectedIdentity };
  }
  const exactCycleWorkloads = Array.isArray(record?.resources?.samples)
    && record.resources.samples.every((sample) =>
      Array.isArray(sample?.workloadOutcomes)
      && sample.workloadOutcomes.length === REQUIRED_MIXED_WORKLOADS.length
      && new Set(sample.workloadOutcomes.map((outcome) => outcome?.name)).size
        === REQUIRED_MIXED_WORKLOADS.length
      && REQUIRED_MIXED_WORKLOADS.every((name) => {
        const outcome = sample.workloadOutcomes.find((item) => item?.name === name);
        return outcome?.passed === true && outcome?.timedOut === false
          && outcome?.outputOverflow === false && integer(outcome?.exitStatus)
          && outcome.exitStatus === 0 && positiveInteger(outcome?.durationNs);
      }));
  const resourceSamplesPresent = record?.correctness?.resourceSamplingComplete === true
    && positiveInteger(record?.resources?.resourceSamples)
    && record.resources.resourceSamples >= (record?.cycles ?? Infinity) * 5
    && Array.isArray(record?.resources?.samples)
    && record.resources.samples.length === record?.cycles
    && record.resources.samples.length >= 100
      && record.resources.samples.every((sample, index, all) => sample?.cycle === index + 1
      && finite(sample?.elapsedSeconds) && sample.elapsedSeconds >= 0
      && (index === 0 || sample.elapsedSeconds >= all[index - 1].elapsedSeconds)
      && sample.elapsedSeconds <= record?.elapsedSeconds
      && integer(sample?.rssKiB) && sample.rssKiB >= 0
      && integer(sample?.fileDescriptors) && sample.fileDescriptors >= 0
      && integer(sample?.fixtureDiskKiB) && sample.fixtureDiskKiB >= 0)
      && exactCycleWorkloads;
  const checks = {
    recognizedRecord: record?.schema === "dev.changeloop.mixed-resource-soak"
      && record?.recordVersion === 2
      && record?.workloadVersion === "mixed-resource-soak-v2"
      && record?.mode === "soak",
    duration: positiveInteger(record?.requestedDurationSeconds)
      && record.requestedDurationSeconds >= EIGHT_HOURS_SECONDS
      && finite(record?.elapsedSeconds)
      && record.elapsedSeconds >= record.requestedDurationSeconds
      && finite(Date.parse(record?.startedAt)) && finite(Date.parse(record?.finishedAt))
      && Date.parse(record.finishedAt) - Date.parse(record.startedAt)
        >= record.requestedDurationSeconds * 1_000,
    minimumCycles: positiveInteger(record?.cycles) && record.cycles >= 100,
    requiredWorkloadCoverage: REQUIRED_MIXED_WORKLOADS.every((name) =>
      positiveInteger(record?.workloadRuns?.[name])
        && record.workloadRuns[name] === record.cycles
        && positiveInteger(record?.successfulWorkloadRuns?.[name])
        && record.successfulWorkloadRuns[name] === record.workloadRuns[name])
      && Object.keys(record?.workloadRuns ?? {}).length === REQUIRED_MIXED_WORKLOADS.length
      && Object.keys(record?.successfulWorkloadRuns ?? {}).length === REQUIRED_MIXED_WORKLOADS.length,
    workloadCoverage: record?.correctness?.coverageComplete === true
      && record?.correctness?.allWorkloadsPassed === true
      && Array.isArray(record?.correctness?.coverageGaps)
      && record.correctness.coverageGaps.length === 0,
    noFailures: record?.failures?.total === 0
      && Array.isArray(record?.failures?.observations)
      && record.failures.observations.length === 0,
    boundedResources: record?.correctness?.rssWithinLimit === true
      && record?.correctness?.fileDescriptorsWithinLimit === true
      && record?.correctness?.boundedFixtureGrowth === true
      && record?.correctness?.resourceTrendEvaluated === true
      && record?.correctness?.stableResourceTrend === true
      && resourceSamplesPresent
      && positiveInteger(record?.resources?.limits?.maxProcessTreeRssKiB)
      && positiveInteger(record?.resources?.maxProcessTreeRssKiB)
      && record.resources.maxProcessTreeRssKiB
        === Math.max(...record.resources.samples.map((sample) => sample.rssKiB))
      && record?.resources?.maxProcessTreeRssKiB <= record.resources.limits.maxProcessTreeRssKiB
      && positiveInteger(record?.resources?.limits?.maxProcessFileDescriptors)
      && positiveInteger(record?.resources?.maxProcessFileDescriptors)
      && record.resources.maxProcessFileDescriptors
        === Math.max(...record.resources.samples.map((sample) => sample.fileDescriptors))
      && record?.resources?.maxProcessFileDescriptors <= record.resources.limits.maxProcessFileDescriptors
      && integer(record?.resources?.limits?.maxFixtureGrowthKiB)
      && record.resources.limits.maxFixtureGrowthKiB >= 0
      && integer(record?.resources?.baselineFixtureDiskKiB)
      && integer(record?.resources?.finalFixtureDiskKiB)
      && integer(record?.resources?.fixtureGrowthKiB)
      && record?.resources?.fixtureGrowthKiB === Math.max(0, record.resources.finalFixtureDiskKiB - record.resources.baselineFixtureDiskKiB)
      && record?.resources?.fixtureGrowthKiB <= record.resources.limits.maxFixtureGrowthKiB
      && finite(record?.resources?.rssSlopeKiBPerCycle)
      && finite(record?.resources?.fileDescriptorSlopePerCycle)
      && finite(record?.resources?.limits?.maxRssSlopeKiBPerCycle)
      && finite(record?.resources?.limits?.maxFileDescriptorSlopePerCycle)
      && record.resources.rssSlopeKiBPerCycle <= record.resources.limits.maxRssSlopeKiBPerCycle
      && record.resources.fileDescriptorSlopePerCycle
        <= record.resources.limits.maxFileDescriptorSlopePerCycle,
    noOrphans: record?.correctness?.noOrphanProcesses === true
      && record?.orphanProcessGroups?.length === 0
      && record?.interrupted === false,
    binaryIntegrity: integrityPair(record?.integrity, [
      "cloopSha256", "probeSha256", "cargoLockSha256", "runnerSha256", "gitRevision",
      "sourceTreeSha256",
    ]),
    provenanceBinding: [
      ["gitRevision", gitRevision], ["sourceTreeSha256", sha256],
      ["cargoLockSha256", sha256], ["cloopSha256", sha256],
      ["probeSha256", sha256], ["runnerSha256", sha256],
    ].every(([field, validator]) => !expectedIdentity[field]
      || (validator(expectedIdentity[field])
        && record?.integrity?.end?.[field] === expectedIdentity[field])),
    producerReleaseEligible: record?.releaseEligible === true,
  };
  const reasonByCheck = {
    recognizedRecord: "record/schema version is not mixed-resource-soak-v2",
    duration: "record does not prove an uninterrupted eight-hour wall-clock duration",
    minimumCycles: "record contains fewer than 100 complete cycles",
    requiredWorkloadCoverage: `each cycle must successfully cover: ${REQUIRED_MIXED_WORKLOADS.join(", ")}`,
    workloadCoverage: "producer correctness did not confirm complete, successful workload coverage",
    noFailures: "one or more workload executions failed",
    boundedResources: "resource samples are incomplete, inconsistent, or exceed declared bounds",
    noOrphans: "the run was interrupted or left orphan processes",
    binaryIntegrity: "source, runner, lockfile, probe, or executable changed during the run",
    provenanceBinding: "soak source or binary identity does not match the assessed release run",
    producerReleaseEligible: "producer did not mark the source-frozen run release-eligible",
  };
  const reasons = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => reasonByCheck[name]);
  return {
    supplied: record !== null,
    checks,
    reasons,
    passed: Object.values(checks).every(Boolean),
  };
}

export function assessNonSoakGates(gates) {
  const cliSamples = gates?.cliStartup?.samples;
  const cli = Array.isArray(cliSamples) && cliSamples.length === 2
    && ["help", "status"].every((name) => {
      const sample = cliSamples.find((item) => item?.name === name);
      return sample?.correctnessPassed === true && sample?.failureCount === 0
        && positiveInteger(sample?.warmups) && sample.warmups >= 5
        && positiveInteger(sample?.repetitions) && sample.repetitions >= 30
        && sample?.observations?.length === sample.repetitions
        && sample.observations.every((item) => item?.correct === true
          && integer(item?.exitStatus) && item.exitStatus === 0
          && positiveInteger(item?.durationNs))
        && sample?.samplesNs?.length === sample.repetitions
        && sample.samplesNs.every((value, index) => value === sample.observations[index].durationNs)
        && latency(sample.samplesNs, 30, 250);
    });
  const replay = gates?.eventReplay10k;
  const tui = gates?.tuiReady;
  const transport = gates?.localTransportRelay;
  const queue = gates?.clientQueueRelay;
  const shutdown = gates?.gracefulShutdownStates;
  const durable = gates?.durableShutdownRecovery;
  const router = gates?.providerRouterOverhead;
  const expectedTransports = ["http_sse", "stdio", "unix"];
  const expectedStates = [
    "idle", "backpressured-client", "child-agent-resources", "project-owned-lsp",
    "pty-and-background-jobs", "streaming-provider-mock",
  ];
  const replayVariant = (name, warmups) => {
    const variant = replay?.variants?.find((item) => item?.cacheVariant === name);
    return variant?.eventCount === 10_000 && variant?.warmups === warmups
      && positiveInteger(variant?.repetitions) && variant.repetitions >= 20
      && variant?.samplesNs?.length === variant.repetitions
      && variant?.correctness?.exactCount === true && variant?.correctness?.exactOrder === true
      && variant?.correctness?.duplicates === 0
      && Array.isArray(variant?.memorySamplesKiB)
      && variant.memorySamplesKiB.length === variant.repetitions
      && variant.memorySamplesKiB.every((value) => integer(value) && value >= 0)
      && variant?.memoryLimitKiB === 65_536
      && variant?.maxRssGrowthKiB === Math.max(...variant.memorySamplesKiB)
      && variant?.memoryBounded === (variant.maxRssGrowthKiB <= variant.memoryLimitKiB)
      && variant.memoryBounded === true
      && latency(variant.samplesNs, 20, 2_000);
  };
  const directTotal = Array.isArray(router?.directSamplesNs)
    ? router.directSamplesNs.reduce((sum, value) => sum + value, 0) : 0;
  const routedTotal = Array.isArray(router?.routedSamplesNs)
    ? router.routedSamplesNs.reduce((sum, value) => sum + value, 0) : 0;
  const routerRatio = directTotal > 0 ? (routedTotal - directTotal) / directTotal : null;
  const routerCases = Array.isArray(router?.cases) ? router.cases : [];
  const routerMatrix = routerCases.length === REQUIRED_ROUTER_CASES.length
    && REQUIRED_ROUTER_CASES.every((caseId) => {
      const item = routerCases.find((candidate) => candidate?.caseId === caseId);
      const expectedProvider = caseId.startsWith("openai-") ? "openai" : "anthropic";
      const expectedDelivery = caseId.endsWith("non-streaming") ? "non_streaming" : "streaming";
      const expectedScenario = ROUTER_SCENARIOS[caseId.split("-")[1]];
      const caseDirectTotal = Array.isArray(item?.directSamplesNs)
        ? item.directSamplesNs.reduce((sum, value) => sum + value, 0) : 0;
      const caseRoutedTotal = Array.isArray(item?.routedSamplesNs)
        ? item.routedSamplesNs.reduce((sum, value) => sum + value, 0) : 0;
      const caseRatio = caseDirectTotal > 0
        ? (caseRoutedTotal - caseDirectTotal) / caseDirectTotal : null;
      return item?.provider === expectedProvider && item?.delivery === expectedDelivery
        && item?.scenario === expectedScenario
        && item?.supported === true && item?.correctness?.identicalProviderEvents === true
        && item?.correctness?.attempts === 1
        && item?.repetitions === 30
        && validNsSamples(item?.directSamplesNs, 30)
        && validNsSamples(item?.routedSamplesNs, 30)
        && item.directSamplesNs.length === item.routedSamplesNs.length
        && finite(item?.aggregateOverheadRatio) && finite(caseRatio)
        && Math.abs(item.aggregateOverheadRatio - caseRatio) < 1e-12
        && caseRatio < 0.05;
    })
    && new Set(routerCases.map((item) => item?.caseId)).size === REQUIRED_ROUTER_CASES.length;
  const checks = {
    cliStartup: cli,
    eventReplay10k: replay?.coverageComplete === true
      && Array.isArray(replay?.coverageGaps) && replay.coverageGaps.length === 0
      && Array.isArray(replay?.variants) && replay.variants.length === 2
      && replayVariant("process-reopen-cold", 0)
      && replayVariant("process-reopen-warm", 5),
    tuiReady: tui?.correctness?.completeFrame === true && tui?.correctness?.cleanQuit === true
      && tui?.correctness?.noProviderGuidance === true
      && tui?.correctness?.keyboardResponse === "/status card with ready JSON"
      && positiveInteger(tui?.warmups) && tui.warmups >= 5
      && Array.isArray(tui?.observations) && tui.observations.length >= 30
      && tui.observations.every((item) => item?.ready === true && item?.statusReady === true
        && item?.quitSent === true && item?.exitStatus === 0 && positiveInteger(item?.durationNs))
      && tui?.samplesNs?.length === tui.observations.length
      && tui.samplesNs.every((value, index) => value === tui.observations[index].durationNs)
      && latency(tui?.samplesNs, 30, 750),
    localTransportRelay: transport?.correctness?.exactCount === true
      && transport?.correctness?.exactOrder === true && transport?.correctness?.silentDrops === 0
      && transport?.coverageComplete === true
      && Array.isArray(transport?.coverageGaps) && transport.coverageGaps.length === 0
      && transport?.eventCountPerTransport === 10_000
      && Array.isArray(transport?.transports) && transport.transports.length === 3
      && expectedTransports.every((name) => {
        const item = transport.transports.find((entry) => entry?.transport === name);
        return Array.isArray(item?.variants) && item.variants.length === 2
          && ["idle", "steady_concurrency"].every((variantName) => {
            const variant = item.variants.find((entry) => entry?.variant === variantName);
            return variant?.delivered === 10_000 && variant?.ordered === true
              && variant?.silentDrops === 0 && positiveInteger(variant?.maxQueueDepth)
              && positiveInteger(variant?.queueCapacity)
              && variant.maxQueueDepth <= variant.queueCapacity
              && variant?.backpressureObserved === true
              && (variantName === "idle" ? variant?.concurrency === 1
                : positiveInteger(variant?.concurrency) && variant.concurrency >= 2)
              && latency(variant?.samplesNs, 10_000, 50);
          });
      }),
    clientQueueRelay: queue?.events === 10_000 && positiveInteger(queue?.capacity)
      && queue.capacity <= queue.events && queue?.correctness?.delivered === 10_000
      && queue?.correctness?.ordered === true && queue?.correctness?.silentDrops === 0
      && queue?.correctness?.backpressureSignalsDisconnect === true
      && latency(queue?.samplesNs, 10_000, 50),
    gracefulShutdownStates: shutdown?.correctness?.allTerminal === true
      && shutdown?.correctness?.forcedCleanupTimeouts === 0
      && shutdown?.coverageComplete === true
      && Array.isArray(shutdown?.coverageGaps) && shutdown.coverageGaps.length === 0
      && Array.isArray(shutdown?.states) && shutdown.states.length === expectedStates.length
      && expectedStates.every((name) => {
        const state = shutdown.states.find((item) => item?.state === name);
        return state?.terminal === true && latency(state?.samplesNs, 20, 2_000);
      }),
    durableShutdownRecovery: durable?.correctness?.state === "interrupted"
      && durable?.correctness?.terminalMarkersPerOperation === 1
      && positiveInteger(durable?.repetitions) && durable.repetitions >= 20
      && durable?.samplesNs?.length === durable.repetitions
      && latency(durable?.samplesNs, 20, 2_000),
    providerRouterOverhead: router?.recordVersion === 2
      && router?.workloadVersion === "dual-provider-router-matrix-v2"
      && router?.fixtureScope === "bounded hermetic adapter/router comparison; not upstream provider performance"
      && router?.coverageComplete === true
      && Array.isArray(router?.coverageGaps) && router.coverageGaps.length === 0
      && router?.releaseEligible === true
      && routerMatrix
      && router?.correctness?.identicalProviderEvents === true
      && router?.correctness?.attempts === 1 && router?.retryBackoffNs === 0
      && validNsSamples(router?.directSamplesNs, REQUIRED_ROUTER_CASES.length * 30)
      && validNsSamples(router?.routedSamplesNs, REQUIRED_ROUTER_CASES.length * 30)
      && router.directSamplesNs.length === router.routedSamplesNs.length
      && directTotal === routerCases.reduce((sum, item) => sum
        + item.directSamplesNs.reduce((caseSum, value) => caseSum + value, 0), 0)
      && routedTotal === routerCases.reduce((sum, item) => sum
        + item.routedSamplesNs.reduce((caseSum, value) => caseSum + value, 0), 0)
      && finite(router?.aggregateOverheadRatio) && finite(routerRatio)
      && Math.abs(router.aggregateOverheadRatio - routerRatio) < 1e-12
      && routerRatio < 0.05,
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

export function assessReleaseEvidence(
  gates, storageRecord, mixedRecord, expectedExecutableSha256, context = {},
) {
  const nonSoak = assessNonSoakGates(gates);
  const storage = assessStorageSoak(storageRecord, context.storageIdentity);
  const mixedIdentity = {
    ...(context.mixedIdentity ?? {}),
    ...(expectedExecutableSha256 ? { cloopSha256: expectedExecutableSha256 } : {}),
  };
  const mixed = assessMixedSoak(mixedRecord, mixedIdentity);
  const fingerprint = referenceMachineFingerprint(context?.environment);
  const referenceMachine = context?.releaseProfile === true
    && EVIDENCE_IDENTIFIER.test(context?.referenceMachineId ?? "")
    && EVIDENCE_IDENTIFIER.test(context?.referenceSeries ?? "")
    && sha256(context?.referenceMachineFingerprintSha256)
    && context.referenceMachineFingerprintSha256 === fingerprint;
  return {
    nonSoak,
    storage,
    mixed,
    referenceMachine: {
      passed: referenceMachine,
      machineId: referenceMachine ? context.referenceMachineId : null,
      seriesId: referenceMachine ? context.referenceSeries : null,
      fingerprintSha256: referenceMachine ? fingerprint : null,
      reason: referenceMachine ? null
        : "release evidence requires explicit reference-machine and baseline-series identifiers",
    },
    roadmapPerformanceGatesComplete: nonSoak.passed && storage.passed && mixed.passed
      && referenceMachine,
  };
}

export function validateRunRecord(record, evidence = {}) {
  const integrityFields = ["gitRevision", "dirtyTreeDigestSha256", "cargoLockSha256", "executableSha256"];
  const validRevision = (value) => gitRevision(value?.gitRevision)
    && sha256(value?.dirtyTreeDigestSha256) && sha256(value?.cargoLockSha256)
    && sha256(value?.executableSha256);
  const runUnchanged = integrityFields.every((field) =>
    record?.integrity?.start?.[field] === record?.integrity?.end?.[field]);
  const recomputedNonSoak = assessNonSoakGates(record?.gates);
  const recomputedRelease = assessReleaseEvidence(
    record?.gates, evidence.storageRecord, evidence.mixedRecord,
    record?.revision?.executableSha256,
    {
      releaseProfile: record?.evidenceClass === "release-candidate-local",
      referenceMachineId: record?.environment?.referenceMachineId,
      referenceSeries: record?.environment?.referenceSeries,
      referenceMachineFingerprintSha256:
        record?.environment?.referenceMachineFingerprintSha256,
      environment: record?.environment,
      storageIdentity: {
        gitRevision: record?.revision?.gitRevision,
        cargoLockSha256: record?.revision?.cargoLockSha256,
        probeExecutableSha256: record?.workload?.storageProbeExecutableSha256,
        probeSourceSha256: record?.workload?.storageProbeSha256,
      },
      mixedIdentity: {
        gitRevision: record?.revision?.gitRevision,
        sourceTreeSha256: record?.revision?.dirtyTreeDigestSha256,
        cargoLockSha256: record?.revision?.cargoLockSha256,
        probeSha256: record?.workload?.queueProbeExecutableSha256,
        runnerSha256: record?.workload?.mixedSoakRunnerSha256,
      },
    },
  );
  const checks = {
    schema: record?.schema === "dev.changeloop.performance-run"
      && record?.recordVersion === 2
      && record?.workloadVersion === "local-performance-gates-v2",
    evidenceClass: record?.evidenceClass === "diagnostic-smoke"
      || record?.evidenceClass === "release-candidate-local",
    profileBinding: (record?.evidenceClass === "diagnostic-smoke" && record?.configuration?.profile === "smoke")
      || (record?.evidenceClass === "release-candidate-local" && record?.configuration?.profile === "release"),
    diagnosticCannotBeRelease: record?.evidenceClass !== "diagnostic-smoke"
      || (record?.overall?.releaseEvidence === false
        && record?.overall?.roadmapPerformanceGatesComplete === false),
    assessmentConsistency: typeof record?.overall?.releaseEvidence === "boolean"
      && record.overall.releaseEvidence === record?.overall?.roadmapPerformanceGatesComplete
      && record.overall.releaseEvidence === record?.releaseAssessment?.roadmapPerformanceGatesComplete,
    nonSoakRecomputed: record?.releaseAssessment?.nonSoak?.passed === recomputedNonSoak.passed
      && Object.entries(recomputedNonSoak.checks).every(([name, passed]) =>
        record?.releaseAssessment?.nonSoak?.checks?.[name] === passed),
    releaseEvidenceRecomputed: record?.overall?.releaseEvidence !== true
      || (recomputedRelease.roadmapPerformanceGatesComplete === true
        && record?.releaseAssessment?.storage?.passed === true
        && record?.releaseAssessment?.mixed?.passed === true
        && Object.entries(recomputedRelease.storage.checks).every(([name, passed]) =>
          record?.releaseAssessment?.storage?.checks?.[name] === passed)
        && Object.entries(recomputedRelease.mixed.checks).every(([name, passed]) =>
          record?.releaseAssessment?.mixed?.checks?.[name] === passed)),
    releaseProfileBinding: record?.releaseAssessment?.releaseProfile
      === (record?.evidenceClass === "release-candidate-local"),
    referenceMachineBinding: record?.releaseAssessment?.referenceMachine?.passed
      === (record?.evidenceClass === "release-candidate-local"
        && EVIDENCE_IDENTIFIER.test(record?.environment?.referenceMachineId ?? "")
        && EVIDENCE_IDENTIFIER.test(record?.environment?.referenceSeries ?? ""))
      && record?.releaseAssessment?.referenceMachine?.machineId
        === (record?.evidenceClass === "release-candidate-local"
          ? record?.environment?.referenceMachineId : null)
      && record?.releaseAssessment?.referenceMachine?.seriesId
        === (record?.evidenceClass === "release-candidate-local"
          ? record?.environment?.referenceSeries : null),
    integrityAssessmentBinding: record?.releaseAssessment?.runIntegrityUnchanged
      === record?.integrity?.unchanged,
    revisionBinding: gitRevision(record?.revision?.gitRevision)
      && sha256(record?.revision?.dirtyTreeDigestSha256)
      && sha256(record?.revision?.cargoLockSha256)
      && sha256(record?.revision?.executableSha256),
    releaseArtifactIdentity: record?.evidenceClass !== "release-candidate-local"
      || (record?.revision?.dirty === false
        && record?.revision?.buildProfile === "release"
        && record?.revision?.executablePath === "target/release/cloop"),
    referenceMachineFingerprint: record?.evidenceClass !== "release-candidate-local"
      || (sha256(record?.environment?.referenceMachineFingerprintSha256)
        && record.environment.referenceMachineFingerprintSha256
          === referenceMachineFingerprint(record.environment)
        && record?.releaseAssessment?.referenceMachine?.fingerprintSha256
          === record.environment.referenceMachineFingerprintSha256),
    runIntegrity: validRevision(record?.integrity?.start) && validRevision(record?.integrity?.end)
      && record?.integrity?.unchanged === runUnchanged
      && (record?.evidenceClass === "diagnostic-smoke" || runUnchanged)
      && record?.integrity?.end?.gitRevision === record?.revision?.gitRevision
      && record?.integrity?.end?.dirtyTreeDigestSha256 === record?.revision?.dirtyTreeDigestSha256
      && record?.integrity?.end?.cargoLockSha256 === record?.revision?.cargoLockSha256
      && record?.integrity?.end?.executableSha256 === record?.revision?.executableSha256,
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}
