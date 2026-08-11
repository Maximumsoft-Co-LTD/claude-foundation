import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { auditTraceability, normalizedTraceLabel } from "../evidence/traceability.mjs";
import { detectEvidenceWiring } from "../evidence/evidence-bootstrap.mjs";
import { nextAfterValidate } from "../core/next-step.mjs";
import {
  parseSpecRequirements, taskBlocks, taskMetadata
} from "./change-artifacts.mjs";

export function createChangeValidationRuntime({
  markBlocked = () => {},
  root,
  activeChangePath,
  changePath,
  walk,
  loadRuntime,
  saveRuntime,
  evidence,
  selectedRepositories,
  providerCapability,
  providerConfig,
  resolvedAcceptance,
  reviewPolicy,
  policyCapabilities,
  forecastCapabilities,
  rawExecution,
  commandExists,
  stableHash,
  knownProviders,
  writeJson,
  now,
  fail
}) {
  // `dir` is an override for the one case where the ledger is no longer at the
  // active path: an archive that moved the change directory and then failed.
  function pendingTasks(id, dir = activeChangePath(id)) {
    const path = join(dir, "tasks.md");
    if (!existsSync(path)) return [];
    return taskBlocks(readFileSync(path, "utf8")).filter((task) => !task.done);
  }

  function changeSpecScenarios(id, dir = activeChangePath(id)) {
    const specsRoot = join(dir, "specs");
    const scenarios = [];
    if (!existsSync(specsRoot)) return scenarios;
    walk(specsRoot, (path) => {
      if (!path.endsWith(".md")) return;
      const text = readFileSync(path, "utf8");
      const requirementAt = (index) => {
        const prefix = text.slice(0, index);
        return [...prefix.matchAll(/^### Requirement:\s*(.+?)\s*$/gm)]
          .at(-1)?.[1]?.trim() || null;
      };
      for (const match of text.matchAll(/^#### Scenario:\s*(.+?)\s*$/gm))
        scenarios.push({
          name: match[1].trim(),
          requirement: requirementAt(match.index),
          path: relative(root, path).replaceAll("\\", "/"),
          key: normalizedTraceLabel(match[1])
        });
    });
    return scenarios.sort((left, right) =>
      `${left.path}:${left.name}`.localeCompare(`${right.path}:${right.name}`));
  }

  // OpenSpec reconciles a MODIFIED requirement by replacing its scenario list
  // wholesale, so a scenario the delta stops naming reads as a deletion. That
  // is exactly what a rename looks like, and archive only discovers it after
  // the code has already landed. Report it while it is still cheap to fix.
  function droppedScenarioFindings(id, dir = activeChangePath(id)) {
    const specsRoot = join(dir, "specs");
    const findings = [];
    if (!existsSync(specsRoot)) return findings;
    walk(specsRoot, (path) => {
      if (!path.endsWith(".md")) return;
      const capability = relative(specsRoot, path).replaceAll("\\", "/").split("/")[0];
      const currentPath = join(root, "openspec", "specs", capability, "spec.md");
      if (!existsSync(currentPath)) return;
      const current = new Map(parseSpecRequirements(readFileSync(currentPath, "utf8"))
        .map((requirement) => [requirement.name, requirement.scenarios]));
      for (const requirement of parseSpecRequirements(readFileSync(path, "utf8"))) {
        if (!/^MODIFIED\b/i.test(requirement.section || "")) continue;
        const declared = new Set(requirement.scenarios);
        for (const scenario of current.get(requirement.name) || [])
          if (!declared.has(scenario))
            findings.push({
              capability,
              requirement: requirement.name,
              scenario,
              path: relative(root, path).replaceAll("\\", "/")
            });
      }
    });
    return findings;
  }

  // OpenSpec cannot modify or remove a requirement from a capability that has
  // no canonical specification yet. Archive catches that, but only after
  // Build and Prove have spent their work. Validate it while the contract is
  // still the only artifact that needs changing.
  function newCapabilityOperationFindings(id, dir = activeChangePath(id)) {
    const specsRoot = join(dir, "specs");
    const findings = [];
    if (!existsSync(specsRoot)) return findings;
    walk(specsRoot, (path) => {
      if (!path.endsWith(".md")) return;
      const capability = relative(specsRoot, path).replaceAll("\\", "/").split("/")[0];
      const currentPath = join(root, "openspec", "specs", capability, "spec.md");
      if (existsSync(currentPath)) return;
      for (const requirement of parseSpecRequirements(readFileSync(path, "utf8"))) {
        if (/^ADDED\b/i.test(requirement.section || "")) continue;
        findings.push({
          capability,
          operation: requirement.section || "an ungrouped requirement",
          requirement: requirement.name,
          path: relative(root, path).replaceAll("\\", "/")
        });
      }
    });
    return findings;
  }

  function assertNewCapabilitiesAreAdditive(id, dir = activeChangePath(id)) {
    const findings = newCapabilityOperationFindings(id, dir);
    if (!findings.length) return;
    const detail = findings.map((finding) =>
      `'${finding.operation}' for requirement '${finding.requirement}' in ${finding.capability}`
    ).join("; ");
    fail(`new capability spec delta uses a non-additive operation: ${detail}. ` +
      "A capability absent from openspec/specs/ has nothing to modify or remove; " +
      "declare every new requirement under '## ADDED Requirements'.");
  }

  // No bypass flag: OpenSpec enforces the same rule at archive time, so
  // skipping this check would only move the same failure past the point where
  // the code has already been projected into the target.
  function assertNoDroppedScenarios(id, dir = activeChangePath(id)) {
    const findings = droppedScenarioFindings(id, dir);
    if (!findings.length) return;
    const detail = findings.map((finding) =>
      `'${finding.scenario}' under requirement '${finding.requirement}' in ${finding.capability}`
    ).join("; ");
    fail(`spec delta drops ${findings.length} scenario(s) the current spec still declares: ${
      detail}. OpenSpec reads a MODIFIED block as the complete scenario list, so a renamed scenario archives as a deletion. Either keep the original scenario name, or rename the whole requirement: declare the old name under '## REMOVED Requirements' and the new name under '## ADDED Requirements' with its full scenario list. Reusing one requirement name in both sections is rejected.`);
  }

  function traceabilityAuditValue(id) {
    const state = loadRuntime(id);
    const dir = activeChangePath(id, state);
    const contract = evidence(id, dir);
    const tasks = taskBlocks(readFileSync(join(dir, "tasks.md"), "utf8"))
      .map(taskMetadata);
    const scenarios = state.schema === "foundation-standard"
      ? changeSpecScenarios(id, dir)
      : [];
    const configuredCapabilities = Object.entries(contract.providers || {})
      .map(([provider, config]) => providerCapability(provider, config))
      .filter(Boolean);
    return auditTraceability({
      id,
      state,
      contract,
      tasks,
      scenarios,
      configuredCapabilities
    });
  }

  function showTraceabilityAudit(id, flags = {}) {
    const audit = traceabilityAuditValue(id);
    if (flags.json) console.log(JSON.stringify(audit, null, 2));
    else {
      console.log(`TRACEABILITY ${id}: ${audit.status.toUpperCase()}`);
      console.log(`  scenarios: ${audit.summary.scenarios}; claims: ${audit.summary.claims}; tasks: ${audit.summary.tasks}`);
      console.log(`  linked claims: ${audit.summary.linkedClaims}/${audit.summary.claims}; linked tasks: ${audit.summary.linkedTasks}/${audit.summary.tasks}`);
      for (const finding of audit.findings)
        console.log(`  ${finding.level.toUpperCase().padEnd(7)} ${finding.code}: ${finding.message}`);
    }
    // A failing traceability audit is a refusal, not a crash. It exits without
    // `die` because the findings are already printed above, so it declares the
    // block explicitly instead.
    if (audit.status === "error") { markBlocked(); process.exitCode = 1; }
  }

  function changeArtifactGaps(state, dir) {
    const required = state.schema === "foundation-rapid"
      ? ["proposal.md", "tasks.md", "evidence.yaml"]
      : ["proposal.md", "design.md", "tasks.md", "evidence.yaml"];
    // `repositories.yaml` sits in both schemas' `apply.requires` and is written
    // by `createChange`, but nothing checked it here: deleting the file passed
    // `change validate` and only failed later, inside Land, where the recovery
    // is expensive. Gated with `execution.yaml` because the two arrived
    // together in the version-2 packet.
    if (Number(state.version || 1) >= 2)
      required.push("execution.yaml", "repositories.yaml");
    const missing = required.filter((name) => !existsSync(join(dir, name)));
    if (state.schema === "foundation-standard") {
      let specCount = 0;
      walk(join(dir, "specs"), () => { specCount += 1; });
      if (specCount === 0) missing.push("specs/**/*.md");
    }
    return missing;
  }

  function validate(id, source = "root", options = {}) {
    const state = loadRuntime(id);
    if (state.status === "archived") fail(`change '${id}' is already archived`);
    const dir = source === "active" ? activeChangePath(id, state) : changePath(id);
    const missing = changeArtifactGaps(state, dir);
    if (missing.length) fail(`missing change artifacts: ${missing.join(", ")}`);
    if (!["low", "medium", "high"].includes(state.impact || ""))
      fail(`resolve impact for '${id}'`);
    if (!["isolated", "coupled"].includes(state.coupling || ""))
      fail(`resolve coupling for '${id}'`);
    if (state.acceptance?.decision === "undecided")
      fail(`acceptance decision is unresolved for '${id}'; ask the user whether subjective human acceptance is required, then resolve with --acceptance-required or --acceptance-not-required`);
    assertNewCapabilitiesAreAdditive(id, dir);
    assertNoDroppedScenarios(id, dir);

    const tasks = readFileSync(join(dir, "tasks.md"), "utf8");
    const parsedTasks = taskBlocks(tasks);
    const taskIds = parsedTasks.map((task) => task.id).filter(Boolean);
    if (parsedTasks.length && taskIds.length !== parsedTasks.length)
      fail("every implementation task requires a stable ID such as T001");
    if (new Set(taskIds).size !== taskIds.length)
      fail("tasks.md contains duplicate task IDs");
    const lifecycleTasks = taskBlocks(tasks).filter((task) =>
      !task.done && /\/(?:prove|land)\b/.test(task.text));
    if (lifecycleTasks.length)
      fail("tasks.md contains a lifecycle gate; /prove and /land are commands, not implementation tasks");

    const claims = evidence(id, dir).claims;
    const claimById = new Map(claims.map((claim) => [claim.id, claim]));
    const selectedRepositoryIds = new Set(selectedRepositories(id, state)
      .map((repository) => repository.id));
    for (const claim of claims) {
      if (!["low", "medium", "high"].includes(claim.impact || ""))
        fail(`claim '${claim.id}' requires impact low|medium|high`);
      if (claim.repositories !== undefined &&
          (!Array.isArray(claim.repositories) || claim.repositories.length === 0 ||
           claim.repositories.some((repository) => !selectedRepositoryIds.has(repository))))
        fail(`claim '${claim.id}' repositories must reference selected repositories`);
      if ((claim.repositories || []).length > 1 &&
          !claim.capabilities.includes("cross-repo-contract"))
        fail(`claim '${claim.id}' spans repositories and requires cross-repo-contract`);
    }

    let acceptance = resolvedAcceptance(id, state, { claims });
    const unknownAcceptanceClaims = acceptance.claimIds.filter((claim) => !claimById.has(claim));
    if (unknownAcceptanceClaims.length)
      fail(`acceptance references unknown claim(s): ${unknownAcceptanceClaims.join(", ")}`);
    if (acceptance.required && acceptance.claimIds.length === 0) {
      if (acceptance.version < 2) {
        acceptance = {
          ...acceptance,
          claimIds: claims.map((claim) => claim.id),
          scopeOrigin: "legacy-all"
        };
        console.error("WARNING: migrated legacy acceptance scope to all current claims");
      } else {
        // Declaring acceptance required without naming what is to be accepted
        // leaves every later command refusing the change — validate, readiness,
        // sync and Land alike. The old wording named two flags of `change
        // resolve`, a command already run by the time anything reads this, and
        // said nothing about how to get out. Both exits belong here.
        fail(`change '${id}' requires acceptance but nothing is in scope. Either name the ` +
          "claims a person is accepting:\n" +
          `  claude-foundation change resolve ${id} --impact <impact> --coupling <coupling> ` +
          "--acceptance-required --acceptance-reason <why> --acceptance-claims <ids>\n" +
          "or declare capability 'acceptance' on a claim in evidence.yaml. To withdraw the " +
          "requirement instead, re-resolve with --acceptance-not-required.");
      }
    }
    if (acceptance.required) {
      // A claim declaring capability `acceptance` outranks the resolve flag —
      // `resolvedAcceptance` ORs the two — and this rewrite then persists the
      // derived answer. Silently. So `--acceptance-not-required` appeared to
      // do nothing, forever, and the only way to learn why was to read
      // `resolvedAcceptance`. Name the claims that hold the gate open, the way
      // `policyCapabilityTrigger` names the file that pulled a capability in.
      if (acceptance.scopeOrigin === "claim-capability")
        console.error(`WARNING: acceptance stays required because claim(s) ${acceptance.claimIds.join(", ")} declare capability 'acceptance'; --acceptance-not-required cannot drop a human gate while that capability remains in evidence.yaml`);
      state.acceptance = {
        version: 2,
        decision: "required",
        required: true,
        reason: acceptance.reason || "declared evidence capability",
        claimIds: acceptance.claimIds,
        scopeOrigin: acceptance.scopeOrigin || "explicit",
        declaredAt: state.acceptance?.declaredAt || now()
      };
    }

    for (const task of parsedTasks) {
      const metadata = taskMetadata(task);
      if (metadata.claims.length > 50)
        fail(`task '${task.id}' references more than 50 claims`);
      const unknownClaims = metadata.claims.filter((claim) => !claimById.has(claim));
      if (unknownClaims.length)
        fail(`task '${task.id}' references unknown claim(s): ${unknownClaims.join(", ")}`);
      const outOfScopeClaims = metadata.claims.filter((claimId) => {
        const repositories = claimById.get(claimId)?.repositories || [];
        return repositories.length > 0 && !repositories.includes(metadata.repository);
      });
      if (outOfScopeClaims.length)
        fail(`task '${task.id}' references claim(s) outside repository '${metadata.repository}': ${outOfScopeClaims.join(", ")}`);
    }

    const selected = selectedRepositories(id, state);
    if (selected.length > 1) {
      const unscopedTasks = parsedTasks.filter((task) =>
        !/\[repo:[a-z0-9-]+\]/i.test(task.text));
      if (unscopedTasks.length)
        fail(`multi-repository tasks require [repo:<id>] scope (${unscopedTasks.map((task) => task.id).join(", ")})`);
      for (const task of parsedTasks) {
        const metadata = taskMetadata(task);
        const repository = metadata.repository;
        if (repository && !selectedRepositoryIds.has(repository))
          fail(`task '${task.id}' references unselected repository '${repository}'`);
        if (metadata.paths.some((path) =>
          isAbsolute(path) || path === ".." || path.startsWith("../") || path.includes("/../")))
          fail(`task '${task.id}' contains an unsafe path scope`);
        if (["implementation", "migration"].includes(metadata.kind) && metadata.paths.length === 0)
          fail(`multi-repository task '${task.id}' requires [paths:<repo-relative-paths>]`);
      }
    }

    if (claims.some((claim) => claim.impact === "high")) state.reviewRequired = true;
    state.evidenceCapabilities = [...new Set(claims.flatMap((claim) => claim.capabilities))];
    // Case-insensitive and `xs`-aware: this compared against the literal "S",
    // so an atomic start's own "xs" fell through to the wide budget and the
    // check only ever passed via the impact disjunct.
    const budgets = ["xs", "s"].includes(String(state.size || "").toLowerCase())
      || state.impact === "low"
      ? { "proposal.md": 900, "design.md": 1400, "tasks.md": 900 }
      : { "proposal.md": 1600, "design.md": 2600, "tasks.md": 1600 };
    for (const [name, limit] of Object.entries(budgets)) {
      const path = join(dir, name);
      if (!existsSync(path)) continue;
      const words = readFileSync(path, "utf8").trim().split(/\s+/).filter(Boolean).length;
      if (words > limit)
        console.error(`WARNING: ${name} is ${words} words (soft budget ${limit}); retain only load-bearing content`);
    }
    saveRuntime(state);
    // A declared surface predicts capabilities that the *changed* surface will
    // only reveal once files exist — by which point this contract is signed and
    // its evidence collected. Warn, never fail: the forecast is a prediction the
    // author owns, and failing here would be routed around by declaring nothing.
    if (state.declaredSurface?.length && !options.quiet) {
      const covered = new Set(requiredProviders(id).map((provider) =>
        providerCapability(provider, providerConfig(id, provider))));
      const missing = forecastCapabilities(state.declaredSurface)
        .capabilities.filter((capability) => !covered.has(capability));
      if (missing.length)
        console.error(`WARNING: declared surface forecasts ${missing.join(", ")} with no provider; ` +
          "Prove will widen the contract and expire evidence already collected");
    }
    if (!options.quiet)
      console.log(`VALID ${id} (${state.schema}, ${claims.length} claims)\n  next: ${nextAfterValidate(state.status, id)}`);
  }

  function requiredProviders(id) {
    const state = loadRuntime(id);
    const contract = evidence(id);
    const providers = contract.providers || {};
    const required = new Set();
    const addCapability = (capability, repositories = []) => {
      const instances = Object.entries(providers).filter(([provider, config]) => {
        if (providerCapability(provider, config) !== capability) return false;
        if (!config.repository || repositories.length === 0) return true;
        return repositories.includes(config.repository);
      }).map(([provider]) => provider);
      if (instances.length) instances.forEach((provider) => required.add(provider));
      else required.add(capability);
    };
    for (const claim of contract.claims) {
      for (const capability of claim.capabilities) {
        addCapability(capability, claim.repositories || []);
        if (capability === "test") addCapability("discovery", claim.repositories || []);
      }
    }
    if (reviewPolicy(id, state, contract).required) addCapability("review");
    if (resolvedAcceptance(id, state, contract).required) addCapability("acceptance");
    for (const capability of policyCapabilities(id)) addCapability(capability);
    return [...required].sort();
  }

  function evidenceDetectionValue(id) {
    const state = loadRuntime(id);
    const contract = evidence(id);
    const repositories = selectedRepositories(id, state);
    return detectEvidenceWiring({
      id,
      root,
      contract,
      repositories,
      required: requiredProviders(id),
      providerConfig: (provider) => providerConfig(id, provider),
      providerCapability,
      knownProviders,
      commandExists,
      stableHash
    });
  }

  function showEvidenceDetection(id) {
    console.log(JSON.stringify(evidenceDetectionValue(id), null, 2));
  }

  function initializeEvidence(id, flags = {}) {
    const detection = evidenceDetectionValue(id);
    // `activeChangePath` points into the sandbox while one is active, which is
    // right for reading a Build packet and fatal for writing contract. `sync`
    // is one-way source → sandbox: it removes the destination, copies the
    // source over it, and merges back only `tasks.md`. Writing detected
    // providers into the sandbox therefore handed them to the next sync to
    // delete — silently, in both trees, after reporting them written. The
    // durable directory is what Land archives and what sync copies forward, so
    // it is the only placement a sync cannot destroy.
    const executionPath = join(changePath(id), "execution.yaml");
    // Build still has to see the wiring without paying for a sync, which would
    // bump `revision` and drop `provenHash`. The mirror is the identical value,
    // and the next sync overwrites it from the same source.
    const activePath = activeChangePath(id);
    const mirrorPath = activePath === changePath(id)
      ? null : join(activePath, "execution.yaml");
    const current = rawExecution(id);
    const additions = {};
    for (const candidate of detection.candidates.filter((row) => row.recommended && row.config)) {
      if (current.providers[candidate.provider] || additions[candidate.provider]) continue;
      additions[candidate.provider] = candidate.config;
    }
    const preview = {
      version: 1,
      changeId: id,
      write: Boolean(flags.write),
      path: relative(root, executionPath).replaceAll("\\", "/"),
      additions,
      skipped: detection.candidates
        .filter((row) => !row.recommended || !row.config)
        .map((row) => ({
          provider: row.provider,
          confidence: row.confidence,
          detail: row.detail
        }))
    };
    if (flags.write && Object.keys(additions).length) {
      const next = {
        ...current,
        providers: { ...current.providers, ...additions }
      };
      writeJson(executionPath, next);
      if (mirrorPath) writeJson(mirrorPath, next);
      preview.written = Object.keys(additions).sort();
    } else {
      preview.written = [];
    }
    console.log(JSON.stringify(preview, null, 2));
  }

  function showEvidenceDoctor(id) {
    const detection = evidenceDetectionValue(id);
    console.log(`EVIDENCE DOCTOR ${id}: ${detection.status}`);
    for (const row of detection.configured)
      console.log(`  OK       ${row.provider}: ${row.adapter} (${row.repository})`);
    for (const row of detection.candidates)
      console.log(`  ${row.recommended ? "CANDIDATE" : "REVIEW   "} ${row.provider}: ${row.source}${row.detail ? `; ${row.detail}` : ""}`);
    for (const row of detection.unresolved)
      console.log(`  BLOCKED  ${row.provider}: ${row.reason}; next: ${row.next}`);
    for (const row of detection.unavailable)
      console.log(`  BLOCKED  ${row.provider}: ${row.reason}; next: ${row.next}`);
    for (const row of detection.warnings)
      console.log(`  WARNING  ${row.source}: ${row.reason}; ${row.detail}`);
    if (detection.candidates.some((row) => row.recommended))
      console.log(`  next: claude-foundation evidence init ${id} --write`);
  }

  return {
    assertNewCapabilitiesAreAdditive,
    assertNoDroppedScenarios,
    changeArtifactGaps,
    changeSpecScenarios,
    droppedScenarioFindings,
    evidenceDetectionValue,
    initializeEvidence,
    newCapabilityOperationFindings,
    pendingTasks,
    requiredProviders,
    showEvidenceDetection,
    showEvidenceDoctor,
    showTraceabilityAudit,
    taskBlocks,
    taskMetadata,
    traceabilityAuditValue,
    validate
  };
}
