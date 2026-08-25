import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, isMain, parseArgs, readJson, repoPath, writeJson } from "./lib.mjs";
import { mutationCounts } from "./evaluate-mutation-delta.mjs";

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

export function trendPoint({ crap, automatedMutation = null, semanticMutation = null, commit = null }) {
  const scores = crap.functions.map((fn) => fn.crap).filter(Number.isFinite);
  const automated = automatedMutation ? mutationCounts(automatedMutation) : null;
  return {
    recordedAt: new Date().toISOString(),
    commit,
    functions: crap.summary.functions,
    highCrap: crap.functions.filter((fn) => fn.crap >= 30).length,
    unmapped: crap.summary.unmapped,
    medianCrap: percentile(scores, 0.5),
    p90Crap: percentile(scores, 0.9),
    mutationScore: automated ? Number(automated.score.toFixed(2)) : null,
    survivedMutants: automated?.counts.survived ?? null,
    noCoverageMutants: automated?.counts.noCoverage ?? null,
    semanticKillRate: semanticMutation?.summary?.suites
      ? Number((semanticMutation.summary.killed / semanticMutation.summary.suites * 100).toFixed(2)) : null
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const crap = readJson(resolve(ROOT, args.input || ".foundation/test-results/quality/crap.json"));
  const automatedPath = resolve(ROOT, ".foundation/test-results/quality/mutation-automated.json");
  const automatedPaths = [automatedPath,
    resolve(ROOT, ".foundation/test-results/quality/mutation-runtime.json"),
    resolve(ROOT, ".foundation/test-results/quality/mutation-examples.json"),
    resolve(ROOT, ".foundation/test-results/quality/mutation-website.json")];
  const semanticPath = resolve(ROOT, ".foundation/test-results/quality/mutation-semantic.json");
  const historyPath = resolve(ROOT, args.history || ".foundation/quality-history/history.json");
  const history = existsSync(historyPath) ? readJson(historyPath) : {
    protocol: "foundation-quality-trend-v1", points: []
  };
  history.points.push(trendPoint({
    crap,
    automatedMutation: automatedPaths.some(existsSync) ? {
      files: Object.fromEntries(automatedPaths.filter(existsSync).flatMap((path, reportIndex) =>
        Object.entries(readJson(path).files || {}).map(([name, file]) => [`${reportIndex}:${name}`, file])))
    } : null,
    semanticMutation: existsSync(semanticPath) ? readJson(semanticPath) : null,
    commit: args.commit || process.env.GITHUB_SHA || null
  }));
  history.points = history.points.slice(-180);
  writeJson(historyPath, history);
  const output = resolve(ROOT, args.output || ".foundation/test-results/quality/trend.json");
  writeJson(output, history);
  process.stdout.write(`quality trend: ${history.points.length} point(s) -> ${repoPath(output)}\n`);
}

if (isMain(import.meta.url)) await main();
