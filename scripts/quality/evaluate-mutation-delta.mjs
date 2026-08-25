import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, assertSafeGitRef, isMain, parseArgs, readJson, repoPath, writeJson } from "./lib.mjs";

export function mutationCounts(report) {
  const mutants = Object.values(report.files || {}).flatMap((file) => file.mutants || []);
  const count = (status) => mutants.filter((mutant) => mutant.status === status).length;
  const counts = {
    killed: count("Killed"),
    timeout: count("Timeout"),
    survived: count("Survived"),
    noCoverage: count("NoCoverage")
  };
  const denominator = Object.values(counts).reduce((total, value) => total + value, 0);
  return { counts, score: denominator ? (counts.killed + counts.timeout) / denominator * 100 : 0 };
}

export function evaluateMutationDelta(currentReport, baseline, policy, comparisonBaseline = baseline) {
  const current = mutationCounts(currentReport);
  const reasons = [];
  if (policy.mutation.automated.rejectNewNoCoverage &&
    current.counts.noCoverage > comparisonBaseline.counts.noCoverage) {
    reasons.push(`NoCoverage mutants increased from ${comparisonBaseline.counts.noCoverage} to ${current.counts.noCoverage}`);
  }
  if (policy.mutation.automated.rejectScoreRegression && current.score + 0.005 < comparisonBaseline.score) {
    reasons.push(`mutation score regressed from ${comparisonBaseline.score.toFixed(2)}% to ${current.score.toFixed(2)}%`);
  }
  const currentDetected = current.counts.killed + current.counts.timeout;
  const baselineDetected = baseline.counts.killed + baseline.counts.timeout;
  if (policy.mutation.automated.requireBaselineSnapshot &&
    (Math.abs(current.score - baseline.score) >= 0.005 || currentDetected !== baselineDetected ||
      current.counts.survived !== baseline.counts.survived ||
      current.counts.noCoverage !== baseline.counts.noCoverage)) {
    reasons.push("versioned mutation baseline does not match the normalized current report");
  }
  return {
    protocol: "foundation-mutation-delta-v1",
    generatedAt: new Date().toISOString(),
    mode: policy.mutation.automated.mode,
    baseline,
    comparisonBaseline,
    current: { ...current, score: Number(current.score.toFixed(2)),
      coverageNormalized: currentReport.foundationCoverageNormalization?.protocol ===
        "foundation-mutation-coverage-v1" },
    status: reasons.length ? "fail" : "pass",
    reasons
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = resolve(ROOT, args.input || ".foundation/test-results/quality/mutation-automated.json");
  if (!existsSync(input)) throw new Error(`missing mutation report: ${repoPath(input)}`);
  const policy = readJson(resolve(ROOT, args.policy || "quality/policy.json"));
  const baseline = readJson(resolve(ROOT,
    args.baseline || "quality/baselines/dashboard-mutation-v1.json"));
  let comparisonBaseline = baseline;
  let comparisonBootstrap = false;
  if (args["base-ref"]) {
    assertSafeGitRef(args["base-ref"]);
    const baselinePath = args.baseline || "quality/baselines/dashboard-mutation-v1.json";
    try {
      comparisonBaseline = JSON.parse(execFileSync("git", ["show", `${args["base-ref"]}:${baselinePath}`], {
        cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
      }));
    } catch {
      comparisonBaseline = baseline;
      comparisonBootstrap = true;
    }
  }
  const result = evaluateMutationDelta(readJson(input), baseline, policy, comparisonBaseline);
  result.comparisonBootstrap = comparisonBootstrap;
  const output = resolve(ROOT,
    args.output || ".foundation/test-results/quality/mutation-delta.json");
  writeJson(output, result);
  process.stdout.write(`mutation delta: ${result.status}, score=${result.current.score}% -> ${repoPath(output)}\n`);
  for (const reason of result.reasons) process.stdout.write(`  ${reason}\n`);
  if (!args["no-exit"] && result.mode === "enforce" && result.status === "fail") process.exitCode = 1;
}

if (isMain(import.meta.url)) await main();
