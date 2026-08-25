import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ROOT, isMain, parseArgs, readJson, repoPath } from "./lib.mjs";

export function renderSummary(report, { limit = 25, automatedMutation = null, semanticMutation = null,
  changedQuality = null, mutationDelta = null, additionalAutomatedMutations = [] } = {}) {
  const risky = [...report.functions]
    .filter((fn) => fn.status !== "pass")
    .sort((left, right) => (right.crap ?? -1) - (left.crap ?? -1))
    .slice(0, limit);
  const lines = [
    "# Code quality summary",
    "",
    `- Functions: ${report.summary.functions}`,
    `- Pass: ${report.summary.pass}`,
    `- Warning: ${report.summary.warn}`,
    `- Failure: ${report.summary.fail}`,
    `- Unmapped: ${report.summary.unmapped}`,
    `- Coverage: ${report.coverageKind}`,
    "",
    "## Highest-risk functions",
    "",
    "| Status | Function | CC | Coverage | CRAP |",
    "|---|---|---:|---:|---:|"
  ];
  for (const fn of risky) {
    lines.push(`| ${fn.status} | \`${fn.path}:${fn.line} ${fn.name}\` | ${fn.cyclomatic} | ` +
      `${fn.coveragePercent === null ? "unmapped" : `${fn.coveragePercent}%`} | ${fn.crap ?? "—"} |`);
  }
  if (!risky.length) lines.push("| pass | No warning or failure | — | — | — |");
  if (automatedMutation) {
    const mutants = Object.values(automatedMutation.files || {}).flatMap((file) => file.mutants || []);
    const count = (status) => mutants.filter((mutant) => mutant.status === status).length;
    const killed = count("Killed");
    const timedOut = count("Timeout");
    const survived = count("Survived");
    const noCoverage = count("NoCoverage");
    const denominator = killed + timedOut + survived + noCoverage;
    const score = denominator ? (killed + timedOut) / denominator * 100 : 0;
    lines.push(
      "", "## Automated mutation", "",
      `- Score: ${score.toFixed(2)}%`,
      `- Killed: ${killed}`,
      `- Timed out: ${timedOut}`,
      `- Survived: ${survived}`,
      `- No coverage: ${noCoverage}`
    );
  }
  for (const entry of additionalAutomatedMutations) {
    const mutants = Object.values(entry.report.files || {}).flatMap((file) => file.mutants || []);
    const count = (status) => mutants.filter((mutant) => mutant.status === status).length;
    const killed = count("Killed");
    const timedOut = count("Timeout");
    const survived = count("Survived");
    const noCoverage = count("NoCoverage");
    const denominator = killed + timedOut + survived + noCoverage;
    const score = denominator ? (killed + timedOut) / denominator * 100 : 0;
    lines.push("", `### ${entry.name}`, "",
      `- Score: ${score.toFixed(2)}%`, `- Killed: ${killed}`, `- Timed out: ${timedOut}`,
      `- Survived: ${survived}`, `- No coverage: ${noCoverage}`);
  }
  if (semanticMutation) {
    lines.push(
      "", "## Semantic mutation", "",
      `- Suites: ${semanticMutation.summary.suites}`,
      `- Suites killed: ${semanticMutation.summary.killed}`,
      `- Mutants: ${semanticMutation.summary.mutants}`,
      `- Mutants survived: ${semanticMutation.summary.survived}`,
      `- Mutants invalid: ${semanticMutation.summary.invalid}`
    );
  }
  if (changedQuality) {
    lines.push("", "## Changed-code gate", "",
      `- Mode: ${changedQuality.mode}`,
      `- Baseline available: ${changedQuality.baselineAvailable ? "yes" : "no"}`,
      `- Changed functions: ${changedQuality.summary.changedFunctions}`,
      `- Failures: ${changedQuality.summary.fail}`);
  }
  if (mutationDelta) {
    lines.push("", "## Mutation ratchet", "",
      `- Status: ${mutationDelta.status}`,
      `- Baseline/current: ${mutationDelta.baseline.score}% / ${mutationDelta.current.score}%`);
  }
  lines.push("", "> Project-wide legacy findings remain debt inventory; changed-code and mutation regressions are enforced.", "");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = resolve(ROOT, args.input || ".foundation/test-results/quality/crap.json");
  if (!existsSync(input)) throw new Error(`missing CRAP report: ${repoPath(input)}`);
  const output = resolve(ROOT, args.output || ".foundation/test-results/quality/summary.md");
  const automatedPath = resolve(ROOT, ".foundation/test-results/quality/mutation-automated.json");
  const semanticPath = resolve(ROOT, ".foundation/test-results/quality/mutation-semantic.json");
  const changedPath = resolve(ROOT, ".foundation/test-results/quality/changed-quality.json");
  const mutationDeltaPath = resolve(ROOT, ".foundation/test-results/quality/mutation-delta.json");
  const extraMutationPaths = [
    ["Runtime selected modules", ".foundation/test-results/quality/mutation-runtime.json"],
    ["Examples", ".foundation/test-results/quality/mutation-examples.json"],
    ["Website", ".foundation/test-results/quality/mutation-website.json"]
  ];
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, renderSummary(readJson(input), {
    automatedMutation: existsSync(automatedPath) ? readJson(automatedPath) : null,
    semanticMutation: existsSync(semanticPath) ? readJson(semanticPath) : null,
    changedQuality: existsSync(changedPath) ? readJson(changedPath) : null,
    mutationDelta: existsSync(mutationDeltaPath) ? readJson(mutationDeltaPath) : null,
    additionalAutomatedMutations: extraMutationPaths
      .filter(([, path]) => existsSync(resolve(ROOT, path)))
      .map(([name, path]) => ({ name, report: readJson(resolve(ROOT, path)) }))
  }));
  process.stdout.write(`quality summary -> ${repoPath(output)}\n`);
}

if (isMain(import.meta.url)) await main();
