import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export function createPacketRuntime({
  ROOT, EXCLUDED_WORKSPACE_DIRS, PROVIDERS, PACKET_SCHEMA_VERSION,
  REVIEW_PACKET_SCHEMA_VERSION, gitHead, git, workspaceManifest, loadRuntime,
  selectedRepositories, isCurrentChangePath, readJson, activeChangePath,
  evidence, taskBlocks, taskMetadata, repositoryById, claimsForProvider,
  relevantSnapshot, snapshotPath, singleRelevantSnapshot, requiredProviders,
  receiptValidity, providerConfig, adapterResources, stableHash, compactStrings,
  modelForTask, compactList, fileDigest, directoryHash, ensureBudgetState,
  budgetDecision, scopedReviewClaims, relevantHash, providerCapability,
  receiptPath, contractFingerprint, reviewPolicy, resolvedAcceptance,
  serializedJson, foundationPolicy, recordContextMetric, recordInstructionManifest,
  fail
}) {
  const die = fail;
  const policyCache = new Map();
  function changedFilesInWorkspace(id, workspace, knownHead = undefined) {
    const head = knownHead === undefined ? gitHead(workspace) : knownHead;
    if (head) {
      const result = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], workspace);
      if (result.status === 0) {
        const records = result.stdout.split("\0").filter(Boolean);
        const paths = [];
        for (let index = 0; index < records.length; index += 1) {
          const record = records[index];
          const status = record.slice(0, 2);
          paths.push(record.slice(3));
          if (/[RC]/.test(status) && records[index + 1]) paths.push(records[++index]);
        }
        return [...new Set(paths)].sort();
      }
    }
    return [];
  }
  
  function changedFiles(id, state) {
    const workspace = state.workspace?.path || ROOT;
    const gitFiles = changedFilesInWorkspace(id, workspace);
    if (gitHead(workspace)) return gitFiles;
    if (state.workspace?.mode === "copy" && state.workspace.baseline) {
      const current = workspaceManifest(workspace, id, true);
      return [...new Set([
        ...Object.keys(state.workspace.baseline), ...Object.keys(current)
      ])].filter((path) => state.workspace.baseline[path] !== current[path]).sort();
    }
    return [];
  }
  
  function canonicalChangedSurface(id, state = loadRuntime(id)) {
    const repositories = selectedRepositories(id, state);
    const rows = [];
    for (const repository of repositories) {
      const workspace = repository.workspacePath;
      const sources = new Map();
      const add = (path, source) => {
        if (!path) return;
        const normalized = path.replaceAll("\\", "/");
        if (EXCLUDED_WORKSPACE_DIRS.has(normalized.split("/")[0])) return;
        if (repository.id === "root" &&
            (isCurrentChangePath(normalized, id) || normalized.startsWith("openspec/changes/"))) return;
        if (!sources.has(normalized)) sources.set(normalized, new Set());
        sources.get(normalized).add(source);
      };
      const head = gitHead(workspace);
      if (head) {
        const baseHead = repository.id === "root"
          ? state.repositories?.root?.baseHead || state.workspace?.baseHead || null
          : state.repositories?.[repository.id]?.baseHead || null;
        if (!baseHead)
          die(`cannot resolve changed surface for repository '${repository.id}': missing baseHead; sync or recreate the change sandbox`);
        if (baseHead !== head) {
          const committed = git(["diff", "--name-only", "-z", `${baseHead}...HEAD`], workspace);
          if (committed.status !== 0)
            die(`cannot resolve changed surface for repository '${repository.id}' from base ${baseHead}`);
          committed.stdout.split("\0").filter(Boolean).forEach((path) => add(path, "committed"));
        }
        changedFilesInWorkspace(id, workspace, head).forEach((path) => add(path, "dirty"));
      } else if (repository.id === "root") {
        changedFiles(id, state).forEach((path) => add(path, "dirty"));
      }
      for (const [path, rowSources] of sources)
        rows.push({ repositoryId: repository.id, path, sources: [...rowSources].sort() });
    }
    return rows.sort((left, right) =>
      left.repositoryId.localeCompare(right.repositoryId) || left.path.localeCompare(right.path));
  }
  
  function policyAnalysis(id) {
    if (policyCache.has(id)) return policyCache.get(id);
    const state = loadRuntime(id);
    const files = canonicalChangedSurface(id, state)
      .map((row) => `${row.repositoryId}/${row.path}`);
    const relevantFiles = files
      .filter((path) => !path.startsWith("openspec/changes/") &&
        !path.startsWith("root/openspec/changes/"));
    const defaults = [
      {
        patterns: [/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/,
          /(^|\/)(package\.json|composer\.json|Cargo\.toml|go\.mod|Gemfile)$/],
        capabilities: ["dependency-supply-chain"]
      },
      {
        patterns: [/(^|\/)(migrations?|schema|ddl)(\/|\.|$)/i],
        capabilities: ["data-migration"]
      },
      {
        patterns: [/\.(tsx|jsx|vue|svelte|html|css|scss)$/i],
        capabilities: ["accessibility"]
      },
      {
        patterns: [/(^|\/)(openapi|swagger|asyncapi|proto|contracts?)(\/|\.|$)/i],
        capabilities: ["compatibility"]
      },
      {
        patterns: [/(^|\/)(auth|identity|permissions?|sessions?|tokens?)(\/|\.|$)/i],
        capabilities: ["security-static", "review"]
      },
      {
        patterns: [/(^|\/)(Dockerfile|deploy|deployment|helm|terraform|infra)(\/|\.|$)/i,
          /(^|\/)\.github\/workflows\//],
        capabilities: ["deployment"]
      }
    ];
    const required = new Set();
    // Remember which file pulled each capability in. A requirement whose cause
    // is not stated can only be diagnosed by reading this function.
    const triggers = {};
    const require = (capability, path) => {
      required.add(capability);
      (triggers[capability] ||= []).push(path);
    };
    for (const policy of defaults) {
      const trigger = relevantFiles.find((path) =>
        policy.patterns.some((pattern) => pattern.test(path)));
      if (trigger !== undefined)
        policy.capabilities.forEach((capability) => require(capability, trigger));
    }
    const configured = readJson(join(ROOT, ".foundation", "policy.json"), { rules: [] });
    for (const rule of configured.rules || []) {
      if (!Array.isArray(rule.paths) || !Array.isArray(rule.capabilities)) continue;
      const trigger = relevantFiles.find((path) => rule.paths.some((prefix) =>
        typeof prefix === "string" &&
        (path === prefix.replace(/\*\*?$/, "") ||
         path.startsWith(prefix.replace(/\*\*?$/, "")))));
      if (trigger !== undefined)
        for (const capability of rule.capabilities)
          if (PROVIDERS.has(capability)) require(capability, trigger);
    }
    const result = { capabilities: [...required].sort(), triggers };
    policyCache.set(id, result);
    return result;
  }

  function policyCapabilities(id) { return policyAnalysis(id).capabilities; }

  // "compatibility because openspec/contracts/pay.yaml changed" is one read;
  // "compatibility" alone sends the reader into the runtime source.
  function policyCapabilityTrigger(id, capability) {
    const paths = policyAnalysis(id).triggers[capability];
    return paths && paths.length ? paths[0] : null;
  }
  
  function packetValue(id, repositoryId = null, taskId = null) {
    const state = loadRuntime(id);
    const activePath = activeChangePath(id, state);
    const contract = evidence(id, activePath);
    const allTasks = taskBlocks(readFileSync(join(activePath, "tasks.md"), "utf8"))
      .map(taskMetadata);
    const selectedTask = taskId
      ? allTasks.find((task) => task.id === String(taskId).toUpperCase())
      : null;
    if (taskId && !selectedTask) die(`unknown task '${taskId}'`);
    const effectiveRepositoryId = repositoryId || selectedTask?.repository || null;
    const repository = effectiveRepositoryId
      ? repositoryById(id, effectiveRepositoryId, state) : null;
    if (selectedTask && repository && selectedTask.repository !== repository.id)
      die(`task '${selectedTask.id}' is not assigned to repository '${repository.id}'`);
    const packetType = selectedTask ? "task" : repository ? "repository" : "global";
    const declaredClaimIds = new Set(contract.claims.map((claim) => claim.id));
    const unknownTaskClaims = (selectedTask?.claims || [])
      .filter((claim) => !declaredClaimIds.has(claim));
    if (unknownTaskClaims.length)
      die(`task '${selectedTask.id}' references unknown claim(s): ${unknownTaskClaims.join(", ")}`);
    const claims = contract.claims.filter((claim) => {
      if (selectedTask?.claims.length)
        return selectedTask.claims.includes(claim.id);
      return !repository || !claim.repositories ||
        claim.repositories.includes(repository.id);
    });
    if (selectedTask && claims.length === 0 &&
        !["inventory", "logs", "mechanical-docs"].includes(selectedTask.kind))
      die(`task '${selectedTask.id}' has no claims in repository '${selectedTask.repository}'`);
    const claimIds = new Set(claims.map((claim) => claim.id));
    const compositeSnapshot = repository
      ? readJson(snapshotPath(id), {})
      : relevantSnapshot(id);
    const hash = repository
      ? singleRelevantSnapshot(id, repository.workspacePath).workspaceHash
      : compositeSnapshot.workspaceHash;
    const providerRows = requiredProviders(id).map((provider) => {
      const check = receiptValidity(id, provider, hash);
      const config = providerConfig(id, provider);
      return {
        provider, adapter: config?.adapter || "external",
        repository: config?.repository || null,
        resources: config ? adapterResources(provider, config) : [],
        validity: check.validity, status: check.status || check.receipt?.status || null
      };
    }).filter((provider) => !repository ||
      !provider.repository || provider.repository === repository.id)
      .filter((provider) => {
        const covered = claimsForProvider(id, provider.provider).map((claim) => claim.id);
        return covered.length === 0 || covered.some((claim) => claimIds.has(claim));
      });
    if (selectedTask && claims.length > 0 && providerRows.length === 0)
      die(`task '${selectedTask.id}' has no provider coverage`);
    const packetSurface = canonicalChangedSurface(id, state);
    const multiRepositoryPacket = new Set(packetSurface.map((row) => row.repositoryId)).size > 1;
    let fileChanges = packetSurface
      .filter((row) => !repository || row.repositoryId === repository.id)
      .map((row) => repository || !multiRepositoryPacket
        ? row.path : `${row.repositoryId}/${row.path}`);
    if (selectedTask?.paths.length)
      fileChanges = fileChanges.filter((path) => selectedTask.paths.some((scope) => {
        const normalized = scope.replace(/\/\*\*?$/, "").replace(/\/$/, "");
        return scope === "*" || path === normalized || path.startsWith(`${normalized}/`);
      }));
    const changedFileLimit = packetType === "task" ? 50 : 100;
    const changedFileSummary = fileChanges.length <= changedFileLimit ? fileChanges : {
      count: fileChanges.length,
      digest: stableHash(fileChanges),
      groups: Object.entries(fileChanges.reduce((groups, path) => {
        const prefix = path.split("/").slice(0, 2).join("/");
        groups[prefix] = (groups[prefix] || 0) + 1;
        return groups;
      }, {})).sort(([left], [right]) => left.localeCompare(right))
        .map(([prefix, count]) => ({ prefix, count }))
    };
    const scopedTasks = allTasks.filter((task) =>
      (!repository || task.repository === repository.id) &&
      (!selectedTask || task.id === selectedTask.id));
    const taskRows = scopedTasks.map((task) => ({
      id: task.id, done: task.done, kind: task.kind,
      dependsOn: task.dependsOn,
      paths: compactStrings(task.paths, 20),
      resources: compactStrings(task.resources, 20),
      ...(packetType === "task" ? {
        text: task.text, claims: task.claims, model: modelForTask(id, task)
      } : {})
    }));
    const taskPayload = packetType === "global" ? {
      count: scopedTasks.length,
      pending: scopedTasks.filter((task) => !task.done).length,
      completed: scopedTasks.filter((task) => task.done).length,
      byRepository: Object.entries(scopedTasks.reduce((counts, task) => {
        counts[task.repository] = (counts[task.repository] || 0) + 1;
        return counts;
      }, {})).sort(([left], [right]) => left.localeCompare(right))
        .map(([repositoryIdValue, count]) => ({ repository: repositoryIdValue, count })),
      digest: stableHash(scopedTasks.map((task) => ({
        id: task.id, done: task.done, repository: task.repository,
        dependsOn: task.dependsOn
      })))
    } : compactList(taskRows, packetType === "task" ? 1 : 40);
    const artifactReferences = {};
    for (const name of [
      "proposal.md", "design.md", "tasks.md", "evidence.yaml",
      "execution.yaml", "repositories.yaml"
    ]) {
      const path = join(activePath, name);
      if (existsSync(path))
        artifactReferences[name] = {
          path: relative(ROOT, path).replaceAll("\\", "/"),
          sha256: fileDigest(path)
        };
    }
    const specsPath = join(activePath, "specs");
    if (existsSync(specsPath))
      artifactReferences.specs = {
        path: relative(ROOT, specsPath).replaceAll("\\", "/"),
        sha256: directoryHash(specsPath)
      };
    const invariantValues = Array.isArray(contract.invariants)
      ? contract.invariants.map((value) => String(value)) : [];
    const claimRows = claims.map((claim) => ({
      id: claim.id,
      ...(packetType === "global"
        ? { scenarioDigest: stableHash(String(claim.scenario)) }
        : { scenario: String(claim.scenario)
          .slice(0, packetType === "task" ? 500 : 240) }),
      capabilities: compactStrings(claim.capabilities, 12),
      repositories: claim.repositories
        ? compactStrings(claim.repositories, 12) : null
    }));
    const providers = compactList(providerRows, 30);
    const claimPayload = compactList(
      claimRows, packetType === "task" ? 20 : packetType === "repository" ? 25 : 40);
    const packet = {
      version: Number(PACKET_SCHEMA_VERSION),
      packetType, changeId: id, intent: state.intent, schema: state.schema,
      status: state.status, revision: Number(state.revision || 0),
      contractRevision: Number(state.contractRevision || 0),
      executionRevision: Number(state.executionRevision || 0),
      impact: state.impact, coupling: state.coupling,
      reviewRequired: Boolean(state.reviewRequired),
      changePath: relative(ROOT, activePath) || ".",
      repository: repository ? {
        id: repository.id, type: repository.type, mode: repository.mode,
        relativePath: repository.relativePath,
        dependsOn: repository.dependsOn || []
      } : null,
      workspacePath: repository?.workspacePath || state.workspace?.path || ROOT,
      workspaceHash: hash,
      compositeWorkspaceHash: compositeSnapshot.workspaceHash || null,
      pendingTaskCount: scopedTasks.filter((task) => !task.done).length,
      tasks: taskPayload,
      claims: claimPayload,
      providers, changedFiles: changedFileSummary,
      invariants: packetType === "global" ? {
        count: invariantValues.length,
        digest: stableHash(invariantValues),
        reference: "evidence.yaml#invariants"
      } : invariantValues.map((value) => value.slice(0, 300)).slice(0, 10),
      references: artifactReferences,
      budget: ensureBudgetState(state),
      budgetDecision: budgetDecision(state)
    };
    return { ...packet, packetDigest: stableHash(packet) };
  }
  
  function reviewPacketValue(id) {
    const state = loadRuntime(id);
    const activePath = activeChangePath(id, state);
    const contract = evidence(id, activePath);
    const workspaceHash = relevantHash(id);
    const reviewClaims = scopedReviewClaims(contract.claims).map((claim) => ({
      id: claim.id,
      scenario: String(claim.scenario).slice(0, 240),
      impact: claim.impact,
      capabilities: claim.capabilities,
      repositories: claim.repositories || null
    }));
    const artifact = (name) => {
      const path = join(activePath, name);
      return existsSync(path) ? {
        path: relative(ROOT, path).replaceAll("\\", "/"),
        workspacePath: activePath,
        relativePath: name,
        sha256: statSync(path).isDirectory() ? directoryHash(path) : fileDigest(path)
      } : null;
    };
    const surfaceRows = canonicalChangedSurface(id, state);
    const paths = surfaceRows.map((row) => `${row.repositoryId}/${row.path}`);
    const inspection = [...surfaceRows.reduce((groups, row) => {
      if (!groups.has(row.repositoryId)) groups.set(row.repositoryId, []);
      groups.get(row.repositoryId).push(row.path);
      return groups;
    }, new Map())].map(([repositoryId, repositoryPaths]) => ({
      repositoryId,
      workspacePath: repositoryId === "root"
        ? state.workspace?.path || ROOT
        : state.repositories?.[repositoryId]?.path ||
          repositoryById(id, repositoryId, state).workspacePath,
      baseHead: repositoryId === "root"
        ? state.repositories?.root?.baseHead || state.workspace?.baseHead || null
        : state.repositories?.[repositoryId]?.baseHead || null,
      paths: repositoryPaths
    }));
    const changedSurface = paths.length <= 60 ? {
      paths,
      digest: stableHash(paths),
      inspection
    } : {
      count: paths.length,
      digest: stableHash(paths),
      groups: compactList(Object.entries(paths.reduce((groups, path) => {
        const prefix = path.split("/").slice(0, 2).join("/");
        groups[prefix] = Number(groups[prefix] || 0) + 1;
        return groups;
      }, {})).sort(([left], [right]) => left.localeCompare(right))
        .map(([prefix, count]) => ({ prefix, count })), 30),
      inspection: inspection.map((entry) => ({
        ...entry,
        pathCount: entry.paths.length,
        paths: entry.paths.slice(0, 20),
        truncated: entry.paths.length > 20
      }))
    };
    const evidenceRows = requiredProviders(id)
      .filter((provider) => !["review", "acceptance"].includes(
        providerCapability(provider, providerConfig(id, provider))))
      .map((provider) => {
        const check = receiptValidity(id, provider, workspaceHash);
        const path = receiptPath(id, provider);
        const receipt = check.receipt || (existsSync(path) ? readJson(path, {}) : {});
        return {
          provider,
          capability: providerCapability(provider, providerConfig(id, provider)),
          validity: check.validity,
          status: check.status || receipt.status || null,
          observed: receipt.observed ? String(receipt.observed).slice(0, 240) : null,
          artifacts: (receipt.artifacts || []).slice(0, 5).map((value) => value.path),
          references: (receipt.references || []).slice(0, 5)
        };
      });
    const reviewProvider = requiredProviders(id).find((provider) =>
      providerCapability(provider, providerConfig(id, provider)) === "review") || "review";
    const prior = existsSync(receiptPath(id, reviewProvider))
      ? readJson(receiptPath(id, reviewProvider), {}) : null;
    const packet = {
      version: Number(REVIEW_PACKET_SCHEMA_VERSION),
      packetType: "review",
      changeId: id,
      intent: state.intent,
      workspaceHash,
      contractFingerprint: contractFingerprint(id),
      reviewPolicy: reviewPolicy(id, state, contract),
      acceptance: resolvedAcceptance(id, state, contract),
      claims: compactList(reviewClaims, 12),
      decisions: {
        proposal: artifact("proposal.md"),
        design: artifact("design.md"),
        specs: artifact("specs")
      },
      changedSurface: { ...changedSurface, rows: compactList(surfaceRows, 60) },
      evidence: compactList(evidenceRows, 15),
      priorReview: prior ? {
        round: prior.review?.round || null,
        status: prior.status || null,
        workspaceHash: prior.workspaceHash || null,
        observed: prior.observed ? String(prior.observed).slice(0, 240) : null,
        findings: prior.review?.findings || null,
        scope: prior.review?.scope || null
      } : null,
      unresolvedFindings: Number(prior?.review?.findings?.unresolvedBlockers || 0),
      references: {
        evidence: artifact("evidence.yaml"),
        tasks: artifact("tasks.md")
      }
    };
    return { ...packet, packetDigest: stableHash(packet) };
  }
  
  
  function showPacket(id, flags = {}) {
    if (flags.phase === "review" && flags.task)
      die("review packet does not accept --task; use its scoped references");
    if (flags.phase === "build") {
      const state = loadRuntime(id);
      if (!["worktree", "copy"].includes(state.workspace?.mode))
        die(`build packet requires an isolated workspace; run claude-foundation sandbox create ${id}`);
    }
    const value = flags.phase === "review"
      ? reviewPacketValue(id)
      : packetValue(id, flags.repo || null, flags.task || null);
    const instructionPhase = flags.phase === "review" ? "prove" : flags.phase || "build";
    const taskModel = Array.isArray(value.tasks) ? value.tasks[0]?.model?.tier || null : null;
    const manifest = recordInstructionManifest?.(id, instructionPhase, {
      scope: flags.task || flags.repo || value.packetType,
      requestedModel: taskModel
    });
    if (manifest) value.instructionProvenance = {
      schemaVersion: manifest.schemaVersion,
      manifestDigest: manifest.manifestDigest,
      requestedModel: manifest.execution?.requestedModel || null
    };
    if (flags.planDigest) value.planDigest = flags.planDigest;
    const priorDigest = value.packetDigest;
    delete value.packetDigest;
    value.packetDigest = stableHash(value);
    if (!manifest && priorDigest) value.packetDigest = priorDigest;
    const encoded = serializedJson(value, Boolean(flags.pretty));
    const bytes = Buffer.byteLength(encoded);
    const limit = Number(foundationPolicy().execution.packetBytes[value.packetType]);
    if (bytes > limit) {
      const fields = Object.entries(value).map(([field, fieldValue]) => ({
        field, bytes: Buffer.byteLength(JSON.stringify(fieldValue))
      })).sort((left, right) => right.bytes - left.bytes).slice(0, 5);
      die(`${value.packetType} packet exceeds ${limit} bytes (${bytes}); largest fields: ${
        fields.map((entry) => `${entry.field}=${entry.bytes}`).join(", ")
      }; narrow the task or inspect referenced artifacts`);
    }
    recordContextMetric(id, `packet-${value.packetType}`, bytes, {
      repositoryId: value.repository?.id || null,
      taskId: flags.task || null,
      claims: Array.isArray(value.claims) ? value.claims.length : value.claims.count,
      providers: Array.isArray(value.providers) ? value.providers.length :
        Array.isArray(value.evidence) ? value.evidence.length : value.providers?.count || 0
    });
    process.stdout.write(encoded);
  }
  

  return {
    changedFilesInWorkspace,
    changedFiles,
    canonicalChangedSurface,
    policyCapabilities,
    policyCapabilityTrigger,
    packetValue,
    reviewPacketValue,
    showPacket
  };
}
