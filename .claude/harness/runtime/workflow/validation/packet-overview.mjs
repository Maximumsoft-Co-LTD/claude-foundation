import { behaviorChangingWork } from "../../evidence/test-discrimination.mjs";
import { lightKind, scenarioKindLabel, inferWorkTypes } from "./dev-document.mjs";

// What every change's proposal states once: who and which lane, the scope,
// how each requirement is accepted, what "done" means, and how success is
// judged. Everything here is a view over data the compiler already holds (ids
// and paths, never a second copy of scenario text) and policy values the
// harness enforces, so the agent authors nothing for it and it cannot drift
// from the rules it describes.

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function cell(value) {
  const flat = Array.isArray(value) ? value.join(", ") : value;
  return String(flat ?? "").replace(/\r?\n/g, " ").replaceAll("|", "\\|") || "—";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

const PREVIEW = 6;
function preview(values, quote = "") {
  const shown = values.slice(0, PREVIEW).map((value) => `${quote}${value}${quote}`).join(", ");
  return values.length > PREVIEW ? `${shown}, … +${values.length - PREVIEW} more` : shown;
}

// Why the change is in its lane, from the same predicate that chose it. The
// risk values themselves stay in Impact; this names only the cause.
export function laneReason(draft, rapid) {
  if (rapid) return "low risk; see Impact";
  const causes = [];
  if ((text(draft?.impact) || "low") !== "low" || (text(draft?.coupling) || "isolated") !== "isolated")
    causes.push("impact or coupling above the rapid limit (see Impact)");
  if (strings(draft?.securityTriggers).length)
    causes.push(`security triggers: ${strings(draft.securityTriggers).join(", ")}`);
  if (draft?.reviewRequired) causes.push("review required");
  if (draft?.acceptance?.required) causes.push("user acceptance required");
  if (!causes.length) causes.push("the draft carries design content (design.md and specs/)");
  return causes.join("; ");
}

// Change id, lane, owner, created date. Absent facts are left out, and an
// unknown owner says so; a status the harness cannot keep current points at
// the command that does.
export function renderPacketHeader(draft, state = {}) {
  const rapid = state.schema === "foundation-rapid";
  const lane = state.schema
    ? `**Lane:** ${rapid ? "rapid" : "standard"} (${laneReason(draft, rapid)})` : "";
  const first = [state.id ? `**Change:** \`${state.id}\`` : "", lane].filter(Boolean).join(" · ");
  const created = String(state.createdAt || "").match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const second = [
    `**Owner:** ${text(state.owner) || "unassigned"}`,
    created ? `**Created:** ${created}` : "",
    "**Status:** `claude-foundation changes`"
  ].filter(Boolean).join(" · ");
  return [first, second].filter(Boolean).map((line) => `- ${line}`).join("\n");
}

function requirementRows(draft) {
  const keys = Array.isArray(draft?._requirementKeys) ? draft._requirementKeys : [];
  return (Array.isArray(draft?.specs) ? draft.specs : []).map((spec, index) => ({
    key: text(keys[index]), title: text(spec?.requirement), operation: text(spec?.operation) || "added",
    scenarios: Array.isArray(spec?.scenarios) ? spec.scenarios : []
  }));
}

function taskPathsOf(draft) {
  return unique((Array.isArray(draft?.tasks) ? draft.tasks : []).flatMap((task) => strings(task?.paths)));
}

// One capability is named here (the living spec the change joins); several
// are indexed by the Capabilities table instead.
function capabilityLabel(draft) {
  const names = unique((Array.isArray(draft?.specs) ? draft.specs : []).map((spec) => text(spec?.name)));
  return names.length === 1 ? ` (\`${names[0]}\`)` : "";
}

export function renderScope(draft, { unselectedRepositories = [] } = {}) {
  // The behavior each requirement adds: the draft's own change list (authored,
  // else derived from the requirements), so Scope states it once.
  const changes = unique(strings(draft?.changes));
  const inScope = changes.length ? changes : unique(requirementRows(draft).map((row) => {
    const title = row.title || row.key;
    return title && row.operation !== "added" ? `${title} (${row.operation})` : title;
  }));
  const out = [];
  const paths = taskPathsOf(draft);
  if (paths.length) out.push(`edits outside ${preview(paths, "`")}`);
  if (unselectedRepositories.length)
    out.push(`repositories not selected: ${unselectedRepositories.join(", ")}`);
  if (strings(draft?.nonGoals).length) out.push("the authored Non-goals below");
  if (!inScope.length && !out.length) return "";
  return "## Scope\n\n" + [
    inScope.length ? `- **In scope${capabilityLabel(draft)}:** ${inScope.join("; ")}` : "",
    out.length ? `- **Out of scope:** ${out.join("; ")}` : ""].filter(Boolean).join("\n");
}

function testFilesFor(draft, claim, taskIds, scenarioName) {
  const rows = (Array.isArray(draft?.testMap) ? draft.testMap : []).filter((row) => text(row?.file));
  const authored = rows.filter((row) =>
    taskIds.includes(text(row.task)) ||
    (scenarioName && text(row.scenario).toLowerCase() === scenarioName.toLowerCase()) ||
    text(row.scenario) === claim.id).map((row) => text(row.file));
  const fromPaths = (Array.isArray(draft?.tasks) ? draft.tasks : [])
    .filter((task) => taskIds.includes(task.id)).flatMap((task) => strings(task.paths))
    .filter((path) => lightKind(path) === "test");
  return unique([...authored, ...fromPaths]);
}

// One row per claim: requirement -> scenario (by claim id, with its kind) ->
// task -> evidence capabilities -> test files. Titles and scenario text live
// in the specs; tasks, checks, and claims live in tasks.md and evidence.yaml.
export function traceabilityRows(draft) {
  const claims = Array.isArray(draft?.claims) ? draft.claims : [];
  const tasks = Array.isArray(draft?.tasks) ? draft.tasks : [];
  const requirements = requirementRows(draft);
  const rows = [];
  const seen = new Set();
  for (const requirement of requirements) {
    const own = claims.filter((claim) => text(claim?.requirementKey) === requirement.key);
    const aligned = own.length === requirement.scenarios.length;
    own.forEach((claim, index) => {
      const scenario = aligned ? requirement.scenarios[index] : null;
      const taskIds = tasks.filter((task) => (task.claims || []).includes(claim.id)).map((task) => task.id);
      seen.add(claim.id);
      rows.push({
        requirement: requirement.key, claim: claim.id, kind: scenario ? scenarioKindLabel(scenario) : "unclassified",
        tasks: taskIds, evidence: strings(claim.capabilities),
        tests: testFilesFor(draft, claim, taskIds, text(claim.scenario))
      });
    });
  }
  for (const claim of claims) {
    if (!claim?.id || seen.has(claim.id)) continue;
    const taskIds = tasks.filter((task) => (task.claims || []).includes(claim.id)).map((task) => task.id);
    rows.push({
      requirement: text(claim.requirementKey), claim: claim.id, kind: "unclassified",
      tasks: taskIds, evidence: strings(claim.capabilities),
      tests: testFilesFor(draft, claim, taskIds, text(claim.scenario))
    });
  }
  return rows;
}

export function renderTraceability(draft) {
  const rows = traceabilityRows(draft);
  if (!rows.length) return "";
  // A claim named for its requirement alone is that requirement's only
  // scenario; otherwise the claim id's suffix names the scenario.
  const reference = (row) => !row.requirement || row.claim === row.requirement ? row.claim
    : row.claim.startsWith(`${row.requirement}-`)
      ? `${row.requirement} › ${row.claim.slice(row.requirement.length + 1)}`
      : `${row.requirement} › ${row.claim}`;
  // Evidence is its own column only when it varies; a uniform capability list
  // is stated once.
  const evidence = unique(rows.map((row) => row.evidence.join(", ")));
  const uniform = evidence.length === 1;
  return "## Acceptance traceability\n\n" +
    `Tasks and checks: \`tasks.md\`.${uniform && evidence[0] !== "test" ? ` Evidence: ${evidence[0] || "—"}.` : ""}\n\n` +
    `| Requirement › scenario | Kind | Task |${uniform ? "" : " Evidence |"} Tests |\n` +
    `|---|---|---|${uniform ? "" : "---|"}---|\n` +
    rows.map((row) => `| ${cell(reference(row))} | ${row.kind} | ${cell(row.tasks)} |` +
      `${uniform ? "" : ` ${cell(row.evidence)} |`} ${cell(row.tests)} |`).join("\n");
}

function hasSuccessSignal(draft) {
  return Boolean(text(draft?.successMeasure) ||
    (Array.isArray(draft?.successCriteria) && draft.successCriteria.length));
}

// The authored measure; authored success criteria already have their own
// section, so a draft with those only points at it. Nothing is invented.
export function successMeasureText(draft) {
  if (text(draft?.successMeasure)) return text(draft.successMeasure).replace(/\s+/g, " ");
  if (Array.isArray(draft?.successCriteria) && draft.successCriteria.length)
    return "the Success criteria above hold";
  return "acceptance scenarios above pass";
}

const BOUNDARY_WORDS = new RegExp("\\b(?:empty|blank|zero|none|null|missing|max(?:imum)?|min(?:imum)?|" +
  "limit|boundary|duplicate|already|exceed\\w*|large|first|last|concurrent|twice|overflow)\\b",
  "i");
const LIGHT_TYPES = new Set(["docs", "chore", "test", "refactor", "config"]);

// Advisory only: never a repair for the agent, never a new EDIT.
export function coverageNotes(draft) {
  const notes = [];
  const rows = traceabilityRows(draft);
  const types = inferWorkTypes(draft || {});
  const light = types.length > 0 && types.every((type) => LIGHT_TYPES.has(type));
  if (rows.length && !light) {
    if (!rows.some((row) => row.kind === "failure")) notes.push("no failure scenario");
    const scenarios = requirementRows(draft).flatMap((row) => row.scenarios);
    const signal = scenarios.some((scenario) => scenarioKindLabel(scenario) === "edge" ||
      BOUNDARY_WORDS.test([scenario?.name, scenario?.given, scenario?.when, scenario?.then]
        .flat().map(text).join(" ")));
    if (!signal) notes.push("no edge/boundary scenario");
  }
  if (!hasSuccessSignal(draft)) notes.push("no success measure stated (optional 'successMeasure')");
  return notes;
}

export function coverageNoteLine(draft) {
  const notes = coverageNotes(draft);
  return notes.length ? `coverage (advisory, no repair needed): ${notes.join("; ")}` : "";
}

// The rules the harness actually enforces for this change, stated from the
// same policy values: evidence freshness, test discrimination (behavior
// changes only), the review route, acceptance, and Land.
export function definitionOfDoneLines(draft, { reviewLabel = "" } = {}) {
  const claims = Array.isArray(draft?.claims) ? draft.claims.length : 0;
  const lines = [`Fresh evidence for every claim${claims ? ` (${claims})` : ""}.`];
  if (behaviorChangingWork(inferWorkTypes(draft || {})))
    lines.push("Changed tests fail on the original code.");
  if (text(reviewLabel)) lines.push(`Review: ${text(reviewLabel)}.`);
  if (draft?.acceptance?.required) lines.push("User acceptance is recorded.");
  lines.push("Land archives it; Land never commits.");
  lines.push(`Success: ${successMeasureText(draft)}.`);
  return lines;
}

export function renderDefinitionOfDone(draft, options = {}) {
  return "## Definition of done\n\n" +
    definitionOfDoneLines(draft, options).map((line) => `- ${line}`).join("\n");
}
