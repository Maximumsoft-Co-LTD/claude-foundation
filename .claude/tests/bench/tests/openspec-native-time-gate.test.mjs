import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  compareArms, evaluateTimeGate, formatArmComparison, formatTimeGate, laneTier,
  loadScorecardRows, timeGateReport
} from "../openspec-native/time-gate.mjs";
import { buildReleaseReport } from "../openspec-native/release-report.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../openspec-native/time-gate.mjs");

const row = (scenario, arm, wallMs, extra = {}) => ({
  scenario, arm, lane: extra.lane ?? null, runId: `${scenario}-${arm}-${wallMs}`,
  scorecard: {
    scenario, outcome: (extra.complete ?? true) ? { complete: true, status: "completed" } : { complete: false, status: "incomplete" },
    timing: { wallMs, harnessActiveMs: extra.harnessActiveMs ?? null },
    usage: { modelRequests: extra.requests ?? null },
    friction: { permissionPrompts: extra.prompts ?? null }
  }
});
const risk = { tiny: "low", small: "low", big: "medium", huge: "high" };

test("within 1.3x in every tier passes and lists the per-scenario table", () => {
  const report = evaluateTimeGate([
    row("tiny", "baseline", 100000), row("tiny", "change-loop", 120000, { requests: 9 }),
    row("big", "baseline", 200000), row("big", "change-loop", 255000, { prompts: 1 })
  ], { riskByScenario: risk });
  assert.equal(report.status, "pass");
  assert.deepEqual(report.tiers.map((tier) => [tier.tier, tier.ratio, tier.pass]),
    [["rapid", 1.2, true], ["standard", 1.275, true]]);
  const text = formatTimeGate(report);
  assert.match(text, /PASS/);
  assert.match(text, /tiny \| rapid \| 100000 \| 120000 \| 1.2 \| 9/);
});

test("a tier over 1.3x of baseline median fails even when another tier is fine", () => {
  const report = evaluateTimeGate([
    row("tiny", "baseline", 100000), row("tiny", "change-loop", 110000),
    row("big", "baseline", 100000), row("big", "change-loop", 100000),
    row("big", "baseline", 100000), row("big", "change-loop", 140000),
    row("huge", "baseline", 100000), row("huge", "change-loop", 160000)
  ], { riskByScenario: risk, targetRatio: 1.3 });
  assert.equal(report.status, "fail");
  assert.match(report.reason, /standard/);
  const standard = report.tiers.find((tier) => tier.tier === "standard");
  assert.equal(standard.pass, false);
  // big: change-loop median 120000 vs 100000; huge: 160000 vs 100000.
  assert.equal(standard.changeLoopMedianWallMs, 140000);
  assert.equal(report.tiers.find((tier) => tier.tier === "rapid").pass, true);
  assert.equal(report.scenarios.find((entry) => entry.scenario === "huge").overTarget, true);
  assert.match(formatTimeGate(report), /huge \| standard .* 1.6 OVER/);
});

test("a missing baseline is an advisory, strict mode makes it a failure", () => {
  const rows = [row("tiny", "change-loop", 100000)];
  const report = evaluateTimeGate(rows, { riskByScenario: risk });
  assert.equal(report.status, "advisory");
  assert.match(report.reason, /collect both arms/);
  assert.equal(report.scenarios[0].ratio, null);
  assert.equal(report.scenarios[0].baseline.wallMs, null, "unknown stays unknown, not zero");
  assert.equal(evaluateTimeGate([], {}).status, "advisory");
  // Incomplete runs are not evidence of speed.
  const incomplete = evaluateTimeGate([
    row("tiny", "baseline", 100000), row("tiny", "change-loop", 900000, { complete: false })
  ], { riskByScenario: risk });
  assert.equal(incomplete.status, "advisory");
});

test("the recorded lane decides the tier, else matrix risk, else standard", () => {
  assert.equal(laneTier({ scenario: "x", lane: "rapid" }, risk), "rapid");
  assert.equal(laneTier({ scenario: "huge", lane: "Standard-lane" }, risk), "standard");
  assert.equal(laneTier({ scenario: "tiny", lane: null }, risk), "rapid");
  assert.equal(laneTier({ scenario: "big", lane: null }, risk), "standard");
  assert.equal(laneTier({ scenario: "unknown", lane: null }, risk), "standard");
  const report = evaluateTimeGate([
    row("big", "baseline", 100000, { lane: "rapid" }),
    row("big", "change-loop", 100000, { lane: "rapid" })
  ], { riskByScenario: risk });
  assert.equal(report.scenarios[0].tier, "rapid");
});

