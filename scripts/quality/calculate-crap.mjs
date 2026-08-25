import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { ROOT, isMain, matchesAny, parseArgs, readJson, repoPath, writeJson } from "./lib.mjs";

export function crapScore(cyclomatic, coveragePercent) {
  if (!Number.isFinite(cyclomatic) || cyclomatic < 1) throw new Error("cyclomatic must be >= 1");
  if (!Number.isFinite(coveragePercent) || coveragePercent < 0 || coveragePercent > 100) {
    throw new Error("coveragePercent must be between 0 and 100");
  }
  const uncovered = 1 - coveragePercent / 100;
  return cyclomatic ** 2 * uncovered ** 3 + cyclomatic;
}

function within(inner, outer) {
  const innerStart = inner.start || { line: inner.line, column: 0 };
  const innerEnd = inner.end || innerStart;
  const afterStart = innerStart.line > outer.start.line ||
    (innerStart.line === outer.start.line && (innerStart.column ?? 0) >= (outer.start.column ?? 0));
  const beforeEnd = innerEnd.line < outer.end.line ||
    (innerEnd.line === outer.end.line && (innerEnd.column ?? 0) <= (outer.end.column ?? Number.MAX_SAFE_INTEGER));
  return afterStart && beforeEnd;
}

function selectFunction(fileCoverage, complexity) {
  const entries = Object.entries(fileCoverage.fnMap || {});
  const sameLine = entries.filter(([, fn]) => fn.loc?.start?.line === complexity.line);
  if (sameLine.length === 1) return sameLine[0];
  if (sameLine.length > 1) {
    const named = sameLine.filter(([, fn]) => fn.name === complexity.name);
    if (named.length === 1) return named[0];
    const ordered = [...sameLine].sort((left, right) => {
      const leftColumn = left[1].loc?.start?.column ?? 0;
      const rightColumn = right[1].loc?.start?.column ?? 0;
      return Math.abs(leftColumn - complexity.column) - Math.abs(rightColumn - complexity.column);
    });
    if (ordered.length && (ordered.length === 1 ||
      Math.abs((ordered[0][1].loc?.start?.column ?? 0) - complexity.column) !==
      Math.abs((ordered[1][1].loc?.start?.column ?? 0) - complexity.column))) return ordered[0];
  }
  const containing = entries.filter(([, fn]) =>
    fn.loc?.start?.line <= complexity.line && fn.loc?.end?.line >= complexity.line);
  if (!containing.length) return null;
  return [...containing].sort((left, right) => {
    const leftSpan = left[1].loc.end.line - left[1].loc.start.line;
    const rightSpan = right[1].loc.end.line - right[1].loc.start.line;
    return leftSpan - rightSpan ||
      Math.abs((left[1].loc.start.column ?? 0) - complexity.column) -
      Math.abs((right[1].loc.start.column ?? 0) - complexity.column);
  })[0];
}

export function coverageForFunction(fileCoverage, complexity) {
  const selected = selectFunction(fileCoverage, complexity);
  if (!selected) {
    const range = {
      start: { line: complexity.line, column: Math.max(0, (complexity.column || 1) - 1) },
      end: { line: complexity.endLine || complexity.line,
        column: Math.max(0, (complexity.endColumn || Number.MAX_SAFE_INTEGER) - 1) }
    };
    const branches = Object.entries(fileCoverage.branchMap || {}).filter(([, branch]) => within(branch.loc, range));
    let branchTotal = 0;
    let branchCovered = 0;
    for (const [branchId] of branches) {
      const counts = fileCoverage.b?.[branchId] || [];
      branchTotal += counts.length;
      branchCovered += counts.filter((count) => count > 0).length;
    }
    if (branchTotal) return {
      status: "mapped-range-branch-fallback", percent: branchCovered / branchTotal * 100,
      branchTotal, branchCovered
    };
    const statements = Object.entries(fileCoverage.statementMap || {})
      .filter(([, statement]) => within(statement, range));
    if (statements.length) {
      const covered = statements.filter(([id]) => Number(fileCoverage.s?.[id] || 0) > 0).length;
      return { status: "mapped-range-statement-fallback", percent: covered / statements.length * 100,
        branchTotal: 0, branchCovered: 0 };
    }
    return { status: "unmapped", percent: null, branchTotal: 0, branchCovered: 0 };
  }
  const [functionId, fn] = selected;
  const nestedFunctions = Object.entries(fileCoverage.fnMap || {})
    .filter(([id, candidate]) => id !== functionId && within(candidate.loc, fn.loc) &&
      (candidate.loc.start.line !== fn.loc.start.line || candidate.loc.start.column !== fn.loc.start.column ||
       candidate.loc.end.line !== fn.loc.end.line || candidate.loc.end.column !== fn.loc.end.column))
    .map(([, candidate]) => candidate);
  const branches = Object.entries(fileCoverage.branchMap || {})
    .filter(([, branch]) => within(branch.loc, fn.loc) &&
      !nestedFunctions.some((nested) => within(branch.loc, nested.loc)));
  let branchTotal = 0;
  let branchCovered = 0;
  for (const [branchId] of branches) {
    const counts = fileCoverage.b?.[branchId] || [];
    branchTotal += counts.length;
    branchCovered += counts.filter((count) => count > 0).length;
  }
  if (branchTotal > 0) {
    return {
      status: "mapped",
      percent: branchCovered / branchTotal * 100,
      branchTotal,
      branchCovered
    };
  }
  const hit = Number(fileCoverage.f?.[functionId] || 0);
  return {
    status: "mapped-function-fallback",
    percent: hit > 0 ? 100 : 0,
    branchTotal: 0,
    branchCovered: 0
  };
}

