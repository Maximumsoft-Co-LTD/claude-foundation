import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  commandExistsOperation,
  createRuntimeEnvironment,
  playwrightAvailabilityOperation,
  reviewAssuranceDimension
} from "../../harness/runtime/core/runtime-environment.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-policy-unit-"));
const policyPath = join(root, "foundation.json");
writeFileSync(policyPath, "{}\n");
const fail = (message) => { throw new Error(message); };

function policy(configured = {}, path = policyPath) {
  return createRuntimeEnvironment({
    root, policyPath: path, protocols: {}, fail,
    readJson: (requested, fallback) => requested === path ? configured : fallback
  }).foundationPolicy();
}

const reviewer = {
  adapter: "codex-cli", executable: "codex", providerFamily: "openai",
  modelFamily: "gpt", modelId: "gpt-review", reasoningEffort: "high",
  sandbox: "read-only", ephemeral: true
};

test("runtime discovery operations resolve commands and Playwright ownership", () => {
  const commandContext = {
    root: "/repo",
    exists: (path) => path === "/tools/node" || path === "/repo/bin/tool",
    isAbsolute: (path) => path.startsWith("/"),
    resolve: (...parts) => join(...parts), join,
    pathValue: "/missing:/tools", delimiter: ":"
  };
  assert.equal(commandExistsOperation(commandContext, "", root), false);
  assert.equal(commandExistsOperation(commandContext, "node", root), true);
  assert.equal(commandExistsOperation(commandContext, "missing", root), false);
  assert.equal(commandExistsOperation(commandContext, "bin/tool", "/repo"), true);
  assert.equal(commandExistsOperation(commandContext, "bin/tool"), true);
  assert.equal(commandExistsOperation(commandContext, "/absent", root), false);

  const requested = [];
  const availability = playwrightAvailabilityOperation({
    readJson: () => ({
      dependencies: { "@playwright/test": "1.0.0" },
      devDependencies: { other: "1.0.0" }
    }),
    join,
    exists: (path) => {
      requested.push(path);
      return path.endsWith("playwright.config.mjs") || path.endsWith("/.bin/playwright");
    }
  }, "/workspace");
  assert.deepEqual(availability, {
    packageOwned: true,
    binary: "/workspace/node_modules/.bin/playwright",
    binaryAvailable: true,
    config: "playwright.config.mjs"
  });
  assert.ok(requested.some((path) => path.endsWith("playwright.config.ts")));

  assert.deepEqual(playwrightAvailabilityOperation({
    readJson: () => ({}), join, exists: () => false
  }, "/empty"), {
    packageOwned: false,
    binary: "/empty/node_modules/.bin/playwright",
    binaryAvailable: false,
    config: null
  });
});

test("assurance dimensions distinguish configured, active, and preferred posture", () => {
  const definition = {
    key: "independence", waivedValue: "self",
    waivedConsequence: "waived", requiredConsequence: "required",
    preferredConsequence: "preferred"
  };
  assert.deepEqual(reviewAssuranceDimension({ independence: "self" }, null, definition), {
    configured: "self", effective: "self", required: false,
    waived: true, consequence: "waived"
  });
  assert.deepEqual(reviewAssuranceDimension({ independence: "required" }, {
    independence: "preferred"
  }, definition), {
    configured: "required", effective: "preferred", required: false,
    waived: false, consequence: "preferred"
  });
  assert.deepEqual(reviewAssuranceDimension({ independence: "self" }, {
    independence: "required", independenceWaived: false
  }, definition), {
    configured: "self", effective: "required", required: true,
    waived: false, consequence: "required"
  });
});

test("policy defaults and legacy execution values normalize deterministically", () => {
  const defaults = policy({}, join(root, "missing-foundation.json"));
  assert.equal(defaults.execution.packetBytes.task, 8192);
  assert.equal(defaults.execution.maxContinuationWindows, 3);
  assert.equal(defaults.quality.changeGate, "warn");
  assert.deepEqual(defaults.review.fallbackReviewers, []);

  const legacy = policy({
    version: 1,
    execution: {
      packetBytes: 4096,
      tokenBudgets: { rapid: 20000 }, requestBudgets: { rapid: 20 }
    },
    review: {
      independence: "self", diversity: "single-model",
      reviewers: { primary: reviewer }, defaultReviewer: "primary",
      fallbackReviewers: ["main-session"]
    }
  });
  assert.equal(legacy.execution.legacyNumericPacketBytes, 4096);
  assert.deepEqual(legacy.execution.packetBytes, {
    task: 4096, review: 4096, repository: 4096, global: 4096
  });
  assert.deepEqual(legacy.review.fallbackReviewers, ["main-session"]);
  assert.equal(legacy.review.fallbackReviewer, "main-session");

  const restoredBudgets = policy({
    execution: { tokenBudgets: null, requestBudgets: null }
  });
  assert.equal(restoredBudgets.execution.tokenBudgets.rapid, 800000);
  assert.equal(restoredBudgets.execution.requestBudgets.standard, 200);
});

