import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { APPROVAL_ROLES, routeChange } from "../contracts/scratch-router.mjs";

// Approval package: a read-only HTML projection of a compiled change for the
// people who approve it. It reads state, the packet, receipts, and preview
// receipts, and writes only `.foundation/packages/<id>.html`. A label of
// `proof` requires a valid passing receipt; everything else stays a preview
// or design statement so the page never presents unverified work as proven.

const ROLE_LABELS = Object.freeze({
  "product-owner": "Product Owner", "tech-lead": "Tech Lead", qa: "QA",
  devops: "DevOps", security: "Security"
});
const LABEL_TEXT = Object.freeze({
  proof: "proof", preview: "preview", stale: "preview (stale)", none: "no evidence yet"
});

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
  return routeChange({
    workTypes, riskSignals: state?.riskSignals,
    impact: state?.impact, coupling: state?.coupling,
    integrations: draft?.integrations, securityTriggers: state?.securityTriggers, paths
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

// Agreement content behind each artifact, from the current typed draft. Every
// value is escaped; an artifact the agreement does not declare says so.
const list = (value) => Array.isArray(value) ? value : [];
const plain = (value) => value === undefined || value === null ? ""
  : typeof value === "string" ? value : JSON.stringify(value);
const table = (headers, rows) => rows.length
  ? `<div class="content"><table><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${
    rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(plain(cell))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
  : "";
const scenarioRows = (draft, keep = () => true) => list(draft?.requirements).flatMap((requirement) =>
  list(requirement.scenarios).filter(keep).map((scenario) => ({ requirement, scenario })));

const CONTENT = {
  testmap: (draft) => table(["Requirement", "Scenario", "Kind", "Given", "When", "Then"],
    scenarioRows(draft).map(({ requirement, scenario }) => [requirement.key || requirement.description,
      scenario.name, scenario.kind, scenario.given, scenario.when,
      [scenario.then, ...list(scenario.and)].filter(Boolean).join("; ")])),
  impact: (draft) => table(["Task", "Outcome", "Files"],
    list(draft?.tasks).map((task) => [task.key, task.outcome, list(task.paths).join(", ")])),
  flow: (draft) => [
    table(["Priority", "As a", "I want", "So that"],
      list(draft?.userStories).map((story) => [story.priority, story.asA, story.iWant, story.soThat])),
    table(["Success criteria"], list(draft?.successCriteria).map((row) => [row])),
    table(["Non-goals"], list(draft?.nonGoals).map((row) => [row]))
  ].join(""),
  api: (draft) => table(["Method", "Path", "Auth", "Request", "Response", "Errors"],
    list(draft?.apiContracts).map((row) => [row.method, row.path, row.auth, row.request, row.response,
      list(row.errors).map((error) => `${error.status}: ${error.when}`).join("; ")])),
  erd: (draft) => {
    const model = draft?.dataModel;
    const entities = Array.isArray(model) ? model : list(model?.entities);
    return table(["Entity", "Fields", "Migration"], entities.map((row) => [row.entity || row.name,
      list(row.fields || row.columns).map(plain).join(", "), row.migration || model?.migration]));
  },
  perm: (draft) => table(["Access", "Scenario", "When", "Then"],
    scenarioRows(draft, (scenario) => scenario.access).map(({ scenario }) =>
      [scenario.access, scenario.name, scenario.when, scenario.then])),
  ui: (draft) => table(["Screen", "States", "Accessibility"], list(draft?.uiStates).map((row) => [row.screen,
    list(row.states).map((state) => `${state.state}: ${state.shows}`).join("; "), row.accessibility])),
  state: (draft) => table(["Job", "States", "Retry", "Timeout", "Idempotency"], list(draft?.jobContract)
    .map((row) => [row.key, list(row.states).join(" → "), row.retry, row.timeout, row.idempotency])),
  config: (draft) => table(["Key", "Default", "Validation"],
    list(draft?.configContract).map((row) => [row.key, row.default, row.validation])),
  repro: (draft) => draft?.bugfix ? table(["Reproduction", "Root cause", "Regression"],
    [[draft.bugfix.reproduction, draft.bugfix.rootCause, draft.bugfix.regression]]) : "",
  equiv: (draft) => draft?.refactor ? table(["Invariants", "Characterization"],
    [[draft.refactor.invariants, draft.refactor.characterization]]) : "",
  integ: (draft) => table(["Integration", "Detail"], list(draft?.integrations).map((row) => [row.name || row.key, row])),
  ledger: (draft) => [
    table(["Decision", "Reason"], list(draft?.decisions).map((row) => [row.choice, row.reason])),
    CONTENT.failures(draft)
  ].join(""),
  failures: (draft) => table(["Failure", "User sees", "Recovery"],
    scenarioRows(draft, (scenario) => scenario.kind === "failure").map(({ scenario }) =>
      [scenario.when, scenario.then, scenario.recovery]))
};
CONTENT.timeline = CONTENT.state;
// Concurrency and retry artifacts show only the failures about them.
const CONCURRENCY = /พร้อมกัน|concurren|simultan|double|twice|ซ้ำ|race|parallel|idempot/i;
const RETRY = /retry|ลองใหม่|timeout|time out|หมดเวลา|dead.?letter|dlq|backoff|ซ้ำ/i;
const matchingFailures = (pattern) => (draft) => {
  const rows = scenarioRows(draft, (scenario) => scenario.kind === "failure" &&
    pattern.test([scenario.name, scenario.given, scenario.when, scenario.then].join(" ")));
  if (!rows.length) return scenarioRows(draft, (scenario) => scenario.kind === "failure").length
    ? "<p class=\"undeclared\">No failure scenario in the agreement concerns this.</p>" : "";
  return table(["Failure", "User sees", "Recovery"],
    rows.map(({ scenario }) => [scenario.when, scenario.then, scenario.recovery]));
};
CONTENT.concur = matchingFailures(CONCURRENCY);
CONTENT.retry = matchingFailures(RETRY);

export function artifactContent(id, draft) {
  if (!draft) return "";
  const render = CONTENT[id];
  if (!render) return "";
  const html = render(draft);
  return html || "<p class=\"undeclared\">Not declared in the agreement.</p>";
}

// A preview's observed result, labeled as preview so it never reads as proof.
export function previewOutput(preview) {
  if (!preview) return "";
  return `<div class="preview-run"><p>Preview <code>${esc(preview.provider)}</code>: ` +
    `<span class="label label-${preview.stale ? "stale" : "preview"}">${esc(preview.status)}${preview.stale ? ", stale" : ""}</span> ` +
    `(preview only; never proof)</p>` +
    (preview.artifact ? `<p><a href="../previews/${encodeURIComponent(preview.changeId || "")}/${
      String(preview.artifact).split("/").map(encodeURIComponent).join("/")}">Open the preview artifact</a></p>` : "") +
    `${preview.outputTail ? `<pre>${esc(preview.outputTail)}</pre>` : ""}</div>`;
}

