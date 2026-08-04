import {
  existsSync, mkdirSync, readFileSync, writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export function createAdapterRuntime({
  ROOT, LOGS, PROVIDERS,
  providerCapability, providerConfig, parseFlags, providerWorkspace,
  recordReceipt, startServiceSession, evidence, resultAdapterResources,
  loadRuntime, providerRepository, configuredCommand, stableHash, runCommand,
  providerWorkspaceHash, providerClaims, parseJsonOutput, parseTapOutput,
  numericReportValue, playwrightReportSummary, requiredProviders,
  mutationProtocolResult, now, die
}) {
  function runProvider(id, provider, values) {
    const capability = providerCapability(provider, providerConfig(id, provider));
    if (!capability || !PROVIDERS.has(capability)) die(`unknown provider '${provider}'`);
    const split = values.indexOf("--");
    if (split < 0 || split === values.length - 1) die("run-provider requires '-- <command> [args...]'");
    const { flags, rest } = parseFlags(values.slice(0, split));
    if (rest.length) die(`unexpected run-provider argument(s): ${rest.join(", ")}`);
    if (!flags.claims) die("run-provider requires --claims <a,b|declared> before '--'");
    const command = values[split + 1];
    const commandArgs = values.slice(split + 2);
    const started = now();
    const startedMs = Date.now();
    const result = spawnSync(command, commandArgs, {
      cwd: providerWorkspace(id, provider), encoding: "utf8",
      env: { ...process.env, FOUNDATION_CHANGE_ID: id }
    });
    const logDir = join(LOGS, id);
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `${provider}-${Date.now()}.log`);
    writeFileSync(logPath, `${result.stdout || ""}${result.stderr || ""}`);
    recordReceipt(id, provider, result.status === 0 ? "pass" : "fail", {
      ...flags,
      started, command: [command, ...commandArgs].join(" "),
      log: relative(ROOT, logPath), observed: `exit ${result.status ?? "error"}`,
      durationMs: Date.now() - startedMs
    });
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
  
  async function executeAdapter(id, provider, config, proofRunId, commandCache) {
    const state = loadRuntime(id);
    const repository = providerRepository(id, provider, config);
    const cwd = repository?.workspacePath || state.workspace?.path || ROOT;
    const built = configuredCommand(provider, config);
    const envFrom = Object.fromEntries((config.envFrom || [])
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]));
    const dedupKey = stableHash({
      cwd, command: built.command, args: built.args,
      env: config.env || {}, timeoutMs: Number(config.timeoutMs || 120000),
      readiness: config.readiness || null
    });
    if (!commandCache.has(dedupKey)) {
      const commandExecutionId = `command-${Date.now()}-${commandCache.size + 1}`;
      const executionEnv = {
        ...process.env,
        ...envFrom,
        ...(config.env || {}),
        FOUNDATION_CHANGE_ID: id,
        FOUNDATION_CONTROL_ROOT: ROOT,
        FOUNDATION_REPOSITORY_ID: repository?.id || "root",
        FOUNDATION_PROOF_RUN_ID: proofRunId,
        FOUNDATION_COMMAND_EXECUTION_ID: commandExecutionId,
        FOUNDATION_EXECUTION_ID: commandExecutionId
      };
      commandCache.set(dedupKey, {
        commandExecutionId,
        result: runCommand(built.command, built.args, {
          cwd, timeoutMs: config.timeoutMs, env: executionEnv,
          readiness: config.readiness
        })
      });
    }
    const cached = commandCache.get(dedupKey);
    const result = await cached.result;
    const commandExecutionId = cached.commandExecutionId;
    const logArtifact = executionLog(id, provider, commandExecutionId, result);
    const artifacts = [logArtifact];
    const configuredReport = config.report ? resolve(cwd, config.report) : null;
    if (configuredReport && existsSync(configuredReport))
      artifacts.push({
        path: relative(ROOT, configuredReport), type: "structured-report", required: true
      });
    const jsonReport = configuredReport && existsSync(configuredReport)
      ? parseJsonOutput(readFileSync(configuredReport, "utf8"))
      : parseJsonOutput(result.stdout);
    const tapReport = ["tap", "auto"].includes(config.reportFormat || "auto")
      ? parseTapOutput(
        configuredReport && existsSync(configuredReport)
          ? readFileSync(configuredReport, "utf8") : result.stdout
      )
      : null;
    const report = jsonReport || tapReport;
    const baseFlags = {
      config, adapter: config.adapter, proofRunId, commandExecutionId,
      workspaceHash: providerWorkspaceHash(
        id, provider, state.activeProofRun?.workspaceHash
      ),
      claims: providerClaims(id, provider, config).join(","),
      command: built.display, started: result.startedAt,
      observed: result.timedOut ? `timeout after ${result.durationMs}ms` :
        result.error ? result.error.message :
        `exit ${result.status}; ${result.durationMs}ms; readiness ${result.readinessObserved ? "observed" : "not-observed"}`,
      durationMs: result.durationMs,
      log: logArtifact.path, artifacts,
      environment: config.environment || null, project: config.project || null
    };
  
    if (config.adapter === "test-discovery") {
      const testProvider = provider;
      const discoveryProvider = config.discoveryProvider || "discovery";
      const discoveryConfig = providerConfig(id, discoveryProvider) || config;
      const testStatus = result.timedOut || result.error ? "error" :
        result.status === 0 ? "pass" : "fail";
      recordReceipt(id, testProvider, testStatus, {
        ...baseFlags, claims: providerClaims(id, testProvider, config).join(",")
      });
      const discovered = numericReportValue(report, [
        "numTotalTests", "totalTests", "tests", "testCount", "expected"
      ]);
      const minimum = Number(config.minimum || 1);
      const discoveryStatus = result.timedOut || result.error ? "error" :
        discovered === null ? "inconclusive" :
        discovered >= minimum ? "pass" : "fail";
      recordReceipt(id, discoveryProvider, discoveryStatus, {
        ...baseFlags, config: discoveryConfig,
        claims: providerClaims(id, discoveryProvider, discoveryConfig).join(","),
        discovered: discovered ?? 0, minimum,
        observed: discovered === null ? "structured test count unavailable" :
          `${discovered} discovered; minimum ${minimum}`
      });
      return { provider, status: testStatus === "pass" && discoveryStatus === "pass" ? "pass" : "blocked" };
    }
  
    if (config.adapter === "playwright") {
      const summary = report ? playwrightReportSummary(report) : null;
      for (const attachment of summary?.attachments || []) {
        const attachmentPath = isAbsolute(attachment) ? attachment : resolve(cwd, attachment);
        if (existsSync(attachmentPath))
          artifacts.push({
            path: relative(ROOT, attachmentPath),
            type: "playwright-attachment", required: false
          });
      }
      const outputs = [...new Set([provider, ...(config.outputs || [])])]
        .filter((output) => requiredProviders(id).includes(output));
      let aggregateStatus = "pass";
      for (const output of outputs) {
        const requiredClaims = providerClaims(id, output, config);
        const missingClaims = summary
          ? requiredClaims.filter((claim) => !summary.claims.includes(claim))
          : requiredClaims;
        const status = result.timedOut || result.error ||
          (config.readiness?.url && !result.readinessObserved) ? "error" :
          result.status !== 0 || (summary?.failed || 0) > 0 ? "fail" :
          !summary || missingClaims.length ? "inconclusive" : "pass";
        if (status !== "pass") aggregateStatus = status;
        recordReceipt(id, output, status, {
          ...baseFlags,
          claims: requiredClaims.join(","),
          "input-mode": providerCapability(output, providerConfig(id, output)) === "browser"
            ? config.inputMode || "browser-automation" : config.inputMode || null,
          "foreground-required": config.foregroundRequired ? "yes" : "no",
          "foreground-available": config.foregroundAvailable ? "yes" : "no",
          observed: summary
            ? `${summary.tests} tests; ${summary.failed} failed; covered claims ${requiredClaims.length - missingClaims.length}/${requiredClaims.length}; observed annotations ${summary.claims.length}` +
              (missingClaims.length ? `; missing ${missingClaims.join(",")}` : "")
            : "Playwright JSON report unavailable"
        });
      }
      return { provider, status: aggregateStatus };
    }
  
    const capability = providerCapability(provider, config);
    const mutationResult = capability === "mutation" &&
        config.resultProtocol === "foundation-mutation-v1"
      ? mutationProtocolResult(result.stdout) : null;
    const status = result.timedOut || result.error ? "error" :
      capability === "mutation" && config.resultProtocol === "foundation-mutation-v1"
        ? ["behavioral-kill", "test-failure"].includes(mutationResult)
          ? "pass"
          : ["crash", "timeout", "not-applied"].includes(mutationResult)
            ? "error" : "fail"
        : result.status === 0 ? "pass" : "fail";
    recordReceipt(id, provider, status, {
      ...baseFlags,
      "input-mode": config.inputMode || null,
      "foreground-required": config.foregroundRequired ? "yes" : "no",
      "foreground-available": config.foregroundAvailable ? "yes" : "no",
      classification: mutationResult || config.classification,
      observed: mutationResult
        ? `mutation result ${mutationResult}; ${baseFlags.observed}`
        : baseFlags.observed
    });
    return { provider, status };
  }

  return {
    runProvider,
    startRequiredServices,
    executionLog,
    adapterResources,
    executeAdapter
  };
}
