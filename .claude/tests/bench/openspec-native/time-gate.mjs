#!/usr/bin/env node

// Advisory time gate: Change Loop wall time must stay within 1.5x (rapid lane) or 1.8x (standard lane)
// of the same
// task without the harness. Reads scorecards of two arms (rows with
// `arm: "baseline"` against Change Loop rows, which have no arm or
// `arm: "change-loop"`), groups scenarios by lane tier, and fails (exit 2)
// when a tier's median Change Loop wall time exceeds the target ratio times
// the baseline's. Like every paid-run evidence, a missing baseline is a
// visible advisory, never a deterministic CI failure; `--strict` turns it
// into exit 2 for a release decision.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadMatrix } from "./matrix.mjs";

export const TIME_GATE_PROTOCOL = "foundation-time-gate-v1";
export const TIME_GATE_TARGETS = { rapid: 1.5, standard: 1.8 };
export const TIME_GATE_TARGET_RATIO = TIME_GATE_TARGETS.standard;
export const BASELINE_ARM = "baseline";
export const CHANGE_LOOP_ARM = "change-loop";

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function jsonLines(path) {
  try {
    return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)
      .flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  } catch { return []; }
}

function median(values) {
  const known = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!known.length) return null;
  const middle = Math.floor(known.length / 2);
  return known.length % 2 ? known[middle] : (known[middle - 1] + known[middle]) / 2;
}

// Unknown stays unknown: null when nothing measured the value.
function sum(values) {
  const known = values.filter(Number.isFinite);
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
}

function directories(root) {
  return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name));
}

