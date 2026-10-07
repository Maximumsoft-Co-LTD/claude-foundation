#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, statSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { executionPlan, loadMatrix, matrixIssues } from "./matrix.mjs";
import { benchArm } from "./scorecard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const DEFAULT_RESULTS = join(ROOT, ".claude/tests/bench/results/openspec-native-lab");

function stableFiles(root) {
  const rows = [];
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = join(path, entry.name);
      if (entry.isDirectory() && entry.name !== "__pycache__") visit(absolute);
      else if (entry.isFile() && !entry.name.endsWith(".pyc")) rows.push(absolute);
    }
  }
  visit(root);
  return rows;
}

export function directoryDigest(root) {
  const hash = createHash("sha256");
  for (const path of stableFiles(root)) {
    hash.update(relative(root, path));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function fileDigest(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function writeIntegrity(runDir) {
  const files = Object.fromEntries(stableFiles(runDir)
    .filter((path) => relative(runDir, path) !== "integrity.json")
    .map((path) => [relative(runDir, path), fileDigest(path)]));
  const value = { version: 1, algorithm: "sha256", files };
  writeFileSync(join(runDir, "integrity.json"), `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

function commandResult(command, args, cwd, env = process.env) {
  return spawnSync(command, args, { cwd, encoding: "utf8", env });
}

// A source-checkout install puts no `claude-foundation` on PATH, but every
// command the agent follows names it. Give the run the same CLI a Homebrew
// install provides, pointing at this checkout's cli.sh.
function cliShimEnv(runDir) {
  const bin = join(runDir, "bin");
  mkdirSync(bin, { recursive: true });
  const shim = join(bin, "claude-foundation");
  writeFileSync(shim, `#!/bin/sh\nexec "${join(ROOT, "cli.sh")}" "$@"\n`);
  chmodSync(shim, 0o755);
  return { ...process.env, PATH: `${bin}:${process.env.PATH || ""}` };
}

function sourceRevision(root = ROOT) {
  const commit = commandResult("git", ["rev-parse", "HEAD"], root);
  const patch = commandResult("git", ["diff", "--binary", "HEAD"], root);
  const patchText = patch.status === 0 ? patch.stdout : "";
  return {
    commit: commit.status === 0 ? commit.stdout.trim() : null,
    dirty: Boolean(patchText.trim()),
    patch: patchText,
    patchDigest: `sha256:${createHash("sha256").update(patchText).digest("hex")}`
  };
}

function requireSuccess(result, label) {
  if (result.status === 0) return;
  throw new Error(`${label} failed (${result.status ?? "signal"}): ${
    String(result.stderr || result.stdout || "no output").trim()}`);
}

export function cleanRoomCommandContract(scenario) {
  return {
    version: 1,
    command: scenario.clean_install_command,
    timeoutMs: Number(scenario.clean_install_timeout_ms || 10 * 60 * 1000),
    cachePolicy: "isolated-disposable",
    networkPolicy: scenario.clean_install_network || "allowed-with-timeout"
  };
}

export function shellCheck(command, cwd, { timeoutMs = 10 * 60 * 1000,
  env = process.env } = {}) {
  if (!command || command === "not-applicable")
    return { status: "not-applicable", exitCode: null, durationMs: 0 };
  const started = performance.now();
  const result = spawnSync("sh", ["-c", command], {
    cwd, encoding: "utf8", env, timeout: timeoutMs
  });
  const unavailable = Boolean(result.error) || [126, 127].includes(result.status);
  return {
    status: result.status === 0 ? "pass" : unavailable ? "unavailable" : "fail",
    exitCode: result.status,
    durationMs: Number((performance.now() - started).toFixed(3)),
    reason: result.error?.message || (unavailable ? "command-unavailable" : null),
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function deliveryChecks(scenario, project, tempParent) {
  const projectCommand = shellCheck(scenario.project_command, project);
  const contract = cleanRoomCommandContract(scenario);
  if (scenario.clean_install_command === "not-applicable") return {
    contract,
    projectCommand,
    cleanInstall: { status: "not-applicable", exitCode: null, durationMs: 0 },
    cleanInstallProjectCommand: { status: "not-applicable", exitCode: null, durationMs: 0 }
  };
  const clean = mkdtempSync(join(tempParent, "foundation-clean-room-"));
  const cache = mkdtempSync(join(tempParent, "foundation-clean-cache-"));
  try {
    cpSync(project, clean, { recursive: true });
    rmSync(join(clean, ".foundation"), { recursive: true, force: true });
    rmSync(join(clean, ".claude"), { recursive: true, force: true });
    const cleanEnv = {
      ...process.env,
      npm_config_cache: join(cache, "npm"),
      NPM_CONFIG_CACHE: join(cache, "npm"),
      PIP_CACHE_DIR: join(cache, "pip"),
      XDG_CACHE_HOME: join(cache, "xdg")
    };
    const cleanInstall = shellCheck(contract.command, clean, {
      timeoutMs: contract.timeoutMs, env: cleanEnv
    });
    const cleanInstallProjectCommand = cleanInstall.status === "pass"
      ? shellCheck(scenario.project_command, clean, {
          timeoutMs: contract.timeoutMs, env: cleanEnv
        })
      : { status: "not-run", exitCode: null, durationMs: 0 };
    return { contract, projectCommand, cleanInstall, cleanInstallProjectCommand };
  } finally {
    rmSync(clean, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--keep-project") { flags.keepProject = true; continue; }
    if (value === "--dry-run") { flags.dryRun = true; continue; }
    if (!value.startsWith("--") || index + 1 >= argv.length)
      throw new Error(`${value} requires a --name value form`);
    flags[value.slice(2)] = argv[++index];
  }
  return flags;
}

export function prepareLabProject({ fixture, installer = join(ROOT, "install.sh"),
  tempParent = tmpdir(), projectCommand = null }) {
  const source = resolve(fixture);
  if (!existsSync(source) || !statSync(source).isDirectory())
    throw new Error(`fixture seed does not exist: ${source}`);
  const project = mkdtempSync(join(tempParent, "foundation-consumer-lab-"));
  cpSync(source, project, { recursive: true });
  const installed = commandResult(installer, [project, "--yes"], ROOT);
  try { requireSuccess(installed, "Foundation install"); }
  catch (error) { rmSync(project, { recursive: true, force: true }); throw error; }
  writeFileSync(join(project, ".foundation-benchmark.json"),
    `${JSON.stringify({
      disposable: true,
      createdBy: "openspec-native-lab-v1",
      projectCommand
    })}\n`);
  return { project, seedDigest: directoryDigest(source) };
}

// The no-harness arm: the same frozen seed and the same disposable marker, but
// nothing is installed. The seed becomes one local Git commit so the agent can
// use read-only Git like any user repository and the lab can keep the product
// diff; the marker stays out of that history.
export function prepareBaselineProject({ fixture, tempParent = tmpdir(), projectCommand = null }) {
  const source = resolve(fixture);
  if (!existsSync(source) || !statSync(source).isDirectory())
    throw new Error(`fixture seed does not exist: ${source}`);
  const project = mkdtempSync(join(tempParent, "foundation-baseline-lab-"));
  try {
    cpSync(source, project, { recursive: true });
    const gitEnv = {
      ...process.env, GIT_AUTHOR_NAME: "bench", GIT_AUTHOR_EMAIL: "bench@example.invalid",
      GIT_COMMITTER_NAME: "bench", GIT_COMMITTER_EMAIL: "bench@example.invalid"
    };
    requireSuccess(commandResult("git", ["init", "-q"], project, gitEnv), "baseline git init");
    writeFileSync(join(project, ".git/info/exclude"), ".foundation-benchmark.json\n");
    requireSuccess(commandResult("git", ["add", "-A"], project, gitEnv), "baseline git add");
    requireSuccess(commandResult("git", ["-c", "commit.gpgsign=false", "commit", "-q",
      "--allow-empty", "-m", "seed"], project, gitEnv), "baseline git commit");
    writeFileSync(join(project, ".foundation-benchmark.json"),
      `${JSON.stringify({
        disposable: true,
        createdBy: "openspec-native-lab-v1",
        arm: "baseline",
        projectCommand
      })}\n`);
  } catch (error) {
    rmSync(project, { recursive: true, force: true });
    throw error;
  }
  return { project, seedDigest: directoryDigest(source) };
}

// What a plain user approves for this task: edits inside the project, the
// project's own interpreter/test runner, `npm test` when a manifest declares
// it, and read-only Git. Nothing else is pre-approved.
export function baselineAllowedTools({ project, projectCommand }) {
  const command = String(projectCommand || "").trim();
  const runner = command.split(/\s+/)[0];
  const rules = ["Edit(/**)"];
  if (runner) rules.push(`Bash(${runner} *)`);
  if (command && command !== runner) rules.push(`Bash(${command})`);
  try {
    if (JSON.parse(readFileSync(join(project, "package.json"), "utf8"))?.scripts?.test)
      rules.push("Bash(npm test)", "Bash(npm test *)");
  } catch { /* no npm manifest */ }
  for (const verb of ["status", "diff", "log", "show"])
    rules.push(`Bash(git ${verb})`, `Bash(git ${verb} *)`);
  return [...new Set(rules)];
}

function productPatch(project) {
  if (!existsSync(join(project, ".git"))) return "";
  commandResult("git", ["add", "-A", "--intent-to-add"], project);
  const diff = commandResult("git", ["diff", "--binary", "HEAD"], project);
  return diff.status === 0 ? diff.stdout : "";
}

function copyIfPresent(source, target) {
  if (!existsSync(source)) return false;
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  return true;
}

export function preserveLabEvidence({
  project, runDir, manifest, runnerOutput = null, sourcePatch = "", deliveredPatch = null
}) {
  mkdirSync(runDir, { recursive: true });
  const evidence = join(runDir, "evidence");
  const retained = [];
  for (const path of [
    ".foundation/runtime", ".foundation/receipts", ".foundation/land",
    ".foundation/logs", ".foundation/test-results", ".foundation/install-manifest.txt",
    "openspec/changes"
  ]) {
    if (copyIfPresent(join(project, path), join(evidence, path))) retained.push(path);
  }
  const value = { ...manifest, retained, runnerOutput };
  writeFileSync(join(runDir, "source.patch"), sourcePatch);
  if (deliveredPatch !== null) writeFileSync(join(runDir, "product.patch"), deliveredPatch);
  writeFileSync(join(runDir, "manifest.json"), `${JSON.stringify(value, null, 2)}\n`);
  writeIntegrity(runDir);
  return value;
}

// A trusted workspace applies the allowlist the installer seeded; a fresh
// disposable consumer is untrusted, so headless Claude ignores it. Hand the
// host exactly those installed rules so a measured permission prompt is one
// the shipped install would raise, not one the lab caused by granting less
// (for example `.foundation/bin/claude-foundation`, the installed CLI shim).
export function installedAllowedTools(project) {
  try {
    const allow = JSON.parse(readFileSync(join(project, ".claude/settings.json"), "utf8"))
      ?.permissions?.allow;
    const rules = Array.isArray(allow)
      ? allow.filter((rule) => typeof rule === "string" && rule.trim()) : [];
    return rules.length ? rules : ["Bash(claude-foundation *)"];
  } catch {
    return ["Bash(claude-foundation *)"];
  }
}

export function runScenarioLab({ matrixPath, scenarioId, outputRoot = DEFAULT_RESULTS,
  installer = join(ROOT, "install.sh"), runner = join(HERE, "run.mjs"),
  tempParent = tmpdir(), keepProject = false, runId = null, resumeProject = null,
  arm = "change-loop", dryRun = false }) {
  const selectedArm = benchArm(arm);
  const baseline = selectedArm === "baseline";
  const matrix = loadMatrix(matrixPath);
  const issues = matrixIssues(matrix);
  if (issues.length) throw new Error(`invalid matrix:\n${issues.join("\n")}`);
  const plan = executionPlan(matrix, scenarioId);
  const scenario = matrix.scenarios.find((row) => row.id === scenarioId);
  if (baseline && scenario.execution !== "paid")
    throw new Error(`baseline arm needs a paid host scenario: ${scenarioId}`);
  if (baseline && resumeProject)
    throw new Error("baseline arm has no lifecycle to resume; start a fresh project");
  const prepared = resumeProject
    ? { project: resolve(resumeProject), seedDigest: directoryDigest(resolve(ROOT, plan.fixture)) }
    : baseline
      ? prepareBaselineProject({
          fixture: resolve(ROOT, plan.fixture), tempParent,
          projectCommand: scenario.project_command
        })
      : prepareLabProject({
          fixture: resolve(ROOT, plan.fixture), installer, tempParent,
          projectCommand: scenario.project_command
        });
  if (resumeProject) {
    const marker = JSON.parse(readFileSync(join(prepared.project,
      ".foundation-benchmark.json"), "utf8"));
    if (marker.disposable !== true)
      throw new Error("resume project must be an explicitly disposable benchmark project");
  }
  const id = runId || `${scenarioId}${baseline ? "-baseline" : ""}-${Date.now()}`;
  const runDir = resolve(outputRoot, id);
  const scorecards = join(runDir, "scorecards.jsonl");
  const args = [runner, "--scenario", scenarioId, "--project", prepared.project,
    "--prompt", scenario.prompt, "--run-id", id, "--repeat", "1",
    "--timeout-ms", String(plan.budget.wall_ms), "--output", scorecards];
  if (plan.oracle) args.push("--oracle", resolve(ROOT, plan.oracle));
  if (plan.budget.cost_usd !== undefined)
    args.push("--max-cost-usd", String(plan.budget.cost_usd));
  if (plan.budget.model_requests !== undefined)
    args.push("--max-model-requests", String(plan.budget.model_requests));
  if (plan.budget.tool_calls !== undefined)
    args.push("--max-tool-calls", String(plan.budget.tool_calls));
  if (baseline) args.push("--arm", "baseline");
  if (baseline && scenario.execution === "paid")
    args.push("--claude-arg", "--permission-mode", "--claude-arg", "acceptEdits",
      "--claude-arg", "--allowedTools",
      ...baselineAllowedTools({
        project: prepared.project, projectCommand: scenario.project_command
      }).flatMap((rule) => ["--claude-arg", rule]));
  else if (scenario.execution === "paid")
    args.push("--test-self-review", "true", "--test-land", "true",
      // A fresh disposable consumer is never a trusted workspace, so headless
      // Claude ignores its settings allow-list. Pass the documented headless
      // route: edits plus exactly the installed allowlist.
      "--claude-arg", "--permission-mode", "--claude-arg", "acceptEdits",
      "--claude-arg", "--allowedTools",
      ...installedAllowedTools(prepared.project).flatMap((rule) => ["--claude-arg", rule]));
  if (dryRun) return dryRunPlan({ args, prepared, keepProject, resumeProject,
    arm: selectedArm, scenarioId });
  const startedAt = new Date().toISOString();
  const source = sourceRevision();
  let result;
  try {
    // The baseline gets no `claude-foundation` shim: nothing of the harness
    // is reachable from its PATH.
    result = commandResult(process.execPath, args, ROOT,
      baseline ? process.env : cliShimEnv(runDir));
    const verification = result.status === 0
      ? deliveryChecks(scenario, prepared.project, tempParent)
      : {
          contract: cleanRoomCommandContract(scenario),
          projectCommand: { status: "not-run", exitCode: null, durationMs: 0 },
          cleanInstall: { status: "not-run", exitCode: null, durationMs: 0 },
          cleanInstallProjectCommand: { status: "not-run", exitCode: null, durationMs: 0 }
        };
    const verificationPassed = [
      verification.projectCommand,
      verification.cleanInstall,
      verification.cleanInstallProjectCommand
    ].every((row) => ["pass", "not-applicable"].includes(row.status));
    preserveLabEvidence({
      project: prepared.project, runDir,
      manifest: {
        version: 1, protocol: "foundation-consumer-lab-run-v1", runId: id,
        scenario: scenarioId, arm: selectedArm, prompt: scenario.prompt, host: scenario.host,
        risk: scenario.risk, seed: plan.fixture, seedDigest: prepared.seedDigest,
        expectedSeedDigest: scenario.fixture_digest, projectCommand: scenario.project_command,
        cleanInstallCommand: scenario.clean_install_command,
        oracle: plan.oracle, criticalCaseIds: scenario.critical_case_ids,
        budget: plan.budget, startedAt, finishedAt: new Date().toISOString(),
        runnerExitCode: result.status,
        strictPass: result.status === 0 && verificationPassed,
        verification,
        source: {
          commit: source.commit, dirty: source.dirty, patchDigest: source.patchDigest
        },
        treeDigests: {
          deliveredProject: directoryDigest(prepared.project),
          sandbox: existsSync(join(prepared.project, ".foundation/sandboxes"))
            ? directoryDigest(join(prepared.project, ".foundation/sandboxes")) : null
        }
      },
      runnerOutput: { stdout: result.stdout, stderr: result.stderr },
      sourcePatch: source.patch,
      deliveredPatch: baseline ? productPatch(prepared.project) : null
    });
    if (scenario.fixture_digest !== prepared.seedDigest)
      throw new Error(`fixture digest drift for ${scenarioId}`);
    return { status: result.status === 0 && verificationPassed ? 0 : 1,
      project: keepProject ? prepared.project : null,
      runDir, manifest: join(runDir, "manifest.json") };
  } finally {
    if (!keepProject && !resumeProject)
      rmSync(prepared.project, { recursive: true, force: true });
    else chmodSync(prepared.project, 0o700);
  }
}

// Prepare the project, ask the runner for its zero-cost host plan, and report
// it with the prepared tree's shape. No model is called and nothing is written
// to the results directory.
function dryRunPlan({ args, prepared, keepProject, resumeProject, arm, scenarioId }) {
  try {
    const result = commandResult(process.execPath, [...args, "--dry-run"], ROOT);
    requireSuccess(result, "runner dry-run");
    const host = JSON.parse(result.stdout);
    return {
      status: 0, dryRun: true, arm, scenario: scenarioId,
      project: keepProject || resumeProject ? prepared.project : null,
      projectEntries: readdirSync(prepared.project).sort(),
      harnessInstalled: existsSync(join(prepared.project, ".claude/harness/foundation.mjs")),
      runnerArgs: args.slice(1),
      host
    };
  } finally {
    if (!keepProject && !resumeProject)
      rmSync(prepared.project, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const flags = parseArgs(process.argv.slice(2));
    const result = runScenarioLab({
      matrixPath: flags.matrix,
      scenarioId: flags.scenario,
      outputRoot: flags["output-root"],
      installer: flags.installer,
      runner: flags.runner,
      tempParent: flags["temp-parent"],
      keepProject: flags.keepProject,
      resumeProject: flags["resume-project"],
      runId: flags["run-id"],
      arm: flags.arm,
      dryRun: flags.dryRun
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status || 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
