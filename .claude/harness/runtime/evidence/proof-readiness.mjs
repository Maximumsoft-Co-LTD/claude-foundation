import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dependentClosure } from "../core/graph-execution.mjs";

export function recoverySummaryLine(entry) {
  const heading = entry.provider ? `${entry.provider}: ` : "";
  if (entry.decision?.summary) return `  ${heading}${entry.decision.summary}`;
  if (entry.reason) return `  ${heading}${entry.reason}`;
  return null;
}

export function recoveryCommands(entry) {
  return [...new Set([
    entry.wiring?.command,
    entry.request?.command,
    entry.request?.packet,
    entry.verify,
    ...(entry.choices || []).map((choice) => choice?.command || choice?.verify)
  ].filter(Boolean))];
}

export function recoveryInstructions(entry) {
  const outcomes = (entry.decision?.options || [])
    .map((option) => option?.outcome).filter(Boolean);
  const choices = (entry.choices || [])
    .map((choice) => choice?.instruction).filter(Boolean);
  return [...outcomes, ...choices];
}

export function recoveryLines(next = []) {
  const lines = [];
  for (const entry of next) {
    if (!entry) continue;
    const summary = recoverySummaryLine(entry);
    if (summary) lines.push(summary);
    lines.push(...recoveryCommands(entry).map((command) => `    ${command}`));
    lines.push(...recoveryInstructions(entry).map((instruction) => `    - ${instruction}`));
  }
  return lines;
}

export function proofPreflightBlockers(value) {
  const blockers = [
    ...value.issues,
    ...value.externalProviders.map((provider) =>
      `provider '${provider}' has no executable adapter or valid external receipt`),
    ...value.unavailableProviders.map((provider) => `provider unavailable: ${provider}`)
  ];
  if (value.pendingTasks.length)
    blockers.push(`${value.pendingTasks.length} implementation task(s) remain unchecked`);
  return blockers;
}

export function proofPreflightFailure(id, value, blockers, recovery) {
  return `proof preflight failed: ${blockers.join("; ")}${
    recovery.length ? `\n\nhow to clear this (${value.status}):\n${recovery.join("\n")}` : ""
  }\n\nfull detail: claude-foundation proof readiness ${id}`;
}

export function proofPreflightAdvisory(advisory) {
  if (advisory.reason === "user-waived")
    return `  WAIVED ${advisory.capability}: withdrawn by ${
      advisory.authority?.reference || "user decision"}${
      advisory.detail ? ` — ${advisory.detail}` : ""}; not blocking`;
  return `  ADVISORY ${advisory.capability}: inferred from ${
    advisory.trigger || "the changed surface"} with no provider wired; not blocking`;
}

export function proofPreflightOperation({
  proofReadinessValue,
  recoveryLines,
  fail,
  output = console
}, id, stage = "prove", quiet = false) {
  const value = proofReadinessValue(id, stage);
  const blockers = proofPreflightBlockers(value);
  if (blockers.length)
    fail(proofPreflightFailure(id, value, blockers, recoveryLines(value.next)));
  if (!quiet) {
    output.log(`PROOF PREFLIGHT ${id}: ready\n  stage: ${stage}\n  workspace: ${value.workspaceHash}`);
    for (const advisory of value.advisories || [])
      output.error(proofPreflightAdvisory(advisory));
  }
  return true;
}

export function reviewEvidenceRecovery(id, provider) {
  return {
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
        { id: "prepare-for-reviewer", outcome: "Run the configured fresh reviewer. A Codex-only or Claude-Code-only project may commit review.diversity='single-model' while keeping identity/session independence required." },
        { id: "waive-independence", outcome: "Only if the project deliberately accepts the same reviewer identity/session, set review.independence='self'; the receipt records that independence was not observed." },
        { id: "pause", outcome: "Keep the change pending without recording a review result." }
      ],
      recommended: "prepare-for-reviewer",
      responseStatuses: ["pass", "fail", "inconclusive", "error"]
    }
  };
}

