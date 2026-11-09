function boundedStrings(values, limit = 20) {
  return [...new Set((values || []).map((value) => String(value || "").trim())
    .filter(Boolean))].sort().slice(0, limit);
}

export function derivedReviewRepairGraph(attempt, stableHash) {
  const allFindings = (attempt?.findings || [])
    .filter((finding) => ["blocker", "major"].includes(finding.severity));
  const findings = allFindings.slice(0, 8);
  const nodes = findings.map((finding, index) => {
    const paths = boundedStrings(finding.path ? [finding.path] : finding.paths, 12);
    const priorConflicts = findings.slice(0, index).flatMap((prior, priorIndex) => {
      const priorPaths = boundedStrings(prior.path ? [prior.path] : prior.paths, 12);
      return paths.some((path) => priorPaths.includes(path))
        ? [`repair-${String(priorIndex + 1).padStart(3, "0")}`] : [];
    });
    return {
      id: `repair-${String(index + 1).padStart(3, "0")}`,
      findingIds: [String(finding.id)],
      severity: finding.severity,
      paths,
      claimIds: boundedStrings(finding.claimIds),
      criticalCaseIds: boundedStrings(finding.verificationCaseIds),
      dependencies: boundedStrings(priorConflicts),
      sourceAttemptDigest: attempt.digest,
      sourceWorkspaceHash: attempt.workspaceHash
    };
  });
  return {
    version: 1,
    kind: "review-repair-graph",
    sourceAttemptDigest: attempt?.digest || null,
    sourceWorkspaceHash: attempt?.workspaceHash || null,
    totalFindingIds: allFindings.map((finding) => String(finding.id)),
    truncated: allFindings.length > findings.length,
    nodes,
    digest: stableHash(nodes)
  };
}

export function repairActionForWorkspace(attempt, workspaceHash, stableHash) {
  const graph = derivedReviewRepairGraph(attempt, stableHash);
  if (!graph.nodes.length || attempt?.resultStatus !== "fail") return null;
  return {
    version: 1,
    action: graph.sourceWorkspaceHash === workspaceHash
      ? "EXECUTE_REPAIR_BATCH" : "RUN_INVALIDATED_EVIDENCE",
    repairGraph: graph
  };
}

// Visual repair is the one bounded repair loop: agent repair against a
// reviewer's judgement of screenshots may never converge, so after
// VISUAL_REPAIR_ROUNDS batches the remaining differences become a pending
// visual drift for the user instead of another batch. Only a user grant
// extends the budget.
export const VISUAL_REPAIR_ROUNDS = 2;

export function visualRepairBudget(state) {
  const value = state?.visualRepair || {};
  const grants = Array.isArray(value.grants) ? value.grants : [];
  return {
    rounds: Number(value.rounds || 0),
    allowed: VISUAL_REPAIR_ROUNDS * (1 + grants.length),
    lastBatchWorkspaceHash: value.lastBatchWorkspaceHash || null,
    grants,
    drift: value.drift || null
  };
}

function visualRepairFindings(receipt) {
  return (receipt?.visual?.findings || [])
    .filter((finding) => ["blocker", "major"].includes(finding?.severity));
}

// What one failed visual receipt means for the repair loop. A new failing
// result spends a round while any remain. The same workspace coming back
// after a batch means the agent resumed without editing: it declined the
// differences (for example, ones the agreement forbids), so another identical
// batch cannot help and the differences become drift for the user.
export function planVisualRepair(state, { provider, receipt, now }) {
  const budget = visualRepairBudget(state);
  const findings = visualRepairFindings(receipt);
  const workspaceHash = receipt?.workspaceHash || null;
  const base = { ...(state?.visualRepair || {}), grants: budget.grants };
  if (!findings.length) return { action: "none", visualRepair: state?.visualRepair, findings };
  const declined = Boolean(workspaceHash) && workspaceHash === budget.lastBatchWorkspaceHash;
  if (!declined && budget.rounds < budget.allowed)
    return { action: "repair", round: budget.rounds + 1, findings, visualRepair: {
      ...base, rounds: budget.rounds + 1, lastBatchWorkspaceHash: workspaceHash, drift: null } };
  return { action: "drift", findings, visualRepair: { ...base, drift: {
    provider, findings, rounds: budget.rounds, workspaceHash, recordedAt: now,
    ...(declined ? { declined: true } : {}) } } };
}

export function visualRepairGraph({ findings, workspaceHash, round }, stableHash) {
  const nodes = findings.slice(0, 8).map((finding, index) => ({
    id: `repair-${String(index + 1).padStart(3, "0")}`,
    findingIds: [`visual:${finding.id}`],
    severity: finding.severity,
    paths: [],
    claimIds: boundedStrings(finding.claimIds),
    criticalCaseIds: [],
    dependencies: [],
    screen: finding.screen,
    difference: finding.difference,
    sourceWorkspaceHash: workspaceHash
  }));
  return {
    version: 1,
    kind: "visual-repair-graph",
    round,
    roundsAllowed: VISUAL_REPAIR_ROUNDS,
    sourceWorkspaceHash: workspaceHash,
    totalFindingIds: findings.map((finding) => `visual:${finding.id}`),
    truncated: findings.length > nodes.length,
    nodes,
    digest: stableHash(nodes)
  };
}

// The user's "repair more" answer: two more rounds, recorded with the
// decision reference that authorized them. The next result on the same
// workspace is a fresh batch, not a repeated decline.
export function grantVisualRepair(state, { decisionRef, now }) {
  const budget = visualRepairBudget(state);
  state.visualRepair = {
    ...(state.visualRepair || {}),
    grants: [...budget.grants, { rounds: VISUAL_REPAIR_ROUNDS, decisionRef, recordedAt: now }],
    lastBatchWorkspaceHash: null,
    drift: null
  };
  return state;
}
