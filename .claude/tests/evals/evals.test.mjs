import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  budgetDecision, instructionPaths, labRunCost, monthKey, monthSpend
} from "./evals.mjs";
import { runEvals } from "./run-evals.mjs";
import { runPaidEvals } from "./run-paid-evals.mjs";
import { owedEvals } from "./owed-evals.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), "agent-evals-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cases = join(root, "cases");
  const incidents = join(root, "openspec", "incidents");
  mkdirSync(cases, { recursive: true });
  mkdirSync(incidents, { recursive: true });
  const matrix = join(root, "matrix.json");
  writeFileSync(matrix, JSON.stringify({ scenarios: [
    { id: "cheap", execution: "paid", budget: { cost_usd: 3 } },
    { id: "pricier", execution: "paid", budget: { cost_usd: 14 } },
    { id: "offline", execution: "deterministic", budget: { cost_usd: 0 } }
  ] }));
  const writeCase = (id, value) =>
    writeFileSync(join(cases, `${id}.json`), JSON.stringify({ id, ...value }));
  const writeIncident = (id, status) => writeFileSync(join(incidents, `${id}.md`),
    `# Incident\n\n| Field | Value |\n|---|---|\n| Id | ${id} |\n| Status | ${status} |\n`);
  return { root, cases, incidents, matrix, ledger: join(root, "ledger.jsonl"), writeCase, writeIncident };
}

const quiet = () => {};
const passing = (command = ["node", "-e", "console.log('ok')"]) =>
  ({ source: "task:x", layer: "deterministic", description: "d", command, expect: { stdoutIncludes: ["ok"] } });

function evals(ws, overrides = {}) {
  const lines = [];
  const result = runEvals({
    root: ws.root, casesDir: ws.cases, incidentsDir: ws.incidents, matrixPath: ws.matrix,
    log: (line) => lines.push(line), ...overrides
  });
  return { ...result, output: lines.join("\n") };
}

test("deterministic cases run and report a passing count", (t) => {
  const ws = workspace(t);
  ws.writeCase("a", passing());
  ws.writeCase("p", { source: "task:x", layer: "paid", scenario: "cheap", description: "d" });
  const result = evals(ws);
  assert.equal(result.ok, true);
  assert.match(result.output, /PASS: a/);
  assert.match(result.output, /ALL PASS \(1 deterministic run, 1 paid cataloged, not run\)/);
});

test("a failing case names its id and the cause", (t) => {
  const ws = workspace(t);
  ws.writeCase("exits", passing(["node", "-e", "process.exit(3)"]));
  ws.writeCase("silent", passing(["node", "-e", "console.log('nope')"]));
  const result = evals(ws);
  assert.equal(result.ok, false);
  assert.match(result.output, /FAIL: exits: exit 3, expected 0/);
  assert.match(result.output, /FAIL: silent: output lacks 'ok'/);
});

test("a closed incident without an eval fails the catalog; open ones do not", (t) => {
  const ws = workspace(t);
  ws.writeCase("a", passing());
  ws.writeIncident("2026-11-09-open-thing", "open");
  assert.equal(evals(ws).ok, true, "an open incident owes no eval yet");
  ws.writeIncident("2026-11-09-closed-thing", "closed");
  const missing = evals(ws);
  assert.equal(missing.ok, false);
  assert.match(missing.output, /incident '2026-11-09-closed-thing' is closed but has no eval case/);
  ws.writeCase("covers", { ...passing(), source: "incident:2026-11-09-closed-thing" });
  assert.equal(evals(ws).ok, true);
});

test("malformed cases name the file and the field", (t) => {
  const ws = workspace(t);
  writeFileSync(join(ws.cases, "broken.json"), "{");
  ws.writeCase("renamed", { ...passing(), id: "other" });
  ws.writeCase("nocommand", { source: "task:x", layer: "deterministic", description: "d" });
  ws.writeCase("ghost", { source: "task:x", layer: "paid", scenario: "missing", description: "d" });
  ws.writeCase("free", { source: "task:x", layer: "paid", scenario: "offline", description: "d" });
  ws.writeCase("badsource", { ...passing(), source: "whatever" });
  const output = evals(ws).output;
  assert.match(output, /broken\.json: unreadable JSON/);
  assert.match(output, /renamed\.json: id 'other' must match the file name/);
  assert.match(output, /nocommand\.json: a deterministic case needs a non-empty command array/);
  assert.match(output, /ghost\.json: scenario 'missing' is not in the bench matrix/);
  assert.match(output, /free\.json: scenario 'offline' is not a paid bench scenario/);
  assert.match(output, /badsource\.json: source must be/);
});

test("the repository catalog itself is valid and covers every closed incident", () => {
  const result = runEvals({ log: quiet, run: () => ({ status: 0, stdout: "" }) });
  assert.deepEqual(result.issues, []);
});

function paid(ws, argv, overrides = {}) {
  const lines = [];
  const labCalls = [];
  const result = runPaidEvals(argv, {
    root: ws.root, casesDir: ws.cases, matrixPath: ws.matrix, ledgerPath: ws.ledger,
    now: () => new Date("2026-11-20T00:00:00Z"),
    lab: (scenario) => { labCalls.push(scenario); return { status: 0, runDir: `run-${scenario}` }; },
    costOf: (runDir) => (runDir === "run-cheap" ? 2.5 : null),
    log: (line) => lines.push(line), ...overrides
  });
  return { result, labCalls, output: lines.join("\n") };
}

function paidWorkspace(t) {
  const ws = workspace(t);
  ws.writeCase("c1", { source: "task:x", layer: "paid", scenario: "cheap", description: "d" });
  ws.writeCase("c2", { source: "task:x", layer: "paid", scenario: "pricier", description: "d" });
  return ws;
}

