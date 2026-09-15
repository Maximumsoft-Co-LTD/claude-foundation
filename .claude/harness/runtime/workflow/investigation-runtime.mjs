import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { inspectRepositoryIntelligence } from "./validation/repository-intelligence.mjs";
import { inspectSemanticSources } from "./validation/semantic-source-inventory.mjs";

export const INVESTIGATION_STATE_VERSION = 1;
const OUTCOMES = new Set([
  "investigating", "needs-user-decision", "ready-for-change", "not-worth-changing"
]);
const HYPOTHESIS_STATUSES = new Set(["open", "supported", "falsified"]);
const DECISION_STATUSES = new Set(["open", "resolved"]);
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const text = (value) => typeof value === "string" ? value.trim() : "";
const strings = (value) => Array.isArray(value)
  ? value.map(text).filter(Boolean) : [];
const unique = (values) => [...new Set(values)].sort();

export function investigationRecordTemplate() {
  return {
    version: 1,
    id: "replace-with-investigation-id",
    problem: "Describe the uncertainty or decision to investigate",
    mode: "analyze",
    sources: [],
    facts: [],
    hypotheses: [],
    options: [],
    selection: null,
    decisions: [],
    conclusion: { status: "investigating", summary: "Investigation is in progress" },
    changeIntent: null
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => [key, canonical(value[key])])
  );
  return value;
}

function digest(value, domain = "foundation-investigation:1") {
  return createHash("sha256").update(`${domain}\0`)
    .update(JSON.stringify(canonical(value))).digest("hex");
}

