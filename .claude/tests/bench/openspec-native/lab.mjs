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

function commandResult(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: "utf8", env: process.env });
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

function copyIfPresent(source, target) {
  if (!existsSync(source)) return false;
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  return true;
}

export function preserveLabEvidence({
  project, runDir, manifest, runnerOutput = null, sourcePatch = ""
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
  writeFileSync(join(runDir, "manifest.json"), `${JSON.stringify(value, null, 2)}\n`);
  writeIntegrity(runDir);
  return value;
}

export function runScenarioLab({ matrixPath, scenarioId, outputRoot = DEFAULT_RESULTS,
  installer = join(ROOT, "install.sh"), runner = join(HERE, "run.mjs"),
  tempParent = tmpdir(), keepProject = false, runId = null, resumeProject = null }) {
  const matrix = loadMatrix(matrixPath);
  const issues = matrixIssues(matrix);
  if (issues.length) throw new Error(`invalid matrix:\n${issues.join("\n")}`);
  const plan = executionPlan(matrix, scenarioId);
  const scenario = matrix.scenarios.find((row) => row.id === scenarioId);
  const prepared = resumeProject
    ? { project: resolve(resumeProject), seedDigest: directoryDigest(resolve(ROOT, plan.fixture)) }
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
  const id = runId || `${scenarioId}-${Date.now()}`;
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
  if (scenario.execution === "paid")
    args.push("--test-self-review", "true", "--test-land", "true");
  const startedAt = new Date().toISOString();
  const source = sourceRevision();
  let result;
  try {
    result = commandResult(process.execPath, args, ROOT);
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
        scenario: scenarioId, prompt: scenario.prompt, host: scenario.host,
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
      sourcePatch: source.patch
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
      runId: flags["run-id"]
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status || 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
