import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleReviewPolicy,
  collectReviewSignals,
  createEvidenceContract
} from "../runtime/evidence/evidence-contract.mjs";
import { classifyReviewRisk } from "../runtime/evidence/review-routing.mjs";

const lowRoute = {
  tier: "low", route: ["ai-full"], maxAiAttempts: 1,
  requiresHumanFinal: false, triggers: []
};

test("review signals stay empty for a low-risk claim", () => {
  const signals = collectReviewSignals(
    {}, { claims: [{ impact: "low", capabilities: ["test"] }] }
  );
  assert.deepEqual(signals.requiredTriggers, []);
  assert.deepEqual(signals.diversityTriggers, []);
  assert.deepEqual([...signals.capabilities], ["test"]);
});

test("review signals combine claim, repository, and semantic risk", () => {
  const signals = collectReviewSignals({
    intent: "Prevent concurrent payment migration races",
    evidenceCapabilities: ["compatibility"],
    securityTriggers: ["authorization"]
  }, {
    claims: [{
      impact: "high", capabilities: ["cross-repo-contract"],
      repositories: ["root", "billing"]
    }]
  }, ["security-static"]);
  assert.deepEqual(signals.requiredTriggers, [
    "risk-capability", "multi-repository-claim", "risk-semantics"
  ]);
  assert.deepEqual(signals.diversityTriggers, [
    "critical-capability", "critical-semantics"
  ]);
  assert.deepEqual([...signals.capabilities], [
    "compatibility", "cross-repo-contract", "security-static"
  ]);
});

test("intent keywords alone add no risk semantics or diversity trigger", () => {
  const signals = collectReviewSignals({
    intent: "Show billing totals after payment", impact: "low", coupling: "isolated",
    securityTriggers: [], keywordSecurityTriggers: ["billing", "payment"],
    reviewRequired: true
  }, { claims: [{ impact: "low", capabilities: ["test"] }] });
  assert.deepEqual(signals.requiredTriggers, []);
  assert.deepEqual(signals.diversityTriggers, []);
  const declared = collectReviewSignals({
    intent: "Show billing totals after payment", impact: "medium",
    securityTriggers: []
  }, { claims: [{ impact: "low", capabilities: ["test"] }] });
  assert.deepEqual(declared.requiredTriggers, ["risk-semantics"]);
  assert.deepEqual(declared.diversityTriggers, ["critical-semantics"]);
});

test("Thai intents raise the same review semantics as English", () => {
  const claims = { claims: [{ impact: "low", capabilities: ["test"] }] };
  for (const intent of ["รองรับการชำระเงินด้วยบัตร", "ย้ายข้อมูลลูกค้าไปตารางใหม่",
    "ลบข้อมูลถาวรเมื่อปิดบัญชี"]) {
    const signals = collectReviewSignals({ intent, impact: "medium", securityTriggers: [] }, claims);
    assert.deepEqual(signals.requiredTriggers, ["risk-semantics"], intent);
    assert.deepEqual(signals.diversityTriggers, ["critical-semantics"], intent);
  }
  const concurrent = collectReviewSignals({
    intent: "กันการเขียนพร้อมกันในคำสั่งซื้อ", impact: "medium", securityTriggers: []
  }, claims);
  assert.deepEqual(concurrent.requiredTriggers, ["risk-semantics"]);
  assert.deepEqual(concurrent.diversityTriggers, []);
  const keywordOnly = collectReviewSignals({
    intent: "แสดงยอดชำระเงินเป็นตัวหนา", impact: "low", coupling: "isolated",
    securityTriggers: [], keywordSecurityTriggers: ["ชำระเงิน"], reviewRequired: true
  }, claims);
  assert.deepEqual(keywordOnly.requiredTriggers, []);
  assert.deepEqual(keywordOnly.diversityTriggers, []);
  for (const intent of ["ตรวจสิทธิ์ก่อนอนุมัติ", "ส่งซ้ำผ่านคิวข้อความ"]) {
    const route = classifyReviewRisk({ state: { intent, impact: "medium", securityTriggers: [] },
      claims: [], capabilities: new Set(), grounding: null });
    assert.ok(route.triggers.includes("critical-semantics"), intent);
    assert.equal(route.tier, "high");
  }
});