// Rows from a lab results root (run directories holding manifest.json and the
// scorecard), a directory of scorecard.json files, or flat scorecard JSONL.
export function loadScorecardRows(roots) {
  const rows = [];
  const push = (scorecard, manifest = {}) => {
    if (!scorecard?.scenario) return;
    rows.push({
      scenario: manifest.scenario || scorecard.scenario,
      arm: manifest.arm || scorecard.arm || CHANGE_LOOP_ARM,
      lane: manifest.lane || scorecard.lane || scorecard.provenance?.lane || null,
      runId: scorecard.runId || manifest.runId || null,
      scorecard
    });
  };
  for (const root of roots.map((path) => resolve(path)).filter(existsSync)) {
    for (const file of readdirSync(root).filter((name) => name.endsWith(".jsonl")))
      for (const scorecard of jsonLines(join(root, file))) push(scorecard);
    for (const dir of [root, ...directories(root)]) {
      const manifest = readJson(join(dir, "manifest.json")) || {};
      const direct = readJson(join(dir, "scorecard.json"));
      if (direct) push(direct, manifest);
      const runs = join(dir, "openspec-native-runs");
      if (manifest.runId && existsSync(runs))
        push(readJson(join(runs, manifest.runId, "scorecard.json")), manifest);
      else if (existsSync(runs))
        for (const run of directories(runs)) push(readJson(join(run, "scorecard.json")), manifest);
    }
  }
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.arm}\0${row.scenario}\0${row.runId}`;
    if (row.runId && seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The scenario's recorded lane wins; otherwise the matrix risk: low risk runs
// the rapid lane, everything else the standard lane.
export function laneTier(row, riskByScenario = {}) {
  const lane = String(row.lane || "").toLowerCase();
  if (lane.includes("rapid")) return "rapid";
  if (lane.includes("standard")) return "standard";
  return riskByScenario[row.scenario] === "low" ? "rapid" : "standard";
}

function completed(row) {
  return row.scorecard.outcome?.complete === true || row.scorecard.outcome?.status === "completed";
}

function armStats(rows) {
  const wall = rows.map((row) => row.scorecard.timing?.wallMs);
  return {
    runs: rows.length,
    wallMs: median(wall),
    requests: median(rows.map((row) => row.scorecard.usage?.modelRequests)),
    harnessActiveMs: median(rows.map((row) => row.scorecard.timing?.harnessActiveMs)),
    permissionPrompts: sum(rows.map((row) => row.scorecard.friction?.permissionPrompts))
  };
}

export function evaluateTimeGate(rows, {
  targetRatio = null, riskByScenario = {}, includeIncomplete = false
} = {}) {
  const targetFor = (tier) => targetRatio ?? TIME_GATE_TARGETS[tier];
  const usable = rows.filter((row) => includeIncomplete || completed(row))
    .filter((row) => Number.isFinite(row.scorecard.timing?.wallMs));
  const scenarios = [...new Set(rows.map((row) => row.scenario))].sort().map((scenario) => {
    const own = usable.filter((row) => row.scenario === scenario);
    const baseline = armStats(own.filter((row) => row.arm === BASELINE_ARM));
    const changeLoop = armStats(own.filter((row) => row.arm !== BASELINE_ARM));
    const paired = baseline.wallMs !== null && changeLoop.wallMs !== null && baseline.wallMs > 0;
    const laneRow = rows.find((row) => row.scenario === scenario && row.arm !== BASELINE_ARM) ||
      rows.find((row) => row.scenario === scenario);
    return {
      scenario, tier: laneTier(laneRow, riskByScenario), baseline, changeLoop,
      ratio: paired ? Number((changeLoop.wallMs / baseline.wallMs).toFixed(3)) : null,
      overTarget: paired
        ? changeLoop.wallMs > targetFor(laneTier(laneRow, riskByScenario)) * baseline.wallMs : null
    };
  });
  const tiers = ["rapid", "standard"].map((tier) => {
    const pairs = scenarios.filter((row) => row.tier === tier && row.ratio !== null);
    const baselineMedian = median(pairs.map((row) => row.baseline.wallMs));
    const changeLoopMedian = median(pairs.map((row) => row.changeLoop.wallMs));
    return {
      tier, targetRatio: targetFor(tier), pairedScenarios: pairs.length,
      baselineMedianWallMs: baselineMedian, changeLoopMedianWallMs: changeLoopMedian,
      ratio: pairs.length ? Number((changeLoopMedian / baselineMedian).toFixed(3)) : null,
      pass: pairs.length ? changeLoopMedian <= targetFor(tier) * baselineMedian : null
    };
  });
  const measured = tiers.filter((tier) => tier.pass !== null);
  const failed = measured.filter((tier) => !tier.pass);
  const status = failed.length ? "fail" : measured.length ? "pass" : "advisory";
  return {
    version: 1, protocol: TIME_GATE_PROTOCOL, targetRatio: targetRatio ?? TIME_GATE_TARGETS, status,
    reason: failed.length
      ? `Change Loop median wall time exceeds its target ratio in tier ${
        failed.map((tier) => `${tier.tier} (${tier.targetRatio}x)`).join(", ")}`
      : measured.length ? null
        : "no paired baseline and Change Loop runs: collect both arms before judging the target",
    tiers, scenarios
  };
}

export function timeGateReport(roots, options = {}) {
  let riskByScenario = {};
  try {
    riskByScenario = Object.fromEntries(loadMatrix().scenarios.map((row) => [row.id, row.risk]));
  } catch { /* the lane recorded on each row is enough */ }
  return evaluateTimeGate(loadScorecardRows(roots), { riskByScenario, ...options });
}

const cell = (value, digits = 0) => value === null || value === undefined ? "n/a"
  : Number.isInteger(value) ? String(value) : value.toFixed(digits);

export function formatTimeGate(report) {
  const lines = [
    `time gate (advisory): ${report.status.toUpperCase()}, target <= ${typeof report.targetRatio === "object"
      ? Object.entries(report.targetRatio).map(([tier, ratio]) => `${ratio}x ${tier}`).join(" / ")
      : `${report.targetRatio}x`} baseline`,
    ...(report.reason ? [`  ${report.reason}`] : []),
    "scenario | tier | baseline wall ms | change-loop wall ms | ratio | requests | " +
      "harnessActiveMs | permission prompts"
  ];
  for (const row of report.scenarios)
    lines.push([row.scenario, row.tier, cell(row.baseline.wallMs), cell(row.changeLoop.wallMs),
      row.ratio === null ? "n/a" : `${row.ratio}${row.overTarget ? " OVER" : ""}`,
      cell(row.changeLoop.requests), cell(row.changeLoop.harnessActiveMs),
      cell(row.changeLoop.permissionPrompts)].join(" | "));
  for (const tier of report.tiers)
    lines.push(`tier ${tier.tier}: ${tier.pairedScenarios} paired, ratio ${
      tier.ratio === null ? "n/a" : tier.ratio} ${
      tier.pass === null ? "(no evidence)" : tier.pass ? "pass" : "FAIL"}`);
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Paid acceptance: an old Change Loop candidate against a new one on the same
// scenarios. The new arm passes when its oracle pass rate is at least the old
// arm's, its packets miss no required section and repeat none, and its median
// wall time and tokens per scenario are at most `threshold` (20%) above the old
// arm's. A metric nobody measured is `inconclusive`, never a pass.

export const ARM_COMPARISON_PROTOCOL = "foundation-arm-comparison-v1";
export const ARM_COMPARISON_THRESHOLD = 0.2;

function runTokens(scorecard) {
  const usage = scorecard.usage || {};
  const values = [usage.inputTokens, usage.outputTokens, usage.cacheCreationTokens, usage.cacheReadTokens];
  return values.every(Number.isFinite) ? values.reduce((total, value) => total + value, 0) : null;
}

const round = (value, digits = 1) => value === null ? null : Number(value.toFixed(digits));

function oracleRate(rows) {
  const configured = rows.filter((row) => row.scorecard.oracle?.configured === true);
  if (!configured.length) return null;
  const passed = configured.filter((row) => row.scorecard.oracle?.measurement === "measured" &&
    row.scorecard.oracle?.verdict === "pass").length;
  return round(passed / configured.length, 4);
}

// Packet counts of one arm: unknown when any run has no measured count.
function packetTotal(rows, field) {
  const counts = rows.map((row) => row.scorecard.packet?.[field]?.count);
  return rows.length && counts.every(Number.isInteger)
    ? counts.reduce((total, value) => total + value, 0) : null;
}

function scenarioMedians(rows, read) {
  const byScenario = {};
  for (const row of rows) (byScenario[row.scenario] ||= []).push(read(row.scorecard));
  return Object.fromEntries(Object.entries(byScenario).map(([scenario, values]) =>
    [scenario, median(values)]));
}

function speedMetric(name, unit, oldRows, newRows, read, threshold) {
  const oldScenarios = scenarioMedians(oldRows, read);
  const newScenarios = scenarioMedians(newRows, read);
  const paired = Object.keys(newScenarios).filter((scenario) =>
    Number.isFinite(oldScenarios[scenario]) && Number.isFinite(newScenarios[scenario]) &&
    oldScenarios[scenario] > 0).sort();
  const oldMedian = median(paired.map((scenario) => oldScenarios[scenario]));
  const newMedian = median(paired.map((scenario) => newScenarios[scenario]));
  const deltaPercent = oldMedian === null || newMedian === null ? null
    : round(((newMedian - oldMedian) / oldMedian) * 100);
  const status = deltaPercent === null ? "inconclusive"
    : newMedian <= oldMedian * (1 + threshold) ? "pass" : "fail";
  const limit = `+${round(threshold * 100)}%`;
  const reason = status === "inconclusive"
    ? `${name}: no scenario has a measured ${unit} median in both arms`
    : `${name}: new median ${newMedian} ${unit} vs old ${oldMedian} ${unit} (${
      deltaPercent < 0 ? `${Math.abs(deltaPercent)}% faster` : `${deltaPercent >= 0 ? "+" : ""}${deltaPercent}%`
    }; limit ${limit})${status === "fail" ? " exceeds the limit" : ""}`;
  return {
    status, oldMedian, newMedian, deltaPercent, pairedScenarios: paired.length,
    scenarios: Object.fromEntries(paired.map((scenario) => [scenario, {
      old: oldScenarios[scenario], new: newScenarios[scenario],
      deltaPercent: round(((newScenarios[scenario] - oldScenarios[scenario]) /
        oldScenarios[scenario]) * 100)
    }])),
    reason
  };
}

function packetMetric(name, oldRows, newRows, field) {
  const oldTotal = packetTotal(oldRows, field);
  const newTotal = packetTotal(newRows, field);
  const status = newTotal === null ? "inconclusive" : newTotal === 0 ? "pass" : "fail";
  return {
    status, old: oldTotal, new: newTotal,
    reason: status === "inconclusive"
      ? `${name}: not measured on every new-arm run`
      : `${name}: new arm ${newTotal} (old ${oldTotal === null ? "unknown" : oldTotal}); required 0`
  };
}

// Medians of the informational packet measurements of one arm.
function packetMedians(rows) {
  const packet = (row) => row.scorecard.packet || {};
  return {
    wordsProposal: median(rows.map((row) => packet(row).words?.proposal)),
    wordsDesign: median(rows.map((row) => packet(row).words?.design)),
    wordsTasks: median(rows.map((row) => packet(row).words?.tasks)),
    editRounds: median(rows.map((row) => packet(row).editRoundsMeasurement === "measured"
      ? packet(row).editRounds : null)),
    compileMs: median(rows.map((row) => packet(row).compileMs))
  };
}

export function compareArms(oldRows, newRows, {
  threshold = ARM_COMPARISON_THRESHOLD, includeIncomplete = false
} = {}) {
  // The baseline arm (no harness) is not a candidate in this comparison.
  const candidate = (rows) => rows.filter((row) => row.arm !== BASELINE_ARM);
  const oldAll = candidate(oldRows);
  const newAll = candidate(newRows);
  const timed = (rows) => rows.filter((row) => includeIncomplete || completed(row));
  const oldRate = oracleRate(oldAll);
  const newRate = oracleRate(newAll);
  const oracleStatus = oldRate === null || newRate === null ? "inconclusive"
    : newRate >= oldRate ? "pass" : "fail";
  const oraclePassRate = {
    status: oracleStatus, old: oldRate, new: newRate,
    reason: oracleStatus === "inconclusive"
      ? "oracle pass rate: an arm has no oracle-configured run"
      : `oracle pass rate: new ${newRate} vs old ${oldRate}${oracleStatus === "fail" ? " is lower" : ""}`
  };
  const missingSections = packetMetric("missing required sections", oldAll, newAll, "missingSections");
  const duplicateSections = packetMetric("duplicate sections", oldAll, newAll, "duplicateSections");
  const wallTime = speedMetric("wall time", "ms", timed(oldAll), timed(newAll),
    (card) => card.timing?.wallMs, threshold);
  const tokens = speedMetric("tokens", "tokens", timed(oldAll), timed(newAll), runTokens, threshold);
  const metrics = { oraclePassRate, missingSections, duplicateSections, wallTime, tokens };
  const statuses = Object.values(metrics).map((metric) => metric.status);
  const status = statuses.includes("fail") ? "fail"
    : statuses.includes("inconclusive") ? "inconclusive" : "pass";
  return {
    version: 1, protocol: ARM_COMPARISON_PROTOCOL, threshold, status,
    pass: status === "pass" ? true : status === "fail" ? false : null,
    runs: { old: oldAll.length, new: newAll.length },
    ...metrics,
    packet: { old: packetMedians(oldAll), new: packetMedians(newAll) },
    reasons: Object.values(metrics).filter((metric) => metric.status !== "pass")
      .map((metric) => `${metric.status.toUpperCase()} ${metric.reason}`)
      .concat(Object.values(metrics).filter((metric) => metric.status === "pass")
        .map((metric) => `pass ${metric.reason}`))
  };
}

export function armComparisonReport(oldRoots, newRoots, options = {}) {
  return compareArms(loadScorecardRows(oldRoots), loadScorecardRows(newRoots), options);
}

const signed = (value) => value === null ? "n/a" : `${value > 0 ? "+" : ""}${value}%`;

export function formatArmComparison(report) {
  const row = (label, metric, oldValue, newValue, delta = "") =>
    `| ${label} | ${cell(oldValue, 4)} | ${cell(newValue, 4)} | ${delta} | ${metric.status} |`;
  const lines = [
    `# Arm comparison: ${report.status.toUpperCase()}`, "",
    `Runs: old ${report.runs.old}, new ${report.runs.new}. Limit: +${
      Number((report.threshold * 100).toFixed(1))}% median wall time and tokens per scenario.`, "",
    "| Metric | Old | New | Delta | Status |", "|---|---|---|---|---|",
    row("Oracle pass rate", report.oraclePassRate, report.oraclePassRate.old, report.oraclePassRate.new),
    row("Missing required sections", report.missingSections, report.missingSections.old,
      report.missingSections.new),
    row("Duplicate sections", report.duplicateSections, report.duplicateSections.old,
      report.duplicateSections.new),
    row("Median wall time ms", report.wallTime, report.wallTime.oldMedian, report.wallTime.newMedian,
      signed(report.wallTime.deltaPercent)),
    row("Median tokens", report.tokens, report.tokens.oldMedian, report.tokens.newMedian,
      signed(report.tokens.deltaPercent)),
    "", "| Packet median | Old | New |", "|---|---|---|",
    ...[["Words proposal", "wordsProposal"], ["Words design", "wordsDesign"], ["Words tasks", "wordsTasks"],
      ["EDIT rounds before AGREED", "editRounds"], ["Change start compile ms", "compileMs"]]
      .map(([label, key]) => `| ${label} | ${cell(report.packet.old[key])} | ${cell(report.packet.new[key])} |`),
    "", ...report.reasons.map((reason) => `- ${reason}`)
  ];
  return `${lines.join("\n")}\n`;
}