test("rows load from lab run directories and scorecard files, untagged rows are Change Loop", (t) => {
  const root = mkdtempSync(join(tmpdir(), "time-gate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const card = (scenario, wallMs) => ({
    scenario, runId: `${scenario}-${wallMs}`, outcome: { complete: true },
    timing: { wallMs }, usage: {}, friction: {}
  });
  const lab = (name, scenario, wallMs, manifest = {}) => {
    const dir = join(root, name);
    mkdirSync(join(dir, "openspec-native-runs", `${scenario}-${wallMs}`), { recursive: true });
    writeFileSync(join(dir, "manifest.json"),
      JSON.stringify({ scenario, runId: `${scenario}-${wallMs}`, ...manifest }));
    writeFileSync(join(dir, "openspec-native-runs", `${scenario}-${wallMs}`, "scorecard.json"),
      JSON.stringify(card(scenario, wallMs)));
  };
  lab("run-1", "tiny", 130000);
  lab("run-2", "tiny", 100000, { arm: "baseline" });
  writeFileSync(join(root, "extra.jsonl"),
    `${JSON.stringify({ ...card("big", 90000), arm: "baseline" })}\n` +
    `${JSON.stringify(card("big", 100000))}\nnot json\n`);
  const rows = loadScorecardRows([root]);
  assert.deepEqual(rows.map((entry) => [entry.scenario, entry.arm]).sort(), [
    ["big", "baseline"], ["big", "change-loop"], ["tiny", "baseline"], ["tiny", "change-loop"]]);
  const report = timeGateReport([root]);
  assert.equal(report.status, "pass");
  assert.equal(timeGateReport([join(root, "absent")]).status, "advisory");

  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  const passed = cli(root);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /time gate \(advisory\): PASS/);
  assert.equal(cli(root, "--target", "1.05").status, 2, "over target exits 2");
  const empty = join(root, "empty");
  mkdirSync(empty);
  assert.equal(cli(empty).status, 0, "missing evidence is an advisory by default");
  assert.equal(cli(empty, "--strict").status, 2);
  assert.equal(JSON.parse(cli(root, "--json").stdout).protocol, "foundation-time-gate-v1");
});

test("the release report shows the time gate as an advisory that never blocks release", () => {
  const matrix = { protocol: "m", execution_policy: { variance_repeats: 3 },
    scenarios: [{ id: "d", execution: "deterministic" }] };
  const sentinel = { status: "pass", matrixDigest: "x", zeroModelSpend: true, source: {},
    scenarios: [{ id: "d", status: "pass" }] };
  const timeGate = evaluateTimeGate([
    row("tiny", "baseline", 100000), row("tiny", "change-loop", 200000)], { riskByScenario: risk });
  const report = buildReleaseReport({ matrix, sentinel, timeGate });
  assert.equal(report.advisories[0].id, "time-gate");
  assert.equal(report.advisories[0].status, "fail");
  assert.equal(report.releaseReady, true, "advisory evidence never changes readiness");
  assert.deepEqual(buildReleaseReport({ matrix, sentinel }).advisories, []);
});

test("default targets are 1.5x for rapid and 1.8x for standard", () => {
  const report = evaluateTimeGate([
    row("tiny", "baseline", 100000), row("tiny", "change-loop", 148000),
    row("big", "baseline", 100000), row("big", "change-loop", 185000)
  ], { riskByScenario: risk });
  assert.equal(report.status, "fail");
  assert.deepEqual(report.tiers.map((tier) => [tier.tier, tier.targetRatio, tier.pass]),
    [["rapid", 1.5, true], ["standard", 1.8, false]]);
});

// One Change Loop run of an arm in the paid acceptance comparison.
const armRun = (scenario, wallMs, extra = {}) => ({
  scenario, arm: "change-loop", lane: null, runId: `${scenario}-${wallMs}-${extra.tag ?? ""}`,
  scorecard: {
    scenario, runId: `${scenario}-${wallMs}-${extra.tag ?? ""}`,
    outcome: { complete: true, status: "completed" },
    timing: { wallMs },
    usage: { inputTokens: extra.tokens ?? wallMs / 10, outputTokens: 0,
      cacheCreationTokens: 0, cacheReadTokens: 0 },
    oracle: { configured: true, measurement: "measured", verdict: extra.oracle ?? "pass" },
    packet: extra.packet === null ? undefined : {
      measurement: "measured",
      missingSections: { count: extra.missing ?? 0, sections: [] },
      duplicateSections: { count: extra.duplicates ?? 0, sections: [] },
      words: { proposal: 400, design: 600, tasks: 120 },
      editRounds: 1, editRoundsMeasurement: "measured", compileMs: 1500
    }
  }
});
const arm = (scale, extra = {}) => [
  armRun("tiny", 100000 * scale, { tag: "a", ...extra }), armRun("tiny", 100000 * scale, { tag: "b", ...extra }),
  armRun("big", 200000 * scale, { tag: "a", ...extra })
];

