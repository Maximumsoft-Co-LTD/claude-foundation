import assert from "node:assert/strict";
import {
  chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync,
  rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyReviewRisk } from "../../harness/runtime/evidence/review-routing.mjs";
import {
  criticalCaseResult, enforceCriticalCases, mutationReceiptClassification,
  mutationV2Result, providerExecutionEnvironment
} from "../../harness/runtime/evidence/adapter-runtime.mjs";
import { providerEvidencePolicy, providerReceiptWriterConflicts } from
  "../../harness/runtime/evidence/evidence-contract.mjs";
import { createCodexReviewerRuntime } from "../../harness/runtime/evidence/codex-reviewer.mjs";
import { createRuntimeEnvironment } from "../../harness/runtime/core/runtime-environment.mjs";
import { createChangeLifecycle } from "../../harness/runtime/workflow/change-lifecycle.mjs";

function pass(label) { process.stdout.write(`PASS: ${label}\n`); }

const low = classifyReviewRisk({
  state: { intent: "Adjust dashboard label", impact: "low", coupling: "isolated" },
  claims: [{ impact: "low" }], capabilities: new Set(), grounding: {},
  requiredTriggers: []
});
assert.deepEqual(low.route, ["ai-full"]);
assert.equal(low.maxAiAttempts, 1);
pass("low risk uses one full AI review");

const medium = classifyReviewRisk({
  state: { intent: "Change an internal calculation", impact: "medium", coupling: "isolated" },
  claims: [{ impact: "medium" }], capabilities: new Set(), grounding: {},
  requiredTriggers: []
});
assert.deepEqual(medium.route, ["ai-full", "ai-delta-after-correction"]);
assert.equal(medium.maxAiAttempts, 2);
pass("medium risk permits one bounded delta closure");

const high = classifyReviewRisk({
  state: {
    intent: "Activate the legacy RabbitMQ consumer", impact: "low", coupling: "isolated",
    securityTriggers: []
  },
  claims: [{ impact: "low" }], capabilities: new Set(), grounding: {},
  requiredTriggers: []
});
assert.deepEqual(high.route, ["ai-full", "ai-delta-after-correction"]);
assert.equal(high.maxAiAttempts, 2);
assert.equal(high.requiresHumanFinal, false);
pass("legacy queue activation uses bounded AI full and correction closure");

let reopenState = {
  id: "reopen-change", intent: "revise one locked decision", schema: "foundation-standard",
  status: "building", impact: "high", coupling: "coupled", securityTriggers: [],
  reviewRequired: true, contractRevision: 0, groundingRequired: true,
  groundingDigest: "prior-grounding-digest", groundingLockedAt: "2026-08-14T00:00:00Z",
  acceptance: { decision: "not-required", required: false }
};
const lifecycle = createChangeLifecycle({
  root: tmpdir(), policy: () => ({ workflow: { grounding: "required" } }),
  securityTerms: [], fail: (message) => { throw new Error(message); },
  pathInside: () => true, readJson: () => ({}), writeJson: () => {},
  slugify: (value) => value, changePath: () => tmpdir(),
  loadRuntime: () => reopenState, saveRuntime: (state) => { reopenState = state; },
  setOperationChangeId: () => {}, initialBudget: () => ({}), gitHead: () => "head",
  preexistingDirty: () => ({}), now: () => "2026-08-14T01:00:00Z",
  bindClaudeSession: () => {}, validate: () => {}, createSandbox: () => {},
  showPacket: () => {}
});
const originalLog = console.log;
console.log = () => {};
try {
  lifecycle.resolveChange("reopen-change", {
    "reopen-grounding": true,
    "decision-ref": "decision:no-human-final",
    "reopen-reason": "replace mandatory human final with bounded AI closure"
  });
} finally {
  console.log = originalLog;
}
assert.equal(reopenState.groundingDigest, undefined);
assert.equal(reopenState.contractRevision, 1);
assert.equal(reopenState.groundingReopenPending.decisionRef,
  "decision:no-human-final");