export function acceptanceEvidenceRecovery(id, provider, acceptance = {}) {
  const claimIds = acceptance.claimIds || [];
  const origin = acceptance.scopeOrigin || "explicit";
  const withdrawal = origin === "claim-capability"
    ? `Drop capability 'acceptance' from claim(s) ${claimIds.join(", ") || "in evidence.yaml"}, then re-run 'claude-foundation change validate ${id}'. Clearing the resolve flag alone will not lift this gate while the claim declares it.`
    : `Withdraw the requirement: claude-foundation change resolve ${id} --acceptance-not-required`;
  return {
    provider,
    kind: "user-decision",
    request: { command: `claude-foundation authority request ${id} --type acceptance` },
    decision: {
      kind: "human-acceptance",
      summary: `A named person must inspect the final result and decide whether the declared acceptance criteria are satisfied${
        claimIds.length ? ` for claim(s) ${claimIds.join(", ")}` : ""}.`,
      scope: {
        claims: claimIds,
        origin,
        reason: acceptance.reason || null,
        detail: origin === "claim-capability"
          ? "These claims declare capability 'acceptance' in evidence.yaml; that declaration, not the resolve flag, is what requires a human here."
          : "This gate was recorded by an explicit --acceptance-required decision."
      },
      options: [
        { id: "inspect", outcome: "Inspect the final result and then accept, reject, or report uncertainty." },
        { id: "request-changes", outcome: "Reject the current result and describe what must change." },
        { id: "withdraw-requirement", outcome: withdrawal },
        { id: "pause", outcome: "Keep the change pending without an acceptance decision." }
      ],
      recommended: "inspect",
      responseStatuses: ["pass", "fail", "inconclusive", "error"]
    }
  };
}

export function genericExternalEvidenceRecovery(provider, wiring) {
  return {
    provider,
    kind: "user-decision",
    ...(wiring ? { wiring } : {}),
    decision: {
      kind: "external-evidence",
      summary: wiring
        ? `Provider '${provider}' has no adapter yet, but this project already owns a command that can prove it (${wiring.source}).`
        : `Provider '${provider}' needs verifiable evidence from outside the local harness.`,
      options: [
        ...(wiring ? [{ id: "wire-provider", outcome: `Wire the project-owned command detected at ${wiring.source}.` }] : []),
        { id: "provide-evidence", outcome: "Provide a real external result and durable reference." },
        { id: "configure-provider", outcome: "Configure an equivalent project-owned executable provider." },
        { id: "pause", outcome: "Keep the change pending without claiming a result." }
      ],
      recommended: wiring ? "wire-provider" : "provide-evidence",
      responseStatuses: ["pass", "fail", "inconclusive", "error"]
    }
  };
}

export function externalEvidenceRecoveryOperation({
  providerCapability,
  providerConfig,
  loadRuntime,
  wiringChoice
}, id, provider) {
  const capability = providerCapability(provider, providerConfig(id, provider));
  if (capability === "review") return reviewEvidenceRecovery(id, provider);
  if (capability === "acceptance")
    return acceptanceEvidenceRecovery(id, provider, loadRuntime(id).acceptance || {});
  return genericExternalEvidenceRecovery(provider, wiringChoice(id, provider));
}

export function repositoryRuntimeState(state, repository) {
  return state.repositories?.[repository.id] ||
    (repository.id === "root" ? state.workspace : null) || {};
}

export function repositoryInfrastructureIssueRows({
  provider,
  repository,
  runtime,
  pathExists,
  git
}) {
  if (!pathExists(repository.workspacePath))
    return [`provider '${provider}' repository '${repository.id}' workspace is missing`];
  const issues = [];
  if (repository.mode === "read" && runtime.mode === "reference")
    issues.push(`provider '${provider}' repository '${repository.id}' is a live reference, not an isolated workspace`);
  if (runtime.setup?.status === "failed")
    issues.push(`provider '${provider}' repository '${repository.id}' setup failed`);
  if (repository.mode === "read" && runtime.mode === "worktree") {
    const changed = git(["status", "--porcelain"], repository.workspacePath);
    if (changed.status !== 0 || changed.stdout.trim())
      issues.push(`provider '${provider}' read-only repository '${repository.id}' changed: ${
        changed.stdout.trim() || changed.stderr.trim() || "git status failed"}`);
  }
  return issues;
}

