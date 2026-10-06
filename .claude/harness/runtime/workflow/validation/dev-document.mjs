import { leasePathIsAllowed } from "../lease-runtime.mjs";
import { draftWorkTypes } from "./design-blueprints.mjs";

// The dev document: what a Change hands to Build and to the person approving
// it. Readers need to see what they get, what changes, and how it will be
// built and proven; Build needs a plan it can execute. The harness derives
// everything mechanical (folder tree, plan, file map, test map, work type) and
// asks the agent only for content that takes judgment (flows, contracts,
// models, states, failures).

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

function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return typeof value === "string" && value.trim() !== "";
}

// A scope like `src/**` or `src/*.js` names its directory; a file stays a file.
function scopePath(scope) {
  return text(scope).replace(/\/\*\*(?:\/\*)?$/, "/").replace(/\/\*[^/]*$/, "/")
    .replace(/^\.\//, "");
}

function draftPaths(draft) {
  return [
    ...(Array.isArray(draft?.fileMap) ? draft.fileMap.map((row) => text(row?.path)) : []),
    ...(draft?.tasks || []).flatMap((task) => strings(task?.paths))
  ].map(scopePath).filter(Boolean);
}

const PATH_TYPES = [
  ["ui", /\.(?:tsx|jsx|vue|svelte|css|scss|sass|less|html)$|(?:^|\/)(?:components?|pages|views|screens|ui|layouts?)\//i],
  ["api", /\.(?:proto|graphql|gql)$|openapi|swagger|(?:^|\/)(?:api|routes?|controllers?|handlers?|endpoints?|resolvers?)\//i],
  ["data", /\.(?:sql|prisma)$|(?:^|\/)(?:migrations?|db|database|models?|schema|schemas|entities|repositories)\//i],
  ["async", /(?:^|\/)(?:jobs?|workers?|queues?|consumers?|producers?|schedulers?|cron)\//i],
  ["config", /(?:^|\/)config\/|\.env\.example$/i]
];

// Declared work types win. Otherwise the paths the change touches say what
// kind of work it is, so the agent never has to classify its own change.
export function inferWorkTypes(draft) {
  const declared = draftWorkTypes(draft);
  if (declared.length) return declared;
  const paths = draftPaths(draft);
  if (!paths.length) return [];
  if (paths.every((path) => /\.(?:md|mdx|rst|txt)$|(?:^|\/)docs?\//i.test(path))) return ["docs"];
  const inferred = PATH_TYPES.filter(([, pattern]) => paths.some((path) => pattern.test(path)))
    .map(([type]) => type);
  // Unclassified code owes only the common sections; a declared feature also
  // owes its user flow.
  return inferred.length ? inferred : ["code"];
}

// Sections the reader and Build need per kind of work. File map, test map,
// folder tree, and plan are derived by the harness, so they are never asked for.
const REQUIRED_BY_TYPE = {
  feature: ["userFlow"],
  ui: ["userFlow", "uiStates", "componentMap"],
  api: ["apiContracts"],
  data: ["dataModel"],
  config: ["configContract"],
  async: ["jobContract", "diagrams"],
  integration: ["integrations"],
  bugfix: ["bugfix"],
  refactor: ["refactor", "componentMap"]
};
const LIGHT_WORK = new Set(["docs", "chore"]);

const SECTION_HELP = {
  summary: "'summary': 1-3 plain sentences on what the user gets and what changes",
  failureMatrix: "'failureMatrix': [{ failure, userSees, recovery }] for each way this can fail",
  userFlow: "'userFlow': { purpose, source } with a Mermaid flowchart of the user's path, including the error path",
  uiStates: "'uiStates': [{ screen, states: [loading, empty, error, success…], accessibility }]",
  componentMap: "'componentMap': [{ component, responsibility, files }] mapping each component to its files",
  apiContracts: "'apiContracts': [{ method, path, auth, request, response, errors }]",
  dataModel: "'dataModel': [{ entity, fields, migration, rollback }]",
  configContract: "'configContract': [{ key, default, validation }]",
  jobContract: "'jobContract': [{ key, states, retry, timeout, idempotency }]",
  diagrams: "'diagrams': a Mermaid sequence or state diagram that includes the failure path",
  integrations: "'integrations': each external system with its documentation and concerns",
  bugfix: "'bugfix': { reproduction, rootCause, regression }",
  refactor: "'refactor': { invariants, characterization }"
};

export function requiredDevSections(draft) {
  const types = inferWorkTypes(draft);
  if (!types.length || types.every((type) => LIGHT_WORK.has(type))) return ["summary"];
  return [...new Set(["summary", "failureMatrix",
    ...types.flatMap((type) => REQUIRED_BY_TYPE[type] || [])])];
}

function userFlowSource(value) {
  return typeof value === "string" ? text(value) : text(value?.source);
}

// A standard change is approved and built from its dev document, so each
// section its kind of work needs is an agent repair before compilation —
// never a user question and never a refusal of the edit itself.
export function devDocumentIssues(draft, { standard = true } = {}) {
  if (draft?.version !== 4 || !standard) return [];
  const issues = [];
  const types = inferWorkTypes(draft);
  for (const key of requiredDevSections(draft)) {
    const value = key === "userFlow" ? userFlowSource(draft?.userFlow) : draft?.[key];
    if (!present(value))
      issues.push(`dev document (${types.join(", ") || "change"}) needs ${SECTION_HELP[key]}`);
  }
  return issues;
}

export function devDocumentShapeIssues(draft) {
  const issues = [];
  if (draft?.userFlow !== undefined && !userFlowSource(draft.userFlow))
    issues.push("semantic draft userFlow needs Mermaid source (a string or { purpose, source })");
  if (draft?.componentMap !== undefined) {
    if (!Array.isArray(draft.componentMap))
      issues.push("semantic draft componentMap must be an array");
    else draft.componentMap.forEach((row, index) => {
      if (!text(row?.component)) issues.push(`semantic draft componentMap[${index}].component is required`);
      if (!text(row?.responsibility))
        issues.push(`semantic draft componentMap[${index}].responsibility is required`);
    });
  }
  return issues;
}

function taskIdsFor(path, tasks) {
  const target = scopePath(path).replace(/\/$/, "");
  return (tasks || []).filter((task) => strings(task?.paths).some((scope) =>
    leasePathIsAllowed(target, [scope]) || scopePath(scope).replace(/\/$/, "") === target))
    .map((task) => task.id).filter(Boolean);
}

const CHANGE_MARK = [
  [/^(?:add|new|create)/i, "+"],
  [/^(?:delete|remove)/i, "-"]
];

function changeMark(change) {
  return CHANGE_MARK.find(([pattern]) => pattern.test(text(change)))?.[1] || "~";
}

// A tree of every path the change touches, marked + add, ~ change, - remove.
// Directory scopes end in `/`; the reader sees the shape of the change at once.
export function renderFolderTree(draft) {
  const marks = new Map();
  for (const row of Array.isArray(draft?.fileMap) ? draft.fileMap : []) {
    const path = scopePath(row?.path);
    if (path) marks.set(path, changeMark(row?.change));
  }
  for (const task of draft?.tasks || [])
    for (const scope of strings(task?.paths)) {
      const path = scopePath(scope);
      if (path && !marks.has(path)) marks.set(path, "~");
    }
  if (!marks.size) return "";
  const root = new Map();
  for (const [path, mark] of [...marks.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const parts = path.replace(/\/$/, "").split("/");
    let node = root;
    parts.forEach((part, index) => {
      const last = index === parts.length - 1;
      const name = last && path.endsWith("/") ? `${part}/` : last ? part : `${part}/`;
      if (!node.has(name)) node.set(name, { children: new Map(), mark: null });
      if (last) node.get(name).mark = mark;
      node = node.get(name).children;
    });
  }
  const lines = [];
  const walk = (node, prefix) => {
    const entries = [...node.entries()];
    entries.forEach(([name, value], index) => {
      const last = index === entries.length - 1;
      lines.push(`${prefix}${last ? "└── " : "├── "}${value.mark ? `${value.mark} ` : ""}${name}`);
      walk(value.children, `${prefix}${last ? "    " : "│   "}`);
    });
  };
  walk(root, "");
  return "## Folder tree\n\n`+` add · `~` change · `-` remove\n\n```text\n" + lines.join("\n") + "\n```";
}

function requirementsByTask(draft) {
  const claimToKey = new Map((draft?.claims || []).map((claim) => [claim.id, claim.requirementKey]));
  return new Map((draft?.tasks || []).map((task) => [task.id,
    [...new Set((task.claims || []).map((claim) => claimToKey.get(claim)).filter(Boolean))]]));
}

// The plan Build executes, in dependency order with the check for each step.
export function renderPlan(draft) {
  const tasks = draft?.tasks || [];
  if (!tasks.length) return "";
  const requirements = requirementsByTask(draft);
  const rows = tasks.map((task) =>
    `| ${task.id} | ${cell(task.outcome)} | ${cell(strings(task.paths))} | ` +
    `${task.verify ? `\`${cell(task.verify)}\`` : "—"} | ${cell((task.dependsOn || []).join(", "))} | ` +
    `${cell((requirements.get(task.id) || []).join(", "))} |`);
  const edges = tasks.flatMap((task) => (task.dependsOn || []).map((dependency) =>
    `  ${dependency} --> ${task.id}`));
  return "## Plan\n\n| Task | Outcome | Files | Verify | Depends on | Requirements |\n" +
    "|---|---|---|---|---|---|\n" + rows.join("\n") +
    (edges.length ? `\n\n\`\`\`mermaid\ngraph TD\n${edges.join("\n")}\n\`\`\`` : "");
}

// Without an authored file map, each task scope is one row owned by its tasks.
export function derivedFileMap(draft) {
  if (present(draft?.fileMap)) return draft.fileMap;
  const rows = new Map();
  for (const task of draft?.tasks || [])
    for (const scope of strings(task?.paths)) {
      const path = scopePath(scope);
      if (!path) continue;
      const row = rows.get(path) || { path, change: "change", responsibility: "", tasks: [] };
      row.tasks = [...new Set([...row.tasks, task.id].filter(Boolean))];
      if (!row.responsibility) row.responsibility = text(task.outcome);
      rows.set(path, row);
    }
  return [...rows.values()];
}

// Without an authored test map, each requirement is proven by the checks of
// the tasks that implement it.
export function derivedTestMap(draft) {
  if (present(draft?.testMap)) return draft.testMap;
  const requirements = requirementsByTask(draft);
  return (draft?.tasks || []).filter((task) => text(task.verify)).map((task) => ({
    scenario: (requirements.get(task.id) || []).join(", ") || text(task.outcome),
    level: "task check",
    file: `\`${text(task.verify)}\``,
    task: task.id
  }));
}

export function renderUserFlow(draft) {
  const source = userFlowSource(draft?.userFlow);
  if (!source) return "";
  const purpose = typeof draft.userFlow === "object" ? text(draft.userFlow?.purpose) : "";
  return `## User flow\n\n${purpose ? `${purpose}\n\n` : ""}\`\`\`mermaid\n${source}\n\`\`\``;
}

export function renderComponentMap(draft) {
  const rows = Array.isArray(draft?.componentMap) ? draft.componentMap : [];
  if (!rows.length) return "";
  return "## Component map\n\n| Component | Responsibility | Files | Tasks |\n|---|---|---|---|\n" +
    rows.map((row) => {
      const files = strings(Array.isArray(row?.files) ? row.files : [row?.files]);
      const tasks = strings(row?.tasks).length ? strings(row.tasks)
        : [...new Set(files.flatMap((file) => taskIdsFor(file, draft.tasks)))];
      return `| ${cell(row.component)} | ${cell(row.responsibility)} | ${cell(files)} | ${cell(tasks)} |`;
    }).join("\n");
}
