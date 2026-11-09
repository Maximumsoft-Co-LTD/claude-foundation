import { findCyclePath } from "../core/graph.mjs";
import { scheduleReadyBatch } from "../core/graph-execution.mjs";
import { advisoryVisualProviders } from "./visual-review.mjs";

// An advisory provider runs once per content: any current receipt, passing
// or not, is its report, and reruns would only repeat the reviewer's cost.
const ADVISORY_CURRENT = new Set([
  "valid", "fail", "inconclusive", "error", "reusable-inputs", "reusable-diff"
]);

export function advisoryExecutionProviders(context, id, hash) {
  if (!context.advisoryProviders) return [];
  try {
    const required = new Set(context.requiredProviders(id));
    return context.advisoryProviders(id).filter((provider) => !required.has(provider) &&
      !ADVISORY_CURRENT.has(context.receiptValidity(id, provider, hash).validity));
  } catch {
    // Advisory evidence never stops the required providers.
    return [];
  }
}

export function neededExecutionProviders(context, id, hash) {
  return [...context.requiredProviders(id)
    .filter((provider) => context.receiptValidity(id, provider, hash).validity !== "valid"),
  ...advisoryExecutionProviders(context, id, hash)];
}

export function providerAvailabilityIssue(context, id, provider, config) {
  if (config.adapter !== "contract-digest" &&
      !context.commandExists(config.command?.[0],
        context.providerWorkspace(id, provider, config)))
    return `${provider}:command`;
  if (config.adapter !== "playwright") return null;
  const availability = context.playwrightAvailability(
    context.providerWorkspace(id, provider, config));
  return availability.packageOwned && availability.binaryAvailable
    ? null : `${provider}:project-owned-playwright`;
}

export function discoveryProducer(provider, config, providers, providerCapability) {
  if (providerCapability(provider, config) !== "discovery") return null;
  return Object.entries(providers).find(([candidate, value]) =>
    value?.adapter === "test-discovery" &&
    providerCapability(candidate, value) === "test" &&
    (value.discoveryProvider || "discovery") === provider) || null;
}

export function executionNodeCovers(provider, config, needed) {
  const outputs = config.adapter === "test-discovery"
    ? [provider, config.discoveryProvider || "discovery"]
    : [...new Set([provider, ...(config.outputs || [])])];
  return outputs.filter((output) => needed.includes(output));
}

export function providerExecutionNode(context, provider, config, producer, needed) {
  const nodeProvider = producer ? producer[0] : provider;
  const nodeConfig = producer ? producer[1] : config;
  return {
    provider: nodeProvider,
    covers: executionNodeCovers(nodeProvider, nodeConfig, needed),
    config: nodeConfig,
    resources: context.adapterResources(nodeProvider, nodeConfig),
    dependsOn: nodeConfig.dependsOn || []
  };
}

export function executionNodesOperation(context, id, hash) {
  const needed = neededExecutionProviders(context, id, hash);
  const advisory = new Set(advisoryExecutionProviders(context, id, hash));
  const nodes = [];
  const unconfigured = [];
  const unavailable = [];
  const claimed = new Set();
  const providers = context.evidence(id).providers || {};
  for (const provider of needed) {
    if (claimed.has(provider)) continue;
    const config = context.providerConfig(id, provider);
    // An advisory provider that cannot run is skipped, never a readiness
    // blocker or a wiring question.
    if (!config || config.adapter === "external") {
      if (!advisory.has(provider)) unconfigured.push(provider);
      continue;
    }
    const issue = providerAvailabilityIssue(context, id, provider, config);
    if (issue) {
      if (!advisory.has(provider)) unavailable.push(issue);
      continue;
    }
    const producer = discoveryProducer(
      provider, config, providers, context.providerCapability);
    const node = providerExecutionNode(context, provider, config, producer, needed);
    if (advisory.has(provider)) node.advisory = true;
    node.covers.forEach((item) => claimed.add(item));
    nodes.push(node);
  }
  return { nodes, unconfigured, unavailable };
}

