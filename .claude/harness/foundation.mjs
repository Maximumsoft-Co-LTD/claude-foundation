#!/usr/bin/env node

import {
  appendFileSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync,
  readSync, readdirSync, lstatSync, mkdtempSync, readlinkSync, realpathSync,
  renameSync, rmSync, statSync, symlinkSync, writeFileSync
} from "node:fs";
import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const VERSION = "2.1.0";
const RUNTIME_API_VERSION = "5";
const PROVIDER_PROTOCOL_VERSION = "4";
const ADAPTER_PROTOCOL_VERSION = "2";
const PROOF_PROTOCOL_VERSION = "2";
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
const EVIDENCE_VAULT = join(ROOT, ".foundation", "evidence");
const SNAPSHOTS = join(ROOT, ".foundation", "snapshots");
const TRANSACTIONS = join(ROOT, ".foundation", "transactions");
const CHANGES = join(ROOT, "openspec", "changes");
mkdirSync(RUNTIME, { recursive: true });
mkdirSync(RECEIPTS, { recursive: true });
mkdirSync(LOGS, { recursive: true });
mkdirSync(EVIDENCE_VAULT, { recursive: true });
mkdirSync(SNAPSHOTS, { recursive: true });
mkdirSync(TRANSACTIONS, { recursive: true });
mkdirSync(CHANGES, { recursive: true });

