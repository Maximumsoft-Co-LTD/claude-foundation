import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { routeChange } from "../contracts/scratch-router.mjs";
import { missingApprovalLanes } from "../core/user-decisions.mjs";
import { TYPE_SURFACES, coverageReport } from "./prototype-checklist.mjs";
import { factsDigest, pageFile, snapshotFor, syncStatus, syncWarnings } from "./prototype-sync.mjs";
import { undoPlan } from "./undo-plan.mjs";
import { devDocumentChecklist, inferWorkTypes } from "./validation/dev-document.mjs";

// Approval data: what the harness computes about a change for the people who
// approve it, printed as JSON by `package <change>`. The harness writes no
// page. The approval page is a file the prototype skill authors (the draft
// names it as the `prototype` example); the harness only reads it to record and
// compare digests. A label of `proof` requires a valid passing receipt, so
// nothing the page says can raise a proof count.

// The typed draft is trusted only when it describes the current revision.
export function currentDraft(state) {
  const source = state?.draftSource;
  if (!source?.draft || Number(source.contractRevision || 0) !== Number(state?.contractRevision || 0)) return null;
  return source.draft;
}

// Route a change from a state value, so callers can route a revision before
// it is saved. Approval lanes fail closed: an amendment leaves the typed draft
// one revision behind, so its last draft and the packet's work types are
// combined rather than either being dropped.
export function routeForState(state, packetWorkTypes = []) {
  const draft = currentDraft(state) ?? state?.draftSource?.draft ?? null;
  const workTypes = [...new Set([...(Array.isArray(draft?.workType) ? draft.workType : []),
    ...(packetWorkTypes || [])])];
  const paths = [
    ...(Array.isArray(draft?.tasks) ? draft.tasks.flatMap((task) => Array.isArray(task?.paths) ? task.paths : []) : []),
    ...(Array.isArray(draft?.fileMap) ? draft.fileMap.map((row) => row?.path).filter(Boolean) : [])
  ];
  // Every data model row kept in the browser means no server migration.
  const models = Array.isArray(draft?.dataModel) ? draft.dataModel : Array.isArray(draft?.dataModel?.entities) ? draft.dataModel.entities : [];
  const browserStorage = models.length > 0 && models.every((row) => String(row?.store || "").toLowerCase() === "browser");
  const exampleTypes = Array.isArray(draft?.examples) ? draft.examples.map((row) => row?.type).filter(Boolean) : [];
  return routeChange({
    workTypes, riskSignals: state?.riskSignals,
    impact: state?.impact, coupling: state?.coupling,
    integrations: draft?.integrations, securityTriggers: state?.securityTriggers, paths,
    browserStorage, exampleTypes
  });
}

export function draftDiagrams(draft) {
  if (!draft) return [];
  const rows = [];
  if (draft.userFlow?.source) rows.push({ key: "user-flow", purpose: draft.userFlow.purpose, source: draft.userFlow.source });
  if (draft.diagram?.source) rows.push({ key: draft.diagram.key || "diagram", purpose: draft.diagram.purpose, source: draft.diagram.source });
  for (const row of Array.isArray(draft.diagrams) ? draft.diagrams : [])
    if (row?.type === "mermaid" && row.source) rows.push({ key: row.key, purpose: row.purpose, source: row.source });
  return rows;
}

// Preview receipts live outside the receipt store; a revision mismatch is stale.
export function previewReceipts(previewsDir, id, contractRevision) {
  const dir = join(previewsDir, id, "receipts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".json")).sort().flatMap((name) => {
    try {
      const value = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (value?.kind !== "preview") return [];
      return [{ ...value, stale: Number(value.contractRevision) !== Number(contractRevision || 0) }];
    } catch { return []; }
  });
}

function artifactLabel(capability, { proven, previews }) {
  if (!capability) return "none";
  if (proven.has(capability)) return "proof";
  const preview = previews.find((row) => row.capability === capability);
  if (preview) return preview.stale ? "stale" : "preview";
  return "none";
}

