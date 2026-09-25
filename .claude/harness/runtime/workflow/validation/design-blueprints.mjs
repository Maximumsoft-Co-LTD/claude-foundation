import { leasePathIsAllowed } from "../lease-runtime.mjs";

// Design blueprints: the typed design sections a declared work type needs
// before implementation. A thin design.md let Builds guess endpoint shapes,
// UI states, and failure behavior. Shape errors block compilation; missing or
// thin sections only warn, so the agent completes them without a user gate.
export const WORK_TYPES = Object.freeze([
  "feature", "bugfix", "refactor", "api", "ui", "data", "config", "async",
  "integration", "chore", "docs"
]);

export const BLUEPRINT_KEYS = Object.freeze([
  "fileMap", "failureMatrix", "testMap", "apiContracts", "dataModel", "uiStates",
  "configContract", "jobContract", "bugfix", "refactor"
]);

const LIGHT_WORK = new Set(["chore", "docs"]);
const PLACEHOLDER = /(?:replace-with|needs clarification|\btodo\b|\btbd\b|<[^>]+>)/i;

const BY_WORK_TYPE = {
  api: ["apiContracts"],
  data: ["dataModel"],
  ui: ["uiStates"],
  config: ["configContract"],
  async: ["jobContract", "diagrams"],
  integration: ["integrations"],
  bugfix: ["bugfix"],
  refactor: ["refactor"]
};

// Required fields per list entry; an entry is thin when any is empty.
const ENTRY_FIELDS = {
  fileMap: ["path", "change", "responsibility"],
  failureMatrix: ["failure", "userSees", "recovery"],
  testMap: ["scenario", "level", "file"],
  apiContracts: ["method", "path", "auth", "request", "response", "errors"],
  dataModel: ["entity", "fields", "migration"],
  uiStates: ["screen", "states", "accessibility"],
  configContract: ["key", "default", "validation"],
  jobContract: ["key", "states", "retry", "timeout", "idempotency"]
};
const OBJECT_FIELDS = {
  bugfix: ["reproduction", "rootCause", "regression"],
  refactor: ["invariants", "characterization"]
};

function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "boolean" || typeof value === "number") return true;
  return typeof value === "string" && value.trim() !== "";
}

function flatText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flatText).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(flatText).join(" ");
  return "";
}

export function draftWorkTypes(draft) {
  return Array.isArray(draft?.workType)
    ? [...new Set(draft.workType.map((value) => String(value).trim().toLowerCase()))]
    : [];
}

// Blocking shape issues: a typo in workType would silently select nothing.
export function designBlueprintIssues(source) {
  const issues = [];
  if (source?.workType !== undefined) {
    if (!Array.isArray(source.workType) || !source.workType.length)
      issues.push("semantic draft workType must be a non-empty array");
    else for (const value of draftWorkTypes(source))
      if (!WORK_TYPES.includes(value))
        issues.push(`semantic draft workType '${value}' is unknown; use ${WORK_TYPES.join("|")}`);
  }
  for (const key of Object.keys(ENTRY_FIELDS))
    if (source?.[key] !== undefined && !Array.isArray(source[key]))
      issues.push(`semantic draft ${key} must be an array`);
  for (const key of Object.keys(OBJECT_FIELDS))
    if (source?.[key] !== undefined &&
        (!source[key] || typeof source[key] !== "object" || Array.isArray(source[key])))
      issues.push(`semantic draft ${key} must be an object`);
  return issues;
}

export function requiredBlueprints(draft) {
  const types = draftWorkTypes(draft);
  if (!types.length || types.every((type) => LIGHT_WORK.has(type))) return [];
  const required = new Set(["fileMap", "failureMatrix", "testMap"]);
  for (const type of types) for (const key of BY_WORK_TYPE[type] || []) required.add(key);
  if (String(draft.coupling || "").toLowerCase() === "coupled") required.add("diagrams");
  return [...required];
}