export function repositoryInfrastructureIssuesOperation({
  loadRuntime,
  requiredProviders,
  providerConfig,
  providerRepositories,
  pathExists,
  git
}, id) {
  const state = loadRuntime(id);
  const issues = [];
  for (const provider of requiredProviders(id)) {
    const config = providerConfig(id, provider) || {};
    for (const repository of providerRepositories(id, provider, config))
      issues.push(...repositoryInfrastructureIssueRows({
        provider,
        repository,
        runtime: repositoryRuntimeState(state, repository),
        pathExists,
        git
      }));
  }
  return [...new Set(issues)];
}

export function visitProviderTopology(providers, provider, trail, state) {
  if (state.visiting.has(provider)) {
    state.issues.push(`provider dependency cycle: ${[...trail, provider].join(" -> ")}`);
    return;
  }
  if (state.visited.has(provider) || !providers[provider]) return;
  state.visiting.add(provider);
  for (const dependency of providers[provider].dependsOn || [])
    visitProviderTopology(providers, dependency, [...trail, provider], state);
  state.visiting.delete(provider);
  state.visited.add(provider);
}

export function providerDependencyIssues(providers) {
  const state = {
    issues: [],
    visiting: new Set(),
    visited: new Set()
  };
  for (const provider of Object.keys(providers))
    visitProviderTopology(providers, provider, [], state);
  return state.issues;
}

export function providerReportIssues(providers) {
  const issues = [];
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
  return issues;
}

export function serviceResourceIssues(services = {}) {
  const issues = [];
  const owners = new Map();
  for (const [service, config] of Object.entries(services)) {
    let port = null;
    try { port = new URL(config.readiness.url).port || null; } catch {}
    const resources = [...(config.resources || []), ...(port ? [`port:${port}`] : [])];
    for (const resource of resources) {
      const owner = owners.get(resource);
      if (owner && owner !== service)
        issues.push(`service resource collision: ${resource} (${owner}, ${service})`);
      else owners.set(resource, service);
    }
  }
  return issues;
}

export function topologyIssuesOperation({ evidence }, id) {
  const contract = evidence(id);
  const providers = contract.providers || {};
  return [
    ...providerDependencyIssues(providers),
    ...providerReportIssues(providers),
    ...serviceResourceIssues(contract.execution?.services)
  ];
}

export function upgradeEvidenceOperation({
  loadRuntime,
  fail,
  changePath,
  proofPath,
  readJson,
  writeJson,
  saveRuntime,
  pathExists = existsSync,
  remove = rmSync,
  output = console
}, id) {
  const state = loadRuntime(id);
  if (state.status === "archived") fail(`change '${id}' is already archived`);
  const path = join(changePath(id), "evidence.yaml");
  const value = readJson(path);
  if (![1, 2].includes(value.version))
    fail(`cannot upgrade unknown evidence version '${value.version}'`);
  if (value.version === 1) value.version = 2;
  const executionPath = join(changePath(id), "execution.yaml");
  const currentExecution = pathExists(executionPath)
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
  if (pathExists(proofPath(id))) remove(proofPath(id));
  saveRuntime(state);
  output.log(`EVIDENCE ${id}: contract and execution wiring separated\n  configure execution.yaml before proof execute`);
}

export function readinessStatus({
  pending, issues, leases, repositoryConflicts,
  unavailable, repositoryIssues, unconfigured
}) {
  if (pending.length) return "NEEDS_CODE_CHANGE";
  if (issues.length) return "CONFIGURATION_ERROR";
  if (leases.length || repositoryConflicts.length) return "BLOCKED_BY_ACTIVE_WORK";
  if (unavailable.length || repositoryIssues.length) return "INFRASTRUCTURE_ERROR";
  if (unconfigured.length) return "NEEDS_USER_DECISION";
  return "READY";
}

