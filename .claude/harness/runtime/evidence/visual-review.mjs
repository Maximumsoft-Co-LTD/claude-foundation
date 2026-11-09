#!/usr/bin/env node

// The harness-owned `visual` provider: an agent reviewer compares screenshots
// of the real UI with the prototype bound into the change packet and returns
// the differences it sees. Screenshots come from the project's own browser or
// playwright provider; this module never starts the application.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  CLAUDE_READ_ONLY_TOOLS, claudeResultEnvelope, claudeReviewerEnvironment,
  claudeReviewerFailure, claudeStructuredReview
} from "./configured-reviewer.mjs";

export const VISUAL_CAPABILITY = "visual";
export const VISUAL_REVIEW_PROTOCOL = "foundation-visual-review-v1";
export const VISUAL_SEVERITIES = Object.freeze(["blocker", "major", "minor"]);
export const VISUAL_BUILT_IN = "visual-review-v1";
const BLOCKING = new Set(["blocker", "major"]);
const SCREENSHOT = /\.(png|jpe?g)$/i;
export const SCREENSHOT_SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

const text = (value) => typeof value === "string" ? value.trim() : "";
const unique = (values) => [...new Set(values)];

// The packet binding written at Change (workflow/prototype-binding.mjs). The
// evidence domain may not import workflow code, so the record is read here
// with the same fail-closed rules: a copy whose digest drifted is not intact.
const BINDING_RECOVERY = "run change revise before Build to write the binding again";

// A binding record that exists but cannot be trusted never reads as "no
// prototype": it stays strict, binds every claim (which ones were bound is
// unknown), and carries the issue the provider reports.
function corruptBinding(issue) {
  return { corrupt: true, mode: "strict", file: null, sha256: null, claims: [], path: null,
    present: false, intact: false, bindingIssue: `${issue}; ${BINDING_RECOVERY}` };
}

export function readVisualBinding(packetDir) {
  const path = join(packetDir, "prototype", "binding.json");
  if (!existsSync(path)) return null;
  let binding;
  try { binding = JSON.parse(readFileSync(path, "utf8")); }
  catch { return corruptBinding("prototype/binding.json cannot be read"); }
  if (!binding || typeof binding !== "object" || binding.version !== 1 || !text(binding.file))
    return corruptBinding("prototype/binding.json has no supported version and file");
  const file = join(packetDir, binding.file);
  const present = existsSync(file);
  const digested = typeof binding.sha256 === "string" && /^[0-9a-f]{64}$/.test(binding.sha256);
  return {
    ...binding,
    mode: text(binding.mode) || "strict",
    claims: Array.isArray(binding.claims) ? unique(binding.claims.map(text).filter(Boolean)).sort() : [],
    path: file,
    present,
    intact: digested && present &&
      createHash("sha256").update(readFileSync(file)).digest("hex") === binding.sha256,
    ...(digested ? {} : { bindingIssue: `prototype/binding.json records no valid sha256; ${BINDING_RECOVERY}` })
  };
}

// A strict binding must name claims the contract has. One that names none, or
// any the contract lacks, cannot tell which claims it constrains, so every
// claim is bound (fail closed) and the provider reports why.
export function reconcileVisualBinding(binding, claimIds = []) {
  if (!binding) return binding;
  if (binding.corrupt) return { ...binding, claims: [...claimIds] };
  if (binding.mode === "advisory") return binding;
  const known = new Set(claimIds);
  const unknown = binding.claims.filter((id) => !known.has(id));
  if (binding.claims.length && !unknown.length) return binding;
  const issue = binding.claims.length
    ? `prototype/binding.json names claims the contract does not have: ${unknown.join(", ")}`
    : "prototype/binding.json binds no claim";
  return {
    ...binding,
    claims: [...claimIds],
    bindingIssue: [binding.bindingIssue, `${issue}; ${BINDING_RECOVERY}`].filter(Boolean).join("; ")
  };
}

// Strict bindings make `visual` a declared capability of the bound claims;
// advisory bindings report only and never decide proof. A copy that drifted
// or went missing keeps the requirement (fail closed): the provider then
// reports the drift instead of the check silently disappearing.
export function visualRequiredClaimIds(binding) {
  return binding && binding.mode !== "advisory" ? binding.claims : [];
}

