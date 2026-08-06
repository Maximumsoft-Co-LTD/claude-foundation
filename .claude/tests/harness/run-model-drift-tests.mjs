import assert from "node:assert/strict";
import {
  classifyDrift, DRIFT_BLOCKING_TASK_KINDS, isBlockingDrift, resolveFamily
} from "../../harness/runtime/observability/model-drift.mjs";

const policy = {
  models: {
    fast: { family: "haiku", fallbackTier: "standard" },
    standard: { family: "sonnet", fallbackTier: "deep" },
    deep: { family: "opus", fallbackTier: null }
  }
};
const isolated = {
  models: {
    fast: { family: "haiku", fallbackTier: null },
    standard: { family: "sonnet", fallbackTier: null },
    deep: { family: "opus", fallbackTier: null }
  }
};
const custom = {
  models: {
    fast: { family: "tiny", fallbackTier: "standard" },
    standard: { family: "mid", fallbackTier: "deep" },
    deep: { family: "giant-x", fallbackTier: null }
  }
};

let assertions = 0;

const families = [
  ["claude-sonnet-5", policy, "sonnet"],
  ["claude-opus-4-1-20250805", policy, "opus"],
  ["claude-haiku-4-5-20251001", policy, "haiku"],
  ["claude-opus-5[1m]", policy, "opus"],
  ["us.anthropic.claude-sonnet-5-v1:0", policy, "sonnet"],
  ["gpt-4o", policy, null],
  ["claude-opus-5", null, null],
  ["claude-opus-5", {}, null],
  [null, policy, null],
  [undefined, policy, null],
  ["", policy, null],
  ["vendor-giant-x-2", custom, "giant-x"],
  ["claude-opus-5", custom, null]
];
for (const [modelId, given, expected] of families) {
  assert.equal(resolveFamily(modelId, given), expected, `resolveFamily(${modelId})`);
  assertions += 1;
}

