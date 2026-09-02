#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function median(values) {
  const measured = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!measured.length) return null;
  const middle = Math.floor(measured.length / 2);
  return measured.length % 2 ? measured[middle]
    : Number(((measured[middle - 1] + measured[middle]) / 2).toFixed(6));
}

function percentile(values, fraction) {
  const measured = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!measured.length) return null;
  return measured[Math.max(0, Math.ceil(fraction * measured.length) - 1)];
}

function measurement(values) {
  const measured = values.filter(Number.isFinite).length;
  return { measured, unavailable: values.length - measured };
}

function runRows(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .map((entry) => {
      const runDir = join(root, entry.name);
      const manifest = readJson(join(runDir, "manifest.json"));
      if (!manifest) return null;
      const scorecard = readJson(join(runDir, "openspec-native-runs",
        manifest.runId, "scorecard.json"));
      return { runDir, manifest, scorecard };
    }).filter(Boolean);
}

export function aggregateLabRuns(root, source = null) {
  const groups = new Map();
  const rowsForSource = runRows(resolve(root)).filter((row) => !source || (
    row.manifest.source?.commit === source.commit &&
    row.manifest.source?.patchDigest === source.patchDigest));
  for (const row of rowsForSource) {
    const scenario = row.manifest.scenario;
    if (!groups.has(scenario)) groups.set(scenario, []);
    groups.get(scenario).push(row);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([scenario, rows]) => {
      const strictPasses = rows.filter((row) => row.manifest.strictPass === true &&
        row.scorecard?.outcome?.complete === true &&
        (row.scorecard?.oracle?.configured !== true || row.scorecard.oracle.verdict === "pass") &&
        !Number(row.scorecard?.quality?.fail || 0)).length;
      const paidModelRows = rows.filter((row) =>
        Number(row.scorecard?.usage?.modelRequests) > 0);
      const paidModelStrictPasses = paidModelRows.filter((row) =>
        row.manifest.strictPass === true && row.scorecard?.outcome?.complete === true &&
        (row.scorecard?.oracle?.configured !== true || row.scorecard.oracle.verdict === "pass") &&
        !Number(row.scorecard?.quality?.fail || 0)).length;
      return {
        version: 1,
        scenario,
        runs: rows.length,
        strictPasses,
        paidModelRuns: paidModelRows.length,
        paidModelStrictPasses,
        paidModelStrictPass: paidModelRows.length > 0 &&
          paidModelStrictPasses === paidModelRows.length,
        strictPass: strictPasses === rows.length,
        reliabilityRate: rows.length
          ? Number((strictPasses / rows.length).toFixed(6)) : null,
        lifecycle: Object.fromEntries(rows.map((row) => [row.manifest.runId,
          row.scorecard?.outcome?.status || "unavailable"])),
        oraclePasses: rows.filter((row) => row.scorecard?.oracle?.verdict === "pass").length,
        projectCommandPasses: rows.filter((row) =>
          row.manifest.verification?.projectCommand?.status === "pass").length,
        cleanInstallPasses: rows.filter((row) =>
          ["pass", "not-applicable"].includes(row.manifest.verification?.cleanInstall?.status) &&
          ["pass", "not-applicable"].includes(
            row.manifest.verification?.cleanInstallProjectCommand?.status)).length,
        medianWallMs: median(rows.map((row) => row.scorecard?.timing?.wallMs)),
        p95WallMs: percentile(rows.map((row) => row.scorecard?.timing?.wallMs), 0.95),
        medianCostUsd: median(rows.map((row) => row.scorecard?.usage?.costUsd)),
        p95CostUsd: percentile(rows.map((row) => row.scorecard?.usage?.costUsd), 0.95),
        medianModelRequests: median(rows.map((row) => row.scorecard?.usage?.modelRequests)),
        p95ModelRequests: percentile(rows.map((row) =>
          row.scorecard?.usage?.modelRequests), 0.95),
        medianOperations: median(rows.map((row) => row.scorecard?.operations?.total)),
        p95Operations: percentile(rows.map((row) => row.scorecard?.operations?.total), 0.95),
        medianResumptions: median(rows.map((row) =>
          row.scorecard?.evidenceReuse?.resumptions)),
        p95Resumptions: percentile(rows.map((row) =>
          row.scorecard?.evidenceReuse?.resumptions), 0.95),
        measurements: {
          wallMs: measurement(rows.map((row) => row.scorecard?.timing?.wallMs)),
          costUsd: measurement(rows.map((row) => row.scorecard?.usage?.costUsd)),
          modelRequests: measurement(rows.map((row) =>
            row.scorecard?.usage?.modelRequests)),
          operations: measurement(rows.map((row) => row.scorecard?.operations?.total)),
          resumptions: measurement(rows.map((row) =>
            row.scorecard?.evidenceReuse?.resumptions))
        },
        coverageMinimum: rows.some((row) => Number.isFinite(row.scorecard?.quality?.coverageMinimum))
          ? Math.min(...rows.map((row) => row.scorecard?.quality?.coverageMinimum)
            .filter(Number.isFinite)) : null,
        crapMaximum: rows.some((row) => Number.isFinite(row.scorecard?.quality?.crapMaximum))
          ? Math.max(...rows.map((row) => row.scorecard?.quality?.crapMaximum)
            .filter(Number.isFinite)) : null,
        runDirs: rows.map((row) => row.runDir)
      };
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root) {
    process.stderr.write("usage: aggregate.mjs <lab-results-directory>\n");
    process.exitCode = 2;
  } else {
    const result = aggregateLabRuns(root);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.some((row) => !row.strictPass)) process.exitCode = 1;
  }
}
