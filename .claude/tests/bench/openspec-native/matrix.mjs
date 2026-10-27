import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MATRIX = resolve(HERE, "../config/openspec-native-matrix.json");

const REQUIRED_WORKLOADS = new Set([
  "brownfield-defect", "ui-state-defect", "api-validation-defect",
  "data-migration", "behavior-preserving-refactor", "multi-service-contract",
  "budget-decision-boundary"
]);
const REQUIRED_MEASUREMENTS = new Set([
  "oracle", "wall_ms", "cost_usd", "model_requests",
  "operation_counts", "coverage", "crap"
]);

export function loadMatrix(path = DEFAULT_MATRIX) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

export function matrixIssues(matrix, root = resolve(HERE, "../../../..")) {
  const issues = [];
  if (matrix?.protocol !== "foundation-openspec-native-matrix-v2")
    issues.push("protocol must be foundation-openspec-native-matrix-v2");
  const scenarios = Array.isArray(matrix?.scenarios) ? matrix.scenarios : [];
  const ids = new Set();
  const workloads = new Set();
  for (const scenario of scenarios) {
    if (!scenario?.id || ids.has(scenario.id))
      issues.push(`scenario id is missing or duplicate: ${scenario?.id}`);
    ids.add(scenario?.id);
    workloads.add(scenario?.workload);
    if (scenario.repository_catalog !== undefined) {
      const catalog = scenario.repository_catalog;
      const repositories = catalog?.repositories;
      const known = new Set(['root']);
      if (catalog?.version !== 1 || !Array.isArray(repositories) || !repositories.length)
        issues.push(`${scenario.id}: repository_catalog must be a nonempty version-1 catalog`);
      for (const repository of Array.isArray(repositories) ? repositories : []) {
        const path = repository.path;
        if (!repository.id || known.has(repository.id) || typeof path !== 'string' ||
            !path || isAbsolute(path) || path.split(/[\\/]/).includes('..') ||
            !['git', 'external'].includes(repository.type) || !['read', 'write'].includes(repository.mode))
          issues.push(`${scenario.id}: invalid repository_catalog entry`);
        known.add(repository.id);
        if (scenario.fixture && typeof path === 'string' &&
            !existsSync(resolve(root, scenario.fixture, path)))
          issues.push(`${scenario.id}: repository_catalog path does not exist: ${path}`);
      }
      for (const repository of Array.isArray(repositories) ? repositories : [])
        if (!Array.isArray(repository.dependsOn || []) ||
            (repository.dependsOn || []).some((id) => !known.has(id)))
          issues.push(`${scenario.id}: repository_catalog dependency does not exist`);
    }
    if (scenario.lifecycle !== undefined) {
      const lifecycle = scenario.lifecycle;
      const phases = typeof lifecycle?.phases_dir === "string" ? resolve(root, lifecycle.phases_dir) : null;
      if (lifecycle?.protocol !== "foundation-openspec-native-lifecycle-v1" || !phases ||
          !existsSync(phases) || !lifecycle.amendment?.file || !lifecycle.stacked?.file ||
          !existsSync(resolve(phases, String(lifecycle.amendment?.file))) ||
          !existsSync(resolve(phases, String(lifecycle.stacked?.file))))
        issues.push(`${scenario.id}: lifecycle needs its protocol, phases_dir and existing amendment and stacked files`);
      if (scenario.execution !== "paid" || !scenario.repository_catalog)
        issues.push(`${scenario.id}: a lifecycle lane needs paid execution and a repository_catalog`);
    }
    if (!["ready", "planned"].includes(scenario?.status))
      issues.push(`${scenario?.id}: status must be ready or planned`);
    if (!["paid", "deterministic"].includes(scenario?.execution))
      issues.push(`${scenario?.id}: execution must be paid or deterministic`);
    for (const [field, value] of Object.entries(scenario?.budget || {})) {
      if (!Number.isFinite(value) || value < 0 || (field !== "cost_usd" && value === 0))
        issues.push(`${scenario?.id}: budget.${field} must be positive`);
    }
    if (scenario?.status === "ready") {
      for (const field of [
        "fixture_digest", "prompt", "host", "risk", "project_command",
        "clean_install_command"
      ]) {
        if (typeof scenario[field] !== "string" || !scenario[field].trim())
          issues.push(`${scenario?.id}: ready ${field} is required`);
      }
      if (!Array.isArray(scenario.critical_case_ids) ||
          scenario.critical_case_ids.length === 0 ||
          scenario.critical_case_ids.some((id) => typeof id !== "string" || !id.trim()))
        issues.push(`${scenario?.id}: ready critical_case_ids are required`);
      if (!scenario.fixture || !existsSync(resolve(root, scenario.fixture)))
        issues.push(`${scenario?.id}: ready fixture does not exist`);
      if (scenario.openspec_history !== undefined &&
          (typeof scenario.openspec_history !== "string" ||
           !existsSync(resolve(root, scenario.openspec_history)) ||
           !/^sha256:[a-f0-9]{64}$/.test(String(scenario.openspec_history_digest))))
        issues.push(`${scenario?.id}: openspec_history needs an existing path and digest`);
      if (scenario.execution === "paid" && scenario.oracle?.required !== true)
        issues.push(`${scenario?.id}: paid scenarios require a hidden oracle`);
      if (scenario.oracle?.required &&
          (!scenario.oracle.path || !existsSync(resolve(root, scenario.oracle.path))))
        issues.push(`${scenario?.id}: ready oracle does not exist`);
    }
    if (scenario?.last_attempt?.status === "needs-user-decision" &&
        (scenario.last_attempt.baseline_eligible !== false || scenario.baseline !== null))
      issues.push(`${scenario?.id}: user-decision attempts cannot become baselines`);
  }
  for (const workload of REQUIRED_WORKLOADS)
    if (!workloads.has(workload)) issues.push(`missing workload: ${workload}`);
  const measurements = new Set(matrix?.execution_policy?.required_measurements || []);
  for (const measurement of REQUIRED_MEASUREMENTS)
    if (!measurements.has(measurement)) issues.push(`missing measurement: ${measurement}`);
  const exhaustion = matrix?.execution_policy?.budget_exhaustion || {};
  if (exhaustion.terminal_status !== "needs-user-decision" ||
      exhaustion.ask_user !== true || exhaustion.resumable !== true ||
      exhaustion.may_report_complete !== false || exhaustion.may_report_blocked !== false)
    issues.push("budget exhaustion must pause, ask the user, and remain resumable");
  return issues;
}