export function renderApprovalPackage(model) {
  const { id, state, route, draft, diagrams, artifacts, suggestions, legacy, proposal } = model;
  const roleSections = APPROVAL_ROLES.map((role) => {
    const mine = artifacts.filter((row) => row.roles.includes(role));
    const body = mine.length
      ? `<table><thead><tr><th scope="col">Artifact</th><th scope="col">Domains</th><th scope="col">Evidence</th></tr></thead><tbody>${
        mine.map((row) => `<tr><td>${esc(row.label)}</td><td>${esc(row.domains.join(", ") || "all changes")}</td>` +
          `<td><span class="label label-${row.evidence}">${esc(LABEL_TEXT[row.evidence])}</span></td></tr>`).join("")
      }</tbody></table>`
      : "<p>No approval needed from this role for this change.</p>";
    const details = mine.map((row) => {
      const content = artifactContent(row.id, draft) + previewOutput(row.preview);
      return content ? `<details class="artifact" open><summary>${esc(row.label)}</summary>${content}</details>` : "";
    }).join("");
    return `<section class="role" id="role-${role}"><h3>${esc(ROLE_LABELS[role])}</h3>${body}${details}</section>`;
  }).join("\n");
  const diagramBlocks = diagrams.length
    ? diagrams.map((row) => `<figure><figcaption>${esc(row.purpose || row.key)}</figcaption>` +
      `<pre class="mermaid">${esc(row.source)}</pre></figure>`).join("\n")
    : "<p>This change declares no diagrams.</p>";
  const suggestionBlock = suggestions.length
    ? `<section id="preview-suggestions"><h2>Suggested previews</h2><p>Optional. A suggestion never blocks approval or Build.</p><ul>${
      suggestions.map((row) => `<li><strong>${esc(row.artifact)}</strong> (capability <code>${esc(row.capability)}</code>): ${
        row.providers.length
          ? row.providers.map((provider) => `<code>${esc(provider.command)}</code>${provider.external
            ? " <span class=\"label label-none\">external: needs a decision-ref</span>" : ""}`).join("; ")
          : `no provider yet; declare a provider with capability <code>${esc(row.capability)}</code> in evidence.yaml`
      }</li>`).join("")}</ul></section>`
    : "";
  const allWarnings = [...route.warnings, ...(model.notices || [])];
  const warnings = allWarnings.length
    ? `<ul class="warnings">${allWarnings.map((text) => `<li>${esc(text)}</li>`).join("")}</ul>` : "";
  return `<!doctype html>
<html lang="${esc(draft?.language || "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(id)} approval package</title>
<style>
:root { --bg: #f6f7f9; --fg: #17212b; --muted: #5a6876; --line: #d5dce3; --accent: #1f5f8b; --ok: #2e7d4f; --warn: #9a6400; }
@media (prefers-color-scheme: dark) { :root { --bg: #11171d; --fg: #e4eaf0; --muted: #94a3b2; --line: #2a3644; --accent: #6fb0dd; --ok: #6cc596; --warn: #e8b052; color-scheme: dark; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 system-ui, sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 48px; display: grid; gap: 24px; }
h1, h2, h3 { line-height: 1.25; margin: 0 0 8px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
.label { font-size: .8em; padding: 1px 8px; border-radius: 4px; border: 1px solid currentColor; white-space: nowrap; }
.label-proof { color: var(--ok); } .label-preview, .label-stale { color: var(--warn); } .label-none { color: var(--muted); }
.notice { border: 1px dashed var(--warn); padding: 8px 12px; border-radius: 6px; }
pre.mermaid { overflow-x: auto; background: transparent; border: 1px solid var(--line); padding: 8px; }
.role { border: 1px solid var(--line); border-radius: 8px; padding: 12px; display: grid; gap: 10px; }
.artifact summary { font-weight: 600; cursor: pointer; }
.content { overflow-x: auto; margin-top: 6px; }
.content table { font-size: .9em; }
.undeclared { color: var(--muted); font-style: italic; margin: 6px 0 0; }
.preview-run { border-left: 3px solid var(--warn); padding-left: 10px; margin-top: 8px; }
.preview-run pre { overflow-x: auto; white-space: pre-wrap; font-size: .85em; margin: 4px 0 0; }
</style>
</head>
<body>
<main>
<header>
<h1>${esc(id)}</h1>
<p>Risk level <strong>${esc(route.level)}</strong> · intent ${esc(route.intents.join(", "))} · contract revision ${esc(state.contractRevision || 0)}</p>
<p class="notice">Read-only projection. Only labels marked proof come from a valid passing receipt; previews and design statements are not proof.</p>
${legacy ? "<p class=\"notice\">This change has no typed draft for its current revision, so the package shows packet information only and its detail is limited.</p>" : ""}
${warnings}
</header>
<section id="summary"><h2>Summary</h2><p>${esc(proposal || state.intent || "")}</p>
<p>Packet: <code>openspec/changes/${esc(id)}/</code></p></section>
<section id="domains"><h2>Technical domains</h2><ul>${
  route.domains.map((row) => `<li>${esc(row.id)}. ${esc(row.name)}</li>`).join("") || "<li>No specific domain.</li>"}</ul>
<p><small>${esc(route.reasons.join(" · "))}</small></p></section>
<section id="roles"><h2>By approver role</h2>
${roleSections}
</section>
${suggestionBlock}
<section id="diagrams"><h2>Diagrams</h2>
${diagramBlocks}
</section>
</main>
</body>
</html>
`;
}

