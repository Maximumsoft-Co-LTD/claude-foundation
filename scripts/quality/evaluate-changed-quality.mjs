import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { ROOT, isMain, parseArgs, readJson, repoPath, writeJson } from "./lib.mjs";

export function parseChangedLines(diff) {
  const changed = new Map();
  let path = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      path = line.slice(6);
      if (!changed.has(path)) changed.set(path, []);
      continue;
    }
    if (!path || !line.startsWith("@@")) continue;
    const match = line.match(/\+(\d+)(?:,(\d+))?/);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count > 0) changed.get(path).push({ start, end: start + count - 1 });
  }
  return changed;
}

function findBaseFunction(fn, baseReport) {
  const candidates = (baseReport?.functions || []).filter((base) => base.path === fn.path && base.name === fn.name);
  if (!candidates.length) return null;
  return [...candidates].sort((left, right) => Math.abs(left.line - fn.line) - Math.abs(right.line - fn.line))[0];
}

function exceptionFor(fn, exceptions, metric) {
  return (exceptions?.exceptions || []).find((entry) => entry.path === fn.path &&
    entry.functionOrMutant === fn.name && entry.metric === metric);
}

export function evaluateChangedFunctions(report, changedLines, policy, { baseReport = null, exceptions = null } = {}) {
  const changedFunctions = report.functions.filter((fn) => {
    const ranges = changedLines.get(fn.path) || [];
    return ranges.some((range) => range.start <= (fn.endLine || fn.line) && range.end >= fn.line);
  }).map((fn) => {
    const reasons = [];
    const base = findBaseFunction(fn, baseReport);
    const isNew = Boolean(baseReport) && !base;
    if (fn.coveragePercent === null) reasons.push("coverage is unmapped");
    if (fn.coveragePercent !== null && fn.changedCodeFloor !== null &&
      fn.coveragePercent < fn.changedCodeFloor && !exceptionFor(fn, exceptions, "coverage")) {
      reasons.push(`coverage ${fn.coveragePercent}% is below ${fn.changedCodeFloor}%`);
    }
    if (fn.cyclomatic > policy.complexity.maximumChanged && !exceptionFor(fn, exceptions, "complexity")) {
      reasons.push(`cyclomatic ${fn.cyclomatic} exceeds ${policy.complexity.maximumChanged}`);
    }
    if (isNew && fn.crap !== null && fn.crap >= policy.crap.failure && !exceptionFor(fn, exceptions, "crap")) {
      reasons.push(`CRAP ${fn.crap} is at or above ${policy.crap.failure}`);
    }
    if (base && policy.crap.rejectRegression && fn.crap !== null && base.crap !== null &&
      fn.crap > base.crap + 0.01 && !exceptionFor(fn, exceptions, "crap")) {
      reasons.push(`CRAP regressed from ${base.crap} to ${fn.crap}`);
    }
    return {
      ...fn,
      baseline: base ? { line: base.line, cyclomatic: base.cyclomatic, coveragePercent: base.coveragePercent, crap: base.crap } : null,
      changeKind: isNew ? "new" : base ? "existing" : "unknown",
      reasons,
      changedStatus: reasons.length ? "fail" : "pass"
    };
  });
  return {
    mode: policy.crap.mode,
    baselineAvailable: Boolean(baseReport),
    summary: {
      changedFunctions: changedFunctions.length,
      pass: changedFunctions.filter((fn) => fn.changedStatus === "pass").length,
      fail: changedFunctions.filter((fn) => fn.changedStatus === "fail").length
    },
    functions: changedFunctions
  };
}

function gitDiff(baseRef) {
  const args = ["diff", "--unified=0", "--no-ext-diff"];
  if (baseRef) args.push(`${baseRef}...HEAD`);
  else args.push("HEAD");
  args.push("--");
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = readJson(resolve(ROOT, args.policy || "quality/policy.json"));
  const report = readJson(resolve(ROOT, args.input || ".foundation/test-results/quality/crap.json"));
  const basePath = resolve(ROOT, args["base-report"] || ".foundation/test-results/quality/base-crap.json");
  const exceptionPath = resolve(ROOT, args.exceptions || "quality/exceptions.json");
  let baseReport = null;
  try { baseReport = readJson(basePath); } catch { baseReport = null; }
  const evaluation = evaluateChangedFunctions(report, parseChangedLines(gitDiff(args["base-ref"])), policy, {
    baseReport,
    exceptions: readJson(exceptionPath)
  });
  evaluation.repositoryCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  evaluation.mergeBase = args["base-ref"]
    ? execFileSync("git", ["merge-base", args["base-ref"], "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
    : null;
  const output = resolve(ROOT, args.output || ".foundation/test-results/quality/changed-quality.json");
  writeJson(output, evaluation);
  process.stdout.write(`changed quality: ${evaluation.summary.changedFunctions} function(s), ` +
    `${evaluation.summary.fail} finding(s), mode=${evaluation.mode} -> ${repoPath(output)}\n`);
  for (const fn of evaluation.functions.filter((item) => item.changedStatus === "fail")) {
    process.stdout.write(`  ${fn.path}:${fn.line} ${fn.name}: ${fn.reasons.join("; ")}\n`);
  }
  if (!args["no-exit"] && evaluation.mode === "enforce" && (evaluation.summary.fail > 0 ||
    (args["require-base"] && !evaluation.baselineAvailable))) process.exitCode = 1;
}

if (isMain(import.meta.url)) await main();
