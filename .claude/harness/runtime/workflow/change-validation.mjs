import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { auditTraceability } from "../evidence/traceability.mjs";
import { detectEvidenceWiring } from "../evidence/evidence-bootstrap.mjs";
import { nextAfterValidate } from "../core/next-step.mjs";
import {
  taskBlocks, taskMetadata
} from "../contracts/change-artifacts.mjs";
import { createSpecDeltaValidator } from "./validation/spec-delta.mjs";

// Module scope, taking `fail` explicitly: the check has no runtime state and
// the deterministic tests exercise it against a stubbed CLI.
export function assertOpenSpecStrictValid(id, dir, fail) {
  // dir is <projectRoot>/openspec/changes/<id> for both the root and the
  // sandbox copy, so the CLI runs against whichever tree is being validated.
  const projectRoot = resolve(dir, "..", "..", "..");
  const probe = spawnSync("openspec", ["--version"], {
    cwd: projectRoot, encoding: "utf8", timeout: 15_000
  });
  if (probe.error || probe.status !== 0) {
    console.error("WARNING: OpenSpec CLI unavailable; strict spec lint deferred to Land, which requires it");
    return;
  }
  const lint = spawnSync("openspec",
    ["validate", id, "--type", "change", "--strict", "--json", "--no-interactive"],
    { cwd: projectRoot, encoding: "utf8", timeout: 60_000 });
  if (lint.error || lint.status !== 0) {
    const detail = `${lint.stdout || ""}\n${lint.stderr || ""}`.trim().slice(0, 4000);
    fail(`OpenSpec strict validation failed for '${id}'; repair the spec delta wording before Prove:\n${detail}`);
  }
}

