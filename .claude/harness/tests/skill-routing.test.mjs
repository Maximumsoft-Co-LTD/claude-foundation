import assert from "node:assert/strict";
import test from "node:test";

import {
  SKILL_CAP, routedSkills, skillLoadInstruction
} from "../runtime/workflow/skill-routing.mjs";

const docs = (values) => routedSkills({ workTypes: ["docs"], ...values });

test("each work type routes to its skill, plus testing for behavior work", () => {
  for (const [type, skill] of [
    ["bugfix", "debug-fundamentals"], ["refactor", "refactoring-fundamentals"],
    ["api", "api-design-fundamentals"], ["async", "queue-fundamentals"],
    ["data", "database-fundamentals"], ["ui", "ux-ui-principles"]
  ]) assert.deepEqual(routedSkills({ workTypes: [type] }), [skill, "testing-fundamentals"], type);
  assert.deepEqual(routedSkills({ workTypes: ["feature"] }), ["testing-fundamentals"]);
});

test("an infra change routes delivery and architecture skills", () => {
  const skills = routedSkills({ workTypes: ["infra"] });
  assert.ok(skills.includes("delivery-engineering"));
  assert.ok(skills.includes("architecture-fundamentals"));
});

test("each new work type routes its catalog skills", () => {
  for (const [type, skills] of [
    ["performance", ["performance-investigation"]],
    ["migration", ["refactoring-fundamentals", "architecture-fundamentals"]],
    ["dependency", ["security-fundamentals", "delivery-engineering"]],
    ["deprecation", ["api-design-fundamentals"]],
    ["library", ["api-design-fundamentals"]],
    ["infra", ["architecture-fundamentals", "delivery-engineering"]],
    ["observability", ["observability-fundamentals"]],
    ["privacy", ["security-fundamentals"]],
    ["experiment", ["ux-ui-principles", "observability-fundamentals"]],
    ["client-release", ["delivery-engineering"]],
    ["ml", ["observability-fundamentals"]],
    ["integration", ["security-fundamentals", "architecture-fundamentals"]]
  ]) assert.deepEqual(routedSkills({ workTypes: [type] }),
    [...skills, "testing-fundamentals"], type);
});

test("each risk signal routes to its skill without behavior work", () => {
  for (const [signal, skill] of [
    ["performance-slo", "performance-investigation"],
    ["persisted-data-change", "database-fundamentals"],
    ["access-control", "security-fundamentals"],
    ["input-domain", "testing-fundamentals"],
    ["external-integration", "api-design-fundamentals"],
    ["financial", "queue-fundamentals"],
    ["user-interface", "ux-ui-principles"],
    ["high-operational-risk", "observability-fundamentals"]
  ]) assert.deepEqual(docs({ riskSignals: [signal] }), [skill], signal);
  assert.deepEqual(docs({ securityTriggers: ["auth"] }), ["security-fundamentals"]);
});

// Caller-supplied value partitions are a test-design concern, not a trust
// boundary: input-domain alone never routes to the security skill.
test("input-domain routes to testing, not security", () => {
  assert.deepEqual(routedSkills({ workTypes: ["feature"], riskSignals: ["input-domain"] }),
    ["testing-fundamentals"]);
  assert.deepEqual(routedSkills({
    workTypes: ["feature"], riskSignals: ["input-domain", "performance-slo"]
  }), ["performance-investigation", "testing-fundamentals"]);
  assert.deepEqual(routedSkills({
    workTypes: ["feature"], riskSignals: ["input-domain", "access-control"]
  }), ["security-fundamentals", "testing-fundamentals"]);
});

test("light work (docs, test, chore) and config work names no skill", () => {
  for (const type of ["docs", "test", "chore", "config"])
    assert.deepEqual(routedSkills({ workTypes: [type] }), [], type);
  assert.deepEqual(routedSkills({ workTypes: ["docs", "test", "chore", "config"] }), []);
  assert.deepEqual(routedSkills(), []);
});

test("skills keep the fixed order, de-duplicate, and cap at four", () => {
  assert.deepEqual(routedSkills({
    workTypes: ["feature"], riskSignals: ["performance-slo"]
  }), ["performance-investigation", "testing-fundamentals"]);
  assert.deepEqual(routedSkills({
    workTypes: ["data"], riskSignals: ["persisted-data-change"]
  }), ["database-fundamentals", "testing-fundamentals"]);
  const capped = routedSkills({
    workTypes: ["bugfix", "api", "data"], riskSignals: ["access-control", "performance-slo"]
  });
  assert.equal(SKILL_CAP, 4);
  assert.deepEqual(capped, [
    "debug-fundamentals", "security-fundamentals", "performance-investigation",
    "database-fundamentals"
  ]);
  // Input order and case do not change the result.
  assert.deepEqual(routedSkills({
    workTypes: ["DATA", "api", "bugfix"], riskSignals: ["performance-slo", "access-control"]
  }), capped);
});

test("skills the project lacks are filtered before the cap", () => {
  const present = new Set(["testing-fundamentals", "api-design-fundamentals",
    "database-fundamentals", "security-fundamentals", "queue-fundamentals"]);
  assert.deepEqual(routedSkills({
    workTypes: ["bugfix", "api", "data", "async"], riskSignals: ["access-control"],
    hasSkill: (name) => present.has(name)
  }), ["security-fundamentals", "database-fundamentals", "queue-fundamentals",
    "api-design-fundamentals"]);
  assert.deepEqual(routedSkills({ workTypes: ["bugfix"], hasSkill: () => false }), []);
});

test("prose fields never select a skill", () => {
  assert.deepEqual(routedSkills({
    workTypes: ["feature"], riskSignals: [], intent: "payment is slow",
    requirements: ["payment queue latency"]
  }), ["testing-fundamentals"]);
  assert.deepEqual(routedSkills({ workTypes: ["feature"], riskSignals: "payment slow" }),
    ["testing-fundamentals"]);
});

test("the load instruction names skills only, never a host tool", () => {
  assert.equal(skillLoadInstruction(["debug-fundamentals", "testing-fundamentals"]),
    "First, load these skills by name: `debug-fundamentals`, " +
    "`testing-fundamentals`. Read a skill reference only when its decision is active.");
});
