import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, isMain, parseArgs, readJson } from "./lib.mjs";

export function qualityFailures({ changed, automatedMutation, semanticMutation, requireBase = true }) {
  const failures = [];
  if (!changed) failures.push("changed-code report is missing");
  else {
    if (requireBase && !changed.baselineAvailable) failures.push("merge-base quality report is missing");
    if (changed.summary.fail > 0) failures.push(`${changed.summary.fail} changed function(s) violate policy`);
  }
  if (!automatedMutation) failures.push("automated mutation delta is missing");
  else {
    if (!automatedMutation.current?.coverageNormalized) failures.push("automated mutant coverage was not normalized");
    if (automatedMutation.status !== "pass") failures.push(...automatedMutation.reasons);
  }
  if (!semanticMutation) failures.push("semantic mutation report is missing");
  else if (semanticMutation.summary.killed !== semanticMutation.summary.suites ||
    semanticMutation.summary.invalid || semanticMutation.summary.survived) {
    failures.push("required semantic mutation evidence is incomplete");
  }
  return failures;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const load = (path) => existsSync(resolve(ROOT, path)) ? readJson(resolve(ROOT, path)) : null;
  const failures = qualityFailures({
    changed: load(args.changed || ".foundation/test-results/quality/changed-quality.json"),
    automatedMutation: load(args.mutation || ".foundation/test-results/quality/mutation-delta.json"),
    semanticMutation: load(args.semantic || ".foundation/test-results/quality/mutation-semantic.json"),
    requireBase: args["allow-missing-base"] !== true
  });
  if (failures.length) {
    process.stderr.write(`quality gate failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
    process.exitCode = 1;
  } else process.stdout.write("quality gate: PASS\n");
}

if (isMain(import.meta.url)) await main();