// Runnable artifacts of a High or Critical change become optional preview
// suggestions, matched to declared providers by capability.
export function previewSuggestions(route, providers, id) {
  if (route.level !== "High" && route.level !== "Critical") return [];
  const seen = new Set();
  return route.artifacts.filter((row) => row.runnable && !seen.has(row.capability) && seen.add(row.capability))
    .map((row) => {
      const matches = providers.filter((provider) => provider.capability === row.capability);
      return {
        capability: row.capability,
        artifact: row.label,
        providers: matches.map((provider) => ({
          name: provider.name,
          external: provider.external,
          command: `claude-foundation preview ${id} --provider ${provider.name}` +
            (provider.external ? " --decision-ref <user-decision>" : "")
        }))
      };
    });
}

const list = (value) => Array.isArray(value) ? value : [];
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const at = (value, path) => path.split(".").reduce((node, part) => node?.[part], value);

// Plain text for a draft value, or null when there is nothing to show.
export function show(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(show).filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  if (isObject(value)) {
    const parts = Object.entries(value).map(([key, item]) => {
      const text = show(item);
      return text ? `${key}: ${text}` : null;
    }).filter(Boolean);
    return parts.length ? parts.join("; ") : null;
  }
  return null;
}

// The author's own line wins; otherwise the answer is read from fields the
// draft already has, and its source is named.
export function undoWho(draft) {
  const scratch = isObject(draft?.scratch) ? draft.scratch : {};
  const own = (key) => typeof scratch[key] === "string" && scratch[key].trim() ? scratch[key].trim() : null;
  const derive = (candidates) => {
    for (const [path, read] of candidates) {
      const text = read(at(draft, path));
      if (text) return { value: text, source: path };
    }
    return null;
  };
  const who = own("who") ? { value: own("who"), source: "scratch.who" } : derive([
    ["deprecationPlan", (plan) => show(plan?.consumers)],
    ["userStories", (stories) => show(list(stories).map((story) => story?.asA))]
  ]);
  return { undo: undoPlan(draft), who };
}

export function approvalStatus(state, missingLanes = []) {
  const approval = state?.specApproval;
  const approved = Boolean(approval?.identity) && Number(approval.revision) === Number(state?.contractRevision || 0);
  return { approved, missingLanes: approved ? [] : missingLanes };
}

// Questions arrive as strings or as { question | text } rows.
export function openQuestions(draft) {
  return list(draft?.openQuestions).map((row) => typeof row === "string" ? row : row?.question ?? row?.text)
    .map((text) => String(text ?? "").trim()).filter(Boolean);
}

// Failure scenarios with the trigger, what the user sees, and the recovery only
// when the draft states it.
export function failureRows(draft) {
  return list(draft?.requirements).flatMap((requirement) => list(requirement?.scenarios))
    .filter((scenario) => scenario?.kind === "failure")
    .map((scenario) => ({ when: show(scenario.when) || show(scenario.name), sees: show(scenario.then), recovery: show(scenario.recovery) }));
}

// Counts derived from the draft; null means unknown, never zero.
export function scopeCounts(draft) {
  const tasks = Array.isArray(draft?.tasks) ? draft.tasks : null;
  const paths = tasks ? new Set(tasks.flatMap((task) => Array.isArray(task?.paths) ? task.paths : [])) : null;
  const requirements = Array.isArray(draft?.requirements) ? draft.requirements : null;
  return {
    files: paths && paths.size ? paths.size : null,
    questions: Array.isArray(draft?.openQuestions) ? openQuestions(draft).length : null,
    failures: requirements ? requirements.flatMap((row) => list(row.scenarios)).filter((row) => row.kind === "failure").length : null
  };
}

