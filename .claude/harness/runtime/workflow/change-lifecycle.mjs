import { agreementIdentity, REVIEW_WINDOW_MS } from "../core/user-decisions.mjs";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync,
  realpathSync, statSync, writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { acquireProcessLock } from "../core/process-lock.mjs";
import { nextCommand } from "../core/next-step.mjs";
import { taskBlocks, taskMetadata } from "../contracts/change-artifacts.mjs";
import { materialSecurityTriggers } from "./security-policy.mjs";
import {
  normalizeSemanticDraft, semanticDraftTemplate
} from "./semantic-draft.mjs";
import {
  semanticIntakeAction, semanticIntakeIssues
} from "./validation/semantic-intake.mjs";
import { inspectSemanticSources } from "./validation/semantic-source-inventory.mjs";
import { inspectRepositoryIntelligence } from "./validation/repository-intelligence.mjs";
import {
  planSemanticIntakeDepth,
  semanticIntakeEffectivenessSnapshot,
  semanticQuestionQualityFindings
} from "./validation/semantic-intake-intelligence.mjs";
import { planAmendmentInvalidation } from "./validation/amendment-invalidation.mjs";
import {
  planSelectiveProofRecovery, rebindSelectiveProofReceipt
} from "./validation/selective-proof-plan.mjs";
import {
  reduceSemanticIntakeState, semanticDraftDigest, semanticIntakeResumeProjection
} from "./semantic-intake-state.mjs";
import {
  compileSemanticAmendment, writeSemanticAmendment
} from "./semantic-amendment.mjs";
import { validateInvestigationBinding } from "./investigation-runtime.mjs";

export function atomicStartPreflight(draft, { groundingRequired = false } = {}) {
  const issues = [];
  if (![1, 2, 3, 4].includes(draft?.version))
    issues.push("start draft requires version 1, 2, 3, or 4");
  if (!String(draft?.intent || "").trim())
    issues.push("start draft requires non-empty 'intent'");
  const acceptance = draft?.acceptance;
  if (!acceptance || typeof acceptance.required !== "boolean")
    issues.push("start draft requires acceptance.required true|false from an explicit user-facing decision");
  else if (acceptance.required && !String(acceptance.reason || "").trim())
    issues.push("start draft requires acceptance.reason when acceptance.required is true");
  else if (!acceptance.required && (String(acceptance.reason || "").trim() ||
      (acceptance.claimIds || []).length))
    issues.push("start draft acceptance.reason and acceptance.claimIds require acceptance.required true");

  const impact = draft?.impact || "low";
  const coupling = draft?.coupling || "isolated";
  const securityTriggers = draft?.securityTriggers || [];
  if (!["low", "medium", "high"].includes(impact))
    issues.push("start draft impact must be low|medium|high");
  if (!["isolated", "coupled"].includes(coupling))
    issues.push("start draft coupling must be isolated|coupled");
  if (!Array.isArray(securityTriggers) ||
      securityTriggers.some((trigger) => typeof trigger !== "string" || !trigger.trim()))
    issues.push("start draft securityTriggers must be an array of non-empty strings");
  if (draft?.externalOperations !== undefined &&
      !Array.isArray(draft.externalOperations))
    issues.push("draft externalOperations must be an array");
  if (!draft?.execution || draft.execution.version !== 1 ||
      !draft.execution.providers || Object.keys(draft.execution.providers).length === 0)
    issues.push("start draft requires executable evidence wiring");

  const safeTriggers = Array.isArray(securityTriggers) ? securityTriggers : [];
  const rapid = impact === "low" && coupling === "isolated" &&
    safeTriggers.filter((trigger) => trigger.toLowerCase() !== "none").length === 0 &&
    !draft?.reviewRequired && !acceptance?.required;
  if (groundingRequired && ![2, 3].includes(draft?.grounding?.version))
    issues.push("start draft requires grounding.version 2 or 3 after the initial Decision Sheet");
  if (!rapid && groundingRequired && draft?.grounding?.version !== 3) {
    const categories = [
      "performance", "capacity", "availability", "securityPrivacy",
      "accessibility", "operability", "compatibility", "recoverability"
    ];
    const missing = categories.filter((category) =>
      !draft?.grounding?.nfrAssessment?.[category]);
    if (missing.length)
      issues.push(`standard start draft requires every grounding.nfrAssessment category before creation: ${missing.join(", ")}`);
  }
  if (!rapid && !Array.isArray(draft?.decisions))
    issues.push("standard start draft requires decisions to be an array; use [] when no durable decision qualifies");
  return { issues, classification: { impact, coupling, securityTriggers: safeTriggers }, rapid };
}

function specRequirementBlocks(specTexts) {
  const blocks = [];
  for (const text of specTexts) {
    let current = null;
    for (const line of String(text || "").split("\n")) {
      if (/^###\s+Requirement:/.test(line)) {
        current = { lines: [line], scenarios: new Set() };
        blocks.push(current);
        continue;
      }
      if (/^##\s/.test(line) || /^###\s/.test(line)) { current = null; continue; }
      if (!current) continue;
      current.lines.push(line);
      const scenario = line.match(/^####\s+Scenario:\s*(.+?)\s*$/);
      if (scenario) current.scenarios.add(scenario[1]);
    }
  }
  return blocks.map((block) => ({
    text: block.lines.join("\n").trim(), scenarios: block.scenarios
  }));
}

/**
 * Fingerprint each semantic requirement of a compiled packet by its claims and
 * the spec block that carries those claims' scenarios. Keys come from
 * `claim.requirementKey`, so legacy claims without one are not tracked.
 */
export function requirementFingerprints({ claims = [], specTexts = [] } = {}) {
  const blocks = specRequirementBlocks(specTexts);
  const byKey = new Map();
  for (const claim of claims) {
    const key = String(claim?.requirementKey || "").trim();
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) || []), claim]);
  }
  const fingerprints = {};
  for (const [key, rows] of byKey) {
    const scenarios = new Set(rows.map((claim) => claim.scenario).filter(Boolean));
    const text = blocks.filter((block) =>
      [...scenarios].some((name) => block.scenarios.has(name))).map((block) => block.text);
    const ordered = [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id)));
    fingerprints[key] = createHash("sha256")
      .update(JSON.stringify({ claims: ordered, text })).digest("hex");
  }
  return fingerprints;
}

/**
 * Fingerprint each semantic requirement from its authored draft row and
 * evidence entry, so outcome-only edits are visible even in spec-less packets.
 */
export function draftRequirementFingerprints(draft) {
  const fingerprints = {};
  for (const row of Array.isArray(draft?.requirements) ? draft.requirements : []) {
    const key = String(row?.key || "").trim();
    if (!key) continue;
    fingerprints[key] = createHash("sha256")
      .update(JSON.stringify({ requirement: row, evidence: draft.evidence?.[key] ?? null }))
      .digest("hex");
  }
  return fingerprints;
}

export function requirementDelta(before = {}, after = {}) {
  const keys = (object) => Object.keys(object).sort();
  return {
    added: keys(after).filter((key) => !(key in before)),
    revised: keys(after).filter((key) => key in before && before[key] !== after[key]),
    removed: keys(before).filter((key) => !(key in after))
  };
}

/**
 * Fold a new revision delta into the unapproved one so a single approval covers
 * every change since the last approved agreement.
 */
export function mergeApprovalDelta(prior, next) {
  const added = new Set(prior?.added || []);
  const revised = new Set(prior?.revised || []);
  const removed = new Set(prior?.removed || []);
  for (const key of next.added || []) {
    if (removed.delete(key)) revised.add(key);
    else added.add(key);
  }
  for (const key of next.revised || [])
    if (!added.has(key)) revised.add(key);
  for (const key of next.removed || []) {
    revised.delete(key);
    if (!added.delete(key)) removed.add(key);
  }
  const sorted = (set) => [...set].sort();
  return { added: sorted(added), revised: sorted(revised), removed: sorted(removed) };
}

export function formatApprovalDelta(delta) {
  const list = (values) => values?.length ? values.join(", ") : "none";
  return `  added: ${list(delta.added)}\n  revised: ${list(delta.revised)}\n` +
    `  removed: ${list(delta.removed)}`;
}

export function priorChangeResidue(root, id) {
  return [
    join(root, ".foundation", "runtime", `${id}.json`),
    join(root, ".foundation", "receipts", id),
    join(root, ".foundation", "evidence", id),
    join(root, ".foundation", "handoffs", id)
  ].filter((path) => existsSync(path));
}

export function materializeChangeTemplates({
  schema,
  source,
  target,
  intent,
  groundingRequired,
  conditional = false,
  includeDesign = true,
  instantiate
}) {
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, ".openspec.yaml"), schema === "foundation-rapid"
    ? `schema: ${schema}\nskip_specs: true\n`
    : `schema: ${schema}\n`);
  const core = conditional
    ? ["proposal.md", "tasks.md", "evidence.yaml"]
    : ["proposal.md", "tasks.md", "evidence.yaml", "execution.yaml",
        "repositories.yaml", "handoffs.yaml"];
  for (const name of core)
    writeFileSync(join(target, name), instantiate(join(source, name), intent));
  if (groundingRequired && !conditional)
    writeFileSync(join(target, "grounding.yaml"),
      instantiate(join(source, "grounding.yaml"), intent));
  if (schema === "foundation-standard") {
    if (includeDesign)
      writeFileSync(join(target, "design.md"), instantiate(join(source, "design.md"), intent));
    if (!conditional) {
      mkdirSync(join(target, "specs", "change"), { recursive: true });
      writeFileSync(join(target, "specs", "change", "spec.md"),
        instantiate(join(source, "spec.md"), intent));
    }
  }
}

export function initialChangeState({
  root,
  id,
  intent,
  schema,
  groundingRequired,
  riskBasedCi,
  gitHead,
  preexistingDirty,
  initialBudget,
  now,
  semanticDraftVersion = null,
  groundingVersion = null,
  externalOperationsVersion = 1,
  designRequired = true
}) {
  const standard = schema === "foundation-standard";
  return {
    version: 2, id, intent, schema, status: "change", ambiguity: "clear",
    groundingRequired,
    groundingVersion: groundingRequired ? (groundingVersion || 2) : null,
    semanticDraftVersion,
    artifactDefaultsVersion: [3, 4].includes(semanticDraftVersion) ? 2 : null,
    nfrAssessmentRequired: standard && groundingRequired && groundingVersion !== 3,
    decisionMetadataRequired: standard && designRequired,
    semanticInvariantsRequired: standard,
    riskBasedCiRequired: standard && riskBasedCi,
    externalOperationsVersion,
    graphExecutionVersion: 1,
    // Standard changes must pass through the explicit decision boundary before
    // validation. Keep the marker opt-in so runtime files created before this
    // field existed remain valid and rapid changes keep their short lane.
    resolutionRequired: standard,
    resolvedAt: null,
    revision: 0, contractRevision: 0, executionRevision: 0,
    impact: standard ? null : "low",
    coupling: standard ? null : "isolated",
    securityTriggers: [], reviewRequired: false, evidenceCapabilities: [],
    acceptance: {
      version: 2,
      decision: standard ? "undecided" : "not-required",
      required: false, reason: null, claimIds: [], declaredAt: null
    },
    reviewHistory: { version: 1, aiAttempts: 0, totalAttempts: 0, chainHead: null },
    workspace: {
      mode: "current", path: root, baseHead: gitHead(root),
      preexisting: preexistingDirty(root)
    },
    budget: initialBudget(schema, id),
    createdAt: now(), updatedAt: now()
  };
}

