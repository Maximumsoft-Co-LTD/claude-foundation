// Skills a Build EDIT names from the change's typed data only: work types,
// risk signals, and security triggers. Prose (intent, requirement text) never
// selects a skill.
//
// Fixed priority, most specific first, so the cap keeps the skills that own
// the hardest decision and drops the general testing skill last:
//   1 debug-fundamentals          workType bugfix
//   2 refactoring-fundamentals    workType refactor, migration
//   3 security-fundamentals       workType dependency, privacy, integration;
//                                 risk access-control; any security trigger
//   4 performance-investigation   workType performance; risk performance-slo
//   5 database-fundamentals       workType data; risk persisted-data-change
//   6 queue-fundamentals          workType async; risk financial
//   7 api-design-fundamentals     workType api, deprecation, library;
//                                 risk external-integration
//   8 architecture-fundamentals   workType migration, infra, integration
//   9 ux-ui-principles            workType ui, experiment; risk user-interface
//  10 delivery-engineering        workType dependency, infra, client-release
//  11 observability-fundamentals  workType observability, experiment, ml;
//                                 risk high-operational-risk
//  12 testing-fundamentals        workType ml; any behavior work type;
//                                 risk input-domain (caller-value partitions are test design)

import { LIGHT_WORK } from "./validation/design-blueprints.mjs";

export const SKILL_CAP = 4;

// Work that routes no general testing skill: the shared LIGHT_WORK (docs,
// test, chore) plus config. Config stays non-behavior as before. Refactor and
// dependency are behavior-neutral (BEHAVIOR_NEUTRAL_WORK) yet still route
// testing: their proof is the regression suite staying green, which is test
// design. design-blueprints.mjs never imports this module, so no cycle.
const NON_BEHAVIOR_WORK = new Set([...LIGHT_WORK, "config"]);

const ROUTES = [
  ["debug-fundamentals", { work: ["bugfix"] }],
  ["refactoring-fundamentals", { work: ["refactor", "migration"] }],
  ["security-fundamentals", {
    work: ["dependency", "privacy", "integration"], risk: ["access-control"], security: true
  }],
  ["performance-investigation", { work: ["performance"], risk: ["performance-slo"] }],
  ["database-fundamentals", { work: ["data"], risk: ["persisted-data-change"] }],
  ["queue-fundamentals", { work: ["async"], risk: ["financial"] }],
  ["api-design-fundamentals", {
    work: ["api", "deprecation", "library"], risk: ["external-integration"]
  }],
  ["architecture-fundamentals", { work: ["migration", "infra", "integration"] }],
  ["ux-ui-principles", { work: ["ui", "experiment"], risk: ["user-interface"] }],
  ["delivery-engineering", { work: ["dependency", "infra", "client-release"] }],
  ["observability-fundamentals", {
    work: ["observability", "experiment", "ml"], risk: ["high-operational-risk"]
  }],
  ["testing-fundamentals", { work: ["ml"], risk: ["input-domain"], behavior: true }]
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
