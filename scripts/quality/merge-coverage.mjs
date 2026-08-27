import { resolve } from "node:path";
import { ROOT, isMain, parseArgs, readJson, repoPath, writeJson } from "./lib.mjs";

export function mergeCoverageReports(reports) {
  const merged = {};
  for (const report of reports) {
    for (const [path, coverage] of Object.entries(report)) {
      if (Object.hasOwn(merged, path))
        throw new Error(`coverage path appears in more than one report: ${path}`);
      merged[path] = coverage;
    }
  }
  return merged;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.output || args._.length < 2)
    throw new Error("usage: merge-coverage --output <coverage-final.json> <report> <report> [...]");
  const inputs = args._.map((path) => resolve(ROOT, path));
  const output = resolve(ROOT, args.output);
  writeJson(output, mergeCoverageReports(inputs.map(readJson)));
  process.stdout.write(`coverage merge: ${inputs.length} reports -> ${repoPath(output)}\n`);
}

if (isMain(import.meta.url)) await main();
