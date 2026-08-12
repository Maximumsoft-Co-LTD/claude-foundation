// A gate is only a gate if it refuses. The classifier and the manifest join are
// pinned elsewhere; what nothing covered is the seam itself — that landCheck
// consults the drift inspector and stops Land on a proven downgrade, and that it
// stays out of the way in every other case. These fixtures drive the real
// createModelDriftInspector through the real createLandRuntime rather than
// stubbing blockingDrift, so the wiring foundation.mjs performs is what is under
// test, not a restatement of it.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelDriftInspector } from "../../harness/runtime/observability/host-execution-contract.mjs";
import { createLandRuntime } from "../../harness/runtime/workflow/land-runtime.mjs";
import { createChangeValidationRuntime } from "../../harness/runtime/workflow/change-validation.mjs";

let assertions = 0;
function check(actual, expected, message) {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
}
function matches(value, pattern, message) {
  assertions += 1;
  assert.match(value, pattern, message);
}

// The real task parser: task kind is what decides blocking, so a stand-in here
// would let the gate pass on a ledger the harness itself cannot read.
const { taskBlocks, taskMetadata } = createChangeValidationRuntime({});
const policy = {
  models: {
    fast: { family: "haiku", fallbackTier: "standard" },
    standard: { family: "sonnet", fallbackTier: "deep" },
    deep: { family: "opus", fallbackTier: null }
  }
};
const HAIKU = "claude-haiku-4-5-20251001";
const OPUS = "claude-opus-5";
const HASH = "workspacehash0000000000000000000000000000000000000000000000000000";

const workspace = mkdtempSync(join(tmpdir(), "foundation-drift-gate-"));
const logs = join(workspace, "logs");
const manifestRoot = join(workspace, "manifests");
const changes = join(workspace, "changes");
const proofs = join(workspace, "proofs");
const bin = join(workspace, "bin");
const activeChangePath = (id) => join(changes, id);
const proofPath = (id) => join(proofs, `${id}.json`);
const originalPath = process.env.PATH;

function writeFixture(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

// Every scenario is a complete, otherwise-landable change: passing proof, fresh
// workspace hash, no receipts required. The only variable is the drift evidence,
// so a refusal can only have come from the drift gate.
function scenario({ id, tasks, manifests = [], executions = [] }) {
  writeFixture(join(changes, id, "tasks.md"), `${tasks.join("\n")}\n`);
  for (const [scope, requestedModel, digest] of manifests)
    writeFixture(join(manifestRoot, id, `build-${scope}.json`), {
      schemaVersion: 1, manifestDigest: digest,
      dispatch: { command: "build" },
      execution: { skills: [], requestedModel, actualModel: null }
    });
  for (const [dispatchId, value] of executions)
    writeFixture(join(logs, id, "host-executions", `${dispatchId}.json`),
      { schemaVersion: 1, dispatchId, ...value });
  writeFixture(proofPath(id), {
    proofRunId: `${id}-proof`, status: "pass", workspaceHash: HASH, receipts: []
  });
  return id;
}

function landRuntime(overrides = {}) {
  return createLandRuntime({
    root: workspace,
    loadRuntime: (id) => ({ id, status: "proven" }),
    pendingApplyTransactions: () => [],
    recoverPendingApply: () => {},
    assertNoDroppedScenarios: () => {},
    proofPath,
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    proofAudit: () => ({ valid: true }),
    clearSnapshotCache: () => {},
    relevantHash: () => HASH,
    requiredProviders: () => [],
    fail: (message) => {
      throw new Error(message);
    },
    ...overrides
  });
}

/** Run landCheck with stdout captured: landed=true means the gate let it through. */
function land(runtime, id) {
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    runtime.landCheck(id);
    return { landed: true, threw: false, error: null, errorName: null, log: lines.join("\n") };
  } catch (error) {
    return {
      landed: false, threw: true, error: error.message,
      errorName: error.constructor.name, log: lines.join("\n")
    };
  } finally {
    console.log = originalLog;
  }
}

