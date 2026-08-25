import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { ROOT, isMain, parseArgs, readJson, repoPath, writeJson } from "./lib.mjs";
import { resolve } from "node:path";

const SUITES = [
  {
    id: "SEM-EVIDENCE-BINDING",
    command: ["sh", ".claude/tests/harness/run-evidence-binding-mutation.sh"],
    protocol: "mutation-v2"
  },
  {
    id: "SEM-TARGET-DRIFT",
    command: ["sh", ".claude/tests/harness/run-target-drift-mutation.sh"],
    protocol: "mutation-v2"
  },
  {
    id: "SEM-LAND-SURFACE",
    command: ["sh", ".claude/tests/harness/run-land-surface-mutation.sh"],
    protocol: "mutation-v2"
  },
  {
    id: "SEM-KILLER-BINDING",
    command: ["node", ".claude/tests/harness/run-risk-tiered-review-mutation.mjs"],
    protocol: "mutation-v2"
  },
  {
    id: "SEM-SHIPPING-CONTRACTS",
    command: ["node", "scripts/quality/run-shipping-semantic-mutation.mjs"],
    protocol: "mutation-v2"
  }
];

export function classifyLegacyResult(exitCode, output) {
  const marker = output.match(/FOUNDATION_MUTATION_RESULT=([^\s]+)/)?.[1] || "missing";
  return {
    marker,
    result: exitCode === 0 && marker === "behavioral-kill" ? "killed"
      : marker === "survived" ? "survived" : "invalid"
  };
}

function catalogMutants(catalog, suiteId) {
  return catalog.mutants.filter((mutant) => mutant.suite === suiteId);
}

export function validMutationV2(report, declared, exitCode = 0) {
  const mutants = report?.mutants || [];
  return exitCode === 0 && mutants.length > 0 && mutants.every((mutant) =>
    mutant.applied === true && mutant.compiled === true && mutant.result === "killed" && mutant.killedBy &&
    (!mutant.expectedKiller || mutant.killedBy === mutant.expectedKiller) && mutant.restored !== false) &&
    declared.every((entry) => mutants.some((mutant) => mutant.id === entry.id));
}

function runSuite(suite, reportDir, timeoutMs, catalog) {
  const v2Path = resolve(reportDir, `${suite.id}.json`);
  const [command, ...args] = suite.command;
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, FOUNDATION_RESULT_REPORT: v2Path }
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (suite.protocol === "mutation-v2") {
    let report = null;
    try {
      report = JSON.parse(readFileSync(v2Path, "utf8"));
    } catch {
      report = null;
    }
    const declared = catalogMutants(catalog, suite.id);
    const mutants = report?.mutants || [];
    const valid = validMutationV2(report, declared, result.status);
    return {
      ...suite,
      exitCode: result.status,
      timedOut: result.error?.code === "ETIMEDOUT",
      result: valid ? "killed" : "invalid",
      mutants,
      outputTail: output.trim().split("\n").slice(-20)
    };
  }
  const classified = classifyLegacyResult(result.status, output);
  const mutants = catalogMutants(catalog, suite.id).map((mutant) => ({
    ...mutant,
    applied: classified.result === "killed",
    compiled: classified.result === "killed",
    result: classified.result === "killed" ? "killed" : classified.result,
    killedBy: classified.result === "killed" ? mutant.expectedKiller : "",
    restored: classified.result === "killed"
  }));
  return {
    ...suite,
    exitCode: result.status,
    timedOut: result.error?.code === "ETIMEDOUT",
    ...classified,
    mutants,
    outputTail: output.trim().split("\n").slice(-20)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = resolve(ROOT,
    args.output || ".foundation/test-results/quality/mutation-semantic.json");
  const reportDir = resolve(ROOT, ".foundation/test-results/quality/semantic-suites");
  const timeoutMs = Number(args.timeout || 300000);
  const catalog = readJson(resolve(ROOT, args.catalog || "quality/semantic-mutants.json"));
  const suites = SUITES.map((suite) => runSuite(suite, reportDir, timeoutMs, catalog));
  const mutants = suites.flatMap((suite) => suite.mutants || []);
  const summary = {
    suites: suites.length,
    killed: suites.filter((suite) => suite.result === "killed").length,
    survived: suites.filter((suite) => suite.result === "survived").length,
    invalid: suites.filter((suite) => suite.result === "invalid").length,
    mutants: mutants.length
  };
  writeJson(output, {
    protocol: "foundation-semantic-mutation-aggregate-v1",
    generatedAt: new Date().toISOString(),
    summary,
    suites,
    mutants
  });
  process.stdout.write(`semantic mutation: ${summary.killed}/${summary.suites} suite(s) killed -> ${repoPath(output)}\n`);
  if (!args["no-exit"] && summary.killed !== summary.suites) process.exitCode = 1;
}

if (isMain(import.meta.url)) await main();