const operationStartedAt = Date.now();
let operationChangeId = null;
let operationName = null;
process.on("exit", (code) => {
  if (process.env.FOUNDATION_TELEMETRY !== "1" || !operationChangeId || !operationName) return;
  try {
    const path = join(LOGS, operationChangeId, "operations.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({
      version: 2, changeId: operationChangeId, operation: operationName,
      phase: process.env.FOUNDATION_PUBLIC_OPERATION || null,
      status: code === 0 ? "completed" : "failed", exitCode: code,
      startedAt: new Date(operationStartedAt).toISOString(), finishedAt: now(),
      durationMs: Date.now() - operationStartedAt,
      requests: null, inputTokens: null, outputTokens: null,
      cacheCreationTokens: null, cacheReadTokens: null, cacheTokens: null, cost: null,
      measurement: "command-observed; model usage requires host telemetry ingestion"
    })}\n`);
  } catch (error) {
    if (process.env.FOUNDATION_TELEMETRY_DEBUG === "1")
      console.error(`WARNING: telemetry unavailable: ${error.message}`);
  }
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
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  try {
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
}

function now() { return new Date().toISOString(); }
function protocolDescriptor() {
  return readJson(join(ROOT, ".claude", "harness", "protocol.json"), {
    runtime: VERSION,
    runtimeApi: RUNTIME_API_VERSION,
    providerProtocol: PROVIDER_PROTOCOL_VERSION,
    adapterProtocol: ADAPTER_PROTOCOL_VERSION,
    proofProtocol: PROOF_PROTOCOL_VERSION
  });
}
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
function proofRunRoot(id, proofRunId) {
  return join(EVIDENCE_VAULT, id, proofRunId);
}
function snapshotPath(id) { return join(SNAPSHOTS, `${id}.json`); }
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

function fileDigest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const snapshotCache = new Map();
const policyCache = new Map();

function relevantSnapshot(id, workspaceOverride = null, force = false) {
  const state = existsSync(runtimePath(id)) ? readJson(runtimePath(id)) : {};
  const workspace = resolve(workspaceOverride || state.workspace?.path || ROOT);
  const cacheKey = `${id}\0${workspace}\0${Number(state.contractRevision || state.revision || 0)}`;
  if (!force && snapshotCache.has(cacheKey)) return snapshotCache.get(cacheKey);
  const hash = createHash("sha256");
  const files = [];
  function allowed(rel) {
    if (rel.split("/").some((segment) => EXCLUDED_WORKSPACE_DIRS.has(segment)))
      return false;
    if (rel.startsWith("openspec/changes/archive/")) return false;
    if (rel.startsWith("openspec/changes/") && !isCurrentChangePath(rel, id))
      return false;
    if (rel === `${currentChangeRelativePath(id)}/execution.yaml`) return false;
    return true;
  }
  function collect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const rel = relative(workspace, path).replaceAll("\\", "/");
      if (!allowed(rel)) continue;
      if (entry.isDirectory()) collect(path);
      else if (entry.isFile()) files.push([rel, path]);
    }
  }
  const gitIndex = git(["ls-files", "-s", "-z"], workspace);
  const gitStatus = git([
    "status", "--porcelain=v1", "-z", "--untracked-files=all"
  ], workspace);
  if (gitIndex.status === 0 && gitStatus.status === 0) {
    const indexed = new Map();
    for (const line of gitIndex.stdout.split("\0").filter(Boolean)) {
      const match = line.match(/^\d+\s+([0-9a-f]+)\s+\d+\t(.+)$/);
      if (match) indexed.set(match[2], match[1]);
    }
    const dirty = new Set();
    const statusEntries = gitStatus.stdout.split("\0").filter(Boolean);
    for (let index = 0; index < statusEntries.length; index += 1) {
      const line = statusEntries[index];
      dirty.add(line.slice(3));
      if ((/^[RC]/.test(line) || /^[RC]/.test(line.slice(1))) &&
          statusEntries[index + 1])
        dirty.add(statusEntries[++index]);
    }
    const paths = [...new Set([...indexed.keys(), ...dirty])].filter(allowed).sort();
    for (const rel of paths) {
      const path = join(workspace, rel);
      const contentIdentity = dirty.has(rel)
        ? (existsSync(path) && statSync(path).isFile() ? fileDigest(path) : "deleted")
        : indexed.get(rel);
      files.push([rel, path]);
      hash.update(rel); hash.update("\0");
      hash.update(contentIdentity || "missing"); hash.update("\0");
    }
  } else {
    collect(workspace);
    files.sort(([a], [b]) => a.localeCompare(b));
    for (const [rel, path] of files) {
      hash.update(rel); hash.update("\0"); hash.update(readFileSync(path)); hash.update("\0");
    }
  }
  hash.update(`foundation-contract-revision:${Number(state.contractRevision || state.revision || 0)}`);
  const workspaceHash = hash.digest("hex");
  const value = {
    version: 1,
    id: `snapshot-${workspaceHash.slice(0, 20)}`,
    changeId: id,
    workspace,
    workspaceHash,
    revision: Number(state.contractRevision || state.revision || 0),
    fileCount: files.length,
    createdAt: now()
  };
  snapshotCache.set(cacheKey, value);
  if (workspace === resolve(state.workspace?.path || ROOT)) writeJson(snapshotPath(id), value);
  return value;
}

function relevantHash(id, workspaceOverride = null, force = false) {
  return relevantSnapshot(id, workspaceOverride, force).workspaceHash;
}

function clearSnapshotCache(id = null) {
  for (const key of snapshotCache.keys())
    if (!id || key.startsWith(`${id}\0`)) snapshotCache.delete(key);
  if (id) policyCache.delete(id);
  else policyCache.clear();
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
  for (const name of ["proposal.md", "tasks.md", "evidence.yaml", "execution.yaml"]) {
    writeFileSync(join(target, name), instantiate(join(source, name), intent));
  }
  if (schema === "foundation-standard") {
    writeFileSync(join(target, "design.md"), instantiate(join(source, "design.md"), intent));
    mkdirSync(join(target, "specs", "change"), { recursive: true });
    writeFileSync(join(target, "specs", "change", "spec.md"), instantiate(join(source, "spec.md"), intent));
  }
  const state = {
    version: 2, id, intent, schema, status: "change", ambiguity: "clear",
    revision: 0, contractRevision: 0, executionRevision: 0,
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
  bindClaudeSession(id, "change");
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

function rawExecution(id, dir = activeChangePath(id)) {
  const path = join(dir, "execution.yaml");
  if (!existsSync(path)) return { version: 1, providers: {}, services: {} };
  const value = readJson(path);
  if (value.version !== 1 || !value.providers || typeof value.providers !== "object" ||
      Array.isArray(value.providers))
    die(`${id}/execution.yaml requires version 1 and a providers object`);
  if (value.services !== undefined &&
      (!value.services || typeof value.services !== "object" || Array.isArray(value.services)))
    die(`${id}/execution.yaml services must be an object`);
  for (const [name, service] of Object.entries(value.services || {})) {
    if (!service || !Array.isArray(service.command) || !service.command.length ||
        service.command.some((part) => typeof part !== "string" || !part))
      die(`service '${name}' requires a non-empty command array`);
    if (!service.readiness?.url)
      die(`service '${name}' requires readiness.url`);
    if (!service.readiness.expectBody && !service.readiness.expectHeader)
      die(`service '${name}' readiness requires expectBody or expectHeader identity`);
    if (service.env !== undefined &&
        (!service.env || typeof service.env !== "object" || Array.isArray(service.env)))
      die(`service '${name}' env must be an object`);
    const secretKey = Object.keys(service.env || {}).find((key) =>
      /(SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY|API_KEY)/i.test(key));
    if (secretKey)
      die(`service '${name}' must use envFrom for secret-like key '${secretKey}'`);
    if (service.envFrom !== undefined &&
        (!Array.isArray(service.envFrom) ||
         service.envFrom.some((value) => typeof value !== "string" ||
           !/^[A-Z][A-Z0-9_]*$/.test(value))))
      die(`service '${name}' envFrom must contain environment variable names`);
  }
  return { services: {}, ...value };
}

function scopedReviewClaims(claims) {
  const scoped = claims.filter((claim) =>
    claim.impact === "high" ||
    claim.capabilities.some((capability) => [
      "review", "security-static", "compatibility", "data-migration",
      "cross-repo-contract", "state-identity"
    ].includes(capability)));
  return scoped.length ? scoped : claims;
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
  const executionValue = rawExecution(id, dir);
  const configuredProviders = {
    ...(value.providers || {}),
    ...(executionValue.providers || {})
  };
  for (const [provider, config] of Object.entries(configuredProviders)) {
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
    if (config.outputs !== undefined &&
        (!Array.isArray(config.outputs) ||
         config.outputs.some((item) => !PROVIDERS.has(item))))
      die(`provider '${provider}' outputs contains an unknown provider`);
    if (config.service !== undefined &&
        (!executionValue.services || !executionValue.services[config.service]))
      die(`provider '${provider}' references unknown service '${config.service}'`);
    if (config.env !== undefined &&
        (!config.env || typeof config.env !== "object" || Array.isArray(config.env) ||
         Object.values(config.env).some((value) => !["string", "number", "boolean"].includes(typeof value))))
      die(`provider '${provider}' env must be an object of scalar values`);
    if (config.envFrom !== undefined &&
        (!Array.isArray(config.envFrom) ||
         config.envFrom.some((value) => typeof value !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(value))))
      die(`provider '${provider}' envFrom must contain environment variable names`);
    const secretKey = Object.keys(config.env || {}).find((key) =>
      /(SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY|API_KEY)/i.test(key));
    if (secretKey)
      die(`provider '${provider}' must use envFrom for secret-like key '${secretKey}'`);
    if (config.report !== undefined &&
        (typeof config.report !== "string" || isAbsolute(config.report) ||
         resolve(ROOT, config.report) === ROOT ||
         !resolve(ROOT, config.report).startsWith(`${ROOT}/`)))
      die(`provider '${provider}' report must be a workspace-relative path`);
    if (config.readiness !== undefined) {
      if (!config.readiness || typeof config.readiness !== "object" ||
          typeof config.readiness.url !== "string")
        die(`provider '${provider}' readiness requires a URL`);
      try { new URL(config.readiness.url); }
      catch { die(`provider '${provider}' readiness URL is invalid`); }
      if (config.readiness.expectStatus !== undefined &&
          (!Number.isInteger(Number(config.readiness.expectStatus)) ||
           Number(config.readiness.expectStatus) < 100 ||
           Number(config.readiness.expectStatus) > 599))
        die(`provider '${provider}' readiness expectStatus must be an HTTP status`);
      if (config.readiness.expectBody !== undefined &&
          typeof config.readiness.expectBody !== "string")
        die(`provider '${provider}' readiness expectBody must be a string`);
      if (config.readiness.expectHeader !== undefined &&
          (!config.readiness.expectHeader ||
           typeof config.readiness.expectHeader !== "object" ||
           Array.isArray(config.readiness.expectHeader)))
        die(`provider '${provider}' readiness expectHeader must be an object`);
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
    const declaredForProvider = (provider === "review"
      ? scopedReviewClaims(value.claims)
      : value.claims.filter((claim) =>
      claim.capabilities.includes(provider) ||
      (provider === "discovery" && claim.capabilities.includes("test"))))
      .map((claim) => claim.id);
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
  return { ...value, providers: configuredProviders, execution: executionValue };
}

function providerConfig(id, provider) {
  const providers = evidence(id).providers || {};
  if (providers[provider]) return providers[provider];
  if (provider === "discovery" && providers.test?.adapter === "test-discovery")
    return providers.test;
  for (const config of Object.values(providers))
    if (Array.isArray(config.outputs) && config.outputs.includes(provider))
      return config;
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

function environmentDescriptor(config = null, id = null) {
  const workspace = id ? loadRuntime(id).workspace?.path || ROOT : ROOT;
  const lockfiles = [
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb",
    "Cargo.lock", "go.sum", "Gemfile.lock", "composer.lock"
  ].filter((name) => existsSync(join(workspace, name)))
    .map((name) => ({ path: name, sha256: fileDigest(join(workspace, name)) }));
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    declared: config?.environment || null,
    envFingerprint: stableHash({
      literals: config?.env || {},
      inheritedNames: config?.envFrom || []
    }),
    lockfiles
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
    environment: environmentDescriptor(config, id),
    inputMode: config?.inputMode || null,
    project: config?.project || null,
    outputs: config?.outputs || [],
    resources: config?.resources || null,
    dependsOn: config?.dependsOn || [],
    service: config?.service ? {
      name: config.service,
      config: evidence(id).execution?.services?.[config.service] || null
    } : null,
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

function contractFingerprint(id, dir = activeChangePath(id)) {
  const state = loadRuntime(id);
  const contract = evidence(id, dir);
  return stableHash({
    intent: state.intent,
    impact: state.impact,
    coupling: state.coupling,
    reviewRequired: Boolean(state.reviewRequired),
    claims: contract.claims,
    invariants: contract.invariants || []
  });
}

function executionFingerprint(id, dir = activeChangePath(id)) {
  const contract = evidence(id, dir);
  return stableHash({
    adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
    providers: contract.providers || {},
    services: contract.execution?.services || {}
  });
}

function taskBlocks(content) {
  const blocks = [];
  let current = null;
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*-\s*\[([ xX])\]\s*(.*)$/);
    if (match) {
      if (current) blocks.push(current);
      const id = match[2].match(/^\*{0,2}(T\d{3,})\*{0,2}\b/i)?.[1]?.toUpperCase() || null;
      current = { done: match[1].toLowerCase() === "x", lines: [line], text: match[2], id };
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
  if (Number(state.version || 1) >= 2) required.push("execution.yaml");
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
  const parsedTasks = taskBlocks(tasks);
  const taskIds = parsedTasks.map((task) => task.id).filter(Boolean);
  if (parsedTasks.length && taskIds.length !== parsedTasks.length)
    die("every implementation task requires a stable ID such as T001");
  if (new Set(taskIds).size !== taskIds.length)
    die("tasks.md contains duplicate task IDs");
  const lifecycleTasks = taskBlocks(tasks).filter((task) =>
    !task.done && /\/(?:prove|land)\b/.test(task.text));
  if (lifecycleTasks.length)
    die("tasks.md contains a lifecycle gate; /prove and /land are commands, not implementation tasks");
  const claims = evidence(id, dir).claims;
  for (const claim of claims)
    if (!["low", "medium", "high"].includes(claim.impact || ""))
      die(`claim '${claim.id}' requires impact low|medium|high`);
  if (claims.some((claim) => claim.impact === "high"))
    state.reviewRequired = true;
  state.evidenceCapabilities = [...new Set(claims.flatMap((claim) => claim.capabilities))];
  const budgets = state.size === "S" || state.impact === "low"
    ? { "proposal.md": 900, "design.md": 1400, "tasks.md": 900 }
    : { "proposal.md": 1600, "design.md": 2600, "tasks.md": 1600 };
  for (const [name, limit] of Object.entries(budgets)) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    const words = readFileSync(path, "utf8").trim().split(/\s+/).filter(Boolean).length;
    if (words > limit)
      console.error(`WARNING: ${name} is ${words} words (soft budget ${limit}); retain only load-bearing content`);
  }
  saveRuntime(state);
  console.log(`VALID ${id} (${state.schema}, ${claims.length} claims)`);
}

function requiredProviders(id) {
  const state = loadRuntime(id);
  const required = new Set(evidence(id).claims.flatMap((claim) => claim.capabilities));
  if (required.has("test")) required.add("discovery");
  if (state.reviewRequired) required.add("review");
  for (const provider of policyCapabilities(id)) required.add(provider);
  return [...required].sort();
}

function claimsForProvider(id, provider) {
  const claims = evidence(id).claims;
  if (provider === "review") return scopedReviewClaims(claims);
  if (policyCapabilities(id).includes(provider)) return claims;
  return claims.filter((claim) =>
    claim.capabilities.includes(provider) ||
    (provider === "discovery" && claim.capabilities.includes("test")));
}

function pathInside(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function durableArtifact(id, provider, proofRunId, artifact) {
  if (!artifact?.path || typeof artifact.path !== "string")
    die(`provider '${provider}' artifact requires a path`);
  const source = resolve(ROOT, artifact.path);
  if (!existsSync(source)) {
    if (artifact.required === false) return { ...artifact, missing: true };
    die(`required artifact is missing: ${artifact.path}`);
  }
  const workspace = loadRuntime(id).workspace?.path || ROOT;
  const realSource = realpathSync(source);
  if (!pathInside(ROOT, realSource) && !pathInside(workspace, realSource))
    die(`artifact escapes the project workspace: ${artifact.path}`);
  if (!statSync(realSource).isFile())
    die(`artifact is not a regular file: ${artifact.path}`);
  const sha256 = fileDigest(realSource);
  const safeName = basename(realSource).replace(/[^a-zA-Z0-9._-]+/g, "-") || "artifact";
  const destination = join(
    proofRunRoot(id, proofRunId), "artifacts", provider,
    `${sha256.slice(0, 12)}-${safeName}`
  );
  mkdirSync(dirname(destination), { recursive: true });
  if (!existsSync(destination)) cpSync(realSource, destination);
  return {
    path: relative(ROOT, destination).replaceAll("\\", "/"),
    type: artifact.type || "artifact",
    required: artifact.required !== false,
    sha256,
    size: statSync(destination).size
  };
}

function validateArtifact(artifact) {
  if (artifact.required === false && artifact.missing) return true;
  if (!artifact.path || !pathInside(EVIDENCE_VAULT, resolve(ROOT, artifact.path)))
    return false;
  const path = resolve(ROOT, artifact.path);
  if (!existsSync(path) || !statSync(path).isFile()) return false;
  return artifact.sha256 === fileDigest(path) &&
    Number(artifact.size) === statSync(path).size;
}

function receiptValidity(id, provider, hash = relevantHash(id)) {
  const path = receiptPath(id, provider);
  if (!existsSync(path)) return { provider, validity: "missing" };
  const value = readJson(path);
  if (String(value.providerProtocolVersion || "") !== PROVIDER_PROTOCOL_VERSION)
    return { provider, validity: "provider-version-stale", status: value.status };
  if (value.contractFingerprint !== contractFingerprint(id))
    return { provider, validity: "contract-stale", status: value.status };
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
  const invalidArtifacts = (value.artifacts || []).filter((artifact) =>
    artifact.required !== false && !validateArtifact(artifact));
  if (invalidArtifacts.length)
    return { provider, validity: "invalid-artifacts", status: value.status };
  return { provider, validity: "valid", receipt: value };
}

function proofPlan(id) {
  validate(id, "active");
  const hash = relevantHash(id);
  const rows = requiredProviders(id).map((provider) => receiptValidity(id, provider, hash));
  console.log(`PROOF PLAN ${id}\n  workspace: ${hash}`);
  for (const row of rows) console.log(`  ${row.provider}: ${row.validity}`);
}

function topologyIssues(id) {
  const providers = evidence(id).providers || {};
  const issues = [];
  const visiting = new Set();
  const visited = new Set();
  function visit(provider, trail = []) {
    if (visiting.has(provider)) {
      issues.push(`provider dependency cycle: ${[...trail, provider].join(" -> ")}`);
      return;
    }
    if (visited.has(provider) || !providers[provider]) return;
    visiting.add(provider);
    for (const dependency of providers[provider].dependsOn || [])
      visit(dependency, [...trail, provider]);
    visiting.delete(provider);
    visited.add(provider);
  }
  Object.keys(providers).forEach((provider) => visit(provider));
  const reportOwners = new Map();
  for (const [provider, config] of Object.entries(providers)) {
    if (config.report) {
      const key = config.report.replaceAll("\\", "/");
      const owner = reportOwners.get(key);
      const command = JSON.stringify(config.command || []);
      if (owner && owner.command !== command)
        issues.push(`structured report collision: ${key} (${owner.provider}, ${provider})`);
      else reportOwners.set(key, { provider, command });
    }
    if (config.readiness?.url && !config.readiness.expectBody &&
        !config.readiness.expectHeader)
      issues.push(`provider '${provider}' readiness lacks an identity body/header`);
  }
  return issues;
}

function proofPreflight(id, stage = "prove", quiet = false) {
  validate(id, "active");
  const issues = topologyIssues(id);
  const hash = relevantHash(id);
  const { unconfigured, unavailable } = executionNodes(id, hash);
  if (stage === "prove") {
    issues.push(...unconfigured.map((provider) =>
      `provider '${provider}' has no executable adapter or valid external receipt`));
    issues.push(...unavailable.map((value) => `provider unavailable: ${value}`));
  }
  if (issues.length) die(`proof preflight failed: ${issues.join("; ")}`);
  if (!quiet)
    console.log(`PROOF PREFLIGHT ${id}: ready\n  stage: ${stage}\n  workspace: ${hash}`);
  return true;
}

function upgradeEvidence(id) {
  const state = loadRuntime(id);
  if (state.status === "archived") die(`change '${id}' is already archived`);
  const path = join(changePath(id), "evidence.yaml");
  const value = readJson(path);
  if (![1, 2].includes(value.version))
    die(`cannot upgrade unknown evidence version '${value.version}'`);
  if (value.version === 1) value.version = 2;
  const executionPath = join(changePath(id), "execution.yaml");
  const currentExecution = existsSync(executionPath)
    ? readJson(executionPath) : { version: 1, providers: {}, services: {} };
  currentExecution.providers = {
    ...(value.providers || {}),
    ...(currentExecution.providers || {})
  };
  delete value.providers;
  writeJson(path, value);
  writeJson(executionPath, currentExecution);
  state.version = 2;
  state.revision = Number(state.revision || 0) + 1;
  state.executionRevision = Number(state.executionRevision || 0) + 1;
  delete state.provenHash;
  if (existsSync(proofPath(id))) rmSync(proofPath(id));
  saveRuntime(state);
  console.log(`EVIDENCE ${id}: contract and execution wiring separated\n  configure execution.yaml before proof execute`);
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
  const state = loadRuntime(id);
  const proofRunId = flags.proofRunId || state.activeProofRun?.id ||
    `manual-${Date.now()}-${process.pid}`;
  const workspaceHash = flags.workspaceHash || state.activeProofRun?.workspaceHash ||
    relevantHash(id);
  const artifacts = (Array.isArray(flags.artifacts) ? flags.artifacts : [])
    .map((artifact) => durableArtifact(id, provider, proofRunId, artifact));
  const receipt = {
    version: 4, changeId: id, provider, providerVersion, adapter,
    adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
    providerProtocolVersion: PROVIDER_PROTOCOL_VERSION,
    contractFingerprint: contractFingerprint(id),
    executionFingerprint: executionFingerprint(id),
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
    workspaceHash, workspaceSnapshotId: state.activeProofRun?.snapshotId || null,
    claims: requestedClaims,
    status, observed: flags.observed || "", capability: {
      inputMode,
      foregroundRequired, foregroundAvailable
    },
    command,
    log: artifacts.find((artifact) => artifact.type === "command-log")?.path ||
      flags.log || null,
    artifacts,
    environment: config ? environmentDescriptor(config, id) : (flags.environment || null),
    project: flags.project || config?.project || null,
    proofRunId,
    commandExecutionId: flags.commandExecutionId || flags.executionId || null,
    executionId: flags.commandExecutionId || flags.executionId || null,
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
  catch { return null; }
}

function numericReportValue(report, keys) {
  if (!report || typeof report !== "object") return null;
  for (const container of [report, report.summary].filter((value) =>
    value && typeof value === "object" && !Array.isArray(value))) {
    for (const key of keys) {
      const value = container[key];
      if (typeof value === "number" && Number.isInteger(value) && value >= 0)
        return value;
    }
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

async function readinessMatches(readiness) {
  try {
    const response = await fetch(readiness.url, {
      signal: AbortSignal.timeout(750)
    });
    const expectedStatus = readiness.expectStatus === undefined
      ? 200 : Number(readiness.expectStatus);
    if (response.status !== expectedStatus) return false;
    if (readiness.expectHeader &&
        !Object.entries(readiness.expectHeader).every(([key, value]) =>
          response.headers.get(key) === String(value))) return false;
    if (readiness.expectBody !== undefined) {
      const body = await response.text();
      if (!body.includes(readiness.expectBody)) return false;
    }
    return true;
  } catch {
    return false;
  }
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
      if (await readinessMatches(options.readiness)) {
        readinessObserved = true;
        return;
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

async function startServiceSession(id, name, config, proofRunId) {
  const state = loadRuntime(id);
  const cwd = state.workspace?.path || ROOT;
  const [command, ...args] = config.command;
  const inherited = Object.fromEntries((config.envFrom || [])
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]]));
  let stdout = "";
  let stderr = "";
  let closed = false;
  let exitStatus = null;
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      ...inherited,
      ...(config.env || {}),
      FOUNDATION_CHANGE_ID: id,
      FOUNDATION_CONTROL_ROOT: ROOT,
      FOUNDATION_PROOF_RUN_ID: proofRunId,
      FOUNDATION_SERVICE_NAME: name
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("close", (status) => { closed = true; exitStatus = status; });
  const deadline = Date.now() + Number(config.timeoutMs || 30000);
  while (Date.now() < deadline) {
    if (closed)
      throw new Error(
        `service '${name}' exited before readiness (status ${exitStatus}): ` +
        `${stderr.trim() || stdout.trim() || "no output"}`
      );
    if (await readinessMatches(config.readiness)) {
      return {
        name,
        child,
        startedAt: now(),
        stop() {
          if (!closed) child.kill("SIGTERM");
          const logPath = join(LOGS, id, `${proofRunId}-service-${name}.log`);
          mkdirSync(dirname(logPath), { recursive: true });
          writeFileSync(logPath, `${stdout}${stderr}`);
          return {
            name,
            path: relative(ROOT, logPath).replaceAll("\\", "/"),
            status: closed ? exitStatus : "terminated"
          };
        }
      };
    }
    await new Promise((complete) => setTimeout(complete, 100));
  }
  if (!closed) child.kill("SIGTERM");
  throw new Error(`service '${name}' readiness timed out`);
}

async function startRequiredServices(id, nodes, proofRunId) {
  const executionValue = evidence(id).execution;
  const names = [...new Set(nodes.map((node) => node.config.service).filter(Boolean))];
  const sessions = [];
  try {
    for (const name of names)
      sessions.push(await startServiceSession(
        id, name, executionValue.services[name], proofRunId
      ));
    return sessions;
  } catch (error) {
    sessions.reverse().forEach((session) => session.stop());
    throw error;
  }
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

async function executeAdapter(id, provider, config, proofRunId, commandCache) {
  const state = loadRuntime(id);
  const cwd = state.workspace?.path || ROOT;
  const built = configuredCommand(provider, config);
  const envFrom = Object.fromEntries((config.envFrom || [])
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]]));
  const dedupKey = stableHash({
    cwd, command: built.command, args: built.args,
    env: config.env || {}, timeoutMs: Number(config.timeoutMs || 120000),
    readiness: config.readiness || null
  });
  if (!commandCache.has(dedupKey)) {
    const commandExecutionId = `command-${Date.now()}-${commandCache.size + 1}`;
    const executionEnv = {
      ...process.env,
      ...envFrom,
      ...(config.env || {}),
      FOUNDATION_CHANGE_ID: id,
      FOUNDATION_CONTROL_ROOT: ROOT,
      FOUNDATION_PROOF_RUN_ID: proofRunId,
      FOUNDATION_COMMAND_EXECUTION_ID: commandExecutionId,
      FOUNDATION_EXECUTION_ID: commandExecutionId
    };
    commandCache.set(dedupKey, {
      commandExecutionId,
      result: runCommand(built.command, built.args, {
        cwd, timeoutMs: config.timeoutMs, env: executionEnv,
        readiness: config.readiness
      })
    });
  }
  const cached = commandCache.get(dedupKey);
  const result = await cached.result;
  const commandExecutionId = cached.commandExecutionId;
  const logArtifact = executionLog(id, provider, commandExecutionId, result);
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
    config, adapter: config.adapter, proofRunId, commandExecutionId,
    workspaceHash: state.activeProofRun?.workspaceHash,
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
    const outputs = [...new Set([provider, ...(config.outputs || [])])]
      .filter((output) => requiredProviders(id).includes(output));
    let aggregateStatus = "pass";
    for (const output of outputs) {
      const requiredClaims = providerClaims(id, output, config);
      const missingClaims = summary
        ? requiredClaims.filter((claim) => !summary.claims.includes(claim))
        : requiredClaims;
      const status = result.timedOut || result.error ||
        (config.readiness?.url && !result.readinessObserved) ? "error" :
        result.status !== 0 || (summary?.failed || 0) > 0 ? "fail" :
        !summary || missingClaims.length ? "inconclusive" : "pass";
      if (status !== "pass") aggregateStatus = status;
      recordReceipt(id, output, status, {
        ...baseFlags,
        claims: requiredClaims.join(","),
        "input-mode": output === "browser"
          ? config.inputMode || "browser-automation" : config.inputMode || null,
        "foreground-required": config.foregroundRequired ? "yes" : "no",
        "foreground-available": config.foregroundAvailable ? "yes" : "no",
        observed: summary
          ? `${summary.tests} tests; ${summary.failed} failed; claims ${summary.claims.length}/${requiredClaims.length}` +
            (missingClaims.length ? `; missing ${missingClaims.join(",")}` : "")
          : "Playwright JSON report unavailable"
      });
    }
    return { provider, status: aggregateStatus };
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
      ? ["test", "discovery"]
      : [...new Set([provider, ...(config.outputs || [])])]
        .filter((output) => needed.includes(output));
    covers.forEach((item) => claimed.add(item));
    nodes.push({
      provider: config.adapter === "test-discovery" ? "test" : provider,
      covers, config, resources: adapterResources(provider, config),
      dependsOn: config.dependsOn || []
    });
  }
  return { nodes, unconfigured, unavailable };
}

async function runExecutionDag(id, nodes, proofRunId) {
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
    console.log(`EXECUTION ${proofRunId}: ${batch.map((node) => node.provider).join(", ")}`);
    const results = await Promise.all(batch.map((node) =>
      executeAdapter(id, node.provider, node.config, proofRunId, commandCache)));
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
  proofPreflight(id, "prove", true);
  const pending = pendingTasks(id);
  if (pending.length) die(`${pending.length} implementation task(s) remain unchecked`);
  const snapshot = relevantSnapshot(id, null, true);
  const state = loadRuntime(id);
  const proofRunId = `proof-${Date.now()}`;
  state.activeProofRun = {
    id: proofRunId,
    snapshotId: snapshot.id,
    workspaceHash: snapshot.workspaceHash,
    startedAt: now()
  };
  saveRuntime(state);
  let sessions = [];
  try {
    const hash = snapshot.workspaceHash;
    const { nodes, unconfigured, unavailable } = executionNodes(id, hash);
    if (unconfigured.length)
      die(`missing executable adapter for provider(s): ${unconfigured.join(", ")}; record external receipts or configure evidence v2`);
    if (unavailable.length)
      die(`provider environment unavailable: ${unavailable.join(", ")}; run doctor --stage prove --change ${id}`);
    sessions = await startRequiredServices(id, nodes, proofRunId);
    if (nodes.length) await runExecutionDag(id, nodes, proofRunId);
    else console.log(`EXECUTION ${proofRunId}: all receipts reused`);
    const serviceArtifacts = sessions.reverse()
      .map((session) => session.stop())
      .map((artifact) => durableArtifact(id, "service", proofRunId, {
        path: artifact.path,
        type: "service-log",
        required: true
      }));
    const withServices = loadRuntime(id);
    withServices.activeProofRun.serviceArtifacts = serviceArtifacts;
    saveRuntime(withServices);
    sessions = [];
    prove(id, proofRunId);
  } catch (error) {
    sessions.reverse().forEach((session) => session.stop());
    const current = loadRuntime(id);
    delete current.activeProofRun;
    saveRuntime(current);
    die(error.message);
  } finally {
    const current = loadRuntime(id);
    delete current.activeProofRun;
    saveRuntime(current);
  }
}

function prove(id, requestedProofRunId = null) {
  const stateBefore = loadRuntime(id);
  if (stateBefore.status === "archived") die(`change '${id}' is already archived`);
  validate(id, "active");
  const pending = pendingTasks(id);
  if (pending.length) die(`${pending.length} implementation task(s) remain unchecked`);
  clearSnapshotCache(id);
  const snapshot = relevantSnapshot(id, null, true);
  const hash = snapshot.workspaceHash;
  const checks = requiredProviders(id).map((provider) => receiptValidity(id, provider, hash));
  const blockers = checks.filter((row) => row.validity !== "valid");
  if (blockers.length) die(blockers.map((row) => `${row.provider}:${row.validity}`).join(", "));
  const proofRunId = requestedProofRunId || stateBefore.activeProofRun?.id ||
    `proof-${Date.now()}`;
  const runRoot = proofRunRoot(id, proofRunId);
  const receiptEntries = checks.map((row) => {
    const source = receiptPath(id, row.provider);
    const destination = join(runRoot, "receipts", `${row.provider}.json`);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination);
    return {
      provider: row.provider,
      path: relative(ROOT, destination).replaceAll("\\", "/"),
      sha256: fileDigest(destination),
      size: statSync(destination).size
    };
  });
  const proof = {
    version: 2,
    proofProtocolVersion: PROOF_PROTOCOL_VERSION,
    protocols: protocolDescriptor(),
    changeId: id,
    proofRunId,
    status: "pass",
    workspaceHash: hash,
    workspaceSnapshotId: snapshot.id,
    contractFingerprint: contractFingerprint(id),
    executionFingerprint: executionFingerprint(id),
    providers: checks.map((row) => row.provider),
    receipts: receiptEntries,
    artifacts: stateBefore.activeProofRun?.serviceArtifacts || [],
    createdAt: now()
  };
  writeJson(proofPath(id), proof);
  writeJson(join(runRoot, "manifest.json"), proof);
  const state = loadRuntime(id); state.status = "proven"; state.provenHash = hash; saveRuntime(state);
  console.log(`PROVEN ${id}\n  workspace: ${hash}\n  providers: ${proof.providers.join(", ")}\n  next: /land ${id}`);
}

function proofAudit(id, quiet = false) {
  const proof = existsSync(proofPath(id)) ? readJson(proofPath(id)) : null;
  if (!proof || proof.status !== "pass")
    return { valid: false, reason: "missing-proof" };
  if (String(proof.proofProtocolVersion || "") !== PROOF_PROTOCOL_VERSION)
    return { valid: false, reason: "proof-version-stale" };
  if (!Array.isArray(proof.receipts) || proof.receipts.length === 0)
    return { valid: false, reason: "missing-receipt-manifest" };
  for (const entry of proof.receipts) {
    const path = resolve(ROOT, entry.path || "");
    if (!pathInside(proofRunRoot(id, proof.proofRunId), path) ||
        !existsSync(path) || !statSync(path).isFile() ||
        fileDigest(path) !== entry.sha256 || statSync(path).size !== Number(entry.size))
      return { valid: false, reason: `receipt-tampered:${entry.provider || "unknown"}` };
    const receipt = readJson(path);
    const invalidArtifact = (receipt.artifacts || []).find((artifact) =>
      artifact.required !== false && !validateArtifact(artifact));
    if (invalidArtifact)
      return { valid: false, reason: `artifact-tampered:${entry.provider || "unknown"}` };
  }
  if ((proof.artifacts || []).some((artifact) =>
    artifact.required !== false && !validateArtifact(artifact)))
    return { valid: false, reason: "proof-artifact-tampered" };
  if (!quiet) console.log(`PROOF AUDIT ${id}: valid\n  run: ${proof.proofRunId}`);
  return { valid: true, proof };
}

function landCheck(id) {
  let state = loadRuntime(id);
  recoverPendingApply(id, state);
  state = loadRuntime(id);
  if (state.status === "archived") {
    const audit = proofAudit(id, true);
    if (!audit.valid) die(`archived proof audit failed: ${audit.reason}`);
    console.log(`ALREADY ARCHIVED ${id}\n  archived: ${state.archivedAt || "unknown"}`);
    return { archived: true, state };
  }
  const proof = existsSync(proofPath(id)) ? readJson(proofPath(id)) : null;
  if (!proof || proof.status !== "pass") die(`change '${id}' has no passing proof`);
  const audit = proofAudit(id, true);
  if (!audit.valid) die(`proof audit failed: ${audit.reason}`);
  clearSnapshotCache(id);
  const hash = relevantHash(id, null, true);
  if (proof.workspaceHash !== hash) die(`proof is stale (${proof.workspaceHash.slice(0, 8)} != ${hash.slice(0, 8)})`);
  for (const provider of requiredProviders(id)) {
    const check = receiptValidity(id, provider, hash);
    if (check.validity !== "valid") die(`${provider} evidence is ${check.validity}`);
  }
  if (state.workspace?.applied) {
    const applied = verifyAppliedProjection(state);
    if (!applied.valid) die(`applied projection is invalid: ${applied.reason}`);
  }
  console.log(`LAND READY ${id}\n  workspace: ${hash}`);
  return { archived: false, state, hash };
}

function createCopySandbox(id, state, reason) {
  const path = mkdtempSync(join(tmpdir(), `foundation-${id}-`));
  cpSync(ROOT, path, {
    recursive: true,
    mode: fsConstants.COPYFILE_FICLONE,
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
  const completedIds = new Set(taskBlocks(sandbox)
    .filter((task) => task.done && task.id).map((task) => task.id));
  const completedText = new Set(taskBlocks(sandbox)
    .filter((task) => task.done)
    .map((task) => task.text.replace(/\s+/g, " ").trim()));
  return source.split("\n").map((line) => {
    if (!/^\s*-\s*\[\s\]/.test(line)) return line;
    const text = line.replace(/^\s*-\s*\[\s\]\s*/, "").trim();
    const taskId = text.match(/^\*{0,2}(T\d{3,})\*{0,2}\b/i)?.[1]?.toUpperCase();
    return (taskId ? completedIds.has(taskId) : completedText.has(text))
      ? line.replace("[ ]", "[x]") : line;
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
  const priorContract = existsSync(destination) ? contractFingerprint(id, destination) : null;
  const priorExecution = existsSync(destination) ? executionFingerprint(id, destination) : null;
  const nextContract = contractFingerprint(id, source);
  const nextExecution = executionFingerprint(id, source);
  const mergedTasks = mergeTaskProgress(sourceTasks, sandboxTasks);
  if (existsSync(destination)) rmSync(destination, { recursive: true });
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
  writeFileSync(join(destination, "tasks.md"), mergedTasks);
  state.workspace.changeSourceHash = directoryHash(source);
  state.status = "building";
  state.revision = Number(state.revision || 0) + 1;
  if (priorContract !== nextContract)
    state.contractRevision = Number(state.contractRevision || 0) + 1;
  if (priorExecution !== nextExecution)
    state.executionRevision = Number(state.executionRevision || 0) + 1;
  delete state.provenHash;
  if (existsSync(proofPath(id))) rmSync(proofPath(id));
  clearSnapshotCache(id);
  saveRuntime(state);
  console.log(`SYNCED ${id}\n  revision: ${state.revision}\n  workspace: ${relevantHash(id)}`);
}

function pathIdentity(path) {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return `symlink:${readlinkSync(path)}`;
    if (stat.isFile()) return fileDigest(path);
    if (stat.isDirectory()) return `directory:${directoryHash(path)}`;
    return `unsupported:${stat.mode}`;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function safeRootPath(rel) {
  const path = resolve(ROOT, rel);
  if (!pathInside(ROOT, path) || path === ROOT)
    throw new Error(`unsafe transaction path '${rel}'`);
  return path;
}

function copyPath(source, destination) {
  const stat = lstatSync(source);
  mkdirSync(dirname(destination), { recursive: true });
  if (stat.isSymbolicLink())
    symlinkSync(readlinkSync(source), destination);
  else
    cpSync(source, destination, {
      recursive: stat.isDirectory(),
      dereference: false,
      verbatimSymlinks: true
    });
}

function applyTransactionRoot(id, transactionId) {
  return join(TRANSACTIONS, id, transactionId);
}

function transactionJournalPath(id, transactionId) {
  return join(applyTransactionRoot(id, transactionId), "journal.json");
}

function saveApplyJournal(journal) {
  journal.updatedAt = now();
  writeJson(transactionJournalPath(journal.changeId, journal.transactionId), journal);
}

function gitApplyInputs(id, sandboxPath) {
  git(["add", "-N", "."], sandboxPath);
  const pathspec = [
    ".",
    `:(exclude)openspec/changes/${id}/**`,
    ":(exclude)coverage/**", ":(exclude)test-results/**",
    ":(exclude)playwright-report/**", ":(exclude).foundation/**"
  ];
  const diff = git(["diff", "--binary", "HEAD", "--", ...pathspec], sandboxPath);
  if (diff.status !== 0 || !diff.stdout) die("sandbox has no applicable diff");
  const check = spawnSync("git", ["apply", "--check", "--whitespace=nowarn", "-"], {
    cwd: ROOT, input: diff.stdout, encoding: "utf8"
  });
  if (check.status !== 0)
    die(`sandbox diff conflicts with target: ${check.stderr.trim()}`);
  const names = git(["diff", "--name-only", "-z", "HEAD", "--", ...pathspec], sandboxPath);
  if (names.status !== 0) die(`cannot inspect sandbox paths: ${names.stderr.trim()}`);
  return names.stdout.split("\0").filter(Boolean).sort();
}

function buildApplyEntries(id, state) {
  const sandboxPath = state.workspace.path;
  let codePaths;
  if (state.workspace.mode === "copy") {
    const baseline = state.workspace.baseline || {};
    const sandbox = workspaceManifest(sandboxPath, id, true);
    const target = workspaceManifest(ROOT, id, true);
    codePaths = [...new Set([...Object.keys(baseline), ...Object.keys(sandbox)])]
      .filter((path) => baseline[path] !== sandbox[path]).sort();
    for (const path of codePaths)
      if ((target[path] ?? null) !== (baseline[path] ?? null))
        die(`isolated-copy conflict at '${path}'`);
  } else if (state.workspace.mode === "worktree") {
    if (gitHead(ROOT) !== state.workspace.baseHead)
      die("target HEAD moved since sandbox creation");
    codePaths = gitApplyInputs(id, sandboxPath);
  } else {
    die("change has no isolated sandbox");
  }
  const entries = codePaths.map((rel) => {
    const source = resolve(sandboxPath, rel);
    const target = safeRootPath(rel);
    return {
      path: rel,
      role: "code",
      before: pathIdentity(target),
      after: pathIdentity(source)
    };
  });
  const changeRel = currentChangeRelativePath(id);
  entries.push({
    path: changeRel,
    role: "change-artifacts",
    before: pathIdentity(changePath(id)),
    after: pathIdentity(join(sandboxPath, changeRel))
  });
  return entries;
}

function prepareApplyTransaction(id, state) {
  if (directoryHash(changePath(id)) !== state.workspace.changeSourceHash)
    die("active change was edited after the last sandbox sync");
  const entries = buildApplyEntries(id, state);
  const transactionId = `apply-${Date.now()}-${process.pid}`;
  const root = applyTransactionRoot(id, transactionId);
  mkdirSync(root, { recursive: true });
  entries.forEach((entry, index) => {
    entry.backup = `backup/${index}`;
    if (entry.before !== null)
      copyPath(safeRootPath(entry.path), join(root, entry.backup));
  });
  const proof = readJson(proofPath(id));
  const journal = {
    version: 1,
    changeId: id,
    transactionId,
    proofRunId: proof.proofRunId,
    mode: state.workspace.mode,
    status: "prepared",
    sandboxPath: state.workspace.path,
    targetPath: ROOT,
    projectionHash: stableHash(entries.map(({ path, after }) => ({ path, after }))),
    entries,
    appliedPaths: [],
    inFlightPaths: [],
    createdAt: now()
  };
  saveApplyJournal(journal);
  return journal;
}

function applyTransactionEntry(journal, entry, index) {
  const target = safeRootPath(entry.path);
  const current = pathIdentity(target);
  if (current !== entry.before)
    throw new Error(`target changed during apply at '${entry.path}'`);
  journal.inFlightPaths = [entry.path];
  saveApplyJournal(journal);
  if (entry.after === null) {
    if (current !== null) rmSync(target, { recursive: true });
  } else {
    const source = resolve(journal.sandboxPath, entry.path);
    const stage = join(applyTransactionRoot(journal.changeId, journal.transactionId),
      "stage", String(index));
    if (existsSync(stage)) rmSync(stage, { recursive: true });
    copyPath(source, stage);
    mkdirSync(dirname(target), { recursive: true });
    if (current !== null) rmSync(target, { recursive: true });
    renameSync(stage, target);
  }
  if (pathIdentity(target) !== entry.after)
    throw new Error(`post-apply projection mismatch at '${entry.path}'`);
  journal.appliedPaths.push(entry.path);
  journal.inFlightPaths = [];
  saveApplyJournal(journal);
  const failAfter = process.env.FOUNDATION_TEST_MODE === "1"
    ? Number(process.env.FOUNDATION_TEST_FAIL_APPLY_AFTER || 0) : 0;
  if (failAfter > 0 && journal.appliedPaths.length >= failAfter)
    throw new Error(`injected apply failure after ${journal.appliedPaths.length} path(s)`);
}

function restoreTransactionEntry(journal, entry) {
  const target = safeRootPath(entry.path);
  const current = pathIdentity(target);
  if (current === entry.before) return;
  const possiblyApplied = journal.appliedPaths.includes(entry.path) ||
    journal.inFlightPaths.includes(entry.path);
  if (!possiblyApplied || (current !== entry.after && current !== null))
    throw new Error(`rollback requires manual recovery at '${entry.path}'`);
  if (current !== null) rmSync(target, { recursive: true });
  if (entry.before !== null)
    copyPath(join(applyTransactionRoot(journal.changeId, journal.transactionId),
      entry.backup), target);
  if (pathIdentity(target) !== entry.before)
    throw new Error(`rollback verification failed at '${entry.path}'`);
}

function rollbackApplyTransaction(journal, reason) {
  journal.status = "rolling-back";
  journal.failure = String(reason?.message || reason);
  saveApplyJournal(journal);
  try {
    for (const entry of [...journal.entries].reverse())
      restoreTransactionEntry(journal, entry);
    journal.status = "rolled-back";
    journal.inFlightPaths = [];
    journal.rolledBackAt = now();
    saveApplyJournal(journal);
  } catch (error) {
    journal.status = "manual-recovery";
    journal.recoveryError = error.message;
    saveApplyJournal(journal);
    throw error;
  }
}

function verifyAppliedProjection(state) {
  const transactionId = state.workspace?.apply?.transactionId;
  if (!transactionId) return { valid: false, reason: "missing-apply-transaction" };
  const path = transactionJournalPath(state.id, transactionId);
  if (!existsSync(path)) return { valid: false, reason: "missing-apply-journal" };
  const journal = readJson(path);
  const mismatch = journal.entries.find((entry) =>
    pathIdentity(safeRootPath(entry.path)) !== entry.after);
  if (mismatch) return { valid: false, reason: `projection-mismatch:${mismatch.path}` };
  if (journal.projectionHash !== state.workspace.apply.projectionHash)
    return { valid: false, reason: "projection-identity-mismatch" };
  return { valid: true, journal };
}

function recoverPendingApply(id, state) {
  const root = join(TRANSACTIONS, id);
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = transactionJournalPath(id, entry.name);
    if (!existsSync(path)) continue;
    const journal = readJson(path);
    if (!["prepared", "applying"].includes(journal.status)) continue;
    if (state.workspace?.applied &&
        state.workspace.apply?.transactionId === journal.transactionId) {
      const verification = verifyAppliedProjection(state);
      if (!verification.valid)
        die(`interrupted apply cannot resume: ${verification.reason}`);
      journal.status = "verified";
      journal.verifiedAt = now();
      saveApplyJournal(journal);
    } else {
      try {
        rollbackApplyTransaction(journal, "interrupted apply recovered before retry");
      } catch (error) {
        die(error.message);
      }
    }
  }
}

function applySandbox(id) {
  const readiness = landCheck(id);
  if (readiness.archived) return;
  let state = loadRuntime(id);
  recoverPendingApply(id, state);
  state = loadRuntime(id);
  if (state.workspace?.applied) {
    const verification = verifyAppliedProjection(state);
    if (!verification.valid) die(`applied projection is invalid: ${verification.reason}`);
    console.log(`APPLIED ${id}\n  resumed: ${state.workspace.apply.transactionId}`);
    return;
  }
  const journal = prepareApplyTransaction(id, state);
  journal.status = "applying";
  saveApplyJournal(journal);
  try {
    journal.entries.forEach((entry, index) =>
      applyTransactionEntry(journal, entry, index));
    const mismatch = journal.entries.find((entry) =>
      pathIdentity(safeRootPath(entry.path)) !== entry.after);
    if (mismatch) throw new Error(`post-apply projection mismatch at '${mismatch.path}'`);
    state = loadRuntime(id);
    state.workspace = {
      ...state.workspace,
      applied: true,
      sandboxPath: state.workspace.path,
      targetPath: ROOT,
      apply: {
        transactionId: journal.transactionId,
        status: "verified",
        projectionHash: journal.projectionHash,
        touchedPaths: journal.entries.map((entry) => entry.path)
      }
    };
    state.status = "applied";
    saveRuntime(state);
    journal.status = "verified";
    journal.verifiedAt = now();
    saveApplyJournal(journal);
    console.log(`APPLIED ${id}\n  mode: ${state.workspace.mode}\n  projection: ${journal.projectionHash}`);
  } catch (error) {
    try {
      rollbackApplyTransaction(journal, error);
    } catch (rollbackError) {
      die(`${error.message}; ${rollbackError.message}`);
    }
    die(`${error.message}; transaction rolled back`);
  }
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

function cleanupApplyTransaction(state) {
  const transactionId = state.workspace?.apply?.transactionId;
  if (!transactionId) return { status: "not-needed" };
  const root = applyTransactionRoot(state.id, transactionId);
  try {
    for (const name of ["backup", "stage"]) {
      const path = join(root, name);
      if (existsSync(path)) rmSync(path, { recursive: true });
    }
    const journalPath = transactionJournalPath(state.id, transactionId);
    if (existsSync(journalPath)) {
      const journal = readJson(journalPath);
      journal.status = "committed";
      journal.committedAt = now();
      delete journal.inFlightPaths;
      saveApplyJournal(journal);
    }
    return { status: "committed", transactionId };
  } catch (error) {
    return { status: "failed", transactionId, reason: error.message };
  }
}

function archive(id) {
  const initial = loadRuntime(id);
  if (initial.status === "archived") {
    const audit = proofAudit(id, true);
    if (!audit.valid) die(`archived proof audit failed: ${audit.reason}`);
    let resumed = false;
    if (initial.workspace &&
        !["removed", "not-needed"].includes(initial.workspace.cleanup?.status)) {
      initial.workspace.cleanup = cleanupAppliedSandbox(id, initial);
      initial.land = {
        ...(initial.land || {}),
        status: initial.workspace.cleanup.status === "removed"
          ? "sandbox-cleaned" : "archive-audited",
        resumedAt: now()
      };
      resumed = true;
    }
    if (initial.workspace?.apply &&
        initial.workspace.apply.cleanup?.status !== "committed") {
      initial.workspace.apply.cleanup = cleanupApplyTransaction(initial);
      resumed = true;
    }
    if (resumed) saveRuntime(initial);
    console.log(`ALREADY ARCHIVED ${id}\n  archived: ${initial.archivedAt || "unknown"}`);
    return;
  }
  const recoveredArchive = initial.status !== "archived" &&
    !existsSync(changePath(id)) && archivedChangeRelativePath(id);
  if (recoveredArchive) {
    initial.status = "archived";
    initial.archivedAt ||= now();
    initial.archivedChangePath = recoveredArchive;
    initial.land = {
      ...(initial.land || {}),
      status: "archive-audited",
      recoveredAt: now()
    };
    initial.workspace.cleanup = cleanupAppliedSandbox(id, initial);
    if (initial.workspace.apply)
      initial.workspace.apply.cleanup = cleanupApplyTransaction(initial);
    delete initial.workspace.baseline;
    saveRuntime(initial);
    const audit = proofAudit(id, true);
    if (!audit.valid) die(`recovered archive has invalid proof: ${audit.reason}`);
    console.log(`ARCHIVED ${id}\n  recovered: interrupted archive transaction`);
    return;
  }
  let readiness = landCheck(id);
  if (readiness.archived) return;
  let journal = loadRuntime(id);
  journal.land = {
    ...(journal.land || {}),
    status: "evidence-snapshotted",
    proofRunId: readJson(proofPath(id)).proofRunId,
    updatedAt: now()
  };
  saveRuntime(journal);
  if (["worktree", "copy"].includes(readiness.state.workspace?.mode) &&
      !readiness.state.workspace.applied) {
    applySandbox(id);
    journal = loadRuntime(id);
    journal.land = { ...(journal.land || {}), status: "code-applied", updatedAt: now() };
    saveRuntime(journal);
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
  state.land = { ...(state.land || {}), status: "specs-archived", updatedAt: now() };
  saveRuntime(state);
  const audit = proofAudit(id, true);
  if (!audit.valid) die(`post-archive proof audit failed: ${audit.reason}`);
  state.land = { ...(state.land || {}), status: "archive-audited", updatedAt: now() };
  state.workspace.cleanup = cleanupAppliedSandbox(id, state);
  if (state.workspace.apply)
    state.workspace.apply.cleanup = cleanupApplyTransaction(state);
  delete state.workspace.baseline;
  state.land.status = "sandbox-cleaned";
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

function policyCapabilities(id) {
  if (policyCache.has(id)) return policyCache.get(id);
  const state = loadRuntime(id);
  const files = changedFiles(id, state)
    .filter((path) => !path.startsWith("openspec/changes/"));
  const defaults = [
    {
      patterns: [/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/,
        /(^|\/)(package\.json|composer\.json|Cargo\.toml|go\.mod|Gemfile)$/],
      capabilities: ["dependency-supply-chain"]
    },
    {
      patterns: [/(^|\/)(migrations?|schema|ddl)(\/|\.|$)/i],
      capabilities: ["data-migration"]
    },
    {
      patterns: [/\.(tsx|jsx|vue|svelte|html|css|scss)$/i],
      capabilities: ["accessibility"]
    },
    {
      patterns: [/(^|\/)(openapi|swagger|asyncapi|proto|contracts?)(\/|\.|$)/i],
      capabilities: ["compatibility"]
    },
    {
      patterns: [/(^|\/)(auth|identity|permissions?|sessions?|tokens?)(\/|\.|$)/i],
      capabilities: ["security-static", "review"]
    },
    {
      patterns: [/(^|\/)(Dockerfile|deploy|deployment|helm|terraform|infra)(\/|\.|$)/i,
        /(^|\/)\.github\/workflows\//],
      capabilities: ["deployment"]
    }
  ];
  const required = new Set();
  for (const policy of defaults)
    if (files.some((path) => policy.patterns.some((pattern) => pattern.test(path))))
      policy.capabilities.forEach((capability) => required.add(capability));
  const configured = readJson(join(ROOT, ".foundation", "policy.json"), { rules: [] });
  for (const rule of configured.rules || []) {
    if (!Array.isArray(rule.paths) || !Array.isArray(rule.capabilities)) continue;
    const matches = files.some((path) => rule.paths.some((prefix) =>
      typeof prefix === "string" &&
      (path === prefix.replace(/\*\*?$/, "") ||
       path.startsWith(prefix.replace(/\*\*?$/, "")))));
    if (matches)
      for (const capability of rule.capabilities)
        if (PROVIDERS.has(capability)) required.add(capability);
  }
  const result = [...required].sort();
  policyCache.set(id, result);
  return result;
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
  const fileChanges = changedFiles(id, state);
  const changedFileSummary = fileChanges.length <= 200 ? fileChanges : {
    count: fileChanges.length,
    digest: stableHash(fileChanges),
    groups: Object.entries(fileChanges.reduce((groups, path) => {
      const prefix = path.split("/").slice(0, 2).join("/");
      groups[prefix] = (groups[prefix] || 0) + 1;
      return groups;
    }, {})).sort(([left], [right]) => left.localeCompare(right))
      .map(([prefix, count]) => ({ prefix, count }))
  };
  const packet = {
    version: 2, changeId: id, intent: state.intent, schema: state.schema,
    status: state.status, revision: Number(state.revision || 0),
    contractRevision: Number(state.contractRevision || 0),
    executionRevision: Number(state.executionRevision || 0),
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
    providers, changedFiles: changedFileSummary,
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
  const snapshot = state.activeProofRun || readJson(snapshotPath(id), {});
  const cacheTokens = flags.cache === undefined ? null : Number(flags.cache);
  const event = {
    version: 2,
    runId: flags.run || id, operationId: flags.operation || "unknown",
    agentId: flags.agent || null, modelId: flags.model || null,
    requestId: flags.request || null, parentRequestId: flags.parent || null,
    timestamp: now(),
    inputTokens: flags.input === undefined ? null : Number(flags.input),
    outputTokens: flags.output === undefined ? null : Number(flags.output),
    cacheCreationTokens: null,
    cacheReadTokens: cacheTokens,
    cacheTokens,
    cost: flags.cost === undefined ? null : Number(flags.cost),
    durationMs: flags.duration === undefined ? null : Number(flags.duration),
    tool: flags.tool || null,
    workspaceHash: snapshot.workspaceHash || null,
    workspaceSnapshotId: snapshot.snapshotId || snapshot.id || null,
    changeId: id
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

function telemetryCursorPath(id) {
  return join(LOGS, id, "claude-cursors.json");
}

function sourceKey(path) {
  return createHash("sha256").update(path).digest("hex").slice(0, 24);
}

function claudeHostContext(sourceOverride = null) {
  const transcriptPath = sourceOverride || process.env.FOUNDATION_CLAUDE_TRANSCRIPT_PATH;
  if (!transcriptPath) return null;
  const path = resolve(transcriptPath);
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  return {
    sessionId: sourceOverride
      ? basename(path).replace(/\.jsonl$/, "")
      : (process.env.FOUNDATION_CLAUDE_SESSION_ID ||
        basename(path).replace(/\.jsonl$/, "")),
    transcriptPath: realpathSync(path)
  };
}

function collectClaudeSources(transcriptPath) {
  const sources = [transcriptPath];
  const sessionArtifacts = join(dirname(transcriptPath),
    basename(transcriptPath).replace(/\.jsonl$/, ""), "subagents");
  function collect(path) {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) collect(child);
      else if (entry.isFile() && entry.name.endsWith(".jsonl"))
        sources.push(realpathSync(child));
    }
  }
  collect(sessionArtifacts);
  return [...new Set(sources)];
}

function loadClaudeCursors(id) {
  return readJson(telemetryCursorPath(id), { version: 1, sessions: {} });
}

function saveClaudeCursors(id, cursors) {
  writeJson(telemetryCursorPath(id), cursors);
}

function bindClaudeSession(id, operationId, options = {}) {
  const context = claudeHostContext(options.source || null);
  if (!context) return null;
  const cursors = loadClaudeCursors(id);
  let session = cursors.sessions[context.sessionId];
  if (!session) {
    session = {
      sessionId: context.sessionId,
      transcriptPath: context.transcriptPath,
      operationId: operationId || "unknown",
      boundAt: now(),
      sources: {}
    };
    for (const path of collectClaudeSources(context.transcriptPath)) {
      session.sources[sourceKey(path)] = {
        path,
        offset: options.fromStart ? 0 : statSync(path).size
      };
    }
    cursors.sessions[context.sessionId] = session;
  } else {
    session.transcriptPath = context.transcriptPath;
    if (operationId) session.operationId = operationId;
  }
  session.updatedAt = now();
  saveClaudeCursors(id, cursors);
  return { context, cursors, session };
}

function readCompleteJsonLines(path, offset) {
  const size = statSync(path).size;
  const start = offset >= 0 && offset <= size ? offset : 0;
  if (start === size) return { rows: [], nextOffset: start };
  const buffer = Buffer.alloc(size - start);
  const descriptor = openSync(path, "r");
  try {
    readSync(descriptor, buffer, 0, buffer.length, start);
  } finally {
    closeSync(descriptor);
  }
  const newline = buffer.lastIndexOf(10);
  if (newline < 0) return { rows: [], nextOffset: start };
  const text = buffer.subarray(0, newline + 1).toString("utf8");
  const rows = text.split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); }
    catch (error) {
      die(`invalid Claude transcript record in ${basename(path)} (${error.message})`);
    }
  });
  return { rows, nextOffset: start + newline + 1 };
}

function nullableSum(...values) {
  const known = values.filter((value) =>
    value !== null && value !== undefined && Number.isFinite(Number(value)));
  return known.length ? known.reduce((sum, value) => sum + Number(value), 0) : null;
}

function normalizeTelemetryRow(id, row, format, context = {}) {
  const message = row.message && typeof row.message === "object" ? row.message : {};
  if (format === "claude" &&
      (row.type !== "assistant" || !message.usage || message.role !== "assistant"))
    return null;
  const usage = format === "claude"
    ? message.usage
    : (row.usage || row.token_usage || {});
  const requestId = format === "claude"
    ? (row.requestId || row.request_id || message.id || row.uuid)
    : (row.requestId || row.request_id || row.id);
  if (!requestId) return null;
  const cacheCreationTokens = row.cacheCreationTokens ??
    usage.cache_creation_input_tokens ?? null;
  const cacheReadTokens = row.cacheReadTokens ??
    usage.cache_read_input_tokens ?? usage.cache_tokens ??
    (format === "claude" ? null : row.cacheTokens) ?? null;
  const cacheTokens = row.cacheTokens ??
    nullableSum(cacheCreationTokens, cacheReadTokens);
  const snapshot = context.snapshot || {};
  return {
    version: 2,
    runId: row.runId || row.run_id || context.sessionId || id,
    operationId: row.operationId || row.operation_id || row.phase ||
      context.operationId || "unknown",
    agentId: row.agentId || row.agent_id || row.agent ||
      context.agentId || (format === "claude" ? "orchestrator" : null),
    modelId: row.modelId || row.model_id || row.model || message.model || null,
    requestId,
    messageId: message.id || row.messageId || null,
    sessionId: row.sessionId || row.session_id || context.sessionId || null,
    parentRequestId: row.parentRequestId || row.parent_request_id || null,
    timestamp: row.timestamp || row.created_at || now(),
    inputTokens: row.inputTokens ?? usage.input_tokens ?? usage.input ?? null,
    outputTokens: row.outputTokens ?? usage.output_tokens ?? usage.output ?? null,
    cacheCreationTokens,
    cacheReadTokens,
    cacheTokens,
    cost: row.cost ?? row.cost_usd ?? usage.cost_usd ?? null,
    durationMs: row.durationMs ?? row.duration_ms ?? null,
    tool: row.tool || null,
    workspaceHash: row.workspaceHash || snapshot.workspaceHash || null,
    workspaceSnapshotId: row.workspaceSnapshotId || snapshot.id || null,
    changeId: id,
    source: format === "claude" ? "claude-transcript" : format,
    sourcePathHash: context.sourcePath
      ? createHash("sha256").update(context.sourcePath).digest("hex") : null
  };
}

function appendTelemetryRows(id, rows, format, context = {}) {
  const target = join(LOGS, id, "events.jsonl");
  const known = new Set(readJsonLines(target).map((row) => row.requestId));
  const normalized = [];
  for (const row of rows) {
    const event = normalizeTelemetryRow(id, row, format, context);
    if (!event || known.has(event.requestId)) continue;
    known.add(event.requestId);
    normalized.push(event);
  }
  if (normalized.length) {
    mkdirSync(dirname(target), { recursive: true });
    appendFileSync(target, normalized.map((row) => JSON.stringify(row)).join("\n") + "\n");
    const state = loadRuntime(id);
    state.budget.usedRequests = readJsonLines(target).length;
    state.budget.measurement = format === "claude"
      ? "claude-transcript"
      : `host-events:${format}`;
    saveRuntime(state);
  }
  return normalized.length;
}

function syncClaudeTelemetry(id, options = {}) {
  loadRuntime(id);
  const context = claudeHostContext(options.source || null);
  if (!context) {
    if (!options.quiet)
      console.log(`TELEMETRY ${id}: Claude transcript unavailable; imported 0`);
    return { imported: 0, scanned: 0 };
  }
  let binding = bindClaudeSession(id, options.operationId || null, {
    source: options.source || null,
    fromStart: Boolean(options.source)
  });
  const { cursors, session } = binding;
  const snapshot = readJson(snapshotPath(id), {});
  let imported = 0;
  let scanned = 0;
  for (const path of collectClaudeSources(context.transcriptPath)) {
    const key = sourceKey(path);
    const source = session.sources[key] || { path, offset: 0 };
    const chunk = readCompleteJsonLines(path, Number(source.offset || 0));
    const isSubagent = path !== context.transcriptPath;
    imported += appendTelemetryRows(id, chunk.rows, "claude", {
      sessionId: context.sessionId,
      operationId: session.operationId || "unknown",
      agentId: isSubagent
        ? basename(path).replace(/^agent-/, "").replace(/\.jsonl$/, "")
        : "orchestrator",
      sourcePath: path,
      snapshot
    });
    scanned += chunk.rows.length;
    session.sources[key] = { path, offset: chunk.nextOffset };
  }
  session.updatedAt = now();
  saveClaudeCursors(id, cursors);
  if (!options.quiet)
    console.log(`TELEMETRY ${id}: imported ${imported}; scanned ${scanned}; source claude-transcript`);
  return { imported, scanned };
}

function prepareClaudeTelemetry(id, operationId) {
  const context = claudeHostContext();
  if (!context) return;
  const cursors = loadClaudeCursors(id);
  if (cursors.sessions[context.sessionId])
    syncClaudeTelemetry(id, { quiet: true });
  bindClaudeSession(id, operationId);
}

function importTelemetry(id, values) {
  const { flags, rest } = parseFlags(values);
  const source = rest[0];
  if (!source) die("telemetry import requires a JSON or JSONL file");
  const format = flags.format || "generic";
  if (!["generic", "codex", "claude"].includes(format))
    die("telemetry --format must be generic|codex|claude");
  const path = resolve(process.cwd(), source);
  if (!existsSync(path)) die(`telemetry source not found: ${source}`);
  const text = readFileSync(path, "utf8").trim();
  let rows;
  try {
    const parsed = JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    rows = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  }
  if (format === "claude" && !rows.some((row) =>
    row.type === "assistant" && row.message?.role === "assistant" && row.message?.usage))
    die("Claude telemetry source has no assistant.message.usage records");
  const snapshot = readJson(snapshotPath(id), {});
  const imported = appendTelemetryRows(id, rows, format, { snapshot });
  console.log(`TELEMETRY ${id}: imported ${imported}; skipped ${rows.length - imported}`);
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
        proofRunId: receipt.proofRunId || null,
        commandExecutionId: receipt.commandExecutionId || receipt.executionId || null
      };
      const commandExecutionId = receipt.commandExecutionId || receipt.executionId;
      if (commandExecutionId && Number.isFinite(Number(receipt.durationMs)))
        executions.set(commandExecutionId,
          Math.max(executions.get(commandExecutionId) || 0, Number(receipt.durationMs)));
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
    cacheCreationTokens: sumKnown(events, "cacheCreationTokens"),
    cacheReadTokens: sumKnown(events, "cacheReadTokens"),
    cacheTokens: sumKnown(events, "cacheTokens"),
    cost: totalCost,
    orchestratorTokenShare: tokenTotal > 0 ? orchestratorTokens / tokenTotal : null,
    orchestratorCostShare: totalCost > 0 && orchestratorCost !== null
      ? orchestratorCost / totalCost : null,
    measurement: events.length
      ? (operations.length ? "operations-and-host-events" : "host-events-only")
      : (operations.length ? "operations-only" : "receipts-only")
  }, null, 2));
}

function doctor(flags = {}) {
  const checks = [];
  const stage = flags.stage || "prove";
  if (!["change", "build", "prove"].includes(stage))
    die("doctor --stage must be change|build|prove");
  const nodeParts = process.versions.node.split(".").map(Number);
  const nodeOk = nodeParts[0] > 20 || (nodeParts[0] === 20 && nodeParts[1] >= 19);
  checks.push({ level: nodeOk ? "ok" : "error", name: "node", detail: process.versions.node });
  const protocols = protocolDescriptor();
  const protocolOk = String(protocols.runtimeApi) === RUNTIME_API_VERSION &&
    String(protocols.providerProtocol) === PROVIDER_PROTOCOL_VERSION &&
    String(protocols.adapterProtocol) === ADAPTER_PROTOCOL_VERSION &&
    String(protocols.proofProtocol) === PROOF_PROTOCOL_VERSION;
  checks.push({
    level: protocolOk ? "ok" : "error",
    name: "protocol-bundle",
    detail: protocolOk ? `runtime API ${RUNTIME_API_VERSION}; provider ${PROVIDER_PROTOCOL_VERSION}; proof ${PROOF_PROTOCOL_VERSION}` :
      "protocol.json is incompatible with foundation.mjs; reinstall Foundation"
  });

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
      const commandAvailable = commandExists(executable, workspace);
      checks.push({
        level: commandAvailable ? "ok" : (stage === "prove" ? "error" : "info"),
        name: `provider:${provider}:command`,
        detail: commandAvailable ? executable :
          `${executable || "missing"} ${stage === "prove" ? "unavailable" : "planned"}`
      });
      if (config.adapter === "playwright") {
        checks.push({
          level: playwright.packageOwned && playwright.binaryAvailable ? "ok" :
            (stage === "prove" ? "error" : "info"),
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
    for (const issue of topologyIssues(requestedChange))
      checks.push({
        level: stage === "prove" ? "error" : "warn",
        name: "proof-topology",
        detail: issue
      });
    const policy = policyCapabilities(requestedChange);
    checks.push({
      level: "info",
      name: "policy-capabilities",
      detail: policy.length ? policy.join(", ") : "none inferred from changed surface"
    });
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
  doctor [--stage change|build|prove] [--require-archive] [--change <id>]
  new <intent> [--id <id>] [--rapid]
  resolve <change> --impact <low|medium|high> --coupling <isolated|coupled>
  changes
  providers
  packet <change> [--phase change|build|prove|land]
  metrics <change>
  validate <change>
  hash <change>
  proof-plan <change>
  proof-preflight <change>
  proof-execute <change>
  proof-audit <change>
  receipt <change> <provider> <pass|fail|inconclusive|error> [--claims=a,b]
  evidence-upgrade <change>
  run-provider <change> <provider> -- <command> [args...]
  prove <change>
  land-check <change>
  sandbox create|sync|apply <change>
  archive <change>
  event <change> --request <id> [metrics...]
  telemetry-sync <change> [transcript.jsonl]
  telemetry-import <change> <file> [--format generic|codex|claude]
  migrate [legacy-id] [--apply]`);
}

const [command, ...values] = process.argv.slice(2);
operationName = command || null;
operationChangeId = command === "sandbox" ? values[1] :
  ["resolve", "validate", "hash", "packet", "metrics", "proof-plan", "proof-preflight", "proof-execute", "proof-audit", "evidence-upgrade", "receipt", "run-provider", "prove",
    "land-check", "archive", "event", "telemetry-sync", "telemetry-import"].includes(command) ? values[0] : null;

const telemetryPhase = {
  resolve: "change",
  "evidence-upgrade": "change",
  sandbox: "build",
  "proof-plan": "prove",
  "proof-preflight": "prove",
  "proof-execute": "prove",
  "proof-audit": "prove",
  receipt: "prove",
  "run-provider": "prove",
  prove: "prove",
  "land-check": "land",
  archive: "land"
}[command];
if (operationChangeId && telemetryPhase && existsSync(runtimePath(operationChangeId)))
  prepareClaudeTelemetry(operationChangeId, telemetryPhase);
if (command === "metrics" && operationChangeId && existsSync(runtimePath(operationChangeId)))
  syncClaudeTelemetry(operationChangeId, { quiet: true });

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
  case "packet": {
    const { flags, rest } = parseFlags(values);
    if (flags.phase && !["change", "build", "prove", "land"].includes(flags.phase))
      die("packet --phase must be change|build|prove|land");
    if (flags.phase) prepareClaudeTelemetry(rest[0], flags.phase);
    showPacket(rest[0]); break;
  }
  case "metrics": showMetrics(values[0]); break;
  case "doctor": {
    const { flags, rest } = parseFlags(values);
    if (rest.length) die(`unexpected doctor argument(s): ${rest.join(", ")}`);
    doctor(flags); break;
  }
  case "validate": validate(values[0]); break;
  case "hash": console.log(relevantHash(values[0])); break;
  case "proof-plan": proofPlan(values[0]); break;
  case "proof-preflight": proofPreflight(values[0]); break;
  case "proof-execute": await proofExecute(values[0]); break;
  case "proof-audit": {
    const audit = proofAudit(values[0]);
    if (!audit.valid) die(`proof audit failed: ${audit.reason}`);
    break;
  }
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
  case "telemetry-sync":
    syncClaudeTelemetry(values[0], { source: values[1] || null }); break;
  case "telemetry-import": importTelemetry(values[0], values.slice(1)); break;
  case "migrate": migrate(values); break;
  case "api-version": console.log(RUNTIME_API_VERSION); break;
  case "version": console.log(VERSION); break;
  default: usage(); if (command) process.exit(1);
}
