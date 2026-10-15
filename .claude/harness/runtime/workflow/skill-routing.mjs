// Skills a Build EDIT names from the change's typed data only: work types,
// risk signals, and security triggers. Prose (intent, requirement text) never
// selects a skill.
//
// Fixed priority, most specific first, so the cap keeps the skills that own
// the hardest decision and drops the general testing skill last:
//   1 debug-fundamentals          workType bugfix
//   2 refactoring-fundamentals    workType refactor
//   3 security-fundamentals       risk access-control; any security trigger
//   4 performance-investigation   risk performance-slo
//   5 database-fundamentals       workType data; risk persisted-data-change
//   6 queue-fundamentals          workType async; risk financial
//   7 api-design-fundamentals     workType api; risk external-integration
//   8 ux-ui-principles            workType ui; risk user-interface
//   9 observability-fundamentals  risk high-operational-risk
//  10 testing-fundamentals        any behavior work type (not docs, chore, config);
//                                 risk input-domain (caller-value partitions are test design)

export const SKILL_CAP = 4;

const NON_BEHAVIOR_WORK = new Set(["docs", "chore", "config"]);

const ROUTES = [
  ["debug-fundamentals", { work: ["bugfix"] }],
  ["refactoring-fundamentals", { work: ["refactor"] }],
  ["security-fundamentals", { risk: ["access-control"], security: true }],
  ["performance-investigation", { risk: ["performance-slo"] }],
  ["database-fundamentals", { work: ["data"], risk: ["persisted-data-change"] }],
  ["queue-fundamentals", { work: ["async"], risk: ["financial"] }],
  ["api-design-fundamentals", { work: ["api"], risk: ["external-integration"] }],
  ["ux-ui-principles", { work: ["ui"], risk: ["user-interface"] }],
  ["observability-fundamentals", { risk: ["high-operational-risk"] }],
  ["testing-fundamentals", { risk: ["input-domain"], behavior: true }]
];

const names = (values) => new Set((Array.isArray(values) ? values : [])
  .map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));

// Ordered skill names, filtered to those `hasSkill(name)` confirms exist, then
// capped, so a missing skill never takes a slot.
export function routedSkills({
  workTypes = [], riskSignals = [], securityTriggers = [], hasSkill = () => true
} = {}) {
  const work = names(workTypes), risk = names(riskSignals);
  const security = names(securityTriggers).size > 0;
  const behavior = [...work].some((type) => !NON_BEHAVIOR_WORK.has(type));
  return ROUTES
    .filter(([, route]) => (route.work || []).some((type) => work.has(type)) ||
      (route.risk || []).some((signal) => risk.has(signal)) ||
      (route.security && security) || (route.behavior && behavior))
    .map(([name]) => name)
    .filter((name) => hasSkill(name))
    .slice(0, SKILL_CAP);
}

// Host-neutral: names skills, never a host's tool. It is the first step of the
// action; a trailing load line after "Then run the resume command" was skipped
// in every observed paid run.
export function skillLoadInstruction(skills) {
  return `First, load these skills by name: ${
    skills.map((name) => `\`${name}\``).join(", ")}. ` +
    "Read a skill reference only when its decision is active.";
}
