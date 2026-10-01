import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { join } from "node:path";
import {
  normalizeSemanticDraft, renderRequirementMarkdown, renderSpecHeading
} from "./semantic-draft.mjs";

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

const TASK_CONTRACT_FIELDS = ["verify", "paths"];
const hasField = (row, field) => Object.prototype.hasOwnProperty.call(row || {}, field);

/**
 * A task-contract amendment only corrects the verify command (and optionally
 * the paths) of existing tasks. It carries no requirement change, so it needs
 * no requirement, evidence, or semantic-intake input.
 */
export function taskContractOnlyAmendment(amendment) {
  const updates = amendment?.updateTasks;
  return ["addRequirements", "reviseRequirements", "removeRequirements", "addTasks"]
    .every((field) => !amendmentList(amendment, field).length) &&
    Array.isArray(updates) && updates.length > 0 &&
    updates.every((row) => row && typeof row === "object" && !Array.isArray(row) &&
      hasField(row, "verify") &&
      Object.keys(row).every((field) => ["key", ...TASK_CONTRACT_FIELDS].includes(field)));
}

/** The shape `change amend --template` prints; the verify-only form leads. */
export function semanticAmendmentTemplate() {
  return {
    verifyOnly: {
      version: 1,
      reason: "Correct the verify command of an unfinished task",
      updateTasks: [{ key: "<existing-task-key>", verify: "<command>" }]
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
      "{key, verify, paths?} rows");
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
    if (hasField(task, "paths") && (!Array.isArray(task.paths) ||
        task.paths.some((path) => typeof path !== "string" || !path.trim() || /[,\]\s]/.test(path))))
      issues.push(`semantic amendment updateTasks[${index}].paths must be an array of ` +
        "path globs without commas, brackets, or spaces");
  }
  if (amendment?.addTasks !== undefined && !Array.isArray(amendment.addTasks))
    issues.push("semantic amendment addTasks must be an array");
  return issues;
}

export function compileSemanticAmendment({
  amendment, contract, tasksContent, slugify, renderTask, semanticDraftVersion = 3,
  loadCanonicalSpec = null, provenClaimIds = []
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
  let maxTask = 0;
  for (const [index, line] of taskLines.entries()) {
    const id = taskId(line);
    if (id) maxTask = Math.max(maxTask, Number(id.slice(1)) || 0);
    const key = semanticTaskKey(line);
    if (key) tasksByKey.set(key, { index, line, id });
  }

  // Outcome never changes in place. Verify and paths change in place only on
  // an unfinished task: unchecked and without a passing command receipt.
  const proven = new Set(stringList(provenClaimIds));
  const taskContractChanges = [];
  for (const [index, update] of (Array.isArray(amendment?.updateTasks)
    ? amendment.updateTasks : []).entries()) {
    const row = tasksByKey.get(keyOf(update));
    const completed = row && (taskCompleted(row.line) ||
      taskClaims(row.line).some((id) => proven.has(id)));
    const changes = {};
    if (row && typeof update?.verify === "string" && update.verify.trim() !== taskVerify(row.line))
      changes.verify = update.verify.trim();
    if (row && Array.isArray(update?.paths) &&
        JSON.stringify(stringList(update.paths)) !== JSON.stringify(taskPaths(row.line)))
      changes.paths = stringList(update.paths);
    const unsupported = [
      ...(hasField(update, "outcome") ? ["outcome"] : []),
      ...(completed ? TASK_CONTRACT_FIELDS.filter((field) => hasField(changes, field)) : [])
    ];
    if (unsupported.length)
      issues.push(`semantic amendment updateTasks[${index}] cannot replace ${
        unsupported.join(" or ")}; add a new task so completed work keeps its meaning`);
    else if (row && Object.keys(changes).length)
      taskContractChanges.push({ key: keyOf(update), index: row.index, ...changes });
  }
  if (taskContractOnlyAmendment(amendment) && !taskContractChanges.length &&
      amendment.updateTasks.every((update) => tasksByKey.has(keyOf(update))) &&
      !issues.some((issue) => issue.startsWith("semantic amendment updateTasks[")))
    issues.push("semantic amendment updateTasks changes no verify command or paths");
  for (const change of taskContractChanges) {
    let line = taskLines[change.index];
    if (change.verify !== undefined) line = replaceTaskVerify(line, change.verify);
    if (change.paths !== undefined) line = replaceTaskPaths(line, change.paths);
    taskLines[change.index] = line;
    tasksByKey.set(change.key, { ...tasksByKey.get(change.key), line });
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
  const renderedNewTasks = newTasks.map((task, index) => renderTask(task, maxTask + index));
  let nextTasks = taskLines.join("\n").replace(/\s+$/, "");
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
  if (taskContractChanges.some((change) => change.verify !== undefined)) {
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
      ...(change.verify !== undefined ? { verify: change.verify } : {}),
      ...(change.paths !== undefined ? { paths: change.paths } : {})
    };
  });
  const taskContractClaimIds = unique(taskContractTasks.flatMap((task) => task.claims));
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
    invalidatedClaims: unique([...addedClaimIds, ...changedClaimIds, ...taskContractClaimIds]),
    addedClaimIds,
    changedClaimIds,
    taskContractChanges: taskContractTasks,
    taskContractClaimIds,
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
      `| ${markdownCell(row.dimension)} | ${markdownCell(row.status)} | ` +
      `${markdownCell((row.covers || []).join(", ") || "none")} | ` +
      `${markdownCell((row.sources || []).join(", ") || "none")} | ` +
      `${markdownCell(row.rationale || "none")} |`
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
