import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { acquireProcessLock, isProcessAlive } from "../core/process-lock.mjs";

export function authorityRequestDisplayValue(request, limit = 8192) {
  const packetBytes = Buffer.byteLength(JSON.stringify(request.packet || null));
  if (request.type !== "review" || packetBytes <= limit) return request;
  return {
    version: request.version,
    requestId: request.requestId,
    changeId: request.changeId,
    type: request.type,
    provider: request.provider,
    status: request.status,
    workspaceHash: request.workspaceHash,
    claimIds: request.claimIds,
    packetDigest: request.packetDigest,
    packet: {
      status: "persisted",
      display: "truncated",
      bytes: packetBytes,
      limit
    },
    requestedAt: request.requestedAt,
    expiresAt: request.expiresAt,
    next: `claude-foundation authority status ${request.changeId} --request ${
      request.requestId}`
  };
}

export function requireExternalCiConfig({ fail }, provider, config) {
  if (!config || config.adapter !== "external" || !config.ci?.publicKey || !config.ci?.issuer)
    fail(`provider '${provider}' requires external ci.issuer and ci.publicKey configuration`);
  return config;
}

export function signedCiReceiptFlags(context, id, provider, config, workspaceHash, result) {
  const { payload, artifacts } = result;
  return {
    claims: context.providerClaims(id, provider, config).join(","),
    workspaceHash,
    observed: String(payload.observed || `CI ${payload.status}; commit ${payload.commit || "unknown"}`),
    source: `signed-ci:${payload.issuer}`,
    reference: [payload.runUrl, ...artifacts.map((artifact) =>
      `artifact:${artifact.name}:sha256:${artifact.sha256}`)],
    "recorded-by": `evidence-verify-ci:${payload.issuer}`
  };
}

export function recordVerifiedCiOperation(context, id, provider, source) {
  const config = requireExternalCiConfig(context, provider,
    context.providerConfig(id, provider));
  const path = context.resolvePath(source || "");
  if (!source || !context.pathExists(path))
    context.fail("evidence verify-ci requires a signed JSON envelope");
  const envelope = context.readJson(path);
  const workspaceHash = context.providerWorkspaceHash(id, provider);
  const repository = context.providerRepository(id, provider, config);
  const workspacePath = repository?.workspacePath || context.providerWorkspace(id, provider);
  const result = context.validateSignedCiEnvelope({
    envelope,
    protocolVersion: context.ciEvidenceProtocolVersion,
    issuer: config.ci.issuer,
    publicKey: config.ci.publicKey,
    changeId: id,
    provider,
    workspaceHash,
    head: context.gitHead(workspacePath)
  });
  if (!result.valid) context.fail(result.reason);
  context.recordReceipt(id, provider, result.status,
    signedCiReceiptFlags(context, id, provider, config, workspaceHash, result));
  context.output.log(`CI EVIDENCE ${id}/${provider}: ${result.status}\n  run: ${result.payload.runUrl}`);
}

export function authorityRequestSelection(context, id, flags) {
  const type = String(flags.type || "");
  if (!["review", "acceptance"].includes(type))
    context.fail("authority request --type must be review|acceptance");
  context.validate(id, "active", { quiet: true });
  const pending = context.pendingTasks(id);
  if (pending.length)
    context.fail(`authority request requires completed implementation tasks: ${
      pending.map((task) => task.id).join(", ")}`);
  const repository = String(flags.repo || "").trim() || null;
  const provider = context.authorityProvider(id, type, repository);
  if (!provider || !context.requiredProviders(id).includes(provider))
    context.fail(repository
      ? `change '${id}' has no ${type} provider scoped to repository '${repository}'`
      : `change '${id}' does not require ${type} authority`);
  return {
    type, repository, provider,
    workspaceHash: context.authorityWorkspaceHash(id, provider)
  };
}

export function pendingAuthorityRequest(entries, selection) {
  for (const entry of entries) {
    const value = entry.value;
    if (value.type === selection.type && value.provider === selection.provider &&
        value.workspaceHash === selection.workspaceHash &&
        ["requested", "dispatched", "pending"].includes(value.status))
      return value;
  }
  return null;
}

export function authorityClaimIds(claims) {
  return claims.map((claim) => claim.id);
}

export function randomAuthorityRequestHex() {
  return randomBytes(8).toString("hex");
}

export function authorityRequestPolicy(context, id, type) {
  return type === "review" ? {
    reviewCircuit: context.policy().workflow.reviewCircuit,
    requirements: context.reviewPolicy(id)
  } : {
    reviewCircuit: null,
    requirements: { actor: "human", acceptance: context.resolvedAcceptance(id) }
  };
}

export function newAuthorityRequestValue(context, id, selection) {
  const { type, provider, workspaceHash } = selection;
  const packet = context.authorityPacket(id, type);
  const requestId = `${type}-${context.timestamp()}-${context.randomHex()}`;
  const claimIds = authorityClaimIds(context.claimsForProvider(id, provider));
  const packetDigest = context.canonicalPacketDigest(packet);
  const requestedAt = context.now();
  const expiresAt = new Date(
    context.timestamp() + 24 * 60 * 60 * 1000).toISOString();
  const policy = authorityRequestPolicy(context, id, type);
  return {
    version: Number(context.protocolVersion),
    requestId,
    changeId: id, type, provider, status: "requested", workspaceHash,
    claimIds,
    packet,
    packetDigest,
    requestedAt,
    expiresAt,
    ...policy
  };
}

export function displayAuthorityRequest(context, request, quiet) {
  if (quiet) return;
  const limit = Number(context.policy().execution?.packetBytes?.review || 8192);
  context.output.log(JSON.stringify(context.displayValue(request, limit), null, 2));
}

export function requestAuthorityOperation(context, id, flags = {}, options = {}) {
  const selection = authorityRequestSelection(context, id, flags);
  const existing = pendingAuthorityRequest(context.authorityStore.list(id), selection);
  if (existing) {
    displayAuthorityRequest(context, existing, options.quiet);
    return existing;
  }
  const request = newAuthorityRequestValue(context, id, selection);
  context.authorityStore.writeRequest(id, request);
  displayAuthorityRequest(context, request, options.quiet);
  return request;
}

export function mainSessionEnvironment(environment) {
  const claudeSession = String(
    environment.FOUNDATION_CLAUDE_SESSION_ID || "").trim();
  const codexSession = String(environment.CODEX_THREAD_ID || "").trim();
  const genericSession = String(environment.FOUNDATION_SESSION_ID || "").trim();
  const declaredMainSession = String(
    environment.FOUNDATION_MAIN_SESSION_ID || "").trim();
  return {
    claudeSession,
    codexSession,
    ambientSession: claudeSession || genericSession || codexSession ||
      declaredMainSession
  };
}

export function bindMainSession(context, flags, environment) {
  const requestedSession = String(
    flags["main-session-id"] || environment.ambientSession).trim();
  if (environment.ambientSession && requestedSession &&
      environment.ambientSession !== requestedSession)
    context.fail("main-session fallback session must match the calling host session");
  return environment.ambientSession ? requestedSession : "";
}

export function inferredMainSession(environment) {
  if (environment.claudeSession &&
      environment.ambientSession === environment.claudeSession)
    return { providerFamily: "anthropic", identity: "claude-main-session" };
  if (environment.codexSession &&
      environment.ambientSession === environment.codexSession)
    return { providerFamily: "openai", identity: "codex-main-session" };
  return { providerFamily: "", identity: "" };
}

export function firstMainSessionValue(values, lowercase = false) {
  const value = String(values.find(Boolean) || "").trim();
  return lowercase ? value.toLowerCase() : value;
}

export function mainSessionFallbackValue(
  inheritsSubject, subjectValue, telemetryValue, inferredValue = ""
) {
  return inheritsSubject
    ? subjectValue : firstMainSessionValue([telemetryValue, inferredValue]);
}