export function normalizeCoverage(coverageReports, root = ROOT) {
  const files = new Map();
  for (const report of coverageReports) {
    for (const [path, value] of Object.entries(report)) files.set(repoPath(path, root), value);
  }
  return files;
}

export function buildCrapReport({ complexity, coverageReports, policy, coverageLanes = [], metadata = {}, root = ROOT }) {
  const coverage = normalizeCoverage(coverageReports, root);
  const functions = complexity.functions.map((fn) => {
    const fileCoverage = coverage.get(fn.path);
    const activeLane = coverageLanes.find((lane) => lane.active && matchesAny(fn.path, lane.include));
    const measured = fileCoverage
      ? coverageForFunction(fileCoverage, fn)
      : activeLane
        ? { status: "synthetic-zero", percent: 0, branchTotal: 0, branchCovered: 0 }
      : { status: "missing-file-coverage", percent: null, branchTotal: 0, branchCovered: 0 };
    const score = measured.percent === null ? null : crapScore(fn.cyclomatic, measured.percent);
    const status = score === null ? "unmapped"
      : score >= policy.crap.failure || fn.cyclomatic > policy.complexity.maximumChanged ? "fail"
      : score >= policy.crap.warning ? "warn" : "pass";
    return {
      ...fn,
      coverageStatus: measured.status,
      coveragePercent: measured.percent === null ? null : Number(measured.percent.toFixed(2)),
      branchCovered: measured.branchCovered,
      branchTotal: measured.branchTotal,
      coverageLane: activeLane?.id || null,
      changedCodeFloor: activeLane?.changedCodeFloor ?? null,
      crap: score === null ? null : Number(score.toFixed(2)),
      status
    };
  });
  const count = (status) => functions.filter((fn) => fn.status === status).length;
  return {
    protocol: "foundation-quality-v1",
    generatedAt: new Date().toISOString(),
    ...metadata,
    coverageKind: policy.coverage.kind,
    summary: {
      functions: functions.length,
      pass: count("pass"),
      warn: count("warn"),
      fail: count("fail"),
      unmapped: count("unmapped")
    },
    functions
  };
}

function coveragePaths(args) {
  const paths = [];
  if (args.coverage) paths.push(...String(args.coverage).split(","));
  if (args._.length) paths.push(...args._);
  return [...new Set(paths)];
}

export function resolveCoverageInputs({ requested = [], laneConfig, root = ROOT }) {
  const lanes = laneConfig?.lanes || [];
  if (requested.length) {
    const absolute = requested.map((path) => resolve(root, path));
    return {
      inputs: absolute.filter(existsSync),
      lanes: lanes.map((lane) => ({
        ...lane,
        active: absolute.some((path) => resolve(root, lane.report) === path) && existsSync(resolve(root, lane.report))
      }))
    };
  }
  return {
    inputs: lanes.map((lane) => resolve(root, lane.report)).filter(existsSync),
    lanes: lanes.map((lane) => ({ ...lane, active: existsSync(resolve(root, lane.report)) }))
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root || ROOT);
  const policy = readJson(resolve(root, args.policy || "quality/policy.json"));
  const complexity = readJson(resolve(ROOT,
    args.complexity || ".foundation/test-results/quality/complexity.json"));
  const requested = coveragePaths(args);
  const laneConfig = readJson(resolve(root, args.lanes || "quality/coverage-lanes.json"));
  const { inputs, lanes } = resolveCoverageInputs({ requested, laneConfig, root });
  const present = inputs;
  if (!present.length) throw new Error(`no coverage reports found: ${inputs.map(repoPath).join(", ")}`);
  const report = buildCrapReport({
    complexity,
    coverageReports: present.map(readJson),
    coverageLanes: lanes,
    policy,
    root,
    metadata: {
      repositoryCommit: (() => {
        if (args["repository-commit"]) return args["repository-commit"];
        try { return process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
        }).trim(); }
        catch { return null; }
      })(),
      tools: {
        node: process.version,
        c8: readJson(resolve(ROOT, "package.json")).devDependencies.c8,
        eslint: readJson(resolve(ROOT, "package.json")).devDependencies.eslint
      },
      coverageLanes: lanes.filter((lane) => lane.active).map((lane) => lane.id),
      includedPaths: policy.javascript.include,
      excludedPaths: policy.javascript.exclude
    }
  });
  const output = resolve(ROOT, args.output || ".foundation/test-results/quality/crap.json");
  writeJson(output, report);
  process.stdout.write(`CRAP: ${report.summary.functions} function(s), ${report.summary.fail} fail, ` +
    `${report.summary.warn} warn, ${report.summary.unmapped} unmapped -> ${repoPath(output)}\n`);
}

if (isMain(import.meta.url)) await main();
