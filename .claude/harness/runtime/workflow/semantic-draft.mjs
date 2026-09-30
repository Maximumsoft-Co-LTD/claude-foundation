import { parseSpecDocument } from "../contracts/change-artifacts.mjs";
import {
  normalizeDiscovery, semanticIntakeIssues
} from "./validation/semantic-intake.mjs";
import { designBlueprintIssues } from "./validation/design-blueprints.mjs";
import { readerGuideIssues } from "./validation/reader-guide.mjs";

const OPERATIONS = new Set(["added", "modified", "removed"]);
const AUTHORITY_CAPABILITIES = new Set(["review", "acceptance", "semantic-acceptance"]);
const PLACEHOLDER = /(?:replace-with|needs clarification|\btodo\b|\btbd\b|<[^>]+>)/i;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

function unique(values) {
  return [...new Set(values)];
}

function textList(value) {
  return typeof value === "string" ? [text(value)].filter(Boolean) : stringList(value);
}

// Readability limits for v4 requirement statements. A statement longer than
// this is almost always several requirements or scenario detail in one clause.
const STATEMENT_MAX_WORDS = 60;
const STATEMENT_MAX_CHARACTERS = 400;
const STATEMENT_MAX_SEMICOLONS = 2;

function placeholderIssue(value, label, issues) {
  if (PLACEHOLDER.test(text(value))) issues.push(`${label} contains unresolved placeholder text`);
}

function semanticScenarios(requirement) {
  const source = Array.isArray(requirement.scenarios)
    ? requirement.scenarios
    : requirement.scenario !== undefined ? [requirement.scenario] : [];
  return source.map((entry, index) => {
    const object = typeof entry === "string" ? { scenario: entry } : entry || {};
    const fallbackName = text(object.scenario) || text(object.when) ||
      `${text(requirement.key) || "scenario"}-${index + 1}`;
    const given = textList(object.given);
    const and = textList(object.and);
    return {
      key: text(object.key) || fallbackName,
      name: text(object.name) || fallbackName,
      ...(given.length ? { given } : {}),
      when: text(object.when) || text(object.scenario),
      then: text(object.then) || text(object.outcome) || text(requirement.outcome),
      ...(and.length ? { and } : {}),
      ...(text(object.kind) ? { kind: text(object.kind).toLowerCase() } : {})
    };
  });
}

function rawScenarioEntries(requirement) {
  return Array.isArray(requirement?.scenarios) ? requirement.scenarios
    : requirement?.scenario !== undefined ? [requirement.scenario] : [];
}

function comparableLabel(value) {
  return text(value).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}

// A v4 scenario reads as one titled case: a short name distinct from WHEN,
// preconditions in GIVEN, one trigger, and one outcome plus optional AND lines.
// A modified or amendment-revised requirement may name an existing scenario
// by its title alone, so only a new scenario must carry its own name.
function readableScenarioIssues(requirement, operation, label, issues) {
  for (const [index, entry] of rawScenarioEntries(requirement).entries()) {
    const scenario = typeof entry === "string" ? { when: entry } : entry || {};
    const at = `${label}.scenarios[${index}]`;
    const name = text(scenario.name);
    const when = text(scenario.when) || text(scenario.scenario);
    if (!name && operation !== "modified" && !requirement?._revision)
      issues.push(`${at}.name is required: give the scenario a short title; without one the heading repeats WHEN`);
    else if (name && comparableLabel(name) === comparableLabel(when))
      issues.push(`${at}.name repeats WHEN; use a short title and keep the trigger in 'when'`);
    else if (name && name.length > 80)
      issues.push(`${at}.name is longer than 80 characters; shorten it to a title`);
    const fields = [
      ["given", textList(scenario.given)], ["when", [when]],
      ["then", [text(scenario.then) || text(scenario.outcome)]], ["and", textList(scenario.and)]
    ];
    for (const [field, values] of fields)
      if (values.some((value) => value.includes(";")))
        issues.push(`${at}.${field} joins several cases with ';'; split them into separate ` +
          "scenarios, put preconditions in 'given', and extra outcomes in 'and'");
  }
}