export function executionPlan(matrix, scenarioId) {
  const scenario = matrix.scenarios?.find((candidate) => candidate.id === scenarioId);
  if (!scenario) throw new Error(`unknown benchmark scenario: ${scenarioId}`);
  if (scenario.status !== "ready")
    throw new Error(`benchmark scenario is not ready: ${scenarioId}`);
  return {
    scenario: scenario.id,
    execution: scenario.execution,
    smokeRepeats: matrix.execution_policy.smoke_repeats,
    varianceRepeats: matrix.execution_policy.variance_repeats,
    budget: scenario.budget,
    fixture: scenario.fixture,
    oracle: scenario.oracle.path,
    expectedTerminal: scenario.expected_terminal,
    prompt: scenario.prompt,
    host: scenario.host,
    risk: scenario.risk,
    fixtureDigest: scenario.fixture_digest,
    projectCommand: scenario.project_command,
    cleanInstallCommand: scenario.clean_install_command,
    criticalCaseIds: scenario.critical_case_ids,
    openspecHistory: scenario.openspec_history || null,
    openspecHistoryDigest: scenario.openspec_history_digest || null
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const matrix = loadMatrix(process.argv[2] || DEFAULT_MATRIX);
  const issues = matrixIssues(matrix);
  if (issues.length) {
    for (const issue of issues) process.stderr.write(`matrix: ${issue}\n`);
    process.exitCode = 1;
  } else if (process.argv[3]) {
    process.stdout.write(`${JSON.stringify(executionPlan(matrix, process.argv[3]), null, 2)}\n`);
  } else {
    const rows = matrix.scenarios.map(({ id, status }) => ({ id, status }));
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  }
}
