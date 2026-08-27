import assert from "node:assert/strict";
import {
  DEFAULT_CONSUMER_QUALITY_POLICY, capabilityRequirement, defaultConsumerQualityConfig,
  validateConsumerQualityConfig
} from "../../harness/runtime/quality/quality-policy.mjs";
import {
  aggregateQualityLanes, classifyMutationSurfaces, evaluateCrapRatchet,
  evaluateMutationRatchet, pathMatches, scopeViolations
} from "../../harness/runtime/quality/quality-evaluator.mjs";

const policy = structuredClone(DEFAULT_CONSUMER_QUALITY_POLICY);
const config = defaultConsumerQualityConfig([{ id: "root", profiles: ["application-js-ts"] }]);
assert.equal(validateConsumerQualityConfig(config), config);
const optionalRequiredProfile = structuredClone(config);
optionalRequiredProfile.repositories[0].providers.test = {
  kind: "command", command: ["npm", "test"], required: false
};
assert.throws(() => validateConsumerQualityConfig(optionalRequiredProfile),
  /cannot make profile capability 'test' optional/);
assert.throws(() => validateConsumerQualityConfig({ ...config, policy: {
  ...policy, unsupportedCapability: { default: "report", neverAssumePass: false, neverAssumeZero: true }
} }), /never assume pass or zero/);
assert.throws(() => validateConsumerQualityConfig({ ...config, exceptions: [{
  id: "QEX-1", repository: "root", target: "src/**", metric: "crap",
  reason: "fixture", risk: "weak test", compensatingEvidence: ["case-1"],
  owner: "team", approvedBy: "reviewer", expires: "2099-01-01", trackingIssue: "Q-1"
}] }), /more than 90 days|not a glob/);
assert.equal(capabilityRequirement({ status: "unsupported", capability: "crap", impact: "high", policy }).blocking, true);
assert.equal(capabilityRequirement({ status: "unsupported", capability: "crap", impact: "low", policy }).assurance, "reduced");

assert.equal(pathMatches("src/auth/index.ts", ["src/auth/**"]), true);
assert.deepEqual(scopeViolations(["src/auth/index.ts", "src/payment/pay.ts"], {
  include: ["src/auth/**"], allowedSupportingChanges: [], exclude: []
}), ["src/payment/pay.ts"]);

const tool = { name: "fixture", version: "1", adapterVersion: "1", configDigest: `sha256:${"a".repeat(64)}` };
const baseFunction = { id: "authorize", path: "src/auth.ts", line: 1, endLine: 4,
  complexity: 10, coverageKind: "branch", coveragePercent: 50, crap: 22.5, mapping: "exact" };
const evaluated = evaluateCrapRatchet({
  current: { protocol: "foundation-crap-v1", repository: "root", language: "typescript", tool,
    functions: [{ ...baseFunction, coveragePercent: 40, crap: 31.6 }] },
  baseline: { repository: "root", language: "typescript", tool, functions: [baseFunction] },
  changedPaths: new Set(["src/auth.ts"]), policy
});
assert.equal(evaluated.summary.fail, 1);
assert.match(evaluated.changedFunctions[0].reasons.join(" "), /regressed/);
assert.match(evaluated.changedFunctions[0].reasons.join(" "), /coverage 40% is below 80%/);
const legacy = evaluateCrapRatchet({
  current: { repository: "root", functions: [{ ...baseFunction, path: "src/legacy.ts", crap: 100 }] },
  baseline: { functions: [] }, changedPaths: new Set(["src/auth.ts"]), policy
});
assert.equal(legacy.summary.total, 0, "unrelated legacy debt must not block a change");

const mutationBase = {
  repository: "root", language: "typescript", tool,
  mutants: [{ id: "m1", path: "src/auth.ts", status: "killed", changedSurface: "changed-relevant" }]
};
const mutationCurrent = classifyMutationSurfaces({
  repository: "root", language: "typescript", tool,
  mutants: [
    { id: "m1", path: "src/auth.ts", status: "survived", changedSurface: "unknown" },
    { id: "old", path: "src/legacy.ts", status: "survived", changedSurface: "unknown" }
  ]
}, new Set(["src/auth.ts"]));
const mutationResult = evaluateMutationRatchet({ current: mutationCurrent, baseline: mutationBase, policy });
assert.equal(mutationResult.status, "fail");
assert.equal(mutationResult.current.total, 1, "legacy-unrelated mutants are debt, not the current gate");
assert.equal(evaluateMutationRatchet({ current: mutationCurrent,
  baseline: { ...mutationBase, mutants: [{ ...mutationBase.mutants[0], status: "survived" }] }, policy
}).status, "pass", "an unchanged legacy survivor remains debt rather than blocking the touched scope");
assert.match(evaluateMutationRatchet({ current: mutationCurrent,
  baseline: { ...mutationBase, tool: { ...tool, version: "2" } }, policy
}).reasons.join(" "), /incompatible/);
const timedOut = { ...mutationCurrent, mutants: [{ ...mutationCurrent.mutants[0],
  id: "new-timeout", status: "timeout" }] };
assert.equal(evaluateMutationRatchet({ current: timedOut, baseline: mutationBase, policy }).status,
  "fail", "a timeout is not a behavioral kill");
const differentSurfaceBaseline = { ...mutationBase, mutants: [{ id: "old-only",
  path: "src/old.ts", status: "survived", changedSurface: "changed-relevant" }] };
const killedNewSurface = { ...mutationCurrent, mutants: [{ ...mutationCurrent.mutants[0],
  id: "new-killed", status: "killed" }] };
assert.equal(evaluateMutationRatchet({ current: killedNewSurface,
  baseline: differentSurfaceBaseline, policy }).status, "pass",
"mutation scores from different changed surfaces must not be compared");
const semanticPolicy = structuredClone(policy);
semanticPolicy.mutation.semanticKillRate = 50;
semanticPolicy.mutation.changedCodeTarget = 0;
const semanticCurrent = { ...mutationCurrent, mutants: [
  { ...mutationCurrent.mutants[0], id: "semantic-killed", status: "killed",
    changedSurface: "semantic-required" },
  { ...mutationCurrent.mutants[0], id: "semantic-survived", status: "survived",
    changedSurface: "semantic-required" }
] };
const semanticAtTarget = evaluateMutationRatchet({ current: semanticCurrent,
  baseline: { ...mutationBase, mutants: [] }, policy: semanticPolicy });
assert.equal(semanticAtTarget.semanticScore, 50);
assert.equal(semanticAtTarget.status, "pass");
semanticPolicy.mutation.semanticKillRate = 51;
assert.match(evaluateMutationRatchet({ current: semanticCurrent,
  baseline: { ...mutationBase, mutants: [] }, policy: semanticPolicy }).reasons.join(" "),
/semantic mutation kill rate 50% is below 51%/);
assert.equal(evaluateMutationRatchet({ current: mutationCurrent, baseline: mutationBase, policy,
  exceptions: [{ repository: "root", target: "m1", metric: "mutation", expires: "2099-01-01" }]
}).reasons.some((reason) => reason.includes("m1 survived")), false);

assert.equal(aggregateQualityLanes([
  { repository: "web", status: "pass", assurance: "full" },
  { repository: "api", status: "pass", assurance: "reduced", required: false }
]).status, "reduced");
assert.equal(aggregateQualityLanes([
  { repository: "web", status: "pass" }, { repository: "api", status: "fail" }
]).status, "fail", "one repository failure must not be hidden by aggregation");

console.log("consumer quality policy tests: ok");
