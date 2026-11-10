#!/usr/bin/env node
// Reports which paid evals a change owes: any edit to an agent instruction
// surface can change agent behavior that only a real run observes. It never
// fails, because paid runs need a maintainer's spend authorization.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MATRIX_RELATIVE_PATH, instructionPaths, loadCases, matrixScenarios, paidPlan
} from "./evals.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function changedPaths(root, base) {
  const committed = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`],
    { cwd: root, encoding: "utf8" });
  const working = spawnSync("git", ["diff", "--name-only", "HEAD"], { cwd: root, encoding: "utf8" });
  if (committed.status !== 0) return null;
  return [...new Set([...committed.stdout.split("\n"), ...working.stdout.split("\n")]
    .map((line) => line.trim()).filter(Boolean))];
}

export function owedEvals({
  root = resolve(HERE, "../../.."),
  base = process.env.EVALS_BASE || "origin/main",
  paths = changedPaths(root, base),
  casesDir = join(HERE, "cases"),
  matrixPath = join(root, MATRIX_RELATIVE_PATH),
  log = (line) => console.log(line)
} = {}) {
  if (paths === null) {
    log(`paid evals owed: unknown (could not diff against ${base})`);
    return { owed: null };
  }
  const touched = instructionPaths(paths);
  if (!touched.length) {
    log("no paid evals owed: no agent instruction surface changed");
    return { owed: false, touched };
  }
  const plan = paidPlan(loadCases(casesDir), matrixScenarios(matrixPath));
  log(`paid evals owed: ${touched.length} instruction file(s) changed (${touched.slice(0, 5).join(", ")}` +
    `${touched.length > 5 ? ", …" : ""})`);
  log(`cases: ${plan.rows.map((row) => row.id).join(", ")}; planned ceiling $${plan.capUsd}`);
  log("run with a maintainer's spend authorization: npm run evals:paid -- --authorize-spend <decision-ref>");
  return { owed: true, touched, plan };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { owedEvals(); } catch (error) { console.log(`paid evals owed: unknown (${error.message})`); }
  process.exitCode = 0;
}
