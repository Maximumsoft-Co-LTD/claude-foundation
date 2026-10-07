import { scopeAllowsPath } from "../../core/graph-execution.mjs";
import { lightweightDraft } from "./design-blueprints.mjs";

// Reader guide: the parts of a compiled packet written for a human reviewer
// rather than for the harness. Every field is optional and renders only when
// supplied, in the language the agent wrote it; shape errors block like any
// other typo, and missing guidance only warns on a standard change.

const PRIORITIES = new Set(["P1", "P2", "P3"]);
const LIST_PREVIEW = 6;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function cell(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replaceAll("|", "\\|");
}

function storyText(story) {
  if (typeof story === "string") return text(story);
  if (text(story?.story)) return text(story.story);
  const role = text(story?.asA);
  const goal = text(story?.iWant);
  const benefit = text(story?.soThat);
  return role && goal ? `As ${role}, I want ${goal}${benefit ? ` so that ${benefit}` : ""}.` : "";
}

function criterionText(row) {
  if (typeof row === "string") return text(row);
  const criterion = text(row?.criterion);
  const measure = text(row?.measure);
  return criterion && measure ? `${criterion} (${measure})` : criterion;
}

function questionText(row) {
  if (typeof row === "string") return text(row);
  const question = text(row?.question);
  return question && text(row?.owner) ? `${question} (owner: ${text(row.owner)})` : question;
}

function diagramSource(diagram) {
  return typeof diagram === "string" ? text(diagram) : text(diagram?.source);
}

export function readerGuideIssues(source, requirementKeys = new Set()) {
  const issues = [];
  if (source?.summary !== undefined && !text(source.summary))
    issues.push("semantic draft summary must be a non-empty string");
  for (const key of ["userStories", "successCriteria", "assumptions", "openQuestions"])
    if (source?.[key] !== undefined && !Array.isArray(source[key]))
      issues.push(`semantic draft ${key} must be an array`);
  (Array.isArray(source?.userStories) ? source.userStories : []).forEach((story, index) => {
    const label = `semantic draft userStories[${index}]`;
    if (!storyText(story)) issues.push(`${label} needs story or asA and iWant`);
    const priority = text(story?.priority).toUpperCase();
    if (priority && !PRIORITIES.has(priority)) issues.push(`${label}.priority must be P1|P2|P3`);
    const unknown = strings(story?.covers).filter((key) => !requirementKeys.has(key));
    if (unknown.length) issues.push(`${label}.covers references unknown requirement(s): ${unknown.join(", ")}`);
  });
  (Array.isArray(source?.successCriteria) ? source.successCriteria : []).forEach((row, index) => {
    if (!criterionText(row)) issues.push(`semantic draft successCriteria[${index}] is empty`);
  });
  (Array.isArray(source?.openQuestions) ? source.openQuestions : []).forEach((row, index) => {
    if (!questionText(row)) issues.push(`semantic draft openQuestions[${index}] is empty`);
  });
  if (source?.diagram !== undefined && !diagramSource(source.diagram))
    issues.push("semantic draft diagram needs Mermaid source");
  return issues;
}

// Guidance a reviewer needs before approving a standard change. Warnings let
// the agent complete the packet without a user gate.
export function readerGuideWarnings(draft) {
  if (draft?.version !== 4) return [];
  const warnings = [];
  // A small rapid-lane change needs no reader scaffolding prompts.
  const light = lightweightDraft(draft);
  // 'why' already gives the reader the lead; a summary would repeat it.
  if (!light && !text(draft.summary) && !text(draft.why))
    warnings.push("add a plain-language 'why' or 'summary' (1-3 sentences) so a reviewer understands the change quickly");
  if (!light && (!Array.isArray(draft.userStories) || !draft.userStories.length))
    warnings.push("add prioritized 'userStories' (P1-P3) that name who benefits and link requirement keys");
  if (!light && (!Array.isArray(draft.successCriteria) || !draft.successCriteria.length))
    warnings.push("add measurable 'successCriteria' that say how the result is judged");
  const modifies = (Array.isArray(draft.fileMap) ? draft.fileMap : []).some((row) =>
    /^modif/i.test(text(row?.change)));
  if (modifies && (!text(draft.currentState) || /^none$/i.test(text(draft.currentState))))
    warnings.push("fileMap modifies existing files; describe 'currentState' so a reviewer sees what changes");
  return warnings;
}

