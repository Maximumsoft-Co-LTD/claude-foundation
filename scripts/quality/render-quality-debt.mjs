import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ROOT, isMain, parseArgs, readJson, repoPath, writeJson } from "./lib.mjs";

const MUTATION_SCOPES = [
  ["dashboard", "mutation-automated.json"],
  ["runtime-selected", "mutation-runtime.json"],
  ["examples", "mutation-examples.json"],
  ["website", "mutation-website.json"]
];

export function buildDebtInventory({ crap, mutationReports }) {
  const highCrap = crap.functions.filter((fn) => fn.crap >= 30)
    .sort((left, right) => right.crap - left.crap)
    .map((fn) => ({ path: fn.path, line: fn.line, function: fn.name, cyclomatic: fn.cyclomatic,
      coveragePercent: fn.coveragePercent, crap: fn.crap, classification: "accepted-baseline-debt" }));
  const mutants = mutationReports.flatMap(({ scope, report }) =>
    Object.entries(report.files || {}).flatMap(([path, file]) => (file.mutants || [])
      .filter((mutant) => ["Survived", "NoCoverage"].includes(mutant.status))
      .map((mutant) => ({
        scope, path, line: mutant.location?.start?.line ?? null, id: mutant.id,
        mutator: mutant.mutatorName, status: mutant.status,
        classification: mutant.status === "NoCoverage" ? "test-coverage-gap" : "accepted-baseline-debt"
      }))));
  return {
    protocol: "foundation-quality-debt-v1", generatedAt: new Date().toISOString(),
    summary: {
      highCrap: highCrap.length,
      survivedMutants: mutants.filter((mutant) => mutant.status === "Survived").length,
      noCoverageMutants: mutants.filter((mutant) => mutant.status === "NoCoverage").length
    },
    highCrap,
    mutants
  };
}

export function renderDebt(inventory, limit = 100) {
  const lines = [
    "# Quality debt inventory", "",
    `- High-CRAP functions: ${inventory.summary.highCrap}`,
    `- Survived mutants: ${inventory.summary.survivedMutants}`,
    `- No-coverage mutants: ${inventory.summary.noCoverageMutants}`,
    "", "Existing rows are accepted baseline debt, not exceptions. New regressions remain blocked by the ratchets.",
    "", "## Highest CRAP debt", "", "| Function | CC | Coverage | CRAP |", "|---|---:|---:|---:|"
  ];
  for (const item of inventory.highCrap.slice(0, limit)) lines.push(
    `| \`${item.path}:${item.line} ${item.function}\` | ${item.cyclomatic} | ${item.coveragePercent ?? "unmapped"}% | ${item.crap} |`);
  lines.push("", "## Survived and no-coverage mutants", "", "| Scope | Location | Mutator | Status |", "|---|---|---|---|");
  for (const item of inventory.mutants.slice(0, limit)) lines.push(
    `| ${item.scope} | \`${item.path}:${item.line ?? "?"}\` | ${item.mutator} | ${item.status} |`);
  if (inventory.mutants.length > limit) lines.push("", `_Showing ${limit} of ${inventory.mutants.length} mutant debt rows; the JSON artifact contains all rows._`);
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const directory = resolve(ROOT, args.directory || ".foundation/test-results/quality");
  const crap = readJson(resolve(directory, "crap.json"));
  const mutationReports = MUTATION_SCOPES.map(([scope, name]) => ({ scope, path: resolve(directory, name) }))
    .filter(({ path }) => existsSync(path)).map(({ scope, path }) => ({ scope, report: readJson(path) }));
  const inventory = buildDebtInventory({ crap, mutationReports });
  const jsonOutput = resolve(directory, "debt.json");
  const markdownOutput = resolve(directory, "debt.md");
  writeJson(jsonOutput, inventory);
  mkdirSync(dirname(markdownOutput), { recursive: true });
  writeFileSync(markdownOutput, renderDebt(inventory, Number(args.limit || 100)));
  process.stdout.write(`quality debt: ${inventory.summary.highCrap} CRAP, ${inventory.summary.survivedMutants} survived -> ${repoPath(markdownOutput)}\n`);
}

if (isMain(import.meta.url)) await main();
