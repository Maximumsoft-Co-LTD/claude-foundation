import { resolve } from "node:path";
import { ROOT, isMain, parseArgs, readJson, repoPath } from "./lib.mjs";
import { validateDocument } from "./validate-config.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = resolve(ROOT, args.input || ".foundation/test-results/quality/crap.json");
  const schemaPath = resolve(ROOT, args.schema || "quality/schemas/quality-report-v1.schema.json");
  const errors = validateDocument(readJson(schemaPath), readJson(reportPath));
  if (errors.length) {
    process.stderr.write(`${errors.map((error) => `${repoPath(reportPath)}: ${error}`).join("\n")}\n`);
    process.exitCode = 1;
  } else process.stdout.write(`quality report valid -> ${repoPath(reportPath)}\n`);
}

if (isMain(import.meta.url)) await main();