function normalizedScope(path) {
  return String(path || "").replace(/^\.\//, "")
    .replace(/\/\*\*?$/, "").replace(/\/$/, "");
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globMatchesPath(scope, path) {
  const raw = String(scope || "").replace(/^\.\//, "").replace(/\/$/, "");
  let pattern = "";
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === "*") {
      if (raw[index + 1] === "*") {
        pattern += ".*";
        index += 1;
      } else pattern += "[^/]*";
    } else if (character === "?") pattern += "[^/]";
    else pattern += escapeRegex(character);
  }
  return new RegExp(`^${pattern}$`).test(path);
}

function scopeCouldTouchPath(scope, path) {
  const raw = String(scope || "").replace(/^\.\//, "").replace(/\/$/, "");
  if (raw === "*") return true;
  if (/[*?]/.test(raw)) {
    if (globMatchesPath(raw, path)) return true;
    const prefix = raw.slice(0, raw.search(/[*?]/)).replace(/\/$/, "");
    return Boolean(prefix && (prefix === path || prefix.startsWith(`${path}/`)));
  }
  const normalized = normalizedScope(raw);
  return path === normalized || path.startsWith(`${normalized}/`) ||
    normalized.startsWith(`${path}/`);
}

export function groundingTaskOverlapFindings(readSet = [], tasks = []) {
  const immutableRoles = new Set([
    "requirement", "backlog", "architecture", "contract",
    "dependency-source", "history"
  ]);
  const findings = [];
  for (const source of readSet) {
    if (!immutableRoles.has(source?.role)) continue;
    const sourceRepo = source.repository || "root";
    const sourcePath = normalizedScope(source.path);
    if (!sourcePath) continue;
    for (const task of tasks.map(taskMetadata)) {
      if (!["implementation", "migration"].includes(task.kind) ||
          task.repository !== sourceRepo) continue;
      for (const declared of task.paths) {
        if (scopeCouldTouchPath(declared, sourcePath)) {
          findings.push({
            taskId: task.id,
            repository: sourceRepo,
            path: source.path,
            role: source.role,
            taskPath: declared
          });
          break;
        }
      }
    }
  }
  return findings;
}

export function claimContractIssues(claims = [], selectedRepositoryIds = new Set()) {
  return claims.flatMap((claim) => {
    const issues = [];
    if (!["low", "medium", "high"].includes(claim.impact || ""))
      issues.push(`claim '${claim.id}' requires impact low|medium|high`);
    if (claim.repositories !== undefined &&
        (!Array.isArray(claim.repositories) || claim.repositories.length === 0 ||
         claim.repositories.some((repository) => !selectedRepositoryIds.has(repository))))
      issues.push(`claim '${claim.id}' repositories must reference selected repositories`);
    if ((claim.repositories || []).length > 1 &&
        !claim.capabilities.includes("cross-repo-contract"))
      issues.push(`claim '${claim.id}' spans repositories and requires cross-repo-contract`);
    return issues;
  });
}

export function taskContractIssues(tasks = [], claims = [],
  selectedRepositoryIds = new Set(), multiRepository = false) {
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const issues = [];
  for (const task of tasks) {
    const metadata = taskMetadata(task);
    if (metadata.claims.length > 50)
      issues.push(`task '${task.id}' references more than 50 claims`);
    const unknownClaims = metadata.claims.filter((claim) => !claimById.has(claim));
    if (unknownClaims.length)
      issues.push(`task '${task.id}' references unknown claim(s): ${unknownClaims.join(", ")}`);
    const outOfScopeClaims = metadata.claims.filter((claimId) => {
      const repositories = claimById.get(claimId)?.repositories || [];
      return repositories.length > 0 && !repositories.includes(metadata.repository);
    });
    if (outOfScopeClaims.length)
      issues.push(`task '${task.id}' references claim(s) outside repository '${metadata.repository}': ${outOfScopeClaims.join(", ")}`);
  }
  if (!multiRepository) return issues;
  const unscopedTasks = tasks.filter((task) =>
    !/\[repo:[a-z0-9-]+\]/i.test(task.text));
  if (unscopedTasks.length)
    issues.push(`multi-repository tasks require [repo:<id>] scope (${unscopedTasks.map((task) => task.id).join(", ")})`);
  for (const task of tasks) {
    const metadata = taskMetadata(task);
    if (metadata.repository && !selectedRepositoryIds.has(metadata.repository))
      issues.push(`task '${task.id}' references unselected repository '${metadata.repository}'`);
    if (metadata.paths.some((path) =>
      isAbsolute(path) || path === ".." || path.startsWith("../") || path.includes("/../")))
      issues.push(`task '${task.id}' contains an unsafe path scope`);
    if (["implementation", "migration"].includes(metadata.kind) && metadata.paths.length === 0)
      issues.push(`multi-repository task '${task.id}' requires [paths:<repo-relative-paths>]`);
  }
  return issues;
}

function failValidationLayer(fail, name, issues) {
  if (issues.length)
    fail(`${name} validation failed:\n  - ${issues.join("\n  - ")}`);
}

export const NFR_CATEGORY_CAPABILITIES = Object.freeze({
  performance: ["performance"],
  capacity: ["performance", "resilience"],
  availability: ["resilience"],
  securityPrivacy: ["security-static"],
  accessibility: ["accessibility"],
  operability: ["observability"],
  compatibility: ["compatibility", "cross-repo-contract"],
  recoverability: ["resilience", "data-migration", "deployment"]
});

export function semanticInvariantIssues(invariants, contract, decisionIds,
  specScenarios, { required = false } = {}) {
  const rows = Array.isArray(invariants) ? invariants : [];
  const issues = [];
  if (required && !Array.isArray(invariants))
    return ["grounding.yaml semanticInvariants must be an array"];
  const claims = new Map((contract?.claims || []).map((claim) => [claim.id, claim]));
  const scenarioNames = new Set([...specScenarios].map((name) => name.toLowerCase()));
  const invariantIds = new Set();
  const boundClaims = new Set();
  for (const [index, row] of rows.entries()) {
    const label = `semanticInvariants[${index}]`;
    const id = String(row?.id || "").trim();
    if (!/^INV-[A-Z0-9][A-Z0-9-]*$/i.test(id))
      issues.push(`${label}.id must match INV-<stable-id>`);
    if (invariantIds.has(id.toUpperCase())) issues.push(`${label}.id '${id}' is duplicated`);
    invariantIds.add(id.toUpperCase());
    if (!String(row?.statement || "").trim()) issues.push(`${label}.statement is required`);
    for (const field of ["decisionIds", "claimIds", "specScenarios"])
      if (!Array.isArray(row?.[field]) || row[field].length === 0)
        issues.push(`${label}.${field} must be a non-empty array`);
    for (const decisionId of row?.decisionIds || [])
      if (!decisionIds.has(decisionId))
        issues.push(`${label} references unknown decision '${decisionId}'`);
    for (const claimId of row?.claimIds || []) {
      boundClaims.add(claimId);
      if (!claims.has(claimId)) issues.push(`${label} references unknown claim '${claimId}'`);
    }
    for (const scenario of row?.specScenarios || [])
      if (!scenarioNames.has(String(scenario).toLowerCase()))
        issues.push(`${label} references unknown spec scenario '${scenario}'`);
  }
  const compatibilityClaims = [...claims.values()].filter((claim) =>
    (claim.capabilities || []).some((capability) =>
      ["compatibility", "cross-repo-contract"].includes(capability)));
  for (const claim of compatibilityClaims)
    if (!boundClaims.has(claim.id))
      issues.push(`compatibility claim '${claim.id}' requires a semantic invariant binding`);
  return issues;
}

export function durableDecisionMetadataIssues(content) {
  const rawSection = String(content || "").match(
    /^## Decisions\s*$([\s\S]*?)(?=^## Compatibility and migration\s*$)/m
  )?.[1]?.trim();
  if (!rawSection) return ["design.md requires a Decisions section"];
  const section = rawSection.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (/^`?none`?[.!]?$/i.test(section)) return [];
  if (/^- \*\*Decision:\*\*/m.test(section))
    return ["every durable decision requires Decision ID metadata; legacy Decision entries are not allowed"];
  const starts = [...section.matchAll(/^- \*\*Decision ID:\*\*\s*(\S.*?)\s*$/gm)];
  if (!starts.length)
    return ["each durable decision requires a stable Decision ID or the section must be `none`"];
  const issues = [];
  const ids = new Set();
  const decisions = [];
  const fields = [
    "Status", "Decision", "Why", "Rejected", "Consequences",
    "Supersedes", "Superseded by"
  ];
  if (starts[0].index !== 0)
    issues.push("Decisions contains content outside a Decision ID block");
  for (const [index, start] of starts.entries()) {
    const end = starts[index + 1]?.index ?? section.length;
    const block = section.slice(start.index, end);
    const id = start[1].trim();
    const label = `decision '${id}'`;
    if (!/^DEC-[A-Z0-9][A-Z0-9-]*$/i.test(id))
      issues.push(`${label} ID must match DEC-<stable-id>`);
    if (ids.has(id.toUpperCase())) issues.push(`${label} is duplicated`);
    ids.add(id.toUpperCase());
    const values = Object.fromEntries(fields.map((field) => [field,
      block.match(new RegExp(`^\\s+- \\*\\*${field}:\\*\\*\\s*(.+?)\\s*$`, "mi"))?.[1]?.trim()
    ]));
    const allowedLine = new RegExp(
      `^(?:- \\*\\*Decision ID:\\*\\*|\\s+- \\*\\*(?:${fields.join("|")}):\\*\\*)`
    );
    if (block.split("\n").some((line) => line.trim() && !allowedLine.test(line)))
      issues.push(`${label} contains content outside its metadata fields`);
    for (const field of fields)
      if (!values[field]) issues.push(`${label} requires ${field}`);
    if (values.Status && !["accepted", "superseded"].includes(values.Status.toLowerCase()))
      issues.push(`${label} Status must be accepted|superseded`);
    decisions.push({ id: id.toUpperCase(), label, values });
  }
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  const reference = /^(?:[a-z0-9][a-z0-9._-]*#)?DEC-[A-Z0-9][A-Z0-9-]*$/i;
  const localReference = (value) => !value.includes("#") ? value.toUpperCase() : null;
  for (const decision of decisions) {
    const status = decision.values.Status?.toLowerCase();
    const supersedes = decision.values.Supersedes || "";
    const supersededBy = decision.values["Superseded by"] || "";
    for (const [field, value] of [["Supersedes", supersedes], ["Superseded by", supersededBy]]) {
      if (/^none$/i.test(value)) continue;
      if (!reference.test(value)) {
        issues.push(`${decision.label} ${field} must be none, DEC-<id>, or <change>#DEC-<id>`);
        continue;
      }
      const local = localReference(value);
      if (local === decision.id) issues.push(`${decision.label} ${field} cannot reference itself`);
      if (local && !byId.has(local)) issues.push(`${decision.label} ${field} references unknown local decision '${value}'`);
    }
    if (status === "superseded" && /^none$/i.test(supersededBy))
      issues.push(`${decision.label} with superseded status must name its replacement`);
    if (status === "accepted" && !/^none$/i.test(supersededBy))
      issues.push(`${decision.label} naming Superseded by must have superseded status`);
    const supersedesLocal = !/^none$/i.test(supersedes) ? localReference(supersedes) : null;
    if (supersedesLocal && byId.has(supersedesLocal) &&
        byId.get(supersedesLocal).values["Superseded by"]?.toUpperCase() !== decision.id)
      issues.push(`${decision.label} Supersedes '${supersedes}' requires a reciprocal Superseded by link`);
    const supersededByLocal = !/^none$/i.test(supersededBy)
      ? localReference(supersededBy) : null;
    if (supersededByLocal && byId.has(supersededByLocal) &&
        byId.get(supersededByLocal).values.Supersedes?.toUpperCase() !== decision.id)
      issues.push(`${decision.label} Superseded by '${supersededBy}' requires a reciprocal Supersedes link`);
  }
  return issues;
}

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
  reviewAssurancePosture = () => null,
  policyCapabilities,
  policyCapabilityTrigger,
  changedSurfaceResolvable,
  forecastCapabilities,
  rawExecution,
  handoffContract,
  contractFingerprint,
  commandExists,
  stableHash,
  fileDigest,
  pathInside,
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

  const {
    assertExistingCapabilityOperations, assertNewCapabilitiesAreAdditive,
    assertNoDroppedScenarios,
    changeSpecScenarios,
    droppedScenarioFindings,
    newCapabilityOperationFindings
  } = createSpecDeltaValidator({ root, activeChangePath, walk, fail });

  function validationRepositories(id, state, dir) {
    const rootSource = resolve(dir) === resolve(changePath(id));
    return selectedRepositories(id, state, fail, {
      changeDir: dir,
      useTargetPaths: rootSource
    });
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
    if (state.groundingRequired) required.push("grounding.yaml");
    // `repositories.yaml` sits in both schemas' `apply.requires` and is written
    // by `createChange`, but nothing checked it here: deleting the file passed
    // `change validate` and only failed later, inside Land, where the recovery
    // is expensive. Gated with `execution.yaml` because the two arrived
    // together in the version-2 packet.
    if (Number(state.version || 1) >= 2)
      required.push("execution.yaml", "repositories.yaml");
    if (state.externalOperationsVersion)
      required.push("handoffs.yaml");
    const missing = required.filter((name) => !existsSync(join(dir, name)));
    if (state.schema === "foundation-standard") {
      let specCount = 0;
      walk(join(dir, "specs"), () => { specCount += 1; });
      if (specCount === 0) missing.push("specs/**/*.md");
    }
    return missing;
  }

  const scaffoldPatterns = [
    ["replace-with marker", /replace-with/i],
    ["unresolved clarification", /\[NEEDS CLARIFICATION(?::[^\]]*)?\]/i],
    ["unresolved TODO/TBD", /\b(?:TODO|TBD)\b/],
    ["template angle marker", /<(?:Problem|Observable|Only load-bearing|choice|constraint|meaningful alternative|operational, compatibility|Public contracts|risk|mitigation|provider|name|existing name|stable scenario name|every existing stable scenario name|action or event|complete modified observable behavior|behavior being retired|replacement, compatibility consequence|Explicitly excluded|code, API|semantic boundary|path or surface|focused check)[^>]*>/i],
    ["template removal comment", /<!--[\s\S]*?(?:delete (?:this section )?when unused|include the complete modified requirement|name removed behavior|use only when the canonical spec)[\s\S]*?-->/i]
  ];

  function assertNoScaffolds(state, dir) {
    // Strict scaffold rejection is a contract for changes created under the
    // grounding workflow. Grandfathering older ledgers avoids turning a
    // runtime upgrade into unrelated cleanup work across every active change.
    if (!state.groundingRequired) return;
    const files = [
      "proposal.md", "design.md", "tasks.md", "evidence.yaml",
      "execution.yaml", "repositories.yaml", "handoffs.yaml"
    ];
    if (state.groundingRequired) files.push("grounding.yaml");
    const specsRoot = join(dir, "specs");
    walk(specsRoot, (path) => {
      if (path.endsWith(".md")) files.push(relative(dir, path));
    });
    const findings = [];
    for (const name of [...new Set(files)]) {
      const artifact = join(dir, name);
      if (!existsSync(artifact)) continue;
      const content = readFileSync(artifact, "utf8");
      for (const [label, pattern] of scaffoldPatterns)
        if (pattern.test(content)) findings.push(`${name}: ${label}`);
    }
    if (findings.length)
      fail(`change artifacts still contain scaffold or unresolved content: ${findings.join("; ")}`);
  }

  function readGroundingDocument(id, state, dir) {
    let value;
    try {
      value = JSON.parse(readFileSync(join(dir, "grounding.yaml"), "utf8"));
    } catch {
      fail(`${id}/grounding.yaml must be JSON-compatible YAML`);
    }
    if (![1, 2].includes(value.version))
      fail(`${id}/grounding.yaml requires version 1 or 2`);
    if (Number(state.groundingVersion || 1) >= 2 && value.version !== 2)
      fail(`${id}/grounding.yaml requires version 2 for this change; migrate all newly material decisions in one Decision Sheet`);
    const digest = stableHash(value);
    if (state.groundingDigest && state.groundingDigest !== digest)
      fail(`${id}/grounding.yaml changed after its decision batch was locked; ` +
        `use change resolve ${id} --reopen-grounding --decision-ref <ref> ` +
        "--reopen-reason <reason> for one batched revision, or retire and replace the change");
    return { value, digest, firstLock: !state.groundingDigest };
  }

  function validateGroundingDecision(id, decision) {
    if (decision.status !== "locked")
      fail(`${id}/grounding.yaml decisionBatch.status must be locked`);
    if (!["prd", "backlog", "user-batch", "recommended-default", "mixed"].includes(decision.source))
      fail(`${id}/grounding.yaml decisionBatch.source must be prd|backlog|user-batch|recommended-default|mixed`);
    if (!String(decision.reference || "").trim())
      fail(`${id}/grounding.yaml decisionBatch.reference is required`);
    if (!["single-batch", "no-material-questions"].includes(decision.mode))
      fail(`${id}/grounding.yaml decisionBatch.mode must be single-batch|no-material-questions`);
    if (!Number.isFinite(Date.parse(String(decision.lockedAt || ""))))
      fail(`${id}/grounding.yaml decisionBatch.lockedAt must be an ISO-8601 timestamp`);
    if (!Array.isArray(decision.decisions) || decision.decisions.length === 0)
      fail(`${id}/grounding.yaml decisionBatch.decisions must record every locked choice/default`);
    const ids = new Set();
    for (const [index, row] of decision.decisions.entries()) {
      const label = `${id}/grounding.yaml decisionBatch.decisions[${index}]`;
      if (!["prd", "backlog", "user-batch", "recommended-default"].includes(row.source))
        fail(`${label}.source must be prd|backlog|user-batch|recommended-default`);
      for (const field of ["id", "question", "answer"])
        if (!String(row[field] || "").trim()) fail(`${label}.${field} is required`);
      if (ids.has(row.id)) fail(`${label}.id is duplicated`);
      ids.add(row.id);
    }
    return ids;
  }

  function validateGroundingSemanticInvariants(id, state, dir, value, decisionIds) {
    if (!state.semanticInvariantsRequired) return;
    const specScenarios = new Set();
    walk(join(dir, "specs"), (path) => {
      if (!path.endsWith(".md")) return;
      const content = readFileSync(path, "utf8");
      for (const match of content.matchAll(/^#### Scenario:\s*(.+?)\s*$/gm))
        specScenarios.add(match[1].trim());
    });
    failValidationLayer(fail, "semantic invariant", semanticInvariantIssues(
      value.semanticInvariants, evidence(id, dir), decisionIds, specScenarios,
      { required: true }));
  }

  function validateConditionalGroundingSection(id, name, row, listName) {
    const label = `${id}/grounding.yaml ${name}`;
    if (!["applicable", "not-applicable"].includes(row?.status))
      fail(`${label}.status must be applicable|not-applicable`);
    if (!String(row?.sourceReason || "").trim())
      fail(`${label}.sourceReason is required even when the section is N/A`);
    if (!Array.isArray(row?.[listName])) fail(`${label}.${listName} must be an array`);
    if (row.status === "applicable" && row[listName].length === 0)
      fail(`${label}.${listName} must be non-empty when applicable`);
  }

  function groundingV2Context(id, state, dir, value) {
    const risk = value.risk || {};
    if (!["low", "medium", "high"].includes(risk.tier))
      fail(`${id}/grounding.yaml risk.tier must be low|medium|high`);
    if (!Array.isArray(risk.classes) || risk.classes.length === 0 ||
        risk.classes.some((entry) => !String(entry || "").trim()))
      fail(`${id}/grounding.yaml risk.classes must be a non-empty string array`);
    if (!String(risk.rationale || "").trim())
      fail(`${id}/grounding.yaml risk.rationale is required`);
    const contract = evidence(id, dir);
    const routedTier = reviewPolicy(id, state, contract).tier;
    const rank = { low: 0, medium: 1, high: 2 };
    if (rank[risk.tier] < rank[routedTier])
      fail(`${id}/grounding.yaml risk.tier '${risk.tier}' understates the deterministic review tier '${routedTier}'`);
    validateConditionalGroundingSection(id, "productionEntry", value.productionEntry, "paths");
    validateConditionalGroundingSection(id, "realWire", value.realWire, "contracts");
    validateConditionalGroundingSection(
      id, "activationSemantics", value.activationSemantics, "activatedPaths");
    if (!Array.isArray(value.activationSemantics?.failureSemanticChanges))
      fail(`${id}/grounding.yaml activationSemantics.failureSemanticChanges must be an array`);
    validateConditionalGroundingSection(
      id, "serviceInteractions", value.serviceInteractions, "rows");
    validateConditionalGroundingSection(id, "observability", value.observability, "rows");
    const capabilities = new Set(contract.claims
      .flatMap((claim) => claim.capabilities || []));
    const riskClasses = new Set(risk.classes
      .map((entry) => String(entry).toLowerCase()));
    const semantics = `${state.intent || ""} ${[...riskClasses].join(" ")}`.toLowerCase();
    const selected = validationRepositories(id, state, dir);
    const mandatoryService = state.coupling === "coupled" || selected.length > 1 ||
      ["cross-repo-contract", "integration", "live", "queue", "resilience"]
        .some((capability) => capabilities.has(capability)) ||
      /\b(queue|broker|rabbit|kafka|event|callback|consumer|producer)\w*\b/.test(semantics);
    const mandatoryWire = mandatoryService ||
      ["compatibility", "browser"].some((capability) => capabilities.has(capability)) ||
      /\b(wire|contract|http|api|json|message|payload)\w*\b/.test(semantics);
    const mandatoryActivation = [...riskClasses].some((entry) =>
      ["legacy", "activation", "cutover"].some((token) => entry.includes(token))) ||
      /\b(activat|cutover|enable existing|wire existing|turn on)\w*\b/.test(semantics);
    return {
      risk, contract, capabilities, riskClasses, semantics, selected,
      mandatoryService, mandatoryWire, mandatoryActivation
    };
  }

  function requiredNfrCategories(state, v2) {
    const required = new Set();
    const requireWhen = (category, capabilities) => {
      if (capabilities.some((capability) => v2.capabilities.has(capability)))
        required.add(category);
    };
    requireWhen("performance", ["performance"]);
    requireWhen("availability", ["resilience"]);
    requireWhen("securityPrivacy", ["security-static"]);
    requireWhen("accessibility", ["accessibility"]);
    requireWhen("operability", ["observability"]);
    requireWhen("compatibility", ["compatibility", "cross-repo-contract"]);
    requireWhen("recoverability", ["data-migration", "deployment"]);
    if ((state.securityTriggers || []).length) required.add("securityPrivacy");
    if (v2.mandatoryService)
      ["availability", "operability", "recoverability"].forEach((name) => required.add(name));
    if (v2.capabilities.has("data-migration"))
      ["compatibility", "recoverability"].forEach((name) => required.add(name));
    if (/\b(performance|latency|throughput)\b/.test(v2.semantics)) required.add("performance");
    if (/\b(capacity|scalability|scale)\b/.test(v2.semantics)) required.add("capacity");
    if (/\b(availability|uptime|reliability)\b/.test(v2.semantics)) required.add("availability");
    return required;
  }

  function validateApplicableNfrClaim(label, category, row, context) {
    const allowedCapabilities = NFR_CATEGORY_CAPABILITIES[category];
    for (const claimId of row.claimIds) {
      const claim = context.claimById.get(claimId);
      if (!claim) fail(`${label} references unknown claim '${claimId}'`);
      if (!allowedCapabilities.some((capability) =>
        (claim.capabilities || []).includes(capability)))
        fail(`${label} claim '${claimId}' must declare one of: ${allowedCapabilities.join(", ")}`);
      if (!context.taskClaimIds.has(claimId))
        fail(`${label} claim '${claimId}' has no implementation task owner`);
    }
    if (!allowedCapabilities.some((capability) =>
      context.configuredCapabilities.has(capability)))
      fail(`${label} has no configured capable evidence provider`);
    if (category === "securityPrivacy" && !row.claimIds.some((claimId) => {
      const claim = context.claimById.get(claimId);
      return /(?:cannot|denied|reject|unauthor|forbid|invalid|isolation|privacy|redact)/i
        .test(`${claim?.id || ""} ${claim?.scenario || ""}`);
    })) fail(`${label} requires an observable negative-path or privacy-control claim`);
  }

  function validateNfrCategory(id, category, row, context) {
    const label = `${id}/grounding.yaml nfrAssessment.${category}`;
    if (!row || !["applicable", "not-applicable"].includes(row.status))
      fail(`${label}.status must be applicable|not-applicable`);
    if (!String(row.sourceReason || "").trim()) fail(`${label}.sourceReason is required`);
    if (!Array.isArray(row.claimIds)) fail(`${label}.claimIds must be an array`);
    if (context.required.has(category) && row.status !== "applicable")
      fail(`${label} is required by the declared risk or evidence capability`);
    if (row.status === "not-applicable") {
      if (row.claimIds.length) fail(`${label}.claimIds must be empty when not applicable`);
      return;
    }
    const target = String(row.target || "").trim();
    if (!target || /^none$/i.test(target)) fail(`${label}.target is required when applicable`);
    if (["performance", "capacity"].includes(category) && !/\d/.test(target))
      fail(`${label}.target must contain a measurable numeric threshold`);
    if (row.claimIds.length === 0) fail(`${label}.claimIds must be non-empty when applicable`);
    validateApplicableNfrClaim(label, category, row, context);
  }

  function validateNfrAssessment(id, state, value, parsedTasks, v2) {
    if (!state.nfrAssessmentRequired) return;
    const assessment = value.nfrAssessment;
    if (!assessment || typeof assessment !== "object" || Array.isArray(assessment))
      fail(`${id}/grounding.yaml nfrAssessment is required for this change`);
    const categoryNames = Object.keys(NFR_CATEGORY_CAPABILITIES);
    const unknown = Object.keys(assessment).filter((name) => !categoryNames.includes(name));
    if (unknown.length)
      fail(`${id}/grounding.yaml nfrAssessment has unknown categories: ${unknown.join(", ")}`);
    const context = {
      required: requiredNfrCategories(state, v2),
      claimById: new Map(v2.contract.claims.map((claim) => [claim.id, claim])),
      taskClaimIds: new Set(parsedTasks.map(taskMetadata)
        .filter((task) => ["implementation", "migration"].includes(task.kind))
        .flatMap((task) => task.claims)),
      configuredCapabilities: new Set(Object.entries(v2.contract.providers || {})
        .map(([provider, config]) => providerCapability(provider, config)).filter(Boolean))
    };
    for (const category of categoryNames)
      validateNfrCategory(id, category, assessment[category], context);
  }

  function validateRequiredV2Sections(id, value, v2) {
    if (value.productionEntry.status !== "applicable")
      fail(`${id}/grounding.yaml productionEntry cannot be N/A for an implementation claim`);
    if (v2.mandatoryWire && value.realWire.status !== "applicable")
      fail(`${id}/grounding.yaml realWire is required by the declared contract/integration risk`);
    if (v2.mandatoryActivation && value.activationSemantics.status !== "applicable")
      fail(`${id}/grounding.yaml activationSemantics is required when existing behavior is activated or cut over`);
    if (v2.mandatoryService && value.serviceInteractions.status !== "applicable")
      fail(`${id}/grounding.yaml serviceInteractions is required by the declared cross-service/queue surface`);
    if (v2.mandatoryService && value.observability.status !== "applicable")
      fail(`${id}/grounding.yaml observability is required for every declared service interaction`);
  }

  function validateGroundingSourceRows(id, value, selected) {
    const repositories = new Map(selected.map((repository) => [repository.id, repository]));
    const validateRows = (name, rows, allowedRoles) => {
      for (const [index, source] of rows.entries()) {
        const label = `${id}/grounding.yaml ${name}[${index}]`;
        const repository = repositories.get(source?.repository || "root");
        const sourcePath = String(source?.path || "");
        if (!repository) fail(`${label} references an unselected repository`);
        if (!sourcePath || isAbsolute(sourcePath))
          fail(`${label}.path must be repository-relative`);
        const absolute = resolve(repository.workspacePath, sourcePath);
        if (!pathInside(repository.workspacePath, absolute) || !existsSync(absolute))
          fail(`${label}.path does not resolve inside repository '${repository.id}'`);
        if (!value.readSet.some((row) =>
          (row.repository || "root") === repository.id && row.path === sourcePath &&
          allowedRoles.includes(row.role)))
          fail(`${label} must appear in readSet with role ${allowedRoles.join("|")}`);
      }
    };
    validateRows("productionEntry.paths", value.productionEntry.paths,
      ["production-path", "runtime-path"]);
    validateRows("realWire.contracts", value.realWire.contracts,
      ["contract", "test-topology"]);
    validateRows("activationSemantics.activatedPaths",
      value.activationSemantics.activatedPaths, ["production-path", "runtime-path"]);
  }

  function requiredInteractionFields(row, fields, label) {
    for (const field of fields)
      if (!String(row?.[field] || "").trim()) fail(`${label}.${field} is required`);
  }

  function validateServiceInteractionRows(id, value) {
    const interactionIds = new Set();
    for (const [index, row] of (value.serviceInteractions?.rows || []).entries()) {
      const label = `${id}/grounding.yaml serviceInteractions.rows[${index}]`;
      requiredInteractionFields(row, [
        "id", "owner", "producer", "consumer", "contract", "delivery",
        "timeoutRetry", "idempotency", "ordering", "consistency", "rollout", "rollback"
      ], label);
      if (interactionIds.has(row.id)) fail(`${label}.id is duplicated`);
      interactionIds.add(row.id);
    }
    const observed = new Set();
    for (const [index, row] of (value.observability?.rows || []).entries()) {
      const label = `${id}/grounding.yaml observability.rows[${index}]`;
      requiredInteractionFields(row, [
        "interactionId", "correlation", "structuredEvents", "sli",
        "alert", "runbook", "operatorQuestion"
      ], label);
      if (row.interactionId !== "local" && !interactionIds.has(row.interactionId))
        fail(`${label}.interactionId does not reference a service interaction`);
      observed.add(row.interactionId);
    }
    if (value.serviceInteractions?.status === "applicable")
      for (const interactionId of interactionIds)
        if (!observed.has(interactionId))
          fail(`${id}/grounding.yaml observability must cover interaction '${interactionId}'`);
  }

  function validateGroundingCriticalCases(id, rows) {
    const criticalIds = new Set();
    for (const [index, row] of rows.entries()) {
      const label = `${id}/grounding.yaml criticalCases[${index}]`;
      if (!String(row?.id || "").trim() || criticalIds.has(row.id))
        fail(`${label}.id must be non-empty and unique`);
      if (!Array.isArray(row.claimIds) || row.claimIds.length === 0)
        fail(`${label}.claimIds must be non-empty`);
      if (!["production-entry", "real-wire", "contract-oracle", "failure-path"].includes(row.oracle))
        fail(`${label}.oracle is invalid`);
      criticalIds.add(row.id);
    }
    return criticalIds;
  }

  function validateGroundingMutants(id, rows, criticalIds) {
    const mutantIds = new Set();
    for (const [index, row] of rows.entries()) {
      const label = `${id}/grounding.yaml mutants[${index}]`;
      if (!String(row?.id || "").trim() || mutantIds.has(row.id))
        fail(`${label}.id must be non-empty and unique`);
      if (!Array.isArray(row.claimIds) || row.claimIds.length === 0 ||
          !String(row.class || "").trim())
        fail(`${label} requires claimIds and class`);
      if (!criticalIds.has(row.killerCaseId))
        fail(`${label}.killerCaseId must name a critical case`);
      mutantIds.add(row.id);
    }
  }

  function validateCriticalCasesAndMutants(id, value) {
    if (!Array.isArray(value.criticalCases) || !Array.isArray(value.mutants))
      fail(`${id}/grounding.yaml criticalCases and mutants must be arrays`);
    const criticalIds = validateGroundingCriticalCases(id, value.criticalCases);
    validateGroundingMutants(id, value.mutants, criticalIds);
  }

  function validateGroundingReadSet(id, value, repositories, firstLock) {
    const roles = new Set([
      "requirement", "backlog", "architecture", "contract", "composition-root",
      "runtime-path", "production-path", "test-topology", "dependency-source", "history"
    ]);
    const immutableRoles = new Set([
      "requirement", "backlog", "architecture", "contract", "dependency-source", "history"
    ]);
    for (const [index, source] of value.readSet.entries()) {
      const label = `${id}/grounding.yaml readSet[${index}]`;
      const repository = repositories.get(source.repository || "root");
      if (!repository) fail(`${label} references an unselected repository`);
      if (!roles.has(source.role)) fail(`${label}.role is invalid`);
      if (!["full", "targeted"].includes(source.mode))
        fail(`${label}.mode must be full|targeted`);
      const sourcePath = String(source.path || "");
      if (!sourcePath || isAbsolute(sourcePath))
        fail(`${label}.path must be repository-relative`);
      const absolute = resolve(repository.workspacePath, sourcePath);
      if (!pathInside(repository.workspacePath, absolute) || !existsSync(absolute))
        fail(`${label}.path does not resolve inside repository '${repository.id}'`);
      if (!/^[a-f0-9]{64}$/i.test(String(source.sha256 || "")))
        fail(`${label}.sha256 must be a SHA-256 hex digest`);
      if ((firstLock || immutableRoles.has(source.role)) &&
          fileDigest(absolute) !== String(source.sha256).toLowerCase())
        fail(`${label}.sha256 does not match the baseline file. ` +
          `If '${sourcePath}' is intentionally edited by this change, its role ` +
          "must be production-path or runtime-path (immutable roles pin decision " +
          "sources); re-role the row and refresh its sha256. If the edit is " +
          "unintended drift, restore the file to its baseline.");
    }
  }

  function validateGroundingTaskOverlap(id, value, parsedTasks) {
    const overlap = groundingTaskOverlapFindings(value.readSet, parsedTasks);
    if (overlap.length)
      fail(`${id}/grounding.yaml immutable readSet overlaps implementation task paths:\n  - ${
        overlap.map((row) => `${row.taskId}: ${row.repository}/${row.path} ` +
          `(${row.role}) overlaps [paths:${row.taskPath}]`).join("\n  - ")
      }\nFiles the change will edit must use role production-path or runtime-path; keep immutable decision sources outside writable task scopes.`);
    if (!value.readSet.some((source) => ["requirement", "backlog"].includes(source.role)))
      fail(`${id}/grounding.yaml must read a requirement or backlog source`);
  }

  function validateGroundingReadRoles(id, state, contract, readSet) {
    const roles = new Set(readSet.map((source) => source.role));
    if (state.coupling === "coupled")
      for (const role of ["architecture", "contract", "composition-root"])
        if (!roles.has(role))
          fail(`${id}/grounding.yaml coupled work requires a ${role} readSet entry`);
    const capabilities = new Set(contract.claims.flatMap((claim) => claim.capabilities || []));
    if (["test", "integration", "live", "mutation", "browser"].some((capability) =>
      capabilities.has(capability)) && !roles.has("test-topology"))
      fail(`${id}/grounding.yaml test-backed claims require a test-topology readSet entry`);
    const securityWork = (state.securityTriggers || []).length > 0 ||
      ["security", "security-static"].some((capability) => capabilities.has(capability));
    if (securityWork && !roles.has("dependency-source"))
      fail(`${id}/grounding.yaml security work requires a dependency-source readSet entry`);
  }

  function validateGroundingPath(id, label, row, repositories, value, role, failureRequired) {
    const repository = repositories.get(row?.repository || "root");
    const sourcePath = String(row?.path || "");
    if (!repository) fail(`${label} references an unselected repository`);
    if (!sourcePath || isAbsolute(sourcePath))
      fail(`${label}.path must be repository-relative`);
    const absolute = resolve(repository.workspacePath, sourcePath);
    if (!pathInside(repository.workspacePath, absolute) || !existsSync(absolute))
      fail(`${label}.path does not resolve inside repository '${repository.id}'`);
    if (failureRequired && !String(row?.failure || "").trim())
      fail(`${label}.failure is required`);
    const included = value.readSet.some((source) =>
      (source.repository || "root") === repository.id && source.path === sourcePath &&
      (!role || source.role === role));
    if (!included)
      fail(role
        ? `${label} must appear in readSet with role ${role} and a baseline digest`
        : `${label} must appear in readSet with a baseline digest`);
  }

  function validateGroundingClaimEvidence(label, claim, evidenceClaim) {
    const classes = new Set([
      "static", "unit", "test", "integration", "live", "mutation", "security",
      "review", "acceptance", "browser", "deployment", "cross-repo-contract"
    ]);
    if (!Array.isArray(claim.evidenceClass) || claim.evidenceClass.length === 0 ||
        claim.evidenceClass.some((entry) => !String(entry || "").trim()))
      fail(`${label}.evidenceClass must be a non-empty string array`);
    if (claim.evidenceClass.some((entry) => !classes.has(entry)))
      fail(`${label}.evidenceClass contains an unsupported class`);
    if (!String(claim.testDoubleGap || "").trim())
      fail(`${label}.testDoubleGap must be none or describe the gap`);
    if (claim.testDoubleGap !== "none" &&
        !claim.evidenceClass.some((entry) => ["integration", "live"].includes(entry)))
      fail(`${label} declares a test-double gap without integration or live evidence`);
    const capabilities = new Set(evidenceClaim?.capabilities || []);
    const aliases = {
      static: ["static-analysis", "security-static"], unit: ["test"], test: ["test"],
      integration: ["integration"], live: ["live"], mutation: ["mutation"],
      security: ["security", "security-static"], review: ["review"],
      acceptance: ["acceptance"], browser: ["browser"], deployment: ["deployment"],
      "cross-repo-contract": ["compatibility", "integration"]
    };
    for (const evidenceClass of claim.evidenceClass)
      if (!aliases[evidenceClass].some((capability) => capabilities.has(capability)))
        fail(`${label}.evidenceClass '${evidenceClass}' is not declared by evidence.yaml for claim '${claim.id}'`);
    if (evidenceClaim?.impact === "high" && !claim.evidenceClass.some((entry) =>
      ["integration", "live", "security", "review"].includes(entry)))
      fail(`${label} maps a high-impact claim only to low-fidelity evidence`);
  }

  function validateGroundingClaims(id, value, contract, repositories) {
    const claimIds = new Set(contract.claims.map((claim) => claim.id));
    if (!Array.isArray(value.claims) || value.claims.length !== claimIds.size)
      fail(`${id}/grounding.yaml must map every evidence claim exactly once`);
    const seen = new Set();
    for (const [index, claim] of value.claims.entries()) {
      const label = `${id}/grounding.yaml claims[${index}]`;
      if (!claimIds.has(claim.id)) fail(`${label}.id references an unknown evidence claim`);
      if (seen.has(claim.id)) fail(`${label}.id is duplicated`);
      seen.add(claim.id);
      if (!Array.isArray(claim.productionPath) || claim.productionPath.length === 0)
        fail(`${label}.productionPath must be a non-empty array`);
      for (const [pathIndex, row] of claim.productionPath.entries())
        validateGroundingPath(id, `${label}.productionPath[${pathIndex}]`, row,
          repositories, value, "production-path", false);
      if (!Array.isArray(claim.failurePaths) || claim.failurePaths.length === 0)
        fail(`${label}.failurePaths must be a non-empty array`);
      for (const [pathIndex, row] of claim.failurePaths.entries())
        validateGroundingPath(id, `${label}.failurePaths[${pathIndex}]`, row,
          repositories, value, null, true);
      const evidenceClaim = contract.claims.find((entry) => entry.id === claim.id);
      validateGroundingClaimEvidence(label, claim, evidenceClaim);
    }
    return claimIds;
  }

  function validateV2ClaimCoverage(id, value, contract, claimIds) {
    const material = contract.claims.filter((claim) => claim.impact !== "low" &&
      (claim.capabilities || []).some((capability) =>
        ["test", "integration", "live", "browser"].includes(capability)));
    const criticalCoverage = new Set(value.criticalCases.flatMap((row) => row.claimIds));
    for (const claim of material)
      if (!criticalCoverage.has(claim.id))
        fail(`${id}/grounding.yaml material test claim '${claim.id}' requires a stable criticalCases row`);
    for (const [index, row] of value.criticalCases.entries())
      for (const claimId of row.claimIds)
        if (!claimIds.has(claimId))
          fail(`${id}/grounding.yaml criticalCases[${index}] references unknown claim '${claimId}'`);
    const mutationClaims = contract.claims.filter((claim) =>
      (claim.capabilities || []).includes("mutation"));
    const mutationCoverage = new Set(value.mutants.flatMap((row) => row.claimIds));
    for (const claim of mutationClaims)
      if (!mutationCoverage.has(claim.id))
        fail(`${id}/grounding.yaml mutation claim '${claim.id}' requires a named mutant and killer case`);
    for (const [index, row] of value.mutants.entries())
      for (const claimId of row.claimIds)
        if (!claimIds.has(claimId))
          fail(`${id}/grounding.yaml mutants[${index}] references unknown claim '${claimId}'`);
  }

  function validateV2ExecutionBindings(id, dir, value) {
    const providers = Object.values(rawExecution(id, dir).providers || {});
    const configuredCases = new Set(providers.flatMap((provider) => provider.criticalCases || []));
    for (const row of value.criticalCases || [])
      if (!configuredCases.has(row.id))
        fail(`${id}/execution.yaml must bind critical case '${row.id}' in a provider.criticalCases list`);
    const mutationProviders = providers.filter((provider) =>
      provider.resultProtocol === "foundation-mutation-v2");
    const configuredMutants = new Set(mutationProviders
      .flatMap((provider) => provider.requiredMutants || []));
    for (const row of value.mutants || []) {
      if (!configuredMutants.has(row.id)) {
        fail(`${id}/execution.yaml must bind mutant '${row.id}' in a foundation-mutation-v2 provider.requiredMutants list`);
        continue;
      }
      const provider = mutationProviders.find((candidate) =>
        (candidate.requiredMutants || []).includes(row.id));
      if (provider?.mutantKillers?.[row.id] !== row.killerCaseId)
        fail(`${id}/execution.yaml mutantKillers.${row.id} must equal grounding killerCaseId '${row.killerCaseId}'`);
      if (!(provider?.criticalCases || []).includes(row.killerCaseId))
        fail(`${id}/execution.yaml mutation provider must require killer critical case '${row.killerCaseId}'`);
    }
  }

  function validateDerivedGroundingFacts(id, value) {
    if (!Array.isArray(value.derivedFacts || []))
      fail(`${id}/grounding.yaml derivedFacts must be an array`);
    for (const [index, fact] of (value.derivedFacts || []).entries())
      if (!String(fact.fact || "").trim() || !String(fact.command || "").trim())
        fail(`${id}/grounding.yaml derivedFacts[${index}] requires fact and command`);
  }

  function groundingValue(id, state, dir, parsedTasks = []) {
    if (!state.groundingRequired) return null;
    const grounding = readGroundingDocument(id, state, dir);
    const { value, digest: groundingDigest, firstLock } = grounding;
    const decision = value.decisionBatch || {};
    const decisionIds = validateGroundingDecision(id, decision);
    validateGroundingSemanticInvariants(id, state, dir, value, decisionIds);

    if (!Array.isArray(value.readSet) || value.readSet.length === 0)
      fail(`${id}/grounding.yaml readSet must be non-empty`);

    if (value.version === 2) {
      const v2 = groundingV2Context(id, state, dir, value);
      const {
        risk, contract: v2Contract, capabilities: v2Capabilities,
        semantics, selected, mandatoryService, mandatoryWire, mandatoryActivation
      } = v2;
      validateNfrAssessment(id, state, value, parsedTasks, v2);
      validateRequiredV2Sections(id, value, v2);
      validateGroundingSourceRows(id, value, selected);
      validateServiceInteractionRows(id, value);
      validateCriticalCasesAndMutants(id, value);
    }

    const repositories = new Map(validationRepositories(id, state, dir)
      .map((repository) => [repository.id, repository]));
    validateGroundingReadSet(id, value, repositories, firstLock);
    validateGroundingTaskOverlap(id, value, parsedTasks);

    const contract = evidence(id, dir);
    validateGroundingReadRoles(id, state, contract, value.readSet);
    const claimIds = validateGroundingClaims(id, value, contract, repositories);

    if (value.version === 2) {
      validateV2ClaimCoverage(id, value, contract, claimIds);
      validateV2ExecutionBindings(id, dir, value);
    }

    validateDerivedGroundingFacts(id, value);
    return { value, digest: groundingDigest, firstLock, lockedAt: decision.lockedAt };
  }

  function validate(id, source = "root", options = {}) {
    const state = loadRuntime(id);
    if (state.status === "archived") fail(`change '${id}' is already archived`);
    const dir = source === "active" ? activeChangePath(id, state) : changePath(id);
    const missing = changeArtifactGaps(state, dir);
    const preflight = [];
    if (missing.length)
      preflight.push(`missing change artifacts: ${missing.join(", ")}`);
    if (!["low", "medium", "high"].includes(state.impact || ""))
      preflight.push(`resolve impact for '${id}'`);
    if (!["isolated", "coupled"].includes(state.coupling || ""))
      preflight.push(`resolve coupling for '${id}'`);
    if (state.acceptance?.decision === "undecided")
      preflight.push(`acceptance decision is unresolved for '${id}'; ask the user whether subjective human acceptance is required, then resolve with --acceptance-required or --acceptance-not-required`);
    if (preflight.length)
      fail(`change validation preflight failed:\n  - ${preflight.join("\n  - ")}`);
    assertNoScaffolds(state, dir);
    const contractDiagnostics = [];
    if (state.decisionMetadataRequired) {
      const design = readFileSync(join(dir, "design.md"), "utf8");
      contractDiagnostics.push(...durableDecisionMetadataIssues(design)
        .map((issue) => `design: ${issue}`));
    }
    const tasks = readFileSync(join(dir, "tasks.md"), "utf8");
    const parsedTasks = taskBlocks(tasks);
    const grounding = groundingValue(id, state, dir, parsedTasks);
    assertNewCapabilitiesAreAdditive(id, dir);
    assertExistingCapabilityOperations(id, dir);
    assertNoDroppedScenarios(id, dir);
    // The OpenSpec strict lint used to surface only inside 'openspec archive',
    // after the code had landed, so a pure wording defect forced a re-prove.
    // Same tool, same mode, earlier. Quiet internal validations skip the
    // subprocess; the explicit gate is the one that must catch it. Rapid
    // changes declare skip_specs and have no deltas to lint.
    if (!options.quiet && state.schema !== "foundation-rapid")
      assertOpenSpecStrictValid(id, dir, fail);

    const taskIds = parsedTasks.map((task) => task.id).filter(Boolean);
    if (parsedTasks.length && taskIds.length !== parsedTasks.length)
      fail("every implementation task requires a stable ID such as T001");
    if (new Set(taskIds).size !== taskIds.length)
      fail("tasks.md contains duplicate task IDs");
    // The gate is about a task that names a lifecycle *command*, so the slash
    // has to start a token. Matching a bare `/land` anywhere also matched the
    // path `runtime/workflow/land-runtime.mjs`, which made every change that
    // declares that file's path in `[paths:]` unvalidatable — the guard blocked
    // work on the very code it guards.
    const lifecycleTasks = taskBlocks(tasks).filter((task) =>
      !task.done && /(?:^|[\s(`"'])\/(?:prove|land)\b/.test(task.text));
    if (lifecycleTasks.length)
      fail("tasks.md contains a lifecycle gate; /prove and /land are commands, not implementation tasks");

    const claims = evidence(id, dir).claims;
    const claimById = new Map(claims.map((claim) => [claim.id, claim]));
    const selectedRepositoryIds = new Set(validationRepositories(id, state, dir)
      .map((repository) => repository.id));
    contractDiagnostics.push(...claimContractIssues(claims, selectedRepositoryIds)
      .map((issue) => `claims: ${issue}`));
    const selected = validationRepositories(id, state, dir);
    contractDiagnostics.push(...taskContractIssues(
      parsedTasks, claims, selectedRepositoryIds, selected.length > 1)
      .map((issue) => `tasks: ${issue}`));
    failValidationLayer(fail, "cross-artifact contract", contractDiagnostics);
    handoffContract(id, {
      state,
      claimIds: new Set(claimById.keys()),
      taskIds: new Set(taskIds)
    });

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
    // Lock only after every validation gate above passes. A malformed task or
    // unresolved acceptance decision must not freeze a grounding ledger that
    // has never represented a valid Change contract.
    if (grounding?.firstLock) {
      state.groundingDigest = grounding.digest;
      state.groundingLockedAt = grounding.lockedAt;
      if (state.groundingReopenPending) {
        state.groundingReopens = [...(state.groundingReopens || []), {
          ...state.groundingReopenPending,
          newDigest: grounding.digest,
          newLockedAt: grounding.lockedAt,
          contractFingerprint: contractFingerprint(id, dir),
          completedAt: now()
        }];
        delete state.groundingReopenPending;
      }
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
      // A warning that names no action is a warning nobody acts on, and this
      // one fires at the last moment the contract is still cheap to change.
      // Say what each outcome actually is now: a wired capability is enforced,
      // an unwired one is carried as an advisory rather than becoming an
      // unsatisfiable gate at Prove — except review, which stops the loop until
      // a reviewer or a foundation.json waiver exists.
      if (missing.length) {
        console.error(`WARNING: declared surface forecasts ${missing.join(", ")} with no provider`);
        console.error(`  wire them now: claude-foundation evidence init ${id} --write`);
        console.error(`  inspect first: claude-foundation evidence doctor ${id}`);
        if (missing.includes("review"))
          console.error("  review needs a configured fresh reviewer at Prove; a one-family project selects codex-sol or claude-opus and commits review.diversity='single-model' while keeping independence required");
        console.error("  anything left unwired is carried as a non-blocking advisory, not a gate");
      }
    }
    // Review is the one gate a change cannot wire its way out of, and the loop
    // used to reveal it at Prove — after the build is spent, and with the
    // waiver that resolves it named nowhere. A forecast only covers what is not
    // yet required; once it *is* required, saying so here is the last cheap
    // moment to find a reviewer or decide the project reviews itself.
    // Guarded for the same reason as `advisoryCapabilities`: `reviewPolicy`
    // reads the changed surface, which a multi-repository change cannot resolve
    // until its sandboxes exist. A hint must never be able to fail validate.
    let assurance = null;
    if (!options.quiet && changedSurfaceResolvable(id, state)) {
      const policy = reviewPolicy(id, state, evidence(id, dir));
      assurance = reviewAssurancePosture(policy);
      if (assurance)
        console.error(`NOTE: review assurance posture: ${assurance.summary}`);
      if (policy.required && !policy.independenceWaived) {
        console.error("NOTE: this change requires review evidence; an independent reviewer must exist by Prove");
        console.error("  one-family project: select codex-sol or claude-opus and set review.diversity='single-model'; the reviewer still uses a distinct identity and fresh session");
      }
    }
    if (!options.quiet)
      console.log(`VALID ${id} (${state.schema}, ${claims.length} claims)\n  next: ${nextAfterValidate(state.status, id)}`);
    return { version: 1, changeId: id, reviewAssurance: assurance };
  }

  function requiredProviders(id) {
    const state = loadRuntime(id);
    const contract = evidence(id);
    const providers = contract.providers || {};
    const waived = new Set((state.waivers || []).map((row) => row.capability));
    const required = new Set();
    const addCapability = (capability, repositories = []) => {
      if (waived.has(capability)) return;
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
        if (capability === "test" && !waived.has("test"))
          addCapability("discovery", claim.repositories || []);
      }
    }
    if (reviewPolicy(id, state, contract).required) addCapability("review");
    if (resolvedAcceptance(id, state, contract).required) addCapability("acceptance");
    for (const capability of policyCapabilitySplit(id, contract).enforced)
      addCapability(capability);
    return [...required].sort();
  }

  // A capability the policy infers from the *realized* diff is a risk hint, not
  // a contract the author signed. It can only appear once the files exist —
  // after Build — and an inferred capability nobody wired defaults to adapter
  // "external" (`evidence-contract`), so the required set grew past the point
  // where the contract could still be negotiated and Prove stopped on a gate
  // that had no way to pass. Enforce an inferred capability only where the
  // project actually wired a provider for it, or where the author declared the
  // same capability on a claim; otherwise carry it as an advisory that is
  // reported and recorded but does not block.
  //
  // `review` is deliberately unaffected: `reviewPolicy` reads the same inferred
  // set and adds review itself, and it owns a documented waiver
  // (`review.independence`, `review.diversity` in foundation.json). Downgrading
  // it here would drop a gate that has a way out rather than one that does not.
  function policyCapabilitySplit(id, contract = evidence(id)) {
    const configured = new Set(Object.entries(contract.providers || {})
      .map(([provider, config]) => providerCapability(provider, config)));
    const declared = new Set(contract.claims.flatMap((claim) => claim.capabilities || []));
    const enforced = [];
    const advisory = [];
    for (const capability of policyCapabilities(id))
      (configured.has(capability) || declared.has(capability) ? enforced : advisory)
        .push(capability);
    return { enforced, advisory };
  }

  // Advisories are the record that the downgrade above happened. Dropping an
  // inferred capability silently would make "the policy saw nothing" and "the
  // policy saw something nobody wired" identical in the evidence, which is
  // exactly the distinction a later reader needs.
  // Advisories are reporting, never a gate, so they must not be able to fail a
  // command. The changed surface is unresolvable in states that are not errors
  // — a multi-repository change before its sandboxes exist cannot answer "what
  // changed" yet — and that path exits the process rather than throwing, so the
  // precondition is checked instead of caught. `requiredProviders` deliberately
  // does not get this treatment: dropping an inferred capability there would
  // under-require evidence, so it must still stop.
  function advisoryCapabilities(id) {
    const waived = (loadRuntime(id).waivers || []).map((row) => ({
      capability: row.capability,
      reason: "user-waived",
      detail: row.reason,
      authority: row.authority,
      recordedAt: row.recordedAt,
      next: `restore it: claude-foundation change waive ${id} --capability ${
        row.capability} --revoke --decision-ref <ref>`
    }));
    if (!changedSurfaceResolvable(id)) return waived;
    return [
      ...policyCapabilitySplit(id).advisory.map((capability) => ({
        capability,
        trigger: policyCapabilityTrigger(id, capability),
        reason: "policy-inferred-unwired",
        next: `configure a project-owned ${capability} provider in openspec/changes/${
          id}/execution.yaml, or accept the advisory`
      })),
      ...waived
    ];
  }

  function waiveGate(id, flags = {}) {
    const capability = String(flags.capability || "").trim();
    const decisionRef = String(flags["decision-ref"] || "").trim();
    const reason = String(flags.reason || "").trim();
    if (!capability) fail("change waive requires --capability <capability>");
    if (!decisionRef)
      fail("change waive requires --decision-ref <host-user-decision>; ask the user to authorize withdrawing this gate before recording it");
    const state = loadRuntime(id);
    if (state.status === "archived") fail(`change '${id}' is already archived`);
    const waivers = state.waivers || [];
    if (flags.revoke) {
      if (!waivers.some((row) => row.capability === capability))
        fail(`capability '${capability}' has no recorded waiver to revoke`);
      state.waivers = waivers.filter((row) => row.capability !== capability);
      saveRuntime(state);
      console.log(`WAIVER REVOKED ${id}/${capability}\n  the capability is required again\n  next: claude-foundation proof run ${id}`);
      return;
    }
    if (!reason) fail("change waive requires --reason <why>");
    if (capability === "review")
      fail("review cannot be waived here; use the configured risk route or record an explicit policy/change decision");
    if (capability === "acceptance")
      fail(`acceptance cannot be waived here; withdraw the requirement instead: claude-foundation change resolve ${id} --acceptance-not-required`);
    if (waivers.some((row) => row.capability === capability))
      fail(`capability '${capability}' is already waived`);
    const required = requiredProviders(id);
    if (!required.includes(capability) && !required.some((provider) =>
      providerCapability(provider, providerConfig(id, provider)) === capability))
      fail(`capability '${capability}' is not required by change '${id}'; nothing to waive`);
    state.waivers = [...waivers, {
      capability,
      reason,
      authority: { kind: "host-user-decision", reference: decisionRef },
      recordedAt: now()
    }];
    saveRuntime(state);
    console.log(`GATE WAIVED ${id}/${capability}\n  reason: ${reason}\n  decision: ${decisionRef}\n  recorded in proof advisories; the claim keeps declaring it\n  next: claude-foundation proof run ${id}`);
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
      // Detection wires what Prove will look for *and* what it downgraded to an
      // advisory: an inferred capability with a safe project-owned script is
      // better wired than waived, and `evidence init --write` is the only thing
      // that can promote it back into the enforced set.
      required: [...new Set([
        ...requiredProviders(id),
        ...advisoryCapabilities(id).map((row) => row.capability)
      ])].sort(),
      providerConfig: (provider) => providerConfig(id, provider),
      providerCapability,
      knownProviders,
      commandExists,
      stableHash,
      declaredSurface: state.declaredSurface || []
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
    advisoryCapabilities,
    assertExistingCapabilityOperations,
    assertNoScaffolds,
    assertNewCapabilitiesAreAdditive,
    assertNoDroppedScenarios,
    changeArtifactGaps,
    changeSpecScenarios,
    droppedScenarioFindings,
    groundingValue,
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
    validate,
    waiveGate
  };
}
