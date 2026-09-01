import { spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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
  const ignored = new Set([
    ".claude", ".foundation", ".git", "node_modules", "openspec",
    "test", "tests", "__tests__"
  ]);
  const extensions = new Set();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && (ignored.has(entry.name) || entry.name.startsWith(".quality-")))
        continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (!/\.(?:test|spec)\.(?:js|mjs|cjs)$/.test(entry.name)) {
        const extension = entry.name.match(/\.(js|mjs|cjs)$/)?.[1];
        if (extension) extensions.add(extension);
      }
    }
  };
  visit(workspace);
  return [...extensions].sort().map((extension) => `**/*.${extension}`);
}

function nodeTestFiles(workspace) {
  const ignored = new Set([".claude", ".foundation", ".git", "node_modules", "openspec"]);
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignored.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:test|spec)\.(?:js|mjs|cjs)$/.test(entry.name))
        files.push(relative(workspace, path));
    }
  };
  visit(workspace);
  return files.sort();
}

export function benchmarkWorkspace(project, changeId) {
  const projectRoot = resolve(project);
  const sandbox = changeId && join(projectRoot, ".foundation/sandboxes", changeId);
  return sandbox && existsSync(sandbox) ? sandbox : projectRoot;
}

export async function collectBenchmarkQuality({ project, changeId }) {
  const projectRoot = resolve(project);
  const workspace = benchmarkWorkspace(project, changeId);
  const manifest = readJson(join(workspace, "package.json"));
  const includes = javascriptIncludes(workspace);
  const outputDir = join(projectRoot, ".foundation/test-results/quality");
  const coverageDir = join(outputDir, "benchmark-coverage");
  const coveragePath = join(coverageDir, "coverage-final.json");
  const policyPath = join(outputDir, "benchmark-policy.json");
  const reportPath = join(outputDir, "crap.json");
  const diagnosticPath = join(outputDir, "benchmark-collector.json");
  const discoveredTests = manifest?.scripts?.test ? [] : nodeTestFiles(workspace);
  if (!includes.length || (!manifest?.scripts?.test && !discoveredTests.length)) {
    writeJson(diagnosticPath, { status: "unavailable", reason: !includes.length
      ? "no-production-javascript" : "no-node-test-entrypoint" });
    return null;
  }
  const policy = {
    javascript: {
      include: includes,
      exclude: ["**/node_modules/**", "**/test/**", "**/tests/**",
        "**/*.test.js", "**/*.test.mjs", "**/*.test.cjs",
        "**/*.spec.js", "**/*.spec.mjs", "**/*.spec.cjs",
        ".foundation/**", ".claude/**", "openspec/**"]
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
  // An outer repository coverage run exports NODE_V8_COVERAGE. c8 otherwise
  // adopts that inherited directory and cleans it before this nested collector
  // starts, erasing coverage from every suite that already completed.
  const args = ["--all", "--reporter=json", `--report-dir=${coverageDir}`,
    `--temp-directory=${join(coverageDir, "tmp")}`];
  for (const pattern of includes) args.push(`--include=${pattern}`);
  for (const pattern of policy.javascript.exclude) args.push(`--exclude=${pattern}`);
  if (manifest?.scripts?.test) args.push("npm", "test", "--silent");
  // c8 treats an absolute Node executable as a child binary and can leave only
  // raw tmp coverage without running its final report hook. The PATH-resolved
  // `node` spelling preserves c8's normal Node command lifecycle.
  else args.push("node", "--test", ...discoveredTests);
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