function compareCli(argv) {
  const roots = { old: [], new: [] };
  const options = {};
  let json = false;
  let strict = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--old") roots.old.push(argv[++index]);
    else if (argv[index] === "--new") roots.new.push(argv[++index]);
    else if (argv[index] === "--threshold") options.threshold = Number(argv[++index]);
    else if (argv[index] === "--json") json = true;
    else if (argv[index] === "--strict") strict = true;
    else if (argv[index] === "--include-incomplete") options.includeIncomplete = true;
    else roots.invalid = true;
  }
  if (roots.invalid || !roots.old.length || !roots.new.length || roots.old.concat(roots.new).some((root) => !root) ||
    (options.threshold !== undefined && !(options.threshold >= 0))) {
    process.stderr.write("usage: time-gate.mjs compare --old <results-directory>... " +
      "--new <results-directory>... [--threshold <fraction>] [--strict] [--json] [--include-incomplete]\n");
    process.exitCode = 1;
    return;
  }
  const report = armComparisonReport(roots.old, roots.new, options);
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatArmComparison(report));
  if (report.status === "fail" || (strict && report.status === "inconclusive")) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
  process.argv[2] === "compare") {
  compareCli(process.argv.slice(3));
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const roots = [];
  const options = {};
  let json = false;
  let strict = false;
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--json") json = true;
    else if (argv[index] === "--strict") strict = true;
    else if (argv[index] === "--include-incomplete") options.includeIncomplete = true;
    else if (argv[index] === "--target") options.targetRatio = Number(argv[++index]);
    else roots.push(argv[index]);
  }
  if (!roots.length || (options.targetRatio !== undefined && !(options.targetRatio > 0))) {
    process.stderr.write("usage: time-gate.mjs <results-directory>... [--target <ratio>] " +
      "[--strict] [--json] [--include-incomplete]\n");
    process.exitCode = 1;
  } else {
    const report = timeGateReport(roots, options);
    process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatTimeGate(report));
    if (report.status === "fail" || (strict && report.status === "advisory")) process.exitCode = 2;
  }
}
