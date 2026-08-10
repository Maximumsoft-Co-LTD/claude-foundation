import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createModelDriftInspector } from "./host-execution-contract.mjs";

export function createMetricsRuntime({
  logs,
  receipts,
  readJson,
  readJsonLines,
  readJsonLinesTolerant,
  loadRuntime,
  ensureBudgetState,
  budgetDecision,
  instructionManifests = null,
  activeChangePath = null,
  policy = null,
  taskBlocks = null,
  taskMetadata = null,
  output = console.log
}) {
  // Absent join inputs report as unknown drift rather than suppressing the
  // section, so a partially wired install is visible instead of silent.
  const modelDrift = createModelDriftInspector({
    logs, instructionManifests, activeChangePath, policy, taskBlocks, taskMetadata
  });
  function contextMetricState(id) {
    const rows = readJsonLinesTolerant(join(logs, id, "context.jsonl"));
    const dir = join(logs, id, "context-events");
    if (existsSync(dir))
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const row = readJson(join(dir, entry.name), {});
        if (row.kind && Number.isFinite(Number(row.bytes))) rows.push(row);
      }
    const rollup = readJson(join(logs, id, "context-rollup.json"), {
      count: 0, totalBytes: 0, byKind: {}
    });
    return { rows, rollup };
  }

  function sumKnown(rows, field) {
    const values = rows.map((row) => row[field]).filter((value) =>
      value !== null && value !== undefined && Number.isFinite(Number(value)));
    return values.length ? values.reduce((sum, value) => sum + Number(value), 0) : null;
  }

  function groupUsage(events, field) {
    const result = {};
    for (const event of events) {
      const key = event[field] || "unknown";
      result[key] ||= {
        requests: 0, inputTokens: null, outputTokens: null,
        cacheTokens: null, cost: null
      };
      const row = result[key];
      row.requests += 1;
      for (const metric of ["inputTokens", "outputTokens", "cacheTokens", "cost"])
        if (event[metric] !== null && event[metric] !== undefined &&
            Number.isFinite(Number(event[metric])))
          row[metric] = Number(row[metric] || 0) + Number(event[metric]);
    }
    return result;
  }

  function contextSummary(contextRows, contextRollup) {
    const contextByKind = {};
    for (const row of contextRows) {
      contextByKind[row.kind] ||= [];
      contextByKind[row.kind].push(Number(row.bytes || 0));
    }
    const context = Object.fromEntries(Object.entries(contextByKind)
      .map(([kind, values]) => {
        const sorted = [...values].sort((left, right) => left - right);
        const percentile = (ratio) => sorted[Math.min(
          sorted.length - 1, Math.floor((sorted.length - 1) * ratio)
        )] || 0;
        return [kind, {
          count: values.length,
          totalBytes: values.reduce((sum, value) => sum + value, 0),
          medianBytes: percentile(0.5),
          p95Bytes: percentile(0.95),
          maxBytes: sorted.at(-1) || 0
        }];
      }));
    for (const [kind, archived] of Object.entries(contextRollup.byKind || {})) {
      const summary = context[kind] ||= {
        count: 0, totalBytes: 0, medianBytes: null, p95Bytes: null, maxBytes: 0
      };
      summary.count += Number(archived.count || 0);
      summary.totalBytes += Number(archived.totalBytes || 0);
      summary.maxBytes = Math.max(summary.maxBytes || 0, Number(archived.maxBytes || 0));
      summary.archivedCount = Number(archived.count || 0);
    }
    return context;
  }

  function showMetrics(id) {
    const state = loadRuntime(id);
    const budget = ensureBudgetState(state);
    const operations = readJsonLines(join(logs, id, "operations.jsonl"));
    const events = readJsonLines(join(logs, id, "events.jsonl"));
    const { rows: contextRows, rollup: contextRollup } = contextMetricState(id);
    const phaseContextRows = readJsonLines(join(logs, id, "phase-context.jsonl"));
    const reuseRows = readJsonLines(join(logs, id, "reuse.jsonl"));
    const phases = {};
    const phaseEntry = (name) => (phases[name] ||= {
      operations: 0, durationMs: 0, failed: 0, requests: 0,
      outputTokens: null, cacheCreationTokens: null, cacheReadTokens: null,
      contextMode: null, contextCarryInTokens: null, contextCarryCostTokens: null,
      loggedContextMode: undefined
    });
    for (const operation of operations) {
      const name = operation.phase || operation.operation || "unknown";
      const phase = phaseEntry(name);
      phase.operations += 1;
      phase.durationMs += Number(operation.durationMs || 0);
      if (operation.status !== "completed") phase.failed += 1;
    }
    const phaseFirstEvent = new Map();
    for (const event of events) {
      const name = event.operationId || "unknown";
      const phase = phaseEntry(name);
      phase.requests += 1;
      for (const field of ["outputTokens", "cacheCreationTokens", "cacheReadTokens"])
        if (event[field] !== null && event[field] !== undefined &&
            Number.isFinite(Number(event[field])))
          phase[field] = Number(phase[field] || 0) + Number(event[field]);
      // `Number(null)` is 0 and 0 is finite, so an unknown cache read latched
      // this to a measured zero — and the `=== null` guard then stopped any
      // real value from ever correcting it.
      if (phase.contextCarryInTokens === null &&
          event.cacheReadTokens !== null && event.cacheReadTokens !== undefined &&
          Number.isFinite(Number(event.cacheReadTokens)))
        phase.contextCarryInTokens = Number(event.cacheReadTokens);
      if (!phaseFirstEvent.has(name))
        phaseFirstEvent.set(name, { at: Date.parse(event.timestamp), session: event.sessionId });
    }
    for (const row of phaseContextRows)
      if (row.phase && phases[row.phase] && phases[row.phase].loggedContextMode === undefined)
        phases[row.phase].loggedContextMode = row.contextMode || "unknown";
    const seenSessions = new Set();
    for (const [name, entry] of [...phaseFirstEvent.entries()]
      .sort((left, right) => (left[1].at || 0) - (right[1].at || 0))) {
      const retained = Boolean(entry.session) && seenSessions.has(entry.session);
      if (entry.session) seenSessions.add(entry.session);
      phases[name].contextMode = retained ? "retained" : "initial";
    }
    for (const phase of Object.values(phases))
      phase.contextCarryCostTokens = phase.contextCarryInTokens === null
        ? null : phase.contextCarryInTokens * phase.requests;
    const retainedCarryTokens = Object.values(phases)
      .filter((phase) => phase.contextMode === "retained")
      .map((phase) => phase.contextCarryCostTokens)
      .filter((value) => value !== null)
      .reduce((sum, value) => sum + value, 0);
    const providers = {};
    const executions = new Map();
    const receiptDir = join(receipts, id);
    if (existsSync(receiptDir))
      for (const entry of readdirSync(receiptDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "proof.json")
          continue;
        const receipt = readJson(join(receiptDir, entry.name));
        providers[receipt.provider || entry.name.replace(/\.json$/, "")] = {
          status: receipt.status,
          adapter: receipt.adapter || "external",
          durationMs: receipt.durationMs ?? null,
          proofRunId: receipt.proofRunId || null,
          commandExecutionId: receipt.commandExecutionId || receipt.executionId || null
        };
        const commandExecutionId = receipt.commandExecutionId || receipt.executionId;
        if (commandExecutionId && Number.isFinite(Number(receipt.durationMs)))
          executions.set(commandExecutionId,
            Math.max(executions.get(commandExecutionId) || 0, Number(receipt.durationMs)));
      }
    const tokenTotal = ["inputTokens", "outputTokens", "cacheTokens"]
      .map((field) => sumKnown(events, field))
      .filter((value) => value !== null)
      .reduce((sum, value) => sum + value, 0);
    const orchestratorEvents = events.filter((event) =>
      event.agentId === "orchestrator" || event.operationId === "orchestrator");
    const orchestratorTokens = ["inputTokens", "outputTokens", "cacheTokens"]
      .map((field) => sumKnown(orchestratorEvents, field))
      .filter((value) => value !== null)
      .reduce((sum, value) => sum + value, 0);
    const totalCost = sumKnown(events, "cost");
    const orchestratorCost = sumKnown(orchestratorEvents, "cost");
    const context = contextSummary(contextRows, contextRollup);
    const currentContextBytes = contextRows.reduce(
      (sum, row) => sum + Number(row.bytes || 0), 0);
    const contextBytes = contextRows.length || Number(contextRollup.count || 0)
      ? currentContextBytes + Number(contextRollup.totalBytes || 0) : null;
    // `exec` rows time an external command (a build, an install), not a
    // harness operation, so they get their own bucket instead of inflating
    // operation time. They still count toward wall time below.
    const externalRows = operations.filter((row) => row.operation === "exec");
    const harnessRows = operations.filter((row) => row.operation !== "exec");
    const operationActiveTimeMs = harnessRows.length
      ? harnessRows.reduce((sum, row) => sum + Number(row.durationMs || 0), 0) : null;
    const externalExecutionTimeMs = externalRows.length
      ? externalRows.reduce((sum, row) => sum + Number(row.durationMs || 0), 0) : null;
    const evidenceExecutionTimeMs = executions.size
      ? [...executions.values()].reduce((sum, value) => sum + value, 0) : null;
    const activeTimeMs = operationActiveTimeMs === null
      ? evidenceExecutionTimeMs
      : evidenceExecutionTimeMs === null
        ? operationActiveTimeMs
        : Math.max(operationActiveTimeMs, evidenceExecutionTimeMs);
    const wallTimeMs = operations.length
      ? Math.max(...operations.map((row) => Date.parse(row.finishedAt))) -
        Math.min(...operations.map((row) => Date.parse(row.startedAt))) : null;
    const contextModes = {};
    for (const row of phaseContextRows)
      contextModes[row.contextMode || "unknown"] =
        Number(contextModes[row.contextMode || "unknown"] || 0) + 1;
    const hostAttemptEvents = events.filter((event) => event.attempt !== null && event.attempt !== undefined);
    const byAttemptStatus = hostAttemptEvents.reduce((result, event) => {
      const status = event.attemptStatus || "unknown";
      result[status] = Number(result[status] || 0) + 1;
      return result;
    }, {});
    output(JSON.stringify({
      version: 4, changeId: id,
      wallTimeMs,
      activeTimeMs,
      unattributedWaitMs: wallTimeMs === null || activeTimeMs === null
        ? null : Math.max(0, wallTimeMs - activeTimeMs),
      humanWaitMs: null,
      humanWaitReason: "not inferred without an explicit host/user transition signal",
      phases, providers,
      evidenceExecutionTimeMs,
      externalExecutionTimeMs,
      requests: events.length || null,
      inputTokens: sumKnown(events, "inputTokens"),
      outputTokens: sumKnown(events, "outputTokens"),
      cacheCreationTokens: sumKnown(events, "cacheCreationTokens"),
      cacheReadTokens: sumKnown(events, "cacheReadTokens"),
      cacheTokens: sumKnown(events, "cacheTokens"),
      cost: totalCost,
      byModel: groupUsage(events, "modelId"),
      byRepository: groupUsage(events, "repositoryId"),
      byTask: groupUsage(events, "taskId"),
      hostExecution: {
        attempts: hostAttemptEvents.length,
        fallbacks: hostAttemptEvents.filter((event) => event.fallbackReason).length,
        byAttemptStatus,
        instructionManifestDigests: [...new Set(events
          .map((event) => event.instructionManifestDigest).filter(Boolean))].sort()
      },
      modelDrift: modelDrift.changeDrift(id),
      budget: {
        lifetime: budget.lifetime,
        window: budget.window,
        decision: budgetDecision(state)
      },
      context: {
        totalBytes: contextBytes,
        estimatedTokens: contextBytes === null ? null : Math.ceil(contextBytes / 4),
        measurement: "emitted-plan-and-packet-bytes-only",
        estimateBasis: "four-bytes-per-token",
        excluded: [
          "always-on-rules", "loaded-skills", "artifact-reads",
          "tool-results", "conversation-history"
        ],
        byKind: context,
        retainedEvents: contextRows.length,
        archivedEvents: Number(contextRollup.count || 0),
        phaseTransitions: phaseContextRows,
        modes: contextModes,
        carryover: {
          retainedPhaseTokens: retainedCarryTokens,
          measurement: "first-request-cache-read-per-phase",
          estimateBasis: "carry-in-tokens-times-phase-requests",
          note: "tokens spent re-reading context inherited across a phase boundary that did not reset"
        }
      },
      evidenceReuse: {
        count: reuseRows.length,
        byReason: reuseRows.reduce((result, row) => {
          const reason = row.reason || "unknown";
          result[reason] = Number(result[reason] || 0) + 1;
          return result;
        }, {})
      },
      rework: {
        expectedStops: operations.filter((row) => row.status === "blocked").length,
        unexpectedFailures: operations.filter((row) => row.status === "failed").length,
        failedOperations: operations.filter((row) => row.status === "failed").length,
        providerRebindings: reuseRows.length
      },
      orchestratorTokenShare: tokenTotal > 0 ? orchestratorTokens / tokenTotal : null,
      orchestratorCostShare: totalCost > 0 && orchestratorCost !== null
        ? orchestratorCost / totalCost : null,
      measurement: events.length
        ? (operations.length ? "operations-and-host-events" : "host-events-only")
        : (operations.length ? "operations-only" : "receipts-only")
    }, null, 2));
  }

  return { showMetrics };
}