test("a new arm 25% slower than the old arm does not pass and shows the numbers", () => {
  const report = compareArms(arm(1), arm(1.25));
  assert.equal(report.status, "fail");
  assert.equal(report.pass, false);
  assert.equal(report.wallTime.status, "fail");
  assert.equal(report.wallTime.oldMedian, 150000);
  assert.equal(report.wallTime.newMedian, 187500);
  assert.equal(report.wallTime.deltaPercent, 25);
  assert.equal(report.tokens.deltaPercent, 25);
  assert.ok(report.reasons.some((reason) =>
    /FAIL wall time: new median 187500 ms vs old 150000 ms \(\+25%; limit \+20%\) exceeds/.test(reason)));
  assert.match(formatArmComparison(report), /\| Median wall time ms \| 150000 \| 187500 \| \+25% \| fail \|/);
  // Within the configurable threshold it passes.
  assert.equal(compareArms(arm(1), arm(1.25), { threshold: 0.3 }).status, "pass");
  assert.equal(compareArms(arm(1), arm(1.2)).wallTime.status, "pass", "exactly +20% is within");
});

test("a faster new arm passes and reports the percentage faster", () => {
  const report = compareArms(arm(1), arm(0.8));
  assert.equal(report.status, "pass");
  assert.equal(report.pass, true);
  assert.equal(report.wallTime.deltaPercent, -20);
  assert.deepEqual(report.oraclePassRate, { status: "pass", old: 1, new: 1,
    reason: "oracle pass rate: new 1 vs old 1" });
  assert.ok(report.reasons.some((reason) => /wall time: .*\(20% faster; limit \+20%\)/.test(reason)));
  assert.match(formatArmComparison(report), /# Arm comparison: PASS/);
  assert.match(formatArmComparison(report), /\| Median wall time ms \| 150000 \| 120000 \| -20% \| pass \|/);
  assert.match(formatArmComparison(report), /\| EDIT rounds before AGREED \| 1 \| 1 \|/);
});

test("missing measurements make the comparison inconclusive, never a pass", () => {
  const noPacket = compareArms(arm(1), arm(0.9, { packet: null }));
  assert.equal(noPacket.status, "inconclusive");
  assert.equal(noPacket.pass, null);
  assert.equal(noPacket.missingSections.status, "inconclusive");
  assert.equal(noPacket.missingSections.new, null);
  const noOld = compareArms([], arm(0.9));
  assert.equal(noOld.status, "inconclusive");
  assert.equal(noOld.wallTime.deltaPercent, null);
  assert.equal(noOld.wallTime.oldMedian, null, "unknown stays unknown, not zero");
  assert.equal(noOld.oraclePassRate.status, "inconclusive");
  const unknownTokens = arm(0.9).map((run) => ({ ...run,
    scorecard: { ...run.scorecard, usage: { ...run.scorecard.usage, inputTokens: null } } }));
  assert.equal(compareArms(arm(1), unknownTokens).tokens.status, "inconclusive");
});

test("duplicate or missing sections and a lower oracle pass rate fail the new arm", () => {
  const duplicate = compareArms(arm(1), arm(1, { duplicates: 1 }));
  assert.equal(duplicate.status, "fail");
  assert.equal(duplicate.duplicateSections.new, 3);
  assert.ok(duplicate.reasons.some((reason) => /FAIL duplicate sections: new arm 3 \(old 0\); required 0/.test(reason)));
  assert.equal(compareArms(arm(1), arm(1, { missing: 1 })).missingSections.status, "fail");
  const oracle = compareArms(arm(1), [...arm(1).slice(1), armRun("tiny", 100000, { tag: "x", oracle: "fail" })]);
  assert.equal(oracle.oraclePassRate.status, "fail");
  assert.equal(oracle.oraclePassRate.new, 0.6667);
});

test("the compare command reads two result roots and exits 2 on a failing verdict", (t) => {
  const root = mkdtempSync(join(tmpdir(), "arm-compare-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name, runs) => {
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, "runs.jsonl"),
      runs.map((run) => JSON.stringify(run.scorecard)).join("\n") + "\n");
  };
  write("old", arm(1));
  write("fast", arm(0.9));
  write("slow", arm(1.25));
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, "compare", ...args], { encoding: "utf8" });
  const fast = cli("--old", join(root, "old"), "--new", join(root, "fast"));
  assert.equal(fast.status, 0, fast.stderr);
  assert.match(fast.stdout, /# Arm comparison: PASS/);
  assert.match(fast.stdout, /-10%/);
  assert.equal(cli("--old", join(root, "old"), "--new", join(root, "slow")).status, 2);
  const json = JSON.parse(cli("--old", join(root, "old"), "--new", join(root, "slow"), "--json",
    "--threshold", "0.3").stdout);
  assert.equal(json.protocol, "foundation-arm-comparison-v1");
  assert.equal(json.status, "pass");
  assert.equal(cli("--old", join(root, "old")).status, 1, "both arms are required");
});
