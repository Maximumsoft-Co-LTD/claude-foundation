#!/usr/bin/env node

import {
  appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync,
  mkdtempSync, rmSync, writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const VERSION = "1.2.0";
const RUNTIME_API_VERSION = "3";
const PROVIDER_PROTOCOL_VERSION = "3";
const ADAPTER_PROTOCOL_VERSION = "1";
const ADAPTERS = new Set(["command", "test-discovery", "playwright", "external"]);
const INPUT_MODES = new Set(["browser-automation", "dom-event", "os-input", "both"]);
const EXCLUDED_WORKSPACE_DIRS = new Set([
  ".git", ".foundation", ".workflow", "node_modules",
  "coverage", "test-results", "playwright-report"
]);
const PROVIDER_CONTRACTS = {
  "test": "Executable behavioral checks for the declared claim.",
  "discovery": "Expected tests were found and the discovered count meets the floor.",
  "browser": "Rendered behavior in a real browser with the required input capability.",
  "mutation": "A deliberate behavioral fault is detected by the evidence suite.",
  "state-identity": "State before, during, or after the change belongs to the intended actor and revision.",
  "integration": "Multiple components or external boundaries work together.",
  "compatibility": "Public or persisted contracts remain compatible across supported versions.",
  "performance": "Measured latency, throughput, resource, or size budgets are met.",
  "security-static": "Static security checks cover the changed trust boundary and unsafe sinks.",
  "cross-repo-contract": "Producer and consumer repositories agree on the same versioned contract.",
  "review": "Independent risk review covers the declared claims and unresolved findings.",
  "static-analysis": "Compilation, type checking, linting, and applicable static quality gates pass.",
  "data-migration": "Schema or data evolution is forward-safe, backward-compatible, and rollback-aware.",
  "accessibility": "Rendered semantics, keyboard use, focus, contrast, and assistive access meet policy.",
  "resilience": "Timeout, retry, partial-failure, recovery, and degraded-dependency behavior is proven.",
  "observability": "Required logs, metrics, traces, and alerts expose success and failure safely.",
  "deployment": "Packaging, configuration, rollout health checks, and rollback behavior are proven.",
  "dependency-supply-chain": "Dependency vulnerability, license, lockfile, and provenance policy passes."
};
const PROVIDERS = new Set(Object.keys(PROVIDER_CONTRACTS));
const SECURITY_TERMS = [
  "auth", "identity", "access", "permission", "secret", "credential", "session",
  "token", "cross-user", "cross user", "trust boundary", "irreversible",
  "sensitive", "personal data", "command execution", "injection", "migration"
];

function die(message, code = 1) {
  console.error(`BLOCKED: ${message}`);
  process.exit(code);
}

function findRoot(start = process.cwd()) {
  let cursor = resolve(start);
  for (;;) {
    if (existsSync(join(cursor, "openspec", "config.yaml")) &&
        existsSync(join(cursor, ".claude", "harness", "foundation.mjs"))) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) die("not inside a Foundation project");
    cursor = parent;
  }
}

const ROOT = findRoot();
const RUNTIME = join(ROOT, ".foundation", "runtime");
const RECEIPTS = join(ROOT, ".foundation", "receipts");
const LOGS = join(ROOT, ".foundation", "logs");
const CHANGES = join(ROOT, "openspec", "changes");
mkdirSync(RUNTIME, { recursive: true });
mkdirSync(RECEIPTS, { recursive: true });
mkdirSync(LOGS, { recursive: true });
mkdirSync(CHANGES, { recursive: true });