export function mainSessionProvenanceValue(
  flags, subject, environmentVariables, session, telemetry
) {
  const inheritsSubject = subject.sessionId && session.boundSession &&
    String(subject.sessionId).toLowerCase() === session.boundSession.toLowerCase();
  const inferred = inferredMainSession(session.environment);
  const value = {
    identity: firstMainSessionValue([
      flags["main-session-identity"],
      environmentVariables.FOUNDATION_MAIN_IDENTITY,
      mainSessionFallbackValue(
        inheritsSubject, subject.identity, telemetry.identity, inferred.identity)
    ]),
    sessionId: session.boundSession || null,
    providerFamily: firstMainSessionValue([
      flags["main-session-provider-family"],
      environmentVariables.FOUNDATION_MAIN_PROVIDER_FAMILY,
      mainSessionFallbackValue(inheritsSubject, subject.providerFamily,
        telemetry.providerFamily, inferred.providerFamily)
    ], true),
    modelFamily: firstMainSessionValue([
      flags["main-session-model-family"],
      environmentVariables.FOUNDATION_MAIN_MODEL_FAMILY,
      mainSessionFallbackValue(
        inheritsSubject, subject.modelFamily, telemetry.modelFamily)
    ], true),
    modelId: firstMainSessionValue([
      flags["main-session-model"],
      environmentVariables.FOUNDATION_MODEL_ID,
      mainSessionFallbackValue(
        inheritsSubject, subject.modelId, telemetry.modelId)
    ])
  };
  const missing = Object.entries(value)
    .filter(([, fieldValue]) => !fieldValue).map(([name]) => name);
  return { ...value, missing };
}

