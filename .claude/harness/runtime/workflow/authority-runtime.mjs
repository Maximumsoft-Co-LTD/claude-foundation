import { randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { relative, resolve } from "node:path";

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
  fail
}) {
  function authorityProvider(id, type) {
    return requiredProviders(id).find((provider) =>
      providerCapability(provider, providerConfig(id, provider)) === type) || type;
  }

  function authorityPacket(id, type) {
    if (type === "review") return reviewPacketValue(id);
    const state = loadRuntime(id);
    const contract = evidence(id);
    const acceptance = resolvedAcceptance(id, state, contract);
    return {
      version: Number(protocolVersion), packetType: "acceptance", changeId: id,
      workspaceHash: relevantHash(id), reason: acceptance.reason,
      claims: contract.claims.filter((claim) => acceptance.claimIds.includes(claim.id))
        .map((claim) => ({ id: claim.id, scenario: claim.scenario, impact: claim.impact })),
      requiredActor: "human"
    };
  }

  function requestAuthority(id, flags = {}) {
    const type = String(flags.type || "");
    if (!["review", "acceptance"].includes(type))
      fail("authority request --type must be review|acceptance");
    validate(id, "active", { quiet: true });
    const pending = pendingTasks(id);
    if (pending.length)
      fail(`authority request requires completed implementation tasks: ${pending.map((task) => task.id).join(", ")}`);
    const provider = authorityProvider(id, type);
    if (!requiredProviders(id).includes(provider))
      fail(`change '${id}' does not require ${type} authority`);
    const workspaceHash = relevantHash(id);
    const existing = authorityStore.list(id).find((entry) =>
      entry.value.type === type && entry.value.provider === provider &&
      entry.value.workspaceHash === workspaceHash &&
      ["requested", "dispatched", "pending"].includes(entry.value.status));
    if (existing) {
      console.log(JSON.stringify(existing.value, null, 2));
      return existing.value;
    }
    const packet = authorityPacket(id, type);
    const requestId = `${type}-${Date.now()}-${randomBytes(8).toString("hex")}`;
    const request = {
      version: Number(protocolVersion), requestId, changeId: id, type, provider,
      status: "requested", workspaceHash, claimIds: claimsForProvider(id, provider).map((claim) => claim.id),
      packet, packetDigest: stableHash(packet), requestedAt: now(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      requirements: type === "review" ? reviewPolicy(id) : {
        actor: "human", acceptance: resolvedAcceptance(id)
      }
    };
    authorityStore.writeRequest(id, request);
    console.log(JSON.stringify(request, null, 2));
    return request;
  }

  function authorityStatusValue(id, requestId = null) {
    loadRuntime(id);
    const workspaceHash = relevantHash(id);
    const result = authorityStore.status(id, workspaceHash, requestId);
    if (!result.found) fail(`unknown authority request '${requestId}'`);
    return result.value;
  }

  function showAuthorityStatus(id, flags = {}) {
    console.log(JSON.stringify(authorityStatusValue(id, flags.request || null), null, 2));
  }

  function recordAuthority(id, flags = {}) {
    const requestId = String(flags.request || "");
    const responsePath = flags.response ? resolve(flags.response) : null;
    if (!requestId || !responsePath)
      fail("authority record requires --request <id> --response <file>");
    const entry = authorityStore.list(id).find((row) => row.value.requestId === requestId);
    if (!entry) fail(`unknown authority request '${requestId}'`);
    const request = entry.value;
    if (!authorityStore.isOpen(request.status))
      fail(`authority request '${requestId}' is ${request.status}`);
    if (request.workspaceHash !== relevantHash(id))
      fail(`authority request '${requestId}' is stale`);
    if (!existsSync(responsePath)) fail(`authority response not found: ${flags.response}`);
    const response = readJson(responsePath);
    const validated = authorityStore.validateResponse(response, request, id);
    if (!validated.valid) fail(validated.reason);
    const evidenceFlags = validated.evidence;
    const priorPath = receiptPath(id, request.provider);
    const prior = existsSync(priorPath) ? readFileSync(priorPath) : null;
    recordReceipt(id, request.provider, response.status, {
      ...evidenceFlags,
      claims: request.claimIds.join(","), workspaceHash: request.workspaceHash,
      source: evidenceFlags.source || `authority-request:${requestId}`,
      "recorded-by": evidenceFlags["recorded-by"] || `authority-bridge:${requestId}`
    });
    const validity = receiptValidity(id, request.provider, request.workspaceHash);
    if (response.status === "pass" && validity.validity !== "valid") {
      if (prior) writeFileSync(priorPath, prior); else if (existsSync(priorPath)) rmSync(priorPath);
      fail(`authority response produced invalid evidence: ${validity.validity}`);
    }
    const receiptDigest = fileDigest(priorPath);
    authorityStore.complete(entry, request, response, fileDigest(responsePath), receiptDigest);
    console.log(`AUTHORITY ${requestId}: ${response.status}\n  receipt: ${relative(root, priorPath)}`);
  }

  function recordVerifiedCi(id, provider, source) {
    const config = providerConfig(id, provider);
    if (!config || config.adapter !== "external" || !config.ci?.publicKey || !config.ci?.issuer)
      fail(`provider '${provider}' requires external ci.issuer and ci.publicKey configuration`);
    const path = resolve(source || "");
    if (!source || !existsSync(path)) fail("evidence verify-ci requires a signed JSON envelope");
    const envelope = readJson(path);
    const workspaceHash = providerWorkspaceHash(id, provider);
    const repository = providerRepository(id, provider, config);
    const head = repository ? gitHead(repository.workspacePath) : gitHead(providerWorkspace(id, provider));
    const result = validateSignedCiEnvelope({
      envelope,
      protocolVersion: ciEvidenceProtocolVersion,
      issuer: config.ci.issuer,
      publicKey: config.ci.publicKey,
      changeId: id,
      provider,
      workspaceHash,
      head
    });
    if (!result.valid) fail(result.reason);
    const { payload, artifacts, status } = result;
    recordReceipt(id, provider, status, {
      claims: providerClaims(id, provider, config).join(","), workspaceHash,
      observed: String(payload.observed || `CI ${payload.status}; commit ${payload.commit || "unknown"}`),
      source: `signed-ci:${payload.issuer}`,
      reference: [payload.runUrl, ...artifacts.map((artifact) =>
        `artifact:${artifact.name}:sha256:${artifact.sha256}`)],
      "recorded-by": `evidence-verify-ci:${payload.issuer}`
    });
    console.log(`CI EVIDENCE ${id}/${provider}: ${status}\n  run: ${payload.runUrl}`);
  }

  return {
    authorityProvider,
    authorityPacket,
    requestAuthority,
    authorityStatusValue,
    showAuthorityStatus,
    recordAuthority,
    recordVerifiedCi
  };
}