const cases = [
  ["match", { requestedTier: "standard", actualModelId: "claude-sonnet-5", policy },
    { kind: "match", requestedFamily: "sonnet", actualFamily: "sonnet", actualTier: "standard" }],
  ["fallback fast->standard", { requestedTier: "fast", actualModelId: "claude-sonnet-5", policy },
    { kind: "fallback", actualFamily: "sonnet", actualTier: "standard" }],
  ["fallback fast->deep transitively",
    { requestedTier: "fast", actualModelId: "claude-opus-5[1m]", policy },
    { kind: "fallback", actualFamily: "opus", actualTier: "deep" }],
  ["fallback standard->deep", { requestedTier: "standard", actualModelId: "claude-opus-5", policy },
    { kind: "fallback", actualFamily: "opus", actualTier: "deep" }],
  ["undeclared upgrade",
    { requestedTier: "fast", actualModelId: "claude-sonnet-5", policy: isolated },
    { kind: "upgrade", requestedFamily: "haiku", actualFamily: "sonnet", actualTier: "standard" }],
  ["undeclared upgrade fast->deep",
    { requestedTier: "fast", actualModelId: "claude-opus-5", policy: isolated },
    { kind: "upgrade", actualTier: "deep" }],
  ["downgrade deep->fast",
    { requestedTier: "deep", actualModelId: "claude-haiku-4-5-20251001", policy },
    { kind: "downgrade", requestedFamily: "opus", actualFamily: "haiku", actualTier: "fast" }],
  ["downgrade standard->fast",
    { requestedTier: "standard", actualModelId: "claude-haiku-4-5-20251001", policy },
    { kind: "downgrade", actualTier: "fast" }],
  ["host reports family directly",
    { requestedTier: "deep", actualFamily: "haiku", policy },
    { kind: "downgrade", actualFamily: "haiku", actualTier: "fast" }],
  ["unresolvable model id", { requestedTier: "deep", actualModelId: "gpt-4o", policy },
    { kind: "unknown", requestedFamily: "opus", actualFamily: null, actualTier: null }],
  ["invalid requested tier", { requestedTier: "turbo", actualModelId: "claude-opus-5", policy },
    { kind: "unknown", requestedTier: "turbo", requestedFamily: null, actualTier: null }],
  ["missing requested tier", { actualModelId: "claude-opus-5", policy },
    { kind: "unknown", requestedTier: null, actualTier: null }],
  ["host reported no model", { requestedTier: "deep", policy },
    { kind: "unknown", actualFamily: null, reason: "actual model not reported" }],
  ["null inputs",
    { requestedTier: null, actualModelId: null, actualFamily: null, policy },
    { kind: "unknown", requestedTier: null, requestedFamily: null, actualFamily: null }],
  ["undefined policy", { requestedTier: "deep", actualModelId: "claude-opus-5" },
    { kind: "unknown", reason: "model policy unavailable" }],
  ["no arguments at all", undefined,
    { kind: "unknown", requestedTier: null, requestedFamily: null, actualFamily: null }],
  ["custom policy match", { requestedTier: "deep", actualModelId: "vendor-giant-x-2", policy: custom },
    { kind: "match", requestedFamily: "giant-x", actualFamily: "giant-x", actualTier: "deep" }],
  ["custom policy fallback", { requestedTier: "fast", actualModelId: "vendor-mid-2", policy: custom },
    { kind: "fallback", actualFamily: "mid", actualTier: "standard" }],
  ["custom policy downgrade", { requestedTier: "deep", actualModelId: "vendor-tiny-2", policy: custom },
    { kind: "downgrade", actualFamily: "tiny", actualTier: "fast" }],
  ["default families are not hard-coded",
    { requestedTier: "deep", actualModelId: "claude-opus-5", policy: custom },
    { kind: "unknown", actualFamily: null }],
  ["equidistant tie fails safe to the lower tier",
    { requestedTier: "standard", actualModelId: "vendor-twin-1",
      policy: { models: {
        fast: { family: "twin", fallbackTier: null },
        standard: { family: "mid", fallbackTier: null },
        deep: { family: "twin", fallbackTier: null }
      } } },
    { kind: "downgrade", actualFamily: "twin", actualTier: "fast" }],
  ["declared fallback outranks downgrade when policy declares it",
    { requestedTier: "standard", actualModelId: "claude-haiku-4-5-20251001",
      policy: { models: {
        fast: { family: "haiku", fallbackTier: null },
        standard: { family: "sonnet", fallbackTier: "fast" },
        deep: { family: "opus", fallbackTier: null }
      } } },
    { kind: "fallback", actualTier: "fast" }]
];
for (const [name, input, expected] of cases) {
  const drift = input === undefined ? classifyDrift() : classifyDrift(input);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(drift[key], value, `${name}: ${key}`);
    assertions += 1;
  }
  assert.equal(typeof drift.reason, "string", `${name}: reason`);
  assertions += 1;
}

assert.deepEqual([...DRIFT_BLOCKING_TASK_KINDS].sort(),
  ["architecture", "contract", "migration", "review", "security"]);
assertions += 1;

const kinds = ["match", "fallback", "upgrade", "downgrade", "unknown"];
const taskKinds = [
  ["contract", true], ["architecture", true], ["security", true], ["migration", true],
  ["review", true], ["implementation", false], ["tests", false], ["inventory", false],
  [null, false], [undefined, false], ["", false]
];
for (const kind of kinds)
  for (const [taskKind, blocking] of taskKinds) {
    assert.equal(isBlockingDrift(kind, taskKind), kind === "downgrade" && blocking,
      `isBlockingDrift(${kind}, ${taskKind})`);
    assertions += 1;
  }
for (const [taskKind] of taskKinds.filter(([, blocking]) => blocking)) {
  assert.equal(isBlockingDrift("unknown", taskKind), false, "unknown must never block");
  assertions += 1;
}
assert.equal(isBlockingDrift(undefined, "security"), false);
assert.equal(isBlockingDrift(null, null), false);
assertions += 2;

console.log(`model drift: ALL PASS (${assertions}/${assertions} assertions)`);
