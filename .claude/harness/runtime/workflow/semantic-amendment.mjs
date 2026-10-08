import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { join } from "node:path";
import {
  deriveRepositoryTaskDependencies, normalizeSemanticDraft, renderRequirementMarkdown,
  renderSpecHeading
} from "./semantic-draft.mjs";
import { coverageRationale, coverageStatus } from "./validation/reader-guide.mjs";
import { scopeAllowsPath } from "../core/graph-execution.mjs";

const stringList = (value) => Array.isArray(value)
  ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
const unique = (values) => [...new Set(values)];
const markdownCell = (value) => String(value ?? "")
  .replace(/\r?\n/g, " ").replaceAll("|", "\\|");
const keyOf = (row) => String(row?.key || "").trim();

export function semanticTaskKey(line) {
  return String(line).match(/\[key:([^\]]+)\]/i)?.[1]?.trim() || null;
}

function taskId(line) {
  return String(line).match(/^\s*-\s*\[[ xX]\]\s*\*{0,2}(T\d{3,})\*{0,2}\b/i)?.[1]
    ?.toUpperCase() || null;
}

function taskCompleted(line) {
  return /^\s*-\s*\[[xX]\]/.test(String(line));
}

function taskClaims(line) {
  return stringList(String(line).match(/\[claims:([^\]]*)\]/i)?.[1]?.split(","));
}

function taskVerify(line) {
  return String(line).match(/—\s*verify:\s*`([^`]+)`/i)?.[1]?.trim() || "";
}

function taskPaths(line) {
  return stringList(String(line).match(/\[paths:([^\]]*)\]/i)?.[1]?.split(","));
}

function replaceTaskVerify(line, verify) {
  return /—\s*verify:\s*`[^`]+`/i.test(line)
    ? line.replace(/—\s*verify:\s*`[^`]+`/i, `— verify: \`${verify}\``)
    : `${line.trimEnd()} — verify: \`${verify}\``;
}

function replaceTaskPaths(line, paths) {
  const annotation = paths.length ? `[paths:${paths.join(",")}]` : "";
  if (/\[paths:[^\]]*\]/i.test(line))
    return line.replace(/ ?\[paths:[^\]]*\]/i, annotation ? ` ${annotation}` : "");
  if (!annotation) return line;
  const marker = line.indexOf(" — verify:");
  return marker < 0
    ? `${line.trimEnd()} ${annotation}`
    : `${line.slice(0, marker).trimEnd()} ${annotation}${line.slice(marker)}`;
}

function taskDepends(line) {
  return stringList(String(line).match(/\[depends:([^\]]*)\]/i)?.[1]?.split(","))
    .map((id) => id.toUpperCase());
}

function replaceTaskDepends(line, ids) {
  const annotation = ids.length ? `[depends:${ids.join(",")}]` : "";
  if (/\[depends:[^\]]*\]/i.test(line))
    return line.replace(/ ?\[depends:[^\]]*\]/i, annotation ? ` ${annotation}` : "");
  if (!annotation) return line;
  const marker = line.indexOf(" — verify:");
  return marker < 0
    ? `${line.trimEnd()} ${annotation}`
    : `${line.slice(0, marker).trimEnd()} ${annotation}${line.slice(marker)}`;
}

// Re-opening unticks a completed task, so the harness must verify it again.
function reopenTask(line) {
  return String(line).replace(/^(\s*-\s*\[)[xX](\])/, "$1 $2");
}

// The fields an update may change in place. On a completed task they change
// only with `reopen: true`, which unticks it so its claims are proven again.
const TASK_CONTRACT_FIELDS = ["verify", "paths", "dependsOn"];
const TASK_ROW_FIELDS = ["key", ...TASK_CONTRACT_FIELDS, "reopen"];
const hasField = (row, field) => Object.prototype.hasOwnProperty.call(row || {}, field);
const removalRef = (row) => String(typeof row === "string" ? row : row?.key || "").trim();

/**
 * A task-contract amendment corrects the verify command (and optionally the
 * paths or dependencies) of existing tasks, or withdraws unfinished tasks
 * (`removeTasks`, which may move their coverage with `updateTasks` covers).
 * It carries no requirement change, so it needs no requirement, evidence, or
 * semantic-intake input.
 */
export function taskContractOnlyAmendment(amendment) {
  const updates = amendment?.updateTasks;
  const removals = amendment?.removeTasks;
  if (!["addRequirements", "reviseRequirements", "removeRequirements", "addTasks"]
    .every((field) => !amendmentList(amendment, field).length)) return false;
  if ((updates !== undefined && !Array.isArray(updates)) ||
      (removals !== undefined && !Array.isArray(removals))) return false;
  const rows = updates || [];
  const removing = (removals || []).length > 0;
  const fields = removing ? [...TASK_ROW_FIELDS, "covers"] : TASK_ROW_FIELDS;
  return (rows.length > 0 || removing) &&
    rows.every((row) => row && typeof row === "object" && !Array.isArray(row) &&
      (hasField(row, "verify") || hasField(row, "dependsOn") ||
        (removing && hasField(row, "covers"))) &&
      Object.keys(row).every((field) => fields.includes(field)));
}

/**
 * The shape `change amend --template` prints; the verify-only form leads.
 * `save` comes first: the host refuses a shell-written JSON file, while the
 * file tool falls under the seeded `Edit(/.foundation/drafts/**)` rule.
 */
export function semanticAmendmentTemplate() {
  return {
    save: "Write one form below (its value, without the form name) with the Write tool to " +
      ".foundation/drafts/<change>-amendment.json; that path is pre-allowed and the tool " +
      "creates the folder. Do not save it through the shell (heredoc, cat >, echo >): the " +
      "host refuses those. Then run claude-foundation change amend <change> " +
      ".foundation/drafts/<change>-amendment.json.",
    verifyOnly: {
      version: 1,
      reason: "Correct the verify command of an unfinished task",
      updateTasks: [{ key: "<existing-task-key>", verify: "<command>" }]
    },
    // A completed task's verify changes only by re-opening it, and only an
    // unfinished task can be withdrawn; neither changes a requirement.
    reopenCompleted: {
      version: 1,
      reason: "Correct the verify command of a completed task and verify it again",
      updateTasks: [{ key: "<completed-task-key>", verify: "<command>", reopen: true }]
    },
    removeUnfinished: {
      version: 1,
      reason: "<why the task is no longer needed>",
      removeTasks: ["<unfinished-task-key-or-id>"]
    },
    requirementChange: {
      version: 1,
      reason: "<what Build discovered>",
      addRequirements: [{
        key: "<new-requirement-key>", capability: "<capability>", operation: "added",
        scenarios: [{ name: "<scenario>", when: "<condition>", then: "<outcome>" }],
        outcome: "<observable outcome>"
      }],
      reviseRequirements: [],
      removeRequirements: [{ key: "<requirement-key>", migration: "<why and what replaces it>" }],
      updateTasks: [{ key: "<existing-task-key>", covers: ["<requirement-key>"] }],
      addTasks: [{
        key: "<new-task-key>", outcome: "<task outcome>", covers: ["<new-requirement-key>"],
        paths: ["<path/glob>"], verify: "<command>"
      }],
      evidence: { "<new-requirement-key>": { capabilities: ["test"] } }
    }
  };
}

export function updateTaskClaimAnnotation(line, claimIds) {
  const claims = `[claims:${unique(claimIds).join(",")}]`;
  if (/\[claims:[^\]]*\]/i.test(line))
    return line.replace(/\[claims:[^\]]*\]/i, claims);
  const marker = line.indexOf(" — verify:");
  return marker < 0
    ? `${line.trimEnd()} ${claims}`
    : `${line.slice(0, marker).trimEnd()} ${claims}${line.slice(marker)}`;
}

