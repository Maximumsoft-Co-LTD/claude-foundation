// Drift is only worth measuring if the harness derives it. These fixtures pin
// the join from a stored host execution back to the planned tier, and pin that
// every missing link in that chain degrades to "unknown" instead of throwing or
// inventing a finding.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelDriftInspector } from "../../harness/runtime/observability/host-execution-contract.mjs";
import { createMetricsRuntime } from "../../harness/runtime/observability/metrics-runtime.mjs";
import { createChangeValidationRuntime } from "../../harness/runtime/workflow/change-validation.mjs";

let assertions = 0;
function check(actual, expected, message) {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
}

// The real task parser, not a stand-in: task kind drives the blocking decision.
const { taskBlocks, taskMetadata } = createChangeValidationRuntime({});
const policy = {
  models: {
    fast: { family: "haiku", fallbackTier: "standard" },
    standard: { family: "sonnet", fallbackTier: "deep" },
    deep: { family: "opus", fallbackTier: null }
  }
};

const workspace = mkdtempSync(join(tmpdir(), "foundation-drift-join-"));
const logs = join(workspace, "logs");
const manifests = join(workspace, "manifests");
const changes = join(workspace, "changes");
const CHANGE = "drift-change";
const CLEAN = "clean-change";
const activeChangePath = (id) => join(changes, id);