function within(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function recordIssues(record) {
  const issues = [];
  if (!record || typeof record !== "object" || Array.isArray(record))
    return ["investigation record must be an object"];
  if (record.version !== 1) issues.push("investigation record version must be 1");
  if (!ID_PATTERN.test(text(record.id)))
    issues.push("investigation record id must be a lowercase kebab-case identifier");
  if (!text(record.problem)) issues.push("investigation record problem is required");
  const mode = text(record.mode).toLowerCase();
  if (!new Set(["analyze", "compare"]).has(mode))
    issues.push("investigation record mode must be analyze|compare");
  if (!Array.isArray(record.sources)) issues.push("investigation record sources must be an array");
  if (!Array.isArray(record.facts)) issues.push("investigation record facts must be an array");
  if (!Array.isArray(record.hypotheses))
    issues.push("investigation record hypotheses must be an array");
  if (!Array.isArray(record.decisions)) issues.push("investigation record decisions must be an array");
  const factKeys = new Set();
  for (const [index, fact] of (record.facts || []).entries()) {
    const label = `facts[${index}]`;
    const key = text(fact?.key);
    if (!key) issues.push(`${label}.key is required`);
    else if (factKeys.has(key)) issues.push(`${label}.key '${key}' is duplicated`);
    factKeys.add(key);
    if (!text(fact?.statement)) issues.push(`${label}.statement is required`);
    if (!strings(fact?.sources).length) issues.push(`${label}.sources must ground the fact`);
  }
  const hypothesisKeys = new Set();
  for (const [index, hypothesis] of (record.hypotheses || []).entries()) {
    const label = `hypotheses[${index}]`;
    const key = text(hypothesis?.key);
    const status = text(hypothesis?.status).toLowerCase();
    if (!key) issues.push(`${label}.key is required`);
    else if (hypothesisKeys.has(key)) issues.push(`${label}.key '${key}' is duplicated`);
    hypothesisKeys.add(key);
    if (!text(hypothesis?.statement)) issues.push(`${label}.statement is required`);
    if (!HYPOTHESIS_STATUSES.has(status))
      issues.push(`${label}.status must be open|supported|falsified`);
    const evidence = strings(hypothesis?.factKeys);
    if (status !== "open" && !evidence.length)
      issues.push(`${label}.factKeys must support a settled hypothesis`);
    for (const key of evidence)
      if (!factKeys.has(key)) issues.push(`${label}.factKeys references unknown fact '${key}'`);
  }
  const decisionKeys = new Set();
  for (const [index, decision] of (record.decisions || []).entries()) {
    const label = `decisions[${index}]`;
    const key = text(decision?.key);
    const status = text(decision?.status).toLowerCase();
    if (!key) issues.push(`${label}.key is required`);
    else if (decisionKeys.has(key)) issues.push(`${label}.key '${key}' is duplicated`);
    decisionKeys.add(key);
    if (!DECISION_STATUSES.has(status)) issues.push(`${label}.status must be open|resolved`);
    if (status === "open") {
      if (!text(decision?.question)) issues.push(`${label}.question is required`);
      if (unique(strings(decision?.alternatives)).length < 2)
        issues.push(`${label}.alternatives must contain at least two choices`);
      if (!text(decision?.recommended)) issues.push(`${label}.recommended is required`);
      if (!strings(decision?.recommendationFactKeys).length)
        issues.push(`${label}.recommendationFactKeys must ground the recommendation`);
    } else if (!text(decision?.choice) || !text(decision?.reason)) {
      issues.push(`${label}.choice and .reason are required when resolved`);
    }
    for (const factKey of strings(decision?.recommendationFactKeys))
      if (!factKeys.has(factKey))
        issues.push(`${label}.recommendationFactKeys references unknown fact '${factKey}'`);
  }
  const outcome = text(record.conclusion?.status).toLowerCase();
  if (!OUTCOMES.has(outcome))
    issues.push("conclusion.status must be investigating|needs-user-decision|ready-for-change|not-worth-changing");
  if (!text(record.conclusion?.summary)) issues.push("conclusion.summary is required");
  if (outcome === "ready-for-change" && !text(record.changeIntent))
    issues.push("changeIntent is required for a ready-for-change investigation");
  if (mode === "compare") {
    if ((record.options || []).length < 3 || (record.options || []).length > 5)
      issues.push("compare mode requires three to five options");
    const optionKeys = new Set();
    for (const [index, option] of (record.options || []).entries()) {
      const label = `options[${index}]`;
      const key = text(option?.key);
      if (!key) issues.push(`${label}.key is required`);
      else if (optionKeys.has(key)) issues.push(`${label}.key '${key}' is duplicated`);
      optionKeys.add(key);
      if (!text(option?.summary)) issues.push(`${label}.summary is required`);
      if (!strings(option?.findings).length) issues.push(`${label}.findings is required`);
      if (!strings(option?.tradeoffs).length) issues.push(`${label}.tradeoffs is required`);
      if (!strings(option?.sources).length) issues.push(`${label}.sources is required`);
      for (const path of strings(option?.prototypePaths)) {
        const normalized = posix.normalize(path.replaceAll("\\", "/"));
        if (!normalized.startsWith(`.foundation/prototypes/${text(record.id)}/`))
          issues.push(`${label}.prototypePaths must stay under .foundation/prototypes/${text(record.id)}/`);
      }
    }
    if (outcome !== "investigating") {
      const selected = text(record.selection?.optionKey);
      if (!selected || !optionKeys.has(selected))
        issues.push("selection.optionKey must name a compared option");
      if (!text(record.selection?.reason)) issues.push("selection.reason is required");
      const rejected = Array.isArray(record.selection?.rejected) ? record.selection.rejected : [];
      const rejectedKeys = new Set(rejected.map((row) => text(row?.optionKey)));
      for (const optionKey of optionKeys)
        if (optionKey !== selected && !rejectedKeys.has(optionKey))
          issues.push(`selection.rejected must explain option '${optionKey}'`);
      for (const [index, row] of rejected.entries())
        if (!optionKeys.has(text(row?.optionKey)) || !text(row?.reason))
          issues.push(`selection.rejected[${index}] requires a known option and reason`);
    }
  }
  return unique(issues);
}

function stateProjection(state) {
  return {
    version: state.version,
    id: state.id,
    requestDigest: state.requestDigest,
    sourceInventoryDigest: state.sourceInventory?.digest || null,
    facts: state.facts,
    hypotheses: state.hypotheses,
    options: state.options,
    selection: state.selection,
    decisions: state.decisions,
    conclusion: state.conclusion,
    changeIntent: state.changeIntent,
    metrics: state.metrics
  };
}

export function investigationStateDigest(state) {
  return digest(stateProjection(state), "foundation-investigation-state:1");
}

function bindingFor(state) {
  return {
    version: 1,
    id: state.id,
    statePath: state.path,
    stateDigest: state.stateDigest,
    sourceDigest: state.sourceInventory.digest,
    outcome: state.conclusion.status,
    summary: state.conclusion.summary,
    changeIntent: state.changeIntent || null
  };
}

export function validateInvestigationBinding({ projectRoot, binding } = {}) {
  const issues = [];
  const root = realpathSync(resolve(projectRoot));
  if (!binding || binding.version !== 1) return ["investigation binding version must be 1"];
  const bindingId = text(binding.id);
  if (!ID_PATTERN.test(bindingId)) return ["investigation binding id is invalid"];
  const expectedPath = `.foundation/investigations/${bindingId}.json`;
  if (text(binding.statePath) !== expectedPath)
    issues.push(`investigation binding statePath must be '${expectedPath}'`);
  const path = resolve(root, text(binding.statePath));
  if (!within(join(root, ".foundation", "investigations"), path) ||
      !existsSync(path) || !lstatSync(path).isFile() ||
      lstatSync(path).isSymbolicLink())
    return unique([...issues, "investigation binding state is missing or unsafe"]);
  let state;
  try { state = JSON.parse(readFileSync(path, "utf8")); }
  catch { return unique([...issues, "investigation binding state is unreadable"]); }
  if (state.version !== INVESTIGATION_STATE_VERSION || state.status !== "DONE" ||
      state.conclusion?.status !== "ready-for-change")
    issues.push("investigation binding must reference a ready-for-change DONE state");
  if (state.id !== binding.id || investigationStateDigest(state) !== binding.stateDigest ||
      state.stateDigest !== binding.stateDigest)
    issues.push("investigation binding state digest is stale or mismatched");
  if (state.sourceInventory?.digest !== binding.sourceDigest)
    issues.push("investigation binding source digest is stale or mismatched");
  else {
    const freshness = inspectSemanticSources({
      projectRoot: root,
      sourcePaths: (state.sourceInventory?.sources || []).map((row) => row.path),
      baseline: state.sourceInventory
    });
    if (freshness.findings.length || freshness.staleFindings.length)
      issues.push("investigation binding sources changed after the investigation completed");
  }
  if (state.conclusion?.summary !== binding.summary ||
      (state.changeIntent || null) !== (binding.changeIntent || null))
    issues.push("investigation binding handoff content does not match machine state");
  return unique(issues);
}

export function createInvestigationRuntime({ root, readJson, writeJson, now, fail, git = null } = {}) {
  const statePath = (id) => join(root, ".foundation", "investigations", `${id}.json`);

  function repositoryPaths(excludedPaths) {
    if (typeof git !== "function") return {
      includedPaths: null, trackedPaths: [], excludedPaths
    };
    const tracked = git(["ls-files", "-z"], root);
    const included = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], root);
    if (tracked.status !== 0 || included.status !== 0) return {
      includedPaths: null, trackedPaths: [], excludedPaths
    };
    return {
      trackedPaths: tracked.stdout.split("\0").filter(Boolean),
      includedPaths: included.stdout.split("\0").filter(Boolean)
        .filter((path) => !excludedPaths.includes(path) && !path.startsWith(".foundation/")),
      excludedPaths
    };
  }

  function inspectInvestigation(recordPath) {
    const absolute = resolve(root, recordPath);
    if (!within(root, absolute) || !existsSync(absolute) || !lstatSync(absolute).isFile() ||
        lstatSync(absolute).isSymbolicLink())
      fail("investigate requires a regular JSON record inside the project");
    const record = readJson(absolute);
    const issues = recordIssues(record);
    const id = text(record?.id) || "invalid";
    const resume = `claude-foundation investigate ${recordPath}`;
    const relativeRecord = relative(root, absolute).replaceAll("\\", "/");
    const relativeState = `.foundation/investigations/${id}.json`;
    const paths = repositoryPaths([relativeRecord, relativeState]);
    const repository = inspectRepositoryIntelligence({
      projectRoot: root,
      query: [record?.problem, record?.changeIntent,
        ...(record?.facts || []).map((row) => row?.statement),
        ...(record?.hypotheses || []).map((row) => row?.statement)],
      seedPaths: strings(record?.sources),
      includedPaths: paths.includedPaths,
      trackedPaths: paths.trackedPaths,
      excludedPaths: paths.excludedPaths,
      limits: { maxReadSet: 24 }
    });
    const discovered = (repository.readSet || []).map((row) => row.path);
    const acknowledged = new Set(strings(record?.sources));
    const missingAcknowledgements = discovered.filter((path) => !acknowledged.has(path));
    const sourceInspection = inspectSemanticSources({
      projectRoot: root,
      sourcePaths: unique([...acknowledged, ...discovered])
    });
    for (const fact of record?.facts || [])
      for (const source of strings(fact?.sources))
        if (!acknowledged.has(source))
          issues.push(`fact '${text(fact?.key) || "(missing)"}' uses unacknowledged source '${source}'`);
    for (const option of record?.options || [])
      for (const source of strings(option?.sources))
        if (!acknowledged.has(source))
          issues.push(`option '${text(option?.key) || "(missing)"}' uses unacknowledged source '${source}'`);
    issues.push(...sourceInspection.findings.map((row) =>
      `investigation source ${row.code}: ${row.path || "(unknown)"}`));
    if (repository.status !== "ready") issues.push(...repository.findings.map((row) =>
      `repository discovery ${row.code}: ${row.path || "(root)"}`));

    const openHypotheses = (record?.hypotheses || []).filter((row) =>
      text(row?.status).toLowerCase() === "open");
    const openDecisions = (record?.decisions || []).filter((row) =>
      text(row?.status).toLowerCase() === "open");
    let action;
    if (issues.length) action = { action: "EDIT", owner: "agent", boundary: "investigation-record",
      reason: "Repair the investigation record and evidence bindings.",
      investigation: { kind: "repair-record", issues: unique(issues) }, resume };
    else if (missingAcknowledgements.length) action = {
      action: "EDIT", owner: "agent", boundary: "source-investigation",
      reason: "Interpret and acknowledge the newly discovered repository sources.",
      investigation: { kind: "inspect-sources", paths: missingAcknowledgements }, resume
    };
    else if (!(record.facts || []).length) action = {
      action: "EDIT", owner: "agent", boundary: "source-investigation",
      reason: "Record at least one source-grounded verified fact.",
      investigation: { kind: "record-facts" }, resume
    };
    else if (openHypotheses.length) action = {
      action: "EDIT", owner: "agent", boundary: "hypothesis-testing",
      reason: "Test or falsify the remaining hypotheses from repository evidence.",
      investigation: { kind: "test-hypotheses", keys: openHypotheses.map((row) => row.key) }, resume
    };
    else if (openDecisions.length) action = {
      action: "ASK_USER", owner: "user", boundary: "consequential-semantics",
      reason: "Repository evidence cannot settle these consequential choices.",
      decision: { kind: "investigation-decision", items: openDecisions.slice(0, 3).map((row) => ({
        key: row.key, question: row.question, alternatives: unique(strings(row.alternatives)),
        recommended: row.recommended, recommendationFactKeys: unique(strings(row.recommendationFactKeys))
      })) }, resume
    };
    else if (text(record.conclusion?.status).toLowerCase() === "investigating") action = {
      action: "EDIT", owner: "agent", boundary: "investigation-synthesis",
      reason: "Synthesize the settled evidence into a terminal investigation conclusion.",
      investigation: { kind: "conclude" }, resume
    };
    else action = { action: "DONE", owner: "harness", boundary: "investigation",
      reason: "The investigation is source-grounded and has a terminal conclusion.", resume };

    const path = statePath(id);
    const previous = existsSync(path) ? readJson(path) : null;
    const requestDigest = digest(record, "foundation-investigation-record:1");
    const progressDigest = digest({ requestDigest, source: sourceInspection.inventory?.digest,
      action: action.action, kind: action.investigation?.kind || action.decision?.kind || null });
    const noProgressCount = previous?.progressDigest === progressDigest && action.action !== "DONE"
      ? Number(previous.noProgress?.count || 0) + 1 : action.action === "DONE" ? 0 : 1;
    const state = {
      version: INVESTIGATION_STATE_VERSION,
      kind: "investigation",
      id,
      path: relativeState,
      status: action.action,
      revision: Number(previous?.revision || 0) + 1,
      updatedAt: now(),
      requestPath: relativeRecord,
      requestDigest,
      progressDigest,
      sourceInventory: sourceInspection.inventory,
      repository: {
        complete: repository.complete,
        scan: repository.scan,
        selectedSources: discovered,
        findings: repository.findings
      },
      facts: record?.facts || [],
      hypotheses: record?.hypotheses || [],
      options: record?.options || [],
      selection: record?.selection || null,
      decisions: record?.decisions || [],
      conclusion: record?.conclusion || null,
      changeIntent: text(record?.changeIntent) || null,
      action,
      noProgress: {
        count: noProgressCount,
        boundaryReached: noProgressCount >= 3,
        resume
      },
      metrics: {
        inspections: Number(previous?.metrics?.inspections || 0) + 1,
        selectedSourceCount: discovered.length,
        selectedSourceBytes: (repository.readSet || []).reduce((sum, row) => sum + row.bytes, 0),
        factCount: (record?.facts || []).length,
        supportedHypothesisCount: (record?.hypotheses || []).filter((row) =>
          text(row?.status).toLowerCase() === "supported").length,
        falsifiedHypothesisCount: (record?.hypotheses || []).filter((row) =>
          text(row?.status).toLowerCase() === "falsified").length,
        openDecisionCount: openDecisions.length,
        userDecisionRounds: Number(previous?.metrics?.userDecisionRounds || 0) +
          (action.action === "ASK_USER" ? 1 : 0)
      }
    };
    state.stateDigest = investigationStateDigest(state);
    mkdirSync(dirname(path), { recursive: true });
    writeJson(path, state);
    const handoff = action.action === "DONE" && state.conclusion?.status === "ready-for-change"
      ? bindingFor(state) : null;
    const result = { ...action, state: { path: relative(root, path).replaceAll("\\", "/"),
      revision: state.revision, digest: state.stateDigest }, noProgress: state.noProgress,
      metrics: state.metrics, handoff };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  return { inspectInvestigation, investigationRecordTemplate };
}