// Non-blocking findings. Each names the section and what makes it incomplete.
export function designBlueprintWarnings(draft) {
  const warnings = [];
  if (draft?.version === 4 && !draftWorkTypes(draft).length) {
    warnings.push(`declare workType (${WORK_TYPES.join("|")}) so the compiler can select the design sections this change needs`);
    return warnings;
  }
  for (const key of requiredBlueprints(draft))
    if (!present(draft[key]))
      warnings.push(`workType ${draftWorkTypes(draft).join(",")} expects '${key}'; add it or state why it does not apply`);
  if (requiredBlueprints(draft).includes("diagrams") && draftWorkTypes(draft).includes("async") &&
      present(draft.diagrams) && !draft.diagrams.some((row) =>
        /sequenceDiagram|stateDiagram/.test(String(row?.source || ""))))
    warnings.push("workType async expects a sequence or state diagram that includes the failure path");
  for (const [key, fields] of Object.entries(ENTRY_FIELDS)) {
    if (!Array.isArray(draft?.[key])) continue;
    draft[key].forEach((row, index) => {
      const missing = fields.filter((field) => !present(row?.[field]));
      if (missing.length) warnings.push(`${key}[${index}] is missing ${missing.join(", ")}`);
      if (PLACEHOLDER.test(flatText(row))) warnings.push(`${key}[${index}] contains placeholder text`);
    });
  }
  for (const [key, fields] of Object.entries(OBJECT_FIELDS)) {
    if (!draft?.[key] || typeof draft[key] !== "object") continue;
    const missing = fields.filter((field) => !present(draft[key][field]));
    if (missing.length) warnings.push(`${key} is missing ${missing.join(", ")}`);
    if (PLACEHOLDER.test(flatText(draft[key]))) warnings.push(`${key} contains placeholder text`);
  }
  if (Array.isArray(draft?.uiStates))
    draft.uiStates.forEach((row, index) => {
      const states = (Array.isArray(row?.states) ? row.states : [])
        .map((state) => String(state?.state || state).toLowerCase());
      if (states.length && !states.some((state) => /error|fail/.test(state)))
        warnings.push(`uiStates[${index}] has no error state`);
    });
  // A file the design places outside every task scope fails Build at release.
  const taskPaths = (draft?.tasks || []).flatMap((task) => task?.paths || []);
  if (taskPaths.length && Array.isArray(draft?.fileMap))
    draft.fileMap.forEach((row, index) => {
      const path = String(row?.path || "").trim();
      if (path && String(row?.change || "").toLowerCase() !== "delete" &&
          !leasePathIsAllowed(path.replace(/\/\*\*?$/, ""), taskPaths))
        warnings.push(`fileMap[${index}] '${path}' is outside every task's paths`);
    });
  (draft?.decisions || []).forEach((decision, index) => {
    if (!present(decision?.consequences))
      warnings.push(`decisions[${index}] states no consequences`);
  });
  return warnings;
}

function cell(value) {
  const text = Array.isArray(value)
    ? value.map((item) => (item && typeof item === "object" ? flatObject(item) : item)).join("; ")
    : value && typeof value === "object" ? flatObject(value) : value;
  return String(text ?? "").replace(/\r?\n/g, " ").replaceAll("|", "\\|") || "—";
}

function flatObject(value) {
  return Object.entries(value).map(([key, item]) => `${key}: ${
    Array.isArray(item) ? item.join(", ") : item}`).join(", ");
}

function table(headers, rows) {
  return `| ${headers.map(([label]) => label).join(" | ")} |\n` +
    `|${headers.map(() => "---").join("|")}|\n` +
    rows.map((row) => `| ${headers.map(([, field]) => cell(row?.[field])).join(" | ")} |`).join("\n");
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => `- ${cell(item)}`).join("\n") : `- ${cell(value)}`;
}