export function readinessGraph(plan, pending) {
  if (!plan?.graph) return null;
  const pendingNodeIds = pending.map((task) => `task:${task.id}`).filter((nodeId) =>
    plan.graph.nodes.some((node) => node.id === nodeId));
  const blockedNodes = dependentClosure(plan.graph, pendingNodeIds);
  const completedTaskNodes = plan.graph.nodes.filter((node) =>
    node.kind === "task" && !pendingNodeIds.includes(node.id)).map((node) => node.id);
  return {
    version: plan.graph.version,
    revision: plan.graph.revision,
    identity: plan.graph.identity,
    nodeCount: plan.graph.nodes.length,
    edgeCount: plan.graph.edges.length,
    pendingNodes: pendingNodeIds,
    affectedNodes: blockedNodes,
    preservedNodes: completedTaskNodes.filter((node) => !blockedNodes.includes(node))
  };
}

export function readinessNext(context, input) {
  const {
    id, status, pending, issues, surfaceFixits, leases,
    repositoryConflicts, unconfigured, unavailable
  } = input;
  if (status === "NEEDS_CODE_CHANGE") return context.codeChangeRecovery(id, pending);
  if (status === "CONFIGURATION_ERROR")
    return context.configurationRecovery(id, issues, surfaceFixits);
  if (status === "BLOCKED_BY_ACTIVE_WORK")
    return context.activeWorkRecovery(id, leases, repositoryConflicts);
  if (status === "NEEDS_USER_DECISION")
    return unconfigured.map((provider) => context.externalEvidenceRecovery(id, provider));
  if (status === "INFRASTRUCTURE_ERROR")
    return unavailable.map((provider) => context.unavailableProviderRecovery(id, provider));
  return [];
}

export function proofReadinessValueOperation(context, id, stage = "prove") {
  context.validate(id, "active", { quiet: true });
  const issues = context.topologyIssues(id);
  const surfaceFixits = [];
  if (stage === "prove") issues.push(...context.changedSurfaceIssues(id, surfaceFixits));
  if (stage === "prove") issues.push(...context.criticalCaseIssues(id));
  const hash = context.relevantHash(id);
  const { unconfigured, unavailable } = context.executionNodes(id, hash);
  const repositoryIssues = stage === "prove"
    ? context.repositoryInfrastructureIssues(id) : [];
  const pending = context.pendingTasks(id);
  const plan = context.agentPlanValue?.(id) || null;
  const externalOperations = context.handoffReadiness(id);
  const leases = stage === "prove" ? context.activeChangeLeases(id) : [];
  const repositoryConflicts = context.activeRepositoryConflicts(
    id, context.selectedRepositories(id), { executing: true });
  const status = readinessStatus({
    pending, issues, leases, repositoryConflicts,
    unavailable, repositoryIssues, unconfigured
  });
  return {
    version: 1,
    changeId: id,
    stage,
    status,
    workspaceHash: hash,
    pendingTasks: pending.map((task) => task.id || task.text),
    externalOperations: {
      ...externalOperations,
      proofBlocking: false,
      note: "External operations are handed off during Prove and are evaluated at Land by timing and activation safety."
    },
    externalProviders: unconfigured,
    unavailableProviders: unavailable,
    repositoryIssues,
    activeLeases: leases.map((lease) => ({
      taskId: lease.taskId, owner: lease.owner, expiresAt: lease.expiresAt || null
    })),
    repositoryConflicts,
    graph: readinessGraph(plan, pending),
    issues,
    advisories: context.advisoryCapabilities(id),
    budget: context.readinessBudgetPolicy(status),
    next: readinessNext(context, {
      id, status, pending, issues, surfaceFixits, leases,
      repositoryConflicts, unconfigured, unavailable
    })
  };
}

