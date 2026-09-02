import { createHash } from "node:crypto";

function ciConfigurationValid(config) {
  return config?.adapter === "external" &&
    typeof config.ci?.issuer === "string" && Boolean(config.ci.issuer.trim()) &&
    typeof config.ci?.publicKey === "string" &&
    config.ci.publicKey.includes("PUBLIC KEY");
}

export function riskRequiresCi(state, reviewRisk = null) {
  if (state?.riskBasedCiRequired !== true) return false;
  if (reviewRisk?.tier === "high") return true;
  const capabilities = new Set(state?.evidenceCapabilities || []);
  const repositories = Object.values(state?.repositories || {});
  return state?.impact === "high" || repositories.length > 1 ||
    [
      "compatibility", "cross-repo-contract", "data-migration", "deployment",
      "security-static"
    ].some((capability) => capabilities.has(capability));
}

export function authorityPreflightValue({
  changeId, state, reviewRisk = null, providers = [], providerConfig = () => null,
  providerCapability = (provider) => provider,
  acceptance = null,
  grounding = null,
  handoffs = null
}) {
  const ciRequired = riskRequiresCi(state, reviewRisk);
  const configuredCi = providers.filter((provider) =>
    ciConfigurationValid(providerConfig(provider)));
  const capabilities = providers.reduce((rows, provider) => {
    const capability = providerCapability(provider, providerConfig(provider));
    if (!rows[capability]) rows[capability] = [];
    rows[capability].push(provider);
    return rows;
  }, {});
  const blockers = [];
  if (ciRequired && configuredCi.length === 0) blockers.push({
    code: "SIGNED_CI_CONFIGURATION_REQUIRED",
    kind: "configuration-required",
    classification: "authority",
    summary: "Risk policy requires signed CI but no trusted external CI provider is configured.",
    required: ["external adapter", "ci.issuer", "ci.publicKey"],
    next: `configure signed CI in openspec/changes/${changeId}/execution.yaml, ` +
      `then run claude-foundation change validate ${changeId}`
  });
  const binding = {
    changeId,
    revision: Number(state?.revision || 0),
    contractRevision: Number(state?.contractRevision || 0),
    executionRevision: Number(state?.executionRevision || 0),
    impact: state?.impact || null,
    riskBasedCiRequired: state?.riskBasedCiRequired === true,
    capabilities: [...(state?.evidenceCapabilities || [])].sort(),
    reviewTier: reviewRisk?.tier || null,
    configuredCi: configuredCi.sort(),
    acceptance: acceptance ? {
      required: acceptance.required === true,
      claimIds: [...(acceptance.claimIds || [])].sort(),
      reason: acceptance.reason || null
    } : null,
    grounding: grounding ? {
      required: grounding.required === true,
      locked: grounding.locked === true,
      reopenPending: grounding.reopenPending === true
    } : null,
    handoffs: (handoffs?.operations || []).map((operation) => ({
      id: operation.id,
      timing: operation.timing || null,
      authority: operation.authority || null,
      operationDigest: operation.operationDigest || null
    })).sort((left, right) => left.id.localeCompare(right.id))
  };
  const decisionFingerprint = `sha256:${createHash("sha256")
    .update(JSON.stringify(binding)).digest("hex")}`;
  return {
    version: 1,
    status: blockers.length ? "NEEDS_USER_DECISION" : "READY",
    changeId,
    binding,
    decisionFingerprint,
    requirements: {
      signedCi: {
        required: ciRequired,
        configuredProviders: configuredCi
      },
      review: {
        required: reviewRisk?.required === true,
        tier: reviewRisk?.tier || null,
        providers: [...(capabilities.review || [])].sort(),
        requiresHumanFinal: reviewRisk?.requiresHumanFinal === true
      },
      acceptance: {
        required: acceptance?.required === true,
        claimIds: [...(acceptance?.claimIds || [])].sort(),
        providers: [...(capabilities.acceptance || [])].sort(),
        decision: acceptance?.decision || null
      },
      grounding: {
        required: grounding?.required === true,
        locked: grounding?.locked === true,
        reopenPending: grounding?.reopenPending === true,
        recoveryCommand: grounding?.reopenPending
          ? `claude-foundation change validate ${changeId}` : null
      },
      handoffs: {
        status: handoffs?.status || "COMPLETE",
        blocking: [...(handoffs?.blocking || [])].sort(),
        operations: (handoffs?.operations || []).map((operation) => ({
          id: operation.id,
          owner: operation.owner || null,
          authority: operation.authority || null,
          timing: operation.timing || null,
          status: operation.status || "pending",
          landBlocking: operation.landBlocking === true,
          recoveryCommand: `claude-foundation handoff packet ${changeId} --operation ${operation.id}`
        })).sort((left, right) => left.id.localeCompare(right.id))
      }
    },
    blockers,
    decision: blockers.length ? {
      kind: "authority-preflight",
      summary: "Required signed CI authority is unavailable, so Build is paused before dispatch or product edits.",
      recommended: "configure-required-authority",
      options: [{
        id: "configure-required-authority",
        outcome: "Configure the named trust root/provider and resume this change."
      }, {
        id: "revise-change-risk",
        outcome: "Revise the agreement only if the declared impact or capability is incorrect."
      }, {
        id: "pause",
        outcome: "Preserve the change without spending Build or model budget."
      }]
    } : null
  };
}
