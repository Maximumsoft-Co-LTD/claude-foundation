import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function createMetricsRuntime({
  logs,
  receipts,
  readJson,
  readJsonLines,
  readJsonLinesTolerant,
  loadRuntime,
  ensureBudgetState,
  budgetDecision,
  output = console.log
}) {
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
    for (const operation of operations) {
      const name = operation.phase || operation.operation || "unknown";
      phases[name] ||= { operations: 0, durationMs: 0, failed: 0 };
      phases[name].operations += 1;
      phases[name].durationMs += Number(operation.durationMs || 0);
      if (operation.status !== "completed") phases[name].failed += 1;
    }
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
    const operationActiveTimeMs = operations.length
      ? operations.reduce((sum, row) => sum + Number(row.durationMs || 0), 0) : null;
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
    output(JSON.stringify({
      version: 3, changeId: id,
      wallTimeMs,
      activeTimeMs,
      unattributedWaitMs: wallTimeMs === null || activeTimeMs === null
        ? null : Math.max(0, wallTimeMs - activeTimeMs),
      humanWaitMs: null,
      humanWaitReason: "not inferred without an explicit host/user transition signal",
      phases, providers,
      evidenceExecutionTimeMs,
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
        modes: contextModes
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