test("legacy review policy preserves its compact default shape", () => {
  const result = assembleReviewPolicy({
    state: {},
    signals: {
      capabilities: new Set(), requiredTriggers: [], diversityTriggers: []
    },
    riskRoute: lowRoute,
    policy: {},
    riskTiered: false
  });
  assert.deepEqual(result, {
    required: false,
    independence: "required",
    diversity: "preferred",
    triggers: []
  });
});

test("legacy review can be required by state, trigger, or capability", () => {
  for (const signals of [
    { capabilities: new Set(), requiredTriggers: ["risk-semantics"], diversityTriggers: [] },
    { capabilities: new Set(["review"]), requiredTriggers: [], diversityTriggers: [] }
  ]) {
    assert.equal(assembleReviewPolicy({
      state: {}, signals, riskRoute: lowRoute, policy: {}, riskTiered: false
    }).required, true);
  }
  assert.equal(assembleReviewPolicy({
    state: { reviewRequired: true },
    signals: { capabilities: new Set(), requiredTriggers: [], diversityTriggers: [] },
    riskRoute: lowRoute, policy: {}, riskTiered: false
  }).required, true);
});

test("critical legacy policy requires diversity without a waiver", () => {
  const result = assembleReviewPolicy({
    state: {},
    signals: {
      capabilities: new Set(), requiredTriggers: [],
      diversityTriggers: ["critical-capability"]
    },
    riskRoute: lowRoute,
    policy: {},
    riskTiered: false
  });
  assert.equal(result.diversity, "required");
  assert.deepEqual(result.triggers, ["critical-capability"]);
});

test("single-model and self-review waivers remain explicit", () => {
  const result = assembleReviewPolicy({
    state: {},
    signals: {
      capabilities: new Set(), requiredTriggers: ["risk-capability"],
      diversityTriggers: ["critical-capability"]
    },
    riskRoute: lowRoute,
    policy: { diversity: "single-model", independence: "self" },
    riskTiered: false
  });
  assert.deepEqual(result, {
    required: true,
    independence: "self",
    diversity: "preferred",
    diversityWaived: true,
    independenceWaived: true,
    triggers: [
      "critical-capability", "diversity-waived-single-model",
      "independence-waived-self-review", "risk-capability"
    ]
  });
});

test("risk-tiered policy carries route identity and deduplicated triggers", () => {
  const riskRoute = {
    tier: "high", route: ["ai-full", "ai-delta-after-correction"],
    maxAiAttempts: 2, requiresHumanFinal: true,
    triggers: ["critical-capability", "high-impact"]
  };
  const result = assembleReviewPolicy({
    state: {},
    signals: {
      capabilities: new Set(), requiredTriggers: [],
      diversityTriggers: ["critical-capability"]
    },
    riskRoute,
    policy: {},
    riskTiered: true
  });
  assert.deepEqual(result, {
    required: true,
    tier: "high",
    route: ["ai-full", "ai-delta-after-correction"],
    maxAiAttempts: 2,
    requiresHumanFinal: true,
    independence: "required",
    diversity: "required",
    triggers: ["critical-capability", "high-impact"]
  });
});

test("single-model does not claim a waiver when diversity is unnecessary", () => {
  const result = assembleReviewPolicy({
    state: {},
    signals: {
      capabilities: new Set(), requiredTriggers: [], diversityTriggers: []
    },
    riskRoute: lowRoute,
    policy: { diversity: "single-model" },
    riskTiered: false
  });
  assert.equal(result.diversityWaived, undefined);
  assert.equal(result.diversity, "preferred");
});