const operationStartedAt = Date.now();
let operationChangeId = null;
let operationName = null;
process.on("exit", (code) => {
  if (process.env.FOUNDATION_TELEMETRY !== "1" || !operationChangeId || !operationName) return;
  const path = join(LOGS, operationChangeId, "operations.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify({
    version: 1, changeId: operationChangeId, operation: operationName,
    phase: process.env.FOUNDATION_PUBLIC_OPERATION || null,
    status: code === 0 ? "completed" : "failed", exitCode: code,
    startedAt: new Date(operationStartedAt).toISOString(), finishedAt: now(),
    durationMs: Date.now() - operationStartedAt,
    requests: null, inputTokens: null, outputTokens: null, cacheTokens: null, cost: null,
    measurement: "command-observed; model usage requires external event ingestion"
  })}\n`);
});

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) {
    if (fallback !== null) return fallback;
    die(`invalid JSON: ${relative(ROOT, path)} (${error.message})`);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function now() { return new Date().toISOString(); }
function isPinnedOpenSpecVersion(value) {
  return /(^|[^0-9])1\.7\.0([^0-9]|$)/.test(value);
}
function commandExists(command, cwd = ROOT) {
  if (!command) return false;
  if (command.includes("/") || isAbsolute(command))
    return existsSync(resolve(cwd, command));
  return String(process.env.PATH || "").split(delimiter)
    .some((directory) => existsSync(join(directory, command)));
}
function playwrightAvailability(workspace) {
  const packageJson = readJson(join(workspace, "package.json"), {});
  const packages = {
    ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {})
  };
  const packageOwned = Boolean(packages["@playwright/test"] || packages.playwright);
  const binary = join(workspace, "node_modules", ".bin", "playwright");
  const config = [
    "playwright.config.ts", "playwright.config.js", "playwright.config.mjs",
    "playwright.config.cjs"
  ].find((name) => existsSync(join(workspace, name))) || null;
  return { packageOwned, binary, binaryAvailable: existsSync(binary), config };
}
function runtimePath(id) { return join(RUNTIME, `${id}.json`); }
function changePath(id) { return join(CHANGES, id); }
function receiptPath(id, provider) { return join(RECEIPTS, id, `${provider}.json`); }
function proofPath(id) { return join(RECEIPTS, id, "proof.json"); }
function currentChangeRelativePath(id) { return `openspec/changes/${id}`; }

function isCurrentChangePath(rel, id) {
  const base = currentChangeRelativePath(id);
  return rel === base || rel.startsWith(`${base}/`);
}

function activeChangePath(id, state = loadRuntime(id)) {
  if (state.status === "archived" && state.archivedChangePath) {
    const archived = join(ROOT, state.archivedChangePath);
    if (existsSync(archived)) return archived;
  }
  const workspace = state.workspace;
  if (workspace && ["worktree", "copy"].includes(workspace.mode) &&
      workspace.path && existsSync(workspace.path)) {
    const candidate = join(workspace.path, "openspec", "changes", id);
    if (existsSync(candidate)) return candidate;
  }
  return changePath(id);
}

function archivedChangeRelativePath(id) {
  const archiveRoot = join(CHANGES, "archive");
  if (!existsSync(archiveRoot)) return null;
  const candidates = readdirSync(archiveRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() &&
      (entry.name === id || entry.name.endsWith(`-${id}`)))
    .map((entry) => entry.name).sort();
  return candidates.length ? `openspec/changes/archive/${candidates.at(-1)}` : null;
}

function slugify(value) {
  return value.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "change";
}

function parseFlags(values) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith("--")) { rest.push(value); continue; }
    const body = value.slice(2);
    if (body.includes("=")) {
      const [key, ...tail] = body.split("=");
      flags[key] = tail.join("=");
    } else if (values[i + 1] && !values[i + 1].startsWith("--")) {
      flags[body] = values[i + 1]; i += 1;
    } else flags[body] = true;
  }
  return { flags, rest };
}

function loadRuntime(id) {
  if (!existsSync(runtimePath(id))) die(`unknown change '${id}'`);
  return readJson(runtimePath(id));
}

function saveRuntime(state) {
  state.updatedAt = now();
  writeJson(runtimePath(state.id), state);
}

function activeChanges() {
  return readdirSync(CHANGES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "archive")
    .map((entry) => entry.name).sort();
}

function walk(dir, callback) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, callback);
    else if (entry.isFile()) callback(path);
  }
}

function directoryHash(dir) {
  const hash = createHash("sha256");
  const files = [];
  walk(dir, (path) => files.push(path));
  files.sort((a, b) => relative(dir, a).localeCompare(relative(dir, b)));
  for (const path of files) {
    hash.update(relative(dir, path).replaceAll("\\", "/"));
    hash.update("\0"); hash.update(readFileSync(path)); hash.update("\0");
  }
  return hash.digest("hex");
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function relevantHash(id, workspaceOverride = null) {
  const state = existsSync(runtimePath(id)) ? readJson(runtimePath(id)) : {};
  const workspace = resolve(workspaceOverride || state.workspace?.path || ROOT);
  const hash = createHash("sha256");
  const files = [];
  function collect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED_WORKSPACE_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      const rel = relative(workspace, path).replaceAll("\\", "/");
      if (rel.startsWith("openspec/changes/archive/")) continue;
      if (rel.startsWith("openspec/changes/") && !isCurrentChangePath(rel, id)) continue;
      if (entry.isDirectory()) collect(path);
      else if (entry.isFile()) files.push([rel, path]);
    }
  }
  collect(workspace);
  files.sort(([a], [b]) => a.localeCompare(b));
  for (const [rel, path] of files) {
    hash.update(rel); hash.update("\0"); hash.update(readFileSync(path)); hash.update("\0");
  }
  hash.update(`foundation-change-revision:${Number(state.revision || 0)}`);
  return hash.digest("hex");
}

function workspaceManifest(workspace, id, excludeChange = false) {
  const result = {};
  function collect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED_WORKSPACE_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      const rel = relative(workspace, path).replaceAll("\\", "/");
      if (rel.startsWith("openspec/changes/archive/")) continue;
      if (rel.startsWith("openspec/changes/") &&
          (excludeChange || !isCurrentChangePath(rel, id))) continue;
      if (entry.isDirectory()) collect(path);
      else if (entry.isFile())
        result[rel] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  }
  collect(workspace);
  return result;
}

function templateDir(schema) {
  return join(ROOT, "openspec", "schemas", schema, "templates");
}

function instantiate(path, title) {
  const content = readFileSync(path, "utf8")
    .replaceAll("<title>", title)
    .replaceAll("replace-with-stable-claim-id", `${slugify(title)}-outcome`);
  return content;
}

function createChange(intent, flags) {
  const id = slugify(flags.id || intent);
  operationChangeId = id;
  if (existsSync(changePath(id))) die(`change already exists: ${id}`);
  const schema = flags.rapid ? "foundation-rapid" : "foundation-standard";
  const source = templateDir(schema);
  const target = changePath(id);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, ".openspec.yaml"), `schema: ${schema}\n`);
  for (const name of ["proposal.md", "tasks.md", "evidence.yaml"]) {
    writeFileSync(join(target, name), instantiate(join(source, name), intent));
  }
  if (schema === "foundation-standard") {
    writeFileSync(join(target, "design.md"), instantiate(join(source, "design.md"), intent));
    mkdirSync(join(target, "specs", "change"), { recursive: true });
    writeFileSync(join(target, "specs", "change", "spec.md"), instantiate(join(source, "spec.md"), intent));
  }
  const state = {
    version: 1, id, intent, schema, status: "change", ambiguity: "clear",
    impact: schema === "foundation-rapid" ? "low" : null,
    coupling: schema === "foundation-rapid" ? "isolated" : null,
    securityTriggers: [], reviewRequired: false, evidenceCapabilities: [],
    workspace: { mode: "current", path: ROOT, baseHead: gitHead(ROOT) },
    budget: {
      targetRequests: schema === "foundation-rapid" ? 80 : 160,
      usedRequests: null, measurement: "unavailable-until-external-events"
    },
    createdAt: now(), updatedAt: now()
  };
  saveRuntime(state);
  console.log(`CREATED ${id}\n  schema: ${schema}\n  next: complete artifacts, then /build ${id}`);
}

function git(args, cwd = ROOT) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function gitHead(cwd) {
  const result = git(["rev-parse", "HEAD"], cwd);
  return result.status === 0 ? result.stdout.trim() : null;
}

function resolveChange(id, flags) {
  const state = loadRuntime(id);
  for (const key of ["ambiguity", "impact", "coupling"]) if (flags[key]) state[key] = flags[key];
  if (flags.size) state.size = flags.size;
  const semanticText = `${state.intent} ${flags.security || ""}`.toLowerCase();
  const inferred = SECURITY_TERMS.filter((term) => semanticText.includes(term));
  state.securityTriggers = [...new Set([
    ...(state.securityTriggers || []), ...inferred,
    ...String(flags.security || "").split(",").filter(Boolean)
  ])];
  state.reviewRequired = state.impact === "high" || state.coupling === "coupled" ||
    state.securityTriggers.length > 0 || Boolean(flags.review);
  if (state.schema === "foundation-rapid" &&
      (state.impact !== "low" || state.coupling !== "isolated" || state.reviewRequired)) {
    state.schema = "foundation-standard";
    state.upgradedFrom = "foundation-rapid";
  }
  saveRuntime(state);
  console.log(`RESOLVED ${id}\n  impact: ${state.impact}\n  coupling: ${state.coupling}\n  review: ${state.reviewRequired ? "required" : "not required"}\n  security: ${state.securityTriggers.join(", ") || "none"}`);
}

function evidence(id, dir = activeChangePath(id)) {
  const path = join(dir, "evidence.yaml");
  const value = readJson(path);
  if (![1, 2].includes(value.version) || !Array.isArray(value.claims) || value.claims.length === 0)
    die(`${id}/evidence.yaml must contain at least one claim`);
  if (value.version === 2 && (value.providers === null ||
      typeof (value.providers || {}) !== "object" || Array.isArray(value.providers)))
    die(`${id}/evidence.yaml providers must be an object`);
  const ids = new Set();
  for (const claim of value.claims) {
    if (!claim.id || ids.has(claim.id)) die(`evidence claim IDs must be non-empty and unique`);
    ids.add(claim.id);
    if (!claim.scenario || !Array.isArray(claim.capabilities) || claim.capabilities.length === 0)
      die(`claim '${claim.id}' needs scenario and capabilities`);
    for (const provider of claim.capabilities)
      if (!PROVIDERS.has(provider)) die(`claim '${claim.id}' uses unknown provider '${provider}'`);
  }
  for (const [provider, config] of Object.entries(value.providers || {})) {
    if (!PROVIDERS.has(provider)) die(`unknown configured provider '${provider}'`);
    if (!config || typeof config !== "object" || Array.isArray(config))
      die(`provider '${provider}' configuration must be an object`);
    if (!ADAPTERS.has(config.adapter))
      die(`provider '${provider}' uses unknown adapter '${config.adapter || ""}'`);
    if (config.adapter !== "external" &&
        (!Array.isArray(config.command) || config.command.length === 0 ||
         config.command.some((part) => typeof part !== "string" || !part)))
      die(`provider '${provider}' adapter '${config.adapter}' requires a non-empty command array`);
    if (config.adapter === "test-discovery" && provider !== "test")
      die("test-discovery adapter must be configured under provider 'test'");
    if (config.timeoutMs !== undefined &&
        (!Number.isFinite(Number(config.timeoutMs)) || Number(config.timeoutMs) <= 0))
      die(`provider '${provider}' timeoutMs must be a positive number`);
    if (config.resources !== undefined &&
        (!Array.isArray(config.resources) ||
         config.resources.some((item) => typeof item !== "string" || !item)))
      die(`provider '${provider}' resources must be an array of strings`);
    if (config.dependsOn !== undefined &&
        (!Array.isArray(config.dependsOn) ||
         config.dependsOn.some((item) => !PROVIDERS.has(item))))
      die(`provider '${provider}' dependsOn contains an unknown provider`);
    if (config.dependsOn?.includes(provider))
      die(`provider '${provider}' cannot depend on itself`);
    if (config.env !== undefined &&
        (!config.env || typeof config.env !== "object" || Array.isArray(config.env) ||
         Object.values(config.env).some((value) => !["string", "number", "boolean"].includes(typeof value))))
      die(`provider '${provider}' env must be an object of scalar values`);
    if (config.report !== undefined && typeof config.report !== "string")
      die(`provider '${provider}' report must be a path string`);
    if (config.readiness !== undefined) {
      if (!config.readiness || typeof config.readiness !== "object" ||
          typeof config.readiness.url !== "string")
        die(`provider '${provider}' readiness requires a URL`);
      try { new URL(config.readiness.url); }
      catch { die(`provider '${provider}' readiness URL is invalid`); }
    }
    if (config.adapter === "playwright" && config.inputMode &&
        !INPUT_MODES.has(config.inputMode))
      die(`provider '${provider}' has invalid inputMode '${config.inputMode}'`);
    if (provider === "browser" && config.adapter !== "external" &&
        !INPUT_MODES.has(config.inputMode || (config.adapter === "playwright" ? "browser-automation" : "")))
      die("configured browser provider requires a valid inputMode");
    if (provider === "mutation" && config.adapter !== "external" &&
        !["behavioral-kill", "test-failure"].includes(config.classification))
      die("configured mutation provider requires classification behavioral-kill|test-failure");
    const declaredForProvider = value.claims.filter((claim) =>
      claim.capabilities.includes(provider) ||
      (provider === "discovery" && claim.capabilities.includes("test")) ||
      provider === "review").map((claim) => claim.id);
    if (config.claims !== undefined && config.claims !== "declared") {
      if (!Array.isArray(config.claims))
        die(`provider '${provider}' claims must be an array or 'declared'`);
      const forbidden = config.claims.filter((claim) => !declaredForProvider.includes(claim));
      if (forbidden.length)
        die(`provider '${provider}' config references undeclared claim(s): ${forbidden.join(", ")}`);
      const missing = declaredForProvider.filter((claim) => !config.claims.includes(claim));
      if (missing.length)
        die(`provider '${provider}' config must cover every declared claim: ${missing.join(", ")}`);
    }
  }
  return value;
}

function providerConfig(id, provider) {
  const providers = evidence(id).providers || {};
  if (providers[provider]) return providers[provider];
  if (provider === "discovery" && providers.test?.adapter === "test-discovery")
    return providers.test;
  return null;
}

function providerClaims(id, provider, config = providerConfig(id, provider)) {
  const declared = claimsForProvider(id, provider).map((claim) => claim.id);
  if (!config?.claims || config.claims === "declared") return declared;
  if (!Array.isArray(config.claims)) die(`provider '${provider}' claims must be an array or 'declared'`);
  const forbidden = config.claims.filter((claim) => !declared.includes(claim));
  if (forbidden.length)
    die(`provider '${provider}' config references undeclared claim(s): ${forbidden.join(", ")}`);
  return config.claims;
}

function environmentDescriptor(config = null) {
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    declared: config?.environment || null,
    envFingerprint: stableHash(config?.env || {})
  };
}

function adapterFingerprint(id, provider, config, command = null) {
  return stableHash({
    adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
    providerProtocolVersion: PROVIDER_PROTOCOL_VERSION,
    provider,
    adapter: config?.adapter || "external",
    adapterVersion: String(config?.version || "1"),
    command: command || config?.command || null,
    claims: providerClaims(id, provider, config),
    environment: environmentDescriptor(config),
    inputMode: config?.inputMode || null,
    project: config?.project || null,
    executionPolicy: {
      timeoutMs: Number(config?.timeoutMs || 120000),
      minimum: config?.minimum ?? null,
      report: config?.report || null,
      classification: config?.classification || null,
      foregroundRequired: Boolean(config?.foregroundRequired),
      foregroundAvailable: Boolean(config?.foregroundAvailable),
      readiness: config?.readiness || null
    }
  });
}

function taskBlocks(content) {
  const blocks = [];
  let current = null;
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*-\s*\[([ xX])\]\s*(.*)$/);
    if (match) {
      if (current) blocks.push(current);
      current = { done: match[1].toLowerCase() === "x", lines: [line], text: match[2] };
    } else if (current && (/^\s+/.test(line) || line.trim() === "")) {
      current.lines.push(line); current.text += ` ${line.trim()}`;
    } else if (current) {
      blocks.push(current); current = null;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function pendingTasks(id) {
  const content = readFileSync(join(activeChangePath(id), "tasks.md"), "utf8");
  return taskBlocks(content).filter((task) => !task.done);
}

function validate(id, source = "root") {
  const state = loadRuntime(id);
  if (state.status === "archived") die(`change '${id}' is already archived`);
  const dir = source === "active" ? activeChangePath(id, state) : changePath(id);
  const required = state.schema === "foundation-rapid"
    ? ["proposal.md", "tasks.md", "evidence.yaml"]
    : ["proposal.md", "design.md", "tasks.md", "evidence.yaml"];
  const missing = required.filter((name) => !existsSync(join(dir, name)));
  if (state.schema === "foundation-standard") {
    let specCount = 0;
    walk(join(dir, "specs"), () => { specCount += 1; });
    if (specCount === 0) missing.push("specs/**/*.md");
  }
  if (missing.length) die(`missing change artifacts: ${missing.join(", ")}`);
  if (!["low", "medium", "high"].includes(state.impact || ""))
    die(`resolve impact for '${id}'`);
  if (!["isolated", "coupled"].includes(state.coupling || ""))
    die(`resolve coupling for '${id}'`);
  const tasks = readFileSync(join(dir, "tasks.md"), "utf8");
  const lifecycleTasks = taskBlocks(tasks).filter((task) =>
    !task.done && /\/(?:prove|land)\b/.test(task.text));
  if (lifecycleTasks.length)
    die("tasks.md contains a lifecycle gate; /prove and /land are commands, not implementation tasks");
  const claims = evidence(id, dir).claims;
  state.evidenceCapabilities = [...new Set(claims.flatMap((claim) => claim.capabilities))];
  saveRuntime(state);
  console.log(`VALID ${id} (${state.schema}, ${claims.length} claims)`);
}

function requiredProviders(id) {
  const state = loadRuntime(id);
  const required = new Set(evidence(id).claims.flatMap((claim) => claim.capabilities));
  if (required.has("test")) required.add("discovery");
  if (state.reviewRequired) required.add("review");
  return [...required].sort();
}

function claimsForProvider(id, provider) {
  return evidence(id).claims.filter((claim) =>
    claim.capabilities.includes(provider) ||
    (provider === "discovery" && claim.capabilities.includes("test")) ||
    provider === "review");
}

function receiptValidity(id, provider, hash = relevantHash(id)) {
  const path = receiptPath(id, provider);
  if (!existsSync(path)) return { provider, validity: "missing" };
  const value = readJson(path);
  if (String(value.providerProtocolVersion || "") !== PROVIDER_PROTOCOL_VERSION)
    return { provider, validity: "provider-version-stale", status: value.status };
  const config = providerConfig(id, provider);
  const expectedFingerprint = config
    ? adapterFingerprint(id, provider, config)
    : stableHash({
      adapterProtocolVersion: value.adapterProtocolVersion || ADAPTER_PROTOCOL_VERSION,
      providerProtocolVersion: PROVIDER_PROTOCOL_VERSION,
      provider,
      adapter: value.adapter || "external",
      adapterVersion: String(value.providerVersion || "1"),
      command: value.command || null,
      claims: value.claims || [],
      environment: value.environment || null,
      inputMode: value.capability?.inputMode || null,
      project: value.project || null
    });
  if (value.providerFingerprint !== expectedFingerprint)
    return { provider, validity: "provider-fingerprint-stale", status: value.status };
  if (value.workspaceHash !== hash) return { provider, validity: "stale", status: value.status };
  if (value.status !== "pass") return { provider, validity: value.status };
  const requiredClaims = claimsForProvider(id, provider).map((claim) => claim.id);
  const covered = new Set(value.claims || []);
  if (requiredClaims.some((claim) => !covered.has(claim)))
    return { provider, validity: "incomplete-claims", status: value.status };
  const missingArtifacts = (value.artifacts || []).filter((artifact) =>
    artifact.required !== false && !existsSync(resolve(ROOT, artifact.path)));
  if (missingArtifacts.length)
    return { provider, validity: "missing-artifacts", status: value.status };
  return { provider, validity: "valid", receipt: value };
}

function proofPlan(id) {
  validate(id, "active");
  const hash = relevantHash(id);
  const rows = requiredProviders(id).map((provider) => receiptValidity(id, provider, hash));
  console.log(`PROOF PLAN ${id}\n  workspace: ${hash}`);
  for (const row of rows) console.log(`  ${row.provider}: ${row.validity}`);
}

function upgradeEvidence(id) {
  const state = loadRuntime(id);
  if (state.status === "archived") die(`change '${id}' is already archived`);
  const path = join(changePath(id), "evidence.yaml");
  const value = readJson(path);
  if (value.version === 2) {
    console.log(`EVIDENCE ${id}: already v2`);
    return;
  }
  if (value.version !== 1) die(`cannot upgrade unknown evidence version '${value.version}'`);
  value.version = 2;
  value.providers = {};
  writeJson(path, value);
  state.revision = Number(state.revision || 0) + 1;
  delete state.provenHash;
  if (existsSync(proofPath(id))) rmSync(proofPath(id));
  saveRuntime(state);
  console.log(`EVIDENCE ${id}: upgraded v1 → v2\n  configure providers before proof execute`);
}

function recordReceipt(id, provider, status, flags = {}) {
  if (!PROVIDERS.has(provider)) die(`unknown provider '${provider}'`);
  if (!["pass", "fail", "inconclusive", "error"].includes(status)) die(`invalid receipt status '${status}'`);
  const allClaims = evidence(id).claims.map((claim) => claim.id);
  const allowedClaims = claimsForProvider(id, provider).map((claim) => claim.id);
  const requestedClaims = String(
    !flags.claims || flags.claims === "declared" ? allowedClaims.join(",") : flags.claims
  ).split(",").filter(Boolean);
  if (requestedClaims.length === 0) die(`provider '${provider}' has no declared claims`);
  const unknownClaims = requestedClaims.filter((claim) => !allClaims.includes(claim));
  if (unknownClaims.length) die(`receipt references unknown claim(s): ${unknownClaims.join(", ")}`);
  const forbiddenClaims = requestedClaims.filter((claim) => !allowedClaims.includes(claim));
  if (forbiddenClaims.length)
    die(`provider '${provider}' is not declared for claim(s): ${forbiddenClaims.join(", ")}`);
  const config = flags.config || providerConfig(id, provider);
  const legacyForeground = flags.foreground || null;
  const foregroundRequired = flags["foreground-required"] !== undefined
    ? flags["foreground-required"] === "yes"
    : legacyForeground === "required";
  const foregroundAvailable = flags["foreground-available"] !== undefined
    ? flags["foreground-available"] === "yes"
    : legacyForeground === "available" || legacyForeground === "not-required";
  if (legacyForeground) console.error("WARNING: --foreground is deprecated; use --foreground-required and --foreground-available");
  const command = flags.command || null;
  const providerVersion = String(flags.version || config?.version || "1");
  const adapter = flags.adapter || config?.adapter || "external";
  const inputMode = flags["input-mode"] || config?.inputMode || null;
  const receipt = {
    version: 3, changeId: id, provider, providerVersion, adapter,
    adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
    providerProtocolVersion: PROVIDER_PROTOCOL_VERSION,
    providerFingerprint: config
      ? adapterFingerprint(id, provider, config)
      : stableHash({
        adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
        providerProtocolVersion: PROVIDER_PROTOCOL_VERSION,
        provider, adapter, adapterVersion: providerVersion,
        command, claims: requestedClaims,
        environment: flags.environment || null, inputMode,
        project: flags.project || null
      }),
    workspaceHash: relevantHash(id), claims: requestedClaims,
    status, observed: flags.observed || "", capability: {
      inputMode,
      foregroundRequired, foregroundAvailable
    },
    command, log: flags.log || null,
    artifacts: Array.isArray(flags.artifacts) ? flags.artifacts : [],
    environment: config ? environmentDescriptor(config) : (flags.environment || null),
    project: flags.project || config?.project || null,
    executionId: flags.executionId || null,
    durationMs: flags.durationMs === undefined ? null : Number(flags.durationMs),
    startedAt: flags.started || now(), finishedAt: now()
  };
  if (provider === "browser" && status === "pass" && receipt.capability.foregroundRequired &&
      !receipt.capability.foregroundAvailable) die("browser cannot pass when required foreground input is unavailable");
  if (provider === "browser" && status === "pass" &&
      !INPUT_MODES.has(receipt.capability.inputMode))
    die("passing browser receipt requires --input-mode browser-automation|dom-event|os-input|both");
  if (provider === "browser" && status === "pass" &&
      ["os-input", "both"].includes(receipt.capability.inputMode) &&
      (!receipt.capability.foregroundRequired || !receipt.capability.foregroundAvailable))
    die("passing OS-input browser receipt requires foreground-required=yes and foreground-available=yes");
  if (provider === "discovery" && status === "pass") {
    const discovered = Number(flags.discovered);
    const minimum = Number(flags.minimum);
    if (!Number.isFinite(discovered) || !Number.isFinite(minimum) || minimum <= 0 || discovered < minimum)
      die("passing discovery receipt requires --discovered N --minimum N with discovered >= minimum > 0");
    receipt.discovery = { discovered, minimum };
  }
  if (provider === "mutation" && status === "pass" &&
      !["behavioral-kill", "test-failure"].includes(flags.classification))
    die("passing mutation receipt requires --classification behavioral-kill|test-failure; crash is not a kill");
  if (provider === "mutation") receipt.classification = flags.classification || null;
  writeJson(receiptPath(id, provider), receipt);
  console.log(`RECEIPT ${id}/${provider}: ${status}`);
}

function runProvider(id, provider, values) {
  if (!PROVIDERS.has(provider)) die(`unknown provider '${provider}'`);
  const split = values.indexOf("--");
  if (split < 0 || split === values.length - 1) die("run-provider requires '-- <command> [args...]'");
  const { flags, rest } = parseFlags(values.slice(0, split));
  if (rest.length) die(`unexpected run-provider argument(s): ${rest.join(", ")}`);
  if (!flags.claims) die("run-provider requires --claims <a,b|declared> before '--'");
  const command = values[split + 1];
  const commandArgs = values.slice(split + 2);
  const started = now();
  const startedMs = Date.now();
  const result = spawnSync(command, commandArgs, {
    cwd: loadRuntime(id).workspace?.path || ROOT, encoding: "utf8",
    env: { ...process.env, FOUNDATION_CHANGE_ID: id }
  });
  const logDir = join(LOGS, id);
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `${provider}-${Date.now()}.log`);
  writeFileSync(logPath, `${result.stdout || ""}${result.stderr || ""}`);
  recordReceipt(id, provider, result.status === 0 ? "pass" : "fail", {
    ...flags,
    started, command: [command, ...commandArgs].join(" "),
    log: relative(ROOT, logPath), observed: `exit ${result.status ?? "error"}`,
    durationMs: Date.now() - startedMs
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function parseJsonOutput(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); }
      catch { return null; }
    }
    return null;
  }
}

function numericReportValue(report, keys) {
  if (!report || typeof report !== "object") return null;
  for (const key of keys)
    if (Number.isFinite(Number(report[key]))) return Number(report[key]);
  for (const value of Object.values(report)) {
    if (!value || typeof value !== "object") continue;
    const found = numericReportValue(value, keys);
    if (found !== null) return found;
  }
  return null;
}

function playwrightReportSummary(report) {
  const claims = new Set();
  const attachments = new Set();
  let tests = 0;
  let failed = 0;
  let skipped = 0;
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value.annotations))
      for (const annotation of value.annotations)
        if (annotation?.type === "claim" && annotation.description)
          claims.add(String(annotation.description));
    if (Array.isArray(value.attachments))
      for (const attachment of value.attachments)
        if (attachment?.path) attachments.add(String(attachment.path));
    if (Array.isArray(value.results)) {
      tests += 1;
      const statuses = value.results.map((result) => result?.status).filter(Boolean);
      if (statuses.some((status) => ["failed", "timedOut", "interrupted"].includes(status))) failed += 1;
      else if (statuses.length && statuses.every((status) => status === "skipped")) skipped += 1;
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  }
  visit(report);
  return {
    claims: [...claims].sort(), attachments: [...attachments].sort(),
    tests, failed, skipped
  };
}

function runCommand(command, args, options) {
  return new Promise((complete) => {
    const startedAt = now();
    const startedMs = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let readinessObserved = !options.readiness?.url;
    let readinessTimer = null;
    let closed = false;
    const observeReadiness = async () => {
      if (closed || readinessObserved) return;
      try {
        const response = await fetch(options.readiness.url, {
          signal: AbortSignal.timeout(750)
        });
        if (response.status >= 200 && response.status < 500) {
          readinessObserved = true;
          return;
        }
      } catch {
        // The process may still be starting; retry until it exits or times out.
      }
      if (!closed) readinessTimer = setTimeout(observeReadiness, 100);
    };
    const child = spawn(command, args, {
      cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    if (options.readiness?.url) observeReadiness();
    child.on("error", (error) => complete({
      status: null, signal: null, error, stdout, stderr,
      timedOut, readinessObserved,
      startedAt, finishedAt: now(), durationMs: Date.now() - startedMs
    }));
    const timeoutMs = Number(options.timeoutMs || 120000);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);
    child.on("close", (status, signal) => {
      closed = true;
      clearTimeout(timer);
      if (readinessTimer) clearTimeout(readinessTimer);
      complete({
        status, signal, error: null, stdout, stderr,
        timedOut, readinessObserved,
        startedAt, finishedAt: now(), durationMs: Date.now() - startedMs
      });
    });
  });
}

function executionLog(id, provider, executionId, result) {
  const logPath = join(LOGS, id, `${executionId}-${provider}.log`);
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath,
    `status=${result.status ?? "error"} signal=${result.signal || ""} timedOut=${result.timedOut}\n` +
    `durationMs=${result.durationMs}\n\n${result.stdout || ""}${result.stderr || ""}`);
  return {
    path: relative(ROOT, logPath), type: "command-log", required: true
  };
}

function configuredCommand(provider, config) {
  const [command, ...originalArgs] = config.command;
  const args = [...originalArgs];
  const directPlaywright = config.adapter === "playwright" &&
    ([command, ...args].some((part) =>
      part === "playwright" || part.endsWith("/playwright") ||
      part === "@playwright/test"));
  if (directPlaywright) {
    if (config.project && !args.some((arg) => arg === "--project" || arg.startsWith("--project=")))
      args.push(`--project=${config.project}`);
    if (!args.some((arg) => arg === "--reporter" || arg.startsWith("--reporter=")))
      args.push("--reporter=json");
  }
  return { command, args, display: [command, ...args].join(" ") };
}

function adapterResources(provider, config) {
  if (Array.isArray(config.resources)) return [...new Set(config.resources)].sort();
  if (config.adapter === "playwright") return ["browser", "dev-server", "workspace-read"];
  if (provider === "mutation") return ["workspace-write"];
  return ["workspace-read"];
}

function resourcesConflict(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  if (a.has("workspace-write") && [...b].some((item) => item.startsWith("workspace-"))) return true;
  if (b.has("workspace-write") && [...a].some((item) => item.startsWith("workspace-"))) return true;
  return [...a].some((item) => item !== "workspace-read" && b.has(item));
}

async function executeAdapter(id, provider, config, executionId, commandCache) {
  const state = loadRuntime(id);
  const cwd = state.workspace?.path || ROOT;
  const built = configuredCommand(provider, config);
  const executionEnv = {
    ...process.env,
    ...(config.env || {}),
    FOUNDATION_CHANGE_ID: id,
    FOUNDATION_EXECUTION_ID: executionId
  };
  const dedupKey = stableHash({
    cwd, command: built.command, args: built.args,
    env: config.env || {}, timeoutMs: Number(config.timeoutMs || 120000),
    readiness: config.readiness || null
  });
  if (!commandCache.has(dedupKey))
    commandCache.set(dedupKey, runCommand(built.command, built.args, {
      cwd, timeoutMs: config.timeoutMs, env: executionEnv,
      readiness: config.readiness
    }));
  const result = await commandCache.get(dedupKey);
  const logArtifact = executionLog(id, provider, executionId, result);
  const artifacts = [logArtifact];
  const configuredReport = config.report ? resolve(cwd, config.report) : null;
  if (configuredReport && existsSync(configuredReport))
    artifacts.push({
      path: relative(ROOT, configuredReport), type: "structured-report", required: true
    });
  const report = configuredReport && existsSync(configuredReport)
    ? parseJsonOutput(readFileSync(configuredReport, "utf8"))
    : parseJsonOutput(result.stdout);
  const baseFlags = {
    config, adapter: config.adapter, executionId,
    claims: providerClaims(id, provider, config).join(","),
    command: built.display, started: result.startedAt,
    observed: result.timedOut ? `timeout after ${result.durationMs}ms` :
      result.error ? result.error.message :
      `exit ${result.status}; ${result.durationMs}ms; readiness ${result.readinessObserved ? "observed" : "not-observed"}`,
    durationMs: result.durationMs,
    log: logArtifact.path, artifacts,
    environment: config.environment || null, project: config.project || null
  };

  if (config.adapter === "test-discovery") {
    const testStatus = result.timedOut || result.error ? "error" :
      result.status === 0 ? "pass" : "fail";
    recordReceipt(id, "test", testStatus, {
      ...baseFlags, claims: providerClaims(id, "test", config).join(",")
    });
    const discovered = numericReportValue(report, [
      "numTotalTests", "totalTests", "tests", "testCount", "expected"
    ]);
    const minimum = Number(config.minimum || 1);
    const discoveryStatus = result.timedOut || result.error ? "error" :
      discovered === null ? "inconclusive" :
      discovered >= minimum ? "pass" : "fail";
    recordReceipt(id, "discovery", discoveryStatus, {
      ...baseFlags,
      claims: providerClaims(id, "discovery", config).join(","),
      discovered: discovered ?? 0, minimum,
      observed: discovered === null ? "structured test count unavailable" :
        `${discovered} discovered; minimum ${minimum}`
    });
    return { provider, status: testStatus === "pass" && discoveryStatus === "pass" ? "pass" : "blocked" };
  }

  if (config.adapter === "playwright") {
    const summary = report ? playwrightReportSummary(report) : null;
    for (const attachment of summary?.attachments || []) {
      const attachmentPath = isAbsolute(attachment) ? attachment : resolve(cwd, attachment);
      if (existsSync(attachmentPath))
        artifacts.push({
          path: relative(ROOT, attachmentPath),
          type: "playwright-attachment", required: false
        });
    }
    const requiredClaims = providerClaims(id, provider, config);
    const missingClaims = summary
      ? requiredClaims.filter((claim) => !summary.claims.includes(claim))
      : requiredClaims;
    const status = result.timedOut || result.error ||
      (config.readiness?.url && !result.readinessObserved) ? "error" :
      result.status !== 0 || (summary?.failed || 0) > 0 ? "fail" :
      !summary || missingClaims.length ? "inconclusive" : "pass";
    recordReceipt(id, provider, status, {
      ...baseFlags,
      "input-mode": config.inputMode || "browser-automation",
      "foreground-required": config.foregroundRequired ? "yes" : "no",
      "foreground-available": config.foregroundAvailable ? "yes" : "no",
      observed: summary
        ? `${summary.tests} tests; ${summary.failed} failed; claims ${summary.claims.length}/${requiredClaims.length}` +
          (missingClaims.length ? `; missing ${missingClaims.join(",")}` : "")
        : "Playwright JSON report unavailable"
    });
    return { provider, status };
  }

  const status = result.timedOut || result.error ? "error" :
    result.status === 0 ? "pass" : "fail";
  recordReceipt(id, provider, status, {
    ...baseFlags,
    "input-mode": config.inputMode || null,
    "foreground-required": config.foregroundRequired ? "yes" : "no",
    "foreground-available": config.foregroundAvailable ? "yes" : "no",
    classification: config.classification
  });
  return { provider, status };
}

function executionNodes(id, hash) {
  const needed = requiredProviders(id)
    .filter((provider) => receiptValidity(id, provider, hash).validity !== "valid");
  const nodes = [];
  const unconfigured = [];
  const unavailable = [];
  const claimed = new Set();
  for (const provider of needed) {
    if (claimed.has(provider)) continue;
    const config = providerConfig(id, provider);
    if (!config || config.adapter === "external") {
      unconfigured.push(provider);
      continue;
    }
    if (!commandExists(config.command?.[0], loadRuntime(id).workspace?.path || ROOT)) {
      unavailable.push(`${provider}:command`);
      continue;
    }
    if (config.adapter === "playwright") {
      const availability = playwrightAvailability(loadRuntime(id).workspace?.path || ROOT);
      if (!availability.packageOwned || !availability.binaryAvailable) {
        unavailable.push(`${provider}:project-owned-playwright`);
        continue;
      }
    }
    const covers = config.adapter === "test-discovery" && ["test", "discovery"].includes(provider)
      ? ["test", "discovery"] : [provider];
    covers.forEach((item) => claimed.add(item));
    nodes.push({
      provider: config.adapter === "test-discovery" ? "test" : provider,
      covers, config, resources: adapterResources(provider, config),
      dependsOn: config.dependsOn || []
    });
  }
  return { nodes, unconfigured, unavailable };
}

async function runExecutionDag(id, nodes, executionId) {
  const pending = new Map(nodes.map((node) => [node.provider, node]));
  const completed = new Set();
  const commandCache = new Map();
  while (pending.size) {
    const ready = [...pending.values()].filter((node) =>
      node.dependsOn.every((dependency) =>
        completed.has(dependency) ||
        receiptValidity(id, dependency).validity === "valid"));
    if (!ready.length)
      die(`provider dependency cycle or blocked dependency: ${[...pending.keys()].join(", ")}`);
    const batch = [];
    for (const node of ready)
      if (batch.every((selected) => !resourcesConflict(selected.resources, node.resources)))
        batch.push(node);
    console.log(`EXECUTION ${executionId}: ${batch.map((node) => node.provider).join(", ")}`);
    const results = await Promise.all(batch.map((node) =>
      executeAdapter(id, node.provider, node.config, executionId, commandCache)));
    for (let index = 0; index < batch.length; index += 1) {
      pending.delete(batch[index].provider);
      if (results[index].status === "pass")
        for (const covered of batch[index].covers) completed.add(covered);
      else
        console.error(`PROVIDER ${batch[index].provider}: ${results[index].status}`);
    }
  }
}

async function proofExecute(id) {
  validate(id, "active");
  const pending = pendingTasks(id);
  if (pending.length) die(`${pending.length} implementation task(s) remain unchecked`);
  const hash = relevantHash(id);
  const { nodes, unconfigured, unavailable } = executionNodes(id, hash);
  if (unconfigured.length)
    die(`missing executable adapter for provider(s): ${unconfigured.join(", ")}; record external receipts or configure evidence v2`);
  if (unavailable.length)
    die(`provider environment unavailable: ${unavailable.join(", ")}; run doctor --change ${id}`);
  const executionId = `proof-${Date.now()}`;
  if (nodes.length) await runExecutionDag(id, nodes, executionId);
  else console.log(`EXECUTION ${executionId}: all receipts reused`);
  prove(id);
}

function prove(id) {
  const stateBefore = loadRuntime(id);
  if (stateBefore.status === "archived") die(`change '${id}' is already archived`);
  validate(id, "active");
  const pending = pendingTasks(id);
  if (pending.length) die(`${pending.length} implementation task(s) remain unchecked`);
  const hash = relevantHash(id);
  const checks = requiredProviders(id).map((provider) => receiptValidity(id, provider, hash));
  const blockers = checks.filter((row) => row.validity !== "valid");
  if (blockers.length) die(blockers.map((row) => `${row.provider}:${row.validity}`).join(", "));
  const proof = {
    version: 1, changeId: id, status: "pass", workspaceHash: hash,
    providers: checks.map((row) => row.provider), createdAt: now()
  };
  writeJson(proofPath(id), proof);
  const state = loadRuntime(id); state.status = "proven"; state.provenHash = hash; saveRuntime(state);
  console.log(`PROVEN ${id}\n  workspace: ${hash}\n  providers: ${proof.providers.join(", ")}\n  next: /land ${id}`);
}

function landCheck(id) {
  const state = loadRuntime(id);
  if (state.status === "archived") {
    console.log(`ALREADY ARCHIVED ${id}\n  archived: ${state.archivedAt || "unknown"}`);
    return { archived: true, state };
  }
  const proof = existsSync(proofPath(id)) ? readJson(proofPath(id)) : null;
  if (!proof || proof.status !== "pass") die(`change '${id}' has no passing proof`);
  const hash = relevantHash(id);
  if (proof.workspaceHash !== hash) die(`proof is stale (${proof.workspaceHash.slice(0, 8)} != ${hash.slice(0, 8)})`);
  for (const provider of requiredProviders(id)) {
    const check = receiptValidity(id, provider, hash);
    if (check.validity !== "valid") die(`${provider} evidence is ${check.validity}`);
  }
  console.log(`LAND READY ${id}\n  workspace: ${hash}`);
  return { archived: false, state, hash };
}

function createCopySandbox(id, state, reason) {
  const path = mkdtempSync(join(tmpdir(), `foundation-${id}-`));
  cpSync(ROOT, path, {
    recursive: true,
    filter: (source) => {
      const rel = relative(ROOT, source).replaceAll("\\", "/");
      return (rel === "" && source === ROOT) ||
        !rel.split("/").some((segment) => EXCLUDED_WORKSPACE_DIRS.has(segment));
    }
  });
  state.workspace = {
    mode: "copy", path, applied: false, reason,
    baseline: workspaceManifest(ROOT, id, true),
    changeSourceHash: directoryHash(changePath(id))
  };
  saveRuntime(state);
  console.log(`SANDBOX ${id}\n  mode: isolated-copy\n  reason: ${reason}\n  path: ${path}`);
}

function createSandbox(id) {
  const state = loadRuntime(id);
  if (state.status === "archived") die(`change '${id}' is already archived`);
  if (["worktree", "copy"].includes(state.workspace?.mode) && existsSync(state.workspace.path))
    die(`sandbox already exists: ${state.workspace.path}`);
  if (!gitHead(ROOT)) {
    createCopySandbox(id, state, "no-git");
    return;
  }
  const dirty = git(["status", "--porcelain", "--untracked-files=all"], ROOT);
  if (dirty.status !== 0) die(`cannot inspect target workspace: ${dirty.stderr.trim()}`);
  const allowedPrefix = `openspec/changes/${id}/`;
  const unrelated = dirty.stdout.split("\n").filter(Boolean).filter((line) => {
    const path = line.slice(3).split(" -> ").at(-1);
    return path !== `openspec/changes/${id}` && !path.startsWith(allowedPrefix);
  });
  if (unrelated.length) {
    createCopySandbox(id, state, `dirty-target:${unrelated[0]}`);
    return;
  }
  const path = join(ROOT, ".foundation", "sandboxes", id);
  mkdirSync(dirname(path), { recursive: true });
  const result = git(["worktree", "add", "--detach", path, "HEAD"]);
  if (result.status !== 0) die(`cannot create sandbox: ${result.stderr.trim()}`);
  cpSync(changePath(id), join(path, "openspec", "changes", id), { recursive: true });
  state.workspace = {
    mode: "worktree", path, baseHead: gitHead(ROOT), applied: false,
    changeSourceHash: directoryHash(changePath(id))
  };
  saveRuntime(state);
  console.log(`SANDBOX ${id}\n  path: ${path}`);
}

function mergeTaskProgress(source, sandbox) {
  const completed = new Set(
    sandbox.split("\n")
      .filter((line) => /^\s*-\s*\[[xX]\]/.test(line))
      .map((line) => line.replace(/^(\s*-\s*)\[[xX]\]/, "$1[]").replace(/\s+/g, " ").trim())
  );
  return source.split("\n").map((line) => {
    if (!/^\s*-\s*\[\s\]/.test(line)) return line;
    const key = line.replace(/^(\s*-\s*)\[\s\]/, "$1[]").replace(/\s+/g, " ").trim();
    return completed.has(key) ? line.replace("[ ]", "[x]") : line;
  }).join("\n");
}

function syncSandbox(id) {
  validate(id);
  const state = loadRuntime(id);
  const workspace = state.workspace;
  if (!workspace || !["worktree", "copy"].includes(workspace.mode) ||
      !workspace.path || !existsSync(workspace.path))
    die(`change '${id}' has no active sandbox`);
  const source = changePath(id);
  const destination = join(workspace.path, "openspec", "changes", id);
  const sourceTasks = readFileSync(join(source, "tasks.md"), "utf8");
  const sandboxTasks = existsSync(join(destination, "tasks.md"))
    ? readFileSync(join(destination, "tasks.md"), "utf8") : "";
  const mergedTasks = mergeTaskProgress(sourceTasks, sandboxTasks);
  if (existsSync(destination)) rmSync(destination, { recursive: true });
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
  writeFileSync(join(destination, "tasks.md"), mergedTasks);
  state.workspace.changeSourceHash = directoryHash(source);
  state.status = "building";
  state.revision = Number(state.revision || 0) + 1;
  delete state.provenHash;
  if (existsSync(proofPath(id))) rmSync(proofPath(id));
  saveRuntime(state);
  console.log(`SYNCED ${id}\n  revision: ${state.revision}\n  workspace: ${relevantHash(id)}`);
}

function applyChangeArtifacts(id, sandboxPath) {
  const target = changePath(id);
  const source = join(sandboxPath, "openspec", "changes", id);
  if (existsSync(target)) rmSync(target, { recursive: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

function applySandbox(id) {
  const readiness = landCheck(id);
  if (readiness.archived) return;
  const state = loadRuntime(id);
  if (state.workspace?.mode === "copy") {
    if (directoryHash(changePath(id)) !== state.workspace.changeSourceHash)
      die("active change was edited after the last sandbox sync");
    const baseline = state.workspace.baseline || {};
    const sandbox = workspaceManifest(state.workspace.path, id, true);
    const target = workspaceManifest(ROOT, id, true);
    const paths = [...new Set([...Object.keys(baseline), ...Object.keys(sandbox)])].sort();
    const changed = paths.filter((path) => baseline[path] !== sandbox[path]);
    for (const path of changed)
      if (target[path] !== baseline[path])
        die(`isolated-copy conflict at '${path}'`);
    for (const path of changed) {
      const source = join(state.workspace.path, path);
      const destination = join(ROOT, path);
      if (sandbox[path]) {
        mkdirSync(dirname(destination), { recursive: true });
        cpSync(source, destination);
      } else if (existsSync(destination)) rmSync(destination);
    }
    const sandboxHash = relevantHash(id, state.workspace.path);
    applyChangeArtifacts(id, state.workspace.path);
    state.workspace = {
      ...state.workspace, path: ROOT, applied: true,
      sandboxPath: state.workspace.path, baseline: undefined
    };
    state.status = "applied";
    saveRuntime(state);
    const targetHash = relevantHash(id, ROOT);
    if (targetHash !== sandboxHash) die("post-apply isolated-copy identity mismatch");
    console.log(`APPLIED ${id}\n  mode: isolated-copy\n  workspace: ${targetHash}`);
    return;
  }
  if (state.workspace?.mode !== "worktree") die("change has no isolated sandbox");
  if (directoryHash(changePath(id)) !== state.workspace.changeSourceHash)
    die("active change was edited after the last sandbox sync");
  if (gitHead(ROOT) !== state.workspace.baseHead) die("target HEAD moved since sandbox creation");
  git(["add", "-N", "."], state.workspace.path);
  const diff = git([
    "diff", "--binary", "HEAD", "--", ".",
    `:(exclude)openspec/changes/${id}/**`,
    ":(exclude)coverage/**", ":(exclude)test-results/**",
    ":(exclude)playwright-report/**", ":(exclude).foundation/**"
  ], state.workspace.path);
  if (diff.status !== 0 || !diff.stdout) die("sandbox has no applicable diff");
  const check = spawnSync("git", ["apply", "--check", "--whitespace=nowarn", "-"], {
    cwd: ROOT, input: diff.stdout, encoding: "utf8"
  });
  if (check.status !== 0) die(`sandbox diff conflicts with target: ${check.stderr.trim()}`);
  const apply = spawnSync("git", ["apply", "--whitespace=nowarn", "-"], {
    cwd: ROOT, input: diff.stdout, encoding: "utf8"
  });
  if (apply.status !== 0) die(`sandbox apply failed: ${apply.stderr.trim()}`);
  const sandboxHash = relevantHash(id, state.workspace.path);
  applyChangeArtifacts(id, state.workspace.path);
  state.workspace = { ...state.workspace, path: ROOT, applied: true, sandboxPath: state.workspace.path };
  state.status = "applied";
  saveRuntime(state);
  const targetHash = relevantHash(id, ROOT);
  if (targetHash !== sandboxHash) die("post-apply workspace identity mismatch");
  console.log(`APPLIED ${id}\n  workspace: ${targetHash}`);
}

function cleanupAppliedSandbox(id, state) {
  const path = state.workspace?.sandboxPath;
  if (!path || resolve(path) === resolve(ROOT) || !existsSync(path))
    return { status: "not-needed", path: path || null };
  if (state.workspace.mode === "copy") {
    const expectedPrefix = `${resolve(tmpdir())}/foundation-${id}-`;
    if (!resolve(path).startsWith(expectedPrefix))
      return { status: "refused", path, reason: "copy path is outside the Foundation temp prefix" };
    try {
      rmSync(path, { recursive: true });
      return { status: "removed", path };
    } catch (error) {
      return { status: "failed", path, reason: error.message };
    }
  }
  if (state.workspace.mode === "worktree") {
    const expected = resolve(ROOT, ".foundation", "sandboxes", id);
    if (resolve(path) !== expected)
      return { status: "refused", path, reason: "worktree path is outside the expected sandbox location" };
    const removed = git(["worktree", "remove", "--force", path], ROOT);
    if (removed.status !== 0)
      return { status: "failed", path, reason: removed.stderr.trim() };
    git(["worktree", "prune"], ROOT);
    return { status: "removed", path };
  }
  return { status: "not-needed", path };
}

function archive(id) {
  let readiness = landCheck(id);
  if (readiness.archived) return;
  if (["worktree", "copy"].includes(readiness.state.workspace?.mode) &&
      !readiness.state.workspace.applied) {
    applySandbox(id);
    readiness = landCheck(id);
  }
  const state = readiness.state;
  const pending = pendingTasks(id);
  if (pending.length) die(`${pending.length} implementation task(s) remain unchecked`);
  const preArchiveWorkspaceHash = readiness.hash;
  const installed = spawnSync("openspec", ["--version"], { cwd: ROOT, encoding: "utf8" });
  if (installed.error?.code === "ENOENT")
    die("OpenSpec CLI is required for safe spec sync and archive (@fission-ai/openspec@1.7.0)");
  const installedVersion = `${installed.stdout || ""}${installed.stderr || ""}`;
  if (!isPinnedOpenSpecVersion(installedVersion))
    die(`OpenSpec version mismatch; required 1.7.0, found '${installedVersion.trim()}'`);
  const cli = spawnSync("openspec", ["archive", id, "--yes"], { cwd: ROOT, encoding: "utf8" });
  if (cli.status !== 0) die(`OpenSpec archive failed: ${(cli.stderr || cli.stdout).trim()}`);
  state.status = "archived";
  state.archivedAt = now();
  state.preArchiveWorkspaceHash = preArchiveWorkspaceHash;
  state.archivedChangePath = archivedChangeRelativePath(id);
  state.workspace.cleanup = cleanupAppliedSandbox(id, state);
  saveRuntime(state);
  if (!state.archivedChangePath)
    console.error("WARNING: OpenSpec reported success but the archived change directory was not found");
  if (["failed", "refused"].includes(state.workspace.cleanup.status))
    console.error(`WARNING: sandbox cleanup ${state.workspace.cleanup.status}: ${state.workspace.cleanup.reason}`);
  console.log(cli.stdout.trim());
  console.log(`ARCHIVED ${id}`);
}

function showChanges() {
  const ids = activeChanges();
  if (!ids.length) { console.log("No active changes."); return; }
  for (const id of ids) {
    const state = existsSync(runtimePath(id)) ? readJson(runtimePath(id)) : { status: "untracked" };
    const proof = existsSync(proofPath(id)) ? readJson(proofPath(id), {}) : null;
    const current = existsSync(runtimePath(id)) ? relevantHash(id) : null;
    const readiness = proof?.status === "pass" && proof.workspaceHash === current ? "ready-to-land" :
      state.status === "proven" ? "stale-proof" : state.status;
    console.log(`${id}\t${readiness}\t${state.schema || "unknown"}`);
  }
}

function showProviders() {
  for (const [provider, contract] of Object.entries(PROVIDER_CONTRACTS))
    console.log(`${provider}\t${contract}`);
}

function changedFiles(id, state) {
  const workspace = state.workspace?.path || ROOT;
  if (gitHead(workspace)) {
    const result = git(["status", "--porcelain", "--untracked-files=all"], workspace);
    if (result.status === 0)
      return result.stdout.split("\n").filter(Boolean)
        .map((line) => line.slice(3).split(" -> ").at(-1)).sort();
  }
  if (state.workspace?.mode === "copy" && state.workspace.baseline) {
    const current = workspaceManifest(workspace, id, true);
    return [...new Set([
      ...Object.keys(state.workspace.baseline), ...Object.keys(current)
    ])].filter((path) => state.workspace.baseline[path] !== current[path]).sort();
  }
  return [];
}

function packetValue(id) {
  const state = loadRuntime(id);
  const activePath = activeChangePath(id, state);
  const contract = evidence(id, activePath);
  const claims = contract.claims;
  const hash = relevantHash(id);
  const providers = requiredProviders(id).map((provider) => {
    const check = receiptValidity(id, provider, hash);
    const config = providerConfig(id, provider);
    return {
      provider, adapter: config?.adapter || "external",
      resources: config ? adapterResources(provider, config) : [],
      validity: check.validity, status: check.status || check.receipt?.status || null
    };
  });
  const packet = {
    version: 2, changeId: id, intent: state.intent, schema: state.schema,
    status: state.status, revision: Number(state.revision || 0),
    impact: state.impact, coupling: state.coupling,
    reviewRequired: Boolean(state.reviewRequired),
    changePath: relative(ROOT, activePath) || ".",
    workspacePath: state.workspace?.path || ROOT,
    workspaceHash: hash,
    pendingTaskCount: pendingTasks(id).length,
    claims: claims.map((claim) => ({
      id: claim.id,
      scenario: String(claim.scenario).slice(0, 500),
      capabilities: claim.capabilities
    })),
    providers, changedFiles: changedFiles(id, state),
    invariants: Array.isArray(contract.invariants)
      ? contract.invariants.map((value) => String(value).slice(0, 500)).slice(0, 20) : [],
    budget: state.budget
  };
  const encoded = JSON.stringify(packet);
  if (Buffer.byteLength(encoded) > 65536)
    die("compact packet exceeds 64 KiB; split the change or shorten scenarios/invariants");
  return { ...packet, packetDigest: stableHash(packet) };
}

function showPacket(id) {
  console.log(JSON.stringify(packetValue(id), null, 2));
}

function recordEvent(id, flags) {
  const state = loadRuntime(id);
  for (const field of ["input", "output", "cache", "cost", "duration"])
    if (flags[field] !== undefined && !Number.isFinite(Number(flags[field])))
      die(`event --${field} must be numeric`);
  const event = {
    runId: flags.run || id, operationId: flags.operation || "unknown",
    agentId: flags.agent || null, modelId: flags.model || null,
    requestId: flags.request || null, parentRequestId: flags.parent || null,
    timestamp: now(),
    inputTokens: flags.input === undefined ? null : Number(flags.input),
    outputTokens: flags.output === undefined ? null : Number(flags.output),
    cacheTokens: flags.cache === undefined ? null : Number(flags.cache),
    cost: flags.cost === undefined ? null : Number(flags.cost),
    durationMs: flags.duration === undefined ? null : Number(flags.duration),
    tool: flags.tool || null, workspaceHash: relevantHash(id), changeId: id
  };
  if (!event.requestId) die("event requires --request for unique telemetry identity");
  const path = join(LOGS, id, "events.jsonl"); mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const duplicate = readFileSync(path, "utf8").split("\n").filter(Boolean).some((line) => {
      try { return JSON.parse(line).requestId === event.requestId; }
      catch { die(`invalid telemetry ledger: ${relative(ROOT, path)}`); }
    });
    if (duplicate) die(`duplicate telemetry request '${event.requestId}'`);
  }
  appendFileSync(path, `${JSON.stringify(event)}\n`);
  state.budget.usedRequests = Number(state.budget.usedRequests || 0) + 1;
  state.budget.measurement = "external-events";
  const ratio = state.budget.usedRequests / Number(state.budget.targetRequests || 1);
  saveRuntime(state);
  const action = ratio >= 1 ? "STOP_AND_SPLIT" : ratio >= 0.85 ? "STOP_EXPLORATION" :
    ratio >= 0.7 ? "BATCH_AND_REUSE" : "CONTINUE";
  console.log(`BUDGET ${id}: ${(ratio * 100).toFixed(1)}% ${action}`);
  if (ratio >= 1) process.exit(2);
}

function readJsonLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); }
    catch (error) { die(`invalid JSONL: ${relative(ROOT, path)} (${error.message})`); }
  });
}

function sumKnown(rows, field) {
  const values = rows.map((row) => row[field]).filter((value) =>
    value !== null && value !== undefined && Number.isFinite(Number(value)));
  return values.length ? values.reduce((sum, value) => sum + Number(value), 0) : null;
}

function showMetrics(id) {
  loadRuntime(id);
  const operations = readJsonLines(join(LOGS, id, "operations.jsonl"));
  const events = readJsonLines(join(LOGS, id, "events.jsonl"));
  const phases = {};
  for (const operation of operations) {
    const name = operation.phase || operation.operation || "unknown";
    phases[name] ||= { operations: 0, durationMs: 0, failed: 0 };
    phases[name].operations += 1;
    phases[name].durationMs += Number(operation.durationMs || 0);
    if (operation.status !== "completed") phases[name].failed += 1;
  }
  const providers = {};
  const executions = new Map();
  const receiptDir = join(RECEIPTS, id);
  if (existsSync(receiptDir))
    for (const entry of readdirSync(receiptDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "proof.json") continue;
      const receipt = readJson(join(receiptDir, entry.name));
      providers[receipt.provider || entry.name.replace(/\.json$/, "")] = {
        status: receipt.status,
        adapter: receipt.adapter || "external",
        durationMs: receipt.durationMs ?? null,
        executionId: receipt.executionId || null
      };
      if (receipt.executionId && Number.isFinite(Number(receipt.durationMs)))
        executions.set(receipt.executionId,
          Math.max(executions.get(receipt.executionId) || 0, Number(receipt.durationMs)));
    }
  const tokenTotal = ["inputTokens", "outputTokens", "cacheTokens"]
    .map((field) => sumKnown(events, field))
    .filter((value) => value !== null)
    .reduce((sum, value) => sum + value, 0);
  const orchestratorEvents = events.filter((event) =>
    event.agentId === "orchestrator" || event.operationId === "orchestrator");
  const orchestratorTokens = ["inputTokens", "outputTokens", "cacheTokens"]
    .map((field) => sumKnown(orchestratorEvents, field))
    .filter((value) => value !== null)
    .reduce((sum, value) => sum + value, 0);
  const totalCost = sumKnown(events, "cost");
  const orchestratorCost = sumKnown(orchestratorEvents, "cost");
  console.log(JSON.stringify({
    version: 1, changeId: id,
    wallTimeMs: operations.length
      ? Math.max(...operations.map((row) => Date.parse(row.finishedAt))) -
        Math.min(...operations.map((row) => Date.parse(row.startedAt))) : null,
    phases, providers,
    evidenceExecutionTimeMs: executions.size
      ? [...executions.values()].reduce((sum, value) => sum + value, 0) : null,
    requests: events.length || null,
    inputTokens: sumKnown(events, "inputTokens"),
    outputTokens: sumKnown(events, "outputTokens"),
    cacheTokens: sumKnown(events, "cacheTokens"),
    cost: totalCost,
    orchestratorTokenShare: tokenTotal > 0 ? orchestratorTokens / tokenTotal : null,
    orchestratorCostShare: totalCost > 0 && orchestratorCost !== null
      ? orchestratorCost / totalCost : null,
    measurement: events.length ? "operations-and-external-events" : "operations-only"
  }, null, 2));
}

function doctor(flags = {}) {
  const checks = [];
  const nodeParts = process.versions.node.split(".").map(Number);
  const nodeOk = nodeParts[0] > 20 || (nodeParts[0] === 20 && nodeParts[1] >= 19);
  checks.push({ level: nodeOk ? "ok" : "error", name: "node", detail: process.versions.node });

  const openspec = spawnSync("openspec", ["--version"], { cwd: ROOT, encoding: "utf8" });
  const openspecText = `${openspec.stdout || ""}${openspec.stderr || ""}`.trim();
  const openspecOk = openspec.status === 0 && isPinnedOpenSpecVersion(openspecText);
  checks.push({
    level: openspecOk ? "ok" : (flags["require-archive"] ? "error" : "warn"),
    name: "openspec", detail: openspec.error?.code === "ENOENT" ? "missing; archive unavailable" :
      openspecOk ? openspecText : `${openspecText || "unavailable"}; required 1.7.0`
  });

  const requestedChange = flags.change || null;
  if (requestedChange) {
    const state = loadRuntime(requestedChange);
    const workspace = state.workspace?.path || ROOT;
    const contract = evidence(requestedChange);
    const playwright = playwrightAvailability(workspace);
    for (const provider of requiredProviders(requestedChange)) {
      const config = providerConfig(requestedChange, provider);
      const current = receiptValidity(requestedChange, provider);
      if (!config) {
        checks.push({
          level: current.validity === "valid" ? "ok" : "warn",
          name: `provider:${provider}`,
          detail: current.validity === "valid" ? "external receipt valid" : "no executable adapter; external receipt required"
        });
        continue;
      }
      if (config.adapter === "external") {
        checks.push({
          level: current.validity === "valid" ? "ok" : "warn",
          name: `provider:${provider}`,
          detail: current.validity === "valid" ? "external receipt valid" : "awaiting external receipt"
        });
        continue;
      }
      const executable = config.command?.[0];
      checks.push({
        level: commandExists(executable, workspace) ? "ok" : "error",
        name: `provider:${provider}:command`,
        detail: commandExists(executable, workspace) ? executable : `${executable || "missing"} unavailable`
      });
      if (config.adapter === "playwright") {
        checks.push({
          level: playwright.packageOwned && playwright.binaryAvailable ? "ok" : "error",
          name: "playwright:package",
          detail: playwright.packageOwned && playwright.binaryAvailable ? "project-owned dependency available" :
            "install and lock @playwright/test in the project"
        });
        checks.push({
          level: playwright.config ? "ok" : "warn",
          name: "playwright:config",
          detail: playwright.config || "no config found; command must provide complete setup"
        });
        checks.push({
          level: config.readiness?.url ? "ok" : "info",
          name: "playwright:readiness",
          detail: config.readiness?.url || "delegated to Playwright webServer configuration"
        });
      }
    }
    if (contract.version === 1)
      checks.push({ level: "info", name: "evidence-schema", detail: "v1 manual-compatible; v2 enables executable adapters" });
  }

  for (const hook of ["protect-secrets.sh", "lint.sh"]) {
    checks.push({
      level: existsSync(join(ROOT, ".claude", "hooks", hook)) ? "ok" : "error",
      name: `hook:${hook}`, detail: existsSync(join(ROOT, ".claude", "hooks", hook)) ? "installed" : "missing"
    });
  }
  const legacyHookTests = ["run-hook-tests.sh", "run-artifact-lint-tests.sh"]
    .filter((name) => existsSync(join(ROOT, ".claude", "hooks", "tests", name)));
  checks.push({
    level: legacyHookTests.length ? "warn" : "ok",
    name: "legacy-hook-tests",
    detail: legacyHookTests.length ?
      `stale packaged tests found (${legacyHookTests.join(", ")}); reinstall Foundation` : "absent"
  });

  const settings = readJson(join(ROOT, ".claude", "settings.json"), {});
  const settingsText = JSON.stringify(settings);
  const directMainEnabled = settingsText.includes("no-direct-main-commit.sh");
  checks.push({
    level: "info", name: "no-direct-main",
    detail: directMainEnabled ? "enabled" : "disabled (opt-in policy)"
  });

  for (const check of checks)
    console.log(`${check.level.toUpperCase().padEnd(5)} ${check.name}: ${check.detail}`);
  if (checks.some((check) => check.level === "error")) process.exitCode = 1;
}

function migrate(values) {
  const { flags, rest } = parseFlags(values);
  const legacyRoot = join(ROOT, ".workflow");
  const candidates = existsSync(legacyRoot)
    ? readdirSync(legacyRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .filter((entry) => !rest[0] || entry.name === rest[0])
    : [];
  if (!candidates.length) { console.log("No matching legacy runs."); return; }
  console.log(`${flags.apply ? "MIGRATION CANDIDATES WRITTEN" : "MIGRATION DRY RUN"}:`);
  for (const entry of candidates) {
    console.log(`  ${entry.name} -> openspec/migration-candidates/${entry.name}.md`);
    if (flags.apply) {
      const target = join(ROOT, "openspec", "migration-candidates", `${entry.name}.md`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target,
        `# Migration candidate: ${entry.name}\n\n` +
        `Source: \`.workflow/${entry.name}/\` (preserved read-only)\n\n` +
        `Only copy statements corroborated by code, tests, or an accepted contract.\n` +
        `Classify remaining items as current spec, new change, stable context, obsolete, or speculative.\n`);
    }
  }
}

function usage() {
  console.log(`Foundation harness ${VERSION}

Commands:
  doctor [--require-archive] [--change <id>]
  new <intent> [--id <id>] [--rapid]
  resolve <change> --impact <low|medium|high> --coupling <isolated|coupled>
  changes
  providers
  packet <change>
  metrics <change>
  validate <change>
  hash <change>
  proof-plan <change>
  proof-execute <change>
  receipt <change> <provider> <pass|fail|inconclusive|error> [--claims=a,b]
  evidence-upgrade <change>
  run-provider <change> <provider> -- <command> [args...]
  prove <change>
  land-check <change>
  sandbox create|sync|apply <change>
  archive <change>
  event <change> --request <id> [metrics...]
  migrate [legacy-id] [--apply]`);
}

const [command, ...values] = process.argv.slice(2);
operationName = command || null;
operationChangeId = command === "sandbox" ? values[1] :
  ["resolve", "validate", "hash", "packet", "metrics", "proof-plan", "proof-execute", "evidence-upgrade", "receipt", "run-provider", "prove",
    "land-check", "archive", "event"].includes(command) ? values[0] : null;
switch (command) {
  case "new": {
    const { flags, rest } = parseFlags(values);
    if (!rest.length) die("new requires an intent");
    createChange(rest.join(" "), flags); break;
  }
  case "resolve": {
    const { flags, rest } = parseFlags(values);
    if (!rest[0]) die("resolve requires a change");
    resolveChange(rest[0], flags); break;
  }
  case "changes": showChanges(); break;
  case "providers": showProviders(); break;
  case "packet": showPacket(values[0]); break;
  case "metrics": showMetrics(values[0]); break;
  case "doctor": {
    const { flags, rest } = parseFlags(values);
    if (rest.length) die(`unexpected doctor argument(s): ${rest.join(", ")}`);
    doctor(flags); break;
  }
  case "validate": validate(values[0]); break;
  case "hash": console.log(relevantHash(values[0])); break;
  case "proof-plan": proofPlan(values[0]); break;
  case "proof-execute": await proofExecute(values[0]); break;
  case "evidence-upgrade": upgradeEvidence(values[0]); break;
  case "receipt": {
    const [id, provider, status, ...tail] = values;
    const { flags } = parseFlags(tail); recordReceipt(id, provider, status, flags); break;
  }
  case "run-provider": runProvider(values[0], values[1], values.slice(2)); break;
  case "prove": prove(values[0]); break;
  case "land-check": landCheck(values[0]); break;
  case "sandbox":
    if (values[0] === "create") createSandbox(values[1]);
    else if (values[0] === "sync") syncSandbox(values[1]);
    else if (values[0] === "apply") applySandbox(values[1]);
    else die("sandbox requires create|sync|apply <change>");
    break;
  case "archive": archive(values[0]); break;
  case "event": {
    const { flags, rest } = parseFlags(values);
    recordEvent(rest[0], flags); break;
  }
  case "migrate": migrate(values); break;
  case "api-version": console.log(RUNTIME_API_VERSION); break;
  case "version": console.log(VERSION); break;
  default: usage(); if (command) process.exit(1);
}