function lowerFirst(value) {
  return value.replace(/^([A-Z])(?=[a-z])/, (letter) => letter.toLowerCase());
}

// v3 keeps its historical stem. v4 never glues an English stem onto a whole
// sentence: an explicit description wins, an outcome that already states
// SHALL/MUST is used as written, an English result clause becomes "The system
// SHALL ensure that <outcome>", an English verb phrase follows "The system
// SHALL", and any other language must supply the statement itself.
function requirementStatement(requirement, outcome, version, operation, label, issues) {
  const description = text(requirement?.description);
  if (version !== 4)
    return description || (outcome ? `The system SHALL ${outcome.replace(/[.]$/, "")}.` : "");
  let statement = description;
  if (!statement && outcome) {
    if (/\b(?:SHALL|MUST)\b/.test(outcome)) statement = outcome;
    else if (/[^\x00-\x7F]/.test(outcome))
      issues.push(`${label}.description is required: write the full statement in the ` +
        "document language and keep the SHALL marker");
    else {
      // A result clause ("The card appears", "a board renders") takes "ensure
      // that"; a verb phrase ("record one payment") follows SHALL directly.
      const body = outcome.replace(/[.]$/, "");
      statement = /^(?:[A-Z]|(?:a|an|the|each|every|no|all|any|its|their|this|these|those)\b)/
        .test(body)
        ? `The system SHALL ensure that ${lowerFirst(body)}.`
        : `The system SHALL ${body}.`;
    }
  }
  if (!statement || operation === "removed") return statement;
  if (!/\b(?:SHALL|MUST)\b/.test(statement))
    issues.push(`${label}.description must state the requirement with SHALL or MUST`);
  const words = statement.split(/\s+/).filter(Boolean).length;
  const semicolons = (statement.match(/;/g) || []).length;
  if (words > STATEMENT_MAX_WORDS || statement.length > STATEMENT_MAX_CHARACTERS ||
      semicolons > STATEMENT_MAX_SEMICOLONS)
    issues.push(`${label} statement is too long (${words} words, ${statement.length} characters, ` +
      `${semicolons} ';'); split it into separate requirements, move cases into scenarios, ` +
      "or list constraints in 'details'");
  return statement;
}

function canonicalScenarioDetails(body) {
  const scenarios = [];
  let current = null;
  for (const line of String(body || "").split("\n")) {
    const heading = line.match(/^####\s+Scenario:\s*(.+?)\s*$/i);
    if (heading) {
      current = { key: heading[1], name: heading[1], when: "", then: "" };
      scenarios.push(current);
      continue;
    }
    if (!current) continue;
    const given = line.match(/^\s*-\s*\*\*GIVEN\*\*\s+(.+?)\s*$/i);
    const when = line.match(/^\s*-\s*\*\*WHEN\*\*\s+(.+?)\s*$/i);
    const then = line.match(/^\s*-\s*\*\*THEN\*\*\s+(.+?)\s*$/i);
    const and = line.match(/^\s*-\s*\*\*AND\*\*\s+(.+?)\s*$/i);
    if (given) current.given = [...(current.given || []), given[1]];
    if (when) current.when = when[1];
    if (then) current.then = then[1];
    if (and) current.and = [...(current.and || []), and[1]];
  }
  return scenarios;
}

function mergeCanonicalScenarios(requirement, canonicalText, label, issues) {
  if (!canonicalText) {
    issues.push(`${label} is modified but canonical specification is unavailable`);
    return semanticScenarios(requirement);
  }
  const name = text(requirement?.requirement || requirement?.title) || text(requirement?.key);
  const current = parseSpecDocument(canonicalText).find((row) =>
    row.name.toLowerCase() === name.toLowerCase());
  if (!current) {
    issues.push(`${label} cannot find canonical requirement '${name}' to modify`);
    return semanticScenarios(requirement);
  }
  const canonical = canonicalScenarioDetails(current.body);
  const supplied = semanticScenarios(requirement);
  const suppliedByName = new Map(supplied.map((scenario) =>
    [scenario.name.toLowerCase(), scenario]));
  const merged = canonical.map((scenario) =>
    suppliedByName.get(scenario.name.toLowerCase()) || scenario);
  for (const scenario of supplied) {
    if (!canonical.some((row) => row.name.toLowerCase() === scenario.name.toLowerCase()))
      merged.push(scenario);
  }
  return merged;
}

function evidenceEntries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Map();
  return new Map(Object.entries(value));
}

