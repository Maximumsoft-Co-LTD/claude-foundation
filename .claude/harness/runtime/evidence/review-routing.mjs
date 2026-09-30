const HIGH_CAPABILITIES = new Set([
  "security-static", "data-migration", "compatibility",
  "cross-repo-contract", "state-identity"
]);
const HIGH_SEMANTICS =
  /\b(money|payment|billing|financial|authori[sz]|permission|secret|credential|destructive|migration|irreversible|concurren|race|deadlock|replay|idempoten|queue|broker|rabbit|kafka|wire|contract|legacy|activat|cutover)\w*\b/;
const HIGH_CLASSES =
  /money|authori[sz]|secret|destructive|concurren|replay|idempoten|queue|wire|legacy|activation|cutover/;

// Intent keywords alone make review required at the low tier (user
// decision). They escalate the tier or require reviewer diversity only when
// the change also declares risk: security triggers, non-low impact, coupling,
// a non-low claim, or a grounded risk tier/class.
export function declaredReviewRisk({ state = {}, claims = [], grounding = null }) {
  return Boolean((state.securityTriggers || []).length ||
    (state.impact && state.impact !== "low") || state.coupling === "coupled" ||
    claims.some((claim) => claim.impact && claim.impact !== "low") ||
    ["medium", "high"].includes(grounding?.risk?.tier) ||
    (grounding?.risk?.classes || []).length);
}

export function reviewSemanticText({ state = {}, claims = [], grounding = null }) {
  const declared = (state.securityTriggers || []).join(" ");
  const text = declaredReviewRisk({ state, claims, grounding })
    ? `${state.intent || ""} ${declared}` : declared;
  return text.toLowerCase();
}

export function highReviewRiskTriggers({ state, claims, capabilities, grounding }) {
  const triggers = [];
  const semantic = reviewSemanticText({ state, claims, grounding });
  if (grounding?.risk?.tier === "high") triggers.push("declared-high-risk");
  for (const value of grounding?.risk?.classes || []) {
    if (!HIGH_CLASSES.test(String(value).toLowerCase())) continue;
    triggers.push("declared-critical-class");
    break;
  }
  if (state.impact === "high" || claims.some((claim) => claim.impact === "high"))
    triggers.push("high-impact");
  if ((state.securityTriggers || []).length || capabilities.has("security-static"))
    triggers.push("authorization-or-secrets");
  for (const capability of HIGH_CAPABILITIES) {
    if (!capabilities.has(capability)) continue;
    triggers.push("destructive-data-or-external-contract");
    break;
  }
  if (HIGH_SEMANTICS.test(semantic)) triggers.push("critical-semantics");
  return triggers;
}

export function mediumReviewRiskTriggers({
  state, claims, grounding, requiredTriggers = []
}) {
  const triggers = [];
  if (grounding?.risk?.tier === "medium") triggers.push("declared-medium-risk");
  if (state.impact === "medium" || state.coupling === "coupled")
    triggers.push("medium-impact-or-coupling");
  if (claims.some((claim) => claim.impact !== "low") || requiredTriggers.length)
    triggers.push("review-risk");
  return triggers;
}

export function classifyReviewRisk({
  state, claims, capabilities, grounding, requiredTriggers = []
}) {
  const input = { state, claims, capabilities, grounding, requiredTriggers };
  const high = highReviewRiskTriggers(input);
  const medium = mediumReviewRiskTriggers(input);
  const tier = high.length ? "high" : medium.length ? "medium" : "low";
  return {
    tier,
    route: tier === "low" ? ["ai-full"] :
      ["ai-full", "ai-delta-after-correction"],
    maxAiAttempts: tier === "low" ? 1 : 2,
    requiresHumanFinal: false,
    triggers: [...new Set([...high, ...medium])].sort()
  };
}