export function withVisualRequirement(contract, binding) {
  if (!binding) return contract;
  if (binding.corrupt)
    binding = { ...binding, claims: (contract.claims || []).map((claim) => claim.id) };
  const required = new Set(visualRequiredClaimIds(binding));
  return {
    ...contract,
    claims: (contract.claims || []).map((claim) =>
      required.has(claim.id) && !claim.capabilities.includes(VISUAL_CAPABILITY)
        ? { ...claim, capabilities: [...claim.capabilities, VISUAL_CAPABILITY] } : claim),
    visualClaims: [...binding.claims],
    visualAdvisory: binding.mode === "advisory"
  };
}

// Visual providers an advisory binding runs for its report only: the
// configured instances, else the built-in one. Never required, so their
// receipts never decide proof, repair, drift, or Land.
export function advisoryVisualProviders(context, id) {
  const contract = context.evidence(id);
  if (!contract?.visualAdvisory) return [];
  const configured = Object.entries(contract.providers || {})
    .filter(([provider, config]) => context.providerCapability(provider, config) === VISUAL_CAPABILITY)
    .map(([provider]) => provider);
  const candidates = configured.length ? configured
    : context.providerConfig(id, VISUAL_CAPABILITY) ? [VISUAL_CAPABILITY] : [];
  const required = new Set(context.requiredProviders(id));
  return candidates.filter((provider) => !required.has(provider));
}

export function visualReportPath(changeId) {
  return `.foundation/visual/${changeId}.json`;
}

function screenshotPatterns(values) {
  return unique((Array.isArray(values) ? values : [])
    .map((value) => text(value).replaceAll("\\", "/").replace(/^\.\//, "")).filter(Boolean)).sort();
}

// A command provider for the bound prototype. Its declared inputs are the
// packet copy and the screenshots, so an unchanged pair reuses the receipt
// without asking the reviewer again; the prototype digest in the command
// changes the provider fingerprint whenever the bound file changes.
export function visualProviderConfig({
  changeId, packetPath, packetRelative, binding, scriptPath, base = {}
}) {
  const screenshots = screenshotPatterns(base.screenshots);
  const report = visualReportPath(changeId);
  const spec = {
    protocol: VISUAL_REVIEW_PROTOCOL,
    changeId,
    prototype: binding.file ? join(packetPath, binding.file) : null,
    prototypeSha256: binding.sha256 || null,
    ...(text(binding.source) ? { prototypeSource: text(binding.source) } : {}),
    ...(binding.bindingIssue ? { bindingIssue: binding.bindingIssue } : {}),
    claims: binding.claims,
    screenshots,
    report,
    ...(text(base.model) ? { model: text(base.model) } : {})
  };
  return {
    ...base,
    adapter: "command",
    capability: VISUAL_CAPABILITY,
    version: String(base.version || "1"),
    command: ["node", scriptPath, JSON.stringify(spec)],
    // An unreadable binding names no copy; its record is the input that a
    // revision rewrites.
    inputs: [`${packetRelative}/${binding.file || "prototype/binding.json"}`.replaceAll("\\", "/"),
      ...screenshots],
    report,
    screenshots,
    builtIn: VISUAL_BUILT_IN
  };
}

// The provider-input pattern language (`dir/**`, `dir/*`, a file, or a
// directory), so the screenshots reviewed are exactly the ones whose
// identities bind the receipt.
export function screenshotPatternMatches(rel, pattern) {
  if (pattern.endsWith("/**"))
    return rel === pattern.slice(0, -3) || rel.startsWith(pattern.slice(0, -2));
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return rel.startsWith(prefix) && !rel.slice(prefix.length).includes("/");
  }
  return rel === pattern || rel.startsWith(`${pattern.replace(/\/$/, "")}/`);
}

// Workspace-relative PNG/JPEG files matching the configured patterns.
// Screenshots usually live in tool output directories (test-results,
// playwright-report) that the workspace hash skips, so only VCS and package
// directories are skipped here.
export function matchScreenshots(workspace, patterns = []) {
  const normalized = screenshotPatterns(patterns);
  if (!normalized.length) return [];
  const found = [];
  const walk = (directory) => {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (SCREENSHOT_SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.isFile() || !SCREENSHOT.test(entry.name)) continue;
      const rel = relative(workspace, path).replaceAll("\\", "/");
      if (normalized.some((pattern) => screenshotPatternMatches(rel, pattern))) found.push(rel);
    }
  };
  walk(workspace);
  return found.sort();
}

export const VISUAL_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "findings"],
  properties: {
    status: { type: "string", enum: ["pass", "fail", "inconclusive"] },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "screen", "difference", "severity", "claimIds"],
        properties: {
          id: { type: "string" },
          screen: { type: "string" },
          difference: { type: "string" },
          severity: { type: "string", enum: [...VISUAL_SEVERITIES] },
          claimIds: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
};

