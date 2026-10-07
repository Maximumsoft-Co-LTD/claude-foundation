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

const UI_FILE = /\.(?:tsx|jsx|vue|svelte|css|scss|sass|less|html)$/i;
const PATH_TYPES = [
  ["ui", /(?:^|\/)(?:components?|pages|views|screens|ui|layouts?)\//i],
  ["api", /\.(?:proto|graphql|gql)$|openapi|swagger|(?:^|\/)(?:api|routes?|controllers?|handlers?|endpoints?|resolvers?)\//i],
  ["data", /\.(?:sql|prisma)$|(?:^|\/)(?:migrations?|db|database|models?|schema|schemas|entities|repositories)\//i],
  ["async", /(?:^|\/)(?:jobs?|workers?|queues?|consumers?|producers?|schedulers?|cron)\//i],
  ["config", /(?:^|\/)config\/|(?:^|\/|\.)config\.[\w.]+$|\.env\.example$/i]
];
// Paths that carry no product behavior of their own: documentation, tests,
// and package manifests. A change made only of these is light work.
const LIGHT_PATHS = [
  ["docs", /\.(?:md|mdx|rst|txt)$|(?:^|\/)docs?\//i],
  ["test", /(?:^|\/)(?:tests?|__tests__|spec)\/|\.(?:test|spec)\.[\w]+$/i],
  ["chore", /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i]
];

function lightKind(path) {
  return LIGHT_PATHS.find(([, pattern]) => pattern.test(path))?.[0] || "";
}

// A UI file under routes/ or api/ (a page component) is UI, not an endpoint.
function pathTypes(path) {
  if (UI_FILE.test(path)) return ["ui"];
  return PATH_TYPES.filter(([, pattern]) => pattern.test(path)).map(([type]) => type);
}

// Declared work types win. Otherwise the paths the change touches say what
// kind of work it is, so the agent never has to classify its own change.
export function inferWorkTypes(draft) {
  const declared = draftWorkTypes(draft);
  if (declared.length) return declared;
  const paths = draftPaths(draft);
  if (!paths.length) return [];
  const product = paths.filter((path) => !lightKind(path));
  if (!product.length) return [...new Set(paths.map(lightKind))];
  const found = new Set(product.flatMap(pathTypes));
  const inferred = PATH_TYPES.map(([type]) => type).filter((type) => found.has(type));
  // Unclassified code owes only the common sections; a declared feature also
  // owes its user flow.
  return inferred.length ? inferred : ["code"];
}

// Declared docs-only work that adds no behavior to an existing requirement.
// README wording is not system behavior, so a rapid docs change writes no
// delta spec and Land merges nothing into openspec/specs. Only a declared
// workType counts: a markdown path may itself be product behavior (a prompt
// or a skill), so inference never drops a spec.
export function docsOnlyDraft(draft) {
  const types = draftWorkTypes(draft);
  return types.length > 0 && types.every((type) => type === "docs") &&
    (draft?.specs || []).every((spec) =>
      String(spec?.operation || "added").toLowerCase() === "added");
}

export function workTypesInferred(draft) {
  return !draftWorkTypes(draft).length && inferWorkTypes(draft).length > 0;
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
const LIGHT_WORK = new Set(["docs", "chore", "test"]);
// Work whose failure story its own section already tells: a refactor proves
// unchanged behavior through its invariants and characterization, and a
// config change states each value's validation. A separate failure matrix
// would restate them.
const NO_FAILURE_MATRIX = new Set([...LIGHT_WORK, "refactor", "config"]);

const SECTION_HELP = {
  summary: "'why' (or 'summary'): 1-3 plain sentences on what the user gets and what changes",
  failureMatrix: "'failureMatrix': [{ failure, userSees, recovery }] for each way this can fail, " +
    "or a requirement scenario with kind 'failure' (optional 'recovery') it is derived from",
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
  const failures = types.some((type) => !NO_FAILURE_MATRIX.has(type)) ? ["failureMatrix"] : [];
  return [...new Set(["summary", ...failures,
    ...types.flatMap((type) => REQUIRED_BY_TYPE[type] || [])])];
}

function userFlowSource(value) {
  return typeof value === "string" ? text(value) : text(value?.source);
}

const NO_SEPARATE_RECOVERY = "No separate step; the outcome is the handling";

function failureScenarios(draft) {
  return (Array.isArray(draft?.requirements) ? draft.requirements : []).flatMap((requirement) => {
    const list = Array.isArray(requirement?.scenarios) ? requirement.scenarios
      : requirement?.scenario !== undefined ? [requirement.scenario] : [];
    return list.filter((row) => text(row?.kind).toLowerCase() === "failure")
      .map((scenario) => ({ requirement: text(requirement?.key), scenario }));
  });
}

// Failures are written once. An authored matrix is authoritative; without one,
// each requirement scenario of kind 'failure' becomes a row.
export function derivedFailureMatrix(draft) {
  if (present(draft?.failureMatrix)) return draft.failureMatrix;
  return failureScenarios(draft).map(({ requirement, scenario }) => ({
    failure: text(scenario.name) || text(scenario.when) || text(scenario.scenario),
    userSees: text(scenario.then) || text(scenario.outcome),
    recovery: text(scenario.recovery) || NO_SEPARATE_RECOVERY,
    ...(requirement ? { covers: [requirement] } : {})
  })).filter((row) => row.failure && row.userSees);
}

// The title is the intent and 'why' states the value, so a separate summary
// would say the same thing a third time; either one gives the reader the lead.
function sectionValue(draft, key) {
  if (key === "userFlow") return userFlowSource(draft?.userFlow);
  if (key === "summary") return text(draft?.summary) || text(draft?.why);
  if (key === "failureMatrix") return derivedFailureMatrix(draft);
  return draft?.[key];
}

// A standard change is approved and built from its dev document, so each
// section its kind of work needs is an agent repair before compilation —
// never a user question and never a refusal of the edit itself.
// `lane` names why the draft is standard when the harness derived it.
export function devDocumentIssues(draft, { standard = true, lane = "" } = {}) {
  if (draft?.version !== 4 || !standard) return [];
  const issues = [];
  const types = inferWorkTypes(draft);
  const label = (workTypesInferred(draft)
    ? `${types.join(", ")}, inferred from paths; or declare workType to override`
    : types.join(", ") || "change") + (lane ? `; standard lane: ${lane}` : "");
  for (const key of requiredDevSections(draft)) {
    const value = sectionValue(draft, key);
    if (!present(value)) issues.push(`dev document (${label}) needs ${SECTION_HELP[key]}`);
  }
  return issues;
}

// Shape brackets around a node label: [x], [[x]], [(x)], ([x]), {x}, {{x}},
// [/x/]. The opening and closing pair belong to the shape, not the label.
const NODE_OPEN = /(?<![\w"'])([A-Za-z_][\w-]*)(\(\[|\[\[|\[\(|\[\/|\{\{|\[|\{)/g;
const NODE_CLOSE = { "([": "])", "[[": "]]", "[(": ")]", "[/": "/]", "{{": "}}", "[": "]", "{": "}" };

function nodeLabels(line) {
  return [...line.matchAll(NODE_OPEN)].flatMap((match) => {
    const start = match.index + match[0].length;
    const close = NODE_CLOSE[match[2]];
    // A quoted label may hold the closing bracket; it ends at the closing quote.
    const quoted = line[start] === '"' ? line.indexOf('"', start + 1) : -1;
    const end = line.indexOf(close, quoted >= 0 ? quoted : start);
    return end < 0 ? [] : [{ id: match[1], open: match[2], close, content: line.slice(start, end) }];
  });
}

// mermaid@11 rejects `A[mean(values)]`: an unquoted parenthesis or quote
// inside a flowchart node label ends the label early. Quoting the label
// (`A["mean(values)"]`) is the documented fix. Only flowcharts are checked;
// sequence and state diagrams use brackets differently.
export function mermaidLabelIssues(source, label) {
  const body = text(source);
  if (!/^(?:flowchart|graph)\b/i.test(body)) return [];
  const issues = [];
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(?:%%|classDef\b|style\b|click\b|linkStyle\b)/.test(line)) continue;
    for (const { id, open, close, content: raw } of nodeLabels(line)) {
      const content = raw.trim();
      if (/^".*"$/.test(content) || !/[()"]/.test(content)) continue;
      issues.push(`semantic draft ${label} node label '${id}${open}${raw}${close}' has an unquoted ( ) or "; ` +
        `quote it: ${id}${open}"${content.replaceAll('"', "#quot;")}"${close}`);
    }
  }
  return issues;
}

function mermaidSources(draft) {
  const sources = [];
  if (userFlowSource(draft?.userFlow)) sources.push(["userFlow", userFlowSource(draft.userFlow)]);
  const overview = typeof draft?.diagram === "string" ? draft.diagram : draft?.diagram?.source;
  if (text(overview)) sources.push(["diagram", overview]);
  (Array.isArray(draft?.diagrams) ? draft.diagrams : []).forEach((diagram, index) => {
    if (text(diagram?.source) && (!diagram.type || diagram.type === "mermaid"))
      sources.push([`diagrams[${index}]`, diagram.source]);
  });
  return sources;
}

export function devDocumentShapeIssues(draft) {
  const issues = [];
  if (draft?.userFlow !== undefined && !userFlowSource(draft.userFlow))
    issues.push("semantic draft userFlow needs Mermaid source (a string or { purpose, source })");
  for (const [label, source] of mermaidSources(draft)) issues.push(...mermaidLabelIssues(source, label));
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

// Paths the change's base does not have yet (recorded by withNewPaths), so a
// task path that creates a file reads as an addition without a file map.
function newPaths(draft) {
  return new Set(strings(draft?._newPaths).map(scopePath));
}

// Record which task paths do not exist at the base. `exists` answers for a
// project-relative path; a path in another repository stays a change.
export function withNewPaths(draft, exists) {
  if (typeof exists !== "function") return draft;
  const fresh = new Set();
  for (const task of draft?.tasks || []) {
    if (text(task?.repository)) continue;
    for (const scope of strings(task?.paths)) {
      const path = scopePath(scope);
      if (!path || /[*?[]/.test(path) || path.startsWith("../") || path.startsWith("/")) continue;
      try { if (!exists(path.replace(/\/$/, ""))) fresh.add(path); }
      catch { /* unknown is never reported as an addition */ }
    }
  }
  return fresh.size ? { ...draft, _newPaths: [...fresh] } : draft;
}

// A tree of every path the change touches, marked + add, ~ change, - remove.
// Directory scopes end in `/`; the reader sees the shape of the change at once.
export function renderFolderTree(draft) {
  const marks = new Map();
  const fresh = newPaths(draft);
  for (const row of Array.isArray(draft?.fileMap) ? draft.fileMap : []) {
    const path = scopePath(row?.path);
    if (path) marks.set(path, text(row?.change) ? changeMark(row.change) : fresh.has(path) ? "+" : "~");
  }
  for (const task of draft?.tasks || [])
    for (const scope of strings(task?.paths)) {
      const path = scopePath(scope);
      if (path && !marks.has(path)) marks.set(path, fresh.has(path) ? "+" : "~");
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
  const lines = ["."];
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
  const fresh = newPaths(draft);
  const rows = new Map();
  for (const task of draft?.tasks || [])
    for (const scope of strings(task?.paths)) {
      const path = scopePath(scope);
      if (!path) continue;
      const row = rows.get(path) ||
        { path, change: fresh.has(path) ? "add" : "change", responsibility: "", tasks: [] };
      row.tasks = [...new Set([...row.tasks, task.id].filter(Boolean))];
      if (!row.responsibility) row.responsibility = text(task.outcome);
      rows.set(path, row);
    }
  return [...rows.values()];
}

// Scenario names per requirement key, from the compiled specs.
function scenarioNamesByRequirement(draft) {
  const keys = Array.isArray(draft?._requirementKeys) ? draft._requirementKeys : [];
  return new Map((draft?.specs || []).map((spec, index) => [keys[index],
    (spec?.scenarios || []).map((scenario) => text(scenario?.name)).filter(Boolean)]));
}

// Without an authored test map, each task's check proves the scenarios of the
// requirements it implements; the check is a command, not a file.
export function derivedTestMap(draft) {
  if (present(draft?.testMap)) return draft.testMap;
  const requirements = requirementsByTask(draft);
  const scenarios = scenarioNamesByRequirement(draft);
  return (draft?.tasks || []).filter((task) => text(task.verify)).map((task) => {
    const names = [...new Set((requirements.get(task.id) || []).flatMap((key) =>
      scenarios.get(key)?.length ? scenarios.get(key) : [key]))];
    return {
      scenario: names.join("; ") || text(task.outcome),
      level: "task check",
      check: `\`${text(task.verify)}\``,
      task: task.id
    };
  });
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