assert.throws(() => lifecycle.resolveChange("reopen-change", {
  "reopen-grounding": true,
  "decision-ref": "decision:second",
  "reopen-reason": "another revision"
}), /already has an open revision/);
pass("a user decision opens one audited batched grounding revision");

assert.equal(criticalCaseResult({ criticalCases: [
  { id: "WIRE-NULL-EMPTY", status: "passed" }
] }, ["WIRE-NULL-EMPTY"]).status, "pass");
assert.equal(criticalCaseResult({ criticalCases: [
  { id: "WIRE-NULL-EMPTY", status: "skipped" }
] }, ["WIRE-NULL-EMPTY"]).status, "fail");
assert.equal(criticalCaseResult({ criticalCases: [] },
  ["WIRE-NULL-EMPTY"]).status, "fail");
assert.equal(enforceCriticalCases("pass", criticalCaseResult(
  { criticalCases: [] }, ["WIRE-NULL-EMPTY"])), "fail");
pass("required critical cases cannot pass when skipped or missing");

const policyConfig = {
  reportFormat: "json", resultProtocol: "foundation-mutation-v2",
  criticalCases: ["CASE-A"], requiredMutants: ["MUT-A"],
  mutantKillers: { "MUT-A": "CASE-A" }
};
const policyBaseline = providerEvidencePolicy(policyConfig);
for (const changed of [
  providerEvidencePolicy({ ...policyConfig, criticalCases: ["CASE-B"] }),
  providerEvidencePolicy({ ...policyConfig,
    resultProtocol: "foundation-mutation-v1" }),
  providerEvidencePolicy({ ...policyConfig, requiredMutants: ["MUT-B"] }),
  providerEvidencePolicy({ ...policyConfig,
    mutantKillers: { "MUT-A": "CASE-B" } })
]) assert.notEqual(JSON.stringify(changed), JSON.stringify(policyBaseline));
pass("provider fingerprint policy binds critical cases and mutation protocol wiring");

const capabilityOf = (name, config) => config.capability || name;
assert.deepEqual(providerReceiptWriterConflicts({
  test: { adapter: "test-discovery", capability: "test", discoveryProvider: "test" }
}, capabilityOf).map((row) => row.kind), ["same-provider"]);
assert.deepEqual(providerReceiptWriterConflicts({
  "test-api": { adapter: "test-discovery", capability: "test", discoveryProvider: "discovery" },
  "test-worker": { adapter: "test-discovery", capability: "test", discoveryProvider: "discovery" }
}, capabilityOf).map((row) => row.kind), ["multiple-producers"]);
assert.deepEqual(providerReceiptWriterConflicts({
  test: { adapter: "test-discovery", capability: "test", discoveryProvider: "discovery" }
}, capabilityOf), []);
pass("each test/discovery receipt identity has exactly one producer");

