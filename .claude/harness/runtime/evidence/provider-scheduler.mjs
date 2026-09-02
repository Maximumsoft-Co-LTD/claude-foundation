import { findCyclePath } from "../core/graph.mjs";

export function neededExecutionProviders(context, id, hash) {
  return context.requiredProviders(id)
    .filter((provider) => context.receiptValidity(id, provider, hash).validity !== "valid");
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
  const nodes = [];
  const unconfigured = [];
  const unavailable = [];
  const claimed = new Set();
  const providers = context.evidence(id).providers || {};
  for (const provider of needed) {
    if (claimed.has(provider)) continue;
    const config = context.providerConfig(id, provider);
    if (!config || config.adapter === "external") {
      unconfigured.push(provider);
      continue;
    }
    const issue = providerAvailabilityIssue(context, id, provider, config);
    if (issue) {
      unavailable.push(issue);
      continue;
    }
    const producer = discoveryProducer(
      provider, config, providers, context.providerCapability);
    const node = providerExecutionNode(context, provider, config, producer, needed);
    node.covers.forEach((item) => claimed.add(item));
    nodes.push(node);
  }
  return { nodes, unconfigured, unavailable };
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
  log = console.log,
  logError = console.error
}) {
  const executionNodes = executionNodesOperation.bind(null, {
    requiredProviders, receiptValidity, providerConfig, commandExists,
    providerWorkspace, playwrightAvailability, evidence, providerCapability,
    adapterResources
  });

  async function runExecutionDag(id, nodes, proofRunId) {
    const pending = new Map(nodes.map((node) => [node.provider, node]));
    const completed = new Set();
    const failedOutputs = new Set();
    const commandCache = new Map();
    const outcomes = [];
    // A dependency may name a covered output of another pending node, not the
    // node's own provider id; resolve those to the owning node for cycle edges.
    const owner = new Map(nodes.flatMap((node) =>
      [node.provider, ...node.covers].map((output) => [output, node.provider])));
    while (pending.size) {
      const ready = [...pending.values()].filter((node) =>
        node.dependsOn.every((dependency) =>
          completed.has(dependency) ||
          receiptValidity(id, dependency).validity === "valid"));
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
      const batch = [];
      for (const node of ready)
        if (batch.every((selected) => !resourcesConflict(selected.resources, node.resources)))
          batch.push(node);
      log(`EXECUTION ${proofRunId}: ${batch.map((node) => node.provider).join(", ")}`);
      const results = await Promise.all(batch.map((node) =>
        executeAdapter(id, node.provider, node.config, proofRunId, commandCache)));
      for (let index = 0; index < batch.length; index += 1) {
        pending.delete(batch[index].provider);
        outcomes.push({
          provider: batch[index].provider,
          status: results[index].status,
          observations: results[index].observations || []
        });
        if (results[index].status === "pass") {
          for (const covered of batch[index].covers) completed.add(covered);
        } else {
          failedOutputs.add(batch[index].provider);
          for (const covered of batch[index].covers) failedOutputs.add(covered);
          logError(`PROVIDER ${batch[index].provider}: ${results[index].status}`);
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