function requiredIntegrationCapabilities(integration) {
  const concerns = new Set(stringList(integration.concerns).map((value) => value.toLowerCase()));
  const capabilities = ["integration"];
  if ([...concerns].some((value) =>
    /auth|credential|signature|webhook|secret|permission/.test(value)))
    capabilities.push("security-static");
  if ([...concerns].some((value) =>
    /retry|timeout|rate.limit|partial|degrad|recover/.test(value)))
    capabilities.push("resilience");
  if ([...concerns].some((value) =>
    /compat|version|schema|public.contract/.test(value)))
    capabilities.push("compatibility");
  return capabilities;
}

// Mirrors the rapid-lane test in change-lifecycle atomicStartPreflight. Only a
// draft that can land on foundation-rapid may leave evidence capabilities to
// the compiler; preflight rejects a defaulted draft that ends up standard.
export function semanticRapidCandidate(source) {
  const triggers = [
    ...stringList(source?.securityTriggers),
    ...(Array.isArray(source?.integrations) ? source.integrations : [])
      .filter((integration) =>
        requiredIntegrationCapabilities(integration || {}).includes("security-static"))
      .map(() => "external-integration-authentication")
  ].filter((trigger) => trigger.toLowerCase() !== "none");
  return (text(source?.impact) || "low") === "low" &&
    (text(source?.coupling) || "isolated") === "isolated" &&
    !triggers.length && !source?.reviewRequired && !source?.acceptance?.required;
}

function semanticDraftIssues(source, { defaultTestEvidence = false } = {}) {
  const issues = [];
  if (![3, 4].includes(source?.version)) issues.push("semantic draft requires version 3 or 4");
  if (!text(source?.intent)) issues.push("semantic draft requires non-empty 'intent'");
  if (!Array.isArray(source?.requirements) || source.requirements.length === 0)
    issues.push("semantic draft requires a non-empty 'requirements' array");
  if (!Array.isArray(source?.tasks) || source.tasks.length === 0)
    issues.push("semantic draft requires a non-empty 'tasks' array");
  if (!(defaultTestEvidence && source?.evidence === undefined) &&
      (!source?.evidence || typeof source.evidence !== "object" || Array.isArray(source.evidence)))
    issues.push("semantic draft requires an 'evidence' object keyed by requirement key");
  if (source?.integrations !== undefined && !Array.isArray(source.integrations))
    issues.push("semantic draft integrations must be an array");
  if (source?.capabilityOverviews !== undefined && !Array.isArray(source.capabilityOverviews))
    issues.push("semantic draft capabilityOverviews must be an array of { capability, title, overview } or an object keyed by capability");
  if (source?.language !== undefined &&
      !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(text(source.language)))
    issues.push("semantic draft language must be a BCP 47 tag such as 'en' or 'th'");
  if (source?.diagrams !== undefined && !Array.isArray(source.diagrams))
    issues.push("semantic draft diagrams must be an array");
  if (source?.decisions !== undefined && !Array.isArray(source.decisions))
    issues.push("semantic draft decisions must be an array");
  if (source?.risks !== undefined && !Array.isArray(source.risks))
    issues.push("semantic draft risks must be an array");
  if (source?.repositories !== undefined && !Array.isArray(source.repositories))
    issues.push("semantic draft repositories must be an array");
  if (source?.externalOperations !== undefined && !Array.isArray(source.externalOperations))
    issues.push("semantic draft externalOperations must be an array");
  if (source?.prototypeSelection !== undefined) {
    if (!text(source.prototypeSelection?.reference))
      issues.push("semantic draft prototypeSelection.reference is required");
    if (!text(source.prototypeSelection?.selected))
      issues.push("semantic draft prototypeSelection.selected is required");
  }
  placeholderIssue(source?.intent, "semantic draft intent", issues);
  for (const [index, decision] of (source?.decisions || []).entries()) {
    if (!text(decision?.key)) issues.push(`semantic draft decisions[${index}].key is required`);
    if (!text(decision?.choice)) issues.push(`semantic draft decisions[${index}].choice is required`);
    if (!text(decision?.reason || decision?.why))
      issues.push(`semantic draft decisions[${index}].reason is required`);
  }
  const choices = new Map();
  for (const decision of source?.decisions || []) {
    const key = text(decision?.key);
    const choice = text(decision?.choice);
    if (!key) continue;
    if (choices.has(key) && choices.get(key) !== choice)
      issues.push(`semantic draft has contradictory decisions for '${key}'`);
    else if (choices.has(key)) issues.push(`semantic draft decision key '${key}' is duplicated`);
    choices.set(key, choice);
  }
  issues.push(...designBlueprintIssues(source));
  issues.push(...semanticIntakeIssues(source));
  return issues;
}

