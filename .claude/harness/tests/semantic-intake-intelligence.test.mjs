import assert from "node:assert/strict";
import test from "node:test";
import { CORE_DISCOVERY_DIMENSIONS } from "../runtime/workflow/validation/semantic-intake.mjs";
import {
  planSemanticIntakeDepth,
  semanticIntakeEffectivenessSnapshot,
  semanticQuestionQualityFindings
} from "../runtime/workflow/validation/semantic-intake-intelligence.mjs";

function source(overrides = {}) {
  return {
    version: 4,
    intent: "Add bounded contact search",
    impact: "low",
    requirements: [{ key: "search", operation: "added" }],
    discovery: {
      coverage: CORE_DISCOVERY_DIMENSIONS.map((dimension) => ({
        dimension, status: "covered", covers: ["search"]
      })),
      decisions: []
    },
    ...overrides
  };
}

test("adaptive depth grows with impact, coupling, and risk without dropping dimensions", () => {
  const focused = planSemanticIntakeDepth(source());
  const deep = planSemanticIntakeDepth(source({
    impact: "high",
    changeSize: "large",
    riskSignals: ["access-control", "persisted-data-change"]
  }), { repository: { dependentCount: 12, permissionBoundaryCount: 2 } });

  assert.equal(focused.tier, "focused");
  assert.equal(deep.tier, "deep");
  assert.ok(deep.limits.maxSourceFiles > focused.limits.maxSourceFiles);
  assert.deepEqual(focused.requiredDimensions, CORE_DISCOVERY_DIMENSIONS);
  for (const dimension of CORE_DISCOVERY_DIMENSIONS)
    assert.ok(deep.requiredDimensions.includes(dimension), dimension);
  assert.ok(deep.requiredDimensions.includes("security-privacy"));
  assert.ok(deep.requiredDimensions.includes("data-migration"));
});

test("adaptive depth recognizes the public xs/s/m/l and coupling enums", () => {
  const xs = planSemanticIntakeDepth(source({ size: "xs", coupling: "isolated" }));
  const medium = planSemanticIntakeDepth(source({ size: "m", coupling: "coupled" }));
  const large = planSemanticIntakeDepth(source({
    size: "l", coupling: "cross-repository", impact: "medium"
  }));
  assert.equal(xs.tier, "focused");
  assert.equal(medium.tier, "standard");
  assert.equal(large.tier, "deep");
  assert.ok(medium.score > xs.score);
  assert.ok(large.score > medium.score);
  assert.ok(xs.limits.maxSourceFiles < medium.limits.maxSourceFiles);
  assert.ok(medium.limits.maxSourceFiles < large.limits.maxSourceFiles);
  assert.ok(xs.limits.maxSourceBytes < medium.limits.maxSourceBytes);
  assert.ok(medium.limits.maxSourceBytes < large.limits.maxSourceBytes);
  assert.ok(large.reasons.includes("coupling:cross-repository"));
});

test("typed inputs produce the same plan for English, Thai, and mixed prose", () => {
  const variants = [
    "Change stored permissions",
    "เปลี่ยนสิทธิ์ของข้อมูลที่บันทึกไว้",
    "เปลี่ยน stored permissions สำหรับผู้ใช้"
  ].map((intent) => planSemanticIntakeDepth(source({
    intent,
    impact: "medium",
    riskSignals: ["access-control", "persisted-data-change"]
  }), { repository: { dependentCount: 4 } }));

  assert.deepEqual(variants[0], variants[1]);
  assert.deepEqual(variants[1], variants[2]);
});

test("question quality rejects normalized duplicates and unsupported recommendations", () => {
  const value = source();
  value.discovery.decisions = [{
    key: "scope", status: "open", question: "Which scope?",
    alternatives: ["One team", " one-team ", "All teams"], recommended: "Unknown"
  }];
  assert.deepEqual(
    semanticQuestionQualityFindings(value).map((row) => row.code),
    ["duplicate-alternatives", "recommendation-not-an-alternative", "unsupported-recommendation"]
  );
});

