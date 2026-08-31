import { spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCrapReport } from "../../../../scripts/quality/calculate-crap.mjs";
import { collectComplexity } from "../../../../scripts/quality/collect-complexity.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return null; }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function javascriptIncludes(workspace) {
  return ["src", "bin"].flatMap((directory) => {
    const path = join(workspace, directory);
    if (!existsSync(path)) return [];
    const extensions = new Set(readdirSync(path, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name.match(/\.(js|mjs|cjs)$/)?.[1])
      .filter(Boolean));
    return [...extensions].sort().map((extension) =>
      `${directory}/**/*.${extension}`);
  });
}

export function benchmarkWorkspace(project, changeId) {
  const sandbox = changeId && join(project, ".foundation/sandboxes", changeId);
  return sandbox && existsSync(join(sandbox, "package.json")) ? sandbox : project;
}

export async function collectBenchmarkQuality({ project, changeId }) {
  const workspace = benchmarkWorkspace(project, changeId);
  const manifest = readJson(join(workspace, "package.json"));
  const includes = javascriptIncludes(workspace);
  if (!manifest?.scripts?.test || !includes.length) return null;

  const outputDir = join(project, ".foundation/test-results/quality");
  const coverageDir = join(outputDir, "benchmark-coverage");
  const coveragePath = join(coverageDir, "coverage-final.json");
  const policyPath = join(outputDir, "benchmark-policy.json");
  const reportPath = join(outputDir, "crap.json");
  const diagnosticPath = join(outputDir, "benchmark-collector.json");
  const policy = {
    javascript: {
      include: includes,
      exclude: ["**/node_modules/**", "**/test/**", "**/tests/**",
        "**/*.test.js", "**/*.test.mjs", ".foundation/**", ".claude/**",
        "openspec/**"]
    },
    complexity: { variant: "classic", warning: 11, refactor: 21,
      maximumChanged: 30 },
    coverage: { kind: "branch-with-function-fallback",
      changedCodeFloors: { unit: 80, integration: 70, criticalJourneys: 50 } },
    crap: { mode: "enforce", warning: 20, failure: 30,
      rejectRegression: true }
  };
  writeJson(policyPath, policy);
  mkdirSync(coverageDir, { recursive: true });
  const c8 = join(ROOT, "node_modules/.bin/c8");
  if (!existsSync(c8)) {
    writeJson(diagnosticPath, { status: "unavailable", reason: "c8-not-installed" });
    return null;
  }
  const args = ["--all", "--reporter=json", `--report-dir=${coverageDir}`];
  for (const pattern of includes) args.push(`--include=${pattern}`);
  for (const pattern of policy.javascript.exclude) args.push(`--exclude=${pattern}`);
  args.push("npm", "test", "--silent");
  const execution = spawnSync(c8, args, {
    cwd: workspace, encoding: "utf8", timeout: 120_000,
    env: { ...process.env, FOUNDATION_TELEMETRY: "0" },
    maxBuffer: 10 * 1024 * 1024
  });
  if (execution.status !== 0 || !existsSync(coveragePath)) {
    writeJson(diagnosticPath, {
      status: "unavailable", reason: execution.error?.code === "ETIMEDOUT"
        ? "quality-test-timeout" : "quality-test-failed",
      exitCode: execution.status, signal: execution.signal,
      stderr: String(execution.stderr || "").slice(-4000)
    });
    return null;
  }
  try {
    const complexity = await collectComplexity({ root: workspace, policyPath });
    const report = buildCrapReport({
      complexity,
      coverageReports: [readJson(coveragePath)],
      coverageLanes: [{ id: "benchmark-node", report: coveragePath,
        include: includes, changedCodeFloor: 80, required: true, active: true }],
      policy, root: workspace,
      metadata: { collector: "openspec-native-node-quality-v1", changeId,
        workspace: workspace === project ? "project" : "sandbox" }
    });
    writeJson(reportPath, report);
    writeJson(diagnosticPath, { status: "measured", functions: report.summary.functions,
      report: reportPath });
    return report;
  } catch (error) {
    writeJson(diagnosticPath, { status: "unavailable",
      reason: "quality-analysis-failed", message: error.message });
    return null;
  }
}
