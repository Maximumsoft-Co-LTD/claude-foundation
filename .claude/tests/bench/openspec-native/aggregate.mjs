#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BENCH_ARMS, DEFAULT_ARM } from "./scorecard.mjs";

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

// Unknown stays unknown: null when no run measured the value.
function sum(values) {
  const measured = values.filter(Number.isFinite);
  return measured.length ? measured.reduce((total, value) => total + value, 0) : null;
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
      // Rows written before arms existed are Change Loop rows.
      const arm = manifest.arm || scorecard?.arm || DEFAULT_ARM;
      return { runDir, manifest, scorecard, arm };
    }).filter(Boolean);
}

// One aggregate row per (scenario, arm). Several result roots can be read at
// once so arms collected in separate runs compare side by side.
export function aggregateLabRuns(root, source = null) {
  const groups = new Map();
  const roots = Array.isArray(root) ? root : [root];
  const rowsForSource = roots.flatMap((path) => runRows(resolve(path))).filter((row) =>
    !source || (
      row.manifest.source?.commit === source.commit &&
      row.manifest.source?.patchDigest === source.patchDigest));
  for (const row of rowsForSource) {
    const key = `${row.manifest.scenario}\0${row.arm}`;
    if (!groups.has(key)) groups.set(key, { scenario: row.manifest.scenario, arm: row.arm, rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].sort((left, right) =>
    left.scenario.localeCompare(right.scenario) ||
      BENCH_ARMS.indexOf(left.arm) - BENCH_ARMS.indexOf(right.arm))
    .map(({ scenario, arm, rows }) => {
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
        arm,
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
        medianOracleScore: median(rows.map((row) => row.scorecard?.oracle?.score)),
        oracleMax: rows.some((row) => Number.isFinite(row.scorecard?.oracle?.max))
          ? Math.max(...rows.map((row) => row.scorecard?.oracle?.max).filter(Number.isFinite))
          : null,
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
        // A host stopped before its result envelope reports only partial cost.
        partialCostRuns: rows.filter((row) =>
          row.scorecard?.usage?.costMeasurement === "partial").length,
        medianModelRequests: median(rows.map((row) => row.scorecard?.usage?.modelRequests)),
        p95ModelRequests: percentile(rows.map((row) =>
          row.scorecard?.usage?.modelRequests), 0.95),
        medianToolCalls: median(rows.map((row) =>
          row.scorecard?.operations?.hostToolCalls?.total)),
        medianOperations: median(rows.map((row) => row.scorecard?.operations?.total)),
        p95Operations: percentile(rows.map((row) => row.scorecard?.operations?.total), 0.95),
        medianResumptions: median(rows.map((row) =>
          row.scorecard?.evidenceReuse?.resumptions)),
        p95Resumptions: percentile(rows.map((row) =>
          row.scorecard?.evidenceReuse?.resumptions), 0.95),
        // Friction the harness put on the agent. The target for a normal run
        // is zero hook refusals; prompts are host approvals the agent waited on.
        hookBlocks: sum(rows.map((row) => row.scorecard?.friction?.hookBlocks)),
        permissionPrompts: sum(rows.map((row) => row.scorecard?.friction?.permissionPrompts)),
        medianToolErrors: median(rows.map((row) => row.scorecard?.friction?.toolErrors)),
        askUserActions: sum(rows.map((row) => row.scorecard?.friction?.advanceActions?.ASK_USER)),
        repairActions: sum(rows.map((row) => row.scorecard?.friction?.advanceActions?.REPAIR)),
        measurements: {
          friction: measurement(rows.map((row) => row.scorecard?.friction?.toolErrors)),
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

function armSummary(row) {
  if (!row) return null;
  return {
    runs: row.runs,
    strictPasses: row.strictPasses,
    oraclePasses: row.oraclePasses,
    medianOracleScore: row.medianOracleScore,
    oracleMax: row.oracleMax,
    medianCostUsd: row.medianCostUsd,
    partialCostRuns: row.partialCostRuns,
    medianWallMs: row.medianWallMs,
    medianModelRequests: row.medianModelRequests,
    medianToolCalls: row.medianToolCalls,
    permissionPrompts: row.permissionPrompts,
    hookBlocks: row.hookBlocks,
    askUserActions: row.askUserActions
  };
}

function difference(left, right) {
  return Number.isFinite(left) && Number.isFinite(right)
    ? Number((left - right).toFixed(6)) : null;
}

// Pairwise per scenario: Change Loop against the no-harness baseline. A
// missing arm stays null; a delta exists only when both sides measured it.
export function compareArms(aggregates) {
  const scenarios = [...new Set(aggregates.map((row) => row.scenario))].sort();
  return scenarios.map((scenario) => {
    const find = (arm) => aggregates.find((row) => row.scenario === scenario &&
      (row.arm || DEFAULT_ARM) === arm) || null;
    const changeLoop = armSummary(find("change-loop"));
    const baseline = armSummary(find("baseline"));
    return {
      version: 1,
      protocol: "foundation-openspec-native-arm-comparison-v1",
      scenario,
      changeLoop,
      baseline,
      delta: changeLoop && baseline ? {
        oraclePasses: difference(changeLoop.oraclePasses / changeLoop.runs,
          baseline.oraclePasses / baseline.runs),
        medianOracleScore: difference(changeLoop.medianOracleScore, baseline.medianOracleScore),
        medianCostUsd: difference(changeLoop.medianCostUsd, baseline.medianCostUsd),
        medianWallMs: difference(changeLoop.medianWallMs, baseline.medianWallMs),
        medianModelRequests: difference(changeLoop.medianModelRequests,
          baseline.medianModelRequests),
        medianToolCalls: difference(changeLoop.medianToolCalls, baseline.medianToolCalls),
        permissionPrompts: difference(changeLoop.permissionPrompts, baseline.permissionPrompts)
      } : null
    };
  });
}

function cell(summary, render) {
  return summary ? render(summary) : "-";
}

function shown(value, format = (number) => String(number)) {
  return Number.isFinite(value) ? format(value) : "n/a";
}

export function formatArmComparison(rows) {
  const oracle = (summary) => `${summary.oraclePasses}/${summary.runs} (${
    shown(summary.medianOracleScore)}/${shown(summary.oracleMax)})`;
  const cost = (summary) => `${shown(summary.medianCostUsd, (value) => `$${value.toFixed(4)}`)}${
    summary.partialCostRuns ? "*" : ""}`;
  const wall = (summary) => shown(summary.medianWallMs, (value) => `${(value / 1000).toFixed(1)}s`);
  const lines = [
    "| scenario | oracle CL | oracle base | cost CL | cost base | wall CL | wall base | requests CL | requests base | tools CL | tools base | prompts CL | prompts base |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|"
  ];
  for (const row of rows) {
    const { changeLoop: cl, baseline: base } = row;
    lines.push(`| ${row.scenario} | ${cell(cl, oracle)} | ${cell(base, oracle)} | ${
      cell(cl, cost)} | ${cell(base, cost)} | ${cell(cl, wall)} | ${cell(base, wall)} | ${
      cell(cl, (s) => shown(s.medianModelRequests))} | ${
      cell(base, (s) => shown(s.medianModelRequests))} | ${
      cell(cl, (s) => shown(s.medianToolCalls))} | ${cell(base, (s) => shown(s.medianToolCalls))} | ${
      cell(cl, (s) => shown(s.permissionPrompts))} | ${
      cell(base, (s) => shown(s.permissionPrompts))} |`);
  }
  if (rows.some((row) => row.changeLoop?.partialCostRuns || row.baseline?.partialCostRuns))
    lines.push("", "\\* at least one run reported partial cost (host stopped before its result envelope).");
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const mode = argv.includes("--compare") ? "table"
    : argv.includes("--compare-json") ? "json" : "aggregate";
  const roots = argv.filter((value) => !value.startsWith("--"));
  if (!roots.length) {
    process.stderr.write(
      "usage: aggregate.mjs <lab-results-directory>... [--compare | --compare-json]\n");
    process.exitCode = 2;
  } else if (mode === "aggregate") {
    const result = aggregateLabRuns(roots);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.some((row) => !row.strictPass)) process.exitCode = 1;
  } else {
    const comparison = compareArms(aggregateLabRuns(roots));
    process.stdout.write(mode === "json" ? `${JSON.stringify(comparison, null, 2)}\n`
      : formatArmComparison(comparison));
  }
}