export function visualReviewPrompt({ prototype, screenshots = [], claimIds = [] }) {
  return [
    "You are the visual reviewer of a Change Loop change. Read the approved prototype and every",
    "screenshot of the real UI listed below with the Read tool, then compare them.",
    "",
    `Prototype (approved design reference): ${prototype}`,
    "Screenshots of the implemented UI:",
    ...screenshots.map((path) => `- ${path}`),
    `Claims the prototype is bound to: ${claimIds.join(", ") || "none"}`,
    "",
    "Report every difference in layout, hierarchy, placement, content, or state that a user would",
    "notice. Ignore differences that only come from sample data, fonts, or viewport size.",
    "Each finding names the screen, the difference, a severity (blocker: the screen does not",
    "do what the prototype shows; major: a visible structural or placement difference; minor:",
    "cosmetic), and the claim IDs it affects.",
    "Return status pass only when no blocker or major difference remains, fail when one does,",
    "and inconclusive when the screenshots do not show the bound screens.",
    "Return only JSON matching the provided schema."
  ].join("\n");
}

export function visualReviewIssues(review, claimIds = null) {
  if (!review || typeof review !== "object" || Array.isArray(review))
    return ["visual review must be a JSON object"];
  const issues = [];
  if (!["pass", "fail", "inconclusive"].includes(review.status))
    issues.push("status must be pass|fail|inconclusive");
  if (!text(review.summary)) issues.push("summary must be a non-empty string");
  if (!Array.isArray(review.findings)) return [...issues, "findings must be an array"];
  const known = Array.isArray(claimIds) ? new Set(claimIds) : null;
  const ids = new Set();
  for (const [index, finding] of review.findings.entries()) {
    const where = `findings[${index}]`;
    if (!finding || typeof finding !== "object") { issues.push(`${where} must be an object`); continue; }
    if (!text(finding.id) || ids.has(text(finding.id))) issues.push(`${where}.id must be unique and non-empty`);
    ids.add(text(finding.id));
    if (!text(finding.screen)) issues.push(`${where}.screen must name the screen`);
    if (!text(finding.difference)) issues.push(`${where}.difference must describe the difference`);
    if (!VISUAL_SEVERITIES.includes(finding.severity))
      issues.push(`${where}.severity must be ${VISUAL_SEVERITIES.join("|")}`);
    if (!Array.isArray(finding.claimIds) || finding.claimIds.some((id) => !text(id)))
      issues.push(`${where}.claimIds must be an array of claim IDs`);
    else if (known && finding.claimIds.some((id) => !known.has(text(id))))
      issues.push(`${where}.claimIds names a claim the prototype is not bound to`);
  }
  const blocking = review.findings.some((finding) => BLOCKING.has(finding?.severity));
  if (review.status === "pass" && blocking)
    issues.push("a pass cannot carry a blocker or major finding");
  if (review.status === "fail" && !review.findings.length)
    issues.push("a fail must name at least one difference");
  return issues;
}

function normalizedFinding(finding) {
  return {
    id: text(finding.id), screen: text(finding.screen), difference: text(finding.difference),
    severity: finding.severity, claimIds: unique(finding.claimIds.map(text)).sort()
  };
}

// The verdict a receipt records. Severity decides it: a blocker or major
// difference fails; minor differences alone pass but stay listed, so the
// receipt never reads as an exact match.
export function visualReviewOutcome(review, { claimIds = null } = {}) {
  const issues = visualReviewIssues(review, claimIds);
  if (issues.length)
    return { status: "error", summary: `invalid visual review: ${issues.join("; ")}`, findings: [] };
  const findings = review.findings.map(normalizedFinding)
    .sort((left, right) => left.id.localeCompare(right.id));
  const summary = text(review.summary);
  if (review.status === "inconclusive") return { status: "inconclusive", summary, findings };
  return {
    status: findings.some((finding) => BLOCKING.has(finding.severity)) ? "fail" : "pass",
    summary, findings
  };
}

export const NO_SCREENSHOT_SUMMARY =
  "no screenshot matched providers.visual.screenshots; configure the project's browser or " +
  "playwright provider to save screenshots of the bound screens and list their paths in " +
  "providers.visual.screenshots";