export function openQuestionItems(draftOrDesign) {
  if (typeof draftOrDesign === "string") {
    const section = draftOrDesign.match(/^### Open questions\s*$([\s\S]*?)(?=^#{2,3} |(?![\s\S]))/m)?.[1] || "";
    return [...section.matchAll(/^- (.+?)\s*$/gm)].map((match) => match[1]);
  }
  return (Array.isArray(draftOrDesign?.openQuestions) ? draftOrDesign.openQuestions : [])
    .map(questionText).filter(Boolean);
}

function previewList(values) {
  if (values.length <= LIST_PREVIEW) return values.join(", ");
  return `${values.length}: ${values.slice(0, LIST_PREVIEW).join(", ")}, … +${values.length - LIST_PREVIEW} more`;
}

function requirementTasks(draft) {
  const claimToKey = new Map((draft.claims || []).map((claim) => [claim.id, claim.requirementKey]));
  const byRequirement = new Map();
  for (const task of draft.tasks || [])
    for (const claim of task.claims || []) {
      const key = claimToKey.get(claim);
      if (!key) continue;
      byRequirement.set(key, [...new Set([...(byRequirement.get(key) || []), task.id])]);
    }
  return byRequirement;
}

export function renderProposalLead(draft) {
  const parts = [];
  if (text(draft.summary)) parts.push(`## Summary\n\n${text(draft.summary)}`);
  return parts.join("\n\n");
}

export function renderProposalReader(draft) {
  const parts = [];
  const stories = Array.isArray(draft.userStories) ? draft.userStories : [];
  if (stories.length) {
    const ordered = [...stories].sort((left, right) =>
      (text(left?.priority).toUpperCase() || "P9").localeCompare(text(right?.priority).toUpperCase() || "P9"));
    parts.push("## User stories\n\n" + ordered.map((story) => {
      const priority = text(story?.priority).toUpperCase();
      const covers = strings(story?.covers);
      const test = text(story?.test);
      return `- ${priority ? `**${priority}** ` : ""}${storyText(story)}` +
        (covers.length ? ` Requirements: ${covers.join(", ")}.` : "") +
        (test ? `\n  - Independent check: ${test}` : "");
    }).join("\n"));
  }
  const criteria = (Array.isArray(draft.successCriteria) ? draft.successCriteria : [])
    .map(criterionText).filter(Boolean);
  if (criteria.length) parts.push(`## Success criteria\n\n${criteria.map((row) => `- ${row}`).join("\n")}`);
  const index = capabilityIndex(draft);
  if (index) parts.push(index);
  return parts.join("\n\n");
}

// Where a reader of many spec files should start: each capability, the
// requirements it adds or changes, and the tasks that implement them.
function capabilityIndex(draft) {
  const specs = draft.specs || [];
  if (!specs.length) return "";
  const tasksByRequirement = requirementTasks(draft);
  const rows = new Map();
  specs.forEach((spec, index) => {
    const capability = text(spec.name) || "change";
    const row = rows.get(capability) || { requirements: [], tasks: new Set() };
    row.requirements.push(text(spec.requirement));
    const key = draft._requirementKeys?.[index];
    for (const task of tasksByRequirement.get(key) || []) row.tasks.add(task);
    rows.set(capability, row);
  });
  return "## Capabilities\n\n| Capability | Requirements | Tasks |\n|---|---|---|\n" +
    [...rows.entries()].map(([capability, row]) =>
      `| ${cell(capability)} | ${cell(previewList(row.requirements))} | ` +
      `${cell([...row.tasks].sort().join(", ") || "—")} |`).join("\n");
}

export function renderDiscoveryAppendix(draft) {
  const coverage = draft.discovery?.coverage || [];
  if (!coverage.length) return "";
  return "## Appendix: discovery coverage\n\n" +
    "| Dimension | Status | Requirements | Sources | Rationale |\n|---|---|---|---|---|\n" +
    coverage.map((row) => `| ${cell(row.dimension)} | ${cell(coverageStatus(row))} | ` +
      `${cell(previewList(row.covers || []))} | ${cell(previewList(row.sources || []))} | ` +
      `${cell(coverageRationale(row))} |`).join("\n");
}

// A row the harness derived from draft content says so and names that content,
// so a reviewer can tell it from a row the agent wrote.
export function coverageStatus(row) {
  return row?.derived ? `${row.status} (derived)` : row?.status;
}

export function coverageRationale(row) {
  if (row?.derived) return `Derived from ${strings(row.derivedFrom).join(", ")}`;
  return row?.rationale && row.rationale !== "none" ? row.rationale : "";
}

export function renderInvestigationSummary(investigation) {
  if (!investigation) return "";
  return "## Investigation handoff\n\n" +
    `- **ID:** ${cell(investigation.id)}\n` +
    `- **Outcome:** ${cell(investigation.outcome)}\n` +
    `- **Summary:** ${cell(investigation.summary)}`;
}

export function renderInvestigationAppendix(investigation) {
  if (!investigation) return "";
  return "## Appendix: investigation provenance\n\n" +
    `- **Change intent:** ${cell(investigation.changeIntent)}\n` +
    `- **State:** ${cell(investigation.statePath)} @ ${cell(investigation.stateDigest)}\n` +
    `- **Sources:** ${cell(investigation.sourceDigest)}`;
}

export function renderDesignOverview(draft) {
  const parts = [];
  const source = diagramSource(draft.diagram);
  if (source) {
    const purpose = typeof draft.diagram === "object" ? text(draft.diagram?.purpose) : "";
    parts.push(`## Overview\n\n${purpose ? `${purpose}\n\n` : ""}\`\`\`mermaid\n${source}\n\`\`\``);
  }
  const assumptions = strings(draft.assumptions);
  const questions = openQuestionItems(draft);
  if (assumptions.length || questions.length)
    parts.push("## Assumptions and open questions" +
      (assumptions.length ? `\n\n### Assumptions\n\n${assumptions.map((row) => `- ${row}`).join("\n")}` : "") +
      (questions.length ? `\n\n### Open questions\n\n${questions.map((row) => `- ${row}`).join("\n")}` : ""));
  return parts.join("\n\n");
}

// Fill the file map's Tasks column from each task's [paths:] scope.
export function fileMapWithTasks(fileMap, tasks = []) {
  if (!Array.isArray(fileMap)) return fileMap;
  return fileMap.map((row) => {
    if (row?.tasks !== undefined && row.tasks !== "" &&
        !(Array.isArray(row.tasks) && !row.tasks.length)) return row;
    const path = text(row?.path).replace(/\/\*\*?$/, "").replace(/\/$/, "");
    const owners = tasks.filter((task) => (task.paths || []).some((scope) =>
      scopeAllowsPath(scope, path) || scopeAllowsPath(path, text(scope).replace(/\/\*\*?$/, ""))))
      .map((task) => task.id);
    return owners.length ? { ...row, tasks: owners } : row;
  });
}

// Settled user choices from semantic intake are durable decisions a reviewer
// must be able to find; the draft's own decisions take precedence by key.
export function intakeDecisions(draft) {
  const own = new Set((draft.decisions || []).map((decision) => text(decision?.key)).filter(Boolean));
  return (draft.discovery?.decisions || [])
    .filter((row) => row.status === "resolved" && row.choice && !own.has(row.key))
    .map((row) => ({
      id: `DEC-${row.key.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").toUpperCase()}`,
      key: row.key,
      context: row.question,
      choice: row.choice,
      // A settled fact had no alternative, so it carries no separate reason.
      why: row.reason || "No alternative was open; recorded as settled",
      rejected: (row.alternatives || []).filter((option) => option !== row.choice),
      decidedBy: row.decidedBy || "user",
      decisionRef: row.decisionRef
    }));
}