const ledgerRow = (month, costUsd, capUsd = 10) => JSON.stringify({ month, costUsd, capUsd });

test("paid evals refuse without spend authorization and call no model", (t) => {
  const ws = paidWorkspace(t);
  const run = paid(ws, []);
  assert.equal(run.result.status, "unauthorized");
  assert.deepEqual(run.labCalls, []);
  assert.match(run.output, /planned ceiling \$17/);
  assert.equal(existsSync(ws.ledger), false);
});

test("paid evals refuse a plan that would pass the monthly budget", (t) => {
  const ws = paidWorkspace(t);
  writeFileSync(ws.ledger, `${ledgerRow("2026-11", 90)}\n`);
  const run = paid(ws, ["--authorize-spend", "decision:1"]);
  assert.equal(run.result.status, "over-budget");
  assert.equal(run.result.remainingUsd, 10);
  assert.deepEqual(run.labCalls, []);
});

test("a plan that lands exactly on the budget is allowed and recorded", (t) => {
  const ws = paidWorkspace(t);
  writeFileSync(ws.ledger, `${ledgerRow("2026-11", 83)}\n`);
  const run = paid(ws, ["--authorize-spend", "decision:2"]);
  assert.equal(run.result.status, "pass");
  assert.deepEqual(run.labCalls, ["cheap", "pricier"]);
  const rows = readFileSync(ws.ledger, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.slice(1).map((row) => [row.case, row.costUsd, row.capUsd, row.authorizedBy]),
    [["c1", 2.5, 3, "decision:2"], ["c2", null, 14, "decision:2"]]);
  assert.match(run.output, /cost unmeasured, counted as \$14/);
});

test("a dry run plans without a model call or a ledger write", (t) => {
  const ws = paidWorkspace(t);
  const run = paid(ws, ["--dry-run", "--authorize-spend", "decision:3"]);
  assert.equal(run.result.status, "dry-run");
  assert.deepEqual(run.labCalls, []);
  assert.equal(existsSync(ws.ledger), false);
});

test("a selected case limits the plan, and an unknown case is an error", (t) => {
  const ws = paidWorkspace(t);
  const run = paid(ws, ["--case", "c1", "--authorize-spend", "decision:4"]);
  assert.deepEqual(run.labCalls, ["cheap"]);
  assert.throws(() => paid(ws, ["--case", "nope"]), /unknown paid eval case: nope/);
});

test("monthly spend counts only the current month and unmeasured runs at their ceiling", () => {
  const rows = [
    { month: "2026-10", costUsd: 50, capUsd: 60 },
    { month: "2026-11", costUsd: 4, capUsd: 5 },
    { month: "2026-11", costUsd: null, capUsd: 3 }
  ];
  assert.equal(monthSpend(rows, "2026-11"), 7);
  assert.equal(monthSpend(rows, "2026-12"), 0, "a new month starts at zero");
  assert.equal(monthKey("2026-12-01T00:00:00Z"), "2026-12");
  assert.deepEqual(budgetDecision({ spentUsd: 83, plannedUsd: 17 }),
    { allowed: true, remainingUsd: 17, limitUsd: 100 });
  assert.equal(budgetDecision({ spentUsd: 83.01, plannedUsd: 17 }).allowed, false);
});

test("a lab run's cost is the sum of its scorecards, or unknown", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "agent-evals-run-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(labRunCost(null), null);
  assert.equal(labRunCost(dir), null, "no scorecards means unmeasured");
  writeFileSync(join(dir, "scorecards.jsonl"),
    `${JSON.stringify({ usage: { costUsd: 1.25 } })}\n${JSON.stringify({ costUsd: 0.5 })}\n`);
  assert.equal(labRunCost(dir), 1.75);
  writeFileSync(join(dir, "scorecards.jsonl"), `${JSON.stringify({ usage: { costUsd: null } })}\n`);
  assert.equal(labRunCost(dir), null);
});

test("evals:owed lists paid cases when an instruction surface changes", (t) => {
  const ws = paidWorkspace(t);
  const lines = [];
  const owed = owedEvals({
    root: ws.root, casesDir: ws.cases, matrixPath: ws.matrix,
    paths: ["src/app.js", ".claude/skills/build/SKILL.md"], log: (line) => lines.push(line)
  });
  assert.equal(owed.owed, true);
  assert.match(lines.join("\n"), /cases: c1, c2; planned ceiling \$17/);
  assert.match(lines.join("\n"), /--authorize-spend <decision-ref>/);
  const none = owedEvals({ root: ws.root, casesDir: ws.cases, matrixPath: ws.matrix,
    paths: ["src/app.js", "README.md"], log: quiet });
  assert.equal(none.owed, false);
  assert.deepEqual(instructionPaths([
    "CLAUDE.md", "AGENTS.md", ".claude/rules/x.md", ".claude/hooks/y.sh",
    ".claude/commands/build.md", ".claude/harness/AGENT.md", ".claude/harness/runtime/z.mjs"
  ]), ["CLAUDE.md", "AGENTS.md", ".claude/rules/x.md", ".claude/hooks/y.sh",
    ".claude/commands/build.md", ".claude/harness/AGENT.md"]);
});

test("evals:owed never fails, even when it cannot diff", () => {
  const result = spawnSync(process.execPath, [join(HERE, "owed-evals.mjs")], {
    encoding: "utf8", env: { ...process.env, EVALS_BASE: "no-such-ref-for-evals" }
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /paid evals owed: unknown/);
});