test("evidence contract review policy composes grounding, routing, and project policy", () => {
  let projectPolicy = { review: {}, workflow: { reviewPolicy: "legacy" } };
  const contract = createEvidenceContract({
    activeChangePath: () => "/change",
    readJson: () => ({ risk: { tier: "medium" } }),
    policyCapabilities: () => ["compatibility"],
    foundationPolicy: () => projectPolicy,
    loadRuntime: () => ({})
  });
  const claims = [{ impact: "high", capabilities: ["review"] }];
  const legacy = contract.reviewPolicy("change", { intent: "payment" }, { claims });
  assert.equal(legacy.required, true);
  assert.equal(legacy.tier, undefined);
  assert.ok(legacy.triggers.includes("risk-capability"));

  projectPolicy = {
    review: { diversity: "single-model", independence: "self" },
    workflow: { reviewPolicy: "risk-tiered" }
  };
  const tiered = contract.reviewPolicy("change", { impact: "high" }, { claims });
  assert.equal(tiered.tier, "high");
  assert.equal(tiered.diversityWaived, true);
  assert.equal(tiered.independenceWaived, true);

  projectPolicy = { review: null, workflow: { reviewPolicy: "legacy" } };
  const defaultState = contract.reviewPolicy("change", undefined, { claims: [] });
  assert.equal(defaultState.required, false);
});

test("a capability covered by review requires review at its tier", () => {
  const command = ["sh", "-c", "npm test"];
  const contractFor = (capability) => ({
    providers: {
      test: { adapter: "test-discovery", command },
      [capability]: { adapter: "command", capability, command }
    },
    claims: [{ id: "a", impact: "low", capabilities: ["test", capability] }]
  });
  const route = (capability) => {
    const contract = contractFor(capability);
    const signals = collectReviewSignals({ impact: "low" }, contract);
    return { signals, route: classifyReviewRisk({
      state: { impact: "low" }, claims: contract.claims,
      capabilities: signals.capabilities, grounding: null,
      requiredTriggers: signals.requiredTriggers
    }) };
  };
  const security = route("security-static");
  assert.deepEqual(security.signals.requiredTriggers, ["covered-by-review:security-static"]);
  assert.equal(security.route.tier, "high");
  const resilience = route("resilience");
  assert.deepEqual(resilience.signals.requiredTriggers, ["covered-by-review:resilience"]);
  assert.equal(resilience.route.tier, "medium");
  // Legacy policy requires review for it too.
  assert.equal(assembleReviewPolicy({
    state: {}, signals: resilience.signals, riskRoute: resilience.route,
    policy: {}, riskTiered: false
  }).required, true);
  // A real command observes the capability itself: no review trigger.
  const wired = contractFor("resilience");
  wired.providers.resilience.command = ["npm", "run", "chaos"];
  assert.deepEqual(collectReviewSignals({}, wired).requiredTriggers, []);
});

test("typed trust-boundary risk signals escalate the review tier", () => {
  const route = (riskSignals, extra = {}) => classifyReviewRisk({
    state: { intent: "show the order total", impact: "low", coupling: "isolated",
      securityTriggers: [], riskSignals, ...extra },
    claims: [{ id: "c", impact: "low", capabilities: ["test"] }],
    capabilities: new Set(["test"]), grounding: null
  });
  assert.equal(route([]).tier, "low", "no signal keeps the fast low tier");
  assert.equal(route(["user-interface", "performance-slo"]).tier, "low",
    "signals without a trust boundary do not move the tier");
  const access = route(["access-control"]);
  assert.equal(access.tier, "high");
  assert.ok(access.triggers.includes("authorization-or-secrets"));
  const input = route(["Input-Domain"]);
  assert.equal(input.tier, "medium");
  assert.deepEqual(input.triggers, ["input-domain"]);
  assert.equal(input.maxAiAttempts, 2);
  // input-domain alone is not declared risk, so an intent keyword stays a
  // keyword; access-control is, so the intent semantics count.
  assert.equal(route(["input-domain"], { intent: "fix billing rounding" }).tier, "medium");
  assert.ok(route(["access-control"], { intent: "fix billing rounding" }).triggers
    .includes("critical-semantics"));
});