assert.equal(mutationV2Result({
  criticalCases: [{ id: "WIRE-FIELD-MAPPING", status: "passed" }], mutants: [{
  id: "MUT-FIELD-SWAP", applied: true, compiled: true,
  result: "killed", killedBy: "WIRE-FIELD-MAPPING"
}] }, ["MUT-FIELD-SWAP"], { "MUT-FIELD-SWAP": "WIRE-FIELD-MAPPING" }).status, "pass");
assert.equal(mutationV2Result({
  criticalCases: [{ id: "WIRE-FIELD-MAPPING", status: "passed" }], mutants: [{
  id: "MUT-FIELD-SWAP", applied: false, compiled: true,
  result: "killed", killedBy: "WIRE-FIELD-MAPPING"
}] }, ["MUT-FIELD-SWAP"], { "MUT-FIELD-SWAP": "WIRE-FIELD-MAPPING" }).status, "fail");
assert.equal(mutationV2Result({
  criticalCases: [{ id: "WIRE-FIELD-MAPPING", status: "passed" }], mutants: [{
  id: "MUT-FIELD-SWAP", applied: true, compiled: true, result: "killed"
}] }, ["MUT-FIELD-SWAP"], { "MUT-FIELD-SWAP": "WIRE-FIELD-MAPPING" }).status, "fail");
assert.equal(mutationV2Result({
  criticalCases: [{ id: "WIRE-FIELD-MAPPING", status: "skipped" }], mutants: [{
    id: "MUT-FIELD-SWAP", applied: true, compiled: true,
    result: "killed", killedBy: "WIRE-FIELD-MAPPING"
  }]
}, ["MUT-FIELD-SWAP"], { "MUT-FIELD-SWAP": "WIRE-FIELD-MAPPING" }).status, "fail");
pass("mutation v2 requires an applied compiling mutant and named killer case");
assert.equal(mutationReceiptClassification(
  "foundation-mutation-v2", null, null), "behavioral-kill");
pass("mutation v2 records the accepted behavioral-kill receipt classification");
assert.deepEqual(providerExecutionEnvironment({
  CLAUDE_FOUNDATION_PROJECT: "/outer/control", PATH: "/bin"
}, { FOUNDATION_CONTROL_ROOT: "/outer/control" }), {
  PATH: "/bin", FOUNDATION_CONTROL_ROOT: "/outer/control"
});
pass("provider execution cannot leak the outer project pin into nested fixtures");

const environmentFixture = mkdtempSync(join(tmpdir(), "foundation-v33-environment-"));
try {
  const controlRoot = join(environmentFixture, "control");
  const bundleProtocol = join(environmentFixture, "candidate", "protocol.json");
  const bundlePolicy = join(environmentFixture, "candidate", "foundation.json");
  mkdirSync(join(controlRoot, ".claude", "harness"), { recursive: true });
  mkdirSync(join(environmentFixture, "candidate"), { recursive: true });
  writeFileSync(join(controlRoot, ".claude", "harness", "protocol.json"),
    JSON.stringify({ runtimeApi: "19" }));
  writeFileSync(join(controlRoot, "foundation.json"),
    JSON.stringify({ version: 1, execution: { maxParallelAgents: 7 } }));
  writeFileSync(bundleProtocol, JSON.stringify({ runtimeApi: "20" }));
  writeFileSync(bundlePolicy,
    JSON.stringify({ version: 1, execution: { maxParallelAgents: 9 } }));
  const environment = createRuntimeEnvironment({
    root: controlRoot, protocolPath: bundleProtocol, policyPath: bundlePolicy,
    protocols: { runtimeApi: "20" },
    readJson: (path, fallback = undefined) => {
      try { return JSON.parse(readFileSync(path, "utf8")); }
      catch { return fallback; }
    },
    fail: (message) => { throw new Error(message); }
  });
  assert.equal(environment.protocolDescriptor().runtimeApi, "20");
  assert.equal(environment.foundationPolicy().execution.maxParallelAgents, 9);
  pass("self-upgrade reads candidate protocol and policy while retaining control-root state");
} finally {
  rmSync(environmentFixture, { recursive: true, force: true });
}

