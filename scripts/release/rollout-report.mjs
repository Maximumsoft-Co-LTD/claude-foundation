#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const POLICY = JSON.parse(readFileSync(
  resolve(ROOT, ".claude/tests/bench/config/rollout-policy.json"), "utf8"));
const FORBIDDEN_KEYS = /(?:prompt|transcript|secret|credential|product.?content|file.?content)/i;
const OBSERVATION_FIELDS = new Set(["protocol", "stage", "release", "startedAt", "endedAt",
  "consumers", "baselineDigest", "rollbackRehearsed", "metrics", "stopConditions",
  "baselineMetrics", "differences", "incidents", "evidence"]);

function forbiddenPaths(value, path = "$") {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(FORBIDDEN_KEYS.test(key) ? [`${path}.${key}`] : []),
    ...forbiddenPaths(child, `${path}.${key}`)
  ]);
}

function validMeasurement(value) {
  return value && typeof value === "object" &&
    Object.keys(value).every((key) => ["value", "availability"].includes(key)) &&
    ["measured", "unavailable"].includes(value.availability) &&
    (value.availability === "unavailable" ? value.value === null :
      Number.isFinite(value.value) && value.value >= 0);
}

export function buildRolloutReport(observation, policy = POLICY) {
  const issues = [];
  if (observation?.protocol !== "foundation-rollout-observation-v1")
    issues.push("invalid-observation-protocol");
  for (const key of Object.keys(observation || {}))
    if (!OBSERVATION_FIELDS.has(key)) issues.push(`unknown-observation-field:${key}`);
  const stage = policy.stages[observation?.stage];
  if (!stage) issues.push("unknown-rollout-stage");
  const privacy = forbiddenPaths(observation);
  if (privacy.length) issues.push("product-content-present");
  const started = Date.parse(observation?.startedAt || "");
  const ended = Date.parse(observation?.endedAt || "");
  const observationHours = Number.isFinite(started) && Number.isFinite(ended) && ended >= started
    ? (ended - started) / 3_600_000 : null;
  if (observationHours === null) issues.push("invalid-observation-window");
  const consumers = observation?.consumers;
  if (!Number.isInteger(consumers) || consumers < 0) issues.push("invalid-consumer-count");
  if (stage && Number.isInteger(consumers) && consumers < stage.minimum_consumers)
    issues.push("insufficient-consumers");
  if (stage && observationHours !== null && observationHours < stage.minimum_observation_hours)
    issues.push("observation-window-incomplete");
  const metrics = observation?.metrics || {};
  const baselineMetrics = observation?.baselineMetrics || {};
  for (const name of policy.metrics)
    if (!validMeasurement(metrics[name])) issues.push(`invalid-metric:${name}`);
  for (const name of policy.metrics)
    if (!validMeasurement(baselineMetrics[name])) issues.push(`invalid-baseline-metric:${name}`);
  for (const name of Object.keys(metrics))
    if (!policy.metrics.includes(name)) issues.push(`unknown-metric:${name}`);
  for (const name of Object.keys(baselineMetrics))
    if (!policy.metrics.includes(name)) issues.push(`unknown-baseline-metric:${name}`);
  const differences = Array.isArray(observation?.differences) ? observation.differences : [];
  for (const row of differences) {
    if (Object.keys(row || {}).some((key) => !["metric", "classification", "evidence"].includes(key)))
      issues.push(`unknown-difference-field:${row?.metric}`);
    if (!policy.metrics.includes(row?.metric)) issues.push(`unknown-difference-metric:${row?.metric}`);
    if (!policy.difference_classifications.includes(row?.classification))
      issues.push(`invalid-difference-classification:${row?.metric}`);
    if (!/^https:\/\//.test(row?.evidence || "")) issues.push(`difference-evidence-missing:${row?.metric}`);
  }
  for (const name of policy.metrics) {
    const current = metrics[name]; const baseline = baselineMetrics[name];
    if (validMeasurement(current) && validMeasurement(baseline) &&
        (current.value !== baseline.value || current.availability !== baseline.availability) &&
        !differences.some((row) => row.metric === name))
      issues.push(`unclassified-baseline-difference:${name}`);
  }
  const stopConditions = observation?.stopConditions || [];
  for (const condition of stopConditions)
    if (!policy.stop_conditions.includes(condition)) issues.push(`unknown-stop-condition:${condition}`);
  if (stopConditions.length) issues.push("rollout-stop-condition-observed");
  if (stage?.rollback_required && observation?.rollbackRehearsed !== true)
    issues.push("rollback-not-rehearsed");
  if (!/^[a-f0-9]{64}$/.test(observation?.baselineDigest || ""))
    issues.push("baseline-not-content-bound");
  const evidence = observation?.evidence || [];
  if (!evidence.length || evidence.some((row) =>
    Object.keys(row || {}).some((key) => !["url", "sha256"].includes(key)) ||
    !/^https:\/\//.test(row?.url || "") || !/^[a-f0-9]{64}$/.test(row?.sha256 || "")))
    issues.push("immutable-evidence-missing");
  const incidents = Array.isArray(observation?.incidents) ? observation.incidents : [];
  for (const incident of incidents) {
    for (const key of Object.keys(incident))
      if (!["id", "severity", "status", ...policy.incident_requirements].includes(key))
        issues.push(`unknown-incident-field:${key}`);
    if (["P0", "P1"].includes(incident.severity) && incident.status !== "resolved")
      issues.push("unresolved-p0-p1-incident");
    for (const field of policy.incident_requirements)
      if (!incident[field]) issues.push(`incident-${field}-missing`);
  }
  const uniqueIssues = [...new Set(issues)];
  const report = {
    version: 1,
    protocol: "foundation-production-validation-report-v1",
    stage: observation?.stage || null,
    release: observation?.release || null,
    observationHours,
    consumers: Number.isInteger(consumers) ? consumers : null,
    metrics: policy.metrics.map((name) => ({ name, ...(metrics[name] || { value: null, availability: "unavailable" }) })),
    differences: differences.map(({ metric, classification, evidence }) =>
      ({ metric, classification, evidence })),
    incidents: incidents.map(({ id, severity, status, reproduction, regression, scenarioDisposition }) =>
      ({ id, severity, status, reproduction, regression, scenarioDisposition })),
    privacy: { productContentRetained: privacy.length > 0, forbiddenPaths: privacy },
    blockers: uniqueIssues,
    status: uniqueIssues.length ? "blocked" : "production-observed"
  };
  return { ...report,
    reportDigest: createHash("sha256").update(JSON.stringify(report)).digest("hex") };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = process.argv[2];
    if (!input) throw new Error("usage: rollout-report.mjs <observation.json>");
    const report = buildRolloutReport(JSON.parse(readFileSync(resolve(input), "utf8")));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== "production-observed") process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
