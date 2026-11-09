// Repository-only agent evals. Deterministic cases run in the suite on every
// change; paid cases run the bench lab only on explicit spend authorization
// and within a monthly budget. Nothing here ships to consumers.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const MONTHLY_BUDGET_USD = 100;
export const LEDGER_RELATIVE_PATH = ".claude/tests/bench/results/evals-ledger.jsonl";
export const MATRIX_RELATIVE_PATH = ".claude/tests/bench/config/openspec-native-matrix.json";

// Agent-facing instruction surfaces: a change here can alter what the agent
// does, which only a real run observes.
export const INSTRUCTION_PATTERNS = [
  /^\.claude\/skills\//, /^\.claude\/rules\//, /^\.claude\/hooks\//,
  /^\.claude\/commands\//, /^\.claude\/orchestrator\.md$/, /^\.claude\/harness\/AGENT\.md$/,
  /^CLAUDE\.md$/, /^AGENTS\.md$/
];

const isText = (value) => typeof value === "string" && value.trim() !== "";

export function loadCases(directory) {
  return readdirSync(directory).filter((name) => name.endsWith(".json")).sort()
    .map((name) => {
      const path = join(directory, name);
      try { return { file: name, value: JSON.parse(readFileSync(path, "utf8")) }; }
      catch (error) { return { file: name, value: null, error: error.message }; }
    });
}

// A closed incident record is `YYYY-MM-DD-<slug>.md` whose field table says
// `| Status | closed |`. README.md and _template.md are not records.
export function incidentRecords(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(name))
    .map((name) => {
      const body = readFileSync(join(directory, name), "utf8");
      const status = body.match(/^\|\s*Status\s*\|\s*([^|]+?)\s*\|/m)?.[1]?.toLowerCase() || null;
      return { id: basename(name, ".md"), status };
    });
}

export function matrixScenarios(matrixPath) {
  const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
  return new Map((matrix.scenarios || []).map((row) => [row.id, row]));
}

function caseIssues(entry, scenarios) {
  const issues = [];
  const where = entry.file;
  if (entry.error) return [`${where}: unreadable JSON (${entry.error})`];
  const value = entry.value;
  if (!value || typeof value !== "object") return [`${where}: a case must be a JSON object`];
  if (!isText(value.id)) issues.push(`${where}: id is required`);
  else if (`${value.id}.json` !== where) issues.push(`${where}: id '${value.id}' must match the file name`);
  if (!isText(value.source) || !/^(incident|task):.+/.test(value.source))
    issues.push(`${where}: source must be 'incident:<record id>' or 'task:<description>'`);
  if (!isText(value.description)) issues.push(`${where}: description is required`);
  if (value.layer === "deterministic") {
    if (!Array.isArray(value.command) || !value.command.length || !value.command.every(isText))
      issues.push(`${where}: a deterministic case needs a non-empty command array`);
    const includes = value.expect?.stdoutIncludes;
    if (includes !== undefined && (!Array.isArray(includes) || !includes.every(isText)))
      issues.push(`${where}: expect.stdoutIncludes must be a list of strings`);
  } else if (value.layer === "paid") {
    const scenario = scenarios.get(value.scenario);
    if (!scenario) issues.push(`${where}: scenario '${value.scenario}' is not in the bench matrix`);
    else if (scenario.execution !== "paid")
      issues.push(`${where}: scenario '${value.scenario}' is not a paid bench scenario`);
    else if (!(Number(scenario.budget?.cost_usd) > 0))
      issues.push(`${where}: scenario '${value.scenario}' has no positive cost ceiling`);
  } else issues.push(`${where}: layer must be 'deterministic' or 'paid'`);
  return issues;
}

export function catalogIssues(cases, incidents, scenarios) {
  const issues = cases.flatMap((entry) => caseIssues(entry, scenarios));
  const covered = new Set(cases.map((entry) => entry.value?.source)
    .filter((source) => isText(source) && source.startsWith("incident:"))
    .map((source) => source.slice("incident:".length)));
  for (const incident of incidents)
    if (incident.status === "closed" && !covered.has(incident.id))
      issues.push(`incident '${incident.id}' is closed but has no eval case (source: 'incident:${incident.id}')`);
  return issues;
}

export function runDeterministicCase(value, { run, root }) {
  const result = run(value.command[0], value.command.slice(1), root);
  const stdout = String(result.stdout || "");
  const expectedExit = Number(value.expect?.exit ?? 0);
  const failures = [];
  if (result.status !== expectedExit)
    failures.push(`exit ${result.status}, expected ${expectedExit}`);
  for (const text of value.expect?.stdoutIncludes || [])
    if (!stdout.includes(text)) failures.push(`output lacks '${text}'`);
  return { id: value.id, passed: failures.length === 0, failures };
}

// ---- paid layer ---------------------------------------------------------

export function monthKey(date) {
  return new Date(date).toISOString().slice(0, 7);
}

export function readLedger(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

// A run whose cost could not be measured counts at its full ceiling: an
// unknown is never counted as free.
export function monthSpend(rows, month) {
  return rows.filter((row) => row.month === month)
    .reduce((total, row) => total + Number(
      row.costUsd === null || row.costUsd === undefined ? row.capUsd : row.costUsd), 0);
}

export function paidPlan(cases, scenarios, selected = []) {
  const paid = cases.map((entry) => entry.value).filter((value) => value?.layer === "paid");
  const unknown = selected.filter((id) => !paid.some((value) => value.id === id));
  if (unknown.length) throw new Error(`unknown paid eval case: ${unknown.join(", ")}`);
  const chosen = selected.length ? paid.filter((value) => selected.includes(value.id)) : paid;
  const rows = chosen.map((value) => ({
    id: value.id, scenario: value.scenario,
    capUsd: Number(scenarios.get(value.scenario)?.budget?.cost_usd)
  }));
  return { rows, capUsd: rows.reduce((total, row) => total + row.capUsd, 0) };
}

export function budgetDecision({ spentUsd, plannedUsd, limitUsd = MONTHLY_BUDGET_USD }) {
  const remainingUsd = Math.max(0, round(limitUsd - spentUsd));
  return { allowed: round(spentUsd + plannedUsd) <= limitUsd, remainingUsd, limitUsd };
}

const round = (value) => Math.round(value * 100) / 100;

export function appendLedger(path, row) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`);
}

// The measured cost of a lab run: the sum of its scorecards' costUsd, or null
// when any scorecard could not measure it.
export function labRunCost(runDir) {
  const path = join(runDir || "", "scorecards.jsonl");
  if (!runDir || !existsSync(path)) return null;
  let total = 0;
  for (const line of readFileSync(path, "utf8").split("\n").filter((value) => value.trim())) {
    const row = JSON.parse(line);
    const cost = row.usage?.costUsd ?? row.costUsd;
    if (typeof cost !== "number" || !Number.isFinite(cost)) return null;
    total += cost;
  }
  return round(total);
}

// ---- owed detector ------------------------------------------------------

export function instructionPaths(paths) {
  return paths.filter((path) => INSTRUCTION_PATTERNS.some((pattern) => pattern.test(path)));
}