const renderRequirement = (spec) => renderRequirementMarkdown(spec);

export function appendRequirementToSpec(content, spec) {
  const operation = String(spec.operation || "added").toUpperCase();
  const heading = `## ${operation} Requirements`;
  const rendered = renderRequirement(spec);
  const existing = String(content || "").replace(/\s+$/, "");
  // A new capability file starts with its human heading, as start renders it.
  const source = existing || renderSpecHeading(spec);
  const start = source.indexOf(heading);
  if (start < 0) return `${source}\n\n${heading}\n\n${rendered}\n`;
  const afterHeading = start + heading.length;
  const next = source.slice(afterHeading).search(/\n##\s+/);
  if (next < 0) return `${source}\n\n${rendered}\n`;
  const insertion = afterHeading + next;
  return `${source.slice(0, insertion).replace(/\s+$/, "")}\n\n${rendered}\n\n` +
    `${source.slice(insertion).replace(/^\s+/, "")}\n`;
}

/**
 * Locate the requirement blocks whose scenario set equals the named set. A
 * block runs from its `### Requirement:` heading to the next `##`/`###`
 * heading. Scenario names are unique only within a requirement, so a partial
 * overlap never identifies a block.
 */
export function requirementBlocks(content, scenarios) {
  const names = [...new Set(stringList(scenarios))].sort();
  const lines = String(content || "").split("\n");
  const matches = [];
  if (!names.length) return { lines, matches };
  let operation = null;
  for (let index = 0; index < lines.length; index += 1) {
    const section = lines[index].match(/^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/i);
    if (section) { operation = section[1].toLowerCase(); continue; }
    if (/^##\s/.test(lines[index])) { operation = null; continue; }
    if (!/^###\s+Requirement:/.test(lines[index])) continue;
    let end = index + 1;
    while (end < lines.length && !/^##{1,2}\s/.test(lines[end])) end += 1;
    const own = [...new Set(lines.slice(index, end)
      .map((line) => line.match(/^####\s+Scenario:\s*(.+?)\s*$/)?.[1]).filter(Boolean))].sort();
    if (own.length === names.length && own.every((name, position) => name === names[position]))
      matches.push({ start: index, end, operation });
  }
  return { lines, matches };
}

/**
 * Replace (or, with a null replacement, delete) the one requirement block
 * whose scenario set equals the named set, preserving manual sections and
 * sibling requirements byte-for-byte.
 */
export function replaceRequirementBlock(content, scenarios, replacement) {
  const { lines, matches } = requirementBlocks(content, scenarios);
  if (matches.length !== 1) return { found: false, matches: matches.length, content: String(content || "") };
  const [{ start, end }] = matches;
  const inserted = replacement === null ? [] : String(replacement).split("\n");
  const rest = lines.slice(end);
  const next = [...lines.slice(0, start), ...inserted,
    ...(inserted.length && rest.length ? [""] : []), ...rest];
  let text = next.join("\n").replace(/\n{3,}/g, "\n\n");
  if (!text.endsWith("\n")) text += "\n";
  return { found: true, matches: 1, content: text };
}

function combinedCommand(tasksContent) {
  const commands = unique(String(tasksContent).split("\n").map(taskVerify).filter(Boolean));
  return commands.length === 1
    ? ["sh", "-c", commands[0]]
    : ["sh", "-c", commands.map((command) => `(${command})`).join(" && ")];
}

function amendmentList(amendment, field) {
  return Array.isArray(amendment?.[field]) ? amendment[field] : [];
}

// A corrected verify command replaces a failing check, so it must still be a
// check: a command that cannot fail would turn the task's acceptance (and any
// provider command derived from it) into a pass with no evidence behind it.
// A text screen, so best-effort: it catches a no-op as the whole command or as
// the last command after `;`, `||`, `|`, `&`, or a newline (`&&` still fails).
export function verifyCannotFail(command) {
  const text = String(command || "").trim().replace(/\s+#[^'"\n]*$/, "").trim();
  return /^\(?\s*(?:true|:|exit(?:\s+0)?|echo(?:\s.*)?|printf(?:\s.*)?)\s*\)?$/i.test(text) ||
    /(?:;|\n|\|\|?|(?<!&)&(?!&))\s*\(?\s*(?:true|:|exit(?:\s+0)?|echo(?:\s[^;&|\n]*)?|printf(?:\s[^;&|\n]*)?)\s*\)?\s*$/i
      .test(text);
}

// A test source file named in a verify command. Build used to discover a
// mistyped or never-created test path only when the check ran; the draft
// already says which files exist and which files its tasks create.
const TEST_SOURCE = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kts?|scala|php|cs|fs|swift|exs?|sh|bash|lua|dart|c|cc|cpp|clj)$/i;
const TEST_NAME = /(?:^|[/._-])(?:tests?|specs?|__tests__|e2e)(?:[/._-]|$)/i;
// A command that changes its working directory resolves paths elsewhere.
const WORKING_DIRECTORY_CHANGE =
  /(?:^|[;&|(]\s*)(?:cd|pushd)\s|--prefix\b|--cwd\b|--dir(?:ectory)?\b|--workspace\b|--filter\b|--root-dir\b|--rootDir\b|(?:^|\s)-C\s/;

export function verifyTestFileReferences(command) {
  const text = String(command || "");
  if (!text.trim() || WORKING_DIRECTORY_CHANGE.test(text)) return [];
  return unique(text.split(/\s+/).map((token) => token
    .replace(/^['"(]+|['");,]+$/g, "")
    .replace(/^--?[\w-]+=/, "")
    .replace(/::.*$/, "")
    .replace(/:\d+(?::\d+)?$/, "")
    .replace(/^\.\//, ""))
    .filter((token) => token && !token.startsWith("-") && !token.startsWith("/") &&
      !token.includes("..") && !/[*?{}[\]$<>`~]/.test(token) && !/^[a-z]+:\/\//i.test(token) &&
      TEST_SOURCE.test(token) && TEST_NAME.test(token)));
}

/**
 * Agent repairs for task verify commands that name a test file which neither
 * exists nor falls inside any task's paths (the files Build may create).
 * `tasks` rows carry { key|semanticKey|id, verify, paths, repository? };
 * `scopes` adds paths owned by tasks outside this batch.
 */
export function verifyPathIssues(tasks, { exists, scopes = [], label = "task" } = {}) {
  const rows = Array.isArray(tasks) ? tasks.filter((task) => task && typeof task === "object") : [];
  const owned = [...stringList(scopes), ...rows.flatMap((task) => stringList(task.paths))];
  const issues = [];
  rows.forEach((task, index) => {
    const repository = String(task.repository || "").trim();
    if (repository && repository !== "root") return;
    const name = String(task.semanticKey || task.key || task.id || "").trim() || `#${index + 1}`;
    for (const path of verifyTestFileReferences(task.verify)) {
      if (exists(path) || owned.some((scope) => scopeAllowsPath(scope, path))) continue;
      issues.push(`${label} '${name}' verify references '${path}', which does not exist and ` +
        "no task's paths create it; correct the path in verify or add it to that task's paths");
    }
  });
  return issues;
}

/** The same check for an amendment's added and updated tasks. */
export function amendmentVerifyPathIssues(amendment, tasksContent, { exists }) {
  const lines = String(tasksContent || "").split("\n").filter((line) => taskId(line));
  const existing = new Map(lines.map((line) => [semanticTaskKey(line) || taskId(line), line]));
  const updated = amendmentList(amendment, "updateTasks").filter((task) =>
    task && hasField(task, "verify")).map((task) => {
    const line = existing.get(keyOf(task)) || existing.get(String(task.key || "").toUpperCase());
    return { key: keyOf(task), verify: task.verify,
      paths: hasField(task, "paths") ? task.paths : line ? taskPaths(line) : [] };
  });
  const added = amendmentList(amendment, "addTasks");
  return verifyPathIssues([...added, ...updated], {
    exists, label: "amendment task",
    scopes: lines.flatMap((line) => taskPaths(line))
  });
}

// ---- Task repository binding --------------------------------------------------
// A task runs, and its verify command runs, from the root of its repository.
// A project that keeps code in declared repositories (submodules, siblings)
// must bind each task to the repository that owns its files; otherwise Build
// dispatches the work to the control root, where the code is not.

const GLOB = /[*?{}[\]]/;
const DYNAMIC_PATH = /[$`]/;

function literalPrefix(path) {
  const text = String(path || "").trim().replace(/^\.\//, "").replace(/\/+$/, "");
  const parts = text.split("/");
  const index = parts.findIndex((part) => GLOB.test(part));
  return (index < 0 ? parts : parts.slice(0, index)).join("/");
}

const atOrUnder = (path, directory) =>
  Boolean(directory) && (path === directory || path.startsWith(`${directory}/`));

function normalizedRelative(base, target) {
  const parts = [];
  for (const part of `${base ? `${base}/` : ""}${target}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length || parts.at(-1) === "..") parts.push("..");
      else parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

const unquote = (value) => String(value || "").replace(/^(['"])(.*)\1$/, "$2");

/**
 * Working-directory changes a verify command makes, resolved against the
 * directory it starts in: `cd`/`pushd` targets (which accumulate), and
 * `-C`, `--prefix`, `--cwd`, `--dir`, or `--directory` arguments (which apply
 * to one tool). Dynamic targets (`$VAR`, command substitution) are unknown and
 * omitted. A text screen, so best-effort like `verifyCannotFail`.
 */
export function verifyDirectoryTargets(command) {
  const text = String(command || "");
  const targets = [];
  let current = "";
  const pattern = new RegExp(String.raw`(?:^|[;&|(]|&&|\|\|)\s*(cd|pushd)(?=$|[\s;&|)])(?:[ \t]+("[^"]*"|'[^']*'|[^\s;&|)]+))?` +
    String.raw`|(?:^|\s)(?:-C|--prefix|--cwd|--dir|--directory)(?:=|\s+)("[^"]*"|'[^']*'|[^\s;&|)]+)`, "g");
  for (const match of text.matchAll(pattern)) {
    const raw = unquote(match[2] ?? match[3] ?? "");
    const shell = Boolean(match[1]);
    if (shell && (!raw || raw === "-")) {
      if (!raw) targets.push({ raw: "~", outside: true, path: null });
      continue;
    }
    if (DYNAMIC_PATH.test(raw)) continue;
    if (raw.startsWith("/") || raw.startsWith("~")) {
      targets.push({ raw, outside: true, path: null });
      continue;
    }
    const path = normalizedRelative(current, raw);
    const outside = path === ".." || path.startsWith("../");
    targets.push({ raw, outside, path: outside ? null : path });
    if (shell && !outside) current = path;
  }
  return targets;
}

// Declared repositories other than root: nested ones and trusted siblings
// (`../sdk`, admitted by the catalog only with allowOutsideRoot).
function catalogRepositories(repositories) {
  return (Array.isArray(repositories) ? repositories : [])
    .filter((row) => row && row.id && row.id !== "root")
    .map((row) => ({
      id: String(row.id),
      path: String(row.relativePath || "").replace(/^\.\//, "").replace(/\/+$/, ""),
      absolutePath: row.path || null,
      mode: row.mode === "read" ? "read" : "write"
    }))
    .filter((row) => row.path && row.path !== "." && row.path !== "..");
}

function selectionEntries(selection) {
  return new Map((Array.isArray(selection) ? selection : [])
    .map((entry) => typeof entry === "string" ? { id: entry } : entry)
    .filter((entry) => entry?.id).map((entry) => [String(entry.id).trim(), entry]));
}

function selectionIds(selection) {
  return (Array.isArray(selection) ? selection : [])
    .map((entry) => String(typeof entry === "string" ? entry : entry?.id || "").trim())
    .filter(Boolean);
}

/**
 * Agent repairs for tasks bound to the wrong repository: a root task whose
 * paths or verify reach into a declared repository, a repository task whose
 * paths are written from the control root, a task naming a repository the
 * draft does not select, and a verify command that changes into a directory
 * outside its task repository. `repositories` are catalog rows
 * ({id, relativePath, path}); `selection` is the draft's `repositories`.
 */
export function taskRepositoryIssues(tasks, {
  repositories = [], selection, exists = () => false, label = "task", selectionSource = "draft"
} = {}) {
  const rows = Array.isArray(tasks) ? tasks.filter((task) => task && typeof task === "object") : [];
  const declared = catalogRepositories(repositories);
  const byId = new Map(declared.map((row) => [row.id, row]));
  const selected = selectionIds(selection);
  const selectedSet = new Set(selected);
  const selectedEntries = selectionEntries(selection);
  const selectsOtherRepository = selected.some((id) => id !== "root");
  const declaredList = declared.map((row) => `${row.id} (${row.path})`).join(", ");
  const owner = (path) => declared.find((row) => atOrUnder(path, row.path)) || null;
  const issues = [];
  rows.forEach((task, index) => {
    const name = String(task.semanticKey || task.key || task.id || "").trim() || `#${index + 1}`;
    const repository = String(task.repository || "").trim() || "root";
    const repositoryRow = byId.get(repository) || null;
    const subject = `${label} '${name}'`;
    if (repository !== "root" && declared.length && !repositoryRow)
      issues.push(`${subject} names repository '${repository}', which ` +
        `openspec/repositories.yaml does not declare; use one of: ${declaredList}`);
    if (repository !== "root" && !selectedSet.has(repository))
      issues.push(selectionSource === "change"
        ? `${subject} runs in repository '${repository}', which this change does not select; ` +
          "bind it to a selected repository (a new repository needs 'change revise' before Build)"
        : `${subject} runs in repository '${repository}', which the draft's 'repositories' ` +
          `does not list; add { "id": "${repository}", "mode": "write" } to 'repositories'`);
    const mode = selectedEntries.get(repository)?.mode || repositoryRow?.mode;
    if (repositoryRow && mode === "read" && stringList(task.paths).length)
      issues.push(`${subject} edits files in repository '${repository}', which is read-only ` +
        "in this change; bind the task to a writable repository");
    if (!String(task.repository || "").trim() && selectsOtherRepository)
      issues.push(`${subject} names no 'repository' while the draft selects ` +
        `${selected.join(", ")}; set 'repository' to the one that owns its files`);
    for (const path of stringList(task.paths)) {
      const prefix = literalPrefix(path);
      if (repository === "root") {
        const inside = prefix && owner(prefix);
        if (inside)
          issues.push(`${subject} path '${path}' is inside repository '${inside.id}' ` +
            `(${inside.path}) but the task runs in root; set "repository": "${inside.id}", write ` +
            `its paths and verify relative to ${inside.path}, and list ${inside.id} in 'repositories'`);
      } else if (repositoryRow && atOrUnder(prefix, repositoryRow.path)) {
        const relativePath = path.replace(/^\.\//, "").slice(repositoryRow.path.length + 1) || "**";
        issues.push(`${subject} path '${path}' is written from the control root; task ` +
          `paths are relative to repository '${repository}', so write '${relativePath}'`);
      }
    }
    for (const target of verifyDirectoryTargets(task.verify)) {
      if (target.outside) {
        issues.push(`${subject} verify changes into '${target.raw}', outside repository ` +
          `'${repository}'; verify runs from that repository's root, so name a path inside it`);
        continue;
      }
      if (repository === "root") {
        const inside = owner(target.path);
        if (inside)
          issues.push(`${subject} verify changes into '${target.raw}', which is repository ` +
            `'${inside.id}'; set "repository": "${inside.id}" and write verify to run from its root`);
        continue;
      }
      const reached = owner(target.path);
      if (!reached) continue;
      const local = repositoryRow?.absolutePath &&
        exists(`${repositoryRow.absolutePath}/${target.path}`);
      if (local) continue;
      issues.push(reached.id === repository
        ? `${subject} verify changes into '${target.raw}', but verify already runs from ` +
          `repository '${repository}' (${reached.path}); remove that directory change`
        : `${subject} verify changes into '${target.raw}', which is repository ` +
          `'${reached.id}'; verify runs from repository '${repository}', so split the check ` +
          `into a task bound to '${reached.id}'`);
    }
  });
  return unique(issues);
}

/**
 * Repository-derived order for an amendment's added tasks, exactly as start
 * derives it: an added task follows the ledger's and the amendment's tasks in
 * repositories nested inside its own (or that its repository `dependsOn`).
 * Existing ledger lines keep their edges. `newTasks` are {id, semanticKey,
 * repository, dependsOn} rows whose dependsOn already holds task ids.
 */
export function deriveAmendmentTaskDependencies(newTasks, tasksContent, options = {}) {
  const existing = String(tasksContent || "").split("\n").filter((line) => taskId(line))
    .map((line) => ({
      id: taskId(line), semanticKey: semanticTaskKey(line),
      repository: String(line).match(/\[repo:([^\]\s]+)\]/i)?.[1] || "root",
      dependsOn: taskDepends(line)
    }));
  const derived = deriveRepositoryTaskDependencies([...existing, ...newTasks], {
    ...options, consumers: new Set(newTasks.map((task) => task.id))
  });
  return {
    tasks: derived.tasks.slice(existing.length),
    issues: derived.issues.map((issue) => `amendment ${issue}`)
  };
}

/** The repository-order issues `change amend --inspect` reports in one EDIT. */
export function amendmentRepositoryOrderIssues(amendment, tasksContent, options = {}) {
  const added = amendmentList(amendment, "addTasks").filter((task) => keyOf(task));
  if (!added.length) return [];
  const existingIds = new Map(String(tasksContent || "").split("\n")
    .filter((line) => taskId(line))
    .flatMap((line) => [[semanticTaskKey(line), taskId(line)], [taskId(line), taskId(line)]]));
  const addedKeys = new Set(added.map(keyOf));
  const resolve = (value) => addedKeys.has(value) ? value
    : existingIds.get(value) || existingIds.get(String(value).toUpperCase()) || value;
  return deriveAmendmentTaskDependencies(added.map((task) => ({
    id: keyOf(task), semanticKey: keyOf(task),
    repository: String(task.repository || "").trim() || "root",
    dependsOn: stringList(task.dependsOn).map(resolve)
  })), tasksContent, options).issues;
}

/** The same repository checks for an amendment's added and updated tasks. */
export function amendmentTaskRepositoryIssues(amendment, tasksContent, options = {}) {
  const lines = String(tasksContent || "").split("\n").filter((line) => taskId(line));
  const existing = new Map(lines.flatMap((line) => [
    [semanticTaskKey(line) || taskId(line), line], [taskId(line), line]]));
  const repositoryOf = (line) => String(line).match(/\[repo:([^\]\s]+)\]/)?.[1] || "";
  const updated = amendmentList(amendment, "updateTasks").filter((task) =>
    task && (hasField(task, "verify") || hasField(task, "paths"))).map((task) => {
    const line = existing.get(keyOf(task)) || existing.get(keyOf(task).toUpperCase()) || "";
    return { key: keyOf(task), repository: repositoryOf(line),
      verify: hasField(task, "verify") ? task.verify : "",
      paths: hasField(task, "paths") ? task.paths : [] };
  });
  return taskRepositoryIssues([...amendmentList(amendment, "addTasks"), ...updated], {
    ...options, selection: options.selection ?? ["root"], label: "amendment task",
    selectionSource: "change"
  });
}

/**
 * The verify-only amendment `change amend <change> --task <key> --verify
 * <command>` submits: an unfinished task's check corrected in place, with the
 * spec approval, requirements, claims, and capabilities untouched.
 */
export function taskVerifyAmendment({ task, verify, reason = "", reopen = false }) {
  return {
    version: 1,
    reason: String(reason || "").trim() ||
      `Correct the verify command of task '${String(task || "").trim()}'`,
    updateTasks: [{ key: String(task || "").trim(), verify: String(verify || "").trim(),
      ...(reopen === true ? { reopen: true } : {}) }]
  };
}

// Runs the verify-only amendment through the same transactional `change
// amend` path (validation, invalidation, rollback, approval carry) without the
// agent authoring a JSON file. The staged file lives in machine state and is
// removed on success, failure, or exit.
export function amendTaskVerifyOperation({ root, amendChange, pid = process.pid,
  now = Date.now, onExit = (cleanup) => process.once("exit", cleanup) }, id, options) {
  const directory = join(root, ".foundation", "amendments");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${id}-verify-${now()}-${pid}.json`);
  writeFileSync(path, `${JSON.stringify(taskVerifyAmendment(options), null, 2)}\n`);
  const cleanup = () => rmSync(path, { force: true });
  onExit(cleanup);
  try { return amendChange(id, path, { consumeAmendment: true }); }
  finally { cleanup(); }
}

function amendmentIssues(amendment) {
  const issues = [];
  if (amendment?.version !== 1) issues.push("semantic amendment requires version 1");
  for (const field of ["addRequirements", "reviseRequirements", "removeRequirements"])
    if (amendment?.[field] !== undefined && !Array.isArray(amendment[field]))
      issues.push(`semantic amendment ${field} must be an array`);
  const added = amendmentList(amendment, "addRequirements");
  const revised = amendmentList(amendment, "reviseRequirements");
  const removed = amendmentList(amendment, "removeRequirements");
  if (!added.length && !revised.length && !removed.length && !taskContractOnlyAmendment(amendment))
    issues.push("semantic amendment requires a non-empty addRequirements, " +
      "reviseRequirements, or removeRequirements array, or only updateTasks " +
      "{key, verify, paths?, dependsOn?, reopen?} rows and removeTasks");
  if ((added.length || revised.length) && (!amendment?.evidence ||
      typeof amendment.evidence !== "object" || Array.isArray(amendment.evidence)))
    issues.push("semantic amendment requires evidence keyed by each added or revised requirement");
  for (const [index, row] of removed.entries()) {
    if (!keyOf(row)) issues.push(`semantic amendment removeRequirements[${index}].key is required`);
    if (!String(row?.migration || "").trim())
      issues.push(`semantic amendment removeRequirements[${index}].migration is required`);
  }
  if (amendment?.updateTasks !== undefined && !Array.isArray(amendment.updateTasks))
    issues.push("semantic amendment updateTasks must be an array");
  for (const [index, task] of (Array.isArray(amendment?.updateTasks)
    ? amendment.updateTasks : []).entries()) {
    if (hasField(task, "verify") && (typeof task.verify !== "string" ||
        !task.verify.trim() || /[`\r\n]/.test(task.verify)))
      issues.push(`semantic amendment updateTasks[${index}].verify must be a ` +
        "non-empty one-line command without backticks");
    else if (hasField(task, "verify") && verifyCannotFail(task.verify))
      issues.push(`semantic amendment updateTasks[${index}].verify cannot be a command ` +
        "that always passes; name the focused check that proves the task");
    if (hasField(task, "paths") && (!Array.isArray(task.paths) ||
        task.paths.some((path) => typeof path !== "string" || !path.trim() || /[,\]\s]/.test(path))))
      issues.push(`semantic amendment updateTasks[${index}].paths must be an array of ` +
        "path globs without commas, brackets, or spaces");
    if (hasField(task, "dependsOn") && (!Array.isArray(task.dependsOn) ||
        task.dependsOn.some((value) => typeof value !== "string" || !value.trim())))
      issues.push(`semantic amendment updateTasks[${index}].dependsOn must be an array of task keys or ids`);
    if (hasField(task, "reopen") && typeof task.reopen !== "boolean")
      issues.push(`semantic amendment updateTasks[${index}].reopen must be true or false`);
  }
  if (amendment?.addTasks !== undefined && !Array.isArray(amendment.addTasks))
    issues.push("semantic amendment addTasks must be an array");
  if (amendment?.removeTasks !== undefined && !Array.isArray(amendment.removeTasks))
    issues.push("semantic amendment removeTasks must be an array");
  for (const [index, row] of amendmentList(amendment, "removeTasks").entries())
    if (!removalRef(row))
      issues.push(`semantic amendment removeTasks[${index}] must name a task key or id`);
  return issues;
}

export function compileSemanticAmendment({
  amendment, contract, tasksContent, slugify, renderTask, semanticDraftVersion = 3,
  loadCanonicalSpec = null, provenClaimIds = [], retiredTaskIds = [],
  repositories = null, repositorySelection = null
}) {
  const issues = amendmentIssues(amendment);
  if (![3, 4].includes(semanticDraftVersion))
    issues.push("semantic amendment requires semanticDraftVersion 3 or 4");
  const existingClaims = contract.claims || [];
  const priorClaimById = new Map(existingClaims.map((claim) => [claim.id, claim]));
  const claimsByRequirement = new Map();
  for (const claim of existingClaims) {
    if (!claim.requirementKey) continue;
    claimsByRequirement.set(claim.requirementKey, [
      ...(claimsByRequirement.get(claim.requirementKey) || []), claim.id
    ]);
  }
  const taskLines = String(tasksContent).split("\n");
  const tasksByKey = new Map();
  const tasksById = new Map();
  // A withdrawn task's id is never reused, so its old leases, receipts, and
  // audit rows cannot be mistaken for a new task's.
  let maxTask = Math.max(0, ...stringList(retiredTaskIds)
    .map((id) => Number(id.replace(/^T/i, "")) || 0));
  for (const [index, line] of taskLines.entries()) {
    const id = taskId(line);
    if (id) maxTask = Math.max(maxTask, Number(id.slice(1)) || 0);
    if (id) tasksById.set(id, { index, line, id, key: semanticTaskKey(line) });
    const key = semanticTaskKey(line);
    if (key) tasksByKey.set(key, { index, line, id });
  }
  const resolveTaskId = (reference) => {
    const value = String(reference || "").trim();
    return tasksByKey.get(value)?.id || tasksById.get(value.toUpperCase())?.id || null;
  };
  // The agent sees task ids in every Build action; a task-contract row may
  // name one (`T002`) in place of the semantic key it resolves to.
  if (Array.isArray(amendment?.updateTasks)) {
    const keyById = new Map([...tasksByKey].filter(([, row]) => row.id)
      .map(([key, row]) => [row.id, key]));
    amendment = { ...amendment, updateTasks: amendment.updateTasks.map((row) => {
      const named = keyOf(row);
      const resolved = !tasksByKey.has(named) && keyById.get(named.toUpperCase());
      return resolved ? { ...row, key: resolved } : row;
    }) };
  }

  // Outcome never changes in place. Verify, paths, and dependencies change in
  // place only on an unfinished task (unchecked and without a passing command
  // receipt), or on a completed one that `reopen: true` unticks so the
  // harness verifies it again: a changed check never keeps a completed status.
  const proven = new Set(stringList(provenClaimIds));
  const completedTask = (line) => taskCompleted(line) ||
    taskClaims(line).some((id) => proven.has(id));
  const taskContractChanges = [];
  for (const [index, update] of (Array.isArray(amendment?.updateTasks)
    ? amendment.updateTasks : []).entries()) {
    const row = tasksByKey.get(keyOf(update));
    const completed = row && completedTask(row.line);
    const changes = {};
    if (row && typeof update?.verify === "string" && update.verify.trim() !== taskVerify(row.line)) {
      changes.verify = update.verify.trim();
      changes.priorVerify = taskVerify(row.line) || null;
    }
    if (row && Array.isArray(update?.paths) &&
        JSON.stringify(stringList(update.paths)) !== JSON.stringify(taskPaths(row.line)))
      changes.paths = stringList(update.paths);
    if (row && Array.isArray(update?.dependsOn)) {
      const references = stringList(update.dependsOn);
      const unknown = references.filter((reference) => !resolveTaskId(reference));
      const dependsOn = unique(references.map(resolveTaskId).filter(Boolean));
      if (unknown.length)
        issues.push(`semantic amendment updateTasks[${index}].dependsOn references unknown ` +
          `task(s): ${unknown.join(", ")}`);
      else if (dependsOn.includes(row.id))
        issues.push(`semantic amendment updateTasks[${index}].dependsOn cannot name the task itself`);
      else if (JSON.stringify(dependsOn) !== JSON.stringify(taskDepends(row.line)))
        changes.dependsOn = dependsOn;
    }
    const reopening = Boolean(completed && update?.reopen === true &&
      TASK_CONTRACT_FIELDS.some((field) => hasField(changes, field)));
    const unsupported = [
      ...(hasField(update, "outcome") ? ["outcome"] : []),
      ...(completed && !reopening
        ? TASK_CONTRACT_FIELDS.filter((field) => hasField(changes, field)) : [])
    ];
    if (unsupported.length)
      issues.push(`semantic amendment updateTasks[${index}] cannot replace ${
        unsupported.join(" or ")}; add a new task so completed work keeps its meaning` +
        (unsupported.includes("outcome") ? "" : ", or set \"reopen\": true to re-open the " +
          "task so the harness verifies it again"));
    else if (row && Object.keys(changes).length)
      taskContractChanges.push({ key: keyOf(update), index: row.index, ...changes,
        ...(reopening ? { reopened: true } : {}) });
  }

  // Only unfinished work can be withdrawn. A task another task depends on
  // stays unless that dependent is withdrawn too or its dependsOn is updated.
  const removalRefs = amendmentList(amendment, "removeTasks").map(removalRef).filter(Boolean);
  const removedTaskRows = [];
  for (const reference of unique(removalRefs)) {
    const id = resolveTaskId(reference);
    const row = id ? tasksById.get(id) : null;
    if (!row) {
      issues.push(`amendment removeTasks references unknown task '${reference}'`);
      continue;
    }
    if (removedTaskRows.some((removed) => removed.id === row.id)) continue;
    if (completedTask(row.line)) {
      issues.push(`amendment cannot remove completed task '${row.key || row.id}' (${row.id}); ` +
        "completed work keeps its meaning, so remove its requirement or start a successor change");
      continue;
    }
    if ((amendment.updateTasks || []).some((update) => resolveTaskId(keyOf(update)) === row.id))
      issues.push(`amendment cannot both update and remove task '${row.key || row.id}'`);
    removedTaskRows.push({ ...row, claims: taskClaims(row.line), verify: taskVerify(row.line) });
  }
  const removedTaskIds = new Set(removedTaskRows.map((row) => row.id));
  if (taskContractOnlyAmendment(amendment) && !taskContractChanges.length &&
      !removalRefs.length &&
      (amendment.updateTasks || []).every((update) => tasksByKey.has(keyOf(update))) &&
      !issues.some((issue) => issue.startsWith("semantic amendment updateTasks[")))
    issues.push("semantic amendment updateTasks changes no verify command or paths (or dependencies)");
  for (const change of taskContractChanges) {
    let line = taskLines[change.index];
    if (change.verify !== undefined) line = replaceTaskVerify(line, change.verify);
    if (change.paths !== undefined) line = replaceTaskPaths(line, change.paths);
    if (change.dependsOn !== undefined) line = replaceTaskDepends(line, change.dependsOn);
    if (change.reopened) line = reopenTask(line);
    taskLines[change.index] = line;
    tasksByKey.set(change.key, { ...tasksByKey.get(change.key), line });
  }
  for (const line of taskLines) {
    const id = taskId(line);
    if (!id || removedTaskIds.has(id)) continue;
    const blocked = taskDepends(line).filter((dependency) => removedTaskIds.has(dependency));
    if (blocked.length)
      issues.push(`amendment cannot remove ${blocked.join(", ")}: task ${id} depends on it; ` +
        `remove ${id} too or update its dependsOn`);
  }
  for (const task of amendmentList(amendment, "addTasks"))
    for (const dependency of stringList(task?.dependsOn))
      if (removedTaskIds.has(resolveTaskId(dependency)))
        issues.push(`amendment task '${keyOf(task)}' depends on removed task '${dependency}'`);
  // Removed lines (and their indented detail lines) leave the ledger last, so
  // every index above stays valid while the amendment is checked.
  for (const row of removedTaskRows) {
    taskLines[row.index] = null;
    for (let next = row.index + 1; next < taskLines.length; next += 1) {
      const line = taskLines[next];
      if (line === null || taskId(line) || !/^\s+\S/.test(line)) break;
      taskLines[next] = null;
    }
    if (row.key) tasksByKey.delete(row.key);
  }

  const addRequirements = amendmentList(amendment, "addRequirements");
  const reviseRequirements = amendmentList(amendment, "reviseRequirements");
  const removeRequirements = amendmentList(amendment, "removeRequirements");
  const addedKeys = new Set(addRequirements.map(keyOf));
  const revisedKeys = new Set(reviseRequirements.map(keyOf).filter(Boolean));
  const removedKeys = new Set(removeRequirements.map(keyOf).filter(Boolean));
  const changedKeys = new Set([...addedKeys, ...revisedKeys]);
  const named = [...addRequirements, ...reviseRequirements, ...removeRequirements]
    .map(keyOf).filter(Boolean);
  for (const key of unique(named.filter((key, index) => named.indexOf(key) !== index)))
    issues.push(`amendment requirement '${key}' is named more than once across ` +
      "add, revise, and remove");
  for (const key of addedKeys)
    if (claimsByRequirement.has(key)) issues.push(`amendment requirement '${key}' already exists`);
  for (const key of [...revisedKeys, ...removedKeys])
    if (!claimsByRequirement.has(key))
      issues.push(`amendment requirement '${key}' does not exist; only existing ` +
        "requirements can be revised or removed");
  const retiredClaimIds = new Set([...revisedKeys, ...removedKeys]
    .flatMap((key) => claimsByRequirement.get(key) || []));

  const updateKeys = new Set((amendment.updateTasks || []).map(keyOf));
  const coverageTasks = [
    ...(amendment.updateTasks || []).map((task) => ({
      key: task.key,
      outcome: `Extend ${task.key}`,
      verify: taskVerify(tasksByKey.get(task.key)?.line),
      covers: stringList(task.covers).filter((key) => changedKeys.has(key))
    })),
    ...(amendment.addTasks || []).map((task) => ({ ...task, dependsOn: [] })),
    // Existing tasks bound to a revised requirement keep covering it.
    ...[...tasksByKey].filter(([key]) => !updateKeys.has(key)).map(([key, row]) => ({
      key,
      outcome: `Keep ${key}`,
      verify: taskVerify(row.line) || "existing",
      covers: [...revisedKeys].filter((requirement) =>
        (claimsByRequirement.get(requirement) || [])
          .some((id) => taskClaims(row.line).includes(id)))
    }))
  ].filter((task) => stringList(task.covers).some((key) => changedKeys.has(key)));
  // A removal-only amendment adds no semantic rows, so there is nothing to
  // normalize; the prior discovery coverage stays in the proposal.
  const normalized = !changedKeys.size ? {
    issues: [], draft: { claims: [], specs: [], execution: { providers: {} } }
  } : normalizeSemanticDraft({
    version: semanticDraftVersion,
    intent: amendment.reason || "Amend the active agreement",
    impact: amendment.impact || "low",
    requirements: [...addRequirements,
      ...reviseRequirements.map((row) => ({ ...row, _revision: true }))],
    tasks: coverageTasks,
    evidence: amendment.evidence,
    integrations: amendment.integrations || [],
    securityTriggers: amendment.securityTriggers || [],
    riskSignals: amendment.riskSignals || [],
    externalOperations: amendment.externalOperations || [],
    ...(amendment.capabilityOverviews && typeof amendment.capabilityOverviews === "object"
      ? { capabilityOverviews: amendment.capabilityOverviews } : {}),
    discovery: amendment.discovery
  }, slugify, {
    ...(loadCanonicalSpec ? { loadCanonicalSpec } : {}),
    // Derived IDs for new scenarios step around the claims this change keeps.
    reservedClaimIds: [...priorClaimById.keys()].filter((id) => !retiredClaimIds.has(id))
  });
  issues.push(...normalized.issues.map((issue) => `amendment ${issue}`));
  const duplicateClaims = normalized.draft.claims
    .map((claim) => claim.id).filter((id) => priorClaimById.has(id) && !retiredClaimIds.has(id));
  if (duplicateClaims.length)
    issues.push(`amendment derives existing claim ID(s): ${unique(duplicateClaims).join(", ")}`);

  for (const update of amendment.updateTasks || []) {
    const key = String(update?.key || "").trim();
    if (!tasksByKey.has(key)) issues.push(`amendment updateTasks references unknown task '${key}'`);
    for (const covered of stringList(update?.covers)) {
      if (removedKeys.has(covered))
        issues.push(`amendment task '${key}' covers removed requirement '${covered}'`);
      else if (!changedKeys.has(covered) && !claimsByRequirement.has(covered))
        issues.push(`amendment task '${key}' covers unknown requirement '${covered}'`);
    }
  }
  for (const task of amendment.addTasks || []) {
    const key = String(task?.key || "").trim();
    if (tasksByKey.has(key)) issues.push(`amendment addTasks key '${key}' already exists`);
    for (const dependency of stringList(task?.dependsOn))
      if (!tasksByKey.has(dependency) &&
          !(amendment.addTasks || []).some((candidate) => candidate.key === dependency))
        issues.push(`amendment task '${key}' depends on unknown task '${dependency}'`);
  }

  // A revised requirement changes behavior that completed work did not build,
  // so it needs at least one open task rather than a silently reopened one.
  const openCoverage = new Set();
  for (const task of amendment.addTasks || []) stringList(task.covers).forEach((key) => openCoverage.add(key));
  for (const update of amendment.updateTasks || []) {
    const row = tasksByKey.get(keyOf(update));
    if (row && !taskCompleted(row.line)) stringList(update.covers).forEach((key) => openCoverage.add(key));
  }
  for (const line of taskLines) {
    if (!taskId(line) || taskCompleted(line)) continue;
    for (const key of revisedKeys)
      if ((claimsByRequirement.get(key) || []).some((id) => taskClaims(line).includes(id)))
        openCoverage.add(key);
  }
  for (const key of revisedKeys)
    if (!openCoverage.has(key))
      issues.push(`amendment revises '${key}' but no open task covers it; add a task ` +
        "with addTasks so completed tasks keep their meaning");

  const addedClaimsByRequirement = new Map();
  for (const claim of normalized.draft.claims)
    addedClaimsByRequirement.set(claim.requirementKey, [
      ...(addedClaimsByRequirement.get(claim.requirementKey) || []), claim.id
    ]);
  const claimsFor = (key) => addedClaimsByRequirement.get(key) ||
    (removedKeys.has(key) ? [] : claimsByRequirement.get(key)) || [];
  const allClaimsFor = (keys) => unique(stringList(keys).flatMap(claimsFor));
  const replaceClaimIds = (ids) => unique(ids.flatMap((id) => {
    if (!retiredClaimIds.has(id)) return [id];
    const key = priorClaimById.get(id)?.requirementKey;
    return revisedKeys.has(key) ? claimsFor(key) : [];
  }));

  const updates = new Map((amendment.updateTasks || []).map((task) => [keyOf(task), task]));
  const orphaned = [];
  for (const [index, line] of taskLines.entries()) {
    if (!taskId(line)) continue;
    const current = taskClaims(line);
    const update = updates.get(semanticTaskKey(line));
    if (!update && !current.some((id) => retiredClaimIds.has(id))) continue;
    const next = unique([...replaceClaimIds(current),
      ...(update ? allClaimsFor(update.covers) : [])]);
    if (current.length && !next.length) orphaned.push(taskId(line));
    taskLines[index] = updateTaskClaimAnnotation(line, next);
  }
  if (orphaned.length)
    issues.push(`amendment would leave task(s) ${orphaned.join(", ")} without requirement ` +
      "coverage; move their coverage with updateTasks");
  // A withdrawn task must not take the last implementation of a claim with it.
  if (removedTaskRows.length) {
    const remaining = new Set([
      ...taskLines.filter((line) => line !== null && taskId(line)).flatMap(taskClaims),
      ...amendmentList(amendment, "addTasks").flatMap((task) => allClaimsFor(task?.covers))
    ]);
    for (const row of removedTaskRows) {
      const uncovered = replaceClaimIds(row.claims).filter((id) => !remaining.has(id));
      if (uncovered.length)
        issues.push(`amendment cannot remove task '${row.key || row.id}' (${row.id}): claim(s) ` +
          `${uncovered.join(", ")} would have no task; move them with updateTasks covers, ` +
          "add a task, or remove the requirement with removeRequirements");
    }
  }
  if (issues.length) return { issues };

  const newTasks = [];
  const allocated = new Map(tasksByKey);
  for (const task of amendment.addTasks || []) {
    maxTask += 1;
    const id = `T${String(maxTask).padStart(3, "0")}`;
    allocated.set(task.key, { id });
    newTasks.push({ ...task, id, semanticKey: task.key, claims: allClaimsFor(task.covers) });
  }
  for (const task of newTasks)
    task.dependsOn = stringList(task.dependsOn).map((key) => allocated.get(key)?.id);
  if (newTasks.length && (Array.isArray(repositories) || Array.isArray(repositorySelection))) {
    const ordered = deriveAmendmentTaskDependencies(newTasks.map((task) => ({
      id: task.id, semanticKey: task.semanticKey,
      repository: String(task.repository || "").trim() || "root", dependsOn: task.dependsOn
    })), tasksContent, { repositories: repositories || [], selection: repositorySelection });
    if (ordered.issues.length) return { issues: ordered.issues };
    ordered.tasks.forEach((row, index) => { newTasks[index].dependsOn = row.dependsOn; });
  }
  const renderedNewTasks = newTasks.map((task, index) => renderTask(task, maxTask + index));
  let nextTasks = taskLines.filter((line) => line !== null).join("\n").replace(/\s+$/, "");
  if (renderedNewTasks.length) nextTasks += `\n${renderedNewTasks.join("\n")}`;
  nextTasks += "\n";

  const providers = {};
  for (const [name, config] of Object.entries(contract.providers || {}))
    providers[name] = Array.isArray(config?.claims)
      ? { ...config, claims: replaceClaimIds(config.claims) } : config;
  const allCommand = combinedCommand(nextTasks);
  for (const [name, config] of Object.entries(normalized.draft.execution.providers || {})) {
    if (!providers[name]) providers[name] = { ...config, command: config.command ? allCommand : undefined };
    else if (providers[name].command && ["command", "test-discovery"].includes(providers[name].adapter))
      providers[name] = { ...providers[name], command: allCommand };
  }
  // A provider command derived from the task verify commands follows them;
  // an explicitly configured command stays as the author wrote it.
  if (taskContractChanges.some((change) => change.verify !== undefined) ||
      removedTaskRows.length) {
    const priorCommand = JSON.stringify(combinedCommand(tasksContent));
    for (const [name, config] of Object.entries(providers))
      if (["command", "test-discovery"].includes(config?.adapter) &&
          JSON.stringify(config.command) === priorCommand)
        providers[name] = { ...config, command: allCommand };
  }
  const taskContractTasks = taskContractChanges.map((change) => {
    const line = taskLines[change.index];
    return {
      key: change.key, id: taskId(line), claims: taskClaims(line),
      // The prior command stays in the amendment audit, so a corrected check
      // is reviewable against the one it replaced.
      ...(change.verify !== undefined
        ? { verify: change.verify, priorVerify: change.priorVerify } : {}),
      ...(change.paths !== undefined ? { paths: change.paths } : {}),
      ...(change.dependsOn !== undefined ? { dependsOn: change.dependsOn } : {}),
      ...(change.reopened ? { reopened: true } : {})
    };
  });
  const taskContractClaimIds = unique(taskContractTasks.flatMap((task) => task.claims));
  // The audit keeps what a withdrawn task promised; its claims are proven
  // again by the tasks that now carry them.
  const removedTasks = removedTaskRows.map((row) => ({
    key: row.key || null, id: row.id, claims: row.claims, verify: row.verify || null
  }));
  const removedTaskClaimIds = unique(removedTaskRows.flatMap((row) => replaceClaimIds(row.claims)));
  const priorScenarios = (key) => (claimsByRequirement.get(key) || [])
    .map((id) => priorClaimById.get(id)?.scenario).filter(Boolean);
  const specs = normalized.draft.specs;
  const nextClaims = [
    ...existingClaims.filter((claim) => !retiredClaimIds.has(claim.id)),
    ...normalized.draft.claims
  ];
  const nextClaimIds = new Set(nextClaims.map((claim) => claim.id));
  const addedClaimIds = [...addedKeys].flatMap((key) => addedClaimsByRequirement.get(key) || []);
  const changedClaimIds = [...revisedKeys].flatMap((key) => addedClaimsByRequirement.get(key) || []);
  return {
    issues: [],
    tasksContent: nextTasks,
    claims: nextClaims,
    providers,
    specs: specs.slice(0, addRequirements.length),
    revisedSpecs: specs.slice(addRequirements.length).map((spec, index) => ({
      key: keyOf(reviseRequirements[index]),
      spec,
      explicitTitle: Boolean(String(reviseRequirements[index]?.requirement ||
        reviseRequirements[index]?.title || "").trim()),
      priorScenarios: priorScenarios(keyOf(reviseRequirements[index]))
    })),
    removedRequirements: removeRequirements.map((row) => ({
      key: keyOf(row),
      migration: String(row.migration).trim(),
      priorScenarios: priorScenarios(keyOf(row))
    })),
    discovery: normalized.draft.discovery,
    amendmentReason: amendment.reason || "Agreement expanded during Build",
    invalidatedClaims: unique([...addedClaimIds, ...changedClaimIds, ...taskContractClaimIds,
      ...removedTaskClaimIds]),
    addedClaimIds,
    changedClaimIds,
    taskContractChanges: taskContractTasks,
    taskContractClaimIds,
    removedTasks,
    removedTaskClaimIds,
    removedClaimIds: [...retiredClaimIds].filter((id) => !nextClaimIds.has(id)),
    priorClaims: existingClaims,
    addedRequirementKeys: [...addedKeys],
    revisedRequirementKeys: [...revisedKeys],
    removedRequirementKeys: [...removedKeys]
  };
}

function specFiles(dir) {
  const root = join(dir, "specs");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, "spec.md"))
    .filter((path) => existsSync(path)).sort();
}

// Exactly one block across the change's spec files must carry the key's prior
// scenario set; zero or several matches fail the amendment rather than
// rewriting a sibling requirement.
function rewriteRequirementBlock(dir, key, scenarios, replacement, target = null) {
  const candidates = specFiles(dir).flatMap((path) => {
    const content = readFileSync(path, "utf8");
    const lines = content.split("\n");
    return requirementBlocks(content, scenarios).matches.map((match) => ({
      path, content, operation: match.operation,
      name: lines[match.start].match(/^###\s+Requirement:\s*(.+?)\s*$/)?.[1] || ""
    }));
  });
  if (candidates.length !== 1)
    throw new Error(`amendment cannot identify the requirement block for '${key}': ` +
      `${candidates.length} blocks carry its scenarios (${stringList(scenarios).join(", ") || "none"})`);
  const [{ path, content, operation, name }] = candidates;
  // A revision replaces the block in place, so it must stay in the same
  // capability delta and operation section; moving it is a remove plus an add.
  if (target) {
    const capability = join(path, "..").split(/[\\/]/).pop();
    const nextOperation = String(target.operation || "added").toLowerCase();
    if (capability !== target.capability || operation !== nextOperation)
      throw new Error(`amendment cannot revise '${key}' from ${capability}/${operation || "unknown"} ` +
        `to ${target.capability}/${nextOperation}; remove it and add a new requirement instead`);
  }
  const result = replaceRequirementBlock(content, scenarios,
    typeof replacement === "function" ? replacement(name) : replacement);
  if (/^###\s+Requirement:/m.test(result.content)) writeFileSync(path, result.content);
  else {
    // A delta file with no requirement left is not a valid OpenSpec delta.
    rmSync(path, { force: true });
    const capabilityDir = join(path, "..");
    if (!readdirSync(capabilityDir).length) rmSync(capabilityDir, { recursive: true, force: true });
  }
}

export function writeSemanticAmendment(dir, compiled, slugify, { schema } = {}) {
  writeFileSync(join(dir, "tasks.md"), compiled.tasksContent);
  const evidencePath = join(dir, "evidence.yaml");
  const contract = JSON.parse(readFileSync(evidencePath, "utf8"));
  contract.claims = compiled.claims;
  contract.providers = compiled.providers;
  writeFileSync(evidencePath, `${JSON.stringify(contract, null, 2)}\n`);
  const proposalPath = join(dir, "proposal.md");
  if (compiled.discovery?.coverage?.length && existsSync(proposalPath)) {
    const rows = compiled.discovery.coverage.map((row) =>
      `| ${markdownCell(row.dimension)} | ${markdownCell(coverageStatus(row))} | ` +
      `${markdownCell((row.covers || []).join(", ") || "none")} | ` +
      `${markdownCell((row.sources || []).join(", ") || "none")} | ` +
      `${markdownCell(coverageRationale(row) || "none")} |`
    ).join("\n");
    const section = `\n\n## Amendment discovery coverage\n\n` +
      `Reason: ${markdownCell(compiled.amendmentReason)}\n\n` +
      `| Dimension | Status | Requirements | Sources | Rationale |\n` +
      `|---|---|---|---|---|\n${rows}\n`;
    const proposal = readFileSync(proposalPath, "utf8").replace(/\s+$/, "");
    writeFileSync(proposalPath, `${proposal}${section}`);
  }
  if (compiled.removedRequirements?.length && existsSync(proposalPath)) {
    const rows = compiled.removedRequirements.map((row) =>
      `| ${markdownCell(row.key)} | ${markdownCell(row.migration)} |`).join("\n");
    const proposal = readFileSync(proposalPath, "utf8").replace(/\s+$/, "");
    writeFileSync(proposalPath, `${proposal}\n\n## Amendment removed requirements\n\n` +
      `Reason: ${markdownCell(compiled.amendmentReason)}\n\n` +
      `| Requirement | Migration |\n|---|---|\n${rows}\n`);
  }
  // A legacy rapid agreement (skip_specs) carries its scenarios in
  // evidence.yaml only; writing a delta beside skip_specs creates an
  // unmergeable packet. A compiled rapid packet has deltas and amends them.
  const marker = existsSync(join(dir, ".openspec.yaml"))
    ? readFileSync(join(dir, ".openspec.yaml"), "utf8") : "skip_specs: true";
  if (schema === "foundation-rapid" && /^\s*skip_specs:\s*true\s*$/m.test(marker)) return;
  const appendSpec = (spec) => {
    const capability = slugify(spec.name);
    const specDir = join(dir, "specs", capability);
    mkdirSync(specDir, { recursive: true });
    const specPath = join(specDir, "spec.md");
    // A capability with no living spec states its Purpose, as start does.
    const current = existsSync(specPath) ? readFileSync(specPath, "utf8")
      : `${renderSpecHeading({ name: spec.name, purpose: spec.purpose }, {
        newCapability: !existsSync(join(dir, "..", "..", "specs", capability, "spec.md"))
      })}\n`;
    writeFileSync(specPath, appendRequirementToSpec(current, spec));
  };
  for (const spec of compiled.specs) appendSpec(spec);
  for (const row of compiled.revisedSpecs || [])
    // A revision without its own title keeps the requirement's heading, so a
    // derived title is not replaced by the key.
    rewriteRequirementBlock(dir, row.key, row.priorScenarios, (priorName) => renderRequirement(
      row.explicitTitle || !priorName ? row.spec : { ...row.spec, requirement: priorName }), {
      capability: slugify(row.spec.name), operation: row.spec.operation
    });
  for (const row of compiled.removedRequirements || [])
    rewriteRequirementBlock(dir, row.key, row.priorScenarios, null);
}