export function createAuthorityRuntime({
  root,
  protocolVersion,
  ciEvidenceProtocolVersion,
  authorityStore,
  requiredProviders,
  providerCapability,
  providerConfig,
  reviewPacketValue,
  loadRuntime,
  evidence,
  resolvedAcceptance,
  relevantHash,
  validate,
  pendingTasks,
  claimsForProvider,
  stableHash,
  now,
  reviewPolicy,
  readJson,
  receiptPath,
  recordReceipt,
  receiptValidity,
  fileDigest,
  providerWorkspaceHash,
  providerRepository,
  providerWorkspace,
  gitHead,
  validateSignedCiEnvelope,
  providerClaims,
  expandList,
  listCount,
  dispatchReviewAttempt,
  completeReviewAttempt,
  reviewHistoryState,
  reviewAttempts,
  deliveredAiAttempts,
  reviewAttemptByDigest,
  assertReviewDispatchAllowed,
  foundationPolicy,
  reviewerConfig,
  reviewerStatus,
  runConfiguredReview,
  acknowledgeInfrastructureAttempts,
  acknowledgeBaseMoveAttempts,
  writeJson,
  fail
}) {
  function withAuthorityLock(id, operation) {
    const locks = join(root, ".foundation", "locks");
    const lock = join(locks, `authority-${id}.lock`);
    const acquired = acquireProcessLock(lock, { now });
    if (!acquired.acquired)
      fail(`authority mutation for '${id}' is already in progress; retry after it completes`);
    try { return operation(); }
    finally { acquired.release(); }
  }
  function authorityProvider(id, type, repository = null) {
    return requiredProviders(id).find((provider) => {
      const config = providerConfig(id, provider);
      if (providerCapability(provider, config) !== type) return false;
      return repository ? config?.repository === repository : true;
    }) || (repository ? null : type);
  }

  // A review provider that names a repository is a verdict about that
  // repository, so it binds to that repository's workspace hash. Binding every
  // verdict to the composite meant an edit in *any* selected repository
  // invalidated a review already earned elsewhere — on a wide change, review
  // became a moving target.
  function authorityWorkspaceHash(id, provider) {
    return providerWorkspaceHash(id, provider);
  }

  function authorityPacket(id, type) {
    if (type === "review") return reviewPacketValue(id);
    const state = loadRuntime(id);
    const contract = evidence(id);
    const acceptance = resolvedAcceptance(id, state, contract);
    const context = reviewPacketValue(id);
    const claims = contract.claims.filter((claim) => acceptance.claimIds.includes(claim.id))
      .map((claim) => ({
        id: claim.id,
        scenario: claim.scenario,
        impact: claim.impact,
        criterion: `Confirm the final result satisfies: ${claim.scenario}`
      }));
    return {
      version: Number(protocolVersion), packetType: "acceptance", changeId: id,
      workspaceHash: relevantHash(id), reason: acceptance.reason,
      intent: state.intent,
      claims,
      inspection: {
        workspaces: context.changedSurface?.inspection || [],
        changedSurface: context.changedSurface || null,
        decisions: context.decisions || null,
        automatedEvidence: context.evidence || []
      },
      response: {
        statuses: ["pass", "fail", "inconclusive", "error"],
        instructions: "Inspect the final workspace against every criterion. Pass only when all criteria are satisfied; otherwise reject, report uncertainty, or pause without a response.",
        requiredForPass: ["named human", "criterion observations", "durable artifact or reference"]
      },
      requiredActor: "human"
    };
  }

  function canonicalPacketDigest(packet) {
    const canonical = JSON.parse(JSON.stringify(packet || {}));
    delete canonical.packetDigest;
    return stableHash(canonical);
  }

  // The receipt records only the latest attempt digest, so counting delivered
  // attempts against receipt-matching ones misfires the moment a delta receipt
  // overwrites the full receipt or a human receipt supersedes the AI one. The
  // sound question is latest-vs-latest: is the newest delivered AI response
  // still waiting for its receipt, with nothing recorded after it?
  function unrecordedDeliveredAiResponse(id, history, provider) {
    const latest = deliveredAiAttempts(id, history).at(-1);
    if (!latest) return null;
    // A migrated attempt was synthesized from the receipt itself, so it is
    // recorded by construction.
    if (latest.migrated) return null;
    const path = receiptPath(id, provider);
    const receipt = existsSync(path) ? readJson(path, {}) : {};
    const recordedDigest = receipt.review?.attemptDigest || null;
    if (!recordedDigest) return latest;
    const recorded = reviewAttempts(id, history).find((attempt) =>
      attempt.digest === recordedDigest);
    if (recorded && Number(recorded.attempt) >= Number(latest.attempt))
      return null;
    return latest;
  }

  const requestAuthorityUnlocked = requestAuthorityOperation.bind(null, {
    validate,
    pendingTasks,
    authorityProvider,
    requiredProviders,
    authorityWorkspaceHash,
    authorityStore,
    authorityPacket,
    claimsForProvider,
    canonicalPacketDigest,
    protocolVersion,
    timestamp: Date.now,
    randomHex: randomAuthorityRequestHex,
    now,
    policy: foundationPolicy,
    reviewPolicy,
    resolvedAcceptance,
    displayValue: authorityRequestDisplayValue,
    output: console
  });

  function requestAuthority(id, flags = {}, options = {}) {
    return withAuthorityLock(id, () => requestAuthorityUnlocked(id, flags, options));
  }

  function dispatchRequestContext(id, flags) {
    const requestId = String(flags.request || "");
    if (!requestId) fail("authority dispatch requires --request <id>");
    const entry = authorityStore.list(id)
      .find((row) => row.value.requestId === requestId);
    if (!entry) fail(`unknown authority request '${requestId}'`);
    const request = entry.value;
    if (request.status === "dispatched") {
      console.log(JSON.stringify(request, null, 2));
      return { handled: true, value: request };
    }
    if (request.type !== "review")
      fail("authority dispatch currently reserves review authority only");
    if (request.reviewCircuit !== "full-delta")
      fail(`authority request '${requestId}' predates the full-delta circuit; record or cancel it without dispatch`);
    if (request.status !== "requested")
      fail(`authority request '${requestId}' is ${request.status}`);
    if (request.workspaceHash !== authorityWorkspaceHash(id, request.provider))
      fail(`authority request '${requestId}' is stale`);
    if (Date.parse(request.expiresAt || "") <= Date.now())
      fail(`authority request '${requestId}' is expired`);
    if (canonicalPacketDigest(request.packet) !== request.packetDigest)
      fail(`authority request '${requestId}' packet no longer matches its recorded digest`);
    const reviewerType = String(flags["reviewer-type"] || "").toLowerCase();
    if (!["ai", "human"].includes(reviewerType))
      fail("authority dispatch requires --reviewer-type ai|human");
    return { handled: false, entry, request, requestId, reviewerType };
  }

  function dispatchAuthorityUnlocked(id, flags = {}) {
    const context = dispatchRequestContext(id, flags);
    if (context.handled) return context.value;
    const { entry, request, requestId, reviewerType } = context;
    function dispatchRouting() {
    const routing = reviewPolicy(id);
    const historySnapshot = reviewHistoryState(id);
    const deliveredSnapshot = deliveredAiAttempts(id, historySnapshot);
    const promotesLow = routing.tier === "low" && deliveredSnapshot.length >= 1 &&
      request.workspaceHash !== deliveredSnapshot.at(-1).workspaceHash;
    const maxAiAttempts = promotesLow ? 2 : Number(routing.maxAiAttempts || 2);
    const reviewSettings = foundationPolicy().review || {};
    const configuredFallbacks = (Array.isArray(reviewSettings.fallbackReviewers)
      ? reviewSettings.fallbackReviewers
      : reviewSettings.fallbackReviewer ? [reviewSettings.fallbackReviewer] : [])
      .filter((name) => name !== "main-session");
    const maxInfrastructureRetries = Math.max(1,
      (1 + configuredFallbacks.length) * Number(reviewSettings.infraFailureThreshold || 1));
    // The route-aware cap still wins over malformed scope/base details.
    const history = assertReviewDispatchAllowed(
      id, reviewerType, maxAiAttempts, maxInfrastructureRetries);
    const deliveredAi = deliveredAiAttempts(id, history);
    if (unrecordedDeliveredAiResponse(id, history, request.provider))
      fail("a completed AI response has no matching recorded receipt; repair that authority record or pause instead of dispatching another reviewer");
    if (promotesLow) {
      // A second dispatch means the first review did not close the change and
      // production moved. That is the one permitted low→medium promotion.
      request.requirements = {
        ...request.requirements,
        tier: "medium",
        promotedFrom: "low",
        promotionReason: "post-review-correction"
      };
    }
    return { routing, deliveredAi, maxAiAttempts, maxInfrastructureRetries };
    }
    const { routing, deliveredAi, maxAiAttempts,
      maxInfrastructureRetries } = dispatchRouting();
    function dispatchReviewer() {
    const reviewerIdentity = String(flags["reviewer-identity"] || "").trim();
    if (!reviewerIdentity)
      fail("authority dispatch requires --reviewer-identity");
    const reviewerProviderFamily = String(flags["reviewer-provider-family"] || "").trim().toLowerCase() || null;
    const reviewerModelFamily = String(flags["reviewer-model-family"] || "").trim().toLowerCase() || null;
    const reviewerModelId = String(flags["reviewer-model"] || "").trim() || null;
    const reviewerSessionId = String(flags["reviewer-session"] || "").trim() || null;
    const sessionDeferred = flags["reviewer-session-deferred"] === true;
    if (reviewerType === "ai" && [
      reviewerProviderFamily, reviewerModelFamily, reviewerModelId
    ].some((value) => !value))
      fail("AI dispatch requires reviewer provider/model family and model ID");
    if (reviewerType === "ai" && !reviewerSessionId && !sessionDeferred)
      fail("AI dispatch requires reviewer session unless a configured reviewer defers it to the actual thread.started event");
    function validateDispatchReviewerRoute() {
    if (reviewerType === "ai" && deliveredAi.length > 0) {
      const priorAi = deliveredAi.at(-1);
      if (priorAi?.reviewerType === "ai" &&
          priorAi.reviewerSessionId === reviewerSessionId)
        fail("AI delta closure requires a fresh reviewer session");
    }
    if (reviewerType === "ai" && providerConfig(id, request.provider)?.repository)
      fail("AI full-delta review requires one composite unscoped review provider; reconfigure the provider or split the change");
    }
    validateDispatchReviewerRoute();
    return { reviewerIdentity, reviewerProviderFamily, reviewerModelFamily,
      reviewerModelId, reviewerSessionId, sessionDeferred };
    }
    const { reviewerIdentity, reviewerProviderFamily, reviewerModelFamily,
      reviewerModelId, reviewerSessionId, sessionDeferred } = dispatchReviewer();
    function dispatchScope() {
    const scopeMode = String(flags.scope || "").toLowerCase();
    if (!["full", "delta"].includes(scopeMode))
      fail("authority dispatch requires --scope full|delta");
    const baseAttemptDigest = String(flags["base-attempt"] || "").trim() || null;
    const currentManifest = Array.isArray(request.packet?.changedSurface?.manifest)
      ? request.packet.changedSurface.manifest : [];
    let scopeRows = currentManifest;
    let baseWorkspaceHash = null;
    let baseAttempt = null;
    function resolveDeltaScope() {
    if (scopeMode === "delta") {
      baseAttempt = reviewAttemptByDigest(id, baseAttemptDigest);
      if (!baseAttempt || baseAttempt.reviewerType !== "ai")
        fail("AI delta review requires --base-attempt naming the first durable AI dispatch");
      const baseRequest = authorityStore.list(id)
        .find((row) => row.value.requestId === baseAttempt.requestId)?.value;
      if (!baseRequest)
        fail("AI delta review cannot resolve the packet used by its base dispatch");
      if (canonicalPacketDigest(baseRequest.packet) !== baseAttempt.packetDigest)
        fail("AI delta review base packet no longer matches the immutable first dispatch");
      const baseManifest = Array.isArray(baseRequest.packet?.changedSurface?.manifest)
        ? baseRequest.packet.changedSurface.manifest : [];
      const baseRows = new Map(baseManifest.map((row) => [
        `${row.repositoryId}/${row.path}`, row
      ]));
      const currentRows = new Map(currentManifest.map((row) => [
        `${row.repositoryId}/${row.path}`, row
      ]));
      scopeRows = currentManifest.filter((row) =>
        baseRows.get(`${row.repositoryId}/${row.path}`)?.identity !== row.identity);
      for (const [key, row] of baseRows)
        if (!currentRows.has(key)) scopeRows.push({ ...row, identity: "reverted-to-base" });
      scopeRows.sort((left, right) =>
        `${left.repositoryId}/${left.path}`.localeCompare(`${right.repositoryId}/${right.path}`));
      if (scopeRows.length === 0)
        fail("AI delta review has no files changed since the first AI dispatch; do not spend the second review round");
      baseWorkspaceHash = baseAttempt.workspaceHash;
    }
    }
    resolveDeltaScope();
    const scopePaths = scopeRows.map((row) => `${row.repositoryId}/${row.path}`);
    const scopeDigest = stableHash({
      mode: scopeMode,
      baseAttemptDigest,
      baseWorkspaceHash,
      workspaceHash: request.workspaceHash,
      rows: scopeRows
    });
    return { scopeMode, baseAttemptDigest, baseWorkspaceHash, baseAttempt,
      scopeRows, scopePaths, scopeDigest };
    }
    const { scopeMode, baseAttemptDigest, baseWorkspaceHash, baseAttempt,
      scopeRows, scopePaths, scopeDigest } = dispatchScope();
    function dispatchPacket() {
    const packet = JSON.parse(JSON.stringify(request.packet));
    packet.reviewScope = {
      mode: scopeMode,
      baseAttemptDigest,
      baseWorkspaceHash,
      workspaceHash: request.workspaceHash,
      paths: scopePaths,
      digest: scopeDigest
    };
    function applyHighRiskHumanClosure() {
    if (routing.tier === "high" && reviewerType === "human" && deliveredAi.length) {
      const baseAttempt = deliveredAi.at(-1);
      const closureFindings = (baseAttempt.findings || []).filter((finding) =>
        ["blocker", "major"].includes(finding.severity));
      packet.closureFindings = {
        baseAttemptDigest: baseAttempt.digest,
        ids: closureFindings.map((finding) => finding.id).sort(),
        findings: closureFindings
      };
    }
    }
    applyHighRiskHumanClosure();
    function applyDeltaPacket() {
    if (scopeMode === "delta") {
      function deltaInspection() {
      const fullInspection = new Map((request.packet?.changedSurface?.inspection || [])
        .map((entry) => [entry.repositoryId, entry]));
      const inspection = [...scopeRows.reduce((groups, row) => {
        const key = `${row.repositoryId}\u0000${row.workspacePath || ""}`;
        if (!groups.has(key)) groups.set(key, {
          repositoryId: row.repositoryId,
          workspacePath: row.workspacePath || fullInspection.get(row.repositoryId)?.workspacePath || null,
          baseHead: fullInspection.get(row.repositoryId)?.baseHead || null,
          paths: []
        });
        groups.get(key).paths.push(row.relativePath || row.path);
        return groups;
      }, new Map()).values()];
      return inspection;
      }
      const inspection = deltaInspection();
      packet.changedSurface = {
        paths: scopePaths,
        digest: stableHash(scopePaths),
        inspection,
        rows: scopeRows,
        manifest: scopeRows,
        deltaFrom: {
          attemptDigest: baseAttemptDigest,
          workspaceHash: baseWorkspaceHash
        }
      };
      const closureFindings = (baseAttempt.findings || []).filter((finding) =>
        ["blocker", "major"].includes(finding.severity));
      packet.closureFindings = {
        baseAttemptDigest,
        ids: closureFindings.map((finding) => finding.id).sort(),
        findings: closureFindings
      };
      function applyDeltaContractProjection() {
      const changedContractNames = new Set(scopeRows
        .filter((row) => row.kind === "contract-artifact")
        .map((row) => row.relativePath));
      function artifactName(name) { return name; }
      function artifactRelativePath(_name, artifact) {
        return artifact?.relativePath || null;
      }
      function selectedDeltaArtifacts(artifacts, pathFor) {
        return Object.fromEntries(Object.entries(artifacts).filter(([name, artifact]) =>
          changedContractNames.has(pathFor(name, artifact))));
      }
      function artifactCollection(value) {
        return value && typeof value === "object" ? value : {};
      }
      packet.contractArtifacts = selectedDeltaArtifacts(
        artifactCollection(request.packet?.contractArtifacts), artifactName);
      packet.decisions = selectedDeltaArtifacts(
        artifactCollection(request.packet?.decisions), artifactRelativePath);
      packet.references = selectedDeltaArtifacts(
        artifactCollection(request.packet?.references), artifactRelativePath);
      function applyDeltaGroundingAndClaims() {
      packet.grounding = changedContractNames.has("grounding.yaml")
        ? request.packet.grounding : null;
      if (!changedContractNames.has("evidence.yaml")) packet.claims = {
        reuseFromAttempt: baseAttemptDigest,
        digest: stableHash(request.packet?.claims || [])
      };
      }
      applyDeltaGroundingAndClaims();
      }
      applyDeltaContractProjection();
    }
    }
    applyDeltaPacket();
    delete packet.packetDigest;
    packet.packetDigest = canonicalPacketDigest(packet);
    return packet;
    }
    const packet = dispatchPacket();
    const attempt = dispatchReviewAttempt(id, {
      requestId,
      workspaceHash: request.workspaceHash,
      reviewerType,
      reviewerIdentity,
      reviewerProviderFamily,
      reviewerModelFamily,
      reviewerModelId,
      reviewerSessionId,
      sessionDeferred,
      scope: {
        mode: scopeMode,
        baseAttemptDigest,
        paths: scopePaths,
        digest: scopeDigest
      },
      packetDigest: packet.packetDigest,
      maxAiAttempts,
      maxInfrastructureRetries
    });
    const updated = {
      ...request,
      status: "dispatched",
      dispatchedAt: now(),
      dispatch: {
        attemptDigest: attempt.digest,
        attempt: attempt.attempt,
        reviewer: {
          type: reviewerType,
          identity: reviewerIdentity,
          providerFamily: reviewerProviderFamily,
          modelFamily: reviewerModelFamily,
          modelId: reviewerModelId,
          sessionId: reviewerSessionId
        },
        scope: attempt.scope
      },
      packet,
      packetDigest: packet.packetDigest
    };
    authorityStore.replace(entry, updated);
    console.log(JSON.stringify(updated, null, 2));
    return updated;
  }

  function dispatchAuthority(id, flags = {}) {
    return withAuthorityLock(id, () => dispatchAuthorityUnlocked(id, flags));
  }

  function abortAuthorityUnlocked(id, flags = {}) {
    const requestId = String(flags.request || "");
    const reason = String(flags.reason || "").trim();
    if (!requestId || !reason)
      fail("authority abort requires --request <id> --reason <text>");
    const entry = authorityStore.list(id)
      .find((row) => row.value.requestId === requestId);
    if (!entry) fail(`unknown authority request '${requestId}'`);
    const request = entry.value;
    const dispatchedAttempt = request.dispatch?.attemptDigest
      ? reviewAttemptByDigest(id, request.dispatch.attemptDigest) : null;
    const attemptIsCurrent = dispatchedAttempt?.status === "dispatched" &&
      reviewHistoryState(id, loadRuntime(id)).chainHead === dispatchedAttempt.digest;
    if (attemptIsCurrent) {
      completeReviewAttempt(id, dispatchedAttempt.digest, {
        reviewerSessionId: dispatchedAttempt.reviewerSessionId || "",
        resultStatus: "error",
        findings: [],
        verifiedFindingIds: []
      });
    }
    if (request.status === "aborted" && attemptIsCurrent) {
      console.log(JSON.stringify(request, null, 2));
      return request;
    }
    if (!["requested", "dispatched"].includes(request.status))
      fail(`authority request '${requestId}' is ${request.status}`);
    const updated = {
      ...request,
      status: request.status === "dispatched" ? "aborted" : "cancelled",
      abortedAt: now(),
      abortReason: reason
    };
    authorityStore.replace(entry, updated);
    console.log(JSON.stringify(updated, null, 2));
    return updated;
  }

  function abortAuthority(id, flags = {}) {
    return withAuthorityLock(id, () => abortAuthorityUnlocked(id, flags));
  }

  function sessionTelemetryProvenance(id, sessionId) {
    if (!sessionId) return {};
    try {
      const rows = readFileSync(join(root, ".foundation", "logs", id,
        "events.jsonl"), "utf8").split(/\r?\n/).filter(Boolean)
        .map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter((row) => row && [row.sessionId, row.runId]
          .some((value) => String(value || "").toLowerCase() ===
            sessionId.toLowerCase()));
      const row = rows.filter((candidate) => candidate.modelId).at(-1) ||
        rows.at(-1) || null;
      if (!row) return {};
      const source = String(row.source || "").toLowerCase();
      const modelId = String(row.modelId || "").trim();
      const providerFamily = source.includes("claude") ? "anthropic"
        : source.includes("codex") || source.includes("openai") ? "openai" : "";
      return {
        identity: String(row.agentId || "").trim(),
        providerFamily,
        // Telemetry does not currently expose a separate family field. The
        // exact model ID is a conservative singleton family: it never claims
        // diversity between two observations of the same model.
        modelFamily: String(row.modelFamily || modelId).trim().toLowerCase(),
        modelId
      };
    } catch { return {}; }
  }

  function mainSessionProvenance(id, flags, subject = {}) {
    const environment = mainSessionEnvironment(process.env);
    const boundSession = bindMainSession({ fail }, flags, environment);
    const telemetry = sessionTelemetryProvenance(id, boundSession);
    return mainSessionProvenanceValue(flags, subject, process.env, {
      environment, boundSession
    }, telemetry);
  }

  function mainSessionHandback(id, requestId, configuredIdentity,
    infrastructureError, mainSession, mainDispatched, subject) {
    const template = responseTemplate(mainDispatched);
    template.evidence["subject-actor"] = subject.identity;
    if (subject.sessionId) {
      template.evidence["subject-session"] = subject.sessionId;
      template.evidence["subject-provider-family"] = subject.providerFamily;
      template.evidence["subject-model-family"] = subject.modelFamily;
      template.evidence["subject-model"] = subject.modelId;
    } else {
      delete template.evidence["subject-session"];
      delete template.evidence["subject-provider-family"];
      delete template.evidence["subject-model-family"];
      delete template.evidence["subject-model"];
    }
    return {
      status: "needs-main-session-review",
      changeId: id,
      requestId,
      failedReviewer: configuredIdentity,
      infrastructureError,
      reviewer: mainSession,
      packet: mainDispatched.packet,
      responseTemplate: template,
      next: {
        record: `claude-foundation authority record ${id} --request ${requestId} --response <response.json>`
      }
    };
  }

  function configuredReviewerRoute(settings, request, explicitReviewer = null,
    automaticReviewer = null) {
    if (explicitReviewer) return explicitReviewer;
    if (automaticReviewer) return automaticReviewer;
    const threshold = Number(settings.infraFailureThreshold || 1);
    const fallbacks = Array.isArray(settings.fallbackReviewers)
      ? settings.fallbackReviewers
      : settings.fallbackReviewer ? [settings.fallbackReviewer] : [];
    const configured = [settings.defaultReviewer,
      ...fallbacks.filter((name) => name !== "main-session")].filter(Boolean);
    const attempts = request.fallbackAttempts || [];
    for (const reviewer of configured) {
      const failures = attempts.filter((attempt) =>
        attempt.reviewer === reviewer).length;
      if (failures < threshold) return reviewer;
    }
    return fallbacks.includes("main-session") ? "main-session" : null;
  }

  function authorityRunSubject(flags) {
    const requestId = String(flags.request || "");
    if (!requestId) fail("authority run requires --request <id>");
    const subjectActor = String(flags["subject-actor"] || "").trim();
    if (!subjectActor) fail("authority run requires --subject-actor");
    const subjectSession = String(flags["subject-session"] || "").trim() || null;
    const subjectProvider = String(flags["subject-provider-family"] || "").trim().toLowerCase() || null;
    const subjectFamily = String(flags["subject-model-family"] || "").trim().toLowerCase() || null;
    const subjectModel = String(flags["subject-model"] || "").trim() || null;
    const aiSubject = [subjectSession, subjectProvider, subjectFamily, subjectModel]
      .some(Boolean);
    if (aiSubject && [subjectSession, subjectProvider, subjectFamily, subjectModel]
      .some((value) => !value))
      fail("AI implementation provenance requires subject session, provider family, model family, and model");
    return { requestId, subjectActor, subjectSession, subjectProvider,
      subjectFamily, subjectModel, aiSubject };
  }

  function authorityRunReviewer(id, flags, subject) {
    const { requestId, subjectActor, subjectProvider, subjectFamily,
      aiSubject } = subject;
    const reviewSettings = foundationPolicy().review || {};
    const requestEntry = authorityStore.list(id)
      .find((row) => row.value.requestId === requestId);
    if (!requestEntry) fail(`unknown authority request '${requestId}'`);
    const reviewerName = configuredReviewerRoute(reviewSettings, requestEntry.value,
      String(flags.reviewer || "").trim() || null,
      String(flags["automatic-reviewer"] || "").trim() || null);
    if (!reviewerName)
      fail("configured reviewer infrastructure retries are exhausted; configure a fallback reviewer or pause");
    if (reviewerName === "main-session" && !requestEntry.value.mainSessionFallback)
      fail("main-session fallback was selected without a recorded configured reviewer failure");
    const configured = reviewerName === "main-session"
      ? { identity: requestEntry.value.fallbackAttempts?.at(-1)?.reviewer || "configured-reviewer",
        providerFamily: "", modelFamily: "" }
      : reviewerConfig(reviewerName);
    const configuredProvider = String(configured.providerFamily).toLowerCase();
    const configuredFamily = String(configured.modelFamily).toLowerCase();
    const sameFamily = aiSubject && subjectProvider === configuredProvider &&
      subjectFamily === configuredFamily;
    if (sameFamily && reviewSettings.diversity !== "single-model")
      fail(`configured reviewer '${reviewerName}' shares the implementation provider/model family; choose a diverse configured reviewer or commit review.diversity='single-model' before Build`);
    if (aiSubject && reviewSettings.independence !== "self" &&
        subjectActor.toLowerCase() === configured.identity.toLowerCase())
      fail(`configured reviewer '${reviewerName}' shares the implementation identity; use a distinct reviewer identity/session or commit review.independence='self' before Build`);
    return { reviewSettings, requestEntry, reviewerName, configured };
  }

  function runAuthorityReviewerUnlocked(id, flags = {}) {
    const subject = authorityRunSubject(flags);
    const { requestId, subjectActor, subjectSession, subjectProvider,
      subjectFamily, subjectModel, aiSubject } = subject;
    const reviewer = authorityRunReviewer(id, flags, subject);
    const { reviewSettings, reviewerName, configured } = reviewer;
    let { requestEntry } = reviewer;
    function resumeMainSessionFallback() {
      if (!requestEntry.value.mainSessionFallback)
        return { handled: false, value: null };
      const fallback = requestEntry.value.mainSessionFallback;
      if (fallback.status !== "provenance-unavailable")
        fail(`configured reviewer already failed; complete the reserved main-session fallback with authority status/record instead of rerunning authority run`);
      const storedSubject = fallback.subject || {};
      const mainSession = mainSessionProvenance(id, flags, storedSubject);
      if (mainSession.missing.length) {
        const blocked = {
          status: "main-session-provenance-unavailable",
          changeId: id,
          requestId,
          failedReviewer: requestEntry.value.fallbackAttempts?.at(-1)?.reviewer ||
            configured.identity,
          infrastructureError: requestEntry.value.fallbackAttempts?.at(-1)?.summary ||
            "configured reviewer infrastructure failed",
          missing: mainSession.missing,
          action: "Expose the calling host session/model provenance and rerun authority run with --main-session-* fields; the failed reviewer will not run again."
        };
        console.log(JSON.stringify(blocked, null, 2));
        return { handled: true, value: blocked };
      }
      const resumed = dispatchAuthorityUnlocked(id, {
        request: requestId,
        scope: fallback.scope,
        ...(fallback.scope === "delta"
          ? { "base-attempt": fallback.baseAttemptDigest } : {}),
        "reviewer-type": "ai",
        "reviewer-identity": mainSession.identity,
        "reviewer-provider-family": mainSession.providerFamily,
        "reviewer-model-family": mainSession.modelFamily,
        "reviewer-model": mainSession.modelId,
        "reviewer-session": mainSession.sessionId
      });
      const resumedEntry = authorityStore.list(id)
        .find((row) => row.value.requestId === requestId);
      authorityStore.replace(resumedEntry, {
        ...resumedEntry.value,
        mainSessionFallback: {
          ...resumedEntry.value.mainSessionFallback,
          status: "awaiting-response",
          reviewer: {
            identity: mainSession.identity,
            providerFamily: mainSession.providerFamily,
            modelFamily: mainSession.modelFamily,
            modelId: mainSession.modelId,
            sessionId: mainSession.sessionId
          },
          missingProvenance: []
        }
      });
      const handback = mainSessionHandback(id, requestId,
        requestEntry.value.fallbackAttempts?.at(-1)?.reviewer || configured.identity,
        requestEntry.value.fallbackAttempts?.at(-1)?.summary ||
          "configured reviewer infrastructure failed",
        mainSession, resumed, storedSubject);
      console.log(JSON.stringify(handback, null, 2));
      return { handled: true, value: handback };
    }
    const resumedFallback = resumeMainSessionFallback();
    if (resumedFallback.handled) return resumedFallback.value;
    function recoverOrphanedController(entry) {
      if (entry.value.status !== "dispatched") return entry;
      requestEntry = entry;
      const controller = requestEntry.value.configuredController;
      if (!controller)
        fail(`configured review dispatch '${requestId}' is indeterminate; do not rerun it automatically. Abort it with a reason, then request the next bounded route or pause`);
      if (isProcessAlive(Number(controller.pid)))
        fail(`configured review dispatch '${requestId}' is still running in controller PID ${controller.pid}`);
      const attemptDigest = requestEntry.value.dispatch?.attemptDigest;
      const attempt = attemptDigest ? reviewAttemptByDigest(id, attemptDigest) : null;
      if (attempt?.status === "dispatched")
        completeReviewAttempt(id, attemptDigest, {
          reviewerSessionId: "",
          resultStatus: "error",
          findings: [],
          verifiedFindingIds: []
        });
      const currentEntry = authorityStore.list(id)
        .find((row) => row.value.requestId === requestId);
      const {
        dispatch: _orphanedDispatch,
        configuredController: _orphanedController,
        ...reopenable
      } = currentEntry.value;
      authorityStore.replace(currentEntry, {
        ...reopenable,
        status: "requested",
        orphanedControllers: [
          ...(currentEntry.value.orphanedControllers || []),
          {
            ...controller,
            recoveredAt: now(),
            result: "infrastructure-error"
          }
        ]
      });
      return authorityStore.list(id)
        .find((row) => row.value.requestId === requestId);
    }
    requestEntry = recoverOrphanedController(requestEntry);
    const state = loadRuntime(id);
    const history = state.reviewHistory || {
      aiAttempts: 0, totalAttempts: 0, chainHead: null
    };
    // Delivered attempts only: a completion whose resultStatus is "error"
    // never gains a receipt, so counting it here locked the change out of
    // review forever.
    const deliveredAi = deliveredAiAttempts(id, history);
    if (unrecordedDeliveredAiResponse(id, history, requestEntry.value.provider))
      fail("a completed AI response has no matching recorded receipt; repair that authority record or pause instead of starting another configured reviewer");
    const scope = deliveredAi.length === 0 ? "full" : "delta";
    const workspace = loadRuntime(id).workspace?.path || root;
    const dispatched = dispatchAuthorityUnlocked(id, {
      request: requestId,
      scope,
      ...(scope === "delta" ? { "base-attempt": deliveredAi.at(-1).digest } : {}),
      "reviewer-type": "ai",
      "reviewer-identity": configured.identity,
      "reviewer-provider-family": configured.providerFamily,
      "reviewer-model-family": configured.modelFamily,
      "reviewer-model": configured.modelId,
      "reviewer-session-deferred": true
    });
    const controllerEntry = authorityStore.list(id)
      .find((row) => row.value.requestId === requestId);
    authorityStore.replace(controllerEntry, {
      ...controllerEntry.value,
      configuredController: {
        version: 1,
        pid: process.pid,
        reviewer: configured.identity,
        startedAt: now()
      }
    });
    const report = runConfiguredReview({
      changeId: id,
      reviewer: reviewerName,
      workspace,
      packet: dispatched.packet,
      forbiddenSessionIds: reviewSettings.independence === "self" ? [] : [
        subjectSession,
        ...(scope === "delta" ? [deliveredAi.at(-1)?.reviewerSessionId] : [])
      ].filter(Boolean)
    });
    function handleConfiguredInfrastructureError() {
      if (report.status !== "error") return { handled: false, value: null };
      const failed = completeReviewAttempt(id,
        dispatched.dispatch.attemptDigest, {
          reviewerSessionId: String(report.reviewer?.sessionId || "").trim(),
          resultStatus: "error", findings: [], verifiedFindingIds: []
        });
      const failedEntry = authorityStore.list(id)
        .find((row) => row.value.requestId === requestId);
      const {
        dispatch: _failedDispatch,
        configuredController: _failedController,
        ...retryableRequest
      } = failedEntry.value;
      const failedRequest = {
        ...retryableRequest,
        status: "requested",
        fallbackAttempts: [
          ...(failedEntry.value.fallbackAttempts || []),
          {
            attemptDigest: failed.digest,
            reviewer: configured.identity,
            reportReference: report.reportReference,
            summary: report.summary
          }
        ]
      };
      authorityStore.replace(failedEntry, failedRequest);
      const nextReviewer = configuredReviewerRoute(reviewSettings, failedRequest);
      if (nextReviewer && nextReviewer !== "main-session") {
        const nextFlags = {
          ...flags,
          reviewer: undefined,
          "automatic-reviewer": nextReviewer
        };
        return { handled: true,
          value: runAuthorityReviewerUnlocked(id, nextFlags) };
      }
      if (!nextReviewer) {
        const exhausted = {
          status: "configured-reviewer-infrastructure-exhausted",
          changeId: id,
          requestId,
          failedReviewer: configured.identity,
          infrastructureError: report.summary,
          attempts: failedRequest.fallbackAttempts,
          action: "Configure review.fallbackReviewers, repair reviewer infrastructure, or pause."
        };
        console.log(JSON.stringify(exhausted, null, 2));
        return { handled: true, value: exhausted };
      }
      const mainSession = mainSessionProvenance(id, flags, aiSubject ? {
        identity: subjectActor,
        sessionId: subjectSession,
        providerFamily: subjectProvider,
        modelFamily: subjectFamily,
        modelId: subjectModel
      } : {});
      const refreshedEntry = authorityStore.list(id)
        .find((row) => row.value.requestId === requestId);
      authorityStore.replace(refreshedEntry, {
        ...refreshedEntry.value,
        mainSessionFallback: {
          status: mainSession.missing.length
            ? "provenance-unavailable" : "dispatching",
          failedAttemptDigest: failed.digest,
          scope,
          baseAttemptDigest: scope === "delta" ? deliveredAi.at(-1).digest : null,
          subject: {
            identity: subjectActor,
            sessionId: subjectSession,
            providerFamily: subjectProvider,
            modelFamily: subjectFamily,
            modelId: subjectModel
          },
          reviewer: mainSession.missing.length ? null : {
            identity: mainSession.identity,
            providerFamily: mainSession.providerFamily,
            modelFamily: mainSession.modelFamily,
            modelId: mainSession.modelId,
            sessionId: mainSession.sessionId
          },
          missingProvenance: mainSession.missing
        }
      });
      if (mainSession.missing.length) {
        const blocked = {
          status: "main-session-provenance-unavailable",
          changeId: id,
          requestId,
          failedReviewer: configured.identity,
          infrastructureError: report.summary,
          missing: mainSession.missing,
          action: "Expose the calling host session/model provenance and rerun authority run with --main-session-* fields; the failed reviewer will not run again."
        };
        console.log(JSON.stringify(blocked, null, 2));
        return { handled: true, value: blocked };
      }
      const mainDispatched = dispatchAuthorityUnlocked(id, {
        request: requestId,
        scope,
        ...(scope === "delta" ? {
          "base-attempt": deliveredAi.at(-1).digest
        } : {}),
        "reviewer-type": "ai",
        "reviewer-identity": mainSession.identity,
        "reviewer-provider-family": mainSession.providerFamily,
        "reviewer-model-family": mainSession.modelFamily,
        "reviewer-model": mainSession.modelId,
        "reviewer-session": mainSession.sessionId
      });
      const mainEntry = authorityStore.list(id)
        .find((row) => row.value.requestId === requestId);
      authorityStore.replace(mainEntry, {
        ...mainEntry.value,
        mainSessionFallback: {
          ...mainEntry.value.mainSessionFallback,
          status: "awaiting-response"
        }
      });
      const handback = mainSessionHandback(id, requestId, configured.identity,
        report.summary, mainSession, mainDispatched, {
          identity: subjectActor,
          sessionId: subjectSession,
          providerFamily: subjectProvider,
          modelFamily: subjectFamily,
          modelId: subjectModel
        });
      console.log(JSON.stringify(handback, null, 2));
      return { handled: true, value: handback };
    }
    const infrastructureResult = handleConfiguredInfrastructureError();
    if (infrastructureResult.handled) return infrastructureResult.value;
    function validateConfiguredReviewResult() {
    const reviewerSession = String(report.reviewer?.sessionId || "").trim();
    const infrastructureError = report.status === "error";
    if (!reviewerSession && !infrastructureError)
      fail("configured reviewer did not emit an actual session ID; the review cannot be recorded truthfully");
    const findingIds = report.findings.map((finding) => finding.id);
    if (findingIds.some((findingId) => !findingId) ||
        new Set(findingIds).size !== findingIds.length)
      fail("configured reviewer finding IDs must be non-empty and unique");
    if (scope === "delta" && !infrastructureError) {
      const expectedIds = [...(dispatched.packet.closureFindings?.ids || [])].sort();
      const verifiedIds = [...report.verifiedFindingIds].sort();
      if (JSON.stringify(expectedIds) !== JSON.stringify(verifiedIds))
        fail(`AI delta closure must verify exactly the first-round finding IDs: ${expectedIds.join(", ") || "<none>"}`);
      const scoped = dispatched.dispatch.scope.paths || [];
      const outside = report.findings.filter((finding) => {
        const path = String(finding.path || "").replace(/^\.\//, "");
        return !path || !scoped.some((candidate) =>
          candidate === path || candidate.endsWith(`/${path}`));
      });
      if (outside.length)
        fail(`AI delta reviewer reported findings outside the dispatched correction scope: ${outside.map((finding) => finding.id).join(", ")}`);
    }
    return { reviewerSession, infrastructureError };
    }
    const { reviewerSession, infrastructureError } = validateConfiguredReviewResult();
    const completed = completeReviewAttempt(id,
      dispatched.dispatch.attemptDigest, {
        reviewerSessionId: reviewerSession,
        resultStatus: report.status,
        findings: report.findings,
        verifiedFindingIds: report.verifiedFindingIds
      });
    const dispatchedEntry = authorityStore.list(id)
      .find((row) => row.value.requestId === requestId);
    const {
      configuredController: _completedController,
      ...completedRequest
    } = dispatchedEntry.value;
    const finalizedRequest = {
      ...completedRequest,
      dispatch: {
        ...dispatchedEntry.value.dispatch,
        attemptDigest: completed.digest,
        reviewer: {
          ...dispatchedEntry.value.dispatch.reviewer,
          sessionId: reviewerSession || null
        }
      }
    };
    authorityStore.replace(dispatchedEntry, finalizedRequest);
    const responsePath = join(root, ".foundation", "authority", id,
      `${requestId}-configured-review-response.json`);
    writeJson(responsePath, {
      version: Number(protocolVersion),
      requestId,
      changeId: id,
      type: "review",
      workspaceHash: dispatched.workspaceHash,
      status: report.status,
      evidence: {
        observed: report.summary,
        reference: [report.reportReference],
        reviewer: configured.identity,
        "reviewer-type": "ai",
        "reviewer-provider-family": configured.providerFamily,
        "reviewer-model-family": configured.modelFamily,
        "reviewer-model": configured.modelId,
        "reviewer-session": reviewerSession || null,
        "subject-actor": subjectActor,
        ...(aiSubject ? {
          "subject-session": subjectSession,
          "subject-provider-family": subjectProvider,
          "subject-model-family": subjectFamily,
          "subject-model": subjectModel
        } : {}),
        "unresolved-blockers": report.findings.filter((finding) =>
          ["blocker", "major"].includes(finding.severity)).length,
        "verified-findings": report.verifiedFindingIds.length,
        findings: report.findings,
        verifiedFindingIds: report.verifiedFindingIds,
        ...(dispatched.dispatch.scope.mode === "delta"
          ? { "scope-path": dispatched.dispatch.scope.paths } : {})
      }
    });
    recordAuthorityUnlocked(id, { request: requestId, response: responsePath });
    return report;
  }

  function runAuthorityReviewer(id, flags = {}) {
    return withAuthorityLock(id, () => runAuthorityReviewerUnlocked(id, flags));
  }

  function authorityStatusValue(id, requestId = null) {
    loadRuntime(id);
    const workspaceHash = relevantHash(id);
    // Scoped requests carry their own hash; status compares against the
    // composite for unscoped ones only.
    const result = authorityStore.status(id, workspaceHash, requestId,
      (request) => authorityWorkspaceHash(id, request.provider));
    if (!result.found) fail(`unknown authority request '${requestId}'`);
    return result.value;
  }

  // The response shape is a contract. Without a way to emit it, a responder
  // discovers it one rejection at a time while the person who gave the verdict
  // waits. The identity fields are prefilled because those are exactly the
  // ones `validateResponse` matches against the request.
  function responseTemplate(request) {
    // An acceptance packet carries its claims as a plain array; a review packet
    // compacts them past twelve into `{count, preview, digest}`. Only acceptance
    // reads `criterion`, but this ran before the type check, so `.map` on the
    // compact object threw for every review with more than twelve claims — the
    // template was unreachable for exactly the changes with the most to inspect.
    const claimRows = expandList(request.packet?.claims);
    const criteria = claimRows.map((claim) => claim.criterion).filter(Boolean);
    if (criteria.length && criteria.length < listCount(request.packet?.claims))
      criteria.push(`<${listCount(request.packet?.claims) - criteria.length
        } further criteria omitted from this preview; read the packet's claims>`);
    const evidence = {
      observed: "<what the responder actually saw, in their own words>",
      artifact: [],
      reference: ["<url or path the responder inspected>"]
    };
    if (request.type === "acceptance") {
      evidence.acceptor = "<name of the person who decided>";
      evidence.decision = "accept";
      evidence.criterion = criteria.length ? criteria
        : ["<criterion the responder confirmed>"];
    } else {
      // `validateResponse` forwards every key under `evidence` into the receipt
      // flags, so this is where a reviewer states provenance. Omitting these
      // fields from the template made the documented path a dead end: the
      // receipt refused the response for a missing `--subject-actor`, and
      // `authority record` does not accept that flag. Naming them here is the
      // difference between a template a responder can complete and one that
      // cannot be recorded at all.
      const dispatched = request.dispatch?.reviewer || null;
      evidence.reviewer = dispatched?.identity || "<independent reviewer identity>";
      evidence["reviewer-type"] = dispatched?.type || "human|ai";
      if (!dispatched || dispatched.type === "ai") {
        evidence["reviewer-provider-family"] = dispatched?.providerFamily || "<AI provider family>";
        evidence["reviewer-model-family"] = dispatched?.modelFamily || "<AI model family>";
        evidence["reviewer-model"] = dispatched?.modelId || "<AI model id>";
        evidence["reviewer-session"] = dispatched?.sessionId || "<AI review session>";
      }
      evidence["subject-actor"] = "<who or what implemented the change>";
      evidence["subject-session"] = "<implementation session id, omit for a human implementer>";
      evidence["subject-provider-family"] = "<implementation provider family, omit for a human implementer>";
      evidence["subject-model-family"] = "<implementation model family, omit for a human implementer>";
      evidence["subject-model"] = "<implementation model id, omit for a human implementer>";
      // Numbers, not placeholders, because the receipt parses them. A passing
      // review now has to state its blocker count rather than inherit a zero
      // from an absent flag, so the template is where the responder is asked
      // for it — the same lesson as the provenance fields above.
      evidence["unresolved-blockers"] = 0;
      evidence["verified-findings"] = 0;
      evidence.findings = [];
      evidence.verifiedFindingIds = request.packet?.closureFindings?.ids || [];
      if (request.dispatch?.scope?.mode === "delta")
        evidence["scope-path"] = request.dispatch.scope.paths;
    }
    return {
      version: Number(protocolVersion),
      requestId: request.requestId,
      changeId: request.changeId,
      type: request.type,
      workspaceHash: request.workspaceHash,
      status: "pass|fail|inconclusive|error",
      evidence
    };
  }

  function showAuthorityStatus(id, flags = {}) {
    const value = authorityStatusValue(id, flags.request || null);
    if (!flags.template) {
      console.log(JSON.stringify(value, null, 2));
      return;
    }
    const open = value.requests.filter((request) => authorityStore.isOpen(request.status));
    if (!open.length)
      fail(`no open authority request for '${id}'; nothing to respond to`);
    console.log(JSON.stringify(open.length === 1
      ? responseTemplate(open[0]) : open.map(responseTemplate), null, 2));
  }

  function recordAuthorityRequest(id, flags) {
    const requestId = String(flags.request || "");
    const responsePath = flags.response ? resolve(flags.response) : null;
    if (!requestId || !responsePath)
      fail("authority record requires --request <id> --response <file>");
    const entry = authorityStore.list(id).find((row) => row.value.requestId === requestId);
    if (!entry) fail(`unknown authority request '${requestId}'`);
    const effective = authorityStatusValue(id, requestId).requests[0];
    const request = effective || entry.value;
    if (request.status === "stale" ||
        request.workspaceHash !== authorityWorkspaceHash(id, request.provider))
      fail(`authority request '${requestId}' is stale — the workspace changed after it was issued; request review and acceptance last, after the workspace stops changing, then re-request: claude-foundation authority request ${id} --type ${request.type}`);
    if (!authorityStore.isOpen(request.status))
      fail(`authority request '${requestId}' is ${request.status}`);
    if (request.type === "review" && request.reviewCircuit === "full-delta" &&
        request.status !== "dispatched")
      fail(`authority request '${requestId}' must be dispatched before its response is recorded`);
    if (!existsSync(responsePath)) fail(`authority response not found: ${flags.response}`);
    return { requestId, responsePath, entry, request };
  }

  function validateDispatchedReviewResponse(request, response, evidenceFlags) {
    if (request.type !== "review" || !request.dispatch) return null;
    const reviewer = request.dispatch.reviewer;
    validateDispatchedReviewerIdentity(reviewer, evidenceFlags);
    const { findings, verifiedFindingIds, dispatchedScope } =
      normalizeDispatchedReviewEvidence(request, evidenceFlags);
    validateReviewFindingClosure(request, response, evidenceFlags, findings,
      verifiedFindingIds, dispatchedScope);
    return { reviewer, findings, verifiedFindingIds };
  }

  function validateDispatchedReviewerIdentity(reviewer, evidenceFlags) {
    const identity = reviewEvidenceText(evidenceFlags["reviewer-identity"] ||
      evidenceFlags.reviewer).trim();
    const comparisons = [
      ["reviewer identity", identity, reviewer.identity],
      ["reviewer type", reviewEvidenceText(evidenceFlags["reviewer-type"]).toLowerCase(), reviewer.type],
      ["reviewer provider family", nullableReviewEvidence(
        evidenceFlags["reviewer-provider-family"], true), reviewer.providerFamily],
      ["reviewer model family", nullableReviewEvidence(
        evidenceFlags["reviewer-model-family"], true), reviewer.modelFamily],
      ["reviewer model", nullableReviewEvidence(evidenceFlags["reviewer-model"]), reviewer.modelId],
      ["reviewer session", nullableReviewEvidence(evidenceFlags["reviewer-session"]), reviewer.sessionId]
    ];
    const mismatch = comparisons.filter(([, actual, expected]) => actual !== expected)
      .map(([label, actual, expected]) => `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    if (mismatch.length)
      fail(`authority response does not match its dispatched reviewer\n  ${mismatch.join("\n  ")}`);
  }

  function reviewEvidenceText(value) {
    return String(value || "");
  }

  function nullableReviewEvidence(value, lowerCase = false) {
    const text = lowerCase ? reviewEvidenceText(value).toLowerCase()
      : reviewEvidenceText(value);
    return text || null;
  }

  function normalizeDispatchedReviewEvidence(request, evidenceFlags) {
    const suppliedScope = [...new Set(evidenceFlags["scope-path"] || [])].sort();
    const dispatchedScope = [...new Set(request.dispatch.scope.paths || [])].sort();
    if (suppliedScope.length && JSON.stringify(suppliedScope) !== JSON.stringify(dispatchedScope))
      fail("authority response scope-path must exactly match the paths in its dispatched delta packet");
    evidenceFlags["scope-path"] = dispatchedScope;
    const findings = Array.isArray(evidenceFlags.findings) ? evidenceFlags.findings : [];
    const verifiedFindingIds = Array.isArray(evidenceFlags.verifiedFindingIds)
      ? evidenceFlags.verifiedFindingIds : [];
    return { findings, verifiedFindingIds, dispatchedScope };
  }

  function validateReviewFindingClosure(request, response, evidenceFlags, findings,
    verifiedFindingIds, dispatchedScope) {
    const unresolved = findings.filter((finding) =>
      ["blocker", "major"].includes(String(finding?.severity || "").toLowerCase()));
    if (Number(evidenceFlags["unresolved-blockers"] || 0) !== unresolved.length)
      fail("review unresolved-blockers must equal the blocker/major finding rows");
    if (!request.packet?.closureFindings) return;
    if (response.status === "error") return;
    const expectedIds = [...(request.packet.closureFindings.ids || [])].sort();
    const suppliedIds = [...new Set(verifiedFindingIds.map((value) =>
      String(value).trim()).filter(Boolean))].sort();
    if (JSON.stringify(expectedIds) !== JSON.stringify(suppliedIds))
      fail("delta review verifiedFindingIds must exactly close the first-round finding IDs");
    if (request.dispatch.scope.mode !== "delta") return;
    const outside = findings.filter((finding) => {
      const path = String(finding?.path || "").replace(/^\.\//, "");
      return !path || !dispatchedScope.some((candidate) =>
        candidate === path || candidate.endsWith(`/${path}`));
    });
    if (outside.length)
      fail("delta review findings must stay inside the dispatched correction paths");
  }

  function completeDispatchedReview(id, entry, request, reviewResult) {
    if (!reviewResult) return;
    const attempt = reviewAttemptByDigest(id, request.dispatch.attemptDigest);
    if (attempt?.status !== "dispatched") return;
    const completed = completeReviewAttempt(id, attempt.digest, {
      reviewerSessionId: reviewResult.reviewer.sessionId,
      resultStatus: reviewResult.responseStatus,
      findings: reviewResult.findings,
      verifiedFindingIds: reviewResult.verifiedFindingIds
    });
    request.dispatch = {
      ...request.dispatch,
      attemptDigest: completed.digest,
      reviewer: { ...request.dispatch.reviewer, sessionId: completed.reviewerSessionId }
    };
    authorityStore.replace(entry, request);
  }

  function recordAuthorityInfrastructureError(entry, request, requestId,
    responsePath) {
    authorityStore.replace(entry, {
      ...request,
      status: "error",
      infrastructureError: true,
      responseDigest: fileDigest(responsePath),
      receiptDigest: null,
      completedAt: now()
    });
    console.log(`AUTHORITY ${requestId}: infrastructure error\n  receipt: unchanged\n  next: repair the configured reviewer, run doctor --stage prove, then request the bounded retry`);
  }

  function recordAuthorityReceipt(id, entry, request, requestId, response,
    responsePath, evidenceFlags) {
    const priorPath = receiptPath(id, request.provider);
    const prior = existsSync(priorPath) ? readFileSync(priorPath) : null;
    recordReceipt(id, request.provider, response.status, {
      ...evidenceFlags,
      claims: request.claimIds.join(","), workspaceHash: request.workspaceHash,
      "review-attempt": request.dispatch?.attemptDigest,
      source: evidenceFlags.source || `authority-request:${requestId}`,
      "recorded-by": evidenceFlags["recorded-by"] || `authority-bridge:${requestId}`
    }, { reviewCircuit: request.reviewCircuit || "legacy" });
    const validity = receiptValidity(id, request.provider, request.workspaceHash);
    if (response.status === "pass" && validity.validity !== "valid") {
      if (prior) writeFileSync(priorPath, prior); else if (existsSync(priorPath)) rmSync(priorPath);
      fail(`authority response produced invalid evidence: ${validity.validity}`);
    }
    const receiptDigest = fileDigest(priorPath);
    authorityStore.complete(entry, request, response, fileDigest(responsePath), receiptDigest);
    console.log(`AUTHORITY ${requestId}: ${response.status}\n  receipt: ${relative(root, priorPath)}`);
  }

  function recordAuthorityUnlocked(id, flags = {}) {
    const { requestId, responsePath, entry, request } = recordAuthorityRequest(id, flags);
    const response = readJson(responsePath);
    const validated = authorityStore.validateResponse(response, request, id);
    if (!validated.valid) fail(validated.reason);
    const evidenceFlags = validated.evidence;
    const reviewResult = validateDispatchedReviewResponse(request, response,
      evidenceFlags);
    completeDispatchedReview(id, entry, request, reviewResult && {
      ...reviewResult, responseStatus: response.status
    });
    // A configured reviewer/tool failure is infrastructure telemetry, not a
    // delivered review verdict. Persist the completed error attempt and close
    // this request, but do not overwrite an earlier full/delta receipt or
    // manufacture a baseline receipt from an error. The bounded infrastructure
    // retry therefore starts full when no delivered baseline exists and keeps
    // a prior delivered baseline when a closure runner failed.
    if (request.type === "review" && response.status === "error") {
      recordAuthorityInfrastructureError(entry, request, requestId, responsePath);
      return;
    }
    recordAuthorityReceipt(id, entry, request, requestId, response, responsePath,
      evidenceFlags);
  }

  function recordAuthority(id, flags = {}) {
    return withAuthorityLock(id, () => recordAuthorityUnlocked(id, flags));
  }

  const recordVerifiedCi = recordVerifiedCiOperation.bind(null, {
    providerConfig,
    resolvePath: resolve,
    pathExists: existsSync,
    readJson,
    providerWorkspaceHash,
    providerRepository,
    providerWorkspace,
    gitHead,
    validateSignedCiEnvelope,
    ciEvidenceProtocolVersion,
    recordReceipt,
    providerClaims,
    fail,
    output: console
  });

  // The bounded infrastructure recovery consumed by a failed reviewer run has
  // no automatic escape: the guard's own message routes the operator through a
  // provider repair and doctor. This is that route — it re-runs the reviewer
  // diagnosis in-process and acknowledges the consumed attempts only when the
  // diagnosis passes and the decision reference is fresh.
  function resetInfrastructureAuthority(id, flags = {}) {
    return withAuthorityLock(id, () => {
      validate(id, "active", { quiet: true });
      const decisionRef = String(flags["decision-ref"] || "").trim();
      if (!decisionRef) fail("authority reset-infra requires --decision-ref <ref>");
      const reviewerName = String(flags.reviewer || "").trim() || null;
      const status = reviewerStatus(reviewerName);
      if (!status.ok)
        fail(`configured reviewer '${status.reviewer}' still fails its ${status.check} diagnosis: ${status.detail}`);
      const result = acknowledgeInfrastructureAttempts(id, decisionRef);
      console.log(`AUTHORITY ${id}: infrastructure retries reset\n  reviewer: ${
        status.reviewer} (${status.check})\n  acknowledged: ${
        result.digests.length} attempt(s)\n  decision: ${decisionRef
        }\n  next: request and dispatch the AI review again`);
      return result;
    });
  }

  // A moved base whose replay altered the change's diff expires a delivered
  // passing verdict through no fault of the work. This route releases exactly
  // that attempt from the wave budget, on a recorded user decision, so the
  // fresh review the move forces cannot brick the change at the cap. No
  // reviewer diagnosis here — nothing is broken; only the accounting moves.
  function resetBaseMoveAuthority(id, flags = {}) {
    return withAuthorityLock(id, () => {
      validate(id, "active", { quiet: true });
      const decisionRef = String(flags["decision-ref"] || "").trim();
      if (!decisionRef) fail("authority reset-base-move requires --decision-ref <ref>");
      const result = acknowledgeBaseMoveAttempts(id, decisionRef);
      console.log(`AUTHORITY ${id}: base-move review release\n  movement: ${
        result.movementKey}\n  released: ${result.digests.length} attempt(s)\n  decision: ${
        decisionRef}\n  next: request and dispatch the AI review again`);
      return result;
    });
  }

  return {
    authorityProvider,
    authorityPacket,
    requestAuthority,
    dispatchAuthority,
    runAuthorityReviewer,
    abortAuthority,
    resetInfrastructureAuthority,
    resetBaseMoveAuthority,
    unrecordedDeliveredAiResponse,
    authorityStatusValue,
    showAuthorityStatus,
    recordAuthority,
    recordVerifiedCi
  };
}