function normalizeRequirements(source, slugify, issues, {
  loadCanonicalSpec = null, defaultTestEvidence = false, defaultedEvidence = []
} = {}) {
  const evidence = evidenceEntries(source.evidence);
  const requirements = [];
  const requirementKeys = new Set();
  const claimIds = new Set();
  const knownRequirementKeys = new Set((source.requirements || []).map((row) => text(row?.key)));
  for (const evidenceKey of evidence.keys())
    if (!knownRequirementKeys.has(evidenceKey))
      issues.push(`semantic draft evidence references unknown requirement '${evidenceKey}'`);

  for (const [index, requirement] of (source.requirements || []).entries()) {
    const label = `semantic draft requirements[${index}]`;
    const key = text(requirement?.key);
    if (!key) issues.push(`${label}.key is required`);
    else if (requirementKeys.has(key)) issues.push(`${label}.key '${key}' is duplicated`);
    requirementKeys.add(key);
    const capability = text(requirement?.capability);
    if (!capability) issues.push(`${label}.capability is required`);
    const operation = text(requirement?.operation || "added").toLowerCase();
    if (!OPERATIONS.has(operation))
      issues.push(`${label}.operation must be added|modified|removed`);
    const outcome = text(requirement?.outcome);
    if (!outcome && operation !== "removed") issues.push(`${label}.outcome is required`);
    const scenarios = operation === "modified"
      ? mergeCanonicalScenarios(requirement,
        loadCanonicalSpec ? loadCanonicalSpec(capability) : null, label, issues)
      : semanticScenarios(requirement);
    if (!scenarios.length && operation !== "removed")
      issues.push(`${label}.scenario or .scenarios is required`);
    if (source.version === 4) readableScenarioIssues(requirement, operation, label, issues);
    const statement = requirementStatement(
      requirement, outcome, source.version, operation, label, issues);
    const details = textList(requirement?.details);
    for (const [scenarioIndex, scenario] of scenarios.entries()) {
      for (const field of ["name", "when", "then"])
        if (!scenario[field]) issues.push(`${label}.scenarios[${scenarioIndex}].${field} is required`);
    }
    if (operation === "removed" && !text(requirement?.migration))
      issues.push(`${label}.migration is required for removed requirements`);
    placeholderIssue(key, `${label}.key`, issues);
    placeholderIssue(capability, `${label}.capability`, issues);
    placeholderIssue(outcome, `${label}.outcome`, issues);

    const evidenceValue = evidence.get(key);
    const capabilities = unique([
      ...stringList(evidenceValue?.capabilities),
      ...stringList(requirement?.capabilities)
    ]);
    // A rapid draft proves every requirement with its covering tasks' verify
    // commands, so an omitted capability list means exactly that: "test".
    if (defaultTestEvidence && !capabilities.length &&
        evidenceValue?.capabilities === undefined && requirement?.capabilities === undefined) {
      capabilities.push("test");
      defaultedEvidence.push(key);
    } else if (!evidenceValue && !requirement?.capabilities)
      issues.push(`${label} requires evidence['${key}'].capabilities ` +
        "(only a low-impact, isolated draft without security triggers, review, or acceptance " +
        "may omit it and default to [\"test\"])");
    if (!capabilities.length)
      issues.push(`${label} requires at least one evidence capability`);

    const repositories = unique(stringList(requirement?.repositories));
    if (repositories.length > 1 && !capabilities.includes("cross-repo-contract"))
      capabilities.push("cross-repo-contract");
    const scenarioClaims = scenarios.map((scenario, scenarioIndex) => {
      // A title in a non-Latin script slugifies to nothing; its position keeps
      // the claim id stable instead.
      const rawSuffix = String(scenario.key || "");
      const suffix = /[a-z0-9]/i.test(rawSuffix) ? rawSuffix : String(scenarioIndex + 1);
      const id = slugify(scenarios.length === 1 ? key : `${key}-${suffix}`);
      if (!id) issues.push(`${label} cannot derive a stable claim ID`);
      else if (claimIds.has(id)) issues.push(`${label} derives duplicate claim ID '${id}'`);
      claimIds.add(id);
      return {
        id,
        requirementKey: key,
        scenario: scenario.name,
        impact: text(evidenceValue?.impact || requirement?.impact || source.impact || "low"),
        capabilities,
        ...(repositories.length ? { repositories } : {})
      };
    });
    requirements.push({
      key,
      claimIds: scenarioClaims.map((claim) => claim.id),
      claims: scenarioClaims,
      spec: {
        name: capability,
        operation,
        requirement: text(requirement?.requirement || requirement?.title) || key,
        description: statement,
        ...(details.length ? { details } : {}),
        scenarios,
        ...(operation === "removed" ? { migration: text(requirement.migration) } : {})
      }
    });
  }
  return { requirements, requirementKeys };
}

