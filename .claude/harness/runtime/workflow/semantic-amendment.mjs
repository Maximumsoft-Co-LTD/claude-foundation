import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { join } from "node:path";
import { normalizeSemanticDraft } from "./semantic-draft.mjs";

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

export function updateTaskClaimAnnotation(line, claimIds) {
  const claims = `[claims:${unique(claimIds).join(",")}]`;
  if (/\[claims:[^\]]*\]/i.test(line))
    return line.replace(/\[claims:[^\]]*\]/i, claims);
  const marker = line.indexOf(" — verify:");
  return marker < 0
    ? `${line.trimEnd()} ${claims}`
    : `${line.slice(0, marker).trimEnd()} ${claims}${line.slice(marker)}`;
}

function renderRequirement(spec) {
  const scenarios = (spec.scenarios || []).map((scenario) =>
    `#### Scenario: ${scenario.name}\n\n- **WHEN** ${scenario.when}\n` +
    `- **THEN** ${scenario.then}`).join("\n\n");
  const migration = String(spec.operation || "added").toLowerCase() === "removed"
    ? `\n\n**Migration:** ${spec.migration}` : "";
  return `### Requirement: ${spec.requirement}\n\n${spec.description}${migration}` +
    (scenarios ? `\n\n${scenarios}` : "");
}

export function appendRequirementToSpec(content, spec) {
  const operation = String(spec.operation || "added").toUpperCase();
  const heading = `## ${operation} Requirements`;
  const rendered = renderRequirement(spec);
  const source = String(content || "").replace(/\s+$/, "");
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
  if (!added.length && !revised.length && !removed.length)
    issues.push("semantic amendment requires a non-empty addRequirements, " +
      "reviseRequirements, or removeRequirements array");
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
  for (const [index, task] of (amendment?.updateTasks || []).entries()) {
    const unsupported = ["outcome", "verify"].filter((field) =>
      Object.prototype.hasOwnProperty.call(task || {}, field));
    if (unsupported.length)
      issues.push(`semantic amendment updateTasks[${index}] cannot replace ${
        unsupported.join(" or ")}; add a new task so completed work keeps its meaning`);
  }
  if (amendment?.addTasks !== undefined && !Array.isArray(amendment.addTasks))
    issues.push("semantic amendment addTasks must be an array");
  return issues;
}

export function compileSemanticAmendment({
  amendment, contract, tasksContent, slugify, renderTask, semanticDraftVersion = 3,
  loadCanonicalSpec = null
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
    requirements: [...addRequirements, ...reviseRequirements],
    tasks: coverageTasks,
    evidence: amendment.evidence,
    integrations: amendment.integrations || [],
    securityTriggers: amendment.securityTriggers || [],
    riskSignals: amendment.riskSignals || [],
    externalOperations: amendment.externalOperations || [],
    discovery: amendment.discovery
  }, slugify, loadCanonicalSpec ? { loadCanonicalSpec } : {});
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
      priorScenarios: priorScenarios(keyOf(reviseRequirements[index]))
    })),
    removedRequirements: removeRequirements.map((row) => ({
      key: keyOf(row),
      migration: String(row.migration).trim(),
      priorScenarios: priorScenarios(keyOf(row))
    })),
    discovery: normalized.draft.discovery,
    amendmentReason: amendment.reason || "Agreement expanded during Build",
    invalidatedClaims: [...addedClaimIds, ...changedClaimIds],
    addedClaimIds,
    changedClaimIds,
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
    return requirementBlocks(content, scenarios).matches.map((match) =>
      ({ path, content, operation: match.operation }));
  });
  if (candidates.length !== 1)
    throw new Error(`amendment cannot identify the requirement block for '${key}': ` +
      `${candidates.length} blocks carry its scenarios (${stringList(scenarios).join(", ") || "none"})`);
  const [{ path, content, operation }] = candidates;
  // A revision replaces the block in place, so it must stay in the same
  // capability delta and operation section; moving it is a remove plus an add.
  if (target) {
    const capability = join(path, "..").split(/[\\/]/).pop();
    const nextOperation = String(target.operation || "added").toLowerCase();
    if (capability !== target.capability || operation !== nextOperation)
      throw new Error(`amendment cannot revise '${key}' from ${capability}/${operation || "unknown"} ` +
        `to ${target.capability}/${nextOperation}; remove it and add a new requirement instead`);
  }
  const result = replaceRequirementBlock(content, scenarios, replacement);
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
  // Rapid agreements carry their scenarios in evidence.yaml, just like start.
  // Writing a delta while skip_specs remains true creates an unmergeable packet.
  if (schema === "foundation-rapid") return;
  const appendSpec = (spec) => {
    const capability = slugify(spec.name);
    const specDir = join(dir, "specs", capability);
    mkdirSync(specDir, { recursive: true });
    const specPath = join(specDir, "spec.md");
    const current = existsSync(specPath)
      ? readFileSync(specPath, "utf8") : `# ${spec.name}\n`;
    writeFileSync(specPath, appendRequirementToSpec(current, spec));
  };
  for (const spec of compiled.specs) appendSpec(spec);
  for (const row of compiled.revisedSpecs || [])
    rewriteRequirementBlock(dir, row.key, row.priorScenarios, renderRequirement(row.spec), {
      capability: slugify(row.spec.name), operation: row.spec.operation
    });
  for (const row of compiled.removedRequirements || [])
    rewriteRequirementBlock(dir, row.key, row.priorScenarios, null);
}