function proposalSummary(path) {
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { return ""; }
  const match = text.match(/^## (?:Summary|สรุป)\s*\n+([\s\S]*?)(?=\n## |$)/m);
  return (match ? match[1] : "").trim();
}

const SCRATCH_LINES = ["get", "asIs", "toBe", "ifFail"];
const RISK_STEP = Object.freeze({ Low: 1, Medium: 2, High: 3, Critical: 4 });

// The wording the approval question uses for this page, by the draft's language.
export function approvalPageName(language) {
  return language === "th" ? "หน้าอนุมัติ" : "approval page";
}

export function createApprovalPackageRuntime({
  root, runtimeDir, previewsDir, receiptsDir, loadRuntime, saveRuntime = () => {}, activeChangePath,
  changeWorkTypes, evidence, providerCapability, receiptValidity, fail,
  // Runs a harness call so its failure throws instead of exiting the process;
  // the data is a reading aid and survives broken evidence wiring.
  trap = (operation) => operation()
}) {
  const message = (error) => String(error?.message || error).split("\n")[0];
  function buildModel(id) {
    if (!existsSync(join(runtimeDir, `${id}.json`))) fail(`package: unknown change '${id}'`);
    const state = loadRuntime(id);
    const packet = activeChangePath(id, state);
    const draft = currentDraft(state);
    const route = routeForState(state, draft ? [] : changeWorkTypes(packet));
    const notices = [];
    let configured = {};
    let previewOnly = {};
    try {
      const contract = trap(() => evidence(id));
      configured = contract.providers || {};
      previewOnly = contract.previewProviders || {};
    } catch (error) {
      configured = {};
      notices.push(`evidence not read (${message(error)}); providers, proof labels, and suggestions are omitted`);
    }
    const describe = ([name, config]) => ({
      name, capability: providerCapability(name, config), external: config?.external === true
    });
    // Proof labels come only from Prove providers; suggestions also offer preview-only ones.
    const providers = Object.entries(configured).map(describe);
    const suggestable = [...providers, ...Object.entries(previewOnly).map(describe)];
    const proven = new Set();
    // Per-capability outcome of each receipt, so the page can say what passed.
    const results = [];
    const record = (provider, receipt, valid) => {
      if (!provider.capability || !receipt || receipt.kind === "preview") return;
      results.push({ capability: provider.capability, provider: provider.name, status: receipt.status, valid });
    };
    // After Land the sandbox is gone, so a workspace-bound validity check can
    // only fail; the receipts Land accepted are the record of proof.
    const landed = ["archived", "applied"].includes(state.status) && state.land?.assurance?.status === "passed";
    for (const provider of landed ? providers : []) {
      try {
        const receipt = JSON.parse(readFileSync(join(receiptsDir, id, `${provider.name}.json`), "utf8"));
        if (receipt?.status === "pass" && receipt.kind !== "preview" && provider.capability) proven.add(provider.capability);
        record(provider, receipt, receipt?.status === "pass");
      } catch { /* no receipt for this provider */ }
    }
    for (const provider of landed ? [] : providers) {
      let result = null;
      try { result = trap(() => receiptValidity(id, provider.name)); }
      catch (error) {
        result = null;
        notices.push(`receipt for '${provider.name}' not checked (${message(error)})`);
      }
      // Harness receipts record pass|fail|inconclusive|error.
      if (result?.validity === "valid" && result.receipt?.status === "pass" && provider.capability)
        proven.add(provider.capability);
      record(provider, result?.receipt, result?.validity === "valid");
    }
    const previews = previewReceipts(previewsDir, id, state.contractRevision);
    const capabilityOf = (row) => row.id === "testmap" ? "test" : row.source === "provider" ? row.ref : null;
    const artifacts = route.artifacts.map((row) => ({
      ...row, evidence: artifactLabel(capabilityOf(row), { proven, previews }),
      preview: capabilityOf(row) ? previews.find((preview) => preview.capability === capabilityOf(row)) || null : null
    }));
    // Lane status is a reading aid: a failed check leaves the lanes unlisted.
    let missingLanes = [];
    try { missingLanes = missingApprovalLanes(root, id, state); } catch { /* lanes stay unlisted */ }
    return {
      id, state, route, draft, artifacts,
      approval: approvalStatus(state, missingLanes),
      diagrams: draftDiagrams(draft),
      suggestions: previewSuggestions(route, suggestable, id),
      legacy: !draft,
      proposal: proposalSummary(join(packet, "proposal.md")),
      proven: [...proven].sort(),
      notices,
      results,
      previews
    };
  }

  // What the harness itself computes about risk, proof, and approval. Its
  // digest is what a page must carry to count as current.
  function factsOf(model) {
    return {
      revision: Number(model.state.contractRevision || 0),
      level: model.route.level,
      reasons: model.route.reasons,
      roles: model.route.roles,
      proven: model.proven,
      artifacts: model.artifacts.map((row) => [row.id, row.evidence]),
      approved: model.approval.approved,
      missingLanes: model.approval.missingLanes
    };
  }

  function dataFor(model) {
    const { id, state, route, draft } = model;
    const language = draft?.language === "th" ? "th" : "en";
    const facts = factsOf(model);
    const types = draft ? inferWorkTypes(draft).filter((type) => TYPE_SURFACES[type]) : [];
    const coverage = draft ? coverageReport(draft, { workTypes: types }) : null;
    const sync = syncStatus(state.prototypeSync, { previewsDir, id, draft: draft || {}, facts });
    const scratch = isObject(draft?.scratch) ? draft.scratch : {};
    const { undo, who } = undoWho(draft);
    const checklist = draft ? devDocumentChecklist(draft) : [];
    return {
      change: id,
      revision: facts.revision,
      language,
      legacy: model.legacy,
      intent: show(draft?.intent) || model.proposal || null,
      risk: { level: route.level, step: RISK_STEP[route.level] || 1, reasons: route.reasons },
      domains: route.domains,
      roles: route.roles,
      artifacts: model.artifacts.map((row) => ({
        id: row.id, label: row.label, domains: row.domains, roles: row.roles,
        evidence: row.evidence, source: row.source ?? null, ref: row.ref ?? null
      })),
      approval: { approved: model.approval.approved, missingLanes: model.approval.missingLanes },
      scratch: {
        ...Object.fromEntries(SCRATCH_LINES.map((key) => [key, show(scratch[key])])),
        undo: undo ? { value: undo.value, source: undo.source } : null,
        who: who ? { value: who.value, source: who.source } : null
      },
      scope: scopeCounts(draft),
      openQuestions: openQuestions(draft),
      failures: failureRows(draft),
      requiredSections: checklist.map((row) => ({ key: row.key, present: row.present, missingFields: row.missingFields || [] })),
      diagrams: model.diagrams,
      suggestions: model.suggestions,
      results: model.results,
      prototype: {
        // The page the draft names, if any; the skill writes it, the harness never does.
        page: sync.path ? { path: sync.path, status: sync.file } : null,
        checklist: coverage,
        sync
      },
      facts,
      factsDigest: factsDigest(facts),
      warnings: [...route.warnings, ...model.notices, ...syncWarnings(sync)]
    };
  }

  function packageData(id) {
    return dataFor(buildModel(id));
  }

  function showPackage(id, flags = {}) {
    const data = packageData(id);
    console.log(JSON.stringify(data, null, flags.pretty ? 2 : undefined));
    return data;
  }

  // The approval question's view of the page: the file the skill wrote, with
  // its advisory warnings, or the four summary lines when there is no page yet.
  // Never fails the question.
  function approvalPageLink(id) {
    try {
      const model = buildModel(id);
      const data = dataFor(model);
      const page = data.prototype.page;
      if (page?.status === "ok") {
        return { path: relative(root, join(previewsDir, id, page.path)), language: data.language,
          warnings: syncWarnings(data.prototype.sync) };
      }
      const summary = SCRATCH_LINES.map((key) => data.scratch[key]).filter(Boolean);
      return { missing: true, language: data.language, summary };
    } catch (error) {
      return { error: error?.message || String(error) };
    }
  }

  // Called at start, revise, and amend: remember the page and facts digests so
  // a later edit or a change of facts shows up as an advisory warning.
  function recordPrototypeSync(id) {
    const model = buildModel(id);
    const snapshot = snapshotFor({
      previewsDir, id, draft: model.draft || {}, facts: factsOf(model), revision: model.state.contractRevision
    });
    const state = loadRuntime(id);
    state.prototypeSync = snapshot;
    saveRuntime(state);
    return snapshot;
  }

  return { buildModel, packageData, showPackage, approvalPageLink, recordPrototypeSync };
}
