import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function createReceiptValidity({
  evidenceVault, providerProtocolVersion, adapterProtocolVersion,
  reviewProtocolVersion, acceptanceProtocolVersion, receiptPath, readJson,
  receiptPrototypeEvidence, contractFingerprint, providerConfig,
  providerCapability, reviewProvenanceResult, reviewPolicy,
  reviewAttemptByDigest, reviewAttemptIsValid, resolvedAcceptance,
  claimsForProvider, stableHash, adapterFingerprint, providerWorkspaceHash,
  providerInputIdentity, validateArtifact, relevantHash
}) {
  function receiptValidity(id, provider, hash = relevantHash(id)) {
    const path = receiptPath(id, provider);
    if (!existsSync(path)) return { provider, validity: "missing" };
    const value = readJson(path);
    if (String(value.providerProtocolVersion || "") !== providerProtocolVersion)
      return { provider, validity: "provider-version-stale", status: value.status };
    if (receiptPrototypeEvidence(id, provider, value))
      return { provider, validity: "prototype-evidence", status: value.status };
    if (value.contractFingerprint !== contractFingerprint(id))
      return { provider, validity: "contract-stale", status: value.status };
    const config = providerConfig(id, provider);
    const capability = providerCapability(provider, config);
    if (capability === "review") {
      if (String(value.reviewProtocolVersion || "") !== reviewProtocolVersion)
        return { provider, validity: "review-version-stale", status: value.status };
      const provenance = reviewProvenanceResult(value.review);
      if (!provenance.complete ||
          (!provenance.independent && reviewPolicy(id).independence !== "self"))
        return { provider, validity: "review-not-independent", status: value.status };
      const attemptDigest = String(value.review?.attemptDigest || "");
      const attemptDir = join(evidenceVault, id, "review-attempts");
      const attemptPath = attemptDigest && existsSync(attemptDir)
        ? readdirSync(attemptDir).find((name) => name.includes(attemptDigest.slice(0, 12))) : null;
      if (!attemptPath)
        return { provider, validity: "review-attempt-history-missing", status: value.status };
      const attempt = reviewAttemptByDigest(id, attemptDigest);
      if (!reviewAttemptIsValid(value, attempt))
        return { provider, validity: "review-attempt-history-invalid", status: value.status };
      if (reviewPolicy(id).diversity === "required" && !provenance.diverse)
        return { provider, validity: "review-not-diverse", status: value.status };
      if (Number(value.review?.findings?.unresolvedBlockers || 0) > 0)
        return { provider, validity: "review-blockers", status: value.status };
    }
    if (capability === "acceptance") {
      if (String(value.acceptanceProtocolVersion || "") !== acceptanceProtocolVersion)
        return { provider, validity: "acceptance-version-stale", status: value.status };
      const currentAcceptance = resolvedAcceptance(id);
      const criteria = value.acceptance?.criteria;
      const actualClaims = Array.isArray(value.claims) ? [...value.claims].sort() : [];
      const expectedClaims = claimsForProvider(id, provider).map((claim) => claim.id).sort();
      if (value.acceptance?.actor?.type !== "human" ||
          !String(value.acceptance?.actor?.identity || "").trim() ||
          value.acceptance?.decision !== "accept" ||
          !Array.isArray(criteria) || criteria.length === 0 ||
          criteria.some((criterion) => !String(criterion).trim()) ||
          new Set(criteria.map((criterion) => String(criterion).trim())).size !== criteria.length ||
          stableHash(actualClaims) !== stableHash(expectedClaims) ||
          value.acceptance?.subjectWorkspaceHash !== value.workspaceHash ||
          value.acceptance?.reason !== currentAcceptance.reason)
        return { provider, validity: "acceptance-invalid", status: value.status };
    }
    const expectedFingerprint = config
      ? adapterFingerprint(id, provider, config)
      : stableHash({
        adapterProtocolVersion: value.adapterProtocolVersion || adapterProtocolVersion,
        providerProtocolVersion,
        provider,
        adapter: value.adapter || "external",
        adapterVersion: String(value.providerVersion || "1"),
        command: value.command || null,
        claims: value.claims || [],
        environment: value.environment || null,
        inputMode: value.capability?.inputMode || null,
        project: value.project || null
      });
    if (value.providerFingerprint !== expectedFingerprint)
      return { provider, validity: "provider-fingerprint-stale", status: value.status };
    const expectedWorkspaceHash = providerWorkspaceHash(id, provider, hash);
    const expectedInputs = providerInputIdentity(id, provider, config, expectedWorkspaceHash);
    let reusableInputs = false;
    if (value.workspaceHash !== expectedWorkspaceHash) {
      if (expectedInputs.mode === "declared" &&
          value.inputIdentity?.mode === "declared" &&
          value.inputIdentity.fingerprint === expectedInputs.fingerprint)
        reusableInputs = true;
      else return { provider, validity: "stale", status: value.status };
    }
    if (value.inputIdentity?.fingerprint !== expectedInputs.fingerprint)
      return { provider, validity: "provider-inputs-stale", status: value.status };
    if (value.status !== "pass") return { provider, validity: value.status };
    const requiredClaims = claimsForProvider(id, provider).map((claim) => claim.id);
    const covered = new Set(value.claims || []);
    if (requiredClaims.some((claim) => !covered.has(claim)))
      return { provider, validity: "incomplete-claims", status: value.status };
    const invalidArtifacts = (value.artifacts || []).filter((artifact) =>
      artifact.required !== false && !validateArtifact(artifact));
    if (invalidArtifacts.length)
      return { provider, validity: "invalid-artifacts", status: value.status };
    if (value.status === "pass" && value.execution === "harness") {
      if (!(value.artifacts || []).some((artifact) => artifact.type === "command-log"))
        return { provider, validity: "execution-log-missing", status: value.status };
    } else if (value.status === "pass") {
      if (!String(value.observed || "").trim())
        return { provider, validity: "external-observation-missing", status: value.status };
      if (!String(value.provenance?.source || "").trim())
        return { provider, validity: "external-provenance-missing", status: value.status };
      if ((value.artifacts || []).length === 0 && (value.references || []).length === 0)
        return { provider, validity: "external-evidence-missing", status: value.status };
    }
    return reusableInputs
      ? {
        provider, validity: "reusable-inputs", status: value.status,
        receipt: value, expectedWorkspaceHash, expectedInputs
      }
      : { provider, validity: "valid", receipt: value };
  }

  return { receiptValidity };
}
