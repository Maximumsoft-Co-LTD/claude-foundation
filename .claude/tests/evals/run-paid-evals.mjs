#!/usr/bin/env node
// Paid agent evals: run selected bench-lab scenarios in disposable consumers.
// Spends money only with --authorize-spend <ref>, and never past the monthly
// budget counted from the ledger outside Git.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LEDGER_RELATIVE_PATH, MATRIX_RELATIVE_PATH, MONTHLY_BUDGET_USD, appendLedger,
  budgetDecision, labRunCost, loadCases, matrixScenarios, monthKey, monthSpend, paidPlan,
  readLedger
} from "./evals.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export function parsePaidArgs(argv) {
  const flags = { cases: [], dryRun: false, authorize: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") flags.dryRun = true;
    else if (value === "--case") flags.cases.push(argv[++index]);
    else if (value === "--authorize-spend") flags.authorize = argv[++index] || null;
    else throw new Error(`unknown argument: ${value}`);
  }
  return flags;
}

function defaultLab(root) {
  return (scenario) => {
    const result = spawnSync(process.execPath,
      [join(root, ".claude/tests/bench/openspec-native/lab.mjs"), "--scenario", scenario],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    let runDir = null;
    try { runDir = JSON.parse(result.stdout).runDir || null; } catch { runDir = null; }
    return { status: result.status, runDir };
  };
}

export function runPaidEvals(argv, {
  root = resolve(HERE, "../../.."),
  casesDir = join(HERE, "cases"),
  matrixPath = join(root, MATRIX_RELATIVE_PATH),
  ledgerPath = join(root, LEDGER_RELATIVE_PATH),
  now = () => new Date(),
  lab = defaultLab(root),
  costOf = labRunCost,
  log = (line) => console.log(line)
} = {}) {
  const flags = parsePaidArgs(argv);
  const scenarios = matrixScenarios(matrixPath);
  const plan = paidPlan(loadCases(casesDir), scenarios, flags.cases);
  const month = monthKey(now());
  const spentUsd = monthSpend(readLedger(ledgerPath), month);
  const decision = budgetDecision({ spentUsd, plannedUsd: plan.capUsd });
  log(`paid evals for ${month}: ${plan.rows.map((row) => `${row.id} ($${row.capUsd})`).join(", ")}`);
  log(`planned ceiling $${plan.capUsd}; spent this month $${spentUsd}; ` +
    `remaining $${decision.remainingUsd} of $${MONTHLY_BUDGET_USD}`);
  if (flags.dryRun) { log("dry run: no model was called and the ledger is unchanged"); return { status: "dry-run" }; }
  if (!flags.authorize) {
    log("refused: paid evals spend money; rerun with --authorize-spend <decision-ref>");
    return { status: "unauthorized" };
  }
  if (!decision.allowed) {
    log(`refused: the planned ceiling exceeds the remaining monthly budget ($${decision.remainingUsd})`);
    return { status: "over-budget", remainingUsd: decision.remainingUsd };
  }
  const results = plan.rows.map((row) => {
    const run = lab(row.scenario);
    const costUsd = costOf(run.runDir);
    appendLedger(ledgerPath, {
      month, at: now().toISOString(), case: row.id, scenario: row.scenario,
      authorizedBy: flags.authorize, capUsd: row.capUsd, costUsd,
      status: run.status === 0 ? "pass" : "fail", runDir: run.runDir
    });
    log(`${run.status === 0 ? "PASS" : "FAIL"}: ${row.id} ` +
      `(cost ${costUsd === null ? `unmeasured, counted as $${row.capUsd}` : `$${costUsd}`})`);
    return { id: row.id, passed: run.status === 0, costUsd };
  });
  return { status: results.every((row) => row.passed) ? "pass" : "fail", results };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runPaidEvals(process.argv.slice(2));
    process.exitCode = ["pass", "dry-run"].includes(result.status) ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
