import { requiredDiscoveryDimensions } from "./semantic-intake.mjs";

const DEPTHS = Object.freeze({
  focused: Object.freeze({ maxSourceFiles: 12, maxSourceBytes: 192_000, frontierLimit: 2 }),
  standard: Object.freeze({ maxSourceFiles: 24, maxSourceBytes: 512_000, frontierLimit: 3 }),
  deep: Object.freeze({ maxSourceFiles: 48, maxSourceBytes: 1_024_000, frontierLimit: 3 })
});

const RISK_WEIGHTS = Object.freeze({
  "access-control": 3,
  "persisted-data-change": 3,
  "external-integration": 2,
  "performance-slo": 2,
  "user-interface": 1,
  "high-operational-risk": 3,
  "external-side-effect": 3
});

const text = (value) => typeof value === "string" ? value.trim() : "";
const strings = (value) => Array.isArray(value)
  ? value.map((item) => text(item)).filter(Boolean)
  : [];
const finiteCount = (value) => Number.isFinite(Number(value))
  ? Math.max(0, Math.trunc(Number(value)))
  : 0;
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const ratio = (numerator, denominator) => denominator > 0
  ? Number((numerator / denominator).toFixed(4))
  : null;

function normalizedChoice(value) {
  return text(value).normalize("NFKC").toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
}

function impactScore(value) {
  return { low: 0, medium: 2, high: 4 }[text(value).toLowerCase()] ?? 1;
}

function sizeScore(source, repository) {
  const declared = text(source?.changeSize || source?.size).toLowerCase();
  if (declared === "large") return 4;
  if (declared === "medium") return 2;
  if (declared === "small") return 0;
  const files = finiteCount(repository?.candidateFileCount ?? repository?.changedFileCount);
  return files >= 25 ? 4 : files >= 8 ? 2 : files > 0 ? 1 : 0;
}

/**
 * Choose bounded investigation effort from typed change and repository signals.
 * Required semantic dimensions are returned verbatim and never reduced by the tier.
 */
export function planSemanticIntakeDepth(source = {}, { repository = {} } = {}) {
  const requiredDimensions = requiredDiscoveryDimensions(source);
  const reasons = [];
  let score = 0;
  const add = (points, reason) => {
    if (points <= 0) return;
    score += points;
    reasons.push(reason);
  };

  add(impactScore(source.impact), `impact:${text(source.impact).toLowerCase() || "unspecified"}`);
  add(sizeScore(source, repository), "repository-size");
  const riskSignals = [...new Set(strings(source.riskSignals).map((value) => value.toLowerCase()))];
  for (const signal of riskSignals.sort(compareText))
    add(RISK_WEIGHTS[signal] || 0, `risk:${signal}`);
  const integrationCount = Math.max(
    Array.isArray(source.integrations) ? source.integrations.length : 0,
    finiteCount(repository.integrationCount)
  );
  add(Math.min(3, integrationCount), "integration-coupling");
  const dependentCount = finiteCount(repository.dependentCount);
  add(dependentCount >= 10 ? 3 : dependentCount >= 3 ? 2 : dependentCount > 0 ? 1 : 0,
    "dependency-coupling");
  add(Math.min(3, finiteCount(repository.persistenceBoundaryCount)), "persistence-boundary");
  add(Math.min(3, finiteCount(repository.permissionBoundaryCount)), "permission-boundary");

  const tier = score >= 9 ? "deep" : score >= 4 ? "standard" : "focused";
  return {
    version: 1,
    tier,
    score,
    reasons: [...new Set(reasons)].sort(compareText),
    limits: { ...DEPTHS[tier] },
    requiredDimensions,
    mandatoryDimensionCount: requiredDimensions.length
  };
}

function sourceFactRows(sourceFacts) {
  return Array.isArray(sourceFacts) ? sourceFacts : [];
}

/**
 * Evaluate only open user questions. Source facts are keyed structured evidence;
 * no English-only keyword inference is used.
 */