function apiContract(row) {
  const errors = Array.isArray(row.errors)
    ? row.errors.map((error) => (error && typeof error === "object"
      ? `- \`${error.status ?? error.code ?? "?"}\` ${error.when || error.meaning || ""}`.trimEnd()
      : `- ${error}`)).join("\n")
    : `- ${cell(row.errors)}`;
  const block = (value) => (value && typeof value === "object"
    ? `\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`` : ` ${cell(value)}`);
  return `### ${cell(row.method)} ${cell(row.path)}\n\n` +
    (row.purpose ? `${row.purpose}\n\n` : "") +
    `- **Auth:** ${cell(row.auth)}\n` +
    `- **Idempotency:** ${cell(row.idempotency)}\n` +
    `- **Compatibility:** ${cell(row.compatibility)}\n\n` +
    `**Request:**${block(row.request)}\n\n**Response:**${block(row.response)}\n\n` +
    `**Errors:**\n\n${errors}`;
}

function dataEntity(row) {
  const fields = Array.isArray(row.fields) && row.fields.some((field) => field && typeof field === "object")
    ? table([["Field", "name"], ["Type", "type"], ["Constraints", "constraints"]], row.fields)
    : list(row.fields);
  return `### ${cell(row.entity)}\n\n${fields}\n\n` +
    `- **Invariants:** ${cell(row.invariants)}\n` +
    `- **Migration:** ${cell(row.migration)}\n- **Rollback:** ${cell(row.rollback)}`;
}

function uiScreen(row) {
  const states = Array.isArray(row.states) && row.states.some((state) => state && typeof state === "object")
    ? table([["State", "state"], ["Shows", "shows"], ["Actions", "actions"]], row.states)
    : list(row.states);
  return `### ${cell(row.screen)}\n\n${states}\n\n` +
    `- **Accessibility:** ${cell(row.accessibility)}\n- **Copy:** ${cell(row.copy)}`;
}

function jobContract(row) {
  return `### ${cell(row.key)}\n\n- **States:** ${cell(row.states)}\n` +
    `- **Transitions:** ${cell(row.transitions)}\n- **Retry:** ${cell(row.retry)}\n` +
    `- **Timeout:** ${cell(row.timeout)}\n- **Idempotency:** ${cell(row.idempotency)}\n` +
    `- **Cancellation:** ${cell(row.cancellation)}`;
}

// Sections render only when the draft supplies them, in reading order: where
// code lands, what it exposes, how it fails, and how it is proven.
export function renderDesignBlueprints(draft) {
  const sections = [];
  const types = draftWorkTypes(draft);
  if (types.length) sections.push(`## Work type\n\n${types.join(", ")}`);
  if (draft.bugfix) sections.push(`## Bugfix analysis\n\n` +
    `- **Reproduction:** ${cell(draft.bugfix.reproduction)}\n` +
    `- **Root cause:** ${cell(draft.bugfix.rootCause)}\n` +
    `- **Regression proof:** ${cell(draft.bugfix.regression)}`);
  if (draft.refactor) sections.push(`## Refactor invariants\n\n${list(draft.refactor.invariants)}\n\n` +
    `- **Characterization:** ${cell(draft.refactor.characterization)}`);
  if (present(draft.fileMap)) sections.push(`## File map\n\n` + table([
    ["Path", "path"], ["Change", "change"], ["Responsibility", "responsibility"], ["Tasks", "tasks"]
  ], draft.fileMap));
  if (present(draft.apiContracts))
    sections.push(`## API contracts\n\n${draft.apiContracts.map(apiContract).join("\n\n")}`);
  if (present(draft.dataModel))
    sections.push(`## Data model\n\n${draft.dataModel.map(dataEntity).join("\n\n")}`);
  if (present(draft.uiStates))
    sections.push(`## UI states\n\n${draft.uiStates.map(uiScreen).join("\n\n")}`);
  if (present(draft.configContract)) sections.push(`## Config contract\n\n` + table([
    ["Key", "key"], ["Default", "default"], ["Secret", "secret"], ["Validation", "validation"],
    ["Scope", "scope"]
  ], draft.configContract));
  if (present(draft.jobContract))
    sections.push(`## Job contract\n\n${draft.jobContract.map(jobContract).join("\n\n")}`);
  if (present(draft.failureMatrix)) sections.push(`## Failure matrix\n\n` + table([
    ["Failure", "failure"], ["User sees", "userSees"], ["Recovery", "recovery"], ["Covers", "covers"]
  ], draft.failureMatrix));
  if (present(draft.testMap)) sections.push(`## Test map\n\n` + table([
    ["Scenario", "scenario"], ["Level", "level"], ["File", "file"]
  ], draft.testMap));
  return sections.join("\n\n");
}

// Light work alone (chore, docs) never forces an otherwise empty design.md.
export function draftHasBlueprints(draft) {
  return draftWorkTypes(draft).some((type) => !LIGHT_WORK.has(type)) ||
    BLUEPRINT_KEYS.some((key) => present(draft?.[key]));
}