// Authors naturally key overviews by capability:
// `{ "<capability>": { title, overview } }` or `{ "<capability>": "overview" }`.
// Normalize that map to the canonical array; any other shape stays as given so
// validation reports it.
export function capabilityOverviewList(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.entries(value).map(([capability, entry]) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? { ...entry, capability: text(entry.capability) || capability }
      : { capability, overview: entry });
}

// A capability overview gives its spec file a human title and a short
// orientation paragraph above the requirement deltas.
function applyCapabilityOverviews(source, requirements, slugify, issues) {
  if (!Array.isArray(source.capabilityOverviews)) return;
  const seen = new Set();
  for (const [index, entry] of source.capabilityOverviews.entries()) {
    const label = `semantic draft capabilityOverviews[${index}]`;
    const capability = slugify(text(entry?.capability));
    const specs = requirements.map((row) => row.spec)
      .filter((spec) => text(entry?.capability) && slugify(spec.name) === capability);
    if (!text(entry?.capability)) issues.push(`${label}.capability is required`);
    else if (!specs.length)
      issues.push(`${label}.capability '${entry.capability}' matches no requirement capability`);
    else if (seen.has(capability))
      issues.push(`${label}.capability '${entry.capability}' is duplicated`);
    seen.add(capability);
    if (!text(entry?.overview)) issues.push(`${label}.overview is required`);
    placeholderIssue(entry?.title, `${label}.title`, issues);
    placeholderIssue(entry?.overview, `${label}.overview`, issues);
    for (const spec of specs) {
      if (text(entry?.title)) spec.title = text(entry.title);
      if (text(entry?.overview)) spec.overview = text(entry.overview);
    }
  }
}

