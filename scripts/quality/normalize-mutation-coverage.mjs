import { resolve } from "node:path";
import { ROOT, isMain, parseArgs, readJson, repoPath, writeJson } from "./lib.mjs";

function contains(location, point) {
  const start = location.start || location;
  const end = location.end || start;
  const afterStart = point.line > start.line ||
    (point.line === start.line && (point.column ?? 0) >= (start.column ?? 0));
  const beforeEnd = point.line < end.line ||
    (point.line === end.line && (point.column ?? 0) <= (end.column ?? Number.MAX_SAFE_INTEGER));
  return afterStart && beforeEnd;
}

export function mutantExecuted(fileCoverage, mutant) {
  const point = mutant.location?.start;
  if (!point) return null;
  const statements = Object.entries(fileCoverage.statementMap || {})
    .filter(([, location]) => contains(location, point));
  if (statements.length) return statements.some(([id]) => Number(fileCoverage.s?.[id] || 0) > 0);
  const functions = Object.entries(fileCoverage.fnMap || {})
    .filter(([, fn]) => contains(fn.loc, point));
  if (functions.length) return functions.some(([id]) => Number(fileCoverage.f?.[id] || 0) > 0);
  const branches = Object.entries(fileCoverage.branchMap || {})
    .filter(([, branch]) => contains(branch.loc, point));
  if (branches.length) return branches.some(([id]) => (fileCoverage.b?.[id] || []).some((count) => count > 0));
  return null;
}

export function normalizeMutationCoverage(report, coverageReports, root = ROOT) {
  const coverage = new Map();
  for (const coverageReport of coverageReports) {
    for (const [path, value] of Object.entries(coverageReport)) coverage.set(repoPath(path, root), value);
  }
  let reclassified = 0;
  for (const [path, file] of Object.entries(report.files || {})) {
    const fileCoverage = coverage.get(path);
    for (const mutant of file.mutants || []) {
      if (mutant.status !== "Survived") continue;
      const executed = fileCoverage ? mutantExecuted(fileCoverage, mutant) : false;
      mutant.coverageEvidence = executed === null ? "unavailable" : executed ? "executed" : "not-executed";
      if (executed === false) {
        mutant.originalStatus = mutant.status;
        mutant.status = "NoCoverage";
        reclassified += 1;
      }
    }
  }
  report.foundationCoverageNormalization = {
    protocol: "foundation-mutation-coverage-v1",
    coverageReports: coverageReports.length,
    reclassified
  };
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = resolve(ROOT, args.input || ".foundation/test-results/quality/mutation-automated.json");
  const output = resolve(ROOT, args.output || input);
  const coveragePaths = String(args.coverage || "").split(",").filter(Boolean).map((path) => resolve(ROOT, path));
  if (!coveragePaths.length) throw new Error("--coverage requires at least one Istanbul JSON report");
  const report = normalizeMutationCoverage(readJson(input), coveragePaths.map(readJson));
  writeJson(output, report);
  process.stdout.write(`mutation coverage: ${report.foundationCoverageNormalization.reclassified} reclassified -> ${repoPath(output)}\n`);
}

if (isMain(import.meta.url)) await main();
