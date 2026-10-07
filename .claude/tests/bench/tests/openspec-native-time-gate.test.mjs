import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  evaluateTimeGate, formatTimeGate, laneTier, loadScorecardRows, timeGateReport
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
  ], { riskByScenario: risk });
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
