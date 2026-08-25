import {
  existsSync, mkdirSync, readFileSync, statSync, writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";

// The receipt vocabulary, ordered. An adapter that runs more than one provider
// has to report the worst thing that happened — not the last one in the array,
// and never a word from a different vocabulary. `blocked` is deliberately
// absent: it means "waiting on something external" everywhere else in the
// harness, so returning it for a suite that ran and failed made a red test
// indistinguishable from a test that never got to run.
const STATUS_SEVERITY = { pass: 0, inconclusive: 1, fail: 2, error: 3 };
const worstStatus = (...values) => values
  .filter((value) => value in STATUS_SEVERITY)
  .reduce((worst, value) =>
    STATUS_SEVERITY[value] > STATUS_SEVERITY[worst] ? value : worst, "pass");

function criticalCaseRows(report) {
  const explicit = report?.criticalCases || report?.foundation?.criticalCases;
  if (Array.isArray(explicit))
    return explicit.map((row) => ({
      id: String(row?.id || ""),
      status: String(row?.status || "").toLowerCase()
    })).filter((row) => row.id);
  const rows = [];
  for (const suite of report?.testResults || []) {
    for (const assertion of suite?.assertionResults || []) {
      const name = [assertion?.ancestorTitles?.join(" "), assertion?.title,
        assertion?.fullName].filter(Boolean).join(" ");
      rows.push({ id: name, status: String(assertion?.status || "").toLowerCase() });
    }
  }
  return rows;
}

export function criticalCaseResult(report, required) {
  if (!required.length) return { status: "pass", observations: [] };
  const rows = criticalCaseRows(report);
  const observations = required.map((id) => {
    const exact = rows.find((row) => row.id === id);
    const embedded = exact || rows.find((row) =>
      row.id.split(/\s+/).includes(id) || row.id.includes(`[${id}]`));
    return { id, status: embedded?.status || "missing" };
  });
  const passWords = new Set(["pass", "passed", "success", "ok"]);
  return {
    status: observations.every((row) => passWords.has(row.status)) ? "pass" : "fail",
    observations
  };
}

export function enforceCriticalCases(baseStatus, critical) {
  return baseStatus === "pass" ? critical.status : baseStatus;
}

export function mutationV2Result(report, required, mutantKillers = {}) {
  const rows = Array.isArray(report?.mutants) ? report.mutants : [];
  const observations = required.map((id) => {
    const row = rows.find((candidate) => candidate?.id === id);
    const killedBy = String(row?.killedBy || row?.killerCaseId || "");
    const expectedKiller = String(mutantKillers[id] || "");
    const killed = row?.result === "killed" || row?.killed === true;
    return {
      id,
      applied: row?.applied === true,
      compiled: row?.compiled === true,
      result: String(row?.result || (killed ? "killed" : "missing")),
      killedBy,
      expectedKiller
    };
  });
  const killerCases = [...new Set(observations.map((row) => row.expectedKiller)
    .filter(Boolean))];
  const killerResult = criticalCaseResult(report, killerCases);
  const passedKillers = new Set(killerResult.observations
    .filter((row) => ["pass", "passed", "success", "ok"].includes(row.status))
    .map((row) => row.id));
  return {
    status: observations.every((row) =>
      row.applied && row.compiled && row.result === "killed" &&
      row.expectedKiller && row.killedBy === row.expectedKiller &&
      passedKillers.has(row.expectedKiller))
      ? "pass" : "fail",
    observations,
    killerCases: killerResult.observations
  };
}

export function mutationReceiptClassification(protocol, legacyResult, configured) {
  // Receipt classification describes how the fault was exposed. The provider
  // fingerprint separately binds the result protocol and its full contract.
  return protocol === "foundation-mutation-v2"
    ? "behavioral-kill" : legacyResult || configured;
}

export function providerExecutionEnvironment(base, additions = {}, workspacePath = null) {
  const environment = { ...base, ...additions };
  // The harness may itself be pinned to a control root while executing a
  // candidate sandbox. Provider commands must discover from their own cwd;
  // leaking this pin redirects nested fixture CLIs back into the outer project.
  delete environment.CLAUDE_FOUNDATION_PROJECT;
  // Declared commands routinely name locally-installed binaries (`eslint`,
  // `vitest`, `tsc`) the way package scripts do. npm puts the workspace's
  // `node_modules/.bin` on PATH before running a script; a provider command
  // executed without that entry dies with `command not found` even though the
  // tool is installed. Prepend it only when it exists so non-Node workspaces
  // see an unchanged PATH.
  if (workspacePath) {
    const localBin = join(workspacePath, "node_modules", ".bin");
    if (existsSync(localBin)) {
      const key = Object.keys(environment).find((name) => name.toUpperCase() === "PATH") || "PATH";
      environment[key] = environment[key]
        ? `${localBin}${delimiter}${environment[key]}` : localBin;
    }
  }
  return environment;
}

export function createAdapterRuntime({
  ROOT, LOGS, PROVIDERS,
  providerCapability, providerConfig, parseFlags, providerWorkspace,
  recordReceipt, startServiceSession, evidence, resultAdapterResources,
  loadRuntime, providerRepository, repositoryById, configuredCommand,
  providerRepositories,
  fileDigest, pathInside, stableHash, runCommand,
  providerWorkspaceHash, providerClaims, parseJsonOutput, parseTapOutput,
  numericReportValue, playwrightReportSummary, requiredProviders,
  mutationProtocolResult, now, die
}) {
  function repositoryStatus(repository) {
    const result = spawnSync("git", ["status", "--porcelain"], {
      cwd: repository.workspacePath, encoding: "utf8"
    });
    return result.status === 0 ? result.stdout.trim() : null;
  }

  function providerRepositoryManifest(id, provider, config, proofRunId) {
    const state = loadRuntime(id);
    const rows = providerRepositories(id, provider, config);
    const repositories = {};
    for (const repository of rows) {
      if (!existsSync(repository.workspacePath))
        die(`provider '${provider}' repository '${repository.id}' workspace is missing`);
      const runtime = state.repositories?.[repository.id] ||
        (repository.id === "root" ? state.workspace : null) || {};
      if (runtime.setup?.status === "failed")
        die(`provider '${provider}' repository '${repository.id}' setup failed`);
      if (repository.mode === "read") {
        const changed = repositoryStatus(repository);
        if (changed)
          die(`provider '${provider}' read-only repository '${repository.id}' changed inside its sandbox: ${changed}`);
      }
      repositories[repository.id] = {
        path: repository.workspacePath,
        access: repository.mode,
        baseHead: runtime.baseHead || repository.baseHead || null
      };
    }
    const path = join(LOGS, id, `${proofRunId}-${provider}-repositories.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({
      version: 1, changeId: id, proofRunId, provider, repositories
    }, null, 2)}\n`, { mode: 0o600 });
    return { path, rows };
  }

  function assertReadRepositoriesUnchanged(provider, rows) {
    for (const repository of rows.filter((row) => row.mode === "read")) {
      const changed = repositoryStatus(repository);
      if (changed)
        die(`provider '${provider}' modified read-only repository '${repository.id}': ${changed}`);
    }
  }

  function runProvider(id, provider, values) {
    const configured = providerConfig(id, provider);
    const capability = providerCapability(provider, configured);
    if (!capability || !PROVIDERS.has(capability)) die(`unknown provider '${provider}'`);
    // The provider already declares what it runs. Letting an ad-hoc command
    // stand in for it would produce a genuinely-executed receipt for something
    // other than the declared evidence.
    if (configured && configured.adapter !== "external")
      die(`provider '${provider}' declares adapter '${configured.adapter}' and its own command; ` +
        "run 'proof run <change>' so the declared command is what executes");
    const split = values.indexOf("--");
    if (split < 0 || split === values.length - 1) die("run-provider requires '-- <command> [args...]'");
    const { flags, rest } = parseFlags(values.slice(0, split));
    if (rest.length) die(`unexpected run-provider argument(s): ${rest.join(", ")}`);
    if (!flags.claims) die("run-provider requires --claims <a,b|declared> before '--'");
    const command = values[split + 1];
    const commandArgs = values.slice(split + 2);
    const started = now();
    const startedMs = Date.now();
    // Same 64 MB ceiling as the git helper: the default 1 MB maxBuffer kills a
    // verbose green suite with ENOBUFS and records the run as an infrastructure
    // error.
    const workspace = providerWorkspace(id, provider);
    const result = spawnSync(command, commandArgs, {
      cwd: workspace, encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: providerExecutionEnvironment(process.env, { FOUNDATION_CHANGE_ID: id }, workspace)
    });
    const logDir = join(LOGS, id);
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `${provider}-${Date.now()}.log`);
    writeFileSync(logPath, `${result.stdout || ""}${result.stderr || ""}`);
    // A spawn failure (missing binary, signal death) is infrastructure, not a
    // failing check: `error` steers recovery toward restoring the provider,
    // where `fail` steers it toward changing code.
    recordReceipt(id, provider,
      result.error || result.status === null
        ? "error" : result.status === 0 ? "pass" : "fail", {
      ...flags,
      started, command: [command, ...commandArgs].join(" "),
      log: relative(ROOT, logPath), observed: `exit ${result.status ?? "error"}`,
      durationMs: Date.now() - startedMs
    }, { executed: true });
    if (result.status !== 0) process.exit(result.status || 1);
  }
  
  async function startRequiredServices(id, nodes, proofRunId) {
    const executionValue = evidence(id).execution;
    const names = [...new Set(nodes.map((node) => node.config.service).filter(Boolean))];
    const sessions = [];
    try {
      for (const name of names)
        sessions.push(await startServiceSession(
          id, name, executionValue.services[name], proofRunId
        ));
      return sessions;
    } catch (error) {
      sessions.reverse().forEach((session) => session.stop());
      throw error;
    }
  }
  
  function executionLog(id, provider, executionId, result) {
    const logPath = join(LOGS, id, `${executionId}-${provider}.log`);
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath,
      `status=${result.status ?? "error"} signal=${result.signal || ""} timedOut=${result.timedOut}\n` +
      `durationMs=${result.durationMs}\n\n${result.stdout || ""}${result.stderr || ""}`);
    return {
      path: relative(ROOT, logPath), type: "command-log", required: true
    };
  }
  
  function adapterResources(provider, config) {
    return resultAdapterResources(provider, config, providerCapability);
  }
  
  // Hash the same declared contract artifact on every side and pass only when
  // the bytes match. Nothing else in the harness compared a producer to a
  // consumer: `cross-repo-contract` forced a claim to declare the capability
  // and a provider to exist, and then accepted a free-text receipt asserting
  // that somebody had checked.
  function executeContractDigest(id, provider, config, proofRunId) {
    const started = now();
    const startedMs = Date.now();
    const sides = Object.entries(config.contract).sort(([left], [right]) =>
      left.localeCompare(right));
    const observations = sides.map(([repositoryId, relativePath]) => {
      const repository = repositoryById(id, repositoryId);
      const absolute = resolve(repository.workspacePath, relativePath);
      if (!pathInside(repository.workspacePath, absolute))
        die(`provider '${provider}' contract path '${relativePath}' escapes repository '${repositoryId}'`);
      return {
        repositoryId,
        path: relativePath,
        absolute,
        digest: existsSync(absolute) && statSync(absolute).isFile()
          ? fileDigest(absolute) : null
      };
    });
    const missing = observations.filter((row) => row.digest === null);
    const digests = [...new Set(observations.map((row) => row.digest))];
    const status = missing.length ? "error" : digests.length === 1 ? "pass" : "fail";
    const observed = missing.length
      ? `contract artifact missing in ${missing.map((row) =>
        `${row.repositoryId}:${row.path}`).join(", ")}`
      : digests.length === 1
        ? `contract digest ${digests[0].slice(0, 16)} agrees across ${
          observations.map((row) => row.repositoryId).join(", ")}`
        : `contract digests disagree: ${observations.map((row) =>
          `${row.repositoryId}=${row.digest.slice(0, 16)}`).join(", ")}`;
    const logPath = join(LOGS, id, `${proofRunId}-${provider}.log`);
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, `${observed}\n\n${observations.map((row) =>
      `${row.repositoryId}\t${row.path}\t${row.digest || "missing"}`).join("\n")}\n`);
    const artifacts = [
      { path: relative(ROOT, logPath), type: "command-log", required: true },
      ...observations.filter((row) => row.digest !== null).map((row) => ({
        path: relative(ROOT, row.absolute), type: "contract-artifact", required: true
      }))
    ];
    recordReceipt(id, provider, status, {
      config, adapter: "contract-digest", proofRunId,
      workspaceHash: providerWorkspaceHash(id, provider, loadRuntime(id).activeProofRun?.workspaceHash),
      claims: providerClaims(id, provider, config).join(","),
      command: `contract-digest ${sides.map(([repositoryId, path]) =>
        `${repositoryId}:${path}`).join(" ")}`,
      started, observed, durationMs: Date.now() - startedMs,
      log: relative(ROOT, logPath), artifacts,
      environment: config.environment || null, project: config.project || null
    }, { executed: true });
    return { provider, status };
  }

  function repositoryExecutionRows(state, manifest) {
    return manifest.rows.map((row) => ({
      id: row.id, access: row.mode,
      baseHead: state.repositories?.[row.id]?.baseHead || row.baseHead || null
    }));
  }

  function resolvedEnvironmentVariables(config) {
    return Object.fromEntries((config.envFrom || [])
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]));
  }

  function adapterExecutionKey(cwd, built, repository, scope, config, envFrom) {
    return stableHash({
      cwd, command: built.command, args: built.args,
      repositoryId: repository?.id || "root", repositories: scope,
      env: config.env || {}, envFrom: [...(config.envFrom || [])].sort(),
      resolvedEnvFrom: Object.keys(envFrom).sort(),
      timeoutMs: Number(config.timeoutMs || 120000), readiness: config.readiness || null
    });
  }

  function cachedAdapterExecution(id, proofRunId, context, config, commandCache) {
    const { repository, repositoryManifest, cwd, built, envFrom, dedupKey } = context;
    if (!commandCache.has(dedupKey)) {
      const commandExecutionId = `command-${Date.now()}-${commandCache.size + 1}`;
      const executionEnv = providerExecutionEnvironment(process.env, {
        ...envFrom, ...(config.env || {}),
        FOUNDATION_CHANGE_ID: id, FOUNDATION_CONTROL_ROOT: ROOT,
        FOUNDATION_REPOSITORY_ID: repository?.id || "root",
        FOUNDATION_REPOSITORIES_FILE: repositoryManifest.path,
        FOUNDATION_PROOF_RUN_ID: proofRunId,
        FOUNDATION_COMMAND_EXECUTION_ID: commandExecutionId,
        FOUNDATION_EXECUTION_ID: commandExecutionId
      }, cwd);
      commandCache.set(dedupKey, {
        commandExecutionId,
        result: runCommand(built.command, built.args, {
          cwd, timeoutMs: config.timeoutMs, env: executionEnv,
          readiness: config.readiness
        })
      });
    }
    return commandCache.get(dedupKey);
  }

  function adapterExecutionContext(id, provider, config, proofRunId, commandCache) {
    const state = loadRuntime(id);
    const repository = providerRepository(id, provider, config);
    const cwd = repository?.workspacePath || state.workspace?.path || ROOT;
    const repositoryManifest = providerRepositoryManifest(id, provider, config, proofRunId);
    const scope = repositoryExecutionRows(state, repositoryManifest);
    const built = configuredCommand(provider, config);
    const envFrom = resolvedEnvironmentVariables(config);
    const context = {
      state, repository, cwd, repositoryManifest, built, envFrom,
      dedupKey: adapterExecutionKey(cwd, built, repository, scope, config, envFrom)
    };
    return {
      ...context,
      cached: cachedAdapterExecution(id, proofRunId, context, config, commandCache)
    };
  }

  function freshConfiguredReport(config, cwd, result) {
    const path = config.report ? resolve(cwd, config.report) : null;
    const runStartedMs = Date.parse(result.startedAt) || 0;
    const fresh = Boolean(path) && existsSync(path) &&
      statSync(path).mtimeMs >= runStartedMs - 1000;
    if (path && existsSync(path) && !fresh)
      console.error(
        `WARNING: ignoring '${relative(ROOT, path)}': it predates this run, so it is not its output`);
    return { path, fresh };
  }

  function parsedAdapterReport(config, configuredReport, result) {
    const content = configuredReport.fresh
      ? readFileSync(configuredReport.path, "utf8") : result.stdout;
    const json = parseJsonOutput(content);
    const tap = ["tap", "auto"].includes(config.reportFormat || "auto")
      ? parseTapOutput(content) : null;
    return json || tap;
  }

  function adapterEvidence(id, provider, config, execution) {
    const logArtifact = executionLog(
      id, provider, execution.commandExecutionId, execution.result);
    const artifacts = [logArtifact];
    const configuredReport = freshConfiguredReport(config, execution.cwd, execution.result);
    if (configuredReport.fresh)
      artifacts.push({
        path: relative(ROOT, configuredReport.path),
        type: "structured-report", required: true
      });
    const report = parsedAdapterReport(config, configuredReport, execution.result);
    return {
      logArtifact, artifacts, report,
      critical: criticalCaseResult(report, config.criticalCases || [])
    };
  }

  function adapterBaseFlags(id, provider, config, proofRunId, execution, suppliedEvidence) {
    const { state, built, result, commandExecutionId } = execution;
    return {
      config, adapter: config.adapter, proofRunId, commandExecutionId,
      workspaceHash: providerWorkspaceHash(
        id, provider, state.activeProofRun?.workspaceHash),
      claims: providerClaims(id, provider, config).join(","),
      command: built.display, started: result.startedAt,
      observed: result.timedOut ? `timeout after ${result.durationMs}ms` :
        result.error ? result.error.message :
        `exit ${result.status}; ${result.durationMs}ms; readiness ${
          result.readinessObserved ? "observed" : "not-observed"}`,
      durationMs: result.durationMs,
      log: suppliedEvidence.logArtifact.path, artifacts: suppliedEvidence.artifacts,
      environment: config.environment || null, project: config.project || null
    };
  }

  function adapterInfrastructureFailed(result, readinessMissed) {
    return Boolean(result.timedOut || result.error || readinessMissed);
  }

  function recordTestDiscoveryAdapter(id, provider, config, execution, evidenceRow,
    baseFlags, readinessMissed) {
    const { result } = execution;
    const testProvider = provider;
    const discoveryProvider = config.discoveryProvider || "discovery";
    const discoveryConfig = providerConfig(id, discoveryProvider) || config;
    const testBaseStatus = adapterInfrastructureFailed(result, readinessMissed)
      ? "error" : result.status !== 0 ? "fail" : "pass";
    const testStatus = enforceCriticalCases(testBaseStatus, evidenceRow.critical);
    recordReceipt(id, testProvider, testStatus, {
      ...baseFlags, claims: providerClaims(id, testProvider, config).join(","),
      observed: `${baseFlags.observed}; critical cases ${
        evidenceRow.critical.observations.length
          ? evidenceRow.critical.observations.map((row) =>
            `${row.id}=${row.status}`).join(", ") : "not declared"}`
    }, { executed: true });
    const discovered = numericReportValue(evidenceRow.report, [
      "numTotalTests", "totalTests", "tests", "testCount", "expected"
    ]);
    const minimum = Number(config.minimum || 1);
    const discoveryStatus = adapterInfrastructureFailed(result, readinessMissed)
      ? "error" : discovered === null ? "inconclusive"
        : discovered >= minimum ? "pass" : "fail";
    recordReceipt(id, discoveryProvider, discoveryStatus, {
      ...baseFlags, config: discoveryConfig,
      claims: providerClaims(id, discoveryProvider, discoveryConfig).join(","),
      discovered, minimum,
      observed: discovered === null ? "structured test count unavailable" :
        `${discovered} discovered; minimum ${minimum}`
    }, { executed: true });
    return { provider, status: worstStatus(testStatus, discoveryStatus) };
  }

  function playwrightAttachments(summary, cwd, artifacts) {
    for (const attachment of summary?.attachments || []) {
      const path = isAbsolute(attachment) ? attachment : resolve(cwd, attachment);
      if (existsSync(path))
        artifacts.push({
          path: relative(ROOT, path), type: "playwright-attachment", required: false
        });
    }
  }

  function playwrightOutputStatus(result, summary, missingClaims, critical, readinessMissed) {
    const base = adapterInfrastructureFailed(result, readinessMissed) ? "error" :
      result.status !== 0 || (summary?.failed || 0) > 0 ? "fail" :
        !summary || missingClaims.length ? "inconclusive" : "pass";
    return enforceCriticalCases(base, critical);
  }

  function playwrightObservation(summary, requiredClaims, missingClaims) {
    if (!summary) return "Playwright JSON report unavailable";
    return `${summary.tests} tests; ${summary.failed} failed; ${summary.skipped} skipped; ` +
      `covered claims ${requiredClaims.length - missingClaims.length}/${requiredClaims.length}; ` +
      `observed annotations ${summary.claims.length}` +
      (missingClaims.length ? `; missing ${missingClaims.join(",")}` : "") +
      (summary.skippedClaims.length
        ? `; claimed only by skipped tests ${summary.skippedClaims.join(",")}` : "");
  }

  function recordPlaywrightAdapter(id, provider, config, execution, evidenceRow,
    baseFlags, readinessMissed) {
    const summary = evidenceRow.report
      ? playwrightReportSummary(evidenceRow.report) : null;
    playwrightAttachments(summary, execution.cwd, evidenceRow.artifacts);
    const outputs = [...new Set([provider, ...(config.outputs || [])])]
      .filter((output) => requiredProviders(id).includes(output));
    let aggregateStatus = "pass";
    for (const output of outputs) {
      const requiredClaims = providerClaims(id, output, config);
      const missingClaims = summary
        ? requiredClaims.filter((claim) => !summary.claims.includes(claim))
        : requiredClaims;
      const status = playwrightOutputStatus(
        execution.result, summary, missingClaims, evidenceRow.critical, readinessMissed);
      aggregateStatus = worstStatus(aggregateStatus, status);
      const outputCapability = providerCapability(output, providerConfig(id, output));
      recordReceipt(id, output, status, {
        ...baseFlags, claims: requiredClaims.join(","),
        "input-mode": outputCapability === "browser"
          ? config.inputMode || "browser-automation" : config.inputMode || null,
        "foreground-required": config.foregroundRequired ? "yes" : "no",
        "foreground-available": config.foregroundAvailable ? "yes" : "no",
        observed: playwrightObservation(summary, requiredClaims, missingClaims),
        criticalCases: evidenceRow.critical.observations
      }, { executed: true });
    }
    return { provider, status: aggregateStatus };
  }

  function adapterMutationResults(provider, config, result, report) {
    const capability = providerCapability(provider, config);
    const v2 = capability === "mutation" &&
        config.resultProtocol === "foundation-mutation-v2"
      ? mutationV2Result(report || parseJsonOutput(result.stdout) || {},
        config.requiredMutants || [], config.mutantKillers || {}) : null;
    const legacy = capability === "mutation" &&
        config.resultProtocol === "foundation-mutation-v1"
      ? mutationProtocolResult(result.stdout) : null;
    return { capability, v2, legacy };
  }

  function genericAdapterStatus(config, result, mutation, readinessMissed) {
    if (adapterInfrastructureFailed(result, readinessMissed)) return "error";
    if (mutation.capability !== "mutation") return result.status === 0 ? "pass" : "fail";
    if (config.resultProtocol === "foundation-mutation-v2") return mutation.v2.status;
    if (config.resultProtocol !== "foundation-mutation-v1")
      return result.status === 0 ? "pass" : "fail";
    if (["behavioral-kill", "test-failure"].includes(mutation.legacy)) return "pass";
    return ["crash", "timeout", "not-applied"].includes(mutation.legacy) ? "error" : "fail";
  }

  function genericAdapterObservation(baseFlags, mutation, critical) {
    if (mutation.v2)
      return `mutation v2 ${mutation.v2.observations.map((row) =>
        `${row.id}=${row.result}/applied:${row.applied}/compiled:${row.compiled}/killedBy:${
          row.killedBy || "none"}`).join(", ")}; ${baseFlags.observed}`;
    if (mutation.legacy)
      return `mutation result ${mutation.legacy}; ${baseFlags.observed}`;
    return `${baseFlags.observed}; critical cases ${critical.observations.length
      ? critical.observations.map((row) => `${row.id}=${row.status}`).join(", ")
      : "not declared"}`;
  }

  function recordGenericAdapter(id, provider, config, execution, evidenceRow,
    baseFlags, readinessMissed) {
    const mutation = adapterMutationResults(
      provider, config, execution.result, evidenceRow.report);
    const baseStatus = genericAdapterStatus(
      config, execution.result, mutation, readinessMissed);
    const status = enforceCriticalCases(baseStatus, evidenceRow.critical);
    recordReceipt(id, provider, status, {
      ...baseFlags,
      "input-mode": config.inputMode || null,
      "foreground-required": config.foregroundRequired ? "yes" : "no",
      "foreground-available": config.foregroundAvailable ? "yes" : "no",
      classification: mutationReceiptClassification(
        config.resultProtocol, mutation.legacy, config.classification),
      observed: genericAdapterObservation(baseFlags, mutation, evidenceRow.critical)
    }, { executed: true });
    return { provider, status };
  }

  async function executeAdapter(id, provider, config, proofRunId, commandCache) {
    if (config.adapter === "contract-digest")
      return executeContractDigest(id, provider, config, proofRunId);
    const execution = adapterExecutionContext(
      id, provider, config, proofRunId, commandCache);
    execution.result = await execution.cached.result;
    execution.commandExecutionId = execution.cached.commandExecutionId;
    assertReadRepositoriesUnchanged(provider, execution.repositoryManifest.rows);
    const evidenceRow = adapterEvidence(id, provider, config, execution);
    const baseFlags = adapterBaseFlags(
      id, provider, config, proofRunId, execution, evidenceRow);
  
    // A provider that declares readiness is asserting the suite ran against
    // something specific. Not observing it means the suite ran against
    // whatever occupied the port — or against nothing — so it cannot pass,
    // whichever adapter produced it.
    const readinessMissed = Boolean(config.readiness?.url) &&
      !execution.result.readinessObserved;

    if (config.adapter === "test-discovery") {
      return recordTestDiscoveryAdapter(
        id, provider, config, execution, evidenceRow, baseFlags, readinessMissed);
    }
  
    if (config.adapter === "playwright") {
      return recordPlaywrightAdapter(
        id, provider, config, execution, evidenceRow, baseFlags, readinessMissed);
    }
  
    return recordGenericAdapter(
      id, provider, config, execution, evidenceRow, baseFlags, readinessMissed);
  }

  return {
    runProvider,
    startRequiredServices,
    executionLog,
    adapterResources,
    executeAdapter
  };
}