const fixture = mkdtempSync(join(tmpdir(), "foundation-v33-reviewer-"));
try {
  const workspace = join(fixture, "workspace");
  mkdirSync(workspace, { recursive: true });
  const executable = join(fixture, "fake-codex.cjs");
  writeFileSync(executable, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "login" && args[1] === "status") {
  if (process.env.FAKE_CODEX_AUTH_FAIL === "1") {
    process.stderr.write("not logged in");
    process.exit(1);
  }
  process.stdout.write("Logged in\\n");
  process.exit(0);
}
if (args[0] === "doctor") process.exit(0);
if (args[0] === "exec" && args[1] === "--help") {
  process.stdout.write("--output-schema --ephemeral --sandbox --model --cd\\n");
  process.exit(0);
}
if (process.env.FAKE_CODEX_RUN_FAIL === "1") {
  process.stderr.write("model entitlement denied");
  process.exit(1);
}
const output = args[args.indexOf("-o") + 1];
const schema = args[args.indexOf("--output-schema") + 1];
fs.writeFileSync(path.join(process.cwd(), "codex-capture.json"), JSON.stringify({
  args, cwd: process.cwd(), changeId: process.env.FOUNDATION_CHANGE_ID,
  schemaRequired: JSON.parse(fs.readFileSync(schema, "utf8")).required
}));
fs.writeFileSync(output, JSON.stringify({
  status: "pass", summary: "independent review passed",
  findings: [], verifiedFindingIds: []
}));
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "thread-fresh" }) + "\\n");
`);
  chmodSync(executable, 0o755);
  const policy = () => ({ review: {
    defaultReviewer: "codex-sol",
    reviewers: { "codex-sol": {
      adapter: "codex-cli", executable,
      providerFamily: "openai", modelFamily: "gpt-5.6",
      modelId: "gpt-5.6-sol", reasoningEffort: "high",
      sandbox: "read-only", ephemeral: true, timeoutMs: 10_000
    } }
  } });
  const runtime = createCodexReviewerRuntime({
    root: fixture, foundationPolicy: policy,
    commandExists: (command) => existsSync(command),
    now: () => "2026-08-14T00:00:00.000Z",
    fail: (message) => { throw new Error(message); }
  });
  const result = runtime.runReview({
    changeId: "v33-review", workspace, packet: { schemaVersion: 4, scope: "full" }
  });
  const capture = JSON.parse(readFileSync(join(workspace, "codex-capture.json"), "utf8"));
  assert.equal(realpathSync(capture.cwd), realpathSync(workspace));
  assert.equal(capture.changeId, "v33-review");
  assert.deepEqual(capture.args.slice(0, 5), ["exec", "-C", workspace, "-m", "gpt-5.6-sol"]);
  assert.equal(capture.args[capture.args.indexOf("-s") + 1], "read-only");
  assert(capture.args.includes("--ephemeral"));
  assert(capture.args.includes('model_reasoning_effort="high"'));
  assert.deepEqual(capture.schemaRequired,
    ["status", "summary", "findings", "verifiedFindingIds"]);
  assert.equal(result.reviewer.sessionId, "thread-fresh");
  assert.equal(result.status, "pass");
  assert(existsSync(join(fixture, result.reportReference)));
  pass("Codex reviewer pins workspace model reasoning read-only ephemeral and schema");

  process.env.FAKE_CODEX_RUN_FAIL = "1";
  const failed = runtime.runReview({
    changeId: "v33-review-error", workspace,
    packet: { schemaVersion: 4, scope: "full" }
  });
  delete process.env.FAKE_CODEX_RUN_FAIL;
  assert.equal(failed.status, "error");
  assert.equal(failed.reviewer.sessionId, null);
  assert.match(failed.summary, /model entitlement denied/);
  assert(existsSync(join(fixture, failed.reportReference)));
  pass("Codex execution failure writes a durable error report without inventing a session");

  process.env.FAKE_CODEX_AUTH_FAIL = "1";
  const auth = runtime.reviewerStatus();
  delete process.env.FAKE_CODEX_AUTH_FAIL;
  assert.equal(auth.ok, false);
  assert.equal(auth.check, "authentication");
  assert.match(auth.detail, /codex login/);
  pass("Codex reviewer reports the exact authentication recovery command");
} finally {
  delete process.env.FAKE_CODEX_AUTH_FAIL;
  delete process.env.FAKE_CODEX_RUN_FAIL;
  rmSync(fixture, { recursive: true, force: true });
}

process.stdout.write("Foundation v3.3 policy tests: PASS\n");