test("question quality rejects facts already answered by repository sources", () => {
  const value = source();
  value.discovery.decisions = [{
    key: "retention", status: "open", question: "เก็บข้อมูลกี่วัน?",
    alternatives: ["30 วัน", "90 วัน"], recommended: "30 วัน",
    recommendationSources: ["policy"]
  }];
  const findings = semanticQuestionQualityFindings(value, {
    sourceInventory: { sources: [{ path: "policy", sha256: "digest" }] },
    sourceFacts: [{
      sourceKey: "retention-policy", sourcePath: "policy", sourceDigest: "digest",
      decisionKey: "retention", answer: "90 วัน"
    }]
  });
  assert.deepEqual(findings, [{
    code: "question-answerable-from-source",
    key: "retention",
    path: "discovery.decisions[0]",
    detail: { sourceKeys: ["retention-policy"] }
  }]);
});

test("grounded recommendation can be accepted in mixed-language decisions", () => {
  const value = source();
  value.discovery.decisions = [{
    key: "mode", status: "open", question: "เลือก safe mode ไหน?",
    alternatives: ["เข้มงวด", "compatible"], recommended: "เข้มงวด"
  }];
  assert.deepEqual(semanticQuestionQualityFindings(value, {
    sourceInventory: { sources: [{ path: "security.md", sha256: "digest" }] },
    sourceFacts: [{
      sourceKey: "security-contract", sourcePath: "security.md", sourceDigest: "digest",
      decisionKey: "mode", supportsRecommendation: true
    }]
  }), []);
});

test("source facts and recommendation evidence must match the current inventory digest", () => {
  const value = source();
  value.discovery.decisions = [{
    key: "mode", status: "open", question: "Which mode?",
    alternatives: ["safe", "fast"], recommended: "safe",
    recommendationEvidence: [{ sourcePath: "policy.md", sourceDigest: "stale" }]
  }];
  const findings = semanticQuestionQualityFindings(value, {
    sourceInventory: { sources: [{ path: "policy.md", sha256: "current" }] },
    sourceFacts: [{
      sourceKey: "mode-policy", sourcePath: "policy.md", sourceDigest: "stale",
      decisionKey: "mode", supportsRecommendation: true
    }]
  });

  assert.deepEqual(findings.map((finding) => finding.code), [
    "invalid-recommendation-evidence-binding",
    "unsupported-recommendation",
    "invalid-source-fact-binding"
  ]);
});

test("effectiveness snapshot reports coverage, quality, and observed history", () => {
  const value = source();
  value.discovery.coverage[0].sources = ["README.md"];
  value.discovery.decisions = [{
    key: "scope", status: "open", question: "Scope?",
    alternatives: ["one", "all"], recommended: "one",
    recommendationEvidence: ["README.md"]
  }];
  const snapshot = semanticIntakeEffectivenessSnapshot(value, {
    sourceInventory: { sources: [{ path: "README.md", sha256: "digest" }] },
    history: [{ type: "inspection" }, { type: "question-round" }]
  });

  assert.equal(snapshot.coverage.completed, CORE_DISCOVERY_DIMENSIONS.length);
  assert.equal(snapshot.coverage.completionRatio, 1);
  assert.equal(snapshot.coverage.grounded, 1);
  assert.equal(snapshot.questions.accepted, null);
  assert.equal(snapshot.questions.acceptanceMeasurement, "unavailable");
  assert.equal(snapshot.questions.eligible, 1);
  assert.equal(snapshot.questions.resolved, 0);
  assert.deepEqual(snapshot.history, {
    observed: true, inspections: 1, questionRounds: 1,
    sourceRefreshes: 0, draftRepairs: 0
  });
});

test("effectiveness snapshot keeps unavailable historical measurements null", () => {
  const snapshot = semanticIntakeEffectivenessSnapshot(source());
  assert.deepEqual(snapshot.history, {
    observed: false, inspections: null, questionRounds: null,
    sourceRefreshes: null, draftRepairs: null
  });
});
