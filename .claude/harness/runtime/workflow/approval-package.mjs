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
  return routeChange({
    workTypes, riskSignals: state?.riskSignals,
    impact: state?.impact, coupling: state?.coupling,
    integrations: draft?.integrations, securityTriggers: state?.securityTriggers
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
    return `<section class="role" id="role-${role}"><h3>${esc(ROLE_LABELS[role])}</h3>${body}</section>`;
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
  const warnings = route.warnings.length
    ? `<ul class="warnings">${route.warnings.map((text) => `<li>${esc(text)}</li>`).join("")}</ul>` : "";
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
.role { border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
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
  root, runtimeDir, packagesDir, previewsDir, loadRuntime, activeChangePath,
  changeWorkTypes, evidence, providerCapability, receiptValidity, fail
}) {
  function buildModel(id) {
    if (!existsSync(join(runtimeDir, `${id}.json`))) fail(`package: unknown change '${id}'`);
    const state = loadRuntime(id);
    const packet = activeChangePath(id, state);
    const draft = currentDraft(state);
    const route = routeForState(state, draft ? [] : changeWorkTypes(packet));
    let configured = {};
    try { configured = evidence(id).providers || {}; } catch { configured = {}; }
    const providers = Object.entries(configured).map(([name, config]) => ({
      name, capability: providerCapability(name, config), external: config?.external === true
    }));
    const proven = new Set();
    for (const provider of providers) {
      let result = null;
      try { result = receiptValidity(id, provider.name); } catch { result = null; }
      // Harness receipts record pass|fail|inconclusive|error.
      if (result?.validity === "valid" && result.receipt?.status === "pass" && provider.capability)
        proven.add(provider.capability);
    }
    const previews = previewReceipts(previewsDir, id, state.contractRevision);
    const capabilityOf = (row) => row.id === "testmap" ? "test" : row.source === "provider" ? row.ref : null;
    const artifacts = route.artifacts.map((row) => ({
      ...row, evidence: artifactLabel(capabilityOf(row), { proven, previews })
    }));
    return {
      id, state, route, draft, artifacts,
      diagrams: draftDiagrams(draft),
      suggestions: previewSuggestions(route, providers, id),
      legacy: !draft,
      proposal: proposalSummary(join(packet, "proposal.md"))
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
      suggestions: model.suggestions.length, warnings: model.route.warnings };
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
