export function createProviderScheduler({
  requiredProviders,
  receiptValidity,
  providerConfig,
  commandExists,
  providerWorkspace,
  playwrightAvailability,
  evidence,
  stableHash,
  providerCapability,
  adapterResources,
  resourcesConflict,
  executeAdapter,
  fail,
  log = console.log,
  logError = console.error
}) {
  function executionNodes(id, hash) {
    const needed = requiredProviders(id)
      .filter((provider) => receiptValidity(id, provider, hash).validity !== "valid");
    const nodes = [];
    const unconfigured = [];
    const unavailable = [];
    const claimed = new Set();
    for (const provider of needed) {
      if (claimed.has(provider)) continue;
      const config = providerConfig(id, provider);
      if (!config || config.adapter === "external") {
        unconfigured.push(provider);
        continue;
      }
      if (!commandExists(config.command?.[0], providerWorkspace(id, provider, config))) {
        unavailable.push(`${provider}:command`);
        continue;
      }
      if (config.adapter === "playwright") {
        const availability = playwrightAvailability(providerWorkspace(id, provider, config));
        if (!availability.packageOwned || !availability.binaryAvailable) {
          unavailable.push(`${provider}:project-owned-playwright`);
          continue;
        }
      }
      const configuredProducer = config.adapter === "test-discovery"
        ? Object.entries(evidence(id).providers || {}).find(([candidate, value]) =>
          stableHash(value) === stableHash(config) &&
          providerCapability(candidate, value) === "test")?.[0]
        : null;
      const nodeProvider = configuredProducer || provider;
      const covers = config.adapter === "test-discovery"
        ? [nodeProvider, config.discoveryProvider || "discovery"]
          .filter((output) => needed.includes(output))
        : [...new Set([provider, ...(config.outputs || [])])]
          .filter((output) => needed.includes(output));
      covers.forEach((item) => claimed.add(item));
      nodes.push({
        provider: nodeProvider,
        covers,
        config,
        resources: adapterResources(provider, config),
        dependsOn: config.dependsOn || []
      });
    }
    return { nodes, unconfigured, unavailable };
  }

  async function runExecutionDag(id, nodes, proofRunId) {
    const pending = new Map(nodes.map((node) => [node.provider, node]));
    const completed = new Set();
    const commandCache = new Map();
    const outcomes = [];
    while (pending.size) {
      const ready = [...pending.values()].filter((node) =>
        node.dependsOn.every((dependency) =>
          completed.has(dependency) ||
          receiptValidity(id, dependency).validity === "valid"));
      if (!ready.length)
        fail(`provider dependency cycle or blocked dependency: ${[...pending.keys()].join(", ")}`);
      const batch = [];
      for (const node of ready)
        if (batch.every((selected) => !resourcesConflict(selected.resources, node.resources)))
          batch.push(node);
      log(`EXECUTION ${proofRunId}: ${batch.map((node) => node.provider).join(", ")}`);
      const results = await Promise.all(batch.map((node) =>
        executeAdapter(id, node.provider, node.config, proofRunId, commandCache)));
      for (let index = 0; index < batch.length; index += 1) {
        pending.delete(batch[index].provider);
        outcomes.push({ provider: batch[index].provider, status: results[index].status });
        if (results[index].status === "pass")
          for (const covered of batch[index].covers) completed.add(covered);
        else
          logError(`PROVIDER ${batch[index].provider}: ${results[index].status}`);
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