test("execution validation rejects every bounded numeric class", () => {
  const invalid = [
    [{ execution: { packetBytes: { task: 1 } } }, /packetBytes.task/],
    [{ execution: { packetBytes: { review: 70000 } } }, /packetBytes.review/],
    [{ execution: { packetBytes: { repository: 2048.5 } } }, /packetBytes.repository/],
    [{ execution: { planSummaryBytes: 100 } }, /planSummaryBytes/],
    [{ execution: { planSummaryBytes: 20000 } }, /planSummaryBytes/],
    [{ execution: { tokenBudgets: { rapid: 1 } } }, /tokenBudgets.rapid/],
    [{ execution: { tokenBudgets: { standard: 100000001 } } }, /tokenBudgets.standard/],
    [{ execution: { requestBudgets: { rapid: 1 } } }, /requestBudgets.rapid/],
    [{ execution: { requestBudgets: { standard: 100001 } } }, /requestBudgets.standard/],
    [{ execution: { maxContinuationWindows: 0 } }, /maxContinuationWindows/],
    [{ execution: { maxContinuationWindows: 21 } }, /maxContinuationWindows/],
    [{ execution: { maxParallelAgents: 0 } }, /maxParallelAgents/],
    [{ execution: { maxParallelAgents: 17 } }, /maxParallelAgents/],
    [{ execution: { leaseMinutes: 0 } }, /leaseMinutes/],
    [{ execution: { leaseMinutes: 1441 } }, /leaseMinutes/]
  ];
  for (const [configured, expected] of invalid)
    assert.throws(() => policy(configured), expected);
});

test("quality change gate accepts staged rollout modes and rejects unknown modes", () => {
  for (const changeGate of ["off", "warn", "enforce-high-risk"])
    assert.equal(policy({ quality: { changeGate } }).quality.changeGate, changeGate);
  assert.throws(() => policy({ quality: { changeGate: "always" } }),
    /quality.changeGate/);
});

test("workflow, sandbox and boolean controls fail closed", () => {
  const invalid = [
    [{ sandbox: { setupCommand: "" } }, /setupCommand/],
    [{ sandbox: { setupCommand: 42 } }, /setupCommand/],
    [{ sandbox: { setupTimeoutMs: 10 } }, /setupTimeoutMs/],
    [{ sandbox: { setupTimeoutMs: 4000000 } }, /setupTimeoutMs/],
    [{ workflow: { grounding: "sometimes" } }, /workflow.grounding/],
    [{ workflow: { reviewCircuit: "partial" } }, /reviewCircuit/],
    [{ workflow: { reviewPolicy: "unknown" } }, /reviewPolicy/],
    [{ workflow: { handoffDefaultOwner: "" } }, /handoffDefaultOwner/],
    [{ telemetry: { requireUsage: "yes" } }, /requireUsage/],
    [{ land: { riskBasedCi: "yes" } }, /riskBasedCi/]
  ];
  for (const [configured, expected] of invalid)
    assert.throws(() => policy(configured), expected);
});

test("review fallback and reviewer validation reject unsafe wiring", () => {
  const withReviewer = (review) => ({ review: {
    reviewers: { primary: reviewer }, ...review
  } });
  const invalid = [
    [{ review: { diversity: "none" } }, /review.diversity/],
    [{ review: { independence: "shared" } }, /review.independence/],
    [withReviewer({ defaultReviewer: "missing" }), /defaultReviewer/],
    [{ review: { fallbackReviewer: "other" } }, /fallbackReviewer must be/],
    [{ review: { fallbackReviewer: "main-session", fallbackReviewers: [] } }, /not both/],
    [{ review: { fallbackReviewers: "primary" } }, /must be an array/],
    [{ review: { fallbackReviewers: [""] } }, /must be an array/],
    [withReviewer({ fallbackReviewers: ["primary", "primary"] }), /duplicates/],
    [withReviewer({ fallbackReviewers: ["missing"] }), /unknown reviewer/],
    [withReviewer({ defaultReviewer: "primary", fallbackReviewers: ["primary"] }), /must not repeat/],
    [{ review: { infraFailureThreshold: 0 } }, /infraFailureThreshold/],
    [{ review: { fallbackReviewers: ["main-session"] } }, /requires review.independence self/],
    [{ review: { reviewers: { bad: { ...reviewer, adapter: "shell" } } } }, /adapter must be/],
    [{ review: { reviewers: { bad: { ...reviewer, executable: "" } } } }, /executable is required/],
    [{ review: { reviewers: { bad: { ...reviewer, providerFamily: "anthropic" } } } }, /providerFamily/],
    [{ review: { reviewers: { bad: { ...reviewer, reasoningEffort: "medium" } } } }, /reasoningEffort/],
    [{ review: { reviewers: { bad: { ...reviewer, sandbox: "workspace-write" } } } }, /read-only sandbox/],
    [{ review: { reviewers: { bad: { ...reviewer, ephemeral: false } } } }, /ephemeral true/]
  ];
  for (const [configured, expected] of invalid)
    assert.throws(() => policy(configured), expected);

  const claudeReviewer = {
    ...reviewer, adapter: "claude-cli", executable: "claude",
    providerFamily: "anthropic", modelFamily: "claude", modelId: "opus"
  };
  assert.equal(policy({ review: { reviewers: { claude: claudeReviewer } } })
    .review.reviewers.claude.providerFamily, "anthropic");
});

test("model tiers and policy version reject incompatible values", () => {
  const invalid = [
    [{ version: 2 }, /requires version 1/],
    [{ models: { fast: { family: 42 } } }, /models.fast.family/],
    [{ models: { standard: { fallbackTier: "unknown" } } }, /fallbackTier is invalid/],
    [{ models: { deep: { fallbackTier: "standard" } } }, /deep model tier cannot downgrade/]
  ];
  for (const [configured, expected] of invalid)
    assert.throws(() => policy(configured), expected);
});
