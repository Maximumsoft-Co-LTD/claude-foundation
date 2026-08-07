import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";

export function createDiagnosticsRuntime({
  root,
  version,
  runtimeApiVersion,
  providerProtocolVersion,
  adapterProtocolVersion,
  proofProtocolVersion,
  packetSchemaVersion,
  agentPlanSchemaVersion,
  contextEventSchemaVersion,
  reviewProtocolVersion,
  acceptanceProtocolVersion,
  reviewPacketSchemaVersion,
  attestationProtocolVersion,
  authorityProtocolVersion,
  ciEvidenceProtocolVersion,
  providerContracts,
  activeChanges,
  orphanRuntimeChanges,
  runtimePath,
  proofPath,
  readJson,
  readJsonOrNull,
  relevantHash,
  protocolDescriptor,
  repositoryCatalog,
  foundationPolicy,
  isolationInspection,
  openSpecCliStatus,
  loadRuntime,
  evidence,
  selectedRepositories,
  gitHead,
  playwrightAvailability,
  requiredProviders,
  providerConfig,
  receiptValidity,
  providerWorkspace,
  commandExists,
  topologyIssues,
  policyCapabilities,
  policyCapabilityTrigger,
  providerCapability,
  unverifiedDrift,
  unresolvedApplyTransactions,
  parseFlags,
  parseStrictCommandFlags,
  fail
}) {
  function showChanges() {
    const ids = activeChanges();
    const orphans = orphanRuntimeChanges();
    if (!ids.length) console.log("No active changes.");
    for (const id of ids) {
      // One unreadable state file used to kill the whole listing — every other
      // change became invisible because of a neighbour. `changes` is how a
      // stuck project is diagnosed, so it degrades per row instead.
      let state;
      if (!existsSync(runtimePath(id))) state = { status: "untracked" };
      else {
        state = readJsonOrNull(runtimePath(id));
        if (state === null) {
          console.log(`${id}\tinvalid-runtime-json\tunknown\tclaude-foundation change abandon ${id} --reason <reason> --decision-ref <ref>`);
          continue;
        }
      }
      const proof = existsSync(proofPath(id)) ? readJson(proofPath(id), {}) : null;
      const current = state.status === "untracked" ? null : relevantHash(id);
      const readiness = proof?.status === "pass" && proof.workspaceHash === current
        ? "ready-to-land"
        : state.status === "proven" ? "stale-proof" : state.status;
      // A listed change without a real next command reads as a dead entry, so
      // every reachable status names the operation that moves it.
      const nextByReadiness = {
        "ready-to-land": `claude-foundation land check ${id}`,
        "stale-proof": `claude-foundation proof readiness ${id}`,
        change: `claude-foundation change validate ${id}`,
        building: `claude-foundation proof readiness ${id}`,
        applied: `claude-foundation land archive ${id}`,
        landing: `claude-foundation land resume ${id}`
      };
      const next = nextByReadiness[readiness] ||
        `claude-foundation doctor --change ${id}`;
      console.log(`${id}\t${readiness}\t${state.schema || "unknown"}\t${next}`);
    }
    for (const orphan of orphans)
      console.log(`${orphan.id}\torphan-runtime\t${orphan.schema}\t${orphan.reason}`);
  }

  function showProviders() {
    for (const [provider, contract] of Object.entries(providerContracts))
      console.log(`${provider}\t${contract}`);
    console.log("CONFIG test-discovery\t" + JSON.stringify({
      test: {
        adapter: "test-discovery",
        command: ["<project-test-command>"],
        report: "<workspace-relative-structured-json-report>",
        minimum: 1,
        timeoutMs: 120000
      }
    }));
  }

  function doctor(flags = {}) {
    const checks = [];
    const stage = flags.stage || "prove";
    if (!["change", "build", "prove"].includes(stage))
      fail("doctor --stage must be change|build|prove");

    if (flags.unattended) {
      if (!flags.change) fail("doctor --unattended requires --change <id>");
      const isolation = isolationInspection(flags.change, flags);
      checks.push({
        level: isolation.execution.safeForUnattended ? "ok" : "error",
        name: "unattended-security-boundary",
        detail: isolation.execution.safeForUnattended
          ? `${isolation.securityBoundary.kind} detected without host-control hazards`
          : isolation.execution.reasons.join("; ")
      });
    }

    const nodeParts = process.versions.node.split(".").map(Number);
    const nodeOk = nodeParts[0] > 20 || (nodeParts[0] === 20 && nodeParts[1] >= 19);
    checks.push({ level: nodeOk ? "ok" : "error", name: "node", detail: process.versions.node });
    const protocols = protocolDescriptor();
    const protocolOk = String(protocols.runtimeApi) === runtimeApiVersion &&
      String(protocols.providerProtocol) === providerProtocolVersion &&
      String(protocols.adapterProtocol) === adapterProtocolVersion &&
      String(protocols.proofProtocol) === proofProtocolVersion &&
      String(protocols.packetSchema) === packetSchemaVersion &&
      String(protocols.agentPlanSchema) === agentPlanSchemaVersion &&
      String(protocols.contextEventSchema) === contextEventSchemaVersion &&
      String(protocols.reviewProtocol) === reviewProtocolVersion &&
      String(protocols.acceptanceProtocol) === acceptanceProtocolVersion &&
      String(protocols.reviewPacketSchema) === reviewPacketSchemaVersion &&
      String(protocols.attestationProtocol) === attestationProtocolVersion &&
      String(protocols.authorityProtocol) === authorityProtocolVersion &&
      String(protocols.ciEvidenceProtocol) === ciEvidenceProtocolVersion;
    checks.push({
      level: protocolOk ? "ok" : "error",
      name: "protocol-bundle",
      detail: protocolOk
        ? `runtime API ${runtimeApiVersion}; provider ${providerProtocolVersion}; proof ${proofProtocolVersion}; packet ${packetSchemaVersion}; review ${reviewProtocolVersion}/${reviewPacketSchemaVersion}; acceptance ${acceptanceProtocolVersion}; attestation ${attestationProtocolVersion}; authority ${authorityProtocolVersion}; signed-ci ${ciEvidenceProtocolVersion}; plan ${agentPlanSchemaVersion}; context ${contextEventSchemaVersion}`
        : "protocol.json is incompatible with foundation.mjs; reinstall Foundation"
    });

    const catalog = repositoryCatalog();
    checks.push({
      level: catalog.drift.length ? "warn" : "ok",
      name: "repository-topology",
      detail: catalog.drift.length
        ? `unregistered submodules: ${catalog.drift.map((item) => item.path).join(", ")}`
        : `${catalog.repositories.length} repository node(s)`
    });
    const modelPolicy = foundationPolicy();
    checks.push({
      level: "ok",
      name: "model-policy",
      detail: `fast=${modelPolicy.models.fast.family}; standard=${modelPolicy.models.standard.family}; deep=${modelPolicy.models.deep.family}; max-parallel=${modelPolicy.execution.maxParallelAgents}`
    });
    checks.push({
      level: modelPolicy.execution.legacyNumericPacketBytes === undefined ? "ok" : "warn",
      name: "packet-policy",
      detail: modelPolicy.execution.legacyNumericPacketBytes === undefined
        ? `task=${modelPolicy.execution.packetBytes.task}; review=${modelPolicy.execution.packetBytes.review}; repository=${modelPolicy.execution.packetBytes.repository}; global=${modelPolicy.execution.packetBytes.global}`
        : `legacy numeric limit ${modelPolicy.execution.legacyNumericPacketBytes}; migrate to scoped task/repository/global limits`
    });

    const openspec = openSpecCliStatus(root);
    checks.push({
      // An unusable CLI only blocks doctor when the caller asked about Land.
      level: openspec.level === "error" && !flags["require-archive"]
        ? "warn" : openspec.level,
      name: "openspec",
      detail: openspec.detail
    });

    const requestedChange = flags.change || null;
    const orphanRuntimes = orphanRuntimeChanges();
    checks.push({
      level: orphanRuntimes.length ? "warn" : "ok",
      name: "runtime-state",
      detail: orphanRuntimes.length
        ? `orphan runtime(s): ${orphanRuntimes.map((item) => `${item.id}:${item.reason}`).join(", ")}; restore the active change or quarantine the runtime file`
        : "no orphan active runtime state"
    });
    const requestedOrphan = requestedChange
      ? orphanRuntimes.find((item) => item.id === requestedChange)
      : null;
    if (requestedOrphan) {
      checks.push({
        level: "error",
        name: `change:${requestedChange}`,
        detail: `${requestedOrphan.reason}; restore openspec/changes/${requestedChange} or move .foundation/runtime/${requestedChange}.json to .foundation/recovery/orphaned-runtime/`
      });
    } else if (requestedChange) {
      const state = loadRuntime(requestedChange);
      const workspace = state.workspace?.path || root;
      const contract = evidence(requestedChange);
      const selected = selectedRepositories(requestedChange, state);
      for (const repository of selected) {
        const available = existsSync(repository.path);
        const initialized = available && (
          repository.type === "external" || Boolean(gitHead(repository.path))
        );
        checks.push({
          level: initialized ? "ok" : (repository.mode === "write" ? "error" : "warn"),
          name: `repository:${repository.id}`,
          detail: !available ? "missing"
            : initialized ? `${repository.type}; ${repository.mode}; ${repository.relativePath}`
              : "not initialized as Git"
        });
      }
      // Keep the eager host inspection from the original diagnostics path.
      playwrightAvailability(workspace);
      for (const provider of requiredProviders(requestedChange)) {
        const config = providerConfig(requestedChange, provider);
        const current = receiptValidity(requestedChange, provider);
        if (!config) {
          checks.push({
            level: current.validity === "valid" ? "ok" : "warn",
            name: `provider:${provider}`,
            detail: current.validity === "valid"
              ? "external receipt valid"
              : "no executable adapter; external receipt required"
          });
          continue;
        }
        if (config.adapter === "external") {
          checks.push({
            level: current.validity === "valid" ? "ok" : "warn",
            name: `provider:${provider}`,
            detail: current.validity === "valid" ? "external receipt valid" : "awaiting external receipt"
          });
          continue;
        }
        const executable = config.command?.[0];
        const providerCwd = providerWorkspace(requestedChange, provider, config);
        const commandAvailable = commandExists(executable, providerCwd);
        checks.push({
          level: commandAvailable ? "ok" : (stage === "prove" ? "error" : "info"),
          name: `provider:${provider}:command`,
          detail: commandAvailable
            ? executable
            : `${executable || "missing"} ${stage === "prove" ? "unavailable" : "planned"}`
        });
        if (config.adapter === "playwright") {
          const providerPlaywright = playwrightAvailability(providerCwd);
          checks.push({
            level: providerPlaywright.packageOwned && providerPlaywright.binaryAvailable
              ? "ok" : (stage === "prove" ? "error" : "info"),
            name: "playwright:package",
            detail: providerPlaywright.packageOwned && providerPlaywright.binaryAvailable
              ? "project-owned dependency available"
              : "install and lock @playwright/test in the project"
          });
          checks.push({
            level: providerPlaywright.config ? "ok" : "warn",
            name: "playwright:config",
            detail: providerPlaywright.config || "no config found; command must provide complete setup"
          });
          checks.push({
            level: config.readiness?.url ? "ok" : "info",
            name: "playwright:readiness",
            detail: config.readiness?.url || "delegated to Playwright webServer configuration"
          });
        }
      }
      for (const issue of topologyIssues(requestedChange))
        checks.push({
          level: stage === "prove" ? "error" : "warn",
          name: "proof-topology",
          detail: issue
        });
      // Land stops outright on a transaction it could not finish unwinding, so
      // surfacing it here turns a surprise at Land into a known state earlier.
      const unresolved = unresolvedApplyTransactions
        ? unresolvedApplyTransactions(requestedChange) : [];
      const divergent = unresolved.filter((journal) =>
        ["rolling-back", "manual-recovery"].includes(journal.status));
      checks.push({
        level: divergent.length ? "error" : unresolved.length ? "warn" : "ok",
        name: "apply-transactions",
        detail: unresolved.length
          ? `${unresolved.map((journal) => `${journal.transactionId}:${journal.status}`).join(", ")}${
            divergent.length ? "; Land will stop until this is resolved" : "; recovers on the next apply"}`
          : "no unresolved apply transaction"
      });
      const policy = policyCapabilities(requestedChange);
      checks.push({
        level: "info",
        name: "policy-capabilities",
        // Naming the file that pulled a capability in makes a surprising
        // requirement diagnosable in one read.
        detail: policy.length
          ? policy.map((capability) => {
            const trigger = policyCapabilityTrigger(requestedChange, capability);
            return trigger ? `${capability} (from ${trigger})` : capability;
          }).join(", ")
          : "none inferred from changed surface"
      });
      // `mutation` is the only provider that answers "do these gates actually
      // detect a fault?", and it is the one no file pattern can infer: nothing
      // about a path says the suite around it is load-bearing. So it is exactly
      // the capability a change under time pressure omits, and its absence looks
      // identical to a change that considered it and decided against. Naming it
      // is not the same as requiring it — the contract stays the author's.
      const proves = requiredProviders(requestedChange).some((provider) =>
        providerCapability(provider, providerConfig(requestedChange, provider)) === "mutation");
      if (state.impact === "high" && !proves)
        checks.push({
          level: "warn",
          name: "mutation-coverage",
          detail: "high-impact change declares no 'mutation' provider; nothing proves the evidence suite detects a deliberate fault"
        });
      // "could not be checked" must not read like "checked and matched".
      const unverified = unverifiedDrift ? unverifiedDrift(requestedChange) : [];
      if (unverified.length)
        checks.push({
          level: "warn",
          name: "model-drift-unverified",
          detail: `${unverified.length} risk-sensitive execution(s) ran a model the host did not report; tier compliance is unproven, not confirmed (${
            [...new Set(unverified.map((row) => row.reason))].join("; ")})`
        });
      if (contract.version === 1)
        checks.push({
          level: "info",
          name: "evidence-schema",
          detail: "v1 manual-compatible; v2 enables executable adapters"
        });
    }

    for (const hook of ["protect-secrets.sh", "lint.sh"]) {
      const installed = existsSync(join(root, ".claude", "hooks", hook));
      checks.push({
        level: installed ? "ok" : "error",
        name: `hook:${hook}`,
        detail: installed ? "installed" : "missing"
      });
    }
    const legacyHookTests = ["run-hook-tests.sh", "run-artifact-lint-tests.sh"]
      .filter((name) => existsSync(join(root, ".claude", "hooks", "tests", name)));
    checks.push({
      level: legacyHookTests.length ? "warn" : "ok",
      name: "legacy-hook-tests",
      detail: legacyHookTests.length
        ? `stale packaged tests found (${legacyHookTests.join(", ")}); reinstall Foundation`
        : "absent"
    });

    const settings = readJson(join(root, ".claude", "settings.json"), {});
    const settingsText = JSON.stringify(settings);
    const directMainEnabled = settingsText.includes("no-direct-main-commit.sh");
    checks.push({
      level: "info",
      name: "no-direct-main",
      detail: directMainEnabled ? "enabled" : "disabled (opt-in policy)"
    });

    if (flags.json) console.log(JSON.stringify({ version: 1, stage, checks }, null, 2));
    else for (const check of checks)
      console.log(`${check.level.toUpperCase().padEnd(5)} ${check.name}: ${check.detail}`);
    if (checks.some((check) => check.level === "error")) process.exitCode = 1;
  }

  function migrate(values) {
    // Strict, not parseFlags: `--apply` is boolean, and the greedy parser
    // swallowed the following legacy id as its value — so `migrate --apply
    // <id>` silently migrated *every* legacy run and reported success. It also
    // accepted `--apply=false`, whose truthy string "false" still wrote.
    const { flags, rest } = parseStrictCommandFlags(values, "migrate", {
      boolean: ["apply"]
    });
    if (rest.length > 1) fail(`migrate accepts at most one legacy id: ${rest.join(", ")}`);
    const legacyRoot = join(root, ".workflow");
    const candidates = existsSync(legacyRoot)
      ? readdirSync(legacyRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
        .filter((entry) => !rest[0] || entry.name === rest[0])
      : [];
    if (!candidates.length) {
      console.log("No matching legacy runs.");
      return;
    }
    console.log(`${flags.apply ? "MIGRATION CANDIDATES WRITTEN" : "MIGRATION DRY RUN"}:`);
    for (const entry of candidates) {
      console.log(`  ${entry.name} -> openspec/migration-candidates/${entry.name}.md`);
      if (flags.apply) {
        const target = join(root, "openspec", "migration-candidates", `${entry.name}.md`);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target,
          `# Migration candidate: ${entry.name}\n\n` +
          `Source: \`.workflow/${entry.name}/\` (preserved read-only)\n\n` +
          "Only copy statements corroborated by code, tests, or an accepted contract.\n" +
          "Classify remaining items as current spec, new change, stable context, obsolete, or speculative.\n");
      }
    }
  }

  function usage() {
    console.log(`Foundation harness ${version}

Commands:
  doctor [--stage change|build|prove] [--require-archive] [--change <id>] [--unattended --attestation <file>] [--json]
  repos [change]
  models
  agent-plan <change> [--group <n>] [--full] [--pretty]
  agent-task <change> <task> [--pretty]
  agent-acquire <change> <task> --owner <agent-id>
  agent-release <change> <task> --owner <agent-id> [--force] [--decision-ref <ref>]
  new <intent> [--id <id>] [--rapid] [--draft <project-file.json>]
  resolve <change> --impact <low|medium|high> --coupling <isolated|coupled>
  abandon <change> --reason <reason> --decision-ref <ref> [--applied keep|revert]
  changes
  providers
  packet <change> [--phase change|build|prove|review|land] [--repo <id>] [--task <id>] [--pretty]
  metrics <change>
  budget-continue <change> --reason <reason> --decision-ref <ref> [--run <id>]
  validate <change>
  audit-change <change> [--json]
  hash <change>
  proof-plan <change>
  proof-readiness <change>
  proof-run <change>
  proof-collect <change>
  proof-preflight <change>
  proof-execute <change>
  proof-audit <change>
  receipt <change> <provider> <pass|fail|inconclusive|error> [--claims=a,b]
  evidence-detect <change>
  evidence-init <change> [--write]
  evidence-doctor <change>
  evidence-verify-ci <change> <provider> <signed.json>
  evidence-upgrade <change>
  authority-request <change> --type review|acceptance
  authority-status <change> [--request <id>]
  authority-record <change> --request <id> --response <file>
  run-provider <change> <provider> -- <command> [args...]
  prove <change>
  land-check <change>
  land-plan <change>
  land-record <change> --repo <id> --commit <sha> --decision-ref <ref> [--ci pass|fail|pending]
  land-pointers <change>
  land-resume <change>
  sandbox challenge <change>
  sandbox inspect <change> [--json] [--unattended --attestation <file>]
  sandbox create <change> [--all] [--unattended --attestation <file>]
  sandbox sync|apply <change>
  archive <change>
  event <change> --request <id> [metrics...]
  telemetry-sync <change> [transcript.jsonl]
  telemetry-import <change> <file> [--format generic|codex|cursor|otel|claude]
  migrate [legacy-id] [--apply]`);
  }

  return { doctor, migrate, showChanges, showProviders, usage };
}