export function semanticQuestionQualityFindings(source = {}, { sourceFacts = [] } = {}) {
  const decisions = Array.isArray(source.discovery?.decisions)
    ? source.discovery.decisions : [];
  const facts = sourceFactRows(sourceFacts);
  const findings = [];

  for (const [index, decision] of decisions.entries()) {
    if (text(decision?.status).toLowerCase() !== "open") continue;
    const key = text(decision?.key);
    const path = `discovery.decisions[${index}]`;
    const alternatives = strings(decision?.alternatives);
    const normalized = alternatives.map(normalizedChoice);
    const duplicates = normalized.filter((choice, choiceIndex) =>
      choice && normalized.indexOf(choice) !== choiceIndex);
    if (duplicates.length) findings.push({
      code: "duplicate-alternatives", key, path,
      detail: { alternatives: [...new Set(duplicates)].sort(compareText) }
    });

    const recommendation = normalizedChoice(decision?.recommended);
    if (recommendation && !normalized.includes(recommendation)) findings.push({
      code: "recommendation-not-an-alternative", key, path
    });

    const recommendationEvidence = [
      ...strings(decision?.recommendationSources),
      ...strings(decision?.recommendationEvidence)
    ];
    const supportingFacts = facts.filter((fact) =>
      text(fact?.decisionKey) === key && fact?.supportsRecommendation === true);
    if (recommendation && !recommendationEvidence.length && !supportingFacts.length)
      findings.push({ code: "unsupported-recommendation", key, path });

    const answeringFacts = facts.filter((fact) =>
      text(fact?.decisionKey) === key && text(fact?.answer));
    if (answeringFacts.length) findings.push({
      code: "question-answerable-from-source", key, path,
      detail: {
        sourceKeys: [...new Set(answeringFacts.map((fact) => text(fact.sourceKey)).filter(Boolean))]
          .sort(compareText)
      }
    });
  }

  return findings.sort((left, right) =>
    compareText(left.path, right.path) || compareText(left.code, right.code));
}

function measuredHistory(history) {
  if (history && typeof history === "object" && !Array.isArray(history)) {
    const fields = ["inspections", "questionRounds", "sourceRefreshes", "draftRepairs"];
    const measured = Object.fromEntries(fields.map((field) => [field,
      Number.isInteger(history[field]) && history[field] >= 0 ? history[field] : null]));
    return { observed: fields.every((field) => measured[field] !== null), ...measured };
  }
  if (!Array.isArray(history)) return {
    observed: false, inspections: null, questionRounds: null,
    sourceRefreshes: null, draftRepairs: null
  };
  const count = (type) => history.filter((event) => text(event?.type) === type).length;
  return {
    observed: true,
    inspections: count("inspection"),
    questionRounds: count("question-round"),
    sourceRefreshes: count("source-refresh"),
    draftRepairs: count("draft-repair")
  };
}

/** Produce a deterministic snapshot; unavailable history is null, never a false zero. */
export function semanticIntakeEffectivenessSnapshot(source = {}, options = {}) {
  const required = requiredDiscoveryDimensions(source);
  const rows = Array.isArray(source.discovery?.coverage) ? source.discovery.coverage : [];
  const byDimension = new Map(rows.map((row) => [text(row?.dimension).toLowerCase(), row]));
  const requiredRows = required.map((dimension) => byDimension.get(dimension)).filter(Boolean);
  const complete = requiredRows.filter((row) =>
    ["covered", "not-applicable"].includes(text(row?.status).toLowerCase())).length;
  const grounded = requiredRows.filter((row) => strings(row?.sources).length > 0).length;
  const openQuestions = (source.discovery?.decisions || []).filter((row) =>
    text(row?.status).toLowerCase() === "open").length;
  const qualityFindings = semanticQuestionQualityFindings(source, options);
  const rejectedQuestions = new Set(qualityFindings.map((row) => row.key || row.path)).size;

  return {
    version: 1,
    depth: planSemanticIntakeDepth(source, options),
    coverage: {
      completed: complete,
      required: required.length,
      completionRatio: ratio(complete, required.length),
      grounded: grounded,
      groundingRatio: ratio(grounded, required.length)
    },
    questions: {
      open: openQuestions,
      accepted: Math.max(0, openQuestions - rejectedQuestions),
      rejected: rejectedQuestions,
      findings: qualityFindings
    },
    history: measuredHistory(options.history)
  };
}