function applyIntegrationRequirements(source, requirements, requirementKeys, issues) {
  const byKey = new Map(requirements.map((row) => [row.key, row]));
  for (const [index, integration] of (source.integrations || []).entries()) {
    const label = `semantic draft integrations[${index}]`;
    if (!text(integration?.key)) issues.push(`${label}.key is required`);
    if (!text(integration?.kind)) issues.push(`${label}.kind is required`);
    if (!text(integration?.documentation?.source))
      issues.push(`${label}.documentation.source is required`);
    if (!text(integration?.documentation?.version))
      issues.push(`${label}.documentation.version is required`);
    if (!Array.isArray(integration?.concerns) || !stringList(integration.concerns).length)
      issues.push(`${label}.concerns must name the integration risks to cover`);
    const relatesTo = stringList(integration?.relatesTo);
    if (!relatesTo.length) issues.push(`${label}.relatesTo must name at least one requirement`);
    const unknown = relatesTo.filter((key) => !requirementKeys.has(key));
    if (unknown.length) issues.push(`${label}.relatesTo references unknown requirement(s): ${unknown.join(", ")}`);
    const relatedScenarios = relatesTo.flatMap((key) => byKey.get(key)?.spec?.scenarios || []);
    for (const scenarioKind of ["success", "failure"])
      if (!relatedScenarios.some((scenario) => scenario.kind === scenarioKind))
        issues.push(`${label} requires a related scenario with kind '${scenarioKind}'`);
    const capabilities = requiredIntegrationCapabilities(integration);
    for (const key of relatesTo) {
      const requirement = byKey.get(key);
      if (!requirement) continue;
      for (const claim of requirement.claims)
        claim.capabilities = unique([...claim.capabilities, ...capabilities]);
    }
  }
}

