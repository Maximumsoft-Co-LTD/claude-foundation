#!/usr/bin/env node
// Deterministic agent evals: validate the catalog (every closed incident has
// an eval) and run each deterministic case. No model is called.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MATRIX_RELATIVE_PATH, catalogIssues, incidentRecords, loadCases, matrixScenarios,
  runDeterministicCase
} from "./evals.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export function runEvals({
  root = resolve(HERE, "../../.."),
  casesDir = join(HERE, "cases"),
  incidentsDir = join(root, "openspec", "incidents"),
  matrixPath = join(root, MATRIX_RELATIVE_PATH),
  run = (command, args, cwd) => spawnSync(command, args, { cwd, encoding: "utf8" }),
  log = (line) => console.log(line)
} = {}) {
  const cases = loadCases(casesDir);
  const issues = catalogIssues(cases, incidentRecords(incidentsDir), matrixScenarios(matrixPath));
  for (const issue of issues) log(`FAIL: catalog: ${issue}`);
  if (issues.length) return { ok: false, issues, results: [] };
  const results = cases.map((entry) => entry.value)
    .filter((value) => value.layer === "deterministic")
    .map((value) => runDeterministicCase(value, { run, root }));
  for (const result of results)
    log(result.passed ? `PASS: ${result.id}` : `FAIL: ${result.id}: ${result.failures.join("; ")}`);
  const paid = cases.filter((entry) => entry.value.layer === "paid").length;
  const failed = results.filter((result) => !result.passed).length;
  log(`agent evals: ${failed ? `${failed} FAILED` : "ALL PASS"} ` +
    `(${results.length} deterministic run, ${paid} paid cataloged, not run)`);
  return { ok: failed === 0, issues, results };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = runEvals().ok ? 0 : 1;