function writeFixture(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

function manifest(scope, requestedModel, digest) {
  writeFixture(join(manifests, CHANGE, `build-${scope}.json`), {
    schemaVersion: 1, manifestDigest: digest,
    dispatch: { command: "build" },
    execution: { skills: [], requestedModel, actualModel: null }
  });
}

function execution(dispatchId, value) {
  writeFixture(join(logs, CHANGE, "host-executions", `${dispatchId}.json`),
    { schemaVersion: 1, dispatchId, ...value });
}

try {
  writeFixture(join(changes, CHANGE, "tasks.md"), [
    "## 1. Work",
    "- [ ] T001 implement the thing [kind:implementation]",
    "- [ ] T002 harden the auth boundary [kind:security]",
    "- [ ] T003 implement the other thing [kind:implementation]",
    "- [ ] T005 review the contract [kind:review]",
    "- [ ] T006 wire the thing [kind:implementation]",
    ""
  ].join("\n"));

  // Distinct digests per planned tier, plus one digest shared by two task-scoped
  // manifests: the manifest body covers the tier, never the scope it was written
  // for, so sibling tasks on the same tier are genuinely indistinguishable.
  manifest("T001", "standard", "sha256:standard-a");
  manifest("T002", "deep", "sha256:deep-a");
  manifest("T003", "standard", "sha256:standard-b");
  manifest("T404", "deep", "sha256:ghost");
  manifest("T005", "deep", "sha256:shared");
  manifest("T006", "deep", "sha256:shared");
  manifest("plan", null, "sha256:plan");
  writeFixture(join(manifests, CHANGE, "build-broken.json"), "{ not json");

  execution("e01", {
    instructionManifestDigest: "sha256:standard-a", actualModel: "claude-sonnet-5"
  });
  execution("e02", {
    instructionManifestDigest: "sha256:deep-a", actualModel: "claude-haiku-4-5-20251001",
    // A host grading its own run must not be able to clear the finding.
    drift: { kind: "match", blocking: false }, driftKind: "match"
  });
  execution("e03", {
    instructionManifestDigest: "sha256:standard-b", actualModel: "claude-haiku-4-5-20251001"
  });
  execution("e04", {
    instructionManifestDigest: "sha256:plan", actualModel: "claude-opus-5"
  });
  execution("e05", { actualModel: "claude-opus-5" });
  execution("e06", {
    instructionManifestDigest: "sha256:absent", actualModel: "claude-haiku-4-5-20251001"
  });
  execution("e07", {
    instructionManifestDigest: "sha256:ghost", actualModel: "claude-haiku-4-5-20251001"
  });
  execution("e08", {
    instructionManifestDigest: "sha256:shared", actualModel: "claude-haiku-4-5-20251001"
  });
  execution("e09", {
    instructionManifestDigest: "sha256:deep-a", actualModel: "claude-opus-5",
    attempts: [
      { attempt: 1, model: "claude-haiku-4-5-20251001", status: "failed" },
      { attempt: 2, model: "claude-opus-5", status: "completed" }
    ]
  });
  writeFixture(join(logs, CHANGE, "host-executions", "e10.json"), "{ not json");
  writeFixture(join(changes, CLEAN, "tasks.md"), "- [ ] T001 safe work [kind:implementation]\n");

  const inspector = createModelDriftInspector({
    logs, instructionManifests: manifests, activeChangePath, policy, taskBlocks, taskMetadata
  });
  const rows = inspector.driftRows(CHANGE);
  const row = (dispatchId, attempt = null) => rows.find((candidate) =>
    candidate.dispatchId === dispatchId && candidate.attempt === attempt);

  check(rows.length, 10, "one row per attempt, corrupt execution skipped");

  check(row("e01").kind, "match", "matching digest and family is a match");
  check(row("e01").taskId, "T001", "the manifest scope segment is the task id");
  check(row("e01").taskKind, "implementation", "task kind is read from tasks.md");
  check(row("e01").blocking, false, "a match never blocks");
  check(row("e01").provenance, "task", "a resolved task scope is reported as such");

  check(row("e02").kind, "downgrade", "deep planned, haiku run is a downgrade");
  check(row("e02").blocking, true, "a downgrade on a security task blocks");
  check(row("e02").taskKind, "security", "the blocking task kind is carried");
  check(row("e02").requestedTier, "deep", "the planned tier comes from the manifest");
  check(row("e02").actualModel, "claude-haiku-4-5-20251001", "the actual model is carried");
  check(Object.keys(row("e02")).some((key) => /drift/i.test(key)), false,
    "no host-supplied drift field survives into the derived row");

  check(row("e03").kind, "downgrade", "standard planned, haiku run is a downgrade");
  check(row("e03").blocking, false, "a downgrade on an implementation task does not block");

  check(row("e04").kind, "unknown", "the plan-scope manifest has no single tier");
  check(row("e04").blocking, false, "a plan-scope execution is not a finding");
  check(row("e04").provenance, "non-task-scope", "plan scope is not a task scope");

  check(row("e05").kind, "unknown", "an execution without a digest cannot be joined");
  check(row("e05").provenance, "no-digest", "the missing link is named");
  check(row("e06").kind, "unknown", "a digest with no manifest cannot be joined");
  check(row("e06").provenance, "no-manifest", "the missing link is named");

  check(row("e07").kind, "downgrade", "an unknown task still classifies the drift");
  check(row("e07").taskKind, null, "a task absent from tasks.md has no kind");
  check(row("e07").blocking, false, "an unknown task kind cannot block");

  check(row("e08").kind, "downgrade", "a shared digest still classifies the drift");
  check(row("e08").taskId, null, "an ambiguous scope names no single task");
  check(row("e08").ambiguousTasks, ["T005", "T006"], "both candidates are reported");
  check(row("e08").blocking, true, "an ambiguous downgrade blocks if any candidate is risk-sensitive");
  check(row("e08").blockingTasks, ["T005"], "the risk-sensitive candidate is named");

  check(row("e09", 1).kind, "downgrade", "a failed first attempt is classified on its own model");
  check(row("e09", 1).blocking, true, "a mid-run downgrade is not hidden by the final model");
  check(row("e09", 2).kind, "match", "the succeeding attempt matches");

  const summary = inspector.changeDrift(CHANGE);
  check(summary.byKind, { match: 2, fallback: 0, upgrade: 0, downgrade: 5, unknown: 3 },
    "counts cover every drift kind");
  check(summary.attempts, 10, "attempts are counted, not executions");
  check(summary.executions, 9, "distinct dispatch ids are counted");
  check(summary.blocking.length, 3, "the blocking findings are surfaced");
  check(summary.downgrades.length, 5, "non-blocking downgrades stay visible");
  check(summary.byProvenance["no-manifest"], 1, "provenance gaps are counted");
  check(summary.unknownReasons["actual model not reported"], undefined,
    "every fixture reported a model");

  check(inspector.blockingDrift(CHANGE).map((finding) => finding.dispatchId),
    ["e02", "e08", "e09"], "the gate input lists only blocking findings");
  check(inspector.blockingDrift(CLEAN), [], "a change with no executions is clean");

  // Degradation: every join input can be absent on a minimal install.
  const bare = createModelDriftInspector();
  check(bare.blockingDrift(CHANGE), [], "an unwired inspector blocks nothing");
  check(bare.changeDrift(CHANGE).byKind.unknown, 0, "an unwired inspector reads no executions");

  const noProvenance = createModelDriftInspector({ logs });
  check(noProvenance.changeDrift(CHANGE).byKind,
    { match: 0, fallback: 0, upgrade: 0, downgrade: 0, unknown: 10 },
    "without manifests or policy every attempt is unknown");
  check(noProvenance.changeDrift(CHANGE).unknownReasons["model policy unavailable"], 10,
    "the reason names the absent policy");
  check(noProvenance.blockingDrift(CHANGE), [], "unknown never reaches the gate");

  const hostilePolicy = createModelDriftInspector({
    logs, instructionManifests: manifests, policy: () => { throw new Error("no config"); },
    activeChangePath: () => { throw new Error("archived"); }, taskBlocks, taskMetadata
  });
  check(hostilePolicy.changeDrift(CHANGE).byKind.unknown, 10,
    "a throwing policy degrades instead of propagating");
  check(hostilePolicy.blockingDrift(CHANGE), [], "a throwing change path degrades to no findings");

  // Requirement: the metrics surface carries the derived summary.
  const emitted = [];
  const { showMetrics } = createMetricsRuntime({
    logs, receipts: join(workspace, "receipts"),
    readJson: (path, fallback = {}) => fallback,
    readJsonLines: () => [],
    readJsonLinesTolerant: () => [],
    loadRuntime: () => ({}),
    ensureBudgetState: () => ({ lifetime: {}, window: {} }),
    budgetDecision: () => "unknown",
    instructionManifests: manifests, activeChangePath, policy, taskBlocks, taskMetadata,
    output: (line) => emitted.push(line)
  });
  showMetrics(CHANGE);
  const metrics = JSON.parse(emitted.at(-1));
  check(metrics.modelDrift.byKind.downgrade, 5, "metrics report drift counts");
  check(metrics.modelDrift.blocking.length, 3, "metrics report blocking findings");
  check(metrics.modelDrift.blocking[0].taskKind, "security",
    "a human can see which task kind was downgraded");
  check(metrics.modelDrift.measurement, "derived-from-instruction-manifest-join",
    "the metrics surface states that drift is derived");

  // Last, because it removes the ledger the cases above depend on: an archived
  // or edited tasks.md leaves the drift classified but unattributable.
  rmSync(join(changes, CHANGE, "tasks.md"));
  check(inspector.blockingDrift(CHANGE), [], "no tasks.md means no task kind and no block");
  check(inspector.changeDrift(CHANGE).byKind.downgrade, 5,
    "drift is still classified without tasks.md");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log(`model drift join: ALL PASS (${assertions}/${assertions} assertions)`);
