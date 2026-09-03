import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const FEEDBACK_SCHEMA_VERSION = 2;

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

export function reviewRepairIntervals(operations = [], attempts = []) {
  const dated = (value) => timestamp(value) ?? Number.POSITIVE_INFINITY;
  const orderedOperations = [...operations].sort((left, right) =>
    dated(left.startedAt) - dated(right.startedAt));
  const orderedAttempts = [...attempts].sort((left, right) =>
    dated(left.completedAt || left.timestamp) - dated(right.completedAt || right.timestamp));
  return orderedAttempts.flatMap((attempt, index) => {
    if (attempt.status !== "completed" || attempt.resultStatus !== "fail") return [];
    const findingIds = (attempt.findings || [])
      .filter((finding) => ["blocker", "major"].includes(finding.severity))
      .map((finding) => finding.id).filter(Boolean).sort();
    if (!findingIds.length) return [];
    const laterChanged = orderedAttempts.slice(index + 1).find((candidate) =>
      candidate.status === "completed" && candidate.workspaceHash &&
      candidate.workspaceHash !== attempt.workspaceHash);
    if (!laterChanged) return [];
    const fromMs = timestamp(attempt.completedAt);
    const resumed = orderedOperations.find((operation) =>
      operation.operation === "proof-advance" && timestamp(operation.startedAt) > fromMs);
    const toMs = timestamp(resumed?.startedAt);
    if (fromMs === null || toMs === null || toMs <= fromMs) return [];
    return [{
      kind: "review-repair",
      from: attempt.completedAt,
      to: resumed.startedAt,
      durationMs: toMs - fromMs,
      sourceAttemptDigest: attempt.digest || null,
      findingIds,
      basis: "failed-review-to-proof-resume-with-later-changed-workspace"
    }];
  });
}

export function operationCauseCoverage(operations = []) {
  const blocked = operations.filter((row) => row.status === "blocked");
  return {
    blocked: blocked.length,
    typed: blocked.filter((row) => row.blocker?.code).length,
    legacyUnavailable: blocked.filter((row) =>
      Number(row.version || 0) < 3 && !row.blocker?.code).length,
    untypedCurrent: blocked.filter((row) =>
      Number(row.version || 0) >= 3 && !row.blocker?.code).length
  };
}

export function feedbackSnapshotValue({
  changeId, metrics, operations = [], inspections = [], reviewAttempts = [], nextAction
}) {
  const repairIntervals = reviewRepairIntervals(operations, reviewAttempts);
  const repairMs = repairIntervals.reduce((sum, row) => sum + row.durationMs, 0);
  const humanWaitMs = metrics.humanWaitMs ?? 0;
  return {
    version: FEEDBACK_SCHEMA_VERSION,
    changeId,
    sourceCohort: metrics.sourceCohort || null,
    timing: {
      wallTimeMs: metrics.wallTimeMs ?? null,
      activeTimeMs: metrics.activeTimeMs ?? null,
      reviewerExecutionMs: reviewAttempts.reduce((sum, row) => {
        const from = timestamp(row.timestamp);
        const to = timestamp(row.completedAt);
        return sum + (from !== null && to !== null && to > from ? to - from : 0);
      }, 0),
      repairMs,
      repairIntervals,
      humanWaitMs: metrics.humanWaitMs ?? null,
      unattributedMs: metrics.unattributedWaitMs === null ||
        metrics.unattributedWaitMs === undefined
        ? null : Math.max(0, metrics.unattributedWaitMs - repairMs - humanWaitMs),
      basis: "operations+review-attempts+verified-human-transitions"
    },
    guards: {
      lifecycle: operationCauseCoverage(operations),
      inspection: operationCauseCoverage(inspections),
      unexpectedFailures: operations.filter((row) => row.status === "failed").length
    },
    evidenceReuse: metrics.evidenceReuse || { count: 0, byReason: {} },
    evidenceObservationGroups: metrics.evidenceObservationGroups || [],
    usageAvailability: metrics.usageAvailability || null,
    nextAction,
    measurement: "read-only-retained-state-projection"
  };
}

export function createFeedbackRuntime({
  logs, evidenceVault, readJson, readJsonLines, metricsValue, nextAction,
  output = console.log
}) {
  function reviewAttempts(id) {
    const directory = join(evidenceVault, id, "review-attempts");
    if (!existsSync(directory)) return [];
    return readdirSync(directory).filter((name) => name.endsWith(".json"))
      .map((name) => readJson(join(directory, name), null)).filter(Boolean);
  }

  function feedbackValue(id) {
    let resolvedNextAction;
    try { resolvedNextAction = nextAction(id); }
    catch {
      resolvedNextAction = {
        version: 1, changeId: id, action: "UNAVAILABLE",
        boundary: "inspection", reason: "next-action-unavailable",
        command: `claude-foundation doctor --change ${id}`
      };
    }
    return feedbackSnapshotValue({
      changeId: id,
      metrics: metricsValue(id),
      operations: readJsonLines(join(logs, id, "operations.jsonl")),
      inspections: readJsonLines(join(logs, id, "inspections.jsonl")),
      reviewAttempts: reviewAttempts(id),
      nextAction: resolvedNextAction
    });
  }

  function showFeedback(id, flags = {}) {
    const value = feedbackValue(id);
    output(JSON.stringify(value, null, flags.pretty ? 2 : 0));
    return value;
  }

  return { feedbackValue, showFeedback };
}