export function createProofReadinessRuntime({
  markBlocked = () => {},
  evidence,
  loadRuntime,
  taskBlocks,
  activeChangePath,
  taskMetadata,
  canonicalChangedSurface,
  selectedRepositories,
  providerCapability,
  providerConfig,
  providerRepositories = (id, provider, config = providerConfig(id, provider)) =>
    config?.repository
      ? selectedRepositories(id).filter((repository) => repository.id === config.repository)
      : selectedRepositories(id),
  requiredProviders = (id) => Object.keys(evidence(id).providers || {}),
  git = () => ({ status: 0, stdout: "", stderr: "" }),
  advisoryCapabilities,
  evidenceDetectionValue,
  validate,
  relevantHash,
  executionNodes,
  pendingTasks,
  handoffReadiness = (id) => ({
    version: 1, changeId: id, status: "COMPLETE",
    operations: [], blocking: [], tracked: []
  }),
  activeChangeLeases,
  activeRepositoryConflicts,
  agentPlanValue = null,
  changePath,
  proofPath,
  readJson,
  writeJson,
  saveRuntime,
  fail
}) {
  const repositoryInfrastructureIssues = repositoryInfrastructureIssuesOperation.bind(null, {
    loadRuntime,
    requiredProviders,
    providerConfig,
    providerRepositories,
    pathExists: existsSync,
    git
  });

  const topologyIssues = topologyIssuesOperation.bind(null, { evidence });

  // `details`, when supplied, collects `{ repositoryId, paths }` per blocked
  // repository so the recovery can render a paste-ready annotation. The string
  // return stays as-is — proof-runtime consumes it verbatim.
  function changedSurfaceIssues(id, details = null) {
    const state = loadRuntime(id);
    const tasks = taskBlocks(readFileSync(join(activeChangePath(id), "tasks.md"), "utf8"))
      .map(taskMetadata);
    const generatedReports = Object.keys(evidence(id).providers || {}).map((provider) => {
      const config = providerConfig(id, provider) || {};
      return { repository: config.repository || "root", path: config.report || null };
    }).filter((row) => row.path);
    const issues = [];
    const surface = canonicalChangedSurface(id, state);
    for (const repository of selectedRepositories(id, state)) {
      if (repository.mode !== "write") continue;
      const allowed = tasks.filter((task) => task.repository === repository.id)
        .flatMap((task) => task.paths);
      const repositoryWide = tasks.some((task) => task.repository === repository.id &&
        (!(task.paths || []).length || task.paths.includes("*")));
      const changed = surface.filter((row) => row.repositoryId === repository.id)
        .map((row) => row.path);
      const outside = repositoryWide ? [] : changed.filter((path) =>
        !generatedReports.some((report) => report.repository === repository.id &&
          report.path === path) && !allowed.some((scope) => {
        const normalized = scope.replace(/\/\*\*?$/, "").replace(/\/$/, "");
        return scope === "*" || path === normalized || path.startsWith(`${normalized}/`);
      }));
      if (outside.length) {
        // Work landing in the root workspace while every implementation task
        // targets a child repository is almost always a misplaced sandbox:
        // `.foundation/sandboxes/<id>` (root workspace) sits next to
        // `.foundation/repository-sandboxes/<id>/<repo>` (per-repository
        // workspaces) and agents have written into the wrong one. Name that
        // exit instead of leaving only a path list.
        const childTaskIds = [...new Set(tasks
          .filter((task) => task.repository !== "root").map((task) => task.repository))];
        const misplacedHint = repository.id === "root" && childTaskIds.length &&
          !tasks.some((task) => task.repository === "root")
          ? `; all implementation tasks target ${childTaskIds.map((repo) =>
            `'${repo}'`).join(", ")} — if this work belongs there, move it into ` +
            ".foundation/repository-sandboxes/<change>/<repository> (the root " +
            "workspace under .foundation/sandboxes/ is a different checkout)"
          : "";
        issues.push(`repository '${repository.id}' changed outside task paths: ${
          outside.join(", ")}${misplacedHint}`);
        details?.push({ repositoryId: repository.id, paths: outside });
      }
    }
    return issues;
  }

  // A declared critical case is only matched after the suite runs, against the
  // titles in the report (`criticalCaseResult`). So a Build that declares an ID
  // in execution.yaml and never tags the covering test hands Prove a change
  // that looks ready — `pendingTasks` empty, every automated provider wired —
  // and then fails evidence collection on `test:fail` every single time. The
  // gap is Build-scope work, so it has to surface before the handoff, not after
  // it.
  //
  // The check is a necessary condition, never a sufficient one: the ID must
  // appear literally somewhere in the workspace for the title match to be
  // possible at all, but a present ID can still fail or be skipped at run time.
  // That asymmetry is deliberate — this must not block a change whose evidence
  // would otherwise have passed. For the same reason only an explicit `no
  // match` (git grep exit 1) counts; any other exit means the search itself did
  // not answer, and an unanswered search is not a defect. A copy-mode sandbox
  // created from a project that carries no git leaves the guard inert rather
  // than guessing — the same trade, taken knowingly.
  function criticalCaseIssues(id) {
    // Keyed by case ID, not by provider: `test-discovery` runs one command
    // for two providers off one config, so a per-provider loop reports a
    // single missing tag twice under two provider names.
    const declared = new Map();
    for (const provider of requiredProviders(id)) {
      const config = providerConfig(id, provider) || {};
      if (!(config.criticalCases || []).length) continue;
      // A provider without an explicit `repository` runs against every
      // selected repository, and its tests live in exactly one of them.
      // Requiring the ID in all of them would invent a blocker on every
      // multi-repository change.
      const repositories = providerRepositories(id, provider, config)
        .filter((repository) => existsSync(repository.workspacePath));
      if (!repositories.length) continue;
      for (const caseId of config.criticalCases) {
        const entry = declared.get(caseId) ||
          { providers: new Set(), repositories: new Map() };
        entry.providers.add(provider);
        for (const repository of repositories)
          entry.repositories.set(repository.id, repository);
        declared.set(caseId, entry);
      }
    }
    const issues = [];
    for (const [caseId, entry] of declared) {
      const repositories = [...entry.repositories.values()];
      const searches = repositories.map((repository) => git([
        // `--untracked`: Build's new test file is not committed in the
        // sandbox yet, and it is the file most likely to carry the tag.
        "grep", "--untracked", "-I", "-l", "-F", "-e", caseId, "--", ".",
        // The change packet declares the ID: `execution.yaml` and
        // `grounding.yaml` both name it, so searching it would match every
        // declared case against its own declaration and never find a gap.
        // `.foundation` holds nested workspaces carrying the same packet.
        ":(exclude)openspec/changes", ":(exclude).foundation"
      ], repository.workspacePath));
      if (searches.some((found) => found.status === 0)) continue;
      if (!searches.every((found) => found.status === 1)) continue;
      issues.push(`critical case '${caseId}' declared by provider ${
        [...entry.providers].map((provider) => `'${provider}'`).join(", ")
      } appears in no file under ${
        repositories.map((repository) => `'${repository.id}'`).join(", ")
      }: tag the covering test title with [${caseId}] so the receipt can bind it`);
    }
    return issues;
  }

  // An unconfigured provider is not always a person-shaped problem: when the
  // project already owns a safe command for that capability, the fix is a write
  // to execution.yaml, not a wait for a human. Detection knows which providers
  // those are, so the recovery names the wiring route first instead of routing
  // every unconfigured provider through an external-evidence decision that most
  // of them never needed.
  function wiringChoice(id, provider) {
    let detection;
    try { detection = evidenceDetectionValue(id); }
    catch { return null; }
    const candidate = (detection.candidates || []).find((row) =>
      row.provider === provider && row.recommended && row.config);
    if (!candidate) return null;
    return {
      kind: "configure-provider",
      command: `claude-foundation evidence init ${id} --write`,
      source: candidate.source,
      instruction: `Wire provider '${provider}' from the project-owned command detected at ${
        candidate.source}, then re-run proof.`,
      verify: `claude-foundation proof readiness ${id}`
    };
  }

  const externalEvidenceRecovery = externalEvidenceRecoveryOperation.bind(null, {
    providerCapability,
    providerConfig,
    loadRuntime,
    wiringChoice
  });

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

  function configurationRecovery(id, issues, surfaceFixits = []) {
    return [
      // The changed-surface blocker already names every offending path; this
      // entry restates them in the exact form `tasks.md` accepts, so clearing
      // the block is a paste instead of a reconstruction.
      ...(surfaceFixits.length ? [{
        kind: "declare-surface",
        reason: `append each listed annotation to the owning task's [paths:] in openspec/changes/${id}/tasks.md, then rerun readiness`,
        choices: surfaceFixits.map((fixit) => ({
          instruction: `repository '${fixit.repositoryId}': [paths:${fixit.paths.join(",")}]`
        }))
      }] : []),
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

  function activeWorkRecovery(id, leases, repositoryConflicts = []) {
    return [{
      kind: "wait-for-active-work",
      instruction: "The host must wait for active workers or release stale leases; do not spend model budget while ownership is unresolved.",
      leases: leases.map((lease) => ({
        taskId: lease.taskId, owner: lease.owner, expiresAt: lease.expiresAt || null
      })),
      // Another change holding write scope on a repository this proof would
      // execute in. Naming it is the difference between "wait" and "wait for
      // what": nothing else in the output identifies the other change.
      repositoryConflicts: repositoryConflicts.map((conflict) => ({
        changeId: conflict.changeId,
        repository: conflict.repository,
        status: conflict.status,
        note: "Land or retire that change before proving this one; both would execute against the same repository."
      })),
      // Telling the host to release a stale lease is only actionable if the
      // release it can actually run is named: a crashed worker never comes back
      // to release its own.
      choices: leases.map((lease) => ({
        kind: "release-stale-lease",
        taskId: lease.taskId,
        expiresAt: lease.expiresAt || null,
        command: `claude-foundation agents release ${id} ${lease.taskId} --owner ${lease.owner} --force`,
        note: "A lease that has not expired also requires --decision-ref, because the worker holding it may still be running."
      })),
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

  const proofReadinessValueFor = proofReadinessValueOperation.bind(null, {
    validate,
    topologyIssues,
    changedSurfaceIssues,
    criticalCaseIssues,
    relevantHash,
    executionNodes,
    repositoryInfrastructureIssues,
    pendingTasks,
    agentPlanValue,
    handoffReadiness,
    activeChangeLeases,
    activeRepositoryConflicts,
    selectedRepositories,
    advisoryCapabilities,
    readinessBudgetPolicy,
    codeChangeRecovery,
    configurationRecovery,
    activeWorkRecovery,
    externalEvidenceRecovery,
    unavailableProviderRecovery
  });
  function proofReadinessValue(id, stage = "prove") {
    return proofReadinessValueFor(id, stage);
  }

  function proofReadiness(id, stage = "prove") {
    const value = proofReadinessValue(id, stage);
    console.log(JSON.stringify(value, null, 2));
    // A non-ready readiness is a typed lifecycle stop, so it says so rather
    // than leaving the exit handler to infer it from the exit code.
    if (value.status !== "READY") { markBlocked(); process.exitCode = 2; }
    return value;
  }

  // `proofReadinessValue` has always carried a full recovery under `next`, and
  // every caller that stopped on it threw the recovery away and printed the
  // blocker list alone. That is the whole reason a blocked Prove read as a dead
  // end: the way out was computed, then discarded one frame before the person
  // who needed it. Render it as prose here — `/prove` is told not to expose raw
  // readiness JSON, so JSON is not a substitute for saying the next command.
  const proofPreflight = proofPreflightOperation.bind(null, {
    proofReadinessValue,
    recoveryLines,
    fail
  });

  const upgradeEvidence = upgradeEvidenceOperation.bind(null, {
    loadRuntime,
    fail,
    changePath,
    proofPath,
    readJson,
    writeJson,
    saveRuntime
  });

  return {
    activeWorkRecovery,
    changedSurfaceIssues,
    codeChangeRecovery,
    criticalCaseIssues,
    configurationRecovery,
    externalEvidenceRecovery,
    proofPreflight,
    proofReadiness,
    proofReadinessValue,
    recoveryLines,
    readinessBudgetPolicy,
    topologyIssues,
    unavailableProviderRecovery,
    upgradeEvidence
  };
}
