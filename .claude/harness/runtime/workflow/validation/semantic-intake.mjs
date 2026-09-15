import { lifecycleOutcome } from "../../core/lifecycle-outcome.mjs";

const STATUSES = new Set([
  "covered", "not-applicable", "needs-investigation", "needs-user-decision"
]);

export const CORE_DISCOVERY_DIMENSIONS = Object.freeze([
  "current-behavior",
  "affected-actor",
  "desired-behavior",
  "success-path",
  "failure-path",
  "input-boundary",
  "compatibility",
  "non-goals",
  "verification"
]);

export const CONDITIONAL_DISCOVERY_DIMENSIONS = Object.freeze([
  "security-privacy",
  "permission-rejection",
  "data-migration",
  "rollout-rollback",
  "recoverability",
  "integration-contract",
  "timeout-retry-idempotency",
  "operability",
  "performance-capacity-availability",
  "accessibility",
  "external-authority"
]);

const KNOWN_DIMENSIONS = new Set([
  ...CORE_DISCOVERY_DIMENSIONS, ...CONDITIONAL_DISCOVERY_DIMENSIONS
]);

const RISK_SIGNAL_DIMENSIONS = Object.freeze({
  "access-control": ["security-privacy", "permission-rejection"],
  "persisted-data-change": ["data-migration", "rollout-rollback", "recoverability"],
  "external-integration": [
    "integration-contract", "timeout-retry-idempotency", "operability", "recoverability"
  ],
  "performance-slo": ["performance-capacity-availability"],
  "user-interface": ["accessibility"],
  "high-operational-risk": ["operability", "recoverability"],
  "external-side-effect": ["external-authority"]
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

function unique(values) {
  return [...new Set(values)];
}

const unresolvedIssue = (issue) =>
  issue.includes(" remains unresolved with status '") ||
  issue.startsWith("semantic draft discovery has unresolved decisions;");

export function requiredDiscoveryDimensions(source = {}) {
  const semantic = [
    source.intent,
    source.why,
    ...(source.changes || []),
    ...(source.securityTriggers || []),
    ...(source.requirements || []).flatMap((row) => [
      row?.key, row?.capability, row?.requirement, row?.description, row?.outcome
    ])
  ].filter(Boolean).join(" ").toLowerCase();
  const required = [...CORE_DISCOVERY_DIMENSIONS];
  const add = (...dimensions) => required.push(...dimensions);
  for (const signal of strings(source.riskSignals))
    add(...(RISK_SIGNAL_DIMENSIONS[signal.toLowerCase()] || []));

  if ((source.securityTriggers || []).length ||
      /\b(auth|permission|credential|secret|security|privacy|pii)\w*\b/.test(semantic))
    add("security-privacy", "permission-rejection");
  if ((source.requirements || []).some((row) =>
      ["modified", "removed"].includes(text(row?.operation).toLowerCase())) ||
      /\b(migrat|persist|database|schema|backfill|data loss)\w*\b/.test(semantic))
    add("data-migration", "rollout-rollback", "recoverability");
  if ((source.integrations || []).length)
    add("integration-contract", "timeout-retry-idempotency", "operability", "recoverability");
  if (/\b(performance|latency|throughput|capacity|scalab|availability|uptime)\w*\b/.test(semantic))
    add("performance-capacity-availability");
  if (/\b(accessib|screen reader|keyboard|aria|contrast|responsive|ui|ux)\w*\b/.test(semantic))
    add("accessibility");
  if (text(source.impact).toLowerCase() === "high") add("operability", "recoverability");
  if ((source.externalOperations || []).length) add("external-authority");

  return unique(required);
}

export function decisionFrontier(decisions = [], limit = 3) {
  const resolved = new Set(decisions
    .filter((row) => text(row?.status).toLowerCase() === "resolved")
    .map((row) => text(row?.key)));
  return decisions.filter((row) => {
    if (text(row?.status).toLowerCase() === "resolved") return false;
    return strings(row?.prerequisites).every((key) => resolved.has(key));
  }).slice(0, Math.max(1, Number(limit) || 3));
}

function decisionIssues(decisions = []) {
  const issues = [];
  const keys = new Set();
  for (const [index, decision] of decisions.entries()) {
    const label = `semantic draft discovery.decisions[${index}]`;
    const key = text(decision?.key);
    const status = text(decision?.status).toLowerCase();
    if (!key) issues.push(`${label}.key is required`);
    else if (keys.has(key)) issues.push(`${label}.key '${key}' is duplicated`);
    keys.add(key);
    if (!['open', 'resolved'].includes(status))
      issues.push(`${label}.status must be open|resolved`);
    if (!Array.isArray(decision?.prerequisites))
      issues.push(`${label}.prerequisites must be an array`);
    if (status === "open") {
      if (strings(decision?.alternatives).length < 2)
        issues.push(`${label}.alternatives must name at least two choices`);
      if (!text(decision?.recommended)) issues.push(`${label}.recommended is required`);
      if (!text(decision?.question)) issues.push(`${label}.question is required`);
    }
    if (status === "resolved") {
      if (!text(decision?.choice)) issues.push(`${label}.choice is required`);
      if (!text(decision?.reason)) issues.push(`${label}.reason is required`);
    }
  }
  for (const [index, decision] of decisions.entries())
    for (const prerequisite of strings(decision?.prerequisites))
      if (!keys.has(prerequisite))
        issues.push(`semantic draft discovery.decisions[${index}].prerequisites references unknown decision '${prerequisite}'`);

  const graph = new Map(decisions.map((row) => [text(row?.key), strings(row?.prerequisites)]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (key) => {
    if (visiting.has(key)) return true;
    if (visited.has(key) || !graph.has(key)) return false;
    visiting.add(key);
    if ((graph.get(key) || []).some(visit)) return true;
    visiting.delete(key);
    visited.add(key);
    return false;
  };
  if ([...graph.keys()].some(visit))
    issues.push("semantic draft discovery decision prerequisites contain a cycle");
  return issues;
}

export function semanticIntakeIssues(source = {}) {
  if (source.version !== 4) return [];
  const issues = [];
  const discovery = source.discovery;
  if (!discovery || typeof discovery !== "object" || Array.isArray(discovery))
    return ["semantic draft version 4 requires a 'discovery' object"];
  if (!Array.isArray(discovery.coverage))
    return ["semantic draft discovery.coverage must be an array"];
  if (discovery.decisions !== undefined && !Array.isArray(discovery.decisions))
    issues.push("semantic draft discovery.decisions must be an array");
  if (source.riskSignals !== undefined && !Array.isArray(source.riskSignals))
    issues.push("semantic draft riskSignals must be an array");
  const unknownSignals = strings(source.riskSignals)
    .filter((signal) => !RISK_SIGNAL_DIMENSIONS[signal.toLowerCase()]);
  if (unknownSignals.length)
    issues.push(`semantic draft riskSignals contains unknown signal(s): ${unknownSignals.join(", ")}`);

  const requirementKeys = new Set((source.requirements || []).map((row) => text(row?.key)));
  const requiredDimensions = requiredDiscoveryDimensions(source);
  const rows = new Map();
  for (const [index, row] of discovery.coverage.entries()) {
    const label = `semantic draft discovery.coverage[${index}]`;
    const dimension = text(row?.dimension).toLowerCase();
    const status = text(row?.status).toLowerCase();
    if (!dimension) issues.push(`${label}.dimension is required`);
    else if (!KNOWN_DIMENSIONS.has(dimension))
      issues.push(`${label}.dimension '${dimension}' is unknown`);
    else if (rows.has(dimension)) issues.push(`${label}.dimension '${dimension}' is duplicated`);
    rows.set(dimension, row);
    if (!STATUSES.has(status)) issues.push(`${label}.status is invalid`);
    const covers = strings(row?.covers);
    const unknown = covers.filter((key) => !requirementKeys.has(key));
    if (unknown.length)
      issues.push(`${label}.covers references unknown requirement(s): ${unknown.join(", ")}`);
    if (status === "covered" && !covers.length && !strings(row?.sources).length)
      issues.push(`${label} covered status requires covers or sources`);
    if (status === "not-applicable" && !text(row?.rationale))
      issues.push(`${label} not-applicable status requires rationale`);
    if (status === "not-applicable" &&
        CONDITIONAL_DISCOVERY_DIMENSIONS.includes(dimension) &&
        requiredDimensions.includes(dimension) &&
        !strings(row?.sources).length)
      issues.push(`${label} risk-derived not-applicable status requires a grounded source`);
    if (["needs-investigation", "needs-user-decision"].includes(status))
      issues.push(`${label} remains unresolved with status '${status}'`);
  }

  for (const dimension of requiredDimensions)
    if (!rows.has(dimension))
      issues.push(`semantic draft discovery coverage is missing required dimension '${dimension}'`);

  const decisions = Array.isArray(discovery.decisions) ? discovery.decisions : [];
  const decisionKeys = new Set(decisions.map((row) => text(row?.key)).filter(Boolean));
  for (const [index, row] of discovery.coverage.entries()) {
    const label = `semantic draft discovery.coverage[${index}]`;
    const status = text(row?.status).toLowerCase();
    const links = strings(row?.decisionKeys);
    if (status === "needs-user-decision" && !links.length)
      issues.push(`${label}.decisionKeys must link needs-user-decision coverage to at least one decision`);
    const unknown = links.filter((key) => !decisionKeys.has(key));
    if (unknown.length)
      issues.push(`${label}.decisionKeys references unknown decision(s): ${unknown.join(", ")}`);
  }
  issues.push(...decisionIssues(decisions));
  if (decisions.some((row) => text(row?.status).toLowerCase() !== "resolved")) {
    const frontier = decisionFrontier(decisions).map((row) => text(row?.key)).filter(Boolean);
    issues.push(`semantic draft discovery has unresolved decisions; ready frontier: ${frontier.join(", ") || "none"}`);
  }
  return issues;
}

export function semanticIntakeAction(source = {}, {
  resume = null, additionalIssues = [], sourceFreshnessFindings = [], frontierLimit = 3
} = {}) {
  if (source.version !== 4) return lifecycleOutcome({
    action: "DONE", owner: "harness", boundary: "semantic-intake",
    reached: "intake-ready", reason: "The compatible semantic draft can be compiled.",
    resume
  });
  const issues = semanticIntakeIssues(source);
  const structural = unique([
    ...additionalIssues.map((issue) => text(issue)).filter(Boolean),
    ...issues.filter((issue) => !unresolvedIssue(issue))
  ]);
  if (structural.length) return lifecycleOutcome({
    action: "EDIT", owner: "agent", boundary: "draft-validation",
    reason: "The semantic draft structure must be repaired before intake can continue.",
    intake: { kind: "repair-draft", issues: structural }, resume
  });

  if (sourceFreshnessFindings.length) return lifecycleOutcome({
    action: "EDIT", owner: "agent", boundary: "source-investigation",
    reason: "Grounded sources changed after semantic coverage was recorded.",
    intake: {
      kind: "refresh-source-coverage",
      findings: sourceFreshnessFindings.map((finding) => ({ ...finding }))
    },
    resume
  });

  const coverage = Array.isArray(source.discovery?.coverage)
    ? source.discovery.coverage : [];
  const investigations = coverage.filter((row) =>
    text(row?.status).toLowerCase() === "needs-investigation");
  if (investigations.length) return lifecycleOutcome({
    action: "EDIT", owner: "agent", boundary: "source-investigation",
    reason: "Repository-owned facts must be investigated before asking the user.",
    intake: {
      kind: "investigate-sources",
      dimensions: investigations.map((row) => ({
        dimension: text(row?.dimension).toLowerCase(),
        sources: unique(strings(row?.sources))
      }))
    },
    resume
  });

  const decisions = Array.isArray(source.discovery?.decisions)
    ? source.discovery.decisions : [];
  const frontier = decisionFrontier(decisions, frontierLimit);
  if (frontier.length) return lifecycleOutcome({
    action: "ASK_USER", owner: "user", boundary: "consequential-semantics",
    reason: "A bounded set of consequential requirement decisions is ready.",
    decision: {
      kind: "requirement-semantics",
      summary: "Resolve the current dependency-ready requirement frontier.",
      items: frontier.map((row) => ({
        key: text(row?.key),
        question: text(row?.question),
        alternatives: unique(strings(row?.alternatives)),
        recommended: text(row?.recommended)
      }))
    },
    resume
  });

  const unresolvedCoverage = coverage.filter((row) =>
    text(row?.status).toLowerCase() === "needs-user-decision");
  if (unresolvedCoverage.length) return lifecycleOutcome({
    action: "EDIT", owner: "agent", boundary: "draft-validation",
    reason: "Resolved decisions must be projected into coverage and agreement semantics.",
    intake: {
      kind: "project-decisions",
      dimensions: unresolvedCoverage.map((row) => text(row?.dimension).toLowerCase())
    },
    resume
  });

  return lifecycleOutcome({
    action: "DONE", owner: "harness", boundary: "semantic-intake",
    reached: "intake-ready", reason: "Requirement discovery is complete and ready to compile.",
    resume
  });
}

export function normalizeDiscovery(source = {}) {
  if (source.version !== 4) return undefined;
  return {
    coverage: (source.discovery?.coverage || []).map((row) => ({
      dimension: text(row?.dimension).toLowerCase(),
      status: text(row?.status).toLowerCase(),
      covers: unique(strings(row?.covers)),
      sources: unique(strings(row?.sources)),
      decisionKeys: unique(strings(row?.decisionKeys)),
      rationale: text(row?.rationale) || undefined
    })),
    decisions: (source.discovery?.decisions || []).map((row) => ({
      key: text(row?.key),
      status: text(row?.status).toLowerCase(),
      prerequisites: unique(strings(row?.prerequisites)),
      alternatives: unique(strings(row?.alternatives)),
      question: text(row?.question) || undefined,
      recommended: text(row?.recommended) || undefined,
      choice: text(row?.choice) || undefined,
      reason: text(row?.reason) || undefined
    }))
  };
}