function normalizeTasks(source, requirements, requirementKeys, issues) {
  const claimsByRequirement = new Map(requirements.map((row) => [row.key, row.claimIds]));
  const taskIds = new Map();
  for (const [index, task] of (source.tasks || []).entries()) {
    const key = text(task?.key) || `task-${index + 1}`;
    const id = text(task?.id) || `T${String(index + 1).padStart(3, "0")}`;
    if (taskIds.has(key)) issues.push(`semantic draft tasks[${index}].key '${key}' is duplicated`);
    if ([...taskIds.values()].includes(id)) issues.push(`semantic draft tasks[${index}].id '${id}' is duplicated`);
    taskIds.set(key, id);
    placeholderIssue(key, `semantic draft tasks[${index}].key`, issues);
  }

  const covered = new Set();
  const tasks = (source.tasks || []).map((task, index) => {
    const label = `semantic draft tasks[${index}]`;
    const key = text(task?.key) || `task-${index + 1}`;
    const covers = stringList(task?.covers);
    if (!text(task?.outcome)) issues.push(`${label}.outcome is required`);
    if (!text(task?.verify)) issues.push(`${label}.verify is required`);
    if (!covers.length) issues.push(`${label}.covers must name at least one requirement`);
    const unknown = covers.filter((value) => !requirementKeys.has(value));
    if (unknown.length) issues.push(`${label}.covers references unknown requirement(s): ${unknown.join(", ")}`);
    covers.forEach((value) => covered.add(value));
    const dependencyKeys = stringList(task?.dependsOn);
    const unknownDependencies = dependencyKeys.filter((value) => !taskIds.has(value));
    if (unknownDependencies.length)
      issues.push(`${label}.dependsOn references unknown task(s): ${unknownDependencies.join(", ")}`);
    const dependsOn = dependencyKeys.map((value) => taskIds.get(value)).filter(Boolean);
    placeholderIssue(task?.outcome, `${label}.outcome`, issues);
    placeholderIssue(task?.verify, `${label}.verify`, issues);
    return {
      id: taskIds.get(key),
      semanticKey: key,
      outcome: text(task?.outcome),
      verify: text(task?.verify),
      repository: text(task?.repository) || undefined,
      kind: text(task?.kind) || "implementation",
      paths: stringList(task?.paths),
      dependsOn,
      resources: stringList(task?.resources),
      claims: unique(covers.flatMap((value) => claimsByRequirement.get(value) || [])),
      requestedModel: text(task?.requestedModel || task?.model) || undefined,
      inputSchema: text(task?.inputSchema) || undefined,
      outputSchema: text(task?.outputSchema) || undefined
    };
  });
  const uncovered = [...requirementKeys].filter((key) => !covered.has(key));
  if (uncovered.length)
    issues.push(`semantic draft requirements have no implementation task: ${uncovered.join(", ")}`);
  const graph = new Map(tasks.map((task) => [task.id, task.dependsOn]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((graph.get(id) || []).some(visit)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if (tasks.some((task) => visit(task.id)))
    issues.push("semantic draft task dependencies contain a cycle");
  return tasks;
}

function derivedExecution(source, claims, tasks) {
  if (source.execution) return source.execution;
  const commands = unique(tasks.map((task) => task.verify).filter(Boolean));
  const command = commands.length === 1
    ? ["sh", "-c", commands[0]]
    : ["sh", "-c", commands.map((value) => `(${value})`).join(" && ")];
  const capabilities = unique(claims.flatMap((claim) => claim.capabilities));
  const providers = {};
  for (const capability of capabilities) {
    if (capability === "discovery") continue;
    if (AUTHORITY_CAPABILITIES.has(capability)) {
      providers[capability] = { adapter: "external", capability, claims: "declared" };
      continue;
    }
    providers[capability] = capability === "test"
      ? {
          adapter: "test-discovery", command, minimum: 1,
          reportFormat: "auto", claims: "declared"
        }
      : { adapter: "command", capability, command, claims: "declared" };
  }
  return { version: 1, providers, services: {} };
}

export function normalizeSemanticDraft(input, slugify, options = {}) {
  const source = input?.capabilityOverviews === undefined ? input
    : { ...input, capabilityOverviews: capabilityOverviewList(input.capabilityOverviews) };
  const defaultTestEvidence = Boolean(options.defaultRapidEvidence) &&
    semanticRapidCandidate(source);
  const defaultedEvidence = [];
  const issues = semanticDraftIssues(source, { defaultTestEvidence });
  const { requirements, requirementKeys } = normalizeRequirements(
    source, slugify, issues, { ...options, defaultTestEvidence, defaultedEvidence });
  applyIntegrationRequirements(source, requirements, requirementKeys, issues);
  applyCapabilityOverviews(source, requirements, slugify, issues);
  const tasks = normalizeTasks(source, requirements, requirementKeys, issues);
  issues.push(...readerGuideIssues(source, requirementKeys));
  const claims = requirements.flatMap((row) => row.claims);
  const acceptance = source.acceptance || { required: false, reason: null, claimIds: [] };
  const acceptanceRequirements = stringList(acceptance.requirements);
  const acceptanceClaimIds = acceptanceRequirements.flatMap((key) => {
    const row = requirements.find((requirement) => requirement.key === key);
    if (!row) issues.push(`semantic draft acceptance references unknown requirement '${key}'`);
    return row?.claimIds || [];
  });
  const securityTriggers = unique([
    ...stringList(source.securityTriggers),
    ...(source.integrations || []).flatMap((integration) =>
      requiredIntegrationCapabilities(integration).includes("security-static")
        ? ["external-integration-authentication"] : [])
  ]);
  const draft = {
    ...source,
    _semanticVersion: source.version,
    _derivedExecution: !source.execution,
    ...(defaultedEvidence.length ? { _defaultedEvidence: defaultedEvidence } : {}),
    why: text(source.why) || text(source.intent),
    currentState: text(source.currentState) || "none",
    compatibility: text(source.compatibility) || "none",
    changes: stringList(source.changes).length
      ? stringList(source.changes)
      : unique(requirements.map((row) => row.spec.scenarios[0]?.then).filter(Boolean)),
    nonGoals: stringList(source.nonGoals),
    decisions: Array.isArray(source.decisions) ? source.decisions : [],
    risks: Array.isArray(source.risks) ? source.risks : [],
    domainLanguage: Array.isArray(source.domainLanguage) ? source.domainLanguage : [],
    impact: text(source.impact) || "low",
    coupling: text(source.coupling) || "isolated",
    securityTriggers,
    acceptance: {
      required: Boolean(acceptance.required),
      reason: acceptance.required ? text(acceptance.reason) : null,
      claimIds: unique([
        ...stringList(acceptance.claimIds),
        ...acceptanceClaimIds
      ])
    },
    tasks,
    claims,
    specs: requirements.map((row) => row.spec),
    _requirementKeys: requirements.map((row) => row.key),
    execution: derivedExecution(source, claims, tasks),
    externalOperations: Array.isArray(source.externalOperations)
      ? source.externalOperations : undefined,
    repositories: Array.isArray(source.repositories) ? source.repositories : undefined
  };
  if (source.version === 4) draft.discovery = normalizeDiscovery(source);
  return { draft, issues };
}

// One renderer for start, revise, and amendments. Structural keywords stay
// English so OpenSpec parses them; everything between them is document prose.
export function renderScenarioMarkdown(scenario) {
  return [
    `#### Scenario: ${scenario.name}`, "",
    ...textList(scenario.given).map((value) => `- **GIVEN** ${value}`),
    `- **WHEN** ${scenario.when}`,
    `- **THEN** ${scenario.then}`,
    ...textList(scenario.and).map((value) => `- **AND** ${value}`)
  ].join("\n");
}

export function renderRequirementMarkdown(spec, scenarios = spec.scenarios || []) {
  const details = textList(spec.details).map((value) => `- ${value}`).join("\n");
  const migration = String(spec.operation || "added").toLowerCase() === "removed"
    ? `\n\n**Migration:** ${spec.migration}` : "";
  const rendered = scenarios.map(renderScenarioMarkdown).join("\n\n");
  return `### Requirement: ${spec.requirement}\n\n${spec.description}` +
    (details ? `\n\n${details}` : "") + migration + (rendered ? `\n\n${rendered}` : "");
}

export function renderSpecHeading(spec) {
  const title = text(spec?.title) || text(spec?.name);
  return `# ${title}` + (text(spec?.overview) ? `\n\n${text(spec.overview)}` : "");
}

export function semanticDraftTemplate() {
  return {
    version: 4,
    intent: "Describe one observable outcome",
    summary: "Say in 1-3 plain sentences what changes and who benefits",
    why: "Explain the concrete user or system value",
    userStories: [{
      priority: "P1", asA: "a named user", iWant: "the observable outcome",
      soThat: "the benefit", covers: ["observable-outcome"]
    }],
    successCriteria: ["State how the result is judged, with a measurable threshold"],
    impact: "low",
    coupling: "isolated",
    workType: ["feature"],
    requirements: [{
      key: "observable-outcome",
      capability: "change",
      operation: "added",
      description: "The system SHALL provide the observable behavior",
      outcome: "Describe the observable result",
      scenarios: [{
        name: "Short scenario title",
        given: "The precondition or state before the trigger",
        when: "One triggering input or event",
        then: "One observable result",
        and: ["Another result of the same case, if any"]
      }]
    }],
    tasks: [{
      key: "implement-outcome",
      outcome: "Implement and verify the bounded outcome",
      covers: ["observable-outcome"],
      paths: ["src/**"],
      verify: "npm test"
    }],
    evidence: {
      "observable-outcome": { capabilities: ["test"] }
    },
    discovery: {
      coverage: [
        { dimension: "current-behavior", status: "needs-investigation" },
        { dimension: "affected-actor", status: "needs-user-decision" },
        { dimension: "desired-behavior", status: "covered", covers: ["observable-outcome"] },
        { dimension: "success-path", status: "covered", covers: ["observable-outcome"] },
        { dimension: "failure-path", status: "needs-user-decision" },
        { dimension: "input-boundary", status: "needs-user-decision" },
        { dimension: "compatibility", status: "needs-investigation" },
        { dimension: "non-goals", status: "needs-user-decision" },
        { dimension: "verification", status: "covered", covers: ["observable-outcome"] }
      ],
      decisions: []
    }
  };
}