try {
  // landCheck probes the OpenSpec CLI before it reaches the drift gate. A fake
  // on a reduced PATH keeps that upstream guard satisfied without depending on
  // an installed CLI.
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "openspec"), "#!/bin/sh\nprintf '1.7.0\\n'\n");
  chmodSync(join(bin, "openspec"), 0o755);
  process.env.PATH = bin;

  const BLOCKED = scenario({
    id: "blocked-security",
    tasks: ["## 1. Work", "- [ ] T001 harden the auth boundary [kind:security]"],
    manifests: [["T001", "deep", "sha256:deep-security"]],
    executions: [["e01", { instructionManifestDigest: "sha256:deep-security", actualModel: HAIKU }]]
  });
  const UNBLOCKED = scenario({
    id: "unblocked-implementation",
    tasks: ["## 1. Work", "- [ ] T001 implement the thing [kind:implementation]"],
    manifests: [["T001", "deep", "sha256:deep-implementation"]],
    executions: [["e01", {
      instructionManifestDigest: "sha256:deep-implementation", actualModel: HAIKU
    }]]
  });
  const UNREPORTED = scenario({
    id: "unreported-model",
    tasks: ["## 1. Work", "- [ ] T001 harden the auth boundary [kind:security]"],
    manifests: [["T001", "deep", "sha256:deep-unreported"]],
    // No actualModel field at all: the shape every host produced before drift
    // reporting existed.
    executions: [["e01", { instructionManifestDigest: "sha256:deep-unreported" }]]
  });
  const SILENT = scenario({
    id: "no-executions",
    tasks: ["## 1. Work", "- [ ] T001 harden the auth boundary [kind:security]"],
    manifests: [["T001", "deep", "sha256:deep-silent"]]
  });
  const MATCHED = scenario({
    id: "matched-tier",
    tasks: ["## 1. Work", "- [ ] T001 harden the auth boundary [kind:security]"],
    manifests: [["T001", "deep", "sha256:deep-matched"]],
    executions: [["e01", { instructionManifestDigest: "sha256:deep-matched", actualModel: OPUS }]]
  });
  const FALLBACK = scenario({
    id: "declared-fallback",
    tasks: ["## 1. Work", "- [ ] T001 change the published contract [kind:contract]"],
    manifests: [["T001", "standard", "sha256:standard-fallback"]],
    executions: [["e01", {
      instructionManifestDigest: "sha256:standard-fallback", actualModel: OPUS
    }]]
  });
  // The manifest digest covers instruction content and requested tier but not the
  // scope, so two tasks planned at the same tier are indistinguishable from the
  // execution alone. The gate must refuse when any candidate is risk-sensitive.
  const AMBIGUOUS = scenario({
    id: "ambiguous-scope",
    tasks: [
      "## 1. Work",
      "- [ ] T101 review the migration plan [kind:review]",
      "- [ ] T102 implement the thing [kind:implementation]"
    ],
    manifests: [["T101", "deep", "sha256:shared"], ["T102", "deep", "sha256:shared"]],
    executions: [["e01", { instructionManifestDigest: "sha256:shared", actualModel: HAIKU }]]
  });

  const inspector = createModelDriftInspector({
    logs, instructionManifests: manifestRoot, activeChangePath, policy, taskBlocks, taskMetadata
  });
  const gated = landRuntime({ blockingDrift: (id) => inspector.blockingDrift(id) });

  // 1. A proven downgrade on a risk-sensitive task stops Land.
  const blocked = land(gated, BLOCKED);
  check(blocked.landed, false, "a downgrade on a security task refuses Land");
  matches(blocked.error, /model tier downgrade on risk-sensitive task/,
    "the refusal names the reason a human can act on");
  matches(blocked.error, /T001/, "the refusal names the task");
  matches(blocked.error, /security/, "the refusal names the risk-sensitive kind");
  matches(blocked.error, /requested deep/, "the refusal names the planned tier");
  matches(blocked.error, new RegExp(`ran ${HAIKU.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    "the refusal names the model that actually ran");
  check(blocked.log.includes("LAND READY"), false, "a refused change is never announced ready");

  // 2. The same downgrade on a task kind the policy does not protect.
  const unblocked = land(gated, UNBLOCKED);
  check(unblocked.landed, true, "an identical downgrade on an implementation task lands");
  matches(unblocked.log, /LAND READY unblocked-implementation/,
    "the unblocked change reaches the ready announcement");
  check(inspector.driftRows(UNBLOCKED)[0].kind, "downgrade",
    "the drift is still classified — it is the task kind, not the drift, that permits it");

  // 3. Backward compatibility: a host that never reported a model must still land.
  const unreported = land(gated, UNREPORTED);
  check(unreported.landed, true,
    "a host that reports no model at all still lands even on a security task");
  check(inspector.driftRows(UNREPORTED)[0].kind, "unknown",
    "an unreported model classifies as unknown, never as a downgrade");
  check(inspector.driftRows(UNREPORTED)[0].reason, "actual model not reported",
    "the unknown reason names the absent report rather than inventing a finding");

  // 4. No host executions recorded at all.
  const silent = land(gated, SILENT);
  check(silent.landed, true, "a change with no recorded executions lands");
  check(inspector.blockingDrift(SILENT), [], "no executions means no findings to answer for");

  // 5. The planned tier ran as planned.
  check(land(gated, MATCHED).landed, true, "a matching tier lands");
  check(inspector.driftRows(MATCHED)[0].kind, "match", "deep planned and opus run is a match");

  // A declared fallback is sanctioned by policy and must not be read as a downgrade.
  check(land(gated, FALLBACK).landed, true, "a declared fallback lands on a contract task");
  check(inspector.driftRows(FALLBACK)[0].kind, "fallback", "the declared hop is a fallback");

  // 6. Ambiguous attribution fails closed.
  const ambiguous = land(gated, AMBIGUOUS);
  check(ambiguous.landed, false,
    "an ambiguous downgrade refuses Land when any candidate is risk-sensitive");
  matches(ambiguous.error, /T101/, "the risk-sensitive candidate is named in the refusal");
  matches(ambiguous.error, /\(ambiguous\)/,
    "the refusal states the attribution is ambiguous rather than asserting one task");
  check(inspector.blockingDrift(AMBIGUOUS)[0].blockingTasks, ["T101"],
    "only the risk-sensitive candidate is reported as blocking");
  check(inspector.blockingDrift(AMBIGUOUS)[0].taskId, null,
    "an ambiguous finding claims no single task");

  // Control: the same fixture with an explicitly permissive gate lands. This is
  // what proves case 1 refuses for the gate's reason and not because some
  // unrelated Land guard rejected the fixture.
  const permissive = landRuntime({ blockingDrift: () => [] });
  const control = land(permissive, BLOCKED);
  check(control.landed, true, "a permissive gate lands the blocking fixture");
  matches(control.log, /LAND READY blocked-security/,
    "the blocking fixture is otherwise fully landable — only the gate stops it");

  // The gate must not be silently omittable. blockingDrift is a required
  // dependency: a caller that stops passing it gets a loud failure at Land rather
  // than a Land that quietly stopped checking. Note this throws when landCheck
  // reaches the gate, not when the runtime is constructed — an absent key
  // destructures to undefined, so the refusal is fail-at-use, not fail-at-wiring.
  const omitted = land(landRuntime(), BLOCKED);
  check(omitted.threw, true, "a Land runtime built without blockingDrift throws at the gate");
  check(omitted.landed, false, "an omitted gate never yields a clean land");
  check(omitted.log.includes("LAND READY"), false,
    "an omitted gate announces no readiness before it fails");

  // Distinct from the case above: the gate IS wired, but its inspector has no
  // join inputs to read. Missing evidence must degrade to no findings rather than
  // becoming a veto that no change can clear.
  const bareInspectorGate = landRuntime({
    blockingDrift: (id) => createModelDriftInspector().blockingDrift(id)
  });
  const bare = land(bareInspectorGate, BLOCKED);
  check(bare.landed, true, "a wired gate whose inspector has no join inputs finds nothing");
  check(bare.threw, false, "missing join inputs degrade quietly rather than throwing");
} finally {
  process.env.PATH = originalPath;
  rmSync(workspace, { recursive: true, force: true });
}

console.log(`model drift land gate: ALL PASS (${assertions}/${assertions} assertions)`);
