import assert from "node:assert/strict";
import test from "node:test";

import {
  ADAPTERS, CAPABILITY_ADAPTERS, EVALUATION_PROTOCOL, PROVIDER_CONTRACTS, PROVIDERS,
  capabilityPhase, evaluationResult, isPostReleaseCapability, providerCapability,
  splitPostReleaseProviders
} from "../runtime/evidence/provider-catalog.mjs";
import { evaluationAdapterResult } from "../runtime/evidence/adapter-runtime.mjs";
import {
  discoverMissingEvidence, evidenceCandidateRows
} from "../runtime/evidence/evidence-bootstrap.mjs";

const NEW = ["evaluation", "release-health", "parity", "plan-check", "experiment-guardrail"];

test("catalog contains every new capability with a contract and a known adapter", () => {
  for (const capability of NEW) {
    assert.equal(typeof PROVIDER_CONTRACTS[capability], "string", capability);
    assert.ok(PROVIDER_CONTRACTS[capability].length > 0, capability);
    assert.ok(PROVIDERS.has(capability), capability);
    assert.equal(providerCapability(capability), capability);
    assert.ok(ADAPTERS.has(CAPABILITY_ADAPTERS[capability]), capability);
  }
  for (const capability of ["evaluation", "parity", "plan-check"]) {
    assert.equal(CAPABILITY_ADAPTERS[capability], "command");
    assert.equal(capabilityPhase(capability), "pre-land");
  }
  for (const capability of ["release-health", "experiment-guardrail"]) {
    assert.equal(CAPABILITY_ADAPTERS[capability], "external");
    assert.equal(isPostReleaseCapability(capability), true);
  }
  assert.equal(isPostReleaseCapability("test"), false);
  assert.equal(isPostReleaseCapability("deployment"), false);
});

test("evaluation passes only when score meets the threshold and reports both numbers", () => {
  const pass = evaluationResult({ protocol: EVALUATION_PROTOCOL, score: 0.91, threshold: 0.9 });
  assert.equal(pass.status, "pass");
  assert.equal(evaluationResult({ score: 0.9, threshold: 0.9 }).status, "pass");
  const fail = evaluationResult({ protocol: EVALUATION_PROTOCOL, score: 0.72, threshold: 0.9 });
  assert.deepEqual([fail.status, fail.score, fail.threshold], ["fail", 0.72, 0.9]);
  assert.match(fail.observed, /0\.72.*0\.9/);
  // Provider-level threshold applies when the result omits one.
  assert.equal(evaluationResult({ score: 80 }, { threshold: 75 }).status, "pass");
  assert.equal(evaluationResult({ score: 70 }, { threshold: 75 }).status, "fail");
  // Missing values fail closed.
  assert.equal(evaluationResult({ score: 0.95 }).status, "fail");
  assert.equal(evaluationResult({}).status, "fail");
  assert.equal(evaluationResult(null, { threshold: 1 }).status, "fail");
});

test("evaluation adapter result requires a clean exit and the threshold rule", () => {
  const report = { protocol: EVALUATION_PROTOCOL, score: 0.95, threshold: 0.9 };
  assert.equal(evaluationAdapterResult({ status: 0 }, report).status, "pass");
  const crashed = evaluationAdapterResult({ status: 1 }, report);
  assert.equal(crashed.status, "fail");
  assert.match(crashed.observed, /exited 1/);
  const low = evaluationAdapterResult({ status: 0 }, { score: 0.5, threshold: 0.9 });
  assert.deepEqual([low.status, low.score, low.threshold], ["fail", 0.5, 0.9]);
});

test("post-release capabilities are deferred rollout gates, not blocking requirements", () => {
  const providers = {
    test: { adapter: "command", command: ["npm", "test"] },
    health: { adapter: "external", capability: "release-health" },
    guardrail: { adapter: "external", capability: "experiment-guardrail" },
    evals: { adapter: "command", capability: "evaluation", command: ["npm", "run", "eval"] }
  };
  const split = splitPostReleaseProviders(
    ["evals", "guardrail", "health", "test"], providers);
  assert.deepEqual(split.blocking, ["evals", "test"]);
  assert.deepEqual(split.rolloutGates, [
    { provider: "guardrail", capability: "experiment-guardrail", phase: "post-release",
      status: "deferred", gate: "rollout" },
    { provider: "health", capability: "release-health", phase: "post-release",
      status: "deferred", gate: "rollout" }
  ]);
  // An unconfigured built-in name resolves through the catalog too.
  assert.deepEqual(splitPostReleaseProviders(["release-health"]).blocking, []);
});

test("new pre-Land capabilities discover project scripts by alias", () => {
  const repo = { id: "root", mode: "write", workspacePath: "/root" };
  const tooling = { manager: "npm", dependencies: {},
    scripts: { eval: "node eval.js", parity: "node parity.js", plan: "terraform plan" } };
  for (const capability of ["evaluation", "parity", "plan-check"]) {
    const rows = evidenceCandidateRows(capability, tooling, repo, 1, []);
    assert.equal(rows.length, 1, capability);
    assert.equal(rows[0].config.adapter, "command", capability);
  }
});

test("a missing provider for a new capability yields agent-owned setup", () => {
  const repo = { id: "root", mode: "write", workspacePath: "/root" };
  const result = discoverMissingEvidence({
    missing: NEW, providerConfig: () => null, providerCapability: (name) => name,
    knownProviders: new Set(NEW), repositories: [repo], contract: { claims: [] },
    tooling: new Map([["root", { manager: "npm", dependencies: {}, scripts: {} }]]),
    declaredSurface: []
  });
  assert.equal(result.candidates.length, 0);
  assert.deepEqual(result.unresolved.map((row) => row.capability), NEW);
  for (const row of result.unresolved) {
    assert.equal(row.reason, "no-safe-project-command");
    assert.equal(row.owner, "agent");
    assert.notEqual(row.reason, "external-authority");
    assert.match(row.next, new RegExp(`configure a project-owned ${row.capability}`));
  }
});
