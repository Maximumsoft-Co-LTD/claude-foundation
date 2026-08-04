import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

export function createProofReadinessRuntime({
  evidence,
  loadRuntime,
  taskBlocks,
  activeChangePath,
  taskMetadata,
  canonicalChangedSurface,
  selectedRepositories,
  providerCapability,
  providerConfig,
  validate,
  relevantHash,
  executionNodes,
  pendingTasks,
  activeChangeLeases,
  changePath,
  proofPath,
  readJson,
  writeJson,
  saveRuntime,
  fail
}) {
  function topologyIssues(id) {
    const contract = evidence(id);
    const providers = contract.providers || {};
    const issues = [];
    const visiting = new Set();
    const visited = new Set();
    function visit(provider, trail = []) {
      if (visiting.has(provider)) {
        issues.push(`provider dependency cycle: ${[...trail, provider].join(" -> ")}`);
        return;
      }
      if (visited.has(provider) || !providers[provider]) return;
      visiting.add(provider);
      for (const dependency of providers[provider].dependsOn || [])
        visit(dependency, [...trail, provider]);
      visiting.delete(provider);
      visited.add(provider);
    }
    Object.keys(providers).forEach((provider) => visit(provider));

    const reportOwners = new Map();
    for (const [provider, config] of Object.entries(providers)) {
      if (config.report) {
        const key = config.report.replaceAll("\\", "/");
        const owner = reportOwners.get(key);
        const command = JSON.stringify(config.command || []);
        if (owner && owner.command !== command)
          issues.push(`structured report collision: ${key} (${owner.provider}, ${provider})`);
        else reportOwners.set(key, { provider, command });
      }
      if (config.readiness?.url && !config.readiness.expectBody &&
          !config.readiness.expectHeader)
        issues.push(`provider '${provider}' readiness lacks an identity body/header`);
    }

    const serviceResources = new Map();
    for (const [service, config] of Object.entries(contract.execution?.services || {})) {
      let port = null;
      try {
        port = new URL(config.readiness.url).port || null;
      } catch {}
      const resources = [...(config.resources || []), ...(port ? [`port:${port}`] : [])];
      for (const resource of resources) {
        const owner = serviceResources.get(resource);
        if (owner && owner !== service)
          issues.push(`service resource collision: ${resource} (${owner}, ${service})`);
        else serviceResources.set(resource, service);
      }
    }
    return issues;
  }

  function changedSurfaceIssues(id) {
    const state = loadRuntime(id);
    if (!state.repositories || Object.keys(state.repositories).length <= 1) return [];
    const tasks = taskBlocks(readFileSync(join(activeChangePath(id), "tasks.md"), "utf8"))
      .map(taskMetadata);
    const issues = [];
    const surface = canonicalChangedSurface(id, state);
    for (const repository of selectedRepositories(id, state)) {
      if (repository.mode !== "write") continue;
      const allowed = tasks.filter((task) => task.repository === repository.id)
        .flatMap((task) => task.paths);
      const changed = surface.filter((row) => row.repositoryId === repository.id)
        .map((row) => row.path);
      const outside = changed.filter((path) => !allowed.some((scope) => {
        const normalized = scope.replace(/\/\*\*?$/, "").replace(/\/$/, "");
        return scope === "*" || path === normalized || path.startsWith(`${normalized}/`);
      }));
      if (outside.length)
        issues.push(`repository '${repository.id}' changed outside task paths: ${outside.join(", ")}`);
    }
    return issues;
  }

  function externalEvidenceRecovery(id, provider) {
    const capability = providerCapability(provider, providerConfig(id, provider));
    if (capability === "review") return {
      provider,
      kind: "user-decision",
      request: {
        command: `claude-foundation authority request ${id} --type review`,
        packet: `claude-foundation packet ${id} --phase review`
      },
      decision: {
        kind: "independent-review",
        summary: "Automated evidence is ready, but an independent reviewer must inspect the current implementation before proof can finish.",
        options: [
          { id: "prepare-for-user", outcome: "Prepare a bounded review packet for the user to inspect." },
          { id: "prepare-for-reviewer", outcome: "Prepare the packet for a fresh independent reviewer." },
          { id: "pause", outcome: "Keep the change pending without recording a review result." }
        ],
        recommended: "prepare-for-reviewer",
        responseStatuses: ["pass", "fail", "inconclusive", "error"]
      }
    };
    if (capability === "acceptance") return {
      provider,
      kind: "user-decision",
      request: {
        command: `claude-foundation authority request ${id} --type acceptance`
      },
      decision: {
        kind: "human-acceptance",
        summary: "A named person must inspect the final result and decide whether the declared acceptance criteria are satisfied.",
        options: [
          { id: "inspect", outcome: "Inspect the final result and then accept, reject, or report uncertainty." },
          { id: "request-changes", outcome: "Reject the current result and describe what must change." },
          { id: "pause", outcome: "Keep the change pending without an acceptance decision." }
        ],
        recommended: "inspect",
        responseStatuses: ["pass", "fail", "inconclusive", "error"]
      }
    };
    return {
      provider,
      kind: "user-decision",
      decision: {
        kind: "external-evidence",
        summary: `Provider '${provider}' needs verifiable evidence from outside the local harness.`,
        options: [
          { id: "provide-evidence", outcome: "Provide a real external result and durable reference." },
          { id: "configure-provider", outcome: "Configure an equivalent project-owned executable provider." },
          { id: "pause", outcome: "Keep the change pending without claiming a result." }
        ],
        recommended: "provide-evidence",
        responseStatuses: ["pass", "fail", "inconclusive", "error"]
      }
    };
  }

  function unavailableProviderRecovery(id, unavailable) {
    const separator = unavailable.indexOf(":");
    const provider = separator === -1 ? unavailable : unavailable.slice(0, separator);
    const reason = separator === -1 ? "environment-unavailable" : unavailable.slice(separator + 1);
    const external = externalEvidenceRecovery(id, provider);
    return {
      provider,
      reason,
      choices: [
        {
          kind: "diagnose",
          command: `claude-foundation doctor --stage prove --change ${id}`
        },
        {
          kind: "retry",
          command: `claude-foundation proof run ${id}`
        },
        {
          kind: "external-evidence",
          ...external
        },
        {
          kind: "reconfigure",
          file: `openspec/changes/${id}/execution.yaml`,
          instruction: `Configure provider '${provider}' with an available project-owned command that proves the same declared claims.`,
          verify: `claude-foundation proof readiness ${id}`
        }
      ]
    };
  }

  function codeChangeRecovery(id, pending) {
    return [{
      kind: "resume-build",
      agentCommand: `/build ${id}`,
      inspect: `claude-foundation agents plan ${id} --pretty`,
      pendingTasks: pending.map((task) => task.id || task.text)
    }];
  }

  function configurationRecovery(id, issues) {
    return [
      {
        kind: "diagnose",
        command: `claude-foundation doctor --stage prove --change ${id}`
      },
      {
        kind: "revise-configuration",
        agentCommand: `/change ${id}`,
        files: [
          `openspec/changes/${id}/evidence.yaml`,
          `openspec/changes/${id}/execution.yaml`,
          `openspec/changes/${id}/repositories.yaml`
        ],
        issues,
        verify: `claude-foundation change validate ${id}`
      }
    ];
  }

  function activeWorkRecovery(id, leases) {
    return [{
      kind: "wait-for-active-work",
      instruction: "The host must wait for active workers or release stale leases; do not spend model budget while ownership is unresolved.",
      leases: leases.map((lease) => ({ taskId: lease.taskId, owner: lease.owner })),
      verify: `claude-foundation proof readiness ${id}`
    }];
  }

  function readinessBudgetPolicy(status) {
    if (["NEEDS_CODE_CHANGE", "CONFIGURATION_ERROR"].includes(status))
      return {
        eligible: true,
        class: "model-fix",
        reason: "required model-completable work remains"
      };
    if (status === "BLOCKED_BY_ACTIVE_WORK")
      return {
        eligible: false,
        class: "active-work",
        reason: "host-owned work or leases must finish first"
      };
    if (status === "NEEDS_USER_DECISION")
      return {
        eligible: false,
        class: "external-authority",
        reason: "external evidence cannot be produced with model budget"
      };
    if (status === "INFRASTRUCTURE_ERROR")
      return {
        eligible: false,
        class: "infrastructure",
        reason: "provider infrastructure must recover first"
      };
    return {
      eligible: false,
      class: "deterministic",
      reason: "run the ready deterministic operation"
    };
  }

  function proofReadinessValue(id, stage = "prove") {
    validate(id, "active", { quiet: true });
    const issues = topologyIssues(id);
    if (stage === "prove") issues.push(...changedSurfaceIssues(id));
    const hash = relevantHash(id);
    const { unconfigured, unavailable } = executionNodes(id, hash);
    const pending = pendingTasks(id);
    const leases = stage === "prove" ? activeChangeLeases(id) : [];
    const status = pending.length ? "NEEDS_CODE_CHANGE"
      : issues.length ? "CONFIGURATION_ERROR"
        : leases.length ? "BLOCKED_BY_ACTIVE_WORK"
          : unavailable.length ? "INFRASTRUCTURE_ERROR"
          : unconfigured.length ? "NEEDS_USER_DECISION" : "READY";
    return {
      version: 1,
      changeId: id,
      stage,
      status,
      workspaceHash: hash,
      pendingTasks: pending.map((task) => task.id || task.text),
      externalProviders: unconfigured,
      unavailableProviders: unavailable,
      activeLeases: leases.map((lease) => ({ taskId: lease.taskId, owner: lease.owner })),
      issues,
      budget: readinessBudgetPolicy(status),
      next: status === "NEEDS_CODE_CHANGE"
        ? codeChangeRecovery(id, pending)
        : status === "CONFIGURATION_ERROR"
          ? configurationRecovery(id, issues)
          : status === "BLOCKED_BY_ACTIVE_WORK"
            ? activeWorkRecovery(id, leases)
            : status === "NEEDS_USER_DECISION"
              ? unconfigured.map((provider) => externalEvidenceRecovery(id, provider))
              : status === "INFRASTRUCTURE_ERROR"
                ? unavailable.map((provider) => unavailableProviderRecovery(id, provider))
                : []
    };
  }

  function proofReadiness(id, stage = "prove") {
    const value = proofReadinessValue(id, stage);
    console.log(JSON.stringify(value, null, 2));
    if (value.status !== "READY") process.exitCode = 2;
    return value;
  }

  function proofPreflight(id, stage = "prove", quiet = false) {
    const value = proofReadinessValue(id, stage);
    const blockers = [
      ...value.issues,
      ...value.externalProviders.map((provider) =>
        `provider '${provider}' has no executable adapter or valid external receipt`),
      ...value.unavailableProviders.map((provider) => `provider unavailable: ${provider}`)
    ];
    if (value.pendingTasks.length)
      blockers.push(`${value.pendingTasks.length} implementation task(s) remain unchecked`);
    if (blockers.length) fail(`proof preflight failed: ${blockers.join("; ")}`);
    if (!quiet)
      console.log(`PROOF PREFLIGHT ${id}: ready\n  stage: ${stage}\n  workspace: ${value.workspaceHash}`);
    return true;
  }

  function upgradeEvidence(id) {
    const state = loadRuntime(id);
    if (state.status === "archived") fail(`change '${id}' is already archived`);
    const path = join(changePath(id), "evidence.yaml");
    const value = readJson(path);
    if (![1, 2].includes(value.version))
      fail(`cannot upgrade unknown evidence version '${value.version}'`);
    if (value.version === 1) value.version = 2;
    const executionPath = join(changePath(id), "execution.yaml");
    const currentExecution = existsSync(executionPath)
      ? readJson(executionPath) : { version: 1, providers: {}, services: {} };
    currentExecution.providers = {
      ...(value.providers || {}),
      ...(currentExecution.providers || {})
    };
    delete value.providers;
    writeJson(path, value);
    writeJson(executionPath, currentExecution);
    state.version = 2;
    state.revision = Number(state.revision || 0) + 1;
    state.executionRevision = Number(state.executionRevision || 0) + 1;
    delete state.provenHash;
    if (existsSync(proofPath(id))) rmSync(proofPath(id));
    saveRuntime(state);
    console.log(`EVIDENCE ${id}: contract and execution wiring separated\n  configure execution.yaml before proof execute`);
  }

  return {
    activeWorkRecovery,
    changedSurfaceIssues,
    codeChangeRecovery,
    configurationRecovery,
    externalEvidenceRecovery,
    proofPreflight,
    proofReadiness,
    proofReadinessValue,
    readinessBudgetPolicy,
    topologyIssues,
    unavailableProviderRecovery,
    upgradeEvidence
  };
}