// One review. `runner({ prompt, schema, workspace })` returns the reviewer's
// JSON object or `{ error }`; tests inject it, the CLI uses Claude Code.
// How to bring a drifted or missing packet copy back in line with its binding.
function prototypeRecovery(source) {
  return source
    ? `restore it from ${source}, or run change revise before Build to bind it again`
    : "restore the copy compiled with the change, or run change revise before Build to bind it again";
}

// The copy the binding names must hold exactly the bytes the agreement bound;
// other bytes are never shown to a reviewer.
export function prototypeDriftIssue({ prototype, prototypeSha256 = null, prototypeSource = null }) {
  if (!prototype || !existsSync(prototype))
    return `bound prototype copy is missing: ${prototype || "none"}; ${prototypeRecovery(prototypeSource)}`;
  if (prototypeSha256 &&
      createHash("sha256").update(readFileSync(prototype)).digest("hex") !== prototypeSha256)
    return `bound prototype copy ${prototype} does not match its bound digest ${prototypeSha256}; ` +
      prototypeRecovery(prototypeSource);
  return null;
}

export function runVisualReview({
  workspace = process.cwd(), prototype, prototypeSha256 = null, prototypeSource = null,
  bindingIssue = null, screenshots = [], claimIds = [], runner
}) {
  const drift = text(bindingIssue) ||
    prototypeDriftIssue({ prototype, prototypeSha256, prototypeSource });
  if (drift) return { status: "error", summary: drift, findings: [], screenshots };
  if (!screenshots.length)
    return { status: "inconclusive", summary: NO_SCREENSHOT_SUMMARY, findings: [], screenshots };
  const prompt = visualReviewPrompt({
    prototype, screenshots: screenshots.map((path) => isAbsolute(path) ? path : join(workspace, path)),
    claimIds
  });
  let review;
  try { review = runner({ prompt, schema: VISUAL_REVIEW_SCHEMA, workspace }); }
  catch (error) { review = { error: error.message }; }
  if (review?.error)
    return { status: "error", summary: `visual reviewer failed: ${review.error}`, findings: [], screenshots };
  return { ...visualReviewOutcome(review, { claimIds }), screenshots };
}

export function claudeVisualRunner({
  executable = "claude", model = null, env = process.env, timeoutMs = 30 * 60 * 1000,
  spawn = spawnSync, uuid = randomUUID
} = {}) {
  return ({ prompt, schema, workspace }) => {
    const args = [
      "-p", "--output-format", "json", "--json-schema", JSON.stringify(schema),
      ...(model ? ["--model", model] : []),
      "--permission-mode", "plan", "--tools", CLAUDE_READ_ONLY_TOOLS,
      "--safe-mode", "--no-session-persistence", "--session-id", uuid(), prompt
    ];
    const result = spawn(executable, args, {
      cwd: workspace, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024,
      env: claudeReviewerEnvironment(env, env.FOUNDATION_CHANGE_ID || "")
    });
    const envelope = claudeResultEnvelope(result.stdout);
    const failure = claudeReviewerFailure(result, envelope, envelope?.session_id);
    if (failure) return { error: failure.summary };
    return claudeStructuredReview(envelope) || { error: "reviewer returned no structured review" };
  };
}

const STATUS_RANK = { pass: 0, inconclusive: 1, fail: 2, error: 3 };

// What a visual receipt records from the provider's structured report. The
// report can only lower the executed status, never raise it; without a report
// (a hand-recorded receipt) nothing establishes that the screens match.
export function visualReceiptResult(report, executedStatus) {
  if (!report || report.protocol !== VISUAL_REVIEW_PROTOCOL)
    return {
      status: executedStatus === "pass" ? "inconclusive" : executedStatus,
      visual: null,
      observed: "no visual review report: only the harness-run visual provider can establish that the UI matches the prototype"
    };
  const findings = Array.isArray(report.findings) ? report.findings : [];
  let status = Object.hasOwn(STATUS_RANK, report.status) ? report.status : "error";
  if (status === "pass" && findings.some((finding) => BLOCKING.has(finding?.severity)))
    status = "error";
  if (executedStatus === "error") status = "error";
  else if (executedStatus === "fail" && status === "pass") status = "fail";
  const count = (severity) => findings.filter((finding) => finding?.severity === severity).length;
  const differences = `${findings.length} difference(s) (${count("blocker")} blocker, ${
    count("major")} major, ${count("minor")} minor)`;
  const observed = status === "pass" && findings.length
    ? `visual pass with ${differences}; not an exact match: ${text(report.summary)}`
    : `visual ${status}: ${differences}; ${text(report.summary)}`;
  return {
    status,
    observed,
    visual: {
      summary: text(report.summary),
      findings,
      screenshots: Array.isArray(report.screenshots) ? report.screenshots : [],
      prototypeSha256: report.prototypeSha256 || null
    }
  };
}

