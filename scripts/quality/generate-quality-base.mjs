import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ROOT, isMain, parseArgs, repoPath } from "./lib.mjs";

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status}`);
}

export function resolveBaseCommit(baseRef) {
  if (!/^[A-Za-z0-9_./-]+$/.test(baseRef)) throw new Error(`unsafe base ref: ${baseRef}`);
  return execFileSync("git", ["merge-base", baseRef, "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function changedSince(commit, paths) {
  const result = spawnSync("git", ["diff", "--quiet", `${commit}...HEAD`, "--", ...paths], { cwd: ROOT });
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  throw new Error(`git diff failed with exit ${result.status}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseRef = args["base-ref"] || "HEAD^";
  const commit = resolveBaseCommit(baseRef);
  const temporary = mkdtempSync(join(tmpdir(), "foundation-quality-base-"));
  const archive = join(temporary, "source");
  let worktreeCreated = false;
  try {
    run("git", ["worktree", "add", "--detach", archive, commit], ROOT);
    worktreeCreated = true;
    symlinkSync(resolve(ROOT, "node_modules"), join(archive, "node_modules"), "dir");

    const c8 = resolve(ROOT, "node_modules/.bin/c8");
    const dashboardTests = readdirSync(join(archive, "dashboard/test"))
      .filter((name) => name.endsWith(".test.js") || name.endsWith(".test.mjs"))
      .map((name) => `dashboard/test/${name}`);
    run(c8, [
      "--include=dashboard/*.js", "--include=dashboard/*.mjs", "--include=dashboard/public/*.js",
      "--exclude=dashboard/test/**", "--reporter=json",
      "--report-dir=.foundation/test-results/quality/coverage-dashboard",
      "node", "--test", ...dashboardTests
    ], archive);

    const coverageReports = [join(archive,
      ".foundation/test-results/quality/coverage-dashboard/coverage-final.json")];
    if (existsSync(join(archive, "examples/todolist/test"))) {
      const tests = readdirSync(join(archive, "examples/todolist/test"))
        .filter((name) => name.endsWith(".test.mjs")).map((name) => `examples/todolist/test/${name}`);
      run(c8, ["--include=examples/**/*.js", "--exclude=examples/**/test/**", "--exclude=examples/**/tests/**", "--reporter=json",
        "--report-dir=.foundation/test-results/quality/coverage-examples", "node", "--test", ...tests], archive);
      coverageReports.push(join(archive,
        ".foundation/test-results/quality/coverage-examples/coverage-final.json"));
    }
    if (existsSync(join(archive, "website/demo/test"))) {
      const tests = readdirSync(join(archive, "website/demo/test"))
        .filter((name) => name.endsWith(".test.mjs")).map((name) => `website/demo/test/${name}`);
      run(c8, ["--include=website/*.js", "--include=website/demo/src/**/*.js", "--exclude=website/**/test/**", "--reporter=json",
        "--report-dir=.foundation/test-results/quality/coverage-website", "node", "--test", ...tests], archive);
      coverageReports.push(join(archive,
        ".foundation/test-results/quality/coverage-website/coverage-final.json"));
    }
    if (changedSince(commit, [".claude/harness", ".claude/hooks"])) {
      run(c8, ["--include=.claude/harness/foundation.mjs", "--include=.claude/harness/runtime/**/*.mjs",
        "--include=.claude/hooks/**/*.mjs", "--exclude=.claude/**/tests/**", "--reporter=json",
        "--report-dir=.foundation/test-results/quality/coverage-runtime", "sh", ".claude/tests/run-all.sh"], archive);
      coverageReports.push(join(archive,
        ".foundation/test-results/quality/coverage-runtime/coverage-final.json"));
    }

    const complexityOutput = resolve(ROOT, ".foundation/test-results/quality/base-complexity.json");
    run(process.execPath, [
      resolve(ROOT, "scripts/quality/collect-complexity.mjs"),
      `--root=${archive}`, `--policy=${resolve(ROOT, "quality/policy.json")}`, `--output=${complexityOutput}`
    ], ROOT);
    const crapOutput = resolve(ROOT, args.output || ".foundation/test-results/quality/base-crap.json");
    run(process.execPath, [
      resolve(ROOT, "scripts/quality/calculate-crap.mjs"),
      `--root=${archive}`, `--policy=${resolve(ROOT, "quality/policy.json")}`,
      `--lanes=${resolve(ROOT, "quality/coverage-lanes.json")}`,
      `--complexity=${complexityOutput}`,
      `--coverage=${coverageReports.join(",")}`,
      `--repository-commit=${commit}`,
      `--output=${crapOutput}`
    ], ROOT);
    process.stdout.write(`merge-base quality: ${commit} -> ${repoPath(crapOutput)}\n`);
  } finally {
    if (worktreeCreated) spawnSync("git", ["worktree", "remove", "--force", archive], {
      cwd: ROOT, encoding: "utf8"
    });
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) await main();