export function providerExecutionBatch(context, id, pending, completed, owner, ready) {
  const schedulable = [];
  for (const node of pending.values()) {
    const dependsOn = [];
    for (const dependency of node.dependsOn)
      dependsOn.push(owner.get(dependency) || dependency);
    schedulable.push({ ...node, id: node.provider, dependsOn });
  }
  const schedulerCompleted = new Set();
  for (const output of completed) schedulerCompleted.add(owner.get(output) || output);
  for (const node of pending.values())
    for (const dependency of node.dependsOn)
      if (context.receiptValidity(id, dependency).validity === "valid")
        schedulerCompleted.add(owner.get(dependency) || dependency);
  const { selected } = scheduleReadyBatch(schedulable, schedulerCompleted, {
    maxParallel: context.maxParallelProviders(),
    conflicts: (left, right) => context.resourcesConflict(left.resources, right.resources)
  });
  const selectedIds = new Set();
  for (const node of selected) selectedIds.add(node.id);
  const batch = [];
  for (const node of ready)
    if (selectedIds.has(node.provider)) batch.push(node);
  if (!batch.length) batch.push(ready[0]);
  return batch;
}

export function createProviderScheduler({
  requiredProviders,
  receiptValidity,
  providerConfig,
  commandExists,
  providerWorkspace,
  playwrightAvailability,
  evidence,
  providerCapability,
  adapterResources,
  resourcesConflict,
  executeAdapter,
  fail,
  // Resolved per call: `advance` silences console.log around quiet proof,
  // and a reference captured at construction leaked into its JSON output.
  log = (...args) => console.log(...args),
  logError = console.error,
  maxParallelProviders,
  recordScheduler,
  timestamp,
  // (id) => provider ids that run for their report only (an advisory
  // prototype binding's visual provider). Defaults to the contract's own.
  advisoryProviders = (id) => advisoryVisualProviders({
    evidence, providerConfig, providerCapability, requiredProviders
  }, id)
}) {
  const executionNodeContext = {
    requiredProviders, receiptValidity, providerConfig, commandExists,
    providerWorkspace, playwrightAvailability, evidence, providerCapability,
    adapterResources, advisoryProviders
  };
  function executionNodes(id, hash) {
    const required = requiredProviders(id);
    const result = executionNodesOperation(executionNodeContext, id, hash);
    recordScheduler({
      scheduler: "provider-selection", wave: 0,
      // Selection only identifies work and reusable receipts. Readiness and
      // execution belong to the dependency/resource waves below.
      readyNodes: 0, executedNodes: 0,
      reusedNodes: required.length - neededExecutionProviders(executionNodeContext, id, hash)
        .filter((provider) => required.includes(provider)).length,
      queueingMs: null, peakConcurrency: 0
    });
    return result;
  }

  // `onProgress` sees each wave start and each provider finish, so a caller
  // can persist where a long proof is; it never changes what runs.
  async function runExecutionDag(id, nodes, proofRunId, { onProgress = null } = {}) {
    const report = (event) => { try { onProgress?.(event); } catch { /* progress is advisory */ } };
    const pending = new Map(nodes.map((node) => [node.provider, node]));
    const completed = new Set();
    const failedOutputs = new Set();
    const commandCache = new Map();
    const outcomes = [];
    const readySince = new Map();
    let wave = 0;
    // A dependency may name a covered output of another pending node, not the
    // node's own provider id; resolve those to the owning node for cycle edges.
    const owner = new Map(nodes.flatMap((node) =>
      [node.provider, ...node.covers].map((output) => [output, node.provider])));
    while (pending.size) {
      const ready = [...pending.values()].filter((node) =>
        node.dependsOn.every((dependency) =>
          completed.has(dependency) ||
          receiptValidity(id, dependency).validity === "valid"));
      const observedAt = timestamp();
      for (const node of ready)
        if (!readySince.has(node.provider)) readySince.set(node.provider, observedAt);
      // Throw rather than fail(): fail is process.exit, which skips the
      // caller's catch — the thing that stops services and clears
      // activeProofRun — so the next `evidence record` bound a dead run's
      // workspace hash.
      if (!ready.length) {
        const blocked = [...pending.values()]
          .map((node) => ({
            node,
            failed: node.dependsOn.filter((dependency) => failedOutputs.has(dependency))
          }))
          .filter((entry) => entry.failed.length);
        // An advisory node that cannot start (a dependency failed, never ran,
        // or is missing) is skipped with its reason; it never aborts the run
        // the required providers belong to.
        const advisoryWaiting = [...pending.values()].filter((node) => node.advisory);
        if (advisoryWaiting.length) {
          for (const node of advisoryWaiting) {
            const failed = node.dependsOn.filter((dependency) => failedOutputs.has(dependency));
            const unmet = node.dependsOn.filter((dependency) => !completed.has(dependency) &&
              receiptValidity(id, dependency).validity !== "valid");
            const reason = failed.length
              ? `blocked by failed dependency ${failed.join(", ")}`
              : `dependency ${unmet.join(", ") || "unresolved"} did not run`;
            pending.delete(node.provider);
            outcomes.push({ provider: node.provider, status: "skipped", advisory: true,
              observations: [], detail: `advisory; ${reason}` });
            logError(`PROVIDER ${node.provider}: skipped (advisory; ${reason})`);
          }
          continue;
        }
        if (blocked.length)
          throw new Error(`provider(s) blocked by failed dependency: ${blocked
            .map((entry) => `${entry.node.provider} (needs ${entry.failed.join(", ")})`)
            .join("; ")}`);
        const cycle = findCyclePath(new Map([...pending.values()].map((node) =>
          [node.provider, node.dependsOn
            .map((dependency) => owner.get(dependency))
            .filter((dependency) => dependency !== undefined && pending.has(dependency))])));
        if (cycle)
          throw new Error(`provider dependency cycle: ${cycle.join(" -> ")}`);
        throw new Error(`provider dependency unresolvable: ${[...pending.keys()].join(", ")}`);
      }
      const batch = providerExecutionBatch({
        receiptValidity, maxParallelProviders, resourcesConflict
      }, id, pending, completed, owner, ready);
      wave += 1;
      recordScheduler({
        scheduler: "provider", wave, readyNodes: ready.length,
        executedNodes: batch.length, reusedNodes: 0,
        queueingMs: batch.reduce((total, node) =>
          total + Math.max(0, observedAt - readySince.get(node.provider)), 0),
        peakConcurrency: batch.length
      });
      log(`EXECUTION ${proofRunId}: ${batch.map((node) => node.provider).join(", ")}`);
      report({ event: "wave", wave, providers: batch.map((node) => node.provider),
        startedAt: new Date(timestamp()).toISOString() });
      const results = await Promise.all(batch.map(async (node) => {
        const started = timestamp();
        let result;
        try {
          result = await executeAdapter(id, node.provider, node.config, proofRunId, commandCache);
        } catch (error) {
          // A required provider's crash still ends the run; an advisory one
          // is reported as an error and the run continues.
          if (!node.advisory) throw error;
          result = { status: "error", detail: `advisory; adapter threw: ${error.message}` };
        }
        report({ event: "provider", provider: node.provider, status: result.status,
          durationMs: Math.max(0, timestamp() - started) });
        return result;
      }));
      for (let index = 0; index < batch.length; index += 1) {
        pending.delete(batch[index].provider);
        outcomes.push({
          provider: batch[index].provider,
          status: results[index].status,
          ...(batch[index].advisory ? { advisory: true } : {}),
          observations: results[index].observations || [],
          ...(results[index].detail ? { detail: results[index].detail } : {})
        });
        if (results[index].status === "pass") {
          for (const covered of batch[index].covers) completed.add(covered);
        } else {
          failedOutputs.add(batch[index].provider);
          for (const covered of batch[index].covers) failedOutputs.add(covered);
          // Name the command so a missing or broken provider script is
          // actionable without reading the receipt.
          const command = Array.isArray(batch[index].config?.command)
            ? ` (${batch[index].config.command.join(" ")})` : "";
          logError(`PROVIDER ${batch[index].provider}: ${results[index].status}${command}`);
        }
      }
    }
    return outcomes;
  }

  function collectableExecutionNodes(id, nodes, workspaceHash) {
    let selected = [...nodes];
    let changed = true;
    while (changed) {
      changed = false;
      const providers = new Set(selected.flatMap((node) => [node.provider, ...node.covers]));
      const next = selected.filter((node) => node.dependsOn.every((dependency) =>
        providers.has(dependency) ||
        receiptValidity(id, dependency, workspaceHash).validity === "valid"));
      if (next.length !== selected.length) {
        selected = next;
        changed = true;
      }
    }
    const selectedProviders = new Set(selected.map((node) => node.provider));
    return {
      nodes: selected,
      blocked: nodes.filter((node) => !selectedProviders.has(node.provider))
        .map((node) => node.provider)
    };
  }

  return { executionNodes, runExecutionDag, collectableExecutionNodes };
}