export function visualBlockingFindings(findings = []) {
  return findings.filter((finding) => BLOCKING.has(finding?.severity));
}

// The user question once visual repair is spent and every other gate is done.
// Recommendation first; accepting is never the only choice.
export function visualDriftDecision(id, drift) {
  const findings = drift?.findings || [];
  const listed = findings.slice(0, 8).map((finding) =>
    `${finding.provider ? `${finding.provider} ` : ""}${finding.screen}: ${finding.difference} [${
      finding.severity}]`).join("; ");
  return {
    kind: "visual-drift",
    summary: `The UI still differs from the bound prototype after ${drift?.rounds ?? 0} visual repair round(s): ${
      findings.length} difference(s) remain${listed ? ` — ${listed}` : ""}. Every other gate is done.`,
    differences: findings,
    rounds: drift?.rounds ?? 0,
    workspaceHash: drift?.workspaceHash || null,
    options: [
      { id: "repair-more", outcome: "Grant 2 more visual repair rounds on your decision; the agent repairs the listed differences." },
      { id: "accept", outcome: "Accept the listed differences with your reason; visual is recorded as a mismatch you accepted, never as a pass." },
      { id: "amend-agreement", outcome: `Amend the agreement so it matches the built UI (claude-foundation change amend ${id} <amendment.json>); visual is checked again against it.` },
      { id: "pause", outcome: "Preserve the change and all completed work." }
    ],
    recommended: "repair-more"
  };
}

// One advisory visual result as the user sees it. A run that never produced
// a verdict (skipped for a dependency, or an adapter that threw) keeps its
// reason; otherwise the receipt's differences are listed.
export function advisoryVisualRow(outcome, receipt = null) {
  const status = String(outcome?.status || "unknown");
  if (!["pass", "fail", "inconclusive"].includes(status) || !receipt)
    return { provider: outcome.provider, capability: VISUAL_CAPABILITY, advisory: true, status,
      reason: text(outcome?.detail) || "no visual review result", differences: [] };
  const differences = Array.isArray(receipt.visual?.findings) ? receipt.visual.findings : [];
  return { provider: outcome.provider, capability: VISUAL_CAPABILITY, advisory: true,
    status: receipt.status || status, reason: text(receipt.visual?.summary), differences };
}

export function advisoryVisualLine(row) {
  const head = `advisory visual ${row.provider} (not passing evidence): ${row.status}`;
  if (!row.differences?.length)
    return `${head}${row.reason ? ` — ${row.reason}` : ""}`;
  return `${head}; ${row.differences.length} difference(s): ${row.differences.map((finding) =>
    `${finding.screen}: ${finding.difference} [${finding.severity}]`).join("; ")}`;
}

// How a visual waiver reads in proof advisories and the Land report.
export function visualWaiverSummary(row) {
  const findings = Array.isArray(row?.acceptedFindings) ? row.acceptedFindings : null;
  if (row?.capability !== VISUAL_CAPABILITY || !findings) return null;
  return `visual: mismatch accepted by user (${row.authority?.reference || "user decision"}): ${
    findings.length} difference(s)`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let result;
  let spec = {};
  try {
    spec = JSON.parse(process.argv[2] || "{}");
    const workspace = process.cwd();
    result = runVisualReview({
      workspace,
      prototype: spec.prototype,
      prototypeSha256: spec.prototypeSha256 || null,
      prototypeSource: spec.prototypeSource || null,
      bindingIssue: spec.bindingIssue || null,
      screenshots: matchScreenshots(workspace, spec.screenshots),
      claimIds: spec.claims || [],
      runner: claudeVisualRunner({ model: spec.model || null })
    });
  } catch (error) {
    result = { status: "error", summary: error.message, findings: [], screenshots: [] };
  }
  const report = {
    protocol: VISUAL_REVIEW_PROTOCOL,
    status: result.status,
    summary: result.summary,
    findings: result.findings,
    screenshots: result.screenshots || [],
    prototypeSha256: spec.prototypeSha256 || null
  };
  if (text(spec.report)) {
    const path = resolve(process.cwd(), spec.report);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report));
  if (result.status !== "pass") process.exitCode = 1;
}