function proposalSummary(path) {
  if (!existsSync(path)) return "";
  const text = readFileSync(path, "utf8");
  const match = text.match(/^## (?:Summary|สรุป)\s*\n+([\s\S]*?)(?=\n## |$)/m);
  return (match ? match[1] : "").trim();
}

export function createApprovalPackageRuntime({
  root, runtimeDir, packagesDir, previewsDir, receiptsDir, loadRuntime, activeChangePath,
  changeWorkTypes, evidence, providerCapability, receiptValidity, fail,
  // Runs a harness call so its failure throws instead of exiting the process;
  // the package is a reading aid and survives broken evidence wiring.
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
    // After Land the sandbox is gone, so a workspace-bound validity check can
    // only fail; the receipts Land accepted are the record of proof.
    const landed = ["archived", "applied"].includes(state.status) && state.land?.assurance?.status === "passed";
    for (const provider of landed ? providers : []) {
      try {
        const receipt = JSON.parse(readFileSync(join(receiptsDir, id, `${provider.name}.json`), "utf8"));
        if (receipt?.status === "pass" && receipt.kind !== "preview" && provider.capability) proven.add(provider.capability);
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
    }
    const previews = previewReceipts(previewsDir, id, state.contractRevision);
    const capabilityOf = (row) => row.id === "testmap" ? "test" : row.source === "provider" ? row.ref : null;
    const artifacts = route.artifacts.map((row) => ({
      ...row, evidence: artifactLabel(capabilityOf(row), { proven, previews }),
      preview: capabilityOf(row) ? previews.find((preview) => preview.capability === capabilityOf(row)) || null : null
    }));
    return {
      id, state, route, draft, artifacts,
      diagrams: draftDiagrams(draft),
      suggestions: previewSuggestions(route, suggestable, id),
      legacy: !draft,
      proposal: proposalSummary(join(packet, "proposal.md")),
      notices
    };
  }

  function writePackage(id) {
    const model = buildModel(id);
    const html = renderApprovalPackage(model);
    mkdirSync(packagesDir, { recursive: true });
    const path = join(packagesDir, `${id}.html`);
    const temporary = `${path}.tmp-${process.pid}`;
    writeFileSync(temporary, html);
    renameSync(temporary, path);
    return { path: relative(root, path), level: model.route.level, roles: model.route.roles,
      suggestions: model.suggestions.length, warnings: [...model.route.warnings, ...model.notices] };
  }

  function showPackage(id, flags = {}) {
    const result = writePackage(id);
    if (flags.pretty) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`PACKAGE ${id}`);
      console.log(`  file: ${result.path}`);
      console.log(`  risk: ${result.level}`);
      console.log(`  roles: ${result.roles.join(", ") || "none"}`);
      if (result.suggestions) console.log(`  suggested previews: ${result.suggestions}`);
      for (const warning of result.warnings) console.log(`  warning: ${warning}`);
    }
    return result;
  }

  // Approval output links the package but never fails because of it.
  function tryWritePackage(id) {
    try { return { path: writePackage(id).path }; }
    catch (error) { return { error: error?.message || String(error) }; }
  }

  return { buildModel, writePackage, showPackage, tryWritePackage };
}
