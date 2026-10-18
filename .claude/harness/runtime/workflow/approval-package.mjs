import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { APPROVAL_ROLES, routeChange } from "../contracts/scratch-router.mjs";
import { esc, packageText, renderExample } from "./scratch-blocks.mjs";

// The harness ships Mermaid once; a package loads it by relative path.
export const MERMAID_VENDOR = fileURLToPath(new URL("../../vendor/mermaid.min.js", import.meta.url));

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

// A link the page may follow: an existing regular file whose real path stays
// inside `base`, written relative to the packages folder. Anything else is null.
export function confinedHref(packagesDir, base, path) {
  const value = String(path ?? "").trim();
  if (!value || isAbsolute(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  let real;
  let realBase;
  try {
    real = realpathSync(resolve(base, value));
    realBase = realpathSync(base);
  } catch { return null; }
  if (real !== realBase && !real.startsWith(realBase + sep)) return null;
  try { if (!statSync(real).isFile()) return null; } catch { return null; }
  return relative(realFolder(packagesDir), real).split(sep).map(encodeURIComponent).join("/");
}

// The real path of a folder that may not exist yet: its nearest existing
// ancestor resolved, plus the missing tail, so links match realpath'd targets.
function realFolder(dir) {
  const missing = [];
  let current = resolve(dir);
  while (!existsSync(current)) {
    const parent = resolve(current, "..");
    if (parent === current) return resolve(dir);
    missing.unshift(current.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    current = parent;
  }
  return join(realpathSync(current), ...missing);
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
// Content renderers take the page text so table headers follow the language.
const tableIn = (t) => (headers, rows) => rows.length
  ? `<div class="content"><table><thead><tr>${headers.map((h) => `<th scope="col">${esc(t.head?.[h] || h)}</th>`).join("")}</tr></thead><tbody>${
    rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(plain(cell))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
  : "";
const scenarioRows = (draft, keep = () => true) => list(draft?.requirements).flatMap((requirement) =>
  list(requirement.scenarios).filter(keep).map((scenario) => ({ requirement, scenario })));

function contentFor(t) {
  const table = tableIn(t);
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
  const matchingFailures = (pattern) => (draft) => {
    const rows = scenarioRows(draft, (scenario) => scenario.kind === "failure" &&
      pattern.test([scenario.name, scenario.given, scenario.when, scenario.then].join(" ")));
    if (!rows.length) return scenarioRows(draft, (scenario) => scenario.kind === "failure").length
      ? `<p class="undeclared">${esc(t.noFailure)}</p>` : "";
    return table(["Failure", "User sees", "Recovery"],
      rows.map(({ scenario }) => [scenario.when, scenario.then, scenario.recovery]));
  };
  CONTENT.concur = matchingFailures(CONCURRENCY);
  CONTENT.retry = matchingFailures(RETRY);
  return CONTENT;
}
const CONCURRENCY = /พร้อมกัน|concurren|simultan|double|twice|ซ้ำ|race|parallel|idempot/i;
const RETRY = /retry|ลองใหม่|timeout|time out|หมดเวลา|dead.?letter|dlq|backoff|ซ้ำ/i;

export function artifactContent(id, draft, t = packageText("en")) {
  if (!draft) return "";
  const render = contentFor(t)[id];
  if (!render) return "";
  const html = render(draft);
  return html || `<p class="undeclared">${esc(t.undeclared)}</p>`;
}

// A preview's observed result, labeled as preview so it never reads as proof.
export function previewOutput(preview, t = packageText("en")) {
  if (!preview) return "";
  return `<div class="preview-run"><p>${esc(t.previewWord)} <code>${esc(preview.provider)}</code>: ` +
    `<span class="label label-${preview.stale ? "stale" : "preview"}">${esc(preview.status)}${preview.stale ? ", stale" : ""}</span> ` +
    `${esc(t.previewOnly)}</p>` +
    (preview.artifact ? `<p><a href="../previews/${encodeURIComponent(preview.changeId || "")}/${
      String(preview.artifact).split("/").map(encodeURIComponent).join("/")}">${esc(t.openPreview)}</a></p>` : "") +
    `${preview.outputTail ? `<pre>${esc(preview.outputTail)}</pre>` : ""}</div>`;
}

// The after-Build view of one example: a valid passing receipt is proof, a
// failing receipt says so, a preview stays a preview, and nothing found says
// what Build will be compared against.
function exampleActual(example, model, t) {
  const capability = typeof example.capability === "string" ? example.capability.trim() : "";
  const result = capability ? (model.results || []).find((row) => row.capability === capability) : null;
  const preview = capability ? (model.previews || []).find((row) => row.capability === capability) : null;
  const links = (hrefs) => hrefs.filter(Boolean).map((href) =>
    `<p><a href="${esc(href)}">${esc(t.openArtifact)}</a> <code>${esc(decodeURIComponent(href.split("/").pop()))}</code></p>`).join("");
  let state = "none";
  let body = "";
  if (result?.status === "pass" && result.valid) {
    state = "proof";
    body = `<p>${esc(result.provider)}: pass</p>${links(result.hrefs)}`;
  } else if (result?.status === "fail") {
    state = "fail";
    body = `<p>${esc(result.provider)}: fail</p>${links(result.hrefs)}`;
  } else if (preview) {
    state = preview.stale ? "stale" : "preview";
    body = `<p>${esc(preview.provider)}: ${esc(preview.status)}</p>${links([preview.href])}` +
      (preview.outputTail ? `<pre>${esc(preview.outputTail)}</pre>` : "");
  } else {
    body = `<p>${esc(t.noResult)}</p>` + (example.postBuild ? `<p class="muted">${esc(t.willCompare)} ${esc(example.postBuild)}</p>` : "");
  }
  return `<p><span class="label label-${state}">${esc(t[state])}</span></p>${body}`;
}

function exampleSection(example, index, model, t) {
  const name = `ex${index}`;
  return `<section class="block" id="example-${index}"><div class="block-h"><h3>${esc(example.title)}</h3>` +
    (example.why ? `<p class="muted small">${esc(example.why)}</p>` : "") + `</div>` +
    `<div class="tabs"><input type="radio" class="sr" id="${name}-a" name="${name}" checked><label for="${name}-a">${esc(t.agreed)}</label>` +
    `<input type="radio" class="sr" id="${name}-r" name="${name}"><label for="${name}-r">${esc(t.actual)}</label>` +
    `<div class="panel p1">${renderExample(example, t, { prototypeHref: model.prototypeHref })}</div>` +
    `<div class="panel p2">${exampleActual(example, model, t)}</div></div></section>`;
}

function heroSection(model, t) {
  const scratch = model.draft?.scratch && typeof model.draft.scratch === "object" ? model.draft.scratch : {};
  const line = (key) => typeof scratch[key] === "string" && scratch[key].trim() ? scratch[key].trim() : "";
  const any = ["get", "asIs", "toBe", "ifFail"].some((key) => line(key));
  if (!any) return `<section class="hero" id="scratch"><p class="q-get"><b>${esc(t.get)}</b>${esc(model.state.intent || model.id)}</p>` +
    `<p class="muted small">${esc(t.noSummary)}</p></section>`;
  return `<section class="hero" id="scratch">` +
    (line("get") ? `<p class="q q-get"><b>${esc(t.get)}</b>${esc(line("get"))}</p>` : "") +
    (line("asIs") || line("toBe") ? `<div class="q q-change"><b>${esc(t.change)}</b><p class="asis"><span>${esc(t.before)}: ${esc(line("asIs"))}</span>` +
      `<span aria-hidden="true">→</span><span>${esc(t.after)}: ${esc(line("toBe"))}</span></p></div>` : "") +
    (line("ifFail") ? `<p class="q q-fail"><b>${esc(t.ifFail)}</b>${esc(line("ifFail"))}</p>` : "") + `</section>`;
}

export function renderApprovalPackage(model) {
  const { id, state, route, draft, diagrams, artifacts, suggestions, legacy, proposal } = model;
  const t = packageText(draft?.language);
  const examples = Array.isArray(draft?.examples) ? draft.examples.filter((row) => row && typeof row === "object") : [];
  const evidenceText = { proof: t.proof, preview: t.preview, stale: t.stale, none: t.noEvidence };
  const artifactName = (row) => t.artifactNames?.[row.id] || row.label;
  const roleSections = APPROVAL_ROLES.map((role) => {
    const mine = artifacts.filter((row) => row.roles.includes(role));
    const body = mine.length
      ? `<table><thead><tr><th scope="col">${esc(t.artifactCol)}</th><th scope="col">${esc(t.domainsCol)}</th><th scope="col">${esc(t.evidenceCol)}</th></tr></thead><tbody>${
        mine.map((row) => `<tr><td>${esc(artifactName(row))}</td><td>${esc(row.domains.join(", ") || t.allChanges)}</td>` +
          `<td><span class="label label-${row.evidence}">${esc(evidenceText[row.evidence] || LABEL_TEXT[row.evidence])}</span></td></tr>`).join("")
      }</tbody></table>`
      : `<p>${esc(t.noRole)}</p>`;
    const details = mine.map((row) => {
      const content = artifactContent(row.id, draft, t) + previewOutput(row.preview, t);
      return content ? `<details class="artifact" open><summary>${esc(artifactName(row))}</summary>${content}</details>` : "";
    }).join("");
    return `<section class="role" id="role-${role}"><h3>${esc(ROLE_LABELS[role])}</h3>${body}${details}</section>`;
  }).join("\n");
  const diagramBlocks = diagrams.length
    ? diagrams.map((row) => `<figure><figcaption>${esc(row.purpose || row.key)}</figcaption>` +
      `<pre class="mermaid">${esc(row.source)}</pre></figure>`).join("\n")
    : `<p>${esc(t.noDiagrams)}</p>`;
  const needsMermaid = diagrams.length > 0 || examples.some((row) => row.type === "mermaid");
  const mermaid = needsMermaid && model.mermaidHref ? `<script src="${esc(model.mermaidHref)}"></script>` : "";
  const exampleBlocks = examples.length
    ? `<section id="examples"><h2>${esc(t.examples)}</h2>${examples.map((row, index) => exampleSection(row, index, model, t)).join("\n")}</section>` : "";
  const suggestionBlock = suggestions.length
    ? `<section id="preview-suggestions"><h2>${esc(t.suggestions)}</h2><p>${esc(t.suggestionsNote)}</p><ul>${
      suggestions.map((row) => `<li><strong>${esc(row.artifact)}</strong> (${esc(t.capabilityWord)} <code>${esc(row.capability)}</code>): ${
        row.providers.length
          ? row.providers.map((provider) => `<code>${esc(provider.command)}</code>${provider.external
            ? ` <span class="label label-none">${esc(t.externalRef)}</span>` : ""}`).join("; ")
          : `${esc(t.noProvider)} <code>${esc(row.capability)}</code> ${esc(t.noProviderTail)}`
      }</li>`).join("")}</ul></section>`
    : "";
  const allWarnings = [...route.warnings, ...(model.notices || [])];
  const warnings = allWarnings.length
    ? `<ul class="warnings">${allWarnings.map((text) => `<li>${esc(text)}</li>`).join("")}</ul>` : "";
  return `<!doctype html>
<html lang="${esc(t === packageText("th") ? "th" : draft?.language || "en")}">
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
.muted { color: var(--muted); } .small { font-size: .88em; } p { margin: 0 0 4px; } code, pre { overflow-wrap: anywhere; }
.hero { display: grid; gap: 8px; }
.q { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin: 0; }
.q b, .q-get b { display: block; font-size: .82em; color: var(--muted); }
.q-get { border-left: 4px solid var(--accent); } .q-change { border-left: 4px solid var(--ok); } .q-fail { border-left: 4px solid var(--warn); }
.asis { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0; } .asis span { min-width: 0; }
.block { border: 1px solid var(--line); border-radius: 10px; padding: 12px; display: grid; gap: 8px; margin-bottom: 12px; min-width: 0; }
.block-h h3 { margin: 0; }
.tabs { display: grid; grid-template-columns: auto auto 1fr; gap: 8px; align-items: center; }
.tabs > label { border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; cursor: pointer; font-size: .9em; }
.tabs > input:checked + label { border-color: var(--fg); font-weight: 600; }
.tabs > input:focus-visible + label { outline: 2px solid var(--accent); outline-offset: 2px; }
.tabs > .panel { grid-column: 1 / -1; display: none; gap: 8px; min-width: 0; }
.tabs > input:nth-of-type(1):checked ~ .p1, .tabs > input:nth-of-type(2):checked ~ .p2 { display: grid; }
.sr { position: absolute; width: 1px; height: 1px; opacity: 0; }
.scroll { overflow-x: auto; } .box { border: 1px solid var(--line); border-radius: 8px; min-width: 0; }
.box-h { margin: 0; padding: 4px 8px; border-bottom: 1px solid var(--line); font-size: .82em; color: var(--muted); }
.box pre, .stp pre, .term, .doc pre { margin: 0; padding: 8px; white-space: pre-wrap; font-size: .85em; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }
.cards { display: grid; gap: 8px; }
.ex, .opt { border: 1px solid var(--line); border-left: 4px solid var(--k, var(--ok)); border-radius: 8px; padding: 8px 10px; min-width: 0; }
.k-boundary { --k: var(--accent); } .k-failure { --k: #c4372c; } .k-success { --k: var(--ok); }
.ex-h { display: flex; justify-content: space-between; gap: 8px; } .ex-h span { font-size: .8em; color: var(--k); font-weight: 600; }
.l { display: inline-block; min-width: 3.5em; color: var(--muted); font-size: .85em; }
.rule { font-weight: 600; color: var(--accent); }
.ep { display: grid; gap: 6px; } .method { font-weight: 700; color: var(--accent); }
.chip { border: 1px solid var(--line); border-radius: 999px; padding: 0 8px; font-size: .8em; }
.case summary { cursor: pointer; } .status { font-weight: 700; } .s2 { color: var(--ok); } .s4, .s5 { color: #c4372c; }
.add { color: var(--ok); } .chg { color: var(--warn); } .del { color: #c4372c; text-decoration: line-through; }
.yes { color: var(--ok); font-weight: 600; } .no { color: #c4372c; font-weight: 600; } .warn { color: var(--warn); }
.plan { list-style: none; margin: 0; padding: 0; font-family: ui-monospace, monospace; font-size: .85em; }
.tl { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.tl li { display: grid; grid-template-columns: 70px 10px 1fr; gap: 8px; } .tl-t { color: var(--muted); font-size: .85em; text-align: right; }
.tl-d { width: 10px; height: 10px; border-radius: 50%; background: var(--k, var(--accent)); margin-top: 6px; }
.st { font-size: .8em; border: 1px solid currentColor; border-radius: 4px; padding: 0 6px; }
.bars { display: grid; gap: 4px; } .bar-row { display: grid; grid-template-columns: 110px 1fr 80px; gap: 8px; align-items: center; font-size: .88em; }
.track { height: 10px; border: 1px solid var(--line); border-radius: 5px; overflow: hidden; } .fill { display: block; height: 100%; }
.fill.now { background: #c4372c; } .fill.target { background: var(--ok); }
.kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
.kpi { border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; } .kpi b { display: block; font-size: 1.15em; }
.push, .msg, .doc, .stp { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
.cta { border: 1px solid var(--accent); color: var(--accent); border-radius: 6px; padding: 2px 10px; }
.term { background: #0d1117; color: #d6deeb; border-radius: 8px; } .t-p { color: #7fdbca; } .t-e { color: #ff8f86; } .t-o { color: #c5e478; }
.pipe span { border: 1px solid var(--line); border-radius: 6px; padding: 0 8px; } .lin .arrow { text-align: center; color: var(--muted); }
.frame { width: 100%; height: 560px; border: 1px solid var(--line); border-radius: 8px; }
.label-fail { color: #c4372c; }
</style>
</head>
<body>
<main>
<header>
<h1>${esc(id)}</h1>
<p>${esc(t.risk)} <strong>${esc(route.level)}</strong> · ${esc(t.intent)} ${esc(route.intents.join(", "))} · ${esc(t.revision)} ${esc(state.contractRevision || 0)}</p>
<p class="notice">${esc(t.readOnly)}</p>
${legacy ? `<p class="notice">${esc(t.legacy)}</p>` : ""}
${warnings}
</header>
${heroSection(model, t)}
${exampleBlocks}
<section id="summary"><h2>${esc(t.summary)}</h2><p>${esc(proposal || state.intent || "")}</p>
<p>${esc(t.packet)} <code>openspec/changes/${esc(id)}/</code></p></section>
<section id="domains"><h2>${esc(t.domains)}</h2><ul>${
  route.domains.map((row) => `<li>${esc(row.id)}. ${esc(row.name)}</li>`).join("") || `<li>${esc(t.noDomain)}</li>`}</ul>
<p><small>${esc(route.reasons.join(" · "))}</small></p></section>
<details id="roles"${examples.length ? "" : " open"}><summary><h2 style="display:inline">${esc(t.roles)}</h2></summary>
${roleSections}
</details>
${suggestionBlock}
<section id="diagrams"><h2>${esc(t.diagrams)}</h2>
${diagramBlocks}
</section>
</main>
${mermaid}
</body>
</html>
`;
}

// Relative path from the packages folder to a harness file; null when no
// relative form exists (for example, another drive).
function vendorHref(packagesDir, file) {
  const path = relative(realFolder(packagesDir), realpathSync(file));
  if (!path || isAbsolute(path)) return null;
  return path.split(sep).map(encodeURIComponent).join("/");
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
    // Per-capability outcome for the after-Build tab of each example. Artifact
    // links are confined to this change's evidence folder.
    const results = [];
    const evidenceBase = join(root, ".foundation", "evidence", id);
    const record = (provider, receipt, valid) => {
      if (!provider.capability || !receipt || receipt.kind === "preview") return;
      const hrefs = (Array.isArray(receipt.artifacts) ? receipt.artifacts : [])
        .map((artifact) => confinedHref(packagesDir, evidenceBase, relative(evidenceBase, resolve(root, String(artifact?.path || "")))));
      results.push({ capability: provider.capability, provider: provider.name, status: receipt.status, valid, hrefs });
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
    const previewBase = join(previewsDir, id);
    const previews = previewReceipts(previewsDir, id, state.contractRevision)
      .map((row) => ({ ...row, href: row.artifact ? confinedHref(packagesDir, previewBase, row.artifact) : null }));
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
      notices,
      results,
      previews,
      prototypeHref: (path) => confinedHref(packagesDir, previewBase, path),
      mermaidHref: existsSync(MERMAID_VENDOR) ? vendorHref(packagesDir, MERMAID_VENDOR) : null
    };
  }

  function writePackage(id) {
    const model = buildModel(id);
    // Links are relative to the packages folder, so it exists before rendering.
    mkdirSync(packagesDir, { recursive: true });
    const html = renderApprovalPackage({ ...model, mermaidHref: existsSync(MERMAID_VENDOR) ? vendorHref(packagesDir, MERMAID_VENDOR) : null });
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