export function renderDraftDecisions(decisions) {
  if (!Array.isArray(decisions))
    throw new Error("standard start draft requires decisions to be an array; use [] when no durable decision qualifies");
  if (!decisions.length) return "`none`";
  return decisions.map((decision, index) => {
    const decisionId = decision.id || `DEC-${String(index + 1).padStart(3, "0")}`;
    return `- **Decision ID:** ${decisionId}\n` +
      `  - **Status:** ${decision.status || "accepted"}\n` +
      `  - **Decision:** ${decision.choice}\n  - **Why:** ${decision.why || decision.reason}\n` +
      `  - **Rejected:** ${Array.isArray(decision.rejected)
        ? decision.rejected.join(", ") : decision.rejected || "none"}\n` +
      `  - **Consequences:** ${decision.consequences || "No consequence beyond the bounded change"}\n` +
      `  - **Supersedes:** ${decision.supersedes || "none"}\n` +
      `  - **Superseded by:** ${decision.supersededBy || "none"}`;
  }).join("\n");
}

export function draftBullets(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

function tableCell(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replaceAll("|", "\\|");
}

export function renderDraftProposal(draft, state) {
  const title = draft.title || state.intent;
  const discovery = draft.discovery?.coverage?.length
    ? `\n\n## Requirement discovery coverage\n\n` +
      `| Dimension | Status | Requirements | Sources | Rationale |\n` +
      `|---|---|---|---|---|\n` +
      draft.discovery.coverage.map((row) =>
        `| ${tableCell(row.dimension)} | ${tableCell(row.status)} | ` +
        `${tableCell((row.covers || []).join(", ") || "none")} | ` +
        `${tableCell((row.sources || []).join(", ") || "none")} | ` +
        `${tableCell(row.rationale || "none")} |`
      ).join("\n")
    : "";
  const investigation = draft.investigation
    ? `\n\n## Investigation handoff\n\n` +
      `- **ID:** ${tableCell(draft.investigation.id)}\n` +
      `- **Outcome:** ${tableCell(draft.investigation.outcome)}\n` +
      `- **Summary:** ${tableCell(draft.investigation.summary)}\n` +
      `- **Change intent:** ${tableCell(draft.investigation.changeIntent)}\n` +
      `- **State:** ${tableCell(draft.investigation.statePath)} @ ` +
      `${tableCell(draft.investigation.stateDigest)}\n` +
      `- **Sources:** ${tableCell(draft.investigation.sourceDigest)}`
    : "";
  return `# Change: ${title}\n\n## Why\n\n${draft.why}\n\n` +
    `## What changes\n\n${draftBullets(draft.changes)}\n\n## Impact\n\n` +
    `- **Impact:** ${draft.impact || state.impact || "medium"}\n` +
    `- **Coupling:** ${draft.coupling || state.coupling || "coupled"}\n` +
    `- **Affected surfaces:** ${(draft.surfaces || ["code"]).join(", ")}\n` +
    `- **Security triggers:** ${(draft.securityTriggers || ["none"]).join(", ")}\n\n` +
    `## Non-goals\n\n${draftBullets(draft.nonGoals)}${investigation}${discovery}\n`;
}

export function synchronizeProposalClassification(proposal, state) {
  let next = String(proposal || "");
  for (const [label, value] of [
    ["Impact", state.impact], ["Coupling", state.coupling]
  ]) {
    if (!value) continue;
    const pattern = new RegExp(
      `^(\\s*-\\s*\\*\\*${label}:\\*\\*\\s*).*$`, "im");
    if (pattern.test(next)) next = next.replace(pattern, `$1${value}`);
  }
  return next;
}

export function draftDomainRows(domainLanguage = []) {
  return domainLanguage.length
    ? domainLanguage.map((term) =>
      `| ${term.term} | ${term.meaning} | ${term.avoid} |`).join("\n")
    : "| `none` | This change introduces no project-specific term. | `none` |";
}

export function renderDraftDesign(draft) {
  const risks = draft.risks.length
    ? draft.risks.map((risk) =>
      `| ${risk.risk} | ${risk.mitigation} | ${risk.owner} |`).join("\n")
    : "| none | none | none |";
  const diagrams = (draft.diagrams || []).map((diagram) => {
    const title = diagram.title || diagram.key;
    if (diagram.type === "mermaid" && diagram.source)
      return `### ${title}\n\n${diagram.purpose || ""}\n\n\`\`\`mermaid\n${diagram.source}\n\`\`\``;
    const target = diagram.path || diagram.source;
    return `### ${title}\n\n${diagram.purpose || ""}\n\n[Diagram source](${target})`;
  });
  const prototype = draft.prototypeSelection
    ? `\n\n## Prototype selection\n\n- **Selected:** ${draft.prototypeSelection.selected}\n` +
      `- **Reference:** ${draft.prototypeSelection.reference}\n` +
      `- **Reason:** ${draft.prototypeSelection.reason || "Recorded in the selection reference"}`
    : "";
  const integrations = (draft.integrations || []).map((integration) =>
    `| ${integration.key} | ${integration.kind} | ${integration.documentation?.source} | ` +
    `${integration.documentation?.version} | ${(integration.concerns || []).join(", ") || "none"} |`
  );
  return `# Design\n\n## Current state\n\n${draft.currentState}\n\n` +
    `## Domain language\n\n| Canonical term | Meaning | Avoid |\n|---|---|---|\n` +
    `${draftDomainRows(draft.domainLanguage)}\n\n## Decisions\n\n` +
    renderDraftDecisions(draft.decisions) +
    `\n\n## Compatibility and migration\n\n${draft.compatibility}\n\n## Risks\n\n` +
    `| Risk | Mitigation | Evidence owner |\n|---|---|---|\n` +
    risks + (diagrams.length ? `\n\n## Diagrams\n\n${diagrams.join("\n\n")}` : "") +
    (integrations.length
      ? `\n\n## Integrations\n\n| Integration | Kind | Documentation | Version | Concerns |\n` +
        `|---|---|---|---|---|\n${integrations.join("\n")}` : "") + prototype + "\n";
}

export function draftNeedsDesign(draft) {
  return Boolean(
    draft.design || draft.prototypeSelection || (draft.diagrams || []).length ||
    (draft.integrations || []).length || (draft.decisions || []).length ||
    (draft.risks || []).length ||
    (draft.compatibility && String(draft.compatibility).toLowerCase() !== "none") ||
    (draft.specs || []).some((spec) =>
      String(spec.operation || "added").toLowerCase() === "removed")
  );
}

export function renderDraftTask(task, index) {
  const taskId = task.id || `T${String(index + 1).padStart(3, "0")}`;
  const metadata = [
    task.semanticKey ? `[key:${task.semanticKey}]` : "",
    task.repository ? `[repo:${task.repository}]` : "",
    task.kind ? `[kind:${task.kind}]` : "",
    task.requestedModel || task.model
      ? `[model:${task.requestedModel || task.model}]` : "",
    task.paths?.length ? `[paths:${task.paths.join(",")}]` : "",
    task.dependsOn?.length ? `[depends:${task.dependsOn.join(",")}]` : "",
    task.resources?.length ? `[resources:${task.resources.join(",")}]` : "",
    task.claims?.length ? `[claims:${task.claims.join(",")}]` : "",
    task.inputSchema ? `[input-schema:${task.inputSchema}]` : "",
    task.outputSchema ? `[output-schema:${task.outputSchema}]` : ""
  ].filter(Boolean).join(" ");
  return `- [ ] **${taskId}** ${task.outcome} ${metadata} — verify: \`${task.verify}\``;
}

export function renderDraftTasks(tasks) {
  return `# Tasks\n\n> This is the sole implementation ledger.\n\n` +
    tasks.map(renderDraftTask).join("\n") + "\n";
}

export function groupDraftSpecs(specs, slugify) {
  const grouped = new Map();
  for (const spec of specs) {
    const capability = slugify(spec.name);
    grouped.set(capability, [...(grouped.get(capability) || []), spec]);
  }
  return grouped;
}

export function renderDraftSpecDocument(specs, renderRequirement) {
  const operationOrder = ["added", "modified", "removed"];
  const sections = operationOrder.flatMap((operation) => {
    const requirements = specs.filter((spec) =>
      String(spec.operation || "added").toLowerCase() === operation);
    if (!requirements.length) return [];
    return [`## ${operation.toUpperCase()} Requirements\n\n` +
      requirements.map(renderRequirement).join("\n\n")];
  });
  return `# ${specs[0].name}\n\n${sections.join("\n\n")}\n`;
}

export function materializeDraftSpecs({
  basePath, specs, slugify, renderRequirement,
  remove = rmSync, makeDirectory = mkdirSync, write = writeFileSync
}) {
  remove(join(basePath, "specs"), { recursive: true, force: true });
  for (const [capability, capabilitySpecs] of groupDraftSpecs(specs, slugify)) {
    const specDir = join(basePath, "specs", capability);
    makeDirectory(specDir, { recursive: true });
    write(join(specDir, "spec.md"),
      renderDraftSpecDocument(capabilitySpecs, renderRequirement));
  }
}

export function deriveDraftBookkeeping(input, slugify) {
  const draft = structuredClone(input);
  const claims = (draft.claims || []).map((claim, index) => ({
    ...claim,
    id: claim.id || slugify(claim.scenario || `claim-${index + 1}`)
  }));
  const claimIds = claims.map((claim) => claim.id);
  draft.claims = claims;
  draft.tasks = (draft.tasks || []).map((task, index) => ({
    ...task,
    id: task.id || `T${String(index + 1).padStart(3, "0")}`,
    ...(!task.claims?.length && draft.tasks.length === 1 && claimIds.length
      ? { claims: claimIds } : {})
  }));
  if (draft.acceptance?.required && !draft.acceptance.claimIds?.length &&
      claimIds.length === 1)
    draft.acceptance.claimIds = claimIds;
  const providers = draft.execution?.providers || {};
  if (draft.tasks.length === 1 && draft.tasks[0].verify) {
    for (const provider of Object.values(providers))
      if (["test-discovery", "command"].includes(provider.adapter) && !provider.command)
        provider.command = ["sh", "-c", draft.tasks[0].verify];
  }
  if (draft.grounding?.claims?.length === claims.length)
    draft.grounding.claims = draft.grounding.claims.map((claim, index) => ({
      ...claim,
      id: claim.id || claims[index].id
    }));
  if (draft.grounding?.criticalCases) {
    draft.grounding.criticalCases = draft.grounding.criticalCases.map((row, index) => ({
      ...row,
      id: row.id || `CC-${String(index + 1).padStart(3, "0")}`,
      ...(!row.claimIds?.length && claimIds.length === 1
        ? { claimIds: claimIds } : {})
    }));
    const caseIds = draft.grounding.criticalCases.map((row) => row.id);
    for (const provider of Object.values(draft.execution?.providers || {}))
      if (["test-discovery", "playwright"].includes(provider.adapter) &&
          !provider.criticalCases?.length)
        provider.criticalCases = caseIds;
  }
  return draft;
}

export function createChangeLifecycle({
  root,
  policy,
  securityTerms,
  fail,
  pathInside,
  readJson,
  writeJson,
  slugify,
  changePath,
  activeChangePath = changePath,
  loadRuntime,
  saveRuntime,
  setOperationChangeId,
  initialBudget,
  git = null,
  gitHead,
  preexistingDirty,
  now,
  bindClaudeSession,
  validate,
  showPacket,
  measureStage,
  receiptPath = null,
  receiptValidity = null,
  contractFingerprint = null,
  requiredProviders = null,
  providerConfig = null,
  claimsForProvider = null,
  providerWorkspaceHash = null,
  providerInputIdentity = null,
  relevantHash = null,
  stableHash = null,
  trapFailures = (operation) => operation(),
  rollbackStart = () => []
}) {
  const workflowPolicy = () => typeof policy === "function" ? policy() : policy;

  function amendmentRevision(state) {
    return JSON.stringify({
      revision: Number(state.revision || 0),
      contractRevision: Number(state.contractRevision || 0),
      executionRevision: Number(state.executionRevision || 0)
    });
  }

  function assertAmendmentRevision(id, expected, label = "change amendment") {
    if (amendmentRevision(loadRuntime(id)) !== expected)
      fail(`${label} for '${id}' conflicted with a newer change revision; ` +
        "reload the active agreement and retry");
  }

  // Amend and revise share one per-change lock so neither can replace the
  // packet or runtime state while the other is mid-transaction.
  function withAmendmentLock(id, observedRevision, operation, label = "change amendment") {
    const lock = acquireProcessLock(
      join(root, ".foundation", "locks", `amend-${id}.lock`), { now });
    if (!lock.acquired)
      fail(`${label} for '${id}' is already in progress; ` +
        "reload the active agreement and retry");
    try {
      assertAmendmentRevision(id, observedRevision, label);
      return operation();
    } finally {
      lock.release();
    }
  }

  function selectiveBinding(id, provider, contractRevision, receipt = null) {
    if (!receiptValidity || !providerConfig || !claimsForProvider || !providerWorkspaceHash ||
        !providerInputIdentity || !relevantHash || !stableHash) return null;
    const config = providerConfig(id, provider);
    const claims = claimsForProvider(id, provider).map((claim) => claim.id).sort();
    const workspaceHash = providerWorkspaceHash(id, provider, relevantHash(id));
    const inputs = providerInputIdentity(id, provider, config, workspaceHash);
    return {
      provider,
      status: receipt?.status || "pass",
      validity: receipt ? receiptValidity(id, provider, workspaceHash).validity : "valid",
      binding: {
        contractRevision,
        providerFingerprint: stableHash({ config, claims }),
        claimsFingerprint: stableHash(claims),
        inputIdentity: inputs
      }
    };
  }
  function templateDir(schema) {
    return join(root, "openspec", "schemas", schema, "templates");
  }

  function instantiate(path, title) {
    return readFileSync(path, "utf8")
      .replaceAll("<title>", title)
      .replaceAll("replace-with-stable-claim-id", `${slugify(title)}-outcome`);
  }

  function assertChangeAvailable(id) {
    if (existsSync(changePath(id))) fail(`change already exists: ${id}`);
    const residue = priorChangeResidue(root, id);
    if (residue.length)
      fail(`change id '${id}' was used before and its recorded history remains ` +
        `(${residue.map((path) => path.slice(root.length + 1)).join(", ")}); pick a new id`);
  }

  function draftSource(draftPath) {
    const source = resolve(root, draftPath);
    if (!pathInside(root, source) || !existsSync(source))
      fail("new --draft requires a JSON file inside the project");
    return readJson(source);
  }

  function semanticSourcePaths(source) {
    return [...new Set((source.discovery?.coverage || [])
      .flatMap((row) => Array.isArray(row?.sources) ? row.sources : [])
      .map((path) => String(path || "").trim()).filter(Boolean))];
  }

  function semanticIntakeStatePath(sourcePath, scope = "draft") {
    const source = relative(root, resolve(root, sourcePath)).replaceAll("\\", "/");
    // Preserve the v1/v2 draft-state filename while namespacing amendment
    // snapshots so one file can be inspected against different active changes.
    const identity = scope === "draft" ? source : `${scope}\0${source}`;
    const key = createHash("sha256").update(identity).digest("hex").slice(0, 24);
    return join(root, ".foundation", "intake", `${key}.json`);
  }

  function semanticSourceInspection(source, baseline = null, discoveredPaths = []) {
    return inspectSemanticSources({
      projectRoot: root,
      sourcePaths: [...new Set([...semanticSourcePaths(source), ...discoveredPaths])],
      baseline
    });
  }

  function repositoryGitPaths() {
    if (typeof git !== "function") return { includedPaths: null, trackedPaths: [] };
    const tracked = git(["ls-files", "-z"], root);
    const included = git([
      "ls-files", "-z", "--cached", "--others", "--exclude-standard"
    ], root);
    if (tracked.status !== 0 || included.status !== 0)
      return { includedPaths: null, trackedPaths: [] };
    return {
      trackedPaths: tracked.stdout.split("\0").filter(Boolean),
      includedPaths: included.stdout.split("\0").filter(Boolean)
    };
  }

  function repositoryIntelligence(source, excludedPaths = []) {
    const query = [source.intent, source.why, ...(source.changes || []),
      ...(source.requirements || []).flatMap((row) => [
        row?.key, row?.requirement, row?.description, row?.outcome
      ])];
    const repositoryPaths = repositoryGitPaths();
    const excluded = new Set(excludedPaths.map((path) =>
      String(path || "").replaceAll("\\", "/")));
    const repository = inspectRepositoryIntelligence({
      projectRoot: root,
      query,
      seedPaths: semanticSourcePaths(source),
      trackedPaths: repositoryPaths.trackedPaths,
      excludedPaths: [...excluded],
      includedPaths: repositoryPaths.includedPaths === null ? null
        : repositoryPaths.includedPaths.filter((path) => !excluded.has(path)),
      limits: { maxReadSet: 48 }
    });
    const graph = repository.graph || {};
    const surfaces = graph.surfaces || {};
    const depth = planSemanticIntakeDepth(source, { repository: {
      candidateFileCount: repository.candidates?.length || 0,
      integrationCount: surfaces.integrations?.length || 0,
      dependentCount: graph.callers?.length || 0,
      persistenceBoundaryCount: surfaces.persistence?.length || 0,
      permissionBoundaryCount: surfaces.permissions?.length || 0
    } });
    let selectedBytes = 0;
    const selected = [];
    for (const row of repository.readSet || []) {
      if (selected.length >= depth.limits.maxSourceFiles) break;
      if (selectedBytes + row.bytes > depth.limits.maxSourceBytes) continue;
      selected.push(row.path);
      selectedBytes += row.bytes;
    }
    return { repository, depth, selected, selectedBytes };
  }

  function validateDraftFields(draft) {
    const requiredStrings = ["why", "currentState", "compatibility"];
    for (const field of requiredStrings)
      if (!String(draft[field] || "").trim())
        fail(`draft requires non-empty '${field}'`);
    const requiredArrays = [3, 4].includes(draft._semanticVersion)
      ? ["changes", "tasks", "claims", "specs"]
      : ["changes", "nonGoals", "decisions", "risks", "tasks", "claims", "specs"];
    for (const field of requiredArrays)
      if (!Array.isArray(draft[field]) || draft[field].length === 0)
        fail(`draft requires a non-empty '${field}' array`);
  }

  function validateDraftDomainLanguage(draft) {
    if (draft.domainLanguage !== undefined) {
      if (!Array.isArray(draft.domainLanguage))
        fail("draft domainLanguage must be an array");
      for (const [index, term] of draft.domainLanguage.entries())
        for (const field of ["term", "meaning", "avoid"])
          if (!String(term?.[field] || "").trim())
            fail(`draft domainLanguage[${index}].${field} is required`);
    }
  }

  function validateDraftPolicy(draft) {
    if (workflowPolicy().workflow.grounding === "required" &&
        ![2, 3].includes(draft.grounding?.version))
      fail("draft requires grounding.version 2 or 3 from the single Decision Sheet");
    if (draft.externalOperations !== undefined && !Array.isArray(draft.externalOperations))
      fail("draft externalOperations must be an array");
  }

  function validateDraftSpec(spec, index, warnedLegacyOperation) {
    const label = `draft specs[${index}]`;
    for (const field of ["name", "requirement", "description"])
      if (!String(spec?.[field] || "").trim()) fail(`${label}.${field} is required`);
    const operation = String(spec.operation || "added").toLowerCase();
    let warned = warnedLegacyOperation;
    if (!spec.operation && !warned) {
      console.error("WARNING: legacy draft specs without operation are treated as added; declare added|modified|removed after comparing the canonical spec");
      warned = true;
    }
    if (!["added", "modified", "removed"].includes(operation))
      fail(`${label}.operation must be added|modified|removed`);
    const scenarios = normalizedDraftScenarios(spec);
    if (operation !== "removed" && scenarios.length === 0)
      fail(`${label}.scenarios must be non-empty for ${operation}`);
    for (const [scenarioIndex, scenario] of scenarios.entries())
      for (const field of ["name", "when", "then"])
        if (!String(scenario?.[field] || "").trim())
          fail(`${label}.scenarios[${scenarioIndex}].${field} is required`);
    if (operation === "removed" && !String(spec.migration || "").trim())
      fail(`${label}.migration is required for removed requirements`);
    return warned;
  }

  function validateDraftSpecs(draft) {
    let warnedLegacyOperation = false;
    for (const [index, spec] of draft.specs.entries()) {
      warnedLegacyOperation = validateDraftSpec(spec, index, warnedLegacyOperation);
    }
  }

  function loadDraft(draftPath, { deferPolicy = false, preparedSource = null } = {}) {
    const source = preparedSource || draftSource(draftPath);
    // Version 1 is a compatibility contract: callers that supplied every
    // ledger key receive the exact same object back. Version 2 delegates the
    // mechanical IDs and unambiguous cross-ledger bindings to the harness.
    let draft = source;
    if (source.version === 2) draft = deriveDraftBookkeeping(source, slugify);
    if ([3, 4].includes(source.version)) {
      const normalized = normalizeSemanticDraft(source, slugify, {
        loadCanonicalSpec: (capability) => {
          const path = join(root, "openspec", "specs", slugify(capability), "spec.md");
          return existsSync(path) ? readFileSync(path, "utf8") : null;
        }
      });
      if (normalized.issues.length)
        fail(`semantic draft validation failed:\n  - ${normalized.issues.join("\n  - ")}`);
      draft = normalized.draft;
      validateSemanticReferences(draft);
    }
    validateDraftFields(draft);
    validateDraftDomainLanguage(draft);
    if (!deferPolicy) validateDraftPolicy(draft);
    validateDraftSpecs(draft);
    return draft;
  }

  function semanticReferenceIssues(draft) {
    const issues = [];
    const validateLocalFile = (field, value) => {
      const path = resolve(root, value);
      try {
        const project = realpathSync(root);
        const canonical = realpathSync(path);
        if (!pathInside(project, canonical) || !statSync(canonical).isFile())
          throw new Error("not a contained regular file");
      } catch {
        issues.push(`semantic draft ${field} must reference an existing regular file inside the project`);
      }
    };
    const referencedPaths = [];
    if (draft.prototypeSelection?.reference)
      referencedPaths.push(["prototypeSelection.reference", draft.prototypeSelection.reference]);
    for (const [index, row] of (draft.discovery?.coverage || []).entries())
      for (const [sourceIndex, source] of (row.sources || []).entries())
        referencedPaths.push([
          `discovery.coverage[${index}].sources[${sourceIndex}]`, source
        ]);
    for (const [index, diagram] of (draft.diagrams || []).entries()) {
      if (!["mermaid", "svg", "png"].includes(diagram?.type))
        issues.push(`semantic draft diagrams[${index}].type must be mermaid|svg|png`);
      if (!String(diagram?.key || "").trim())
        issues.push(`semantic draft diagrams[${index}].key is required`);
      if (!String(diagram?.purpose || "").trim())
        issues.push(`semantic draft diagrams[${index}].purpose is required`);
      if (diagram.type === "mermaid" && !String(diagram.source || "").trim())
        issues.push(`semantic draft diagrams[${index}].source is required`);
      if (diagram.type !== "mermaid") {
        const path = diagram.path || diagram.source;
        if (!String(path || "").trim())
          issues.push(`semantic draft diagrams[${index}].path is required`);
        else referencedPaths.push([`diagrams[${index}].path`, path]);
      }
    }
    for (const [field, value] of referencedPaths) validateLocalFile(field, value);
    for (const [index, integration] of (draft.integrations || []).entries()) {
      const source = String(integration?.documentation?.source || "").trim();
      if (!source) continue;
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
        let url;
        try { url = new URL(source); }
        catch {
          issues.push(`semantic draft integrations[${index}].documentation.source must be a valid HTTPS URL`);
          continue;
        }
        if (url.protocol !== "https:")
          issues.push(`semantic draft integrations[${index}].documentation.source must use HTTPS`);
        const version = String(integration?.documentation?.version || "").trim();
        if (/^(?:latest|current|main|master|head)$/i.test(version))
          issues.push(`semantic draft integrations[${index}].documentation.version must identify a fixed version`);
        continue;
      }
      validateLocalFile(`integrations[${index}].documentation.source`, source);
    }
    return issues;
  }

  function validateSemanticReferences(draft) {
    const issues = semanticReferenceIssues(draft);
    if (issues.length) fail(issues.join("\n  - "));
  }

  function normalizedDraftScenarios(spec) {
    if (Array.isArray(spec.scenarios)) return spec.scenarios;
    return (spec.scenario || spec.when || spec.then)
      ? [{ name: spec.scenario, when: spec.when, then: spec.then }]
      : [];
  }

  function renderDraftRequirement(spec) {
    const scenarios = normalizedDraftScenarios(spec).map((scenario) =>
      `#### Scenario: ${scenario.name}\n\n- **WHEN** ${scenario.when}\n` +
      `- **THEN** ${scenario.then}`
    ).join("\n\n");
    const migration = String(spec.operation || "added").toLowerCase() === "removed"
      ? `\n\n**Migration:** ${spec.migration}`
      : "";
    return `### Requirement: ${spec.requirement}\n\n${spec.description}${migration}` +
      (scenarios ? `\n\n${scenarios}` : "");
  }

  function materializeDraft(id, draft) {
    const state = loadRuntime(id);
    const basePath = changePath(id);
    writeFileSync(join(basePath, "proposal.md"), renderDraftProposal(draft, state));
    if (state.schema === "foundation-standard" &&
        (![3, 4].includes(draft._semanticVersion) || draftNeedsDesign(draft)))
      writeFileSync(join(basePath, "design.md"), renderDraftDesign(draft));
    if (state.groundingRequired && draft.grounding)
      writeJson(join(basePath, "grounding.yaml"), draft.grounding);
    writeFileSync(join(basePath, "tasks.md"), renderDraftTasks(draft.tasks));
    const contract = readJson(join(basePath, "evidence.yaml"));
    contract.claims = draft.claims;
    if ([3, 4].includes(draft._semanticVersion) && draft._derivedExecution)
      contract.providers = draft.execution.providers;
    writeJson(join(basePath, "evidence.yaml"), contract);
    if (draft.execution && !([3, 4].includes(draft._semanticVersion) && draft._derivedExecution))
      writeJson(join(basePath, "execution.yaml"), draft.execution);
    if (![3, 4].includes(draft._semanticVersion) || draft.externalOperations?.length)
      writeJson(join(basePath, "handoffs.yaml"), {
        version: 1,
        operations: draft.externalOperations || []
      });
    if (draft.repositories?.length) writeJson(join(basePath, "repositories.yaml"), {
      version: 1,
      repositories: draft.repositories
    });
    if (state.schema === "foundation-standard")
      materializeDraftSpecs({
        basePath, specs: draft.specs, slugify,
        renderRequirement: renderDraftRequirement
      });
  }

  // The artifacts the standard schema adds over the rapid one. Written only
  // when absent, so an upgrade never overwrites work already done.
  function materializeStandardArtifacts(id, intent) {
    const source = templateDir("foundation-standard");
    const target = changePath(id);
    const design = join(target, "design.md");
    if (!existsSync(design))
      writeFileSync(design, instantiate(join(source, "design.md"), intent));
    const grounding = join(target, "grounding.yaml");
    if (workflowPolicy().workflow.grounding === "required" && !existsSync(grounding))
      writeFileSync(grounding, instantiate(join(source, "grounding.yaml"), intent));
    const spec = join(target, "specs", "change", "spec.md");
    if (!existsSync(spec)) {
      mkdirSync(join(target, "specs", "change"), { recursive: true });
      writeFileSync(spec, instantiate(join(source, "spec.md"), intent));
    }
    // The rapid marker declared skip_specs; keeping it beside the specs/ this
    // upgrade just materialized makes the packet self-contradictory and fails
    // OpenSpec strict validation.
    writeFileSync(join(target, ".openspec.yaml"), "schema: foundation-standard\n");
  }

  function createChange(intent, flags, preparedDraft = undefined, options = {}) {
    const id = slugify(flags.id || intent);
    setOperationChangeId(id);
    // An archived change keeps its runtime state, receipts, and evidence vault
    // as history. A new change reusing the id would inherit them — review
    // rounds it never ran, receipts bound to another workspace — so the id is
    // refused rather than quietly adopted. Atomic start checks once before its
    // rollback boundary so cleanup can never delete a pre-existing change.
    if (!options.availabilityChecked) assertChangeAvailable(id);
    const draft = preparedDraft !== undefined
      ? preparedDraft
      : flags.draft ? loadDraft(flags.draft) : null;
    if (preparedDraft === undefined && flags.draft && draft?._semanticVersion === 4)
      fail("semantic draft v4 must use 'change start <draft.json>' so repository intake is enforced");
    const schema = flags.rapid ? "foundation-rapid" : "foundation-standard";
    const source = templateDir(schema);
    const target = changePath(id);
    const groundingRequired = workflowPolicy().workflow.grounding === "required" ||
      Boolean(draft?.grounding);
    const semantic = [3, 4].includes(draft?._semanticVersion);
    // The rapid schema declares no spec artifact, so a rapid change never has
    // deltas to find. OpenSpec reads that absence as an error — every rapid
    // change was invalid to `openspec validate`, and Land printed five lines of
    // raw validator text at the user for a lane whose whole point is small work.
    // `skip_specs` is the flag OpenSpec's own message names for exactly this.
    materializeChangeTemplates({
      schema, source, target, intent, groundingRequired,
      conditional: semantic,
      includeDesign: !semantic || draftNeedsDesign(draft),
      instantiate
    });
    const state = initialChangeState({
      root, id, intent, schema, groundingRequired,
      riskBasedCi: workflowPolicy().land?.riskBasedCi === true,
      gitHead, preexistingDirty, initialBudget, now,
      semanticDraftVersion: semantic ? draft._semanticVersion : null,
      groundingVersion: draft?.grounding?.version || null,
      externalOperationsVersion: semantic
        ? (draft.externalOperations?.length ? 1 : null) : 1,
      designRequired: !semantic || draftNeedsDesign(draft)
    });
    saveRuntime(state);
    if (draft) materializeDraft(id, draft);
    if (!options.deferSessionBinding) bindClaudeSession(id, "change");
    const next = schema === "foundation-standard"
      ? `resolve decisions with change resolve ${id} before authoring or validation`
      : `complete artifacts, validate, then /build ${id}`;
    console.log(`CREATED ${id}\n  schema: ${schema}\n  next: ${next}`);
    return id;
  }

  function rapidStartTemplate() {
    return semanticDraftTemplate();
  }

  function inspectSemanticIntakeSource(source, {
    statePath, resume, quiet = false, validateCompiledDraft = true,
    excludedSourcePath = null
  }) {
    let previous = null;
    if (existsSync(statePath)) {
      try { previous = JSON.parse(readFileSync(statePath, "utf8")); }
      catch { previous = null; }
    }
    const sameDraft = previous?.draftDigest === semanticDraftDigest(source);
    const intelligence = repositoryIntelligence(source,
      excludedSourcePath ? [excludedSourcePath] : []);
    const sourceInspection = intelligence.repository.status === "ready"
      ? semanticSourceInspection(
        source, sameDraft ? previous?.sourceInventory : null, intelligence.selected)
      : inspectSemanticSources({ projectRoot: root, sourcePaths: [] });
    const intakeIssues = semanticIntakeIssues(source);
    const normalized = validateCompiledDraft
      ? normalizeSemanticDraft(source, slugify, {
        loadCanonicalSpec: (capability) => {
          const path = join(root, "openspec", "specs", slugify(capability), "spec.md");
          return existsSync(path) ? readFileSync(path, "utf8") : null;
        }
      })
      : { issues: [], draft: source };
    const additionalIssues = [
      ...normalized.issues.filter((issue) => !intakeIssues.includes(issue)),
      ...semanticReferenceIssues(normalized.draft),
      ...(source.version === 4 && source.investigation !== undefined
        ? validateInvestigationBinding({ projectRoot: root, binding: source.investigation, git })
          .map((issue) => `investigation ${issue}`)
        : []),
      ...semanticQuestionQualityFindings(source, {
        sourceFacts: source.discovery?.sourceFacts || [],
        sourceInventory: sourceInspection.inventory
      }).map((finding) => `semantic decision ${finding.code}: ${finding.key || finding.path}`),
      ...(intelligence.repository.status === "blocked"
        ? intelligence.repository.findings.map((finding) =>
          `repository discovery ${finding.code}: ${finding.path || "(root)"}`)
        : []),
      ...sourceInspection.findings.map((finding) =>
        `semantic source ${finding.code}: ${finding.path || "(unknown)"}`)
    ];
    const acknowledgedDigest = String(source.discovery?.sourceDigest || "").trim();
    const acknowledgementFindings = acknowledgedDigest === sourceInspection.inventory.digest
      ? [] : [{
        code: "source-acknowledgement-required",
        path: "discovery.sourceDigest",
        detail: {
          expected: sourceInspection.inventory.digest,
          actual: acknowledgedDigest || null
        }
      }];
    const action = semanticIntakeAction(source, {
      resume, additionalIssues,
      sourceFreshnessFindings: [
        ...sourceInspection.staleFindings, ...acknowledgementFindings
      ],
      frontierLimit: intelligence.depth.limits.frontierLimit
    });
    const retainedInventory = sameDraft && sourceInspection.staleFindings.length
      ? previous.sourceInventory : sourceInspection.inventory;
    const effectiveness = semanticIntakeEffectivenessSnapshot(source, {
      repository: {
        candidateFileCount: intelligence.repository.candidates?.length || 0,
        integrationCount: intelligence.repository.graph?.surfaces?.integrations?.length || 0,
        dependentCount: intelligence.repository.graph?.callers?.length || 0,
        persistenceBoundaryCount:
          intelligence.repository.graph?.surfaces?.persistence?.length || 0,
        permissionBoundaryCount:
          intelligence.repository.graph?.surfaces?.permissions?.length || 0
      },
      sourceFacts: source.discovery?.sourceFacts || [],
      sourceInventory: sourceInspection.inventory,
      history: previous?.effectiveness?.history
    });
    const state = reduceSemanticIntakeState(previous, {
      draft: source, action, resumeRoute: resume, sourceInventory: retainedInventory,
      effectiveness
    });
    writeJson(statePath, state);
    const result = {
      ...action,
      intakeState: {
        path: relative(root, statePath),
        revision: state.revision,
        draftDigest: state.draftDigest,
        sourceDigest: state.sourceInventory?.digest || null
      },
      intelligence: {
        depth: state.effectiveness.depth,
        repository: {
          status: intelligence.repository.status,
          complete: intelligence.repository.complete,
          scan: intelligence.repository.scan,
          selectedSources: intelligence.selected,
          selectedBytes: intelligence.selectedBytes,
          findings: intelligence.repository.findings
        }
      },
      effectiveness: state.effectiveness
    };
    if (!quiet) console.log(JSON.stringify(result, null, 2));
    return result;
  }

  function inspectDraft(draftPath, options = {}) {
    const source = options.preparedSource || draftSource(draftPath);
    return inspectSemanticIntakeSource(source, {
      statePath: semanticIntakeStatePath(draftPath),
      resume: `claude-foundation change start ${draftPath} --inspect`,
      quiet: options.quiet,
      excludedSourcePath: relative(root, resolve(root, draftPath)).replaceAll("\\", "/")
    });
  }

  function amendmentIntakeSource(amendment) {
    return {
      version: 4,
      intent: String(amendment.reason || "Amend the active agreement"),
      impact: amendment.impact || "low",
      coupling: amendment.coupling || "isolated",
      size: amendment.size,
      changeSize: amendment.changeSize,
      requirements: [...(amendment.addRequirements || []),
        ...(amendment.reviseRequirements || [])],
      integrations: amendment.integrations || [],
      externalOperations: amendment.externalOperations || [],
      securityTriggers: amendment.securityTriggers || [],
      riskSignals: amendment.riskSignals || [],
      discovery: amendment.discovery
    };
  }

  function inspectAmendment(id, amendmentPath, options = {}) {
    const active = loadRuntime(id);
    if (active.semanticDraftVersion !== 4)
      fail(`change amend --inspect requires a semantic-draft v4 change; '${id}' is version ${
        active.semanticDraftVersion || "legacy"}`);
    const path = resolve(root, amendmentPath);
    if (!pathInside(root, path) || !existsSync(path))
      fail("change amend requires a JSON file inside the project");
    const amendment = options.preparedSource || readJson(path);
    return inspectSemanticIntakeSource(amendmentIntakeSource(amendment), {
      statePath: semanticIntakeStatePath(amendmentPath, `amend:${id}`),
      resume: `claude-foundation change amend ${id} ${amendmentPath} --inspect`,
      quiet: options.quiet,
      validateCompiledDraft: false,
      excludedSourcePath: relative(root, path).replaceAll("\\", "/")
    });
  }

  function applyGroundingReopen(state, flags) {
    if (flags["reopen-grounding"]) {
      const decisionRef = String(flags["decision-ref"] || "").trim();
      const reason = String(flags["reopen-reason"] || "").trim();
      if (!decisionRef || !reason)
        fail("--reopen-grounding requires --decision-ref and --reopen-reason");
      if (state.groundingReopenPending)
        fail("grounding already has an open revision; complete and validate that batch first");
      if (!state.groundingDigest)
        fail("--reopen-grounding requires a currently locked grounding ledger");
      if ((state.groundingReopens || []).some((row) => row.decisionRef === decisionRef))
        fail("--decision-ref was already used for a grounding reopen");
      state.groundingReopenPending = {
        version: 1,
        decisionRef,
        reason,
        priorDigest: state.groundingDigest,
        priorLockedAt: state.groundingLockedAt || null,
        openedAt: now()
      };
      delete state.groundingDigest;
      delete state.groundingLockedAt;
      state.contractRevision = Number(state.contractRevision || 0) + 1;
    } else if ((flags["decision-ref"] && !flags["ci-not-required"]) || flags["reopen-reason"])
      fail("--decision-ref and --reopen-reason require --reopen-grounding");
  }

  // Signed CI is project policy, read once at creation and pinned into the
  // change. A project that relaxes `land.riskBasedCi` afterwards — the
  // historical default many installs still carry — was left with every open
  // change pinned to the old value, and the only ways out were a hand edit of
  // runtime state or of foundation.json from inside Build, which the phase
  // guard rightly refuses. Resolve re-reads the policy, and a user who cannot
  // produce signed CI for one change records that decision here instead.
  function applyResolveCiPolicy(state, flags) {
    if (flags["ci-not-required"]) {
      const decisionRef = String(flags["decision-ref"] || "").trim();
      if (!decisionRef) fail("--ci-not-required requires --decision-ref");
      state.riskBasedCiRequired = false;
      state.ciWaiver = { version: 1, decisionRef, declaredAt: now() };
      return;
    }
    if (state.ciWaiver) return;
    state.riskBasedCiRequired = state.schema === "foundation-standard" &&
      workflowPolicy().land?.riskBasedCi === true;
  }

  function applyResolveAttributes(state, flags) {
    // The only consumer gates on strict equality with "unclear", so an
    // unvalidated value silently defeats the /investigate blocker it feeds.
    if (flags.ambiguity && !["clear", "unclear"].includes(flags.ambiguity))
      fail("--ambiguity must be clear|unclear");
    for (const key of ["ambiguity", "impact", "coupling"])
      if (flags[key]) state[key] = flags[key];
    // Sizes are stored lowercase and validated. `--size` was accepted verbatim
    // with no enum, so `--size medium` or `--size 5` persisted happily, and the
    // one place that read it compared against the literal "S" — which
    // `startAtomic`'s own "xs" could never match. Now that size scales the
    // request budget, an unrecognized value would silently take the default
    // lane instead of the one the author asked for.
    if (flags.size) {
      const size = String(flags.size).toLowerCase();
      if (!["xs", "s", "m", "l"].includes(size)) fail("--size must be xs|s|m|l");
      state.size = size;
    }
    // The paths the author expects to touch, declared before they exist. Policy
    // infers capabilities from the *changed* surface, which at change time is
    // empty — so a `.tsx` file pulls `accessibility` only once it is written,
    // by which point the contract is signed and the evidence is collected.
    // Declaring nothing keeps that behavior exactly; this is advisory input to
    // a forecast, never an input to enforcement.
    if (flags.surface !== undefined) {
      const globs = String(flags.surface).split(",")
        .map((value) => value.trim()).filter(Boolean);
      if (!globs.length) fail("--surface requires at least one path or glob");
      state.declaredSurface = [...new Set(globs)].sort();
    }
  }

  function applyResolveSecurity(state, flags) {
    const semanticText = `${state.intent} ${flags.security || ""}`.toLowerCase();
    // Word boundaries, not substrings. `includes("access")` fired on
    // "accessibility" and `includes("migration")` on "migration guide", so
    // routine work acquired external review it did not need — while the
    // trigger the docs promise ("semantic, not syntax") went unmet either way.
    const inferred = securityTerms.filter((term) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+");
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(semanticText);
    });
    const explicitSecurity = String(flags.security || "").split(",")
      .map((value) => value.trim()).filter((value) => value && value.toLowerCase() !== "none");
    state.securityTriggers = materialSecurityTriggers([
      ...(state.securityTriggers || []).filter((value) =>
        String(value).trim().toLowerCase() !== "none"),
      ...inferred, ...explicitSecurity
    ], state.intent, securityTerms);
    // Coupling alone no longer summons a reviewer. `coupled` means the change
    // spans components, which earns the standard schema's design.md and specs/
    // below — but at low impact there is nothing for an independent reader to
    // protect, and the cross-repository cases that do matter are caught
    // separately: reviewPolicy raises `multi-repository-claim` for any claim
    // above low impact that spans repositories, without consulting this flag.
    state.reviewRequired = state.impact === "high" ||
      (state.coupling === "coupled" && state.impact !== "low") ||
      state.securityTriggers.length > 0 || Boolean(flags.review);
  }

  function applyResolveAcceptance(state, flags) {
    if (flags["acceptance-required"] && flags["acceptance-not-required"])
      fail("resolve cannot combine --acceptance-required and --acceptance-not-required");
    if ((flags["acceptance-reason"] || flags["acceptance-claims"]) &&
        !flags["acceptance-required"])
      fail("--acceptance-reason and --acceptance-claims require --acceptance-required");
    if (flags["acceptance-required"]) {
      const reason = String(flags["acceptance-reason"] || "").trim();
      if (!reason) fail("--acceptance-required requires --acceptance-reason");
      const acceptanceClaims = String(flags["acceptance-claims"] || "").split(",")
        .map((value) => value.trim()).filter(Boolean);
      state.acceptance = {
        version: 2,
        decision: "required",
        required: true,
        reason,
        claimIds: acceptanceClaims,
        scopeOrigin: "explicit",
        declaredAt: now()
      };
    } else if (flags["acceptance-not-required"])
      state.acceptance = {
        version: 2, decision: "not-required", required: false,
        reason: null, claimIds: [], declaredAt: now()
      };
  }

  function upgradeResolvedSchema(id, state) {
    if (state.schema === "foundation-rapid" &&
        (state.impact !== "low" || state.coupling !== "isolated" || state.reviewRequired ||
         state.acceptance?.required)) {
      state.schema = "foundation-standard";
      state.upgradedFrom = "foundation-rapid";
      state.groundingRequired = workflowPolicy().workflow.grounding === "required";
      state.nfrAssessmentRequired = true;
      state.decisionMetadataRequired = true;
      state.semanticInvariantsRequired = true;
      state.riskBasedCiRequired = !state.ciWaiver &&
        workflowPolicy().land?.riskBasedCi === true;
      // The rapid packet has no design.md and no specs/, which the standard
      // schema requires. Leaving them absent made `validate` refuse a change
      // whose only listed next command was `validate` — a dead end that had to
      // be guessed out of. Instantiate them here, with the upgrade.
      materializeStandardArtifacts(id, state.intent);
      return true;
    }
    return false;
  }

  function printResolution(id, state, upgraded) {
    // The surface line appears only when one was declared, so a change that
    // never used the flag keeps producing the output it produced before it
    // existed.
    const surfaceLine = state.declaredSurface?.length
      ? `\n  surface: ${state.declaredSurface.join(", ")}` : "";
    // Named only when a decision waived it, so every earlier output is intact.
    const ciLine = state.ciWaiver
      ? `\n  signed CI: waived (${state.ciWaiver.decisionRef})` : "";
    console.log(`RESOLVED ${id}\n  impact: ${state.impact}\n  coupling: ${state.coupling}\n  review: ${state.reviewRequired ? "required" : "not required"}\n  acceptance: ${state.acceptance?.decision || (state.acceptance?.required ? "required" : "legacy-not-required")}\n  security: ${state.securityTriggers.join(", ") || "none"}${surfaceLine}${ciLine}\n  schema: ${state.schema}${upgraded ? " (upgraded from foundation-rapid; design.md and specs/ added)" : ""}\n  next: ${nextCommand(state.status, id)}`);
  }

  function resolveChange(id, flags) {
    if (flags["approve-spec"] || flags["continue-review"]) {
      const decisionRef = String(flags["decision-ref"] || "").trim();
      if (!decisionRef) fail("This operation requires --decision-ref from an explicit user answer");
      if (Object.keys(flags).some((key) => !["approve-spec", "continue-review", "decision-ref"].includes(key)) ||
          flags["approve-spec"] && flags["continue-review"])
        fail("Record one user decision at a time, separately from agreement edits");
      const state = loadRuntime(id);
      if (state.status === "archived") fail(`change '${id}' is already archived`);
      let approvedDelta = null;
      if (flags["approve-spec"]) {
        validate(id, "root", { quiet: true });
        const current = loadRuntime(id);
        const approvalRoot = current.workspace?.path &&
          existsSync(join(current.workspace.path, "openspec", "changes", id))
          ? current.workspace.path : root;
        current.specApproval = { required: true, identity: agreementIdentity(approvalRoot, id),
          revision: Number(current.contractRevision || 0), decisionRef, approvedAt: now() };
        approvedDelta = current.pendingApprovalDelta || null;
        delete current.pendingApprovalDelta;
        saveRuntime(current);
      } else {
        if (!state.reviewWindow) fail("No review window has started for this change");
        const startedAt = now();
        state.reviewWindowHistory = [...(state.reviewWindowHistory || []), state.reviewWindow];
        state.reviewWindow = { startedAt, deadline: new Date(Date.parse(startedAt) + REVIEW_WINDOW_MS).toISOString(), decisionRef };
        saveRuntime(state);
      }
      console.log(`DECISION RECORDED ${id}\n` +
        (approvedDelta ? `  approved requirement delta:\n${formatApprovalDelta(approvedDelta)}\n` : "") +
        `  next: claude-foundation advance ${id} --through ${flags["approve-spec"] ? "build" : "proven"}`);
      return;
    }
    const state = loadRuntime(id);
    applyGroundingReopen(state, flags);
    applyResolveAttributes(state, flags);
    applyResolveSecurity(state, flags);
    applyResolveAcceptance(state, flags);
    applyResolveCiPolicy(state, flags);
    const upgraded = upgradeResolvedSchema(id, state);
    const proposalPath = join(changePath(id), "proposal.md");
    if (existsSync(proposalPath)) {
      const proposal = readFileSync(proposalPath, "utf8");
      const synchronized = synchronizeProposalClassification(proposal, state);
      if (synchronized !== proposal) writeFileSync(proposalPath, synchronized);
    }
    state.resolvedAt = now();
    saveRuntime(state);
    printResolution(id, state, upgraded);
    return { state, upgraded };
  }

  function startResolutionFlags(draft, classification, rapid) {
    const { impact, coupling, securityTriggers } = classification;
    return {
      impact,
      coupling,
      size: String(draft.size || (rapid ? "xs" : "s")).toLowerCase(),
      security: securityTriggers.join(","),
      review: Boolean(draft.reviewRequired),
      "acceptance-required": Boolean(draft.acceptance?.required),
      "acceptance-not-required": !draft.acceptance?.required,
      "acceptance-reason": draft.acceptance?.reason || undefined,
      "acceptance-claims": (draft.acceptance?.claimIds || []).join(",") || undefined
    };
  }

  // Draft v4 compilation requires the semantic intake snapshot for the same
  // draft path to be current and DONE. Start and revise share this gate; only
  // their snapshot namespace and resume route differ.
  function completedDraftIntake(source, draftPath, { statePath, resume, inspect }) {
    if (source.version !== 4) return null;
    let intakeState = null;
    if (existsSync(statePath)) {
      try { intakeState = JSON.parse(readFileSync(statePath, "utf8")); }
      catch { intakeState = null; }
    }
    if (!intakeState) {
      const inspected = inspect();
      if (inspected.action !== "DONE")
        fail(`version-4 drafts require a current completed semantic intake; ` +
          `resume with '${resume}'`);
      return inspected.effectiveness || null;
    }
    const sourcePath = relative(root, resolve(root, draftPath)).replaceAll("\\", "/");
    const intelligence = repositoryIntelligence(source, [sourcePath]);
    const sourceInspection = intelligence.repository.status === "ready"
      ? semanticSourceInspection(source, null, intelligence.selected)
      : inspectSemanticSources({ projectRoot: root, sourcePaths: [] });
    const projection = semanticIntakeResumeProjection(intakeState, source, {
      resumeRoute: resume, sourceInventory: sourceInspection.inventory
    });
    const investigationIssues = source.investigation === undefined ? []
      : validateInvestigationBinding({ projectRoot: root, binding: source.investigation, git });
    if (intelligence.repository.status !== "ready" || sourceInspection.findings.length ||
        investigationIssues.length ||
        source.discovery?.sourceDigest !== sourceInspection.inventory.digest ||
        projection.status !== "current" || projection.action?.action !== "DONE")
      fail(`version-4 drafts require a current completed semantic intake; ` +
        `resume with '${resume}'`);
    return intakeState.effectiveness || null;
  }

  function preflightDraft(draftPath, source) {
    const draft = measureStage("change.load-draft", () =>
      loadDraft(draftPath, { deferPolicy: true, preparedSource: source }));
    const preflight = measureStage("change.preflight", () => atomicStartPreflight(draft, {
      groundingRequired: workflowPolicy().workflow.grounding === "required" ||
        Boolean(draft.grounding)
    }));
    if (preflight.issues.length)
      fail(`start draft preflight failed:\n  - ${preflight.issues.join("\n  - ")}`);
    const { classification, rapid } = preflight;
    return { draft, rapid, resolutionFlags: startResolutionFlags(draft, classification, rapid) };
  }

  function startAtomic(draftPath, options = {}) {
    const source = draftSource(draftPath);
    const completedIntakeEffectiveness = completedDraftIntake(source, draftPath, {
      statePath: semanticIntakeStatePath(draftPath),
      resume: `claude-foundation change start ${draftPath} --inspect`,
      inspect: () => inspectDraft(draftPath, { quiet: true, preparedSource: source })
    });
    const { draft, rapid, resolutionFlags } = preflightDraft(draftPath, source);
    const id = slugify(draft.id || draft.intent);
    assertChangeAvailable(id);
    try {
      trapFailures(() => {
        measureStage("change.materialize", () => createChange(draft.intent, { rapid, id: draft.id }, draft, {
          availabilityChecked: true,
          deferSessionBinding: true
        }));
        const resolution = measureStage("change.resolve", () => resolveChange(id, resolutionFlags));
        // A rapid draft can still upgrade when semantic security terms in the
        // intent trigger standard policy during resolve. Only that transition
        // needs a second projection; the common path was previously rewritten
        // unconditionally after createChange had already materialized it.
        if (resolution.upgraded) materializeDraft(id, draft);
        // Atomic start is a public Change gate. Use the same explicit validation
        // as `change validate`, including OpenSpec strict lint when available.
        measureStage("change.validate", () => validate(id, "root"));
        bindClaudeSession(id, "change");
        const pending = loadRuntime(id);
        pending.specApproval = { required: true };
        if ([3, 4].includes(draft._semanticVersion))
          pending.requirementFingerprints = draftRequirementFingerprints(draft);
        if (completedIntakeEffectiveness)
          pending.semanticIntakeEffectiveness = completedIntakeEffectiveness;
        saveRuntime(pending);
        console.log(`AGREED ${id}\n  inspect: openspec/changes/${id}/\n  awaiting user approval before Build\n  next: claude-foundation change resolve ${id} --approve-spec --decision-ref <user-decision>`);
      });
    } catch (error) {
      let rollbackIssues;
      try { rollbackIssues = rollbackStart(id) || []; }
      catch (rollbackError) {
        rollbackIssues = [`rollback failed: ${rollbackError.message || rollbackError}`];
      }
      const failure = error?.message || String(error);
      const detail = rollbackIssues.length
        ? `${failure}; rollback issues: ${rollbackIssues.join("; ")}`
        : `${failure}; partial atomic start rolled back`;
      fail(detail);
    }
    if (options.consumeDraft) {
      const draftFile = resolve(root, draftPath);
      try { rmSync(draftFile); }
      catch (error) {
        console.error(`WARNING: atomic start succeeded but could not remove draft '${
          relative(root, draftFile)}': ${error.message}`);
      }
    }
    try { rmSync(semanticIntakeStatePath(draftPath), { force: true }); }
    catch (error) {
      console.error(`WARNING: atomic start succeeded but could not remove semantic intake state: ${
        error.message}`);
    }
  }

  function packetFingerprints(dir) {
    const evidencePath = join(dir, "evidence.yaml");
    const claims = existsSync(evidencePath) ? readJson(evidencePath).claims || [] : [];
    const specsDir = join(dir, "specs");
    const specTexts = existsSync(specsDir)
      ? readdirSync(specsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
        .map((entry) => join(specsDir, entry.name, "spec.md"))
        .filter((path) => existsSync(path)).sort()
        .map((path) => readFileSync(path, "utf8"))
      : [];
    return requirementFingerprints({ claims, specTexts });
  }

  function recordApprovalDelta(state, delta) {
    state.pendingApprovalDelta = {
      ...mergeApprovalDelta(state.pendingApprovalDelta, delta),
      revision: Number(state.contractRevision || 0)
    };
    return state.pendingApprovalDelta;
  }

  function revisionRuntimePath(id) {
    return join(root, ".foundation", "runtime", `${id}.json`);
  }

  // A pre-Build revision replaces the whole compiled packet, so it is limited
  // to changes whose agreement has not produced any Build or Prove result.
  function assertRevisable(id) {
    // Archive moves the packet but keeps runtime state, so status is checked
    // first to return the successor-change route rather than "not found".
    if (!existsSync(revisionRuntimePath(id)))
      fail(`change revise requires an existing active change; '${id}' was not found`);
    const state = loadRuntime(id);
    if (["proven", "landing", "archived"].includes(state.status))
      fail(`change revise cannot rewrite an agreement in '${state.status}' status; ` +
        "start a successor change");
    if (!existsSync(changePath(id)))
      fail(`change revise requires an existing active change; '${id}' was not found`);
    if (![3, 4].includes(state.semanticDraftVersion))
      fail(`change revise requires a semantic-draft v3 or v4 change; '${id}' is a legacy agreement`);
    const amend = `claude-foundation change amend ${id} <amendment.json> --inspect`;
    const receipts = join(root, ".foundation", "receipts", id);
    const built = (state.workspace && (state.workspace.mode !== "current" ||
        resolve(state.workspace.path || root) !== resolve(root))) ||
      (existsSync(receipts) && readdirSync(receipts).length > 0) ||
      /^\s*-\s*\[[xX]\]/m.test(readFileSync(join(changePath(id), "tasks.md"), "utf8"));
    if (built)
      fail(`change revise is only available before Build; '${id}' has Build or proof state. ` +
        `Use '${amend}' instead`);
    return state;
  }

  function revisionSource(id, draftPath) {
    const source = draftSource(draftPath);
    if (source.id !== undefined && slugify(source.id) !== id)
      fail(`change revise draft id '${source.id}' does not match change '${id}'`);
    return { ...source, id };
  }

  function revisionIntakeOptions(id, draftPath, source) {
    const resume = `claude-foundation change revise ${id} ${draftPath} --inspect`;
    return {
      statePath: semanticIntakeStatePath(draftPath, `revise:${id}`),
      resume,
      inspect: () => inspectRevision(id, draftPath, { quiet: true, preparedSource: source })
    };
  }

  function inspectRevision(id, draftPath, options = {}) {
    assertRevisable(id);
    const source = options.preparedSource || revisionSource(id, draftPath);
    if (source.version !== 4)
      fail(`change revise --inspect requires a semantic-draft v4 draft; got version ${source.version}`);
    const { statePath, resume } = revisionIntakeOptions(id, draftPath, source);
    return inspectSemanticIntakeSource(source, {
      statePath, resume, quiet: options.quiet,
      excludedSourcePath: relative(root, resolve(root, draftPath)).replaceAll("\\", "/")
    });
  }

  function reviseChange(id, draftPath, options = {}) {
    const observedRevision = amendmentRevision(assertRevisable(id));
    return withAmendmentLock(id, observedRevision,
      () => reviseChangeUnlocked(id, draftPath, options, observedRevision), "change revision");
  }

  function reviseChangeUnlocked(id, draftPath, options, expectedRevision) {
    const prior = assertRevisable(id);
    setOperationChangeId(id);
    const source = revisionSource(id, draftPath);
    const intake = revisionIntakeOptions(id, draftPath, source);
    const completedIntakeEffectiveness = completedDraftIntake(source, draftPath, intake);
    const { draft, rapid, resolutionFlags } = preflightDraft(draftPath, source);

    // Build does not take this lock, so recheck that no workspace, receipt, or
    // revision appeared during intake and compilation before anything moves.
    assertAmendmentRevision(id, expectedRevision, "change revision");
    assertRevisable(id);
    const basePath = changePath(id);
    const runtimeFile = revisionRuntimePath(id);
    // Changes compiled before draft fingerprints existed compare both sides
    // from their packets so one method never marks every requirement revised.
    const storedBefore = prior.requirementFingerprints;
    const before = storedBefore || packetFingerprints(basePath);
    const priorRuntime = readFileSync(runtimeFile);
    const transactionRoot = mkdtempSync(join(dirname(basePath), `.${id}-revise-`));
    const priorPath = join(transactionRoot, "prior");
    let moved = false;
    let delta;
    try {
      renameSync(basePath, priorPath);
      moved = true;
      trapFailures(() => {
        createChange(draft.intent, { rapid, id }, draft, {
          availabilityChecked: true, deferSessionBinding: true
        });
        const resolution = resolveChange(id, resolutionFlags);
        if (resolution.upgraded) materializeDraft(id, draft);
        validate(id, "root");
        bindClaudeSession(id, "change");
        const next = loadRuntime(id);
        next.revision = Number(prior.revision || 0) + 1;
        next.contractRevision = Number(prior.contractRevision || 0) + 1;
        next.executionRevision = Number(prior.executionRevision || 0) + 1;
        next.createdAt = prior.createdAt || next.createdAt;
        if (prior.budget) next.budget = prior.budget;
        next.specApproval = { required: true };
        if (completedIntakeEffectiveness)
          next.semanticIntakeEffectiveness = completedIntakeEffectiveness;
        const draftFingerprints = draftRequirementFingerprints(draft);
        delta = requirementDelta(before,
          storedBefore ? draftFingerprints : packetFingerprints(basePath));
        next.requirementFingerprints = draftFingerprints;
        if (prior.pendingApprovalDelta) next.pendingApprovalDelta = prior.pendingApprovalDelta;
        recordApprovalDelta(next, delta);
        next.revisions = [...(prior.revisions || []), {
          version: 1, revision: next.contractRevision, kind: "pre-build-revision",
          delta, appliedAt: now()
        }];
        saveRuntime(next);
      });
    } catch (error) {
      const issues = [];
      try {
        if (moved) {
          rmSync(basePath, { recursive: true, force: true });
          renameSync(priorPath, basePath);
        }
        writeFileSync(runtimeFile, priorRuntime);
      } catch (restoreError) {
        issues.push(`restore failed: ${restoreError.message || restoreError}; ` +
          `prior packet retained at ${relative(root, priorPath)}`);
      }
      if (!issues.length) rmSync(transactionRoot, { recursive: true, force: true });
      fail(`${error?.message || error}; ${issues.length
        ? issues.join("; ") : "change revision rolled back"}`);
    }
    rmSync(transactionRoot, { recursive: true, force: true });
    if (options.consumeDraft) {
      try { rmSync(resolve(root, draftPath)); }
      catch (error) {
        console.error(`WARNING: revision succeeded but could not remove draft '${
          draftPath}': ${error.message}`);
      }
    }
    try { rmSync(intake.statePath, { force: true }); }
    catch (error) {
      console.error(`WARNING: revision succeeded but could not remove semantic intake state: ${
        error.message}`);
    }
    const state = loadRuntime(id);
    console.log(`REVISED ${id}\n  revision: ${state.contractRevision}\n` +
      `  requirement delta awaiting approval:\n${formatApprovalDelta(state.pendingApprovalDelta)}\n` +
      `  inspect: openspec/changes/${id}/\n` +
      `  next: claude-foundation change resolve ${id} --approve-spec --decision-ref <user-decision>`);
    return delta;
  }

  function amendChangeUnlocked(id, amendmentPath, options, state, expectedRevision) {
    if (![3, 4].includes(state.semanticDraftVersion))
      fail(`change amend requires a semantic-draft v3 or v4 change; '${id}' is a legacy agreement`);
    if (["proven", "landing", "archived"].includes(state.status))
      fail(`change amend cannot rewrite an agreement in '${state.status}' status; start a successor change`);
    const source = resolve(root, amendmentPath);
    if (!pathInside(root, source) || !existsSync(source))
      fail("change amend requires a JSON file inside the project");
    const amendment = readJson(source);
    const amendmentStatePath = semanticIntakeStatePath(amendmentPath, `amend:${id}`);
    let completedAmendmentIntakeEffectiveness = null;
    if (state.semanticDraftVersion === 4) {
      const resume = `claude-foundation change amend ${id} ${amendmentPath} --inspect`;
      let intakeState = null;
      if (existsSync(amendmentStatePath)) {
        try { intakeState = JSON.parse(readFileSync(amendmentStatePath, "utf8")); }
        catch { intakeState = null; }
      }
      const intakeSource = amendmentIntakeSource(amendment);
      const amendmentRelativePath = relative(root, source).replaceAll("\\", "/");
      const intelligence = repositoryIntelligence(intakeSource, [amendmentRelativePath]);
      const sourceInspection = intelligence.repository.status === "ready"
        ? semanticSourceInspection(intakeSource, null, intelligence.selected)
        : inspectSemanticSources({ projectRoot: root, sourcePaths: [] });
      const projection = semanticIntakeResumeProjection(intakeState, intakeSource, {
        resumeRoute: resume, sourceInventory: sourceInspection.inventory
      });
      if (intelligence.repository.status !== "ready" || sourceInspection.findings.length ||
          intakeSource.discovery?.sourceDigest !== sourceInspection.inventory.digest ||
          projection.status !== "current" || projection.action?.action !== "DONE")
        fail(`version-4 amendments require a current completed semantic intake; ` +
          `resume with '${resume}'`);
      completedAmendmentIntakeEffectiveness = intakeState?.effectiveness || null;
    }
    const basePath = activeChangePath(id, state);
    const contract = readJson(join(basePath, "evidence.yaml"));
    const tasksContent = readFileSync(join(basePath, "tasks.md"), "utf8");
    const compiled = compileSemanticAmendment({
      amendment, contract, tasksContent, slugify, renderTask: renderDraftTask,
      semanticDraftVersion: state.semanticDraftVersion,
      loadCanonicalSpec: (capability) => {
        const path = join(root, "openspec", "specs", slugify(capability), "spec.md");
        return existsSync(path) ? readFileSync(path, "utf8") : null;
      }
    });
    if (compiled.issues.length)
      fail(`semantic amendment validation failed:\n  - ${compiled.issues.join("\n  - ")}`);
    const coverageChanges = (compiled.discovery?.coverage || []).map((row) => ({
      dimension: row.dimension,
      claimIds: compiled.claims.filter((claim) =>
        (row.covers || []).includes(claim.requirementKey)).map((claim) => claim.id)
    }));
    const configuredProviderNames = requiredProviders ? requiredProviders(id) : [];
    const providerEntries = new Map(Object.entries(compiled.providers || {}));
    for (const name of configuredProviderNames) {
      if (providerEntries.has(name)) continue;
      const config = providerConfig ? providerConfig(id, name) : null;
      if (config) providerEntries.set(name, config);
    }
    const providers = Object.fromEntries([...providerEntries].map(([name, config]) => [name, {
        capability: config.capability || name,
        ...(Array.isArray(config.claims) ? { claims: config.claims.filter((claim) =>
          !compiled.removedClaimIds.includes(claim)) } : {}),
        ...(Array.isArray(config.dependsOn) ? { dependsOn: config.dependsOn } : {})
      }]
    ));
    const invalidation = planAmendmentInvalidation({
      claims: compiled.claims,
      tasks: taskBlocks(compiled.tasksContent).map(taskMetadata),
      providers,
      coverageDelta: {
        addedClaimIds: compiled.addedClaimIds,
        changedClaimIds: compiled.changedClaimIds,
        removedClaimIds: compiled.removedClaimIds,
        coverageChanges
      },
      priorClaims: compiled.priorClaims
    });
    if (invalidation.status !== "READY")
      fail(`semantic amendment invalidation planning failed:\n  - ${
        invalidation.findings.map((finding) => `${finding.code}: ${finding.message}`).join("\n  - ")}`);
    compiled.invalidation = invalidation;

    const priorContractRevision = Number(state.contractRevision || 0);
    const priorContractFingerprint = contractFingerprint ? contractFingerprint(id) : null;
    const proofAdvancePath = join(root, ".foundation", "evidence", id, "proof-advance.json");
    const priorProofAdvance = existsSync(proofAdvancePath)
      ? readFileSync(proofAdvancePath, "utf8") : null;
    const receiptBackups = new Map();
    const receiptBindings = [];
    if (receiptPath && existsSync(dirname(receiptPath(id, "__provider__")))) {
      for (const provider of invalidation.proof.preserveReceipts) {
        const path = receiptPath(id, provider);
        if (!existsSync(path)) continue;
        const receipt = readJson(path);
        receiptBackups.set(provider, receipt);
        const binding = selectiveBinding(id, provider, priorContractRevision, receipt);
        if (binding) receiptBindings.push(binding);
      }
    }

    const transactionRoot = mkdtempSync(join(dirname(basePath), `.${id}-amend-`));
    const stagedPath = join(transactionRoot, "next");
    const priorPath = join(transactionRoot, "prior");
    cpSync(basePath, stagedPath, { recursive: true, errorOnExist: true });
    try { writeSemanticAmendment(stagedPath, compiled, slugify, { schema: state.schema }); }
    catch (error) {
      rmSync(transactionRoot, { recursive: true, force: true });
      fail(`${error?.message || error}; semantic amendment rolled back`);
    }
    const priorState = structuredClone(state);
    const rebindAuditPaths = [];
    const rebindAudits = [];
    let installed = false;
    try {
      assertAmendmentRevision(id, expectedRevision);
      renameSync(basePath, priorPath);
      renameSync(stagedPath, basePath);
      installed = true;
      validate(id, "active");
      assertAmendmentRevision(id, expectedRevision);
      const currentContractRevision = priorContractRevision + 1;
      const currentRequiredProviders = requiredProviders ? requiredProviders(id) : [];
      const currentBindings = invalidation.proof.preserveReceipts
        .map((provider) => selectiveBinding(id, provider, currentContractRevision))
        .filter(Boolean);
      const proofRecovery = planSelectiveProofRecovery({
        changeId: id,
        invalidation,
        requiredProviders: currentRequiredProviders,
        receiptBindings,
        currentBindings,
        priorContractRevision,
        currentContractRevision
      });
      compiled.invalidation.proofRecovery = proofRecovery;
      if (proofRecovery.status === "READY" && receiptPath && contractFingerprint) {
        const nextFingerprint = contractFingerprint(id);
        for (const provider of proofRecovery.providers.preserved) {
          const priorReceipt = receiptBackups.get(provider);
          if (!priorReceipt) throw new Error(`selective proof receipt '${provider}' disappeared`);
          const rebound = rebindSelectiveProofReceipt({
            receipt: priorReceipt,
            provider,
            plan: proofRecovery,
            fromContractFingerprint: priorContractFingerprint,
            toContractFingerprint: nextFingerprint,
            reboundAt: now()
          });
          writeJson(receiptPath(id, provider), rebound);
          if (receiptValidity(id, provider).validity !== "valid")
            throw new Error(`selective proof receipt '${provider}' failed post-rebind validation`);
          const audit = {
            version: 1,
            kind: "semantic-amendment-receipt-rebind",
            changeId: id,
            provider,
            recordedAt: rebound.contractRebind.reboundAt,
            contract: proofRecovery.contract,
            decision: proofRecovery.decisions.find((row) => row.provider === provider),
            priorReceiptDigest: stableHash(priorReceipt),
            reboundReceiptDigest: stableHash(rebound)
          };
          const auditDirectory = join(root, ".foundation", "evidence", id, "receipt-rebinds");
          mkdirSync(auditDirectory, { recursive: true });
          const providerKey = createHash("sha256").update(provider).digest("hex").slice(0, 12);
          const auditPath = join(auditDirectory,
            `${currentContractRevision}-${providerKey}-${stableHash(audit).slice(0, 12)}.json`);
          writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, {
            encoding: "utf8", flag: "wx"
          });
          rebindAuditPaths.push(auditPath);
          rebindAudits.push({
            provider,
            path: relative(root, auditPath).replaceAll("\\", "/"),
            digest: stableHash(audit)
          });
        }
      }
      const nextState = loadRuntime(id);
      nextState.revision = Number(nextState.revision || 0) + 1;
      nextState.contractRevision = Number(nextState.contractRevision || 0) + 1;
      nextState.executionRevision = Number(nextState.executionRevision || 0) + 1;
      nextState.amendments = [...(nextState.amendments || []), {
        version: 1,
        revision: nextState.contractRevision,
        reason: String(amendment.reason || "Agreement expanded during Build"),
        requirementKeys: compiled.addedRequirementKeys,
        revisedRequirementKeys: compiled.revisedRequirementKeys,
        removedRequirementKeys: compiled.removedRequirementKeys,
        removedClaims: compiled.removedClaimIds,
        invalidatedClaims: compiled.invalidatedClaims,
        invalidation: {
          affectedTasks: invalidation.affectedTasks,
          affectedProviders: invalidation.affectedProviders,
          preservedProviders: invalidation.preservedProviders,
          approval: invalidation.approval,
          proof: invalidation.proof,
          proofRecovery,
          rebindAudits
        },
        ...(completedAmendmentIntakeEffectiveness
          ? { semanticIntakeEffectiveness: completedAmendmentIntakeEffectiveness } : {}),
        appliedAt: now()
      }];
      recordApprovalDelta(nextState, {
        added: compiled.addedRequirementKeys,
        revised: compiled.revisedRequirementKeys,
        removed: compiled.removedRequirementKeys
      });
      if (nextState.requirementFingerprints) {
        const fingerprints = { ...nextState.requirementFingerprints,
          ...draftRequirementFingerprints({
            requirements: [...(amendment.addRequirements || []),
              ...(amendment.reviseRequirements || [])],
            evidence: amendment.evidence
          }) };
        for (const key of compiled.removedRequirementKeys) delete fingerprints[key];
        nextState.requirementFingerprints = fingerprints;
      }
      saveRuntime(nextState);
      // A prior proof-advance checkpoint describes the old contract. Even when
      // every executable receipt is preserved, the coordinator must re-enter
      // Prove and finalize the amended packet instead of accepting that stale
      // READY projection as if it covered the new revision.
      rmSync(proofAdvancePath, { force: true });
      rmSync(priorPath, { recursive: true, force: true });
    } catch (error) {
      if (installed && existsSync(basePath))
        rmSync(basePath, { recursive: true, force: true });
      if (existsSync(priorPath)) renameSync(priorPath, basePath);
      if (receiptPath)
        for (const [provider, receipt] of receiptBackups)
          writeJson(receiptPath(id, provider), receipt);
      for (const path of rebindAuditPaths) rmSync(path, { force: true });
      if (priorProofAdvance !== null) {
        mkdirSync(dirname(proofAdvancePath), { recursive: true });
        writeFileSync(proofAdvancePath, priorProofAdvance);
      }
      if (installed) saveRuntime(priorState);
      fail(`${error?.message || error}; semantic amendment rolled back`);
    } finally {
      rmSync(transactionRoot, { recursive: true, force: true });
    }
    if (options.consumeAmendment) {
      try { rmSync(source); }
      catch (error) {
        console.error(`WARNING: amendment succeeded but could not remove '${
          relative(root, source)}': ${error.message}`);
      }
    }
    try { rmSync(amendmentStatePath, { force: true }); }
    catch (error) {
      console.error(`WARNING: amendment succeeded but could not remove semantic intake state: ${
        error.message}`);
    }
    console.log(`AMENDED ${id}\n  revision: ${loadRuntime(id).contractRevision}\n` +
      `  invalidated claims: ${[...compiled.invalidatedClaims, ...compiled.removedClaimIds.map((claim) =>
        `${claim} (removed)`)].join(", ") || "none"}\n` +
      `  proof: ${compiled.invalidation.proofRecovery?.recovery?.instruction ||
        "re-enter Prove so receipt bindings are recomputed"}\n` +
      `  requirement delta awaiting approval:\n${
        formatApprovalDelta(loadRuntime(id).pendingApprovalDelta || {})}\n` +
      `  proof command: ${compiled.invalidation.proofRecovery?.recovery?.command ||
        `claude-foundation advance ${id} --through proven`}\n` +
      `  next: claude-foundation advance ${id}`);
    return compiled;
  }

  function amendChange(id, amendmentPath, options = {}) {
    const state = loadRuntime(id);
    const observedRevision = amendmentRevision(state);
    return withAmendmentLock(id, observedRevision,
      () => amendChangeUnlocked(id, amendmentPath, options, state, observedRevision));
  }

  return {
    templateDir,
    instantiate,
    loadDraft,
    materializeDraft,
    createChange,
    rapidStartTemplate,
    inspectDraft,
    inspectAmendment,
    startAtomic,
    inspectRevision,
    reviseChange,
    amendChange,
    resolveChange
  };
}
