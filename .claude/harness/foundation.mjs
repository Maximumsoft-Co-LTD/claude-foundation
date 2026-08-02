#!/usr/bin/env node

import {
  accessSync, appendFileSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync,
  readSync, readdirSync, lstatSync, mkdtempSync, readlinkSync, realpathSync,
  renameSync, rmSync, statSync, symlinkSync, writeFileSync
} from "node:fs";
import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const VERSION = "2.3.0";
const RUNTIME_API_VERSION = "8";
const PROVIDER_PROTOCOL_VERSION = "6";
const ADAPTER_PROTOCOL_VERSION = "4";
const PROOF_PROTOCOL_VERSION = "4";
const PACKET_SCHEMA_VERSION = "4";
const AGENT_PLAN_SCHEMA_VERSION = "2";
const CONTEXT_EVENT_SCHEMA_VERSION = "2";
const REVIEW_PROTOCOL_VERSION = "2";
const ACCEPTANCE_PROTOCOL_VERSION = "2";
const REVIEW_PACKET_SCHEMA_VERSION = "2";
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
  "acceptance": "A named human accepts an explicitly subjective product or experience decision.",
  "static-analysis": "Compilation, type checking, linting, and applicable static quality gates pass.",
  "data-migration": "Schema or data evolution is forward-safe, backward-compatible, and rollback-aware.",
  "accessibility": "Rendered semantics, keyboard use, focus, contrast, and assistive access meet policy.",
  "resilience": "Timeout, retry, partial-failure, recovery, and degraded-dependency behavior is proven.",
  "observability": "Required logs, metrics, traces, and alerts expose success and failure safely.",
  "deployment": "Packaging, configuration, rollout health checks, and rollback behavior are proven.",
  "dependency-supply-chain": "Dependency vulnerability, license, lockfile, and provenance policy passes."
};
const PROVIDERS = new Set(Object.keys(PROVIDER_CONTRACTS));
function providerCapability(provider, config = null) {
  return config?.capability || (PROVIDERS.has(provider) ? provider : null);
}
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

function canonicalPath(path) {
  const absolute = resolve(path);
  return existsSync(absolute) ? realpathSync(absolute) : absolute;
}

const ROOT = canonicalPath(findRoot());
const RUNTIME = join(ROOT, ".foundation", "runtime");
const RECEIPTS = join(ROOT, ".foundation", "receipts");
const LOGS = join(ROOT, ".foundation", "logs");
const EVIDENCE_VAULT = join(ROOT, ".foundation", "evidence");
const SNAPSHOTS = join(ROOT, ".foundation", "snapshots");
const TRANSACTIONS = join(ROOT, ".foundation", "transactions");
const PLANS = join(ROOT, ".foundation", "plans");
const LEASES = join(ROOT, ".foundation", "leases");
const PROTOTYPES = join(ROOT, ".foundation", "prototypes");
const CHANGES = join(ROOT, "openspec", "changes");
mkdirSync(RUNTIME, { recursive: true });
mkdirSync(RECEIPTS, { recursive: true });
mkdirSync(LOGS, { recursive: true });
mkdirSync(EVIDENCE_VAULT, { recursive: true });
mkdirSync(SNAPSHOTS, { recursive: true });
mkdirSync(TRANSACTIONS, { recursive: true });
mkdirSync(PLANS, { recursive: true });
mkdirSync(LEASES, { recursive: true });
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
    proofProtocol: PROOF_PROTOCOL_VERSION,
    packetSchema: PACKET_SCHEMA_VERSION,
    agentPlanSchema: AGENT_PLAN_SCHEMA_VERSION,
    contextEventSchema: CONTEXT_EVENT_SCHEMA_VERSION,
    reviewProtocol: REVIEW_PROTOCOL_VERSION,
    acceptanceProtocol: ACCEPTANCE_PROTOCOL_VERSION,
    reviewPacketSchema: REVIEW_PACKET_SCHEMA_VERSION
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
  const setFlag = (key, value) => {
    if ([
      "artifact", "artifacts", "reference", "criterion", "scope-path",
      "subject-actor", "subject-session", "subject-provider-family",
      "subject-model-family", "subject-model", "subject-provenance"
    ].includes(key)) {
      const prior = flags[key];
      flags[key] = prior === undefined ? [value] :
        Array.isArray(prior) ? [...prior, value] : [prior, value];
      return;
    }
    flags[key] = value;
  };
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith("--")) { rest.push(value); continue; }
    const body = value.slice(2);
    if (body.includes("=")) {
      const [key, ...tail] = body.split("=");
      setFlag(key, tail.join("="));
    } else if (values[i + 1] && !values[i + 1].startsWith("--")) {
      setFlag(body, values[i + 1]); i += 1;
    } else setFlag(body, true);
  }
  return { flags, rest };
}

function parseStrictCommandFlags(values, context, schema = {}) {
  const booleanFlags = new Set(schema.boolean || []);
  const valueFlags = new Set(schema.value || []);
  const flags = {};
  const rest = [];
  for (let i = 0; i < values.length; i += 1) {
    const token = values[i];
    if (!token.startsWith("--")) {
      rest.push(token);
      continue;
    }
    const body = token.slice(2);
    const separator = body.indexOf("=");
    const key = separator === -1 ? body : body.slice(0, separator);
    if (!booleanFlags.has(key) && !valueFlags.has(key))
      die(`${context} does not support --${key || "<empty>"}`);
    if (Object.hasOwn(flags, key)) die(`${context} does not allow duplicate --${key}`);
    if (booleanFlags.has(key)) {
      if (separator !== -1) die(`${context} flag --${key} does not accept a value`);
      flags[key] = true;
      continue;
    }
    const inline = separator === -1 ? null : body.slice(separator + 1);
    const next = inline === null ? values[i + 1] : inline;
    if (!next || (inline === null && next.startsWith("--")))
      die(`${context} flag --${key} requires a value`);
    flags[key] = next;
    if (inline === null) i += 1;
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
    else if (entry.isFile() || entry.isSymbolicLink()) callback(path);
  }
}

function filesystemEntryIdentity(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return `symlink:${readlinkSync(path)}`;
  if (stat.isFile()) return fileDigest(path);
  return `unsupported:${stat.mode}`;
}

function directoryHash(dir) {
  const hash = createHash("sha256");
  const files = [];
  walk(dir, (path) => files.push(path));
  files.sort((a, b) => relative(dir, a).localeCompare(relative(dir, b)));
  for (const path of files) {
    hash.update(relative(dir, path).replaceAll("\\", "/"));
    hash.update("\0"); hash.update(filesystemEntryIdentity(path)); hash.update("\0");
  }
  return hash.digest("hex");
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function serializedJson(value, pretty = false) {
  return `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`;
}

function compactList(values, limit = 20, project = (value) => value) {
  const projected = values.map(project);
  if (projected.length <= limit) return projected;
  return {
    count: projected.length,
    preview: projected.slice(0, limit),
    digest: stableHash(projected)
  };
}

function compactStrings(values, limit = 20) {
  return compactList(values, limit, (value) => String(value));
}

function fileDigest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const snapshotCache = new Map();
const policyCache = new Map();

function singleRelevantSnapshot(id, workspaceOverride = null, force = false) {
  const state = existsSync(runtimePath(id)) ? readJson(runtimePath(id)) : {};
  const workspace = canonicalPath(workspaceOverride || state.workspace?.path || ROOT);
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
      else if (entry.isFile() || entry.isSymbolicLink()) files.push([rel, path]);
    }
  }
  const gitIndex = git(["ls-files", "-s", "-z"], workspace);
  const gitStatus = git([
    "status", "--porcelain=v1", "-z", "--untracked-files=all"
  ], workspace);
  if (gitIndex.status === 0 && gitStatus.status === 0) {
    const indexed = new Map();
    for (const line of gitIndex.stdout.split("\0").filter(Boolean)) {
      const match = line.match(/^(\d+)\s+([0-9a-f]+)\s+\d+\t(.+)$/);
      if (match) indexed.set(match[3], { mode: match[1], oid: match[2] });
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
        ? (indexed.get(rel)?.mode === "160000"
          ? `gitlink:${indexed.get(rel).oid}`
          : (existsSync(path) ? filesystemEntryIdentity(path) : "deleted"))
        : indexed.get(rel)?.oid;
      files.push([rel, path]);
      hash.update(rel); hash.update("\0");
      hash.update(contentIdentity || "missing"); hash.update("\0");
    }
  } else {
    collect(workspace);
    files.sort(([a], [b]) => a.localeCompare(b));
    for (const [rel, path] of files) {
      hash.update(rel); hash.update("\0"); hash.update(filesystemEntryIdentity(path)); hash.update("\0");
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

function relevantSnapshot(id, workspaceOverride = null, force = false) {
  const state = existsSync(runtimePath(id)) ? readJson(runtimePath(id)) : {};
  if (workspaceOverride || !state.repositories ||
      Object.keys(state.repositories).length === 0)
    return singleRelevantSnapshot(id, workspaceOverride, force);
  const control = singleRelevantSnapshot(
    id, state.workspace?.path || ROOT, force
  );
  const repositories = {};
  for (const repository of selectedRepositories(id, state)) {
    if (repository.id === "root") {
      repositories.root = {
        id: control.id, workspaceHash: control.workspaceHash,
        workspace: control.workspace, baseHead: repository.baseHead || gitHead(ROOT)
      };
      continue;
    }
    const workspace = repository.workspacePath || repository.path;
    const snapshot = singleRelevantSnapshot(id, workspace, force);
    repositories[repository.id] = {
      id: snapshot.id, workspaceHash: snapshot.workspaceHash,
      workspace: snapshot.workspace,
      baseHead: repository.baseHead || gitHead(repository.path)
    };
  }
  const workspaceHash = stableHash({
    version: 1,
    contractRevision: Number(state.contractRevision || state.revision || 0),
    control: control.workspaceHash,
    repositories: Object.entries(repositories).sort(([left], [right]) =>
      left.localeCompare(right)).map(([repository, value]) => ({
        repository, workspaceHash: value.workspaceHash, baseHead: value.baseHead
      }))
  });
  const value = {
    version: 2,
    id: `snapshot-${workspaceHash.slice(0, 20)}`,
    changeId: id,
    workspace: control.workspace,
    workspaceHash,
    revision: Number(state.contractRevision || state.revision || 0),
    fileCount: control.fileCount,
    control,
    repositories,
    createdAt: now()
  };
  writeJson(snapshotPath(id), value);
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
      else if (entry.isFile() || entry.isSymbolicLink())
        result[rel] = filesystemEntryIdentity(path);
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

function loadDraft(draftPath) {
  const source = resolve(ROOT, draftPath);
  if (!pathInside(ROOT, source) || !existsSync(source))
    die("new --draft requires a JSON file inside the project");
  const draft = readJson(source);
  const requiredStrings = ["why", "currentState", "compatibility"];
  for (const field of requiredStrings)
    if (!String(draft[field] || "").trim())
      die(`draft requires non-empty '${field}'`);
  for (const field of ["changes", "nonGoals", "decisions", "risks", "tasks", "claims", "specs"])
    if (!Array.isArray(draft[field]) || draft[field].length === 0)
      die(`draft requires a non-empty '${field}' array`);
  return draft;
}

function materializeDraft(id, draft) {
  const state = loadRuntime(id);
  const title = draft.title || state.intent;
  const bullets = (items) => items.map((item) => `- ${item}`).join("\n");
  writeFileSync(join(changePath(id), "proposal.md"),
    `# Change: ${title}\n\n## Why\n\n${draft.why}\n\n` +
    `## What changes\n\n${bullets(draft.changes)}\n\n## Impact\n\n` +
    `- **Impact:** ${draft.impact || state.impact || "medium"}\n` +
    `- **Coupling:** ${draft.coupling || state.coupling || "coupled"}\n` +
    `- **Affected surfaces:** ${(draft.surfaces || ["code"]).join(", ")}\n` +
    `- **Security triggers:** ${(draft.securityTriggers || ["none"]).join(", ")}\n\n` +
    `## Non-goals\n\n${bullets(draft.nonGoals)}\n`);
  if (state.schema === "foundation-standard")
    writeFileSync(join(changePath(id), "design.md"),
      `# Design\n\n## Current state\n\n${draft.currentState}\n\n## Decisions\n\n` +
      draft.decisions.map((decision) =>
        `- **Decision:** ${decision.choice}\n  - **Why:** ${decision.why}\n` +
        `  - **Rejected:** ${decision.rejected || "none"}`).join("\n") +
      `\n\n## Compatibility and migration\n\n${draft.compatibility}\n\n## Risks\n\n` +
      `| Risk | Mitigation | Evidence owner |\n|---|---|---|\n` +
      draft.risks.map((risk) =>
        `| ${risk.risk} | ${risk.mitigation} | ${risk.owner} |`).join("\n") + "\n");
  writeFileSync(join(changePath(id), "tasks.md"),
    `# Tasks\n\n> This is the sole implementation ledger.\n\n` +
    draft.tasks.map((task, index) => {
      const taskId = task.id || `T${String(index + 1).padStart(3, "0")}`;
      const metadata = [
        task.kind ? `[kind:${task.kind}]` : "",
        task.paths?.length ? `[paths:${task.paths.join(",")}]` : "",
        task.dependsOn?.length ? `[depends:${task.dependsOn.join(",")}]` : ""
      ].filter(Boolean).join(" ");
      return `- [ ] **${taskId}** ${task.outcome} ${metadata} — verify: \`${task.verify}\``;
    }).join("\n") + "\n");
  const contract = readJson(join(changePath(id), "evidence.yaml"));
  contract.claims = draft.claims;
  writeJson(join(changePath(id), "evidence.yaml"), contract);
  if (state.schema === "foundation-standard") {
    rmSync(join(changePath(id), "specs"), { recursive: true, force: true });
    for (const spec of draft.specs) {
      const specDir = join(changePath(id), "specs", slugify(spec.name));
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "spec.md"),
        `# ${spec.name}\n\n## ADDED Requirements\n\n` +
        `### Requirement: ${spec.requirement}\n\n${spec.description}\n\n` +
        `#### Scenario: ${spec.scenario}\n\n- **WHEN** ${spec.when}\n` +
        `- **THEN** ${spec.then}\n`);
    }
  }
}

function createChange(intent, flags) {
  const id = slugify(flags.id || intent);
  operationChangeId = id;
  if (existsSync(changePath(id))) die(`change already exists: ${id}`);
  const draft = flags.draft ? loadDraft(flags.draft) : null;
  const schema = flags.rapid ? "foundation-rapid" : "foundation-standard";
  const source = templateDir(schema);
  const target = changePath(id);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, ".openspec.yaml"), `schema: ${schema}\n`);
  for (const name of ["proposal.md", "tasks.md", "evidence.yaml", "execution.yaml", "repositories.yaml"]) {
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
    acceptance: { version: 2, required: false, reason: null, claimIds: [], declaredAt: null },
    reviewHistory: { version: 1, aiAttempts: 0, totalAttempts: 0, chainHead: null },
    workspace: { mode: "current", path: ROOT, baseHead: gitHead(ROOT) },
    budget: {
      targetRequests: schema === "foundation-rapid" ? 80 : 160,
      targetTokens: schema === "foundation-rapid"
        ? foundationPolicy().execution.tokenBudgets.rapid
        : foundationPolicy().execution.tokenBudgets.standard,
      usedRequests: null, usedTokens: null,
      measurement: "unavailable-until-external-events"
    },
    createdAt: now(), updatedAt: now()
  };
  saveRuntime(state);
  if (draft) materializeDraft(id, draft);
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

function foundationPolicy() {
  const path = join(ROOT, "foundation.json");
  const configured = existsSync(path) ? readJson(path) : {};
  const defaults = {
    version: 1,
    execution: {
      maxParallelAgents: 3,
      packetBytes: { task: 8192, review: 8192, repository: 12288, global: 16384 },
      tokenBudgets: { rapid: 800000, standard: 1600000 },
      planSummaryBytes: 4096,
      leaseMinutes: 45
    },
    models: {
      fast: { family: "haiku", fallbackTier: "standard", purposes: ["inventory", "logs", "mechanical-docs"] },
      standard: { family: "sonnet", fallbackTier: "deep", purposes: ["implementation", "tests", "focused-investigation"] },
      deep: { family: "opus", fallbackTier: null, purposes: ["architecture", "security", "migration", "independent-review"] }
    },
    escalation: [
      "ambiguous-contract", "auth-or-sensitive-data", "migration",
      "concurrency", "public-compatibility", "cross-repository-conflict",
      "evidence-anomaly", "two-failed-attempts"
    ]
  };
  if (configured.version !== undefined && configured.version !== 1)
    die("foundation.json requires version 1");
  const policy = {
    ...defaults, ...configured,
    execution: { ...defaults.execution, ...(configured.execution || {}) },
    models: Object.fromEntries(["fast", "standard", "deep"].map((tier) => [
      tier, { ...defaults.models[tier], ...(configured.models?.[tier] || {}) }
    ]))
  };
  if (typeof policy.execution.packetBytes === "number") {
    policy.execution.legacyNumericPacketBytes = policy.execution.packetBytes;
    policy.execution.packetBytes = {
      task: policy.execution.packetBytes,
      review: policy.execution.packetBytes,
      repository: policy.execution.packetBytes,
      global: policy.execution.packetBytes
    };
  } else {
    policy.execution.packetBytes = {
      ...defaults.execution.packetBytes,
      ...(policy.execution.packetBytes || {})
    };
  }
  policy.execution.tokenBudgets = {
    ...defaults.execution.tokenBudgets,
    ...(policy.execution.tokenBudgets || {})
  };
  for (const type of ["task", "review", "repository", "global"]) {
    const bytes = Number(policy.execution.packetBytes?.[type]);
    if (!Number.isInteger(bytes) || bytes < 2048 || bytes > 65536)
      die(`foundation.json execution.packetBytes.${type} must be 2048..65536`);
  }
  const summaryBytes = Number(policy.execution.planSummaryBytes);
  if (!Number.isInteger(summaryBytes) || summaryBytes < 1024 || summaryBytes > 16384)
    die("foundation.json execution.planSummaryBytes must be 1024..16384");
  for (const type of ["rapid", "standard"]) {
    const tokens = Number(policy.execution.tokenBudgets[type]);
    if (!Number.isInteger(tokens) || tokens < 10000 || tokens > 100000000)
      die(`foundation.json execution.tokenBudgets.${type} must be 10000..100000000`);
  }
  const parallel = Number(policy.execution.maxParallelAgents);
  if (!Number.isInteger(parallel) || parallel < 1 || parallel > 16)
    die("foundation.json execution.maxParallelAgents must be an integer from 1 to 16");
  const leaseMinutes = Number(policy.execution.leaseMinutes);
  if (!Number.isFinite(leaseMinutes) || leaseMinutes < 1 || leaseMinutes > 1440)
    die("foundation.json execution.leaseMinutes must be from 1 to 1440");
  for (const tier of ["fast", "standard", "deep"])
    if (!policy.models[tier] || typeof policy.models[tier].family !== "string")
      die(`foundation.json models.${tier}.family is required`);
  for (const tier of ["fast", "standard", "deep"]) {
    const fallback = policy.models[tier].fallbackTier;
    if (fallback !== null && fallback !== undefined &&
        !["fast", "standard", "deep"].includes(fallback))
      die(`foundation.json models.${tier}.fallbackTier is invalid`);
    if (tier === "deep" && fallback && fallback !== "deep")
      die("deep model tier cannot downgrade when unavailable");
  }
  return policy;
}

function discoveredSubmodules() {
  const path = join(ROOT, ".gitmodules");
  if (!existsSync(path)) return [];
  const rows = [];
  let current = null;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const section = raw.match(/^\s*\[submodule\s+"([^"]+)"\]\s*$/);
    if (section) {
      if (current?.path) rows.push(current);
      current = { id: slugify(section[1]), name: section[1], type: "submodule" };
      continue;
    }
    if (!current) continue;
    const field = raw.match(/^\s*(path|url|branch)\s*=\s*(.+?)\s*$/);
    if (field) current[field[1]] = field[2];
  }
  if (current?.path) rows.push(current);
  return rows;
}

function repositoryCatalog() {
  const path = join(ROOT, "openspec", "repositories.yaml");
  const configured = existsSync(path)
    ? readJson(path)
    : { version: 1, repositories: [] };
  if (configured.version !== 1 || !Array.isArray(configured.repositories))
    die("openspec/repositories.yaml requires version 1 and a repositories array");
  const discovered = discoveredSubmodules();
  const configuredByPath = new Map(configured.repositories.map((repository) =>
    [repository.path, repository]));
  const configuredIds = new Set(configured.repositories.map((repository) => repository.id));
  const merged = [
    ...discovered.map((repository) => ({
      ...repository, ...(configuredByPath.get(repository.path) || {})
    })),
    ...configured.repositories.filter((repository) =>
      !discovered.some((item) => item.path === repository.path) &&
      !discovered.some((item) => item.id === repository.id))
  ];
  const rows = [
    {
      id: "root", type: "root", path: ".", role: "control-plane",
      mode: "write", dependsOn: []
    },
    ...merged
  ].map((repository) => {
    if (!repository || typeof repository !== "object")
      die("repository entries must be objects");
    const discoveredValue = discovered.find((item) =>
      item.path === repository.path || item.id === repository.id) || {};
    return {
      ...discoveredValue, ...repository,
      id: repository.id || discoveredValue.id,
      type: repository.type || discoveredValue.type || "git",
      mode: repository.mode || "write",
      dependsOn: repository.dependsOn || []
    };
  });
  const ids = new Set();
  const paths = new Set();
  for (const repository of rows) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(repository.id || ""))
      die(`invalid repository id '${repository.id || ""}'`);
    if (ids.has(repository.id)) die(`duplicate repository id '${repository.id}'`);
    ids.add(repository.id);
    if (!["root", "submodule", "git", "external"]
      .includes(repository.type))
      die(`repository '${repository.id}' has invalid type '${repository.type}'`);
    if (!["read", "write"].includes(repository.mode))
      die(`repository '${repository.id}' mode must be read|write`);
    if (!Array.isArray(repository.dependsOn) ||
        repository.dependsOn.some((item) => typeof item !== "string"))
      die(`repository '${repository.id}' dependsOn must be an array`);
    const absolute = canonicalPath(resolve(ROOT, repository.path || ""));
    if (!pathInside(ROOT, absolute) && repository.allowOutsideRoot !== true)
      die(`repository '${repository.id}' path escapes the control root; set allowOutsideRoot only for an explicitly trusted sibling repository`);
    const normalized = relative(ROOT, absolute) || ".";
    if (paths.has(normalized))
      die(`duplicate repository path '${normalized}'`);
    paths.add(normalized);
    repository.path = absolute;
    repository.relativePath = normalized.replaceAll("\\", "/");
  }
  for (const repository of rows)
    for (const dependency of repository.dependsOn)
      if (!ids.has(dependency))
        die(`repository '${repository.id}' depends on unknown repository '${dependency}'`);
  const drift = discovered.filter((repository) =>
    !configuredByPath.has(repository.path) && !configuredIds.has(repository.id));
  return { version: 1, repositories: rows, discovered, drift };
}

function changeRepositorySelection(id) {
  const path = join(activeChangePath(id), "repositories.yaml");
  if (!existsSync(path)) return null;
  const value = readJson(path);
  if (value.version !== 1 || !Array.isArray(value.repositories) ||
      value.repositories.length === 0)
    die(`${id}/repositories.yaml requires version 1 and a non-empty repositories array`);
  return value;
}

function repositorySelectionIdsAt(dir) {
  const path = join(dir, "repositories.yaml");
  if (!existsSync(path)) return ["root"];
  const value = readJson(path);
  if (value.version !== 1 || !Array.isArray(value.repositories))
    die(`${relative(ROOT, path)} requires version 1 and a repositories array`);
  return value.repositories.map((entry) =>
    typeof entry === "string" ? entry : entry.id).sort();
}

function selectedRepositories(id, state = loadRuntime(id)) {
  const catalog = repositoryCatalog();
  const selection = changeRepositorySelection(id);
  const requested = selection?.repositories || [{ id: "root", mode: "write" }];
  const selected = [];
  const seen = new Set();
  for (const entry of requested) {
    const normalized = typeof entry === "string" ? { id: entry } : entry;
    const repository = catalog.repositories.find((item) => item.id === normalized.id);
    if (!repository) die(`${id}/repositories.yaml references unknown repository '${normalized.id}'`);
    if (seen.has(repository.id)) die(`${id}/repositories.yaml repeats '${repository.id}'`);
    seen.add(repository.id);
    const runtime = state.repositories?.[repository.id] || {};
    selected.push({
      ...repository,
      mode: normalized.mode || repository.mode,
      dependsOn: normalized.dependsOn || repository.dependsOn || [],
      baseHead: runtime.baseHead || gitHead(repository.path),
      workspacePath: canonicalPath(runtime.path || (repository.id === "root"
        ? state.workspace?.path || ROOT : repository.path))
    });
  }
  const selectedIds = new Set(selected.map((repository) => repository.id));
  for (const repository of selected)
    for (const dependency of repository.dependsOn)
      if (!selectedIds.has(dependency))
        die(`change '${id}' must select dependency '${dependency}' for repository '${repository.id}'`);
  return selected;
}

function repositoryById(id, repositoryId, state = loadRuntime(id)) {
  const repository = selectedRepositories(id, state)
    .find((item) => item.id === repositoryId);
  if (!repository) die(`change '${id}' does not select repository '${repositoryId}'`);
  return repository;
}

function showRepositories(id = null) {
  const catalog = repositoryCatalog();
  const selected = id
    ? new Set(selectedRepositories(id).map((repository) => repository.id))
    : null;
  for (const repository of catalog.repositories) {
    const head = gitHead(repository.path);
    const status = head ? git(["status", "--porcelain"], repository.path) : null;
    const state = !existsSync(repository.path) ? "missing" :
      !head ? "not-git" : status?.stdout.trim() ? "dirty" : "clean";
    console.log([
      repository.id, repository.type, repository.relativePath, state,
      head?.slice(0, 12) || "-", selected ? (selected.has(repository.id) ? "selected" : "excluded") : ""
    ].filter(Boolean).join("\t"));
  }
  for (const repository of catalog.drift)
    console.error(`WARNING: unregistered submodule '${repository.path}'`);
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
  if (flags["acceptance-required"] && flags["acceptance-not-required"])
    die("resolve cannot combine --acceptance-required and --acceptance-not-required");
  if ((flags["acceptance-reason"] || flags["acceptance-claims"]) &&
      !flags["acceptance-required"])
    die("--acceptance-reason and --acceptance-claims require --acceptance-required");
  if (flags["acceptance-required"]) {
    const reason = String(flags["acceptance-reason"] || "").trim();
    if (!reason) die("--acceptance-required requires --acceptance-reason");
      state.acceptance = {
        version: 2,
      required: true,
      reason,
        claimIds: String(flags["acceptance-claims"] || "").split(",")
          .map((value) => value.trim()).filter(Boolean),
        scopeOrigin: "explicit",
        declaredAt: now()
    };
  } else if (flags["acceptance-not-required"]) {
    state.acceptance = { version: 2, required: false, reason: null, claimIds: [], declaredAt: null };
  }
  if (state.schema === "foundation-rapid" &&
      (state.impact !== "low" || state.coupling !== "isolated" || state.reviewRequired ||
       state.acceptance?.required)) {
    state.schema = "foundation-standard";
    state.upgradedFrom = "foundation-rapid";
  }
  saveRuntime(state);
  console.log(`RESOLVED ${id}\n  impact: ${state.impact}\n  coupling: ${state.coupling}\n  review: ${state.reviewRequired ? "required" : "not required"}\n  acceptance: ${state.acceptance?.required ? "required" : "not required"}\n  security: ${state.securityTriggers.join(", ") || "none"}`);
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
    const commandValid = Array.isArray(service?.command) &&
      service.command.length &&
      service.command.every((part) => typeof part === "string" && part);
    const staticRootValid = typeof service?.staticRoot === "string" &&
      service.staticRoot.trim() &&
      !isAbsolute(service.staticRoot) &&
      !service.staticRoot.split(/[\\/]+/).includes("..");
    if (!service || (!commandValid && !staticRootValid) ||
        (commandValid && staticRootValid))
      die(`service '${name}' requires exactly one of command or workspace-relative staticRoot`);
    if (!service.readiness?.url)
      die(`service '${name}' requires readiness.url`);
    if (staticRootValid) {
      let protocol;
      try { protocol = new URL(service.readiness.url).protocol; } catch {}
      if (protocol !== "http:")
        die(`service '${name}' staticRoot readiness.url must use http`);
    }
    if (!service.readiness.expectBody && !service.readiness.expectHeader)
      die(`service '${name}' readiness requires expectBody or expectHeader identity`);
    if (service.resources !== undefined &&
        (!Array.isArray(service.resources) ||
         service.resources.some((item) => typeof item !== "string" || !item)))
      die(`service '${name}' resources must be an array of strings`);
    if (service.repository !== undefined)
      repositoryById(id, service.repository);
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
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(provider))
      die(`invalid provider instance id '${provider}'`);
    if (!config || typeof config !== "object" || Array.isArray(config))
      die(`provider '${provider}' configuration must be an object`);
    const capability = providerCapability(provider, config);
    if (!capability || !PROVIDERS.has(capability))
      die(`provider '${provider}' requires a known capability`);
    if (!ADAPTERS.has(config.adapter))
      die(`provider '${provider}' uses unknown adapter '${config.adapter || ""}'`);
    if (config.repository !== undefined)
      repositoryById(id, config.repository);
    if (config.adapter !== "external" &&
        (!Array.isArray(config.command) || config.command.length === 0 ||
         config.command.some((part) => typeof part !== "string" || !part)))
      die(`provider '${provider}' adapter '${config.adapter}' requires a non-empty command array`);
    if (config.adapter === "test-discovery" && capability !== "test")
      die("test-discovery adapter requires capability 'test'");
    if (config.adapter === "test-discovery" && provider !== "test") {
      if (!config.discoveryProvider ||
          !configuredProviders[config.discoveryProvider] ||
          providerCapability(
            config.discoveryProvider, configuredProviders[config.discoveryProvider]
          ) !== "discovery")
        die(`provider '${provider}' test-discovery requires a configured discoveryProvider`);
    }
    if (config.timeoutMs !== undefined &&
        (!Number.isFinite(Number(config.timeoutMs)) || Number(config.timeoutMs) <= 0))
      die(`provider '${provider}' timeoutMs must be a positive number`);
    if (config.resources !== undefined &&
        (!Array.isArray(config.resources) ||
         config.resources.some((item) => typeof item !== "string" || !item)))
      die(`provider '${provider}' resources must be an array of strings`);
    if (config.inputs !== undefined &&
        (!Array.isArray(config.inputs) || config.inputs.length === 0 ||
         config.inputs.some((item) => typeof item !== "string" || !item ||
           isAbsolute(item) || item.split(/[\\/]/).includes(".."))))
      die(`provider '${provider}' inputs must be non-empty workspace-relative paths`);
    if (["review", "acceptance"].includes(capability) && config.inputs !== undefined)
      die(`${capability} capability cannot declare reusable inputs; it is bound to the full workspace`);
    if (config.reportFormat !== undefined &&
        !["json", "tap", "auto"].includes(config.reportFormat))
      die(`provider '${provider}' reportFormat must be json|tap|auto`);
    if (config.resultProtocol !== undefined &&
        config.resultProtocol !== "foundation-mutation-v1")
      die(`provider '${provider}' resultProtocol must be foundation-mutation-v1`);
    if (config.dependsOn !== undefined &&
        (!Array.isArray(config.dependsOn) ||
         config.dependsOn.some((item) =>
           !configuredProviders[item] && !PROVIDERS.has(item))))
      die(`provider '${provider}' dependsOn contains an unknown provider`);
    if (config.dependsOn?.includes(provider))
      die(`provider '${provider}' cannot depend on itself`);
    if (config.outputs !== undefined &&
        (!Array.isArray(config.outputs) ||
         config.outputs.some((item) =>
           !configuredProviders[item] && !PROVIDERS.has(item))))
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
    if (capability === "browser" && config.adapter !== "external" &&
        !INPUT_MODES.has(config.inputMode || (config.adapter === "playwright" ? "browser-automation" : "")))
      die("configured browser provider requires a valid inputMode");
    if (capability === "mutation" && config.adapter !== "external" &&
        !["behavioral-kill", "test-failure"].includes(config.classification))
      die("configured mutation provider requires classification behavioral-kill|test-failure");
    if (capability === "review" && config.adapter !== "external")
      die("review capability requires an external provider");
    if (capability === "acceptance" && config.adapter !== "external")
      die("acceptance capability requires an external human provider");
    const declaredForProvider = (capability === "review"
      ? scopedReviewClaims(value.claims)
      : value.claims.filter((claim) =>
      claim.capabilities.includes(capability) ||
      (capability === "discovery" && claim.capabilities.includes("test"))))
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

function providerRepository(id, provider, config = providerConfig(id, provider)) {
  const repositoryId = config?.repository || null;
  if (!repositoryId) return null;
  return repositoryById(id, repositoryId);
}

function providerWorkspace(id, provider, config = providerConfig(id, provider)) {
  return canonicalPath(providerRepository(id, provider, config)?.workspacePath ||
    loadRuntime(id).workspace?.path || ROOT);
}

function providerWorkspaceHash(id, provider, fallback = null) {
  const repository = providerRepository(id, provider);
  if (!repository) return fallback || relevantHash(id);
  const snapshot = relevantSnapshot(id);
  return snapshot.repositories?.[repository.id]?.workspaceHash ||
    singleRelevantSnapshot(id, repository.workspacePath, true).workspaceHash;
}

function providerInputIdentity(id, provider, config = providerConfig(id, provider),
    globalHash = null) {
  const workspace = canonicalPath(providerWorkspace(id, provider, config));
  if (!Array.isArray(config?.inputs) || config.inputs.length === 0) {
    const workspaceHash = globalHash || providerWorkspaceHash(id, provider);
    return {
      mode: "global",
      patterns: [],
      files: [],
      fingerprint: stableHash({ mode: "global", workspaceHash })
    };
  }
  const patterns = [...new Set(config.inputs.map((item) =>
    item.replaceAll("\\", "/").replace(/^\.\/+/, "")))].sort();
  const matches = (rel, pattern) => {
    if (pattern.endsWith("/**"))
      return rel === pattern.slice(0, -3) || rel.startsWith(pattern.slice(0, -2));
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -1);
      return rel.startsWith(prefix) && !rel.slice(prefix.length).includes("/");
    }
    return rel === pattern || rel.startsWith(`${pattern.replace(/\/$/, "")}/`);
  };
  const files = [];
  const collect = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED_WORKSPACE_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        collect(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(workspace, path).replaceAll("\\", "/");
      if (patterns.some((pattern) => matches(rel, pattern)))
        files.push({ path: rel, sha256: fileDigest(path) });
    }
  };
  collect(workspace);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    mode: "declared",
    patterns,
    files,
    fingerprint: stableHash({ mode: "declared", patterns, files })
  };
}

function environmentDescriptor(config = null, id = null) {
  const workspace = id && config?.repository
    ? repositoryById(id, config.repository).workspacePath
    : (id ? loadRuntime(id).workspace?.path || ROOT : ROOT);
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
    capability: providerCapability(provider, config),
    repository: config?.repository || null,
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
    reviewPolicy: reviewPolicy(id, state, contract),
    acceptance: resolvedAcceptance(id, state, contract),
    claims: contract.claims,
    invariants: contract.invariants || []
  });
}

function normalizedAcceptance(state) {
  const value = state.acceptance || {};
  return {
    version: Number(value.version || 1),
    required: Boolean(value.required),
    reason: value.required ? String(value.reason || "").trim() || null : null,
    claimIds: value.required ? [...new Set(value.claimIds || [])].sort() : [],
    scopeOrigin: value.scopeOrigin || null
  };
}

function resolvedAcceptance(id, state = loadRuntime(id), contract = evidence(id)) {
  const normalized = normalizedAcceptance(state);
  const declared = contract.claims.filter((claim) =>
    claim.capabilities.includes("acceptance")).map((claim) => claim.id);
  const claimIds = [...new Set([...normalized.claimIds, ...declared])].sort();
  return {
    ...normalized,
    required: normalized.required || declared.length > 0,
    claimIds,
    scopeOrigin: normalized.scopeOrigin || (declared.length ? "claim-capability" : null)
  };
}

function reviewPolicy(id, state = loadRuntime(id), contract = evidence(id)) {
  const capabilities = new Set([
    ...(state.evidenceCapabilities || []),
    ...contract.claims.flatMap((claim) => claim.capabilities || []),
    ...policyCapabilities(id)
  ]);
  const semantic = `${state.intent || ""} ${(state.securityTriggers || []).join(" ")}`.toLowerCase();
  const requiredTriggers = [];
  const diversityTriggers = [];
  const riskClaims = contract.claims.filter((claim) => claim.impact !== "low");
  const requiredCapabilities = [
    "review", "security-static", "data-migration", "compatibility",
    "cross-repo-contract", "state-identity"
  ];
  if (riskClaims.some((claim) =>
    claim.capabilities.some((capability) => requiredCapabilities.includes(capability))))
    requiredTriggers.push("risk-capability");
  if (riskClaims.some((claim) => (claim.repositories || []).length > 1))
    requiredTriggers.push("multi-repository-claim");
  if (/\b(concurren|race|deadlock|money|payment|billing|financial|migration|irreversible)\w*\b/.test(semantic))
    requiredTriggers.push("risk-semantics");
  if ((state.securityTriggers || []).length ||
      ["security-static", "data-migration", "compatibility"].some((value) => capabilities.has(value)))
    diversityTriggers.push("critical-capability");
  if (/\b(money|payment|billing|financial|migration|irreversible)\b/.test(semantic))
    diversityTriggers.push("critical-semantics");
  const triggers = [...new Set([...requiredTriggers, ...diversityTriggers])].sort();
  return {
    required: Boolean(state.reviewRequired || requiredTriggers.length || capabilities.has("review")),
    independence: "required",
    diversity: diversityTriggers.length ? "required" : "preferred",
    triggers
  };
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

function taskMetadata(task) {
  const value = task.text;
  const list = (name) => {
    const match = value.match(new RegExp(`\\[${name}:([^\\]]+)\\]`, "i"));
    return match ? match[1].split(",").map((item) => item.trim()).filter(Boolean) : [];
  };
  return {
    id: task.id,
    done: task.done,
    repository: list("repo")[0] || "root",
    kind: list("kind")[0] || "implementation",
    requestedModel: list("model")[0] || null,
    dependsOn: list("depends").map((item) => item.toUpperCase()),
    paths: list("paths"),
    resources: list("resources"),
    claims: list("claims"),
    text: value.replace(/\s+/g, " ").trim().slice(0, 1000)
  };
}

function modelForTask(id, task, policy = foundationPolicy()) {
  const state = loadRuntime(id);
  const highRisk = state.impact === "high" ||
    (state.securityTriggers || []).length > 0 ||
    ["contract", "architecture", "security", "migration", "review"]
      .includes(task.kind);
  let tier = task.requestedModel;
  if (tier && !["fast", "standard", "deep"].includes(tier))
    die(`task '${task.id}' model must be fast|standard|deep`);
  if (!tier) {
    if (highRisk && ["contract", "architecture", "security", "migration", "review"]
      .includes(task.kind)) tier = "deep";
    else if (!highRisk && ["inventory", "logs", "mechanical-docs"].includes(task.kind))
      tier = "fast";
    else tier = "standard";
  }
  if (tier === "fast" && highRisk) tier = "standard";
  const fallbackTier = policy.models[tier].fallbackTier ?? null;
  return {
    tier, family: policy.models[tier].family,
    fallbackTier,
    fallbackFamily: fallbackTier ? policy.models[fallbackTier].family : null,
    reason: highRisk ? "risk-sensitive task" : `${task.kind} task`
  };
}

function activeRepositoryConflicts(id, repositories) {
  const wanted = new Set(repositories
    .filter((repository) => repository.mode === "write")
    .map((repository) => repository.id));
  const conflicts = [];
  if (!existsSync(RUNTIME)) return conflicts;
  for (const entry of readdirSync(RUNTIME, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const other = readJson(join(RUNTIME, entry.name), {});
    if (!other.id || other.id === id || other.status === "archived") continue;
    let selected;
    try { selected = selectedRepositories(other.id, other); }
    catch { continue; }
    for (const repository of selected)
      if (repository.mode === "write" && wanted.has(repository.id))
        conflicts.push({ changeId: other.id, repository: repository.id, status: other.status });
  }
  return conflicts;
}

function agentPlanValue(id) {
  validate(id, "active", { quiet: true });
  const state = loadRuntime(id);
  const policy = foundationPolicy();
  const repositories = selectedRepositories(id, state);
  const repositoryMap = new Map(repositories.map((repository) =>
    [repository.id, repository]));
  const allTasks = taskBlocks(readFileSync(join(activeChangePath(id), "tasks.md"), "utf8"))
    .map(taskMetadata);
  const tasks = allTasks.filter((task) => !task.done);
  const ids = new Set(allTasks.map((task) => task.id));
  const completed = new Set(allTasks.filter((task) => task.done)
    .map((task) => task.id));
  for (const task of tasks) {
    if (!repositoryMap.has(task.repository))
      die(`task '${task.id}' references unselected repository '${task.repository}'`);
    const unknown = task.dependsOn.filter((dependency) => !ids.has(dependency));
    if (unknown.length)
      die(`task '${task.id}' depends on unknown task(s): ${unknown.join(", ")}`);
    const repository = repositoryMap.get(task.repository);
    for (const dependencyRepository of repository.dependsOn || [])
      for (const dependencyTask of tasks.filter((candidate) =>
        candidate.repository === dependencyRepository))
        if (!task.dependsOn.includes(dependencyTask.id))
          task.dependsOn.push(dependencyTask.id);
    task.resources = [...new Set([
      `workspace:${task.repository}`, ...task.resources
    ])].sort();
    task.model = modelForTask(id, task, policy);
    task.packetCommand = `claude-foundation agents task ${id} ${task.id}`;
  }
  const pending = new Map(tasks.map((task) => [task.id, task]));
  const groups = [];
  while (pending.size) {
    const ready = [...pending.values()].filter((task) =>
      task.dependsOn.every((dependency) => completed.has(dependency)));
    if (!ready.length)
      die(`task dependency cycle: ${[...pending.keys()].join(", ")}`);
    const group = [];
    for (const task of ready) {
      const conflicts = group.some((selected) =>
        resourcesConflict(selected.resources, task.resources));
      if (!conflicts && group.length < policy.execution.maxParallelAgents)
        group.push(task);
    }
    if (!group.length) group.push(ready[0]);
    groups.push(group.map((task) => task.id));
    for (const task of group) {
      pending.delete(task.id);
      completed.add(task.id);
    }
  }
  const claims = evidence(id).claims;
  const singleAgent = tasks.length > 0 &&
    repositories.length === 1 && tasks.length <= 2 &&
    !claims.some((claim) => (claim.repositories || []).length > 1) &&
    !tasks.some((task) => task.resources.some((resource) =>
      !resource.startsWith("workspace:")));
  const tierRank = { fast: 0, standard: 1, deep: 2 };
  const sessionTask = tasks.reduce((highest, task) =>
    !highest || tierRank[task.model.tier] > tierRank[highest.model.tier]
      ? task : highest, null);
  const conflicts = activeRepositoryConflicts(id, repositories);
  const blockingReasons = [
    ...(state.ambiguity === "unclear" ? ["ambiguity requires /investigate"] : []),
    ...conflicts.map((conflict) =>
      `repository ${conflict.repository} is active in ${conflict.changeId}`)
  ];
  const basePlan = {
    version: Number(AGENT_PLAN_SCHEMA_VERSION),
    changeId: id,
    revision: Number(state.revision || 0),
    contractRevision: Number(state.contractRevision || 0),
    workspaceHash: relevantHash(id),
    maxParallelAgents: policy.execution.maxParallelAgents,
    repositories: repositories.map((repository) => ({
      id: repository.id, mode: repository.mode,
      workspacePath: repository.workspacePath,
      dependsOn: repository.dependsOn || []
    })),
    tasks,
    groups,
    recommendedExecution: tasks.length === 0
      ? "proof-ready" : singleAgent ? "single-agent" : "planned-agents",
    sessionModel: singleAgent ? sessionTask.model : null,
    executionReason: tasks.length === 0
      ? "all implementation tasks are complete"
      : singleAgent
        ? `one repository; highest required tier is ${sessionTask.model.tier}`
        : "independent dependency/resource groups require planned dispatch",
    conflicts,
    blockingReasons,
    dispatchable: blockingReasons.length === 0,
    contractFingerprint: contractFingerprint(id),
    repositoryContractHashes: Object.fromEntries(repositories.map((repository) => [
      repository.id,
      stableHash(claims.filter((claim) =>
        !claim.repositories || claim.repositories.includes(repository.id)))
    ])),
    modelPolicy: {
      fast: policy.models.fast.family,
      standard: policy.models.standard.family,
      deep: policy.models.deep.family
    }
  };
  return { ...basePlan, planDigest: stableHash(basePlan), createdAt: now() };
}

function showAgentPlan(id, flags = {}) {
  const plan = agentPlanValue(id);
  const path = join(PLANS, `${id}.json`);
  const prior = existsSync(path) ? readJson(path, {}) : null;
  const changedRepositories = prior
    ? Object.keys(plan.repositoryContractHashes).filter((repository) =>
      prior.repositoryContractHashes?.[repository] !==
        plan.repositoryContractHashes[repository])
    : [];
  const globalContractChanged = Boolean(prior &&
    prior.contractFingerprint !== plan.contractFingerprint &&
    changedRepositories.length === 0);
  const directlyInvalidated = new Set(prior
    ? plan.tasks.filter((task) => {
      const old = prior.tasks?.find((candidate) => candidate.id === task.id);
      return !old || globalContractChanged ||
        changedRepositories.includes(task.repository) ||
        stableHash({
          repository: old.repository, kind: old.kind, dependsOn: old.dependsOn,
          paths: old.paths, resources: old.resources, text: old.text
        }) !== stableHash({
          repository: task.repository, kind: task.kind, dependsOn: task.dependsOn,
          paths: task.paths, resources: task.resources, text: task.text
        });
    }).map((task) => task.id)
    : []);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const task of plan.tasks)
      if (!directlyInvalidated.has(task.id) &&
          task.dependsOn.some((dependency) => directlyInvalidated.has(dependency))) {
        directlyInvalidated.add(task.id);
        expanded = true;
      }
  }
  const output = {
    ...plan,
    supersedesPlanDigest: prior?.planDigest || null,
    invalidatedTasks: [...directlyInvalidated],
    preservedTasks: prior
      ? plan.tasks.filter((task) => !directlyInvalidated.has(task.id))
        .map((task) => task.id)
      : []
  };
  writeJson(path, output);
  let visible;
  let view = "summary";
  if (flags.full) {
    visible = output;
    view = "full";
  } else if (flags.group !== undefined) {
    const groupNumber = Number(flags.group);
    if (!Number.isInteger(groupNumber) || groupNumber < 1 ||
        groupNumber > output.groups.length)
      die(`agents plan --group must be 1..${output.groups.length}`);
    const ids = output.groups[groupNumber - 1];
    visible = {
      version: 1, changeId: id, planDigest: output.planDigest,
      group: groupNumber,
      tasks: output.tasks.filter((task) => ids.includes(task.id)).map((task) => ({
        id: task.id, repository: task.repository, kind: task.kind,
        model: task.model, dependsOn: task.dependsOn,
        resources: task.resources, packetCommand: task.packetCommand
      }))
    };
    view = "group";
  } else {
    const modelCounts = output.tasks.reduce((counts, task) => {
      counts[task.model.family] = (counts[task.model.family] || 0) + 1;
      return counts;
    }, {});
    const groupSummaries = output.groups.map((ids, index) => ({
      group: index + 1,
      taskCount: ids.length,
      taskIds: ids.length <= 12 ? ids : null,
      taskDigest: ids.length > 12 ? stableHash(ids) : null
    }));
    visible = {
      version: Number(AGENT_PLAN_SCHEMA_VERSION),
      changeId: id,
      planDigest: output.planDigest,
      planPath: relative(ROOT, path).replaceAll("\\", "/"),
      dispatchable: output.dispatchable,
      blockingReasons: compactStrings(output.blockingReasons, 10),
      recommendedExecution: output.recommendedExecution,
      sessionModel: output.sessionModel,
      executionReason: output.executionReason,
      repositoryCount: output.repositories.length,
      repositories: compactStrings(
        output.repositories.map((repository) => repository.id), 20),
      taskCount: output.tasks.length,
      modelCounts,
      groupCount: groupSummaries.length,
      groups: groupSummaries.length <= 20 ? groupSummaries : {
        preview: groupSummaries.slice(0, 10),
        count: groupSummaries.length,
        digest: stableHash(groupSummaries)
      },
      invalidatedTasks: output.invalidatedTasks.length <= 20
        ? output.invalidatedTasks : {
          count: output.invalidatedTasks.length,
          digest: stableHash(output.invalidatedTasks)
        },
      next: !output.dispatchable
        ? "resolve blockingReasons before dispatch"
        : output.recommendedExecution === "proof-ready"
          ? `claude-foundation proof readiness ${id}`
          : output.recommendedExecution === "single-agent"
            ? `claude-foundation agents task ${id} ${output.tasks[0].id}`
            : `claude-foundation agents plan ${id} --group 1`
    };
  }
  visible.version = Number(AGENT_PLAN_SCHEMA_VERSION);
  const encoded = serializedJson(visible, Boolean(flags.pretty));
  const limit = view === "summary"
    ? Number(foundationPolicy().execution.planSummaryBytes)
    : Number(foundationPolicy().execution.packetBytes.repository);
  if (Buffer.byteLength(encoded) > limit)
    die(`agent ${view} exceeds ${limit} bytes; inspect the persisted plan by digest`);
  recordContextMetric(id, `agent-plan-${view}`, Buffer.byteLength(encoded), {
    tasks: output.tasks.length, repositories: output.repositories.length
  });
  process.stdout.write(encoded);
}

function showAgentTask(id, taskId, flags = {}) {
  const plan = agentPlanValue(id);
  if (!plan.dispatchable)
    die(`change '${id}' is not dispatchable: ${plan.blockingReasons.join("; ")}`);
  const task = plan.tasks.find((candidate) => candidate.id === String(taskId || "").toUpperCase());
  if (!task) die(`unknown pending task '${taskId || ""}'`);
  showPacket(id, {
    repo: task.repository, task: task.id,
    pretty: flags.pretty, planDigest: plan.planDigest
  });
}

function leasePath(resource) {
  return join(LEASES, "resources", `${stableHash(resource)}.json`);
}

function acquireAgentLease(id, taskId, flags) {
  const owner = flags.owner;
  if (!taskId || !owner || !/^[a-zA-Z0-9._-]+$/.test(owner))
    die("agents acquire requires <change> <task> --owner <agent-id>");
  const plan = agentPlanValue(id);
  if (!plan.dispatchable)
    die(`change '${id}' conflicts with active repository work`);
  const task = plan.tasks.find((candidate) => candidate.id === taskId.toUpperCase());
  if (!task) die(`unknown pending task '${taskId}'`);
  const pendingIds = new Set(plan.tasks.map((candidate) => candidate.id));
  const blockedBy = task.dependsOn.filter((dependency) => pendingIds.has(dependency));
  if (blockedBy.length)
    die(`task '${task.id}' is blocked by pending task(s): ${blockedBy.join(", ")}`);
  const durationMs = Number(foundationPolicy().execution.leaseMinutes) * 60 * 1000;
  const expiresAt = new Date(Date.now() + durationMs).toISOString();
  const acquired = [];
  const created = [];
  try {
    for (const resource of task.resources) {
      const path = leasePath(resource);
      mkdirSync(dirname(path), { recursive: true });
      if (existsSync(path)) {
        const current = readJson(path, {});
        if (Date.parse(current.expiresAt || "") <= Date.now()) rmSync(path);
        else if (current.changeId === id && current.taskId === task.id &&
                 current.owner === owner) {
          writeJson(path, { ...current, expiresAt, renewedAt: now() });
          acquired.push(path);
          continue;
        } else {
          throw new Error(`resource '${resource}' is leased by ${current.changeId || "unknown"}/${current.taskId || "unknown"}`);
        }
      }
      const descriptor = {
        version: 1, resource, changeId: id, taskId: task.id, owner,
        planDigest: plan.planDigest, acquiredAt: now(), expiresAt
      };
      const handle = openSync(path, "wx");
      try { writeFileSync(handle, `${JSON.stringify(descriptor, null, 2)}\n`); }
      finally { closeSync(handle); }
      acquired.push(path);
      created.push(path);
    }
  } catch (error) {
    for (const path of created) {
      if (!existsSync(path)) continue;
      const current = readJson(path, {});
      if (current.changeId === id && current.taskId === task.id &&
          current.owner === owner) rmSync(path);
    }
    die(error.message);
  }
  writeJson(join(LEASES, "tasks", id, `${task.id}.json`), {
    version: 1, changeId: id, taskId: task.id, owner,
    resources: task.resources, planDigest: plan.planDigest, expiresAt
  });
  console.log(`LEASE ACQUIRED ${id}/${task.id}\n  owner: ${owner}\n  expires: ${expiresAt}`);
}

function releaseAgentLease(id, taskId, flags) {
  const owner = flags.owner;
  if (!taskId || !owner)
    die("agents release requires <change> <task> --owner <agent-id>");
  const index = join(LEASES, "tasks", id, `${taskId.toUpperCase()}.json`);
  if (!existsSync(index)) {
    console.log(`LEASE ABSENT ${id}/${taskId.toUpperCase()}`);
    return;
  }
  const taskLease = readJson(index);
  if (taskLease.owner !== owner)
    die(`lease owner mismatch for '${id}/${taskId.toUpperCase()}'`);
  for (const resource of taskLease.resources || []) {
    const path = leasePath(resource);
    if (!existsSync(path)) continue;
    const current = readJson(path, {});
    if (current.changeId === id && current.taskId === taskLease.taskId &&
        current.owner === owner) rmSync(path);
  }
  rmSync(index);
  console.log(`LEASE RELEASED ${id}/${taskLease.taskId}`);
}

function activeChangeLeases(id) {
  const root = join(LEASES, "tasks", id);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => readJson(join(root, entry.name), {}))
    .filter((lease) => Date.parse(lease.expiresAt || "") > Date.now());
}

function cleanupChangeLeases(id) {
  const resources = join(LEASES, "resources");
  if (existsSync(resources))
    for (const entry of readdirSync(resources, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const path = join(resources, entry.name);
      if (readJson(path, {}).changeId === id) rmSync(path);
    }
  const tasks = join(LEASES, "tasks", id);
  if (existsSync(tasks)) rmSync(tasks, { recursive: true });
}

function validate(id, source = "root", options = {}) {
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
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const selectedRepositoryIds = new Set(selectedRepositories(id, state)
    .map((repository) => repository.id));
  for (const claim of claims) {
    if (!["low", "medium", "high"].includes(claim.impact || ""))
      die(`claim '${claim.id}' requires impact low|medium|high`);
    if (claim.repositories !== undefined &&
        (!Array.isArray(claim.repositories) || claim.repositories.length === 0 ||
         claim.repositories.some((repository) => !selectedRepositoryIds.has(repository))))
      die(`claim '${claim.id}' repositories must reference selected repositories`);
    if ((claim.repositories || []).length > 1 &&
        !claim.capabilities.includes("cross-repo-contract"))
      die(`claim '${claim.id}' spans repositories and requires cross-repo-contract`);
  }
  let acceptance = resolvedAcceptance(id, state, { claims });
  const unknownAcceptanceClaims = acceptance.claimIds.filter((claim) => !claimById.has(claim));
  if (unknownAcceptanceClaims.length)
    die(`acceptance references unknown claim(s): ${unknownAcceptanceClaims.join(", ")}`);
  if (acceptance.required && acceptance.claimIds.length === 0) {
    if (acceptance.version < 2) {
      acceptance = { ...acceptance, claimIds: claims.map((claim) => claim.id), scopeOrigin: "legacy-all" };
      console.error("WARNING: migrated legacy acceptance scope to all current claims");
    } else {
      die("required acceptance needs --acceptance-claims or claims declaring capability 'acceptance'");
    }
  }
  if (acceptance.required) {
    state.acceptance = {
      version: 2,
      required: true,
      reason: acceptance.reason || "declared evidence capability",
      claimIds: acceptance.claimIds,
      scopeOrigin: acceptance.scopeOrigin || "explicit",
      declaredAt: state.acceptance?.declaredAt || now()
    };
  }
  for (const task of parsedTasks) {
    const metadata = taskMetadata(task);
    if (metadata.claims.length > 50)
      die(`task '${task.id}' references more than 50 claims`);
    const unknownClaims = metadata.claims.filter((claim) => !claimById.has(claim));
    if (unknownClaims.length)
      die(`task '${task.id}' references unknown claim(s): ${unknownClaims.join(", ")}`);
    const outOfScopeClaims = metadata.claims.filter((claimId) => {
      const repositories = claimById.get(claimId)?.repositories || [];
      return repositories.length > 0 && !repositories.includes(metadata.repository);
    });
    if (outOfScopeClaims.length)
      die(`task '${task.id}' references claim(s) outside repository '${metadata.repository}': ${outOfScopeClaims.join(", ")}`);
  }
  const selected = selectedRepositories(id, state);
  if (selected.length > 1) {
    const unscopedTasks = parsedTasks.filter((task) =>
      !/\[repo:[a-z0-9-]+\]/i.test(task.text));
    if (unscopedTasks.length)
      die(`multi-repository tasks require [repo:<id>] scope (${unscopedTasks.map((task) => task.id).join(", ")})`);
    for (const task of parsedTasks) {
      const metadata = taskMetadata(task);
      const repository = metadata.repository;
      if (repository && !selectedRepositoryIds.has(repository))
        die(`task '${task.id}' references unselected repository '${repository}'`);
      if (metadata.paths.some((path) =>
        isAbsolute(path) || path === ".." || path.startsWith("../") ||
        path.includes("/../")))
        die(`task '${task.id}' contains an unsafe path scope`);
      if (["implementation", "migration"].includes(metadata.kind) &&
          metadata.paths.length === 0)
        die(`multi-repository task '${task.id}' requires [paths:<repo-relative-paths>]`);
    }
  }
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
  if (!options.quiet)
    console.log(`VALID ${id} (${state.schema}, ${claims.length} claims)`);
}

function requiredProviders(id) {
  const state = loadRuntime(id);
  const contract = evidence(id);
  const providers = contract.providers || {};
  const required = new Set();
  const addCapability = (capability, repositories = []) => {
    const instances = Object.entries(providers).filter(([provider, config]) => {
      if (providerCapability(provider, config) !== capability) return false;
      if (!config.repository || repositories.length === 0) return true;
      return repositories.includes(config.repository);
    }).map(([provider]) => provider);
    if (instances.length) instances.forEach((provider) => required.add(provider));
    else required.add(capability);
  };
  for (const claim of contract.claims) {
    for (const capability of claim.capabilities) {
      addCapability(capability, claim.repositories || []);
      if (capability === "test")
        addCapability("discovery", claim.repositories || []);
    }
  }
  if (reviewPolicy(id, state, contract).required) addCapability("review");
  if (resolvedAcceptance(id, state, contract).required) addCapability("acceptance");
  for (const capability of policyCapabilities(id)) addCapability(capability);
  return [...required].sort();
}

function claimsForProvider(id, provider) {
  const claims = evidence(id).claims;
  const config = providerConfig(id, provider);
  const capability = providerCapability(provider, config);
  let scoped = capability === "review" ? scopedReviewClaims(claims) :
    capability === "acceptance" ? (() => {
      const ids = resolvedAcceptance(id, loadRuntime(id), evidence(id)).claimIds;
      return claims.filter((claim) => ids.includes(claim.id));
    })() :
    policyCapabilities(id).includes(capability) ? claims :
      claims.filter((claim) =>
        claim.capabilities.includes(capability) ||
        (capability === "discovery" && claim.capabilities.includes("test")));
  if (config?.repository)
    scoped = scoped.filter((claim) =>
      !claim.repositories || claim.repositories.includes(config.repository));
  return scoped;
}

function pathInside(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function decodedEvidencePath(value) {
  const text = String(value || "").trim();
  try { return decodeURIComponent(text); }
  catch { return text; }
}

function evidenceInputTargetsPrototype(value, workspace) {
  let decoded = decodedEvidencePath(value);
  if (!decoded) return false;
  const slashPath = decoded.replaceAll("\\", "/").toLowerCase();
  if (/(^|\/)\.foundation\/prototypes(?:\/|$)/.test(slashPath)) return true;
  if (/^file:/i.test(decoded)) {
    try { decoded = fileURLToPath(decoded); }
    catch { return false; }
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(decoded)) {
    return false;
  }
  const roots = [...new Set([
    PROTOTYPES,
    join(workspace, ".foundation", "prototypes")
  ].map((path) => resolve(path)))];
  const candidates = isAbsolute(decoded)
    ? [resolve(decoded)]
    : [resolve(ROOT, decoded), resolve(workspace, decoded)];
  return candidates.some((candidate) => {
    if (roots.some((root) => pathInside(root, candidate))) return true;
    if (!existsSync(candidate)) return false;
    const realCandidate = realpathSync(candidate);
    return roots.some((root) => pathInside(root, realCandidate));
  });
}

function rejectPrototypeEvidenceInputs(id, provider, artifacts, references) {
  const workspace = canonicalPath(providerWorkspace(id, provider));
  const values = [
    ...artifacts.map((artifact) => artifact?.path),
    ...references
  ].filter(Boolean);
  const rejected = values.find((value) =>
    evidenceInputTargetsPrototype(value, workspace));
  if (rejected)
    die(`prototype artifacts and references are non-authoritative and cannot satisfy evidence: ${rejected}`);
}

function receiptPrototypeEvidence(id, provider, receipt) {
  const workspace = canonicalPath(providerWorkspace(id, provider));
  const values = [
    ...(receipt.references || []),
    ...(receipt.artifacts || []).flatMap((artifact) => [
      artifact?.path, artifact?.sourcePath
    ]),
    receipt.provenance?.source
  ].filter(Boolean);
  return values.find((value) => evidenceInputTargetsPrototype(value, workspace)) || null;
}

function durableArtifact(id, provider, proofRunId, artifact) {
  if (!artifact?.path || typeof artifact.path !== "string")
    die(`provider '${provider}' artifact requires a path`);
  const workspace = canonicalPath(providerWorkspace(id, provider));
  const projectCandidate = resolve(ROOT, artifact.path);
  const workspaceCandidate = resolve(workspace, artifact.path);
  const controlPlaneArtifact = ["command-log", "service-log"].includes(artifact.type) ||
    String(artifact.path).replaceAll("\\", "/").startsWith(".foundation/");
  const candidates = controlPlaneArtifact
    ? [projectCandidate, workspaceCandidate]
    : [workspaceCandidate, projectCandidate];
  const source = candidates.find((candidate) => existsSync(candidate)) || candidates[0];
  if (!existsSync(source)) {
    if (artifact.required === false) return { ...artifact, missing: true };
    die(`required artifact is missing: ${artifact.path}`);
  }
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
    sourcePath: pathInside(ROOT, realSource)
      ? relative(ROOT, realSource).replaceAll("\\", "/")
      : relative(workspace, realSource).replaceAll("\\", "/"),
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
  if (receiptPrototypeEvidence(id, provider, value))
    return { provider, validity: "prototype-evidence", status: value.status };
  if (value.contractFingerprint !== contractFingerprint(id))
    return { provider, validity: "contract-stale", status: value.status };
  const config = providerConfig(id, provider);
  const capability = providerCapability(provider, config);
  if (capability === "review") {
    if (String(value.reviewProtocolVersion || "") !== REVIEW_PROTOCOL_VERSION)
      return { provider, validity: "review-version-stale", status: value.status };
    const provenance = reviewProvenanceResult(value.review);
    if (!provenance.complete || !provenance.independent)
      return { provider, validity: "review-not-independent", status: value.status };
    const attemptDigest = String(value.review?.attemptDigest || "");
    const attemptDir = join(EVIDENCE_VAULT, id, "review-attempts");
    const attemptPath = attemptDigest && existsSync(attemptDir)
      ? readdirSync(attemptDir).find((name) => name.includes(attemptDigest.slice(0, 12))) : null;
    if (!attemptPath) return { provider, validity: "review-attempt-history-missing", status: value.status };
    const attempt = reviewAttemptByDigest(id, attemptDigest);
    const findings = value.review?.findings || {};
    const scope = value.review?.scope || {};
    const scopePaths = Array.isArray(scope.paths) ? scope.paths : [];
    const expectedScopeDigest = stableHash({
      priorWorkspaceHash: value.review?.supersedes?.workspaceHash || null,
      workspaceHash: value.workspaceHash, paths: scopePaths
    });
    if (!attempt || attempt.workspaceHash !== value.workspaceHash ||
        attempt.reviewerType !== value.review?.reviewer?.type ||
        attempt.reviewBinding !== reviewReceiptBinding(value) ||
        Number(value.review?.round) !== Number(attempt.attempt) ||
        ![findings.verified, findings.unresolvedBlockers]
          .every((count) => Number.isInteger(count) && count >= 0) ||
        (value.status === "pass" && findings.unresolvedBlockers !== 0) ||
        scope.digest !== expectedScopeDigest)
      return { provider, validity: "review-attempt-history-invalid", status: value.status };
    if (reviewPolicy(id).diversity === "required" && !provenance.diverse)
      return { provider, validity: "review-not-diverse", status: value.status };
    if (Number(value.review?.findings?.unresolvedBlockers || 0) > 0)
      return { provider, validity: "review-blockers", status: value.status };
  }
  if (capability === "acceptance") {
    if (String(value.acceptanceProtocolVersion || "") !== ACCEPTANCE_PROTOCOL_VERSION)
      return { provider, validity: "acceptance-version-stale", status: value.status };
    const currentAcceptance = resolvedAcceptance(id);
    const criteria = value.acceptance?.criteria;
    const actualClaims = Array.isArray(value.claims) ? [...value.claims].sort() : [];
    const expectedClaims = claimsForProvider(id, provider).map((claim) => claim.id).sort();
    if (value.acceptance?.actor?.type !== "human" ||
        !String(value.acceptance?.actor?.identity || "").trim() ||
        value.acceptance?.decision !== "accept" ||
        !Array.isArray(criteria) || criteria.length === 0 ||
        criteria.some((criterion) => !String(criterion).trim()) ||
        new Set(criteria.map((criterion) => String(criterion).trim())).size !== criteria.length ||
        stableHash(actualClaims) !== stableHash(expectedClaims) ||
        value.acceptance?.subjectWorkspaceHash !== value.workspaceHash ||
        value.acceptance?.reason !== currentAcceptance.reason)
      return { provider, validity: "acceptance-invalid", status: value.status };
  }
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
  const expectedWorkspaceHash = providerWorkspaceHash(id, provider, hash);
  const expectedInputs = providerInputIdentity(
    id, provider, config, expectedWorkspaceHash
  );
  let reusableInputs = false;
  if (value.workspaceHash !== expectedWorkspaceHash) {
    if (expectedInputs.mode === "declared" &&
        value.inputIdentity?.mode === "declared" &&
        value.inputIdentity.fingerprint === expectedInputs.fingerprint)
      reusableInputs = true;
    else return { provider, validity: "stale", status: value.status };
  }
  if (value.inputIdentity?.fingerprint !== expectedInputs.fingerprint)
    return { provider, validity: "provider-inputs-stale", status: value.status };
  if (value.status !== "pass") return { provider, validity: value.status };
  const requiredClaims = claimsForProvider(id, provider).map((claim) => claim.id);
  const covered = new Set(value.claims || []);
  if (requiredClaims.some((claim) => !covered.has(claim)))
    return { provider, validity: "incomplete-claims", status: value.status };
  const invalidArtifacts = (value.artifacts || []).filter((artifact) =>
    artifact.required !== false && !validateArtifact(artifact));
  if (invalidArtifacts.length)
    return { provider, validity: "invalid-artifacts", status: value.status };
  if ((value.adapter || "external") === "external" && value.status === "pass") {
    if (!String(value.observed || "").trim())
      return { provider, validity: "external-observation-missing", status: value.status };
    if (!String(value.provenance?.source || "").trim())
      return { provider, validity: "external-provenance-missing", status: value.status };
    if ((value.artifacts || []).length === 0 &&
        (value.references || []).length === 0)
      return { provider, validity: "external-evidence-missing", status: value.status };
  }
  return reusableInputs
    ? {
      provider, validity: "reusable-inputs", status: value.status,
      receipt: value, expectedWorkspaceHash, expectedInputs
    }
    : { provider, validity: "valid", receipt: value };
}

function proofPlan(id) {
  validate(id, "active", { quiet: true });
  const hash = relevantHash(id);
  const rows = requiredProviders(id).map((provider) => receiptValidity(id, provider, hash));
  console.log(`PROOF PLAN ${id}\n  workspace: ${hash}`);
  for (const row of rows) console.log(`  ${row.provider}: ${row.validity}`);
}

function rebindReusableReceipt(id, row, snapshot, proofRunId) {
  const prior = row.receipt;
  const rebound = {
    ...prior,
    workspaceHash: row.expectedWorkspaceHash,
    workspaceSnapshotId: snapshot.id,
    inputIdentity: row.expectedInputs,
    proofRunId,
    reusedFrom: {
      proofRunId: prior.proofRunId || null,
      workspaceHash: prior.workspaceHash,
      workspaceSnapshotId: prior.workspaceSnapshotId || null,
      receiptFinishedAt: prior.finishedAt || null
    },
    startedAt: now(),
    finishedAt: now()
  };
  writeJson(receiptPath(id, row.provider), rebound);
  const logPath = join(LOGS, id, "reuse.jsonl");
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify({
    version: 1,
    changeId: id,
    provider: row.provider,
    reason: "declared-inputs-unchanged",
    fromWorkspaceHash: prior.workspaceHash,
    toWorkspaceHash: row.expectedWorkspaceHash,
    inputFingerprint: row.expectedInputs.fingerprint,
    timestamp: now()
  })}\n`);
}

function topologyIssues(id) {
  const contract = evidence(id);
  const providers = contract.providers || {};
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
  const serviceResources = new Map();
  for (const [service, config] of Object.entries(contract.execution?.services || {})) {
    let port = null;
    try { port = new URL(config.readiness.url).port || null; } catch {}
    const resources = [...(config.resources || []), ...(port ? [`port:${port}`] : [])];
    for (const resource of resources) {
      const owner = serviceResources.get(resource);
      if (owner && owner !== service)
        issues.push(`service resource collision: ${resource} (${owner}, ${service})`);
      else serviceResources.set(resource, service);
    }
  }
  return issues;
}

function changedSurfaceIssues(id) {
  const state = loadRuntime(id);
  if (!state.repositories || Object.keys(state.repositories).length <= 1) return [];
  const tasks = taskBlocks(readFileSync(join(activeChangePath(id), "tasks.md"), "utf8"))
    .map(taskMetadata);
  const issues = [];
  const surface = canonicalChangedSurface(id, state);
  for (const repository of selectedRepositories(id, state)) {
    if (repository.mode !== "write") continue;
    const allowed = tasks.filter((task) => task.repository === repository.id)
      .flatMap((task) => task.paths);
    const changed = surface.filter((row) => row.repositoryId === repository.id)
      .map((row) => row.path);
    const outside = changed.filter((path) => !allowed.some((scope) => {
      const normalized = scope.replace(/\/\*\*?$/, "").replace(/\/$/, "");
      return scope === "*" || path === normalized || path.startsWith(`${normalized}/`);
    }));
    if (outside.length)
      issues.push(`repository '${repository.id}' changed outside task paths: ${outside.join(", ")}`);
  }
  return issues;
}

function proofReadinessValue(id, stage = "prove") {
  validate(id, "active", { quiet: true });
  const issues = topologyIssues(id);
  if (stage === "prove") issues.push(...changedSurfaceIssues(id));
  const hash = relevantHash(id);
  const { unconfigured, unavailable } = executionNodes(id, hash);
  const pending = pendingTasks(id);
  if (stage === "prove") {
    const leases = activeChangeLeases(id);
    if (leases.length)
      issues.push(`active agent leases: ${leases.map((lease) => lease.taskId).join(", ")}`);
  }
  const status = pending.length ? "NEEDS_CODE_CHANGE" :
    issues.length ? "CONFIGURATION_ERROR" :
    unavailable.length ? "INFRASTRUCTURE_ERROR" :
    unconfigured.length ? "NEEDS_EXTERNAL_EVIDENCE" : "READY";
  return {
    version: 1,
    changeId: id,
    stage,
    status,
    workspaceHash: hash,
    pendingTasks: pending.map((task) => task.id || task.text),
    externalProviders: unconfigured,
    unavailableProviders: unavailable,
    issues,
    next: status === "NEEDS_EXTERNAL_EVIDENCE"
      ? unconfigured.map((provider) => {
        const capability = providerCapability(provider, providerConfig(id, provider));
        if (capability === "review") return {
          provider,
          command: `claude-foundation packet ${id} --phase review`,
          recordAI: `claude-foundation evidence record ${id} ${provider} pass --reviewer-type ai --reviewer-identity <reviewer> --reviewer-provider-family <provider> --reviewer-model-family <family> --reviewer-model <model> --reviewer-session <session> --subject-provenance '{"type":"ai","identity":"<implementer>","sessionId":"<session>","providerFamily":"<provider>","modelFamily":"<family>","modelId":"<model>"}' --unresolved-blockers 0 --observed <summary> --reference <uri>`,
          recordHuman: `claude-foundation evidence record ${id} ${provider} pass --reviewer-type human --reviewer-identity <reviewer> --subject-provenance '{"type":"human","identity":"<implementer>"}' --unresolved-blockers 0 --observed <summary> --reference <uri>`
        };
        if (capability === "acceptance") return {
          provider,
          command: `claude-foundation evidence record ${id} ${provider} pass --acceptor <human> --decision accept --criterion <criterion> --observed <summary> --artifact <path>`
        };
        return {
          provider,
          command: `claude-foundation evidence record ${id} ${provider} pass --observed <summary> --source <identity> --artifact <path>`
        };
      })
      : []
  };
}

function proofReadiness(id, stage = "prove") {
  const value = proofReadinessValue(id, stage);
  console.log(JSON.stringify(value, null, 2));
  if (value.status !== "READY") process.exitCode = 2;
  return value;
}

function proofPreflight(id, stage = "prove", quiet = false) {
  const value = proofReadinessValue(id, stage);
  const blockers = [
    ...value.issues,
    ...value.externalProviders.map((provider) =>
      `provider '${provider}' has no executable adapter or valid external receipt`),
    ...value.unavailableProviders.map((provider) =>
      `provider unavailable: ${provider}`)
  ];
  if (value.pendingTasks.length)
    blockers.push(`${value.pendingTasks.length} implementation task(s) remain unchecked`);
  if (blockers.length) die(`proof preflight failed: ${blockers.join("; ")}`);
  if (!quiet)
    console.log(`PROOF PREFLIGHT ${id}: ready\n  stage: ${stage}\n  workspace: ${value.workspaceHash}`);
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

function flagValues(flags, name) {
  const value = flags[name];
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim()).filter(Boolean);
}

function normalizedValues(flags, name) {
  return [...new Set(flagValues(flags, name).map((value) => value.toLowerCase()))].sort();
}

function reviewProvenanceResult(review) {
  const reviewer = review?.reviewer || {};
  const subjects = Array.isArray(review?.subjects) ? review.subjects : [];
  const actors = subjects.map((subject) => String(subject.identity || "").toLowerCase());
  const reviewerIdentity = String(reviewer.identity || "").toLowerCase();
  const reviewerSession = String(reviewer.sessionId || "").toLowerCase();
  const subjectsComplete = subjects.length > 0 && subjects.length <= 16 && subjects.every((subject) =>
    subject?.type === "human" ? Boolean(subject.identity) :
      subject?.type === "ai" && Boolean(subject.identity && subject.sessionId &&
        subject.providerFamily && subject.modelFamily && subject.modelId));
  const reviewerComplete = reviewer.type === "human" ? Boolean(reviewerIdentity) :
    reviewer.type === "ai" && Boolean(
    reviewer.providerFamily && reviewer.modelFamily && reviewer.modelId &&
    reviewerSession
  );
  const complete = reviewerComplete && subjectsComplete;
  const independent = complete && !actors.includes(reviewerIdentity) &&
    subjects.filter((subject) => subject.type === "ai")
      .every((subject) => String(subject.sessionId).toLowerCase() !== reviewerSession);
  const diverse = reviewer.type === "human" || (complete && subjects
    .filter((subject) => subject.type === "ai")
    .every((subject) =>
      String(subject.providerFamily).toLowerCase() !== String(reviewer.providerFamily).toLowerCase() ||
      String(subject.modelFamily).toLowerCase() !== String(reviewer.modelFamily).toLowerCase()));
  return { complete, independent, diverse };
}

function reviewReceiptBinding(receipt) {
  const canonical = JSON.parse(JSON.stringify(receipt));
  if (canonical.review) delete canonical.review.attemptDigest;
  return stableHash(canonical);
}

function subjectProvenance(flags) {
  const rawStructured = flags["subject-provenance"] === undefined
    ? [] : Array.isArray(flags["subject-provenance"])
      ? flags["subject-provenance"] : [flags["subject-provenance"]];
  const structured = rawStructured.map((value) => {
    let subject;
    try { subject = JSON.parse(String(value)); }
    catch (error) { die(`invalid --subject-provenance JSON (${error.message})`); }
    return subject;
  });
  if (structured.length) return structured;
  const actors = flagValues(flags, "subject-actor");
  const sessions = flagValues(flags, "subject-session");
  const providers = flagValues(flags, "subject-provider-family");
  const families = flagValues(flags, "subject-model-family");
  const models = flagValues(flags, "subject-model");
  if ([actors, sessions, providers, families, models].some((values) => values.length > 1))
    die("multiple implementers require repeated --subject-provenance JSON tuples");
  if (!actors.length) return [];
  const ai = sessions.length || providers.length || families.length || models.length;
  return [{
    type: ai ? "ai" : "human", identity: actors[0],
    sessionId: sessions[0] || null,
    providerFamily: providers[0]?.toLowerCase() || null,
    modelFamily: families[0]?.toLowerCase() || null,
    modelId: models[0] || null
  }];
}

function reviewHistoryState(id, state = loadRuntime(id)) {
  const candidates = existsSync(join(RECEIPTS, id))
    ? readdirSync(join(RECEIPTS, id), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "proof.json")
      .map((entry) => readJson(join(RECEIPTS, id, entry.name), {}))
      .filter((receipt) => receipt.review)
    : [];
  if (state.reviewHistory?.version === 1 &&
      (Number(state.reviewHistory.totalAttempts || 0) > 0 || candidates.length === 0))
    return state.reviewHistory;
  const latest = candidates.sort((a, b) => Number(b.review?.round || 0) - Number(a.review?.round || 0))[0];
  const round = Number(latest?.review?.round || 0);
  const aiAttempts = latest?.review?.reviewer?.type === "ai" ? Math.min(round, 2) : round >= 3 ? 2 : 0;
  let migratedAttempt = null;
  if (latest) {
    migratedAttempt = {
      version: 1, changeId: id, attempt: round || 1,
      reviewerType: latest.review?.reviewer?.type || "unknown",
      workspaceHash: latest.workspaceHash || null, status: latest.status || null,
      reviewBinding: reviewReceiptBinding(latest),
      priorChainHead: null, migrated: true,
      migratedFromReceiptDigest: stableHash(latest), timestamp: now()
    };
    migratedAttempt.digest = stableHash(migratedAttempt);
    writeJson(join(EVIDENCE_VAULT, id, "review-attempts",
      `${String(round || 1).padStart(4, "0")}-${migratedAttempt.digest.slice(0, 12)}.json`), migratedAttempt);
  }
  state.reviewHistory = {
    version: 1, aiAttempts, totalAttempts: round,
    chainHead: migratedAttempt?.digest || null,
    migratedFromReceiptDigest: latest ? stableHash(latest) : null
  };
  saveRuntime(state);
  return state.reviewHistory;
}

function reviewAttemptByDigest(id, digest) {
  const dir = join(EVIDENCE_VAULT, id, "review-attempts");
  if (!digest || !existsSync(dir)) return null;
  const name = readdirSync(dir).find((entry) => entry.includes(String(digest).slice(0, 12)));
  if (!name) return null;
  const attempt = readJson(join(dir, name), {});
  const claimed = attempt.digest;
  const canonical = { ...attempt };
  delete canonical.digest;
  return claimed === digest && stableHash(canonical) === claimed ? attempt : null;
}

function reviewHistoryChainValid(id, history) {
  let digest = history.chainHead || null;
  let expectedAttempt = Number(history.totalAttempts || 0);
  const seen = new Set();
  while (digest) {
    if (seen.has(digest) || seen.size > 1000) return false;
    seen.add(digest);
    const attempt = reviewAttemptByDigest(id, digest);
    if (!attempt || Number(attempt.attempt) !== expectedAttempt || attempt.changeId !== id)
      return false;
    digest = attempt.priorChainHead || null;
    expectedAttempt -= 1;
  }
  return expectedAttempt === 0 || Boolean(reviewAttemptByDigest(id, history.chainHead)?.migrated);
}

function reserveReviewAttempt(id, reviewerType, receiptSeed) {
  const state = loadRuntime(id);
  const history = reviewHistoryState(id, state);
  if (history.chainHead && !reviewHistoryChainValid(id, history))
    die("review attempt history is missing or corrupt; restore the evidence chain before recording another review");
  if (reviewerType === "ai" && Number(history.aiAttempts || 0) >= 2)
    die("AI review is limited to two rounds (attempts); further review requires a human");
  const attempt = {
    version: 1, changeId: id,
    attempt: Number(history.totalAttempts || 0) + 1,
    reviewerType, priorChainHead: history.chainHead || null,
    workspaceHash: receiptSeed.workspaceHash, status: receiptSeed.status,
    reviewBinding: receiptSeed.reviewBinding,
    timestamp: now()
  };
  attempt.digest = stableHash(attempt);
  state.reviewHistory = {
    version: 1,
    aiAttempts: Number(history.aiAttempts || 0) + (reviewerType === "ai" ? 1 : 0),
    totalAttempts: attempt.attempt,
    chainHead: attempt.digest
  };
  const path = join(EVIDENCE_VAULT, id, "review-attempts", `${String(attempt.attempt).padStart(4, "0")}-${attempt.digest.slice(0, 12)}.json`);
  writeJson(path, attempt);
  saveRuntime(state);
  return attempt;
}

function recordReceipt(id, provider, status, flags = {}) {
  const configured = providerConfig(id, provider);
  const capability = providerCapability(provider, configured);
  if (!capability || !PROVIDERS.has(capability)) die(`unknown provider '${provider}'`);
  if (!["pass", "fail", "inconclusive", "error"].includes(status)) die(`invalid receipt status '${status}'`);
  const state = loadRuntime(id);
  if (capability === "acceptance" && !resolvedAcceptance(id, state, evidence(id)).required)
    die("acceptance evidence is not declared for this change");
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
  const config = flags.config || configured;
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
  const proofRunId = flags.proofRunId || state.activeProofRun?.id ||
    `manual-${Date.now()}-${process.pid}`;
  const workspaceHash = flags.workspaceHash || state.activeProofRun?.workspaceHash ||
    providerWorkspaceHash(id, provider);
  const repository = providerRepository(id, provider, config);
  const artifactFlags = [
    ...(Array.isArray(flags.artifact) ? flags.artifact : []),
    ...(Array.isArray(flags.artifacts) ? flags.artifacts : []),
    ...(flags.log ? [{
      path: flags.log, type: "command-log", required: true
    }] : [])
  ].flatMap((artifact) => typeof artifact === "string"
    ? artifact.split(",").filter(Boolean).map((path) => ({
      path, type: "external-evidence", required: true
    }))
    : [artifact]);
  const uniqueArtifactFlags = [...new Map(artifactFlags.map((artifact) => [
    `${artifact.type || "artifact"}:${artifact.path}`, artifact
  ])).values()];
  const references = (Array.isArray(flags.reference) ? flags.reference : [])
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim()).filter(Boolean);
  rejectPrototypeEvidenceInputs(id, provider, uniqueArtifactFlags, references);
  const artifacts = uniqueArtifactFlags
    .map((artifact) => durableArtifact(id, provider, proofRunId, artifact));
  const observed = String(flags.observed || "").trim();
  let provenanceSource = String(
    flags.source || flags.reviewer || flags.provenance ||
    (flags.command ? `command:${Array.isArray(flags.command)
      ? flags.command.join(" ") : flags.command}` : "")
  ).trim();
  if (!provenanceSource && capability === "review" && flags["reviewer-identity"])
    provenanceSource = `reviewer:${String(flags["reviewer-identity"]).trim()}`;
  if (!provenanceSource && capability === "acceptance" && flags.acceptor)
    provenanceSource = `human:${String(flags.acceptor).trim()}`;
  if (adapter === "external" && status === "pass") {
    if (!observed)
      die(`passing external receipt '${provider}' requires --observed`);
    if (!provenanceSource)
      die(`passing external receipt '${provider}' requires --source or --reviewer`);
    if (artifacts.length === 0 && references.length === 0)
      die(`passing external receipt '${provider}' requires --artifact or --reference`);
  }
  const inputIdentity = providerInputIdentity(
    id, provider, config, workspaceHash
  );
  if (status === "pass" && inputIdentity.mode === "declared" &&
      inputIdentity.files.length === 0)
    die(`passing receipt '${provider}' declared inputs but matched no files`);
  const receipt = {
    version: 6, changeId: id, provider, providerVersion, adapter,
    repositoryId: repository?.id || null,
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
    inputIdentity,
    claims: requestedClaims,
    status, observed, provenance: {
      source: provenanceSource || null,
      recordedBy: String(flags["recorded-by"] || "").trim() || null
    }, references, capability: {
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
  if (capability === "review") {
    const policy = reviewPolicy(id);
    const reviewerType = String(flags["reviewer-type"] ||
      (flags.reviewer ? "human" : "")).toLowerCase();
    if (!['ai', 'human'].includes(reviewerType))
      die("review receipt requires --reviewer-type ai|human");
    const reviewerIdentity = String(
      flags["reviewer-identity"] || flags.reviewer || ""
    ).trim();
    if (!reviewerIdentity) die("review receipt requires --reviewer-identity");
    const reviewer = {
      type: reviewerType,
      identity: reviewerIdentity,
      providerFamily: String(flags["reviewer-provider-family"] || "").trim().toLowerCase() || null,
      modelFamily: String(flags["reviewer-model-family"] || "").trim().toLowerCase() || null,
      modelId: String(flags["reviewer-model"] || "").trim() || null,
      sessionId: String(flags["reviewer-session"] || "").trim() || null
    };
    const subjects = subjectProvenance(flags);
    if (reviewerType === "ai" && [
      reviewer.providerFamily, reviewer.modelFamily, reviewer.modelId, reviewer.sessionId
    ].some((value) => !value))
      die("AI review requires reviewer provider/model family, model ID, and session");
    if (!subjects.length)
      die("review requires at least one --subject-actor for implementation provenance");
    const provenance = reviewProvenanceResult({ reviewer, subjects });
    if (!provenance.complete)
      die("review requires complete structured reviewer and subject provenance");
    const { independent, diverse } = provenance;
    if (!independent) die("reviewer must use an identity and session independent of implementation");
    if (status === "pass" && policy.diversity === "required" && !diverse)
      die("review policy requires a different provider/model family or a human reviewer");
    const blockers = Number(flags["unresolved-blockers"] || 0);
    const verified = Number(flags["verified-findings"] || 0);
    if (![blockers, verified].every((value) => Number.isInteger(value) && value >= 0))
      die("review finding counts must be non-negative integers");
    if (status === "pass" && blockers > 0)
      die("passing review cannot contain unresolved blockers");
    const prior = existsSync(receiptPath(id, provider))
      ? readJson(receiptPath(id, provider), {}) : null;
    const scopePaths = [...new Set(flagValues(flags, "scope-path"))].sort();
    const history = reviewHistoryState(id);
    const nextAttempt = Number(history.totalAttempts || 0) + 1;
    if (nextAttempt >= 2 && reviewerType === "ai" && scopePaths.length === 0)
      die("AI review round 2 requires at least one --scope-path");
    receipt.reviewProtocolVersion = REVIEW_PROTOCOL_VERSION;
    receipt.review = {
      round: nextAttempt,
      reviewer,
      subjects,
      policy: { ...policy, independent, diverse },
      scope: {
        mode: nextAttempt === 1 || scopePaths.length === 0 ? "full" : "changed",
        paths: scopePaths,
        digest: stableHash({ priorWorkspaceHash: prior?.workspaceHash || null, workspaceHash, paths: scopePaths })
      },
      findings: {
        verified,
        unresolvedBlockers: blockers,
        reference: references[0] || null
      },
      supersedes: prior ? {
        receiptSha256: stableHash(prior),
        workspaceHash: prior.workspaceHash || null,
        finishedAt: prior.finishedAt || null,
        round: Number(prior?.review?.round || 0) || null
      } : null
    };
    const attempt = reserveReviewAttempt(id, reviewerType, {
      workspaceHash, status, reviewBinding: reviewReceiptBinding(receipt)
    });
    receipt.review.attemptDigest = attempt.digest;
  }
  if (capability === "acceptance") {
    const acceptor = String(flags.acceptor || "").trim();
    const criteria = flagValues(flags, "criterion").map((value) => String(value).trim());
    const decision = String(flags.decision || "").trim().toLowerCase();
    if (status === "pass" && (!acceptor || decision !== "accept" || criteria.length === 0 ||
        criteria.some((criterion) => !criterion) || new Set(criteria).size !== criteria.length))
      die("passing acceptance requires --acceptor, --decision accept, and at least one --criterion");
    if (status === "pass" && !observed)
      die("passing acceptance requires --observed");
    provenanceSource ||= acceptor ? `human:${acceptor}` : "";
    receipt.provenance.source = provenanceSource || null;
    receipt.acceptanceProtocolVersion = ACCEPTANCE_PROTOCOL_VERSION;
    receipt.acceptance = {
      actor: { type: "human", identity: acceptor || null },
      decision: decision || null,
      criteria,
      reason: resolvedAcceptance(id, state, evidence(id)).reason,
      subjectWorkspaceHash: workspaceHash
    };
  }
  if (capability === "browser" && status === "pass" && receipt.capability.foregroundRequired &&
      !receipt.capability.foregroundAvailable) die("browser cannot pass when required foreground input is unavailable");
  if (capability === "browser" && status === "pass" &&
      !INPUT_MODES.has(receipt.capability.inputMode))
    die("passing browser receipt requires --input-mode browser-automation|dom-event|os-input|both");
  if (capability === "browser" && status === "pass" &&
      ["os-input", "both"].includes(receipt.capability.inputMode) &&
      (!receipt.capability.foregroundRequired || !receipt.capability.foregroundAvailable))
    die("passing OS-input browser receipt requires foreground-required=yes and foreground-available=yes");
  if (capability === "discovery" && status === "pass") {
    const discovered = Number(flags.discovered);
    const minimum = Number(flags.minimum);
    if (!Number.isFinite(discovered) || !Number.isFinite(minimum) || minimum <= 0 || discovered < minimum)
      die("passing discovery receipt requires --discovered N --minimum N with discovered >= minimum > 0");
    receipt.discovery = { discovered, minimum };
  }
  if (capability === "mutation" && status === "pass" &&
      !["behavioral-kill", "test-failure"].includes(flags.classification))
    die("passing mutation receipt requires --classification behavioral-kill|test-failure; crash is not a kill");
  if (capability === "mutation") receipt.classification = flags.classification || null;
  writeJson(receiptPath(id, provider), receipt);
  console.log(`RECEIPT ${id}/${provider}: ${status}`);
}

function runProvider(id, provider, values) {
  const capability = providerCapability(provider, providerConfig(id, provider));
  if (!capability || !PROVIDERS.has(capability)) die(`unknown provider '${provider}'`);
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
    cwd: providerWorkspace(id, provider), encoding: "utf8",
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

function parseTapOutput(value) {
  const text = String(value || "");
  if (!/^(TAP version|\s*(?:ok|not ok)\b)/m.test(text)) return null;
  const testsFooter = [...text.matchAll(/^# tests\s+(\d+)\s*$/gm)].at(-1);
  const passFooter = [...text.matchAll(/^# pass\s+(\d+)\s*$/gm)].at(-1);
  const failFooter = [...text.matchAll(/^# fail\s+(\d+)\s*$/gm)].at(-1);
  const plan = [...text.matchAll(/^\s*1\.\.(\d+)\s*$/gm)].at(-1);
  const totalTests = Number(testsFooter?.[1] ?? plan?.[1]);
  if (!Number.isInteger(totalTests) || totalTests < 0) return null;
  return {
    totalTests,
    passed: passFooter ? Number(passFooter[1]) : null,
    failed: failFooter ? Number(failFooter[1]) : null,
    format: "tap"
  };
}

function mutationProtocolResult(value) {
  const text = String(value || "");
  const line = text.match(
    /(?:^|\n)FOUNDATION_MUTATION_RESULT=(behavioral-kill|test-failure|survived|crash|timeout|not-applied)(?:\n|$)/
  );
  if (line) return line[1];
  const parsed = parseJsonOutput(text);
  const result = parsed?.foundationMutationResult || parsed?.mutationResult;
  return [
    "behavioral-kill", "test-failure", "survived", "crash", "timeout",
    "not-applied"
  ].includes(result) ? result : null;
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
  const cwd = config.repository
    ? repositoryById(id, config.repository, state).workspacePath
    : state.workspace?.path || ROOT;
  if (config.staticRoot) {
    const root = resolve(cwd, config.staticRoot);
    if (!pathInside(cwd, root) || !existsSync(root) || !statSync(root).isDirectory())
      throw new Error(`service '${name}' staticRoot is not a workspace directory`);
    const readinessUrl = new URL(config.readiness.url);
    const port = Number(readinessUrl.port ||
      (readinessUrl.protocol === "https:" ? 443 : 80));
    const host = readinessUrl.hostname;
    const identityHeaders = config.identityHeader || {
      "x-foundation-service": name
    };
    const mime = {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml"
    };
    let requests = 0;
    const server = createServer((request, response) => {
      requests += 1;
      let pathname;
      try { pathname = decodeURIComponent(new URL(request.url, config.readiness.url).pathname); }
      catch {
        response.writeHead(400, identityHeaders);
        response.end("bad request");
        return;
      }
      const requested = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!pathInside(root, requested) || !existsSync(requested) ||
          !statSync(requested).isFile()) {
        response.writeHead(404, identityHeaders);
        response.end("not found");
        return;
      }
      const extension = requested.slice(requested.lastIndexOf("."));
      response.writeHead(200, {
        ...identityHeaders,
        "content-type": mime[extension] || "application/octet-stream"
      });
      response.end(readFileSync(requested));
    });
    await new Promise((complete, reject) => {
      server.once("error", reject);
      server.listen(port, host, complete);
    });
    if (!await readinessMatches(config.readiness)) {
      await new Promise((complete) => server.close(complete));
      throw new Error(`service '${name}' native static readiness failed`);
    }
    return {
      name,
      child: null,
      startedAt: now(),
      stop() {
        server.close();
        const logPath = join(LOGS, id, `${proofRunId}-service-${name}.log`);
        mkdirSync(dirname(logPath), { recursive: true });
        writeFileSync(logPath,
          `native-static root=${relative(cwd, root)} requests=${requests}\n`);
        return {
          name,
          path: relative(ROOT, logPath).replaceAll("\\", "/"),
          status: "terminated"
        };
      }
    };
  }
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
      FOUNDATION_REPOSITORY_ID: config.repository || "root",
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
  if (providerCapability(provider, config) === "mutation") return ["workspace-write"];
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
  const repository = providerRepository(id, provider, config);
  const cwd = repository?.workspacePath || state.workspace?.path || ROOT;
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
      FOUNDATION_REPOSITORY_ID: repository?.id || "root",
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
  const jsonReport = configuredReport && existsSync(configuredReport)
    ? parseJsonOutput(readFileSync(configuredReport, "utf8"))
    : parseJsonOutput(result.stdout);
  const tapReport = ["tap", "auto"].includes(config.reportFormat || "auto")
    ? parseTapOutput(
      configuredReport && existsSync(configuredReport)
        ? readFileSync(configuredReport, "utf8") : result.stdout
    )
    : null;
  const report = jsonReport || tapReport;
  const baseFlags = {
    config, adapter: config.adapter, proofRunId, commandExecutionId,
    workspaceHash: providerWorkspaceHash(
      id, provider, state.activeProofRun?.workspaceHash
    ),
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
    const testProvider = provider;
    const discoveryProvider = config.discoveryProvider || "discovery";
    const discoveryConfig = providerConfig(id, discoveryProvider) || config;
    const testStatus = result.timedOut || result.error ? "error" :
      result.status === 0 ? "pass" : "fail";
    recordReceipt(id, testProvider, testStatus, {
      ...baseFlags, claims: providerClaims(id, testProvider, config).join(",")
    });
    const discovered = numericReportValue(report, [
      "numTotalTests", "totalTests", "tests", "testCount", "expected"
    ]);
    const minimum = Number(config.minimum || 1);
    const discoveryStatus = result.timedOut || result.error ? "error" :
      discovered === null ? "inconclusive" :
      discovered >= minimum ? "pass" : "fail";
    recordReceipt(id, discoveryProvider, discoveryStatus, {
      ...baseFlags, config: discoveryConfig,
      claims: providerClaims(id, discoveryProvider, discoveryConfig).join(","),
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
        "input-mode": providerCapability(output, providerConfig(id, output)) === "browser"
          ? config.inputMode || "browser-automation" : config.inputMode || null,
        "foreground-required": config.foregroundRequired ? "yes" : "no",
        "foreground-available": config.foregroundAvailable ? "yes" : "no",
        observed: summary
          ? `${summary.tests} tests; ${summary.failed} failed; covered claims ${requiredClaims.length - missingClaims.length}/${requiredClaims.length}; observed annotations ${summary.claims.length}` +
            (missingClaims.length ? `; missing ${missingClaims.join(",")}` : "")
          : "Playwright JSON report unavailable"
      });
    }
    return { provider, status: aggregateStatus };
  }

  const capability = providerCapability(provider, config);
  const mutationResult = capability === "mutation" &&
      config.resultProtocol === "foundation-mutation-v1"
    ? mutationProtocolResult(result.stdout) : null;
  const status = result.timedOut || result.error ? "error" :
    capability === "mutation" && config.resultProtocol === "foundation-mutation-v1"
      ? ["behavioral-kill", "test-failure"].includes(mutationResult)
        ? "pass"
        : ["crash", "timeout", "not-applied"].includes(mutationResult)
          ? "error" : "fail"
      : result.status === 0 ? "pass" : "fail";
  recordReceipt(id, provider, status, {
    ...baseFlags,
    "input-mode": config.inputMode || null,
    "foreground-required": config.foregroundRequired ? "yes" : "no",
    "foreground-available": config.foregroundAvailable ? "yes" : "no",
    classification: mutationResult || config.classification,
    observed: mutationResult
      ? `mutation result ${mutationResult}; ${baseFlags.observed}`
      : baseFlags.observed
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
    if (!commandExists(config.command?.[0], providerWorkspace(id, provider, config))) {
      unavailable.push(`${provider}:command`);
      continue;
    }
    if (config.adapter === "playwright") {
      const availability = playwrightAvailability(providerWorkspace(id, provider, config));
      if (!availability.packageOwned || !availability.binaryAvailable) {
        unavailable.push(`${provider}:project-owned-playwright`);
        continue;
      }
    }
    const configuredProducer = config.adapter === "test-discovery"
      ? Object.entries(evidence(id).providers || {}).find(([candidate, value]) =>
        stableHash(value) === stableHash(config) &&
        providerCapability(candidate, value) === "test")?.[0]
      : null;
    const nodeProvider = configuredProducer || provider;
    const covers = config.adapter === "test-discovery"
      ? [nodeProvider, config.discoveryProvider || "discovery"]
        .filter((output) => needed.includes(output))
      : [...new Set([provider, ...(config.outputs || [])])]
        .filter((output) => needed.includes(output));
    covers.forEach((item) => claimed.add(item));
    nodes.push({
      provider: nodeProvider,
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
  for (const provider of requiredProviders(id)) {
    const row = receiptValidity(id, provider, snapshot.workspaceHash);
    if (row.validity === "reusable-inputs")
      rebindReusableReceipt(id, row, snapshot, proofRunId);
  }
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

async function proofRun(id) {
  const readiness = proofReadinessValue(id, "prove");
  if (readiness.status !== "READY") {
    console.log(JSON.stringify({
      ...readiness,
      command: "proof run",
      completed: false
    }, null, 2));
    process.exitCode = 2;
    return readiness;
  }
  await proofExecute(id);
  const audit = proofAudit(id, true);
  if (!audit.valid)
    die(`proof run audit failed: ${audit.reason}`);
  const proof = readJson(proofPath(id));
  const outcome = {
    version: 1,
    changeId: id,
    command: "proof run",
    status: "PASS",
    completed: true,
    proofRunId: proof.proofRunId || null,
    workspaceHash: proof.workspaceHash,
    providers: proof.providers || []
  };
  console.log(JSON.stringify(outcome, null, 2));
  return outcome;
}

function prove(id, requestedProofRunId = null) {
  const stateBefore = loadRuntime(id);
  if (stateBefore.status === "archived") die(`change '${id}' is already archived`);
  validate(id, "active", { quiet: true });
  const surfaceIssues = changedSurfaceIssues(id);
  if (surfaceIssues.length)
    die(`changed-surface authority failed: ${surfaceIssues.join("; ")}`);
  const leases = activeChangeLeases(id);
  if (leases.length)
    die(`active agent leases block proof: ${leases.map((lease) => lease.taskId).join(", ")}`);
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
      repositoryId: row.receipt?.repositoryId || null,
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
    repositories: snapshot.repositories || null,
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
    const manifestEntry = (proof.receipts || []).find((entry) => entry.provider === provider);
    if (!manifestEntry || fileDigest(receiptPath(id, provider)) !== manifestEntry.sha256)
      die(`${provider} live receipt differs from the proven receipt manifest`);
  }
  if (state.workspace?.applied) {
    const applied = verifyAppliedProjection(state);
    if (!applied.valid) die(`applied projection is invalid: ${applied.reason}`);
  }
  console.log(`LAND READY ${id}\n  workspace: ${hash}`);
  return { archived: false, state, hash };
}

function orderedRepositories(id, state = loadRuntime(id)) {
  const repositories = selectedRepositories(id, state);
  const byId = new Map(repositories.map((repository) => [repository.id, repository]));
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];
  function visit(repository) {
    if (visiting.has(repository.id))
      die(`repository dependency cycle at '${repository.id}'`);
    if (visited.has(repository.id)) return;
    visiting.add(repository.id);
    for (const dependency of repository.dependsOn || []) {
      const target = byId.get(dependency);
      if (target) visit(target);
    }
    visiting.delete(repository.id);
    visited.add(repository.id);
    ordered.push(repository);
  }
  repositories.forEach(visit);
  ordered.sort((left, right) => {
    if (left.id === "root") return 1;
    if (right.id === "root") return -1;
    return 0;
  });
  return ordered;
}

function repositoryCommitLanded(repository, commit) {
  if (!commit || !gitHead(repository.path)) return false;
  const result = git(["merge-base", "--is-ancestor", commit, "HEAD"], repository.path);
  return result.status === 0;
}

function rootGitlink(workspace, repository) {
  if (repository.type !== "submodule") return null;
  const result = git(["ls-files", "-s", "--", repository.relativePath], workspace);
  if (result.status !== 0) return null;
  return result.stdout.trim().match(/^160000\s+([0-9a-f]+)/)?.[1] || null;
}

function landPlanValue(id) {
  const state = loadRuntime(id);
  const proof = existsSync(proofPath(id)) ? readJson(proofPath(id), {}) : null;
  const repositories = orderedRepositories(id, state).map((repository) => {
    const runtime = state.repositories?.[repository.id] || {};
    const commit = runtime.land?.commit || null;
    const landed = repository.id === "root" ? false :
      repositoryCommitLanded(repository, commit);
    const sandboxGitlink = rootGitlink(state.workspace?.path || ROOT, repository);
    const targetGitlink = rootGitlink(ROOT, repository);
    let status = repository.mode === "read" ? "read-only" :
      repository.id === "root" ? "control-plane-last" :
      !runtime.path ? "sandbox-missing" :
      !commit ? "awaiting-explicit-commit" :
      !landed ? "awaiting-explicit-branch-land" :
      repository.type === "submodule" &&
        (sandboxGitlink !== commit || targetGitlink !== commit)
        ? "awaiting-root-pointer" : "child-landed";
    if (runtime.land?.ci === "fail") status = "ci-failed";
    if (runtime.land?.ciRequired && runtime.land?.ci !== "pass")
      status = "awaiting-ci";
    return {
      id: repository.id,
      type: repository.type,
      mode: repository.mode,
      dependsOn: repository.dependsOn || [],
      targetPath: repository.path,
      sandboxPath: runtime.path || repository.workspacePath,
      baseHead: runtime.baseHead || repository.baseHead,
      targetHead: gitHead(repository.path),
      sandboxHead: gitHead(runtime.path || repository.workspacePath),
      commit,
      ci: runtime.land?.ci || null,
      rootGitlink: sandboxGitlink,
      targetRootGitlink: targetGitlink,
      status
    };
  });
  const value = {
    version: 1,
    changeId: id,
    proofRunId: proof?.proofRunId || null,
    proofStatus: proof?.status || "missing",
    workspaceHash: relevantHash(id),
    strategy: "ordered-resumable-saga",
    repositories,
    readyToArchive: repositories.every((repository) =>
      ["read-only", "child-landed", "control-plane-last"].includes(repository.status)),
    updatedAt: now()
  };
  return value;
}

function showLandPlan(id) {
  const plan = landPlanValue(id);
  writeJson(join(TRANSACTIONS, id, "multi-repo-land.json"), plan);
  console.log(JSON.stringify(plan, null, 2));
}

function recordRepositoryLand(id, flags) {
  const repositoryId = flags.repo;
  const commit = flags.commit;
  if (!repositoryId || !commit)
    die("land record requires --repo <id> --commit <sha>");
  landCheck(id);
  const state = loadRuntime(id);
  const repository = repositoryById(id, repositoryId, state);
  if (repository.id === "root" || repository.mode !== "write")
    die(`repository '${repositoryId}' is not a writable child repository`);
  const runtime = state.repositories?.[repositoryId];
  if (!runtime?.path) die(`repository '${repositoryId}' has no sandbox`);
  const resolved = git(["rev-parse", `${commit}^{commit}`], runtime.path);
  if (resolved.status !== 0)
    die(`commit '${commit}' is not available in repository '${repositoryId}'`);
  const normalizedCommit = resolved.stdout.trim();
  const sandboxHead = gitHead(runtime.path);
  if (sandboxHead !== normalizedCommit)
    die(`repository '${repositoryId}' sandbox HEAD must equal the recorded commit`);
  const dirty = git(["status", "--porcelain"], runtime.path);
  if (dirty.status !== 0 || dirty.stdout.trim())
    die(`repository '${repositoryId}' sandbox must be clean before recording Land`);
  const ci = flags.ci || null;
  if (ci && !["pass", "fail", "pending"].includes(ci))
    die("land record --ci must be pass|fail|pending");
  state.repositories[repositoryId].land = {
    commit: normalizedCommit,
    ci,
    ciRequired: Boolean(flags["ci-required"]),
    recordedAt: now(),
    authority: "explicit-user-record"
  };
  saveRuntime(state);
  console.log(`LAND RECORDED ${id}/${repositoryId}\n  commit: ${normalizedCommit}\n  ci: ${ci || "unknown"}`);
}

function stageRootPointers(id) {
  landCheck(id);
  const state = loadRuntime(id);
  if (!state.repositories || Object.keys(state.repositories).length <= 1)
    die(`change '${id}' is not multi-repository`);
  if (gitHead(ROOT) !== state.workspace?.baseHead)
    die("control repository HEAD moved since sandbox creation");
  const entries = orderedRepositories(id, state)
    .filter((repository) => repository.type === "submodule" &&
      repository.mode === "write")
    .map((repository) => {
      const runtime = state.repositories[repository.id];
      const commit = runtime?.land?.commit;
      if (!commit || !repositoryCommitLanded(repository, commit))
        die(`repository '${repository.id}' commit has not landed`);
      if (runtime.land.ciRequired && runtime.land.ci !== "pass")
        die(`repository '${repository.id}' required CI has not passed`);
      const sandboxBefore = rootGitlink(state.workspace.path, repository);
      const targetBefore = rootGitlink(ROOT, repository);
      if (![runtime.baseHead, commit].includes(sandboxBefore) ||
          ![runtime.baseHead, commit].includes(targetBefore))
        die(`repository '${repository.id}' root pointer changed outside the Land plan`);
      return { repository, commit, sandboxBefore, targetBefore };
    });
  if (!entries.length) {
    console.log(`ROOT POINTERS ${id}: no submodule pointers required`);
    return;
  }
  const applied = [];
  try {
    for (const entry of entries) {
      const sandboxResult = git([
        "update-index", "--cacheinfo",
        `160000,${entry.commit},${entry.repository.relativePath}`
      ], state.workspace.path);
      if (sandboxResult.status !== 0)
        throw new Error(`cannot update ${entry.repository.id} sandbox pointer: ${sandboxResult.stderr.trim()}`);
      const targetResult = git([
        "update-index", "--cacheinfo",
        `160000,${entry.commit},${entry.repository.relativePath}`
      ], ROOT);
      if (targetResult.status !== 0) {
        git(["update-index", "--cacheinfo",
          `160000,${entry.sandboxBefore},${entry.repository.relativePath}`],
        state.workspace.path);
        throw new Error(`cannot update ${entry.repository.id} target pointer: ${targetResult.stderr.trim()}`);
      }
      applied.push(entry);
    }
  } catch (error) {
    for (const entry of applied.reverse()) {
      git(["update-index", "--cacheinfo",
        `160000,${entry.sandboxBefore},${entry.repository.relativePath}`],
      state.workspace.path);
      git(["update-index", "--cacheinfo",
        `160000,${entry.targetBefore},${entry.repository.relativePath}`], ROOT);
    }
    die(`${error.message}; root pointers rolled back`);
  }
  state.land = {
    ...(state.land || {}),
    strategy: "ordered-resumable-saga",
    status: "root-pointers-staged",
    pointers: Object.fromEntries(entries.map((entry) =>
      [entry.repository.id, entry.commit])),
    pointersStagedAt: now()
  };
  state.status = "building";
  delete state.provenHash;
  clearSnapshotCache(id);
  saveRuntime(state);
  console.log(`ROOT POINTERS STAGED ${id}\n  proof is stale; run /prove ${id}`);
}

function resumeLand(id) {
  landCheck(id);
  const state = loadRuntime(id);
  for (const repository of orderedRepositories(id, state)) {
    if (repository.id === "root" || repository.mode !== "write") continue;
    const runtime = state.repositories?.[repository.id];
    if (!runtime?.land?.commit) continue;
    runtime.land.status = repositoryCommitLanded(repository, runtime.land.commit)
      ? "child-landed" : "awaiting-explicit-branch-land";
    runtime.land.checkedAt = now();
  }
  state.land = {
    ...(state.land || {}),
    strategy: "ordered-resumable-saga",
    status: "children-inspected",
    resumedAt: now()
  };
  saveRuntime(state);
  showLandPlan(id);
}

function assertMultiRepositoryArchiveReady(id, state) {
  if (!state.repositories || Object.keys(state.repositories).length <= 1) return;
  const plan = landPlanValue(id);
  const blocked = plan.repositories.filter((repository) =>
    !["read-only", "child-landed", "control-plane-last"].includes(repository.status));
  if (blocked.length)
    die(`multi-repository Land is incomplete: ${blocked.map((repository) =>
      `${repository.id}:${repository.status}`).join(", ")}`);
}

function createCopySandbox(id, state, reason) {
  const path = canonicalPath(mkdtempSync(join(tmpdir(), `foundation-${id}-`)));
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

function writableControlSocket(path) {
  if (!path || !existsSync(path)) return false;
  try {
    const resolved = realpathSync(path);
    const stat = statSync(resolved);
    if (!stat.isSocket() && !stat.isFile()) return false;
    accessSync(resolved, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function securityBoundaryInspection() {
  const evidence = [];
  let kind = "unknown";
  let status = "not-detected";
  if (existsSync("/.dockerenv")) {
    kind = "container";
    status = "detected";
    evidence.push({ source: "filesystem", value: "/.dockerenv" });
  } else if (existsSync("/run/.containerenv")) {
    kind = "container";
    status = "detected";
    evidence.push({ source: "filesystem", value: "/run/.containerenv" });
  } else {
    try {
      const cgroup = readFileSync("/proc/1/cgroup", "utf8").toLowerCase();
      const token = ["docker", "containerd", "kubepods", "lxc", "podman"]
        .find((candidate) => cgroup.includes(candidate));
      if (token) {
        kind = "container";
        status = "detected";
        evidence.push({ source: "cgroup", value: token });
      }
    } catch {
      // Platforms without procfs remain unknown unless another strong signal exists.
    }
  }
  if (kind === "unknown" && process.env.CODESPACES === "true" && existsSync("/workspaces")) {
    kind = "container";
    status = "detected";
    evidence.push({ source: "codespaces", value: "/workspaces" });
  }
  const candidates = [
    "/var/run/docker.sock", "/run/docker.sock", "/run/podman/podman.sock",
    "/run/containerd/containerd.sock", "/var/run/crio/crio.sock"
  ];
  const runtimeDir = process.env.XDG_RUNTIME_DIR || "";
  if (runtimeDir) {
    candidates.push(join(runtimeDir, "docker.sock"));
    candidates.push(join(runtimeDir, "podman", "podman.sock"));
  }
  const dockerHost = process.env.DOCKER_HOST || "";
  if (dockerHost.startsWith("unix://")) candidates.push(dockerHost.slice("unix://".length));
  const containerHost = process.env.CONTAINER_HOST || "";
  if (containerHost.startsWith("unix://")) candidates.push(containerHost.slice("unix://".length));
  const hazards = [...new Set(candidates.filter(writableControlSocket))]
    .sort().map((path) => `writable host-control socket: ${path}`);
  if (dockerHost && !dockerHost.startsWith("unix://"))
    hazards.push(`remote Docker control endpoint configured (${dockerHost.split(":", 1)[0] || "unknown"})`);
  if (containerHost && !containerHost.startsWith("unix://"))
    hazards.push(`remote container control endpoint configured (${containerHost.split(":", 1)[0] || "unknown"})`);
  if (existsSync("/var/run/secrets/kubernetes.io/serviceaccount/token"))
    hazards.push("mounted Kubernetes service-account credential");
  if (process.env.SSH_AUTH_SOCK && existsSync(process.env.SSH_AUTH_SOCK))
    hazards.push("mounted SSH agent socket");
  return { kind, status, evidence, hazards };
}

function unattendedPreflight() {
  const securityBoundary = securityBoundaryInspection();
  const reasons = [];
  if (securityBoundary.status !== "detected")
    reasons.push("no supported container or VM security boundary was detected");
  else reasons.push("detected virtualization alone does not attest host mounts, credentials, network, devices, or process authority");
  reasons.push(...securityBoundary.hazards);
  return {
    securityBoundary,
    boundaryDetected: securityBoundary.status === "detected",
    safeForUnattended: false,
    reasons
  };
}

function directoryExists(path) {
  if (!path || !existsSync(path)) return false;
  try { return statSync(path).isDirectory(); }
  catch { return false; }
}

function gitMetadataPresent(workspacePath) {
  if (!directoryExists(workspacePath)) return false;
  const metadataPath = join(workspacePath, ".git");
  if (!existsSync(metadataPath)) return false;
  try {
    const metadata = statSync(metadataPath);
    if (metadata.isDirectory()) return true;
    if (!metadata.isFile() || metadata.size > 4096) return false;
    const match = readFileSync(metadataPath, "utf8").match(/^gitdir:\s*(.+?)\s*$/m);
    if (!match) return false;
    return directoryExists(resolve(dirname(metadataPath), match[1]));
  } catch {
    return false;
  }
}

function workspaceIsolationInspection(id, state = loadRuntime(id)) {
  const workspace = state.workspace || {};
  const kind = workspace.mode === "worktree" ? "git-worktree" :
    workspace.mode === "copy" ? "filesystem-copy" : "none";
  const identityValid = kind === "git-worktree" ? gitMetadataPresent(workspace.path) :
    kind === "filesystem-copy" ? directoryExists(workspace.path) : true;
  const status = kind === "none" ? "current" : identityValid ? "active" : "missing";
  const repositories = Object.entries(state.repositories || {}).map(([repositoryId, runtime]) => ({
    id: repositoryId,
    access: runtime.access || "write",
    kind: runtime.mode === "worktree" ? "git-worktree" :
      runtime.mode === "copy" ? "filesystem-copy" :
        runtime.mode === "reference" ? "reference" : "none",
    status: runtime.path && existsSync(runtime.path) ? "active" : "missing",
    path: runtime.path || null
  })).sort((left, right) => left.id.localeCompare(right.id));
  return { kind, status, path: workspace.path || ROOT, repositories };
}

function isolationInspection(id, flags = {}) {
  const workspaceIsolation = workspaceIsolationInspection(id);
  const preflight = unattendedPreflight();
  return {
    version: 1,
    changeId: id,
    workspaceIsolation,
    securityBoundary: preflight.securityBoundary,
    execution: {
      mode: flags.unattended ? "unattended" : "interactive",
      boundaryDetected: preflight.boundaryDetected,
      safeForUnattended: preflight.safeForUnattended,
      decision: !flags.unattended || preflight.safeForUnattended ? "allow" : "block",
      reasons: preflight.reasons
    }
  };
}

function showSandboxInspection(id, flags = {}) {
  const result = isolationInspection(id, flags);
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`ISOLATION ${id}`);
    console.log(`  workspace isolation: ${result.workspaceIsolation.kind} (${result.workspaceIsolation.status})`);
    console.log(`  security boundary: ${result.securityBoundary.kind} (${result.securityBoundary.status})`);
    console.log(`  safe for unattended: ${result.execution.safeForUnattended ? "yes" : "no"}`);
    for (const reason of result.execution.reasons) console.log(`  reason: ${reason}`);
  }
  if (flags.unattended && !result.execution.safeForUnattended) process.exitCode = 1;
}

function createSingleSandbox(id) {
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
  const requestedPath = join(ROOT, ".foundation", "sandboxes", id);
  mkdirSync(dirname(requestedPath), { recursive: true });
  const result = git(["worktree", "add", "--detach", requestedPath, "HEAD"]);
  if (result.status !== 0) die(`cannot create sandbox: ${result.stderr.trim()}`);
  const path = canonicalPath(requestedPath);
  cpSync(changePath(id), join(path, "openspec", "changes", id), { recursive: true });
  state.workspace = {
    mode: "worktree", path, baseHead: gitHead(ROOT), applied: false,
    changeSourceHash: directoryHash(changePath(id))
  };
  saveRuntime(state);
  console.log(`SANDBOX ${id}\n  path: ${path}`);
}

function createSandbox(id, flags = {}) {
  if (flags.unattended) {
    const preflight = unattendedPreflight();
    if (!preflight.safeForUnattended)
      die(`unattended sandbox creation requires a trusted host-owned security attestation; detected virtualization alone is insufficient: ${preflight.reasons.join("; ")}`);
  }
  const initial = loadRuntime(id);
  const repositories = selectedRepositories(id, initial);
  if (repositories.length === 1 && repositories[0].id === "root" && !flags.all) {
    createSingleSandbox(id);
    return;
  }
  createSingleSandbox(id);
  const state = loadRuntime(id);
  state.repositories = {};
  try {
    for (const repository of repositories) {
      if (repository.id === "root") {
        state.repositories.root = {
          mode: state.workspace.mode,
          path: state.workspace.path,
          targetPath: ROOT,
          baseHead: state.workspace.baseHead || gitHead(ROOT),
          access: repository.mode
        };
        continue;
      }
      const baseHead = gitHead(repository.path);
      if (!baseHead && repository.mode === "write")
        throw new Error(`repository '${repository.id}' is not an initialized Git repository`);
      if (repository.mode === "read" || repository.type === "external") {
        state.repositories[repository.id] = {
          mode: "reference", path: repository.path, targetPath: repository.path,
          baseHead, access: "read"
        };
        continue;
      }
      const requestedPath = join(
        ROOT, ".foundation", "repository-sandboxes", id, repository.id
      );
      if (existsSync(requestedPath))
        throw new Error(`repository sandbox already exists: ${requestedPath}`);
      mkdirSync(dirname(requestedPath), { recursive: true });
      const result = git(
        ["worktree", "add", "--detach", requestedPath, baseHead],
        repository.path
      );
      if (result.status !== 0)
        throw new Error(`cannot create sandbox for '${repository.id}': ${result.stderr.trim()}`);
      const path = canonicalPath(requestedPath);
      state.repositories[repository.id] = {
        mode: "worktree", path, targetPath: repository.path,
        baseHead, access: "write", applied: false
      };
    }
  } catch (error) {
    cleanupRepositorySandboxes(id, state);
    cleanupAppliedSandbox(id, state);
    state.workspace = { mode: "current", path: ROOT, baseHead: gitHead(ROOT) };
    delete state.repositories;
    state.status = "change";
    saveRuntime(state);
    die(`${error.message}; created sandboxes rolled back`);
  }
  state.status = "building";
  saveRuntime(state);
  clearSnapshotCache(id);
  console.log(`MULTI-REPOSITORY SANDBOX ${id}`);
  for (const repository of selectedRepositories(id, state))
    console.log(`  ${repository.id}: ${repository.workspacePath}`);
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
  validate(id, "root", { quiet: true });
  const state = loadRuntime(id);
  const workspace = state.workspace;
  if (!workspace || !["worktree", "copy"].includes(workspace.mode) ||
      !workspace.path || !existsSync(workspace.path))
    die(`change '${id}' has no active sandbox`);
  const source = changePath(id);
  const destination = join(workspace.path, "openspec", "changes", id);
  const priorRepositories = repositorySelectionIdsAt(destination);
  const nextRepositories = repositorySelectionIdsAt(source);
  if (JSON.stringify(priorRepositories) !== JSON.stringify(nextRepositories))
    die("repository scope changed during Build; finish or split the current repository work before creating a topology revision");
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
  const state = loadRuntime(id);
  for (const repository of selectedRepositories(id, state))
    if (repository.type === "submodule")
      pathspec.push(`:(exclude)${repository.relativePath}`);
  const diff = git(["diff", "--binary", "HEAD", "--", ...pathspec], sandboxPath);
  if (diff.status !== 0) die("cannot inspect sandbox diff");
  if (!diff.stdout) {
    if (state.repositories && Object.keys(state.repositories).length > 1) return [];
    die("sandbox has no applicable diff");
  }
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

function refreshAppliedProjection(state) {
  const transactionId = state.workspace?.apply?.transactionId;
  const journalPath = transactionJournalPath(state.id, transactionId);
  if (!transactionId || !existsSync(journalPath))
    die("cannot refresh an applied projection without its transaction journal");
  const journal = readJson(journalPath);
  for (const entry of journal.entries) {
    const source = resolve(state.workspace.path, entry.path);
    const expected = pathIdentity(source);
    const current = pathIdentity(safeRootPath(entry.path));
    if (current !== expected)
      die(`cannot refresh diverged applied path '${entry.path}'`);
    entry.after = expected;
  }
  journal.projectionHash = stableHash(
    journal.entries.map(({ path, after }) => ({ path, after }))
  );
  journal.proofRunId = readJson(proofPath(state.id)).proofRunId;
  journal.status = "verified";
  journal.refreshedAt = now();
  saveApplyJournal(journal);
  state.workspace.apply.projectionHash = journal.projectionHash;
  state.workspace.apply.status = "verified";
  saveRuntime(state);
}

function applySandbox(id, options = {}) {
  const initialState = loadRuntime(id);
  if (initialState.repositories && Object.keys(initialState.repositories).length > 1 &&
      !options.controlPlane)
    die("multi-repository sandboxes do not apply as one local transaction; use land plan/record/resume");
  if (initialState.workspace?.applied && options.refresh)
    refreshAppliedProjection(initialState);
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
    const expectedPrefix = `${canonicalPath(tmpdir())}/foundation-${id}-`;
    if (!canonicalPath(path).startsWith(expectedPrefix))
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

function cleanupRepositorySandboxes(id, state) {
  const results = {};
  for (const [repositoryId, runtime] of Object.entries(state.repositories || {})) {
    if (repositoryId === "root" || runtime.mode !== "worktree" ||
        !runtime.path || !existsSync(runtime.path)) {
      results[repositoryId] = { status: "not-needed" };
      continue;
    }
    const expected = resolve(ROOT, ".foundation", "repository-sandboxes", id, repositoryId);
    if (resolve(runtime.path) !== expected) {
      results[repositoryId] = {
        status: "refused", reason: "repository sandbox path is outside the expected location"
      };
      continue;
    }
    const target = runtime.targetPath;
    const removed = git(["worktree", "remove", "--force", runtime.path], target);
    if (removed.status !== 0) {
      results[repositoryId] = { status: "failed", reason: removed.stderr.trim() };
      continue;
    }
    git(["worktree", "prune"], target);
    results[repositoryId] = { status: "removed" };
  }
  return results;
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
    if (initial.repositories && !initial.repositoryCleanup) {
      initial.repositoryCleanup = cleanupRepositorySandboxes(id, initial);
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
    if (initial.repositories)
      initial.repositoryCleanup = cleanupRepositorySandboxes(id, initial);
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
  assertMultiRepositoryArchiveReady(id, readiness.state);
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
    applySandbox(id, { controlPlane: true });
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
  if (state.repositories)
    state.repositoryCleanup = cleanupRepositorySandboxes(id, state);
  cleanupChangeLeases(id);
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

function changedFilesInWorkspace(id, workspace, knownHead = undefined) {
  const head = knownHead === undefined ? gitHead(workspace) : knownHead;
  if (head) {
    const result = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], workspace);
    if (result.status === 0) {
      const records = result.stdout.split("\0").filter(Boolean);
      const paths = [];
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        const status = record.slice(0, 2);
        paths.push(record.slice(3));
        if (/[RC]/.test(status) && records[index + 1]) paths.push(records[++index]);
      }
      return [...new Set(paths)].sort();
    }
  }
  return [];
}

function changedFiles(id, state) {
  const workspace = state.workspace?.path || ROOT;
  const gitFiles = changedFilesInWorkspace(id, workspace);
  if (gitHead(workspace)) return gitFiles;
  if (state.workspace?.mode === "copy" && state.workspace.baseline) {
    const current = workspaceManifest(workspace, id, true);
    return [...new Set([
      ...Object.keys(state.workspace.baseline), ...Object.keys(current)
    ])].filter((path) => state.workspace.baseline[path] !== current[path]).sort();
  }
  return [];
}

function canonicalChangedSurface(id, state = loadRuntime(id)) {
  const repositories = selectedRepositories(id, state);
  const rows = [];
  for (const repository of repositories) {
    const workspace = repository.workspacePath;
    const sources = new Map();
    const add = (path, source) => {
      if (!path) return;
      const normalized = path.replaceAll("\\", "/");
      if (EXCLUDED_WORKSPACE_DIRS.has(normalized.split("/")[0])) return;
      if (repository.id === "root" &&
          (isCurrentChangePath(normalized, id) || normalized.startsWith("openspec/changes/"))) return;
      if (!sources.has(normalized)) sources.set(normalized, new Set());
      sources.get(normalized).add(source);
    };
    const head = gitHead(workspace);
    if (head) {
      const baseHead = repository.id === "root"
        ? state.repositories?.root?.baseHead || state.workspace?.baseHead || null
        : state.repositories?.[repository.id]?.baseHead || null;
      if (!baseHead)
        die(`cannot resolve changed surface for repository '${repository.id}': missing baseHead; sync or recreate the change sandbox`);
      if (baseHead !== head) {
        const committed = git(["diff", "--name-only", "-z", `${baseHead}...HEAD`], workspace);
        if (committed.status !== 0)
          die(`cannot resolve changed surface for repository '${repository.id}' from base ${baseHead}`);
        committed.stdout.split("\0").filter(Boolean).forEach((path) => add(path, "committed"));
      }
      changedFilesInWorkspace(id, workspace, head).forEach((path) => add(path, "dirty"));
    } else if (repository.id === "root") {
      changedFiles(id, state).forEach((path) => add(path, "dirty"));
    }
    for (const [path, rowSources] of sources)
      rows.push({ repositoryId: repository.id, path, sources: [...rowSources].sort() });
  }
  return rows.sort((left, right) =>
    left.repositoryId.localeCompare(right.repositoryId) || left.path.localeCompare(right.path));
}

function policyCapabilities(id) {
  if (policyCache.has(id)) return policyCache.get(id);
  const state = loadRuntime(id);
  const files = canonicalChangedSurface(id, state)
    .map((row) => `${row.repositoryId}/${row.path}`);
  const relevantFiles = files
    .filter((path) => !path.startsWith("openspec/changes/") &&
      !path.startsWith("root/openspec/changes/"));
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
    if (relevantFiles.some((path) => policy.patterns.some((pattern) => pattern.test(path))))
      policy.capabilities.forEach((capability) => required.add(capability));
  const configured = readJson(join(ROOT, ".foundation", "policy.json"), { rules: [] });
  for (const rule of configured.rules || []) {
    if (!Array.isArray(rule.paths) || !Array.isArray(rule.capabilities)) continue;
    const matches = relevantFiles.some((path) => rule.paths.some((prefix) =>
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

function packetValue(id, repositoryId = null, taskId = null) {
  const state = loadRuntime(id);
  const activePath = activeChangePath(id, state);
  const contract = evidence(id, activePath);
  const allTasks = taskBlocks(readFileSync(join(activePath, "tasks.md"), "utf8"))
    .map(taskMetadata);
  const selectedTask = taskId
    ? allTasks.find((task) => task.id === String(taskId).toUpperCase())
    : null;
  if (taskId && !selectedTask) die(`unknown task '${taskId}'`);
  const effectiveRepositoryId = repositoryId || selectedTask?.repository || null;
  const repository = effectiveRepositoryId
    ? repositoryById(id, effectiveRepositoryId, state) : null;
  if (selectedTask && repository && selectedTask.repository !== repository.id)
    die(`task '${selectedTask.id}' is not assigned to repository '${repository.id}'`);
  const packetType = selectedTask ? "task" : repository ? "repository" : "global";
  const declaredClaimIds = new Set(contract.claims.map((claim) => claim.id));
  const unknownTaskClaims = (selectedTask?.claims || [])
    .filter((claim) => !declaredClaimIds.has(claim));
  if (unknownTaskClaims.length)
    die(`task '${selectedTask.id}' references unknown claim(s): ${unknownTaskClaims.join(", ")}`);
  const claims = contract.claims.filter((claim) => {
    if (selectedTask?.claims.length)
      return selectedTask.claims.includes(claim.id);
    return !repository || !claim.repositories ||
      claim.repositories.includes(repository.id);
  });
  if (selectedTask && claims.length === 0 &&
      !["inventory", "logs", "mechanical-docs"].includes(selectedTask.kind))
    die(`task '${selectedTask.id}' has no claims in repository '${selectedTask.repository}'`);
  const claimIds = new Set(claims.map((claim) => claim.id));
  const compositeSnapshot = repository
    ? readJson(snapshotPath(id), {})
    : relevantSnapshot(id);
  const hash = repository
    ? singleRelevantSnapshot(id, repository.workspacePath).workspaceHash
    : compositeSnapshot.workspaceHash;
  const providerRows = requiredProviders(id).map((provider) => {
    const check = receiptValidity(id, provider, hash);
    const config = providerConfig(id, provider);
    return {
      provider, adapter: config?.adapter || "external",
      repository: config?.repository || null,
      resources: config ? adapterResources(provider, config) : [],
      validity: check.validity, status: check.status || check.receipt?.status || null
    };
  }).filter((provider) => !repository ||
    !provider.repository || provider.repository === repository.id)
    .filter((provider) => {
      const covered = claimsForProvider(id, provider.provider).map((claim) => claim.id);
      return covered.length === 0 || covered.some((claim) => claimIds.has(claim));
    });
  if (selectedTask && claims.length > 0 && providerRows.length === 0)
    die(`task '${selectedTask.id}' has no provider coverage`);
  const packetSurface = canonicalChangedSurface(id, state);
  const multiRepositoryPacket = new Set(packetSurface.map((row) => row.repositoryId)).size > 1;
  let fileChanges = packetSurface
    .filter((row) => !repository || row.repositoryId === repository.id)
    .map((row) => repository || !multiRepositoryPacket
      ? row.path : `${row.repositoryId}/${row.path}`);
  if (selectedTask?.paths.length)
    fileChanges = fileChanges.filter((path) => selectedTask.paths.some((scope) => {
      const normalized = scope.replace(/\/\*\*?$/, "").replace(/\/$/, "");
      return scope === "*" || path === normalized || path.startsWith(`${normalized}/`);
    }));
  const changedFileLimit = packetType === "task" ? 50 : 100;
  const changedFileSummary = fileChanges.length <= changedFileLimit ? fileChanges : {
    count: fileChanges.length,
    digest: stableHash(fileChanges),
    groups: Object.entries(fileChanges.reduce((groups, path) => {
      const prefix = path.split("/").slice(0, 2).join("/");
      groups[prefix] = (groups[prefix] || 0) + 1;
      return groups;
    }, {})).sort(([left], [right]) => left.localeCompare(right))
      .map(([prefix, count]) => ({ prefix, count }))
  };
  const scopedTasks = allTasks.filter((task) =>
    (!repository || task.repository === repository.id) &&
    (!selectedTask || task.id === selectedTask.id));
  const taskRows = scopedTasks.map((task) => ({
    id: task.id, done: task.done, kind: task.kind,
    dependsOn: task.dependsOn,
    paths: compactStrings(task.paths, 20),
    resources: compactStrings(task.resources, 20),
    ...(packetType === "task" ? {
      text: task.text, claims: task.claims, model: modelForTask(id, task)
    } : {})
  }));
  const taskPayload = packetType === "global" ? {
    count: scopedTasks.length,
    pending: scopedTasks.filter((task) => !task.done).length,
    completed: scopedTasks.filter((task) => task.done).length,
    byRepository: Object.entries(scopedTasks.reduce((counts, task) => {
      counts[task.repository] = (counts[task.repository] || 0) + 1;
      return counts;
    }, {})).sort(([left], [right]) => left.localeCompare(right))
      .map(([repositoryIdValue, count]) => ({ repository: repositoryIdValue, count })),
    digest: stableHash(scopedTasks.map((task) => ({
      id: task.id, done: task.done, repository: task.repository,
      dependsOn: task.dependsOn
    })))
  } : compactList(taskRows, packetType === "task" ? 1 : 40);
  const artifactReferences = {};
  for (const name of [
    "proposal.md", "design.md", "tasks.md", "evidence.yaml",
    "execution.yaml", "repositories.yaml"
  ]) {
    const path = join(activePath, name);
    if (existsSync(path))
      artifactReferences[name] = {
        path: relative(ROOT, path).replaceAll("\\", "/"),
        sha256: fileDigest(path)
      };
  }
  const specsPath = join(activePath, "specs");
  if (existsSync(specsPath))
    artifactReferences.specs = {
      path: relative(ROOT, specsPath).replaceAll("\\", "/"),
      sha256: directoryHash(specsPath)
    };
  const invariantValues = Array.isArray(contract.invariants)
    ? contract.invariants.map((value) => String(value)) : [];
  const claimRows = claims.map((claim) => ({
    id: claim.id,
    ...(packetType === "global"
      ? { scenarioDigest: stableHash(String(claim.scenario)) }
      : { scenario: String(claim.scenario)
        .slice(0, packetType === "task" ? 500 : 240) }),
    capabilities: compactStrings(claim.capabilities, 12),
    repositories: claim.repositories
      ? compactStrings(claim.repositories, 12) : null
  }));
  const providers = compactList(providerRows, 30);
  const claimPayload = compactList(
    claimRows, packetType === "task" ? 20 : packetType === "repository" ? 25 : 40);
  const packet = {
    version: Number(PACKET_SCHEMA_VERSION),
    packetType, changeId: id, intent: state.intent, schema: state.schema,
    status: state.status, revision: Number(state.revision || 0),
    contractRevision: Number(state.contractRevision || 0),
    executionRevision: Number(state.executionRevision || 0),
    impact: state.impact, coupling: state.coupling,
    reviewRequired: Boolean(state.reviewRequired),
    changePath: relative(ROOT, activePath) || ".",
    repository: repository ? {
      id: repository.id, type: repository.type, mode: repository.mode,
      relativePath: repository.relativePath,
      dependsOn: repository.dependsOn || []
    } : null,
    workspacePath: repository?.workspacePath || state.workspace?.path || ROOT,
    workspaceHash: hash,
    compositeWorkspaceHash: compositeSnapshot.workspaceHash || null,
    pendingTaskCount: scopedTasks.filter((task) => !task.done).length,
    tasks: taskPayload,
    claims: claimPayload,
    providers, changedFiles: changedFileSummary,
    invariants: packetType === "global" ? {
      count: invariantValues.length,
      digest: stableHash(invariantValues),
      reference: "evidence.yaml#invariants"
    } : invariantValues.map((value) => value.slice(0, 300)).slice(0, 10),
    references: artifactReferences,
    budget: state.budget
  };
  return { ...packet, packetDigest: stableHash(packet) };
}

function reviewPacketValue(id) {
  const state = loadRuntime(id);
  const activePath = activeChangePath(id, state);
  const contract = evidence(id, activePath);
  const workspaceHash = relevantHash(id);
  const reviewClaims = scopedReviewClaims(contract.claims).map((claim) => ({
    id: claim.id,
    scenario: String(claim.scenario).slice(0, 240),
    impact: claim.impact,
    capabilities: claim.capabilities,
    repositories: claim.repositories || null
  }));
  const artifact = (name) => {
    const path = join(activePath, name);
    return existsSync(path) ? {
      path: relative(ROOT, path).replaceAll("\\", "/"),
      sha256: statSync(path).isDirectory() ? directoryHash(path) : fileDigest(path)
    } : null;
  };
  const surfaceRows = canonicalChangedSurface(id, state);
  const paths = surfaceRows.map((row) => `${row.repositoryId}/${row.path}`);
  const inspection = [...surfaceRows.reduce((groups, row) => {
    if (!groups.has(row.repositoryId)) groups.set(row.repositoryId, []);
    groups.get(row.repositoryId).push(row.path);
    return groups;
  }, new Map())].map(([repositoryId, repositoryPaths]) => ({
    repositoryId,
    baseHead: repositoryId === "root"
      ? state.repositories?.root?.baseHead || state.workspace?.baseHead || null
      : state.repositories?.[repositoryId]?.baseHead || null,
    paths: repositoryPaths
  }));
  const changedSurface = paths.length <= 60 ? {
    paths,
    digest: stableHash(paths),
    inspection
  } : {
    count: paths.length,
    digest: stableHash(paths),
    groups: compactList(Object.entries(paths.reduce((groups, path) => {
      const prefix = path.split("/").slice(0, 2).join("/");
      groups[prefix] = Number(groups[prefix] || 0) + 1;
      return groups;
    }, {})).sort(([left], [right]) => left.localeCompare(right))
      .map(([prefix, count]) => ({ prefix, count })), 30),
    inspection: inspection.map((entry) => ({
      ...entry,
      pathCount: entry.paths.length,
      paths: entry.paths.slice(0, 20),
      truncated: entry.paths.length > 20
    }))
  };
  const evidenceRows = requiredProviders(id)
    .filter((provider) => !["review", "acceptance"].includes(
      providerCapability(provider, providerConfig(id, provider))))
    .map((provider) => {
      const check = receiptValidity(id, provider, workspaceHash);
      const path = receiptPath(id, provider);
      const receipt = check.receipt || (existsSync(path) ? readJson(path, {}) : {});
      return {
        provider,
        capability: providerCapability(provider, providerConfig(id, provider)),
        validity: check.validity,
        status: check.status || receipt.status || null,
        observed: receipt.observed ? String(receipt.observed).slice(0, 240) : null,
        artifacts: (receipt.artifacts || []).slice(0, 5).map((value) => value.path),
        references: (receipt.references || []).slice(0, 5)
      };
    });
  const reviewProvider = requiredProviders(id).find((provider) =>
    providerCapability(provider, providerConfig(id, provider)) === "review") || "review";
  const prior = existsSync(receiptPath(id, reviewProvider))
    ? readJson(receiptPath(id, reviewProvider), {}) : null;
  const packet = {
    version: Number(REVIEW_PACKET_SCHEMA_VERSION),
    packetType: "review",
    changeId: id,
    intent: state.intent,
    workspaceHash,
    contractFingerprint: contractFingerprint(id),
    reviewPolicy: reviewPolicy(id, state, contract),
    acceptance: resolvedAcceptance(id, state, contract),
    claims: compactList(reviewClaims, 12),
    decisions: {
      proposal: artifact("proposal.md"),
      design: artifact("design.md"),
      specs: artifact("specs")
    },
    changedSurface: { ...changedSurface, rows: compactList(surfaceRows, 60) },
    evidence: compactList(evidenceRows, 15),
    priorReview: prior ? {
      round: prior.review?.round || null,
      status: prior.status || null,
      workspaceHash: prior.workspaceHash || null,
      observed: prior.observed ? String(prior.observed).slice(0, 240) : null,
      findings: prior.review?.findings || null,
      scope: prior.review?.scope || null
    } : null,
    unresolvedFindings: Number(prior?.review?.findings?.unresolvedBlockers || 0),
    references: {
      evidence: artifact("evidence.yaml"),
      tasks: artifact("tasks.md")
    }
  };
  return { ...packet, packetDigest: stableHash(packet) };
}

function showPacket(id, flags = {}) {
  if (flags.phase === "review" && flags.task)
    die("review packet does not accept --task; use its scoped references");
  const value = flags.phase === "review"
    ? reviewPacketValue(id)
    : packetValue(id, flags.repo || null, flags.task || null);
  if (flags.planDigest) value.planDigest = flags.planDigest;
  const encoded = serializedJson(value, Boolean(flags.pretty));
  const bytes = Buffer.byteLength(encoded);
  const limit = Number(foundationPolicy().execution.packetBytes[value.packetType]);
  if (bytes > limit) {
    const fields = Object.entries(value).map(([field, fieldValue]) => ({
      field, bytes: Buffer.byteLength(JSON.stringify(fieldValue))
    })).sort((left, right) => right.bytes - left.bytes).slice(0, 5);
    die(`${value.packetType} packet exceeds ${limit} bytes (${bytes}); largest fields: ${
      fields.map((entry) => `${entry.field}=${entry.bytes}`).join(", ")
    }; narrow the task or inspect referenced artifacts`);
  }
  recordContextMetric(id, `packet-${value.packetType}`, bytes, {
    repositoryId: value.repository?.id || null,
    taskId: flags.task || null,
    claims: Array.isArray(value.claims) ? value.claims.length : value.claims.count,
    providers: Array.isArray(value.providers) ? value.providers.length :
      Array.isArray(value.evidence) ? value.evidence.length : value.providers?.count || 0
  });
  process.stdout.write(encoded);
}

function recordContextMetric(id, kind, bytes, details = {}) {
  try {
    const dir = join(LOGS, id, "context-events");
    mkdirSync(dir, { recursive: true });
    const event = {
      version: Number(CONTEXT_EVENT_SCHEMA_VERSION),
      changeId: id, kind, bytes, ...details, timestamp: now()
    };
    const name = `${Date.now()}-${process.pid}-${stableHash(event).slice(0, 12)}.json`;
    writeJson(join(dir, name), event);
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name).sort();
    if (entries.length > 1000) {
      const lockPath = join(LOGS, id, "context-rollup.lock");
      let lock = null;
      try {
        try {
          lock = openSync(lockPath, "wx");
        } catch {
          if (existsSync(lockPath) &&
              Date.now() - statSync(lockPath).mtimeMs > 300000) {
            rmSync(lockPath, { force: true });
            lock = openSync(lockPath, "wx");
          }
        }
        if (lock !== null) {
          const rollupPath = join(LOGS, id, "context-rollup.json");
          const rollup = readJson(rollupPath, {
            version: 1, changeId: id, count: 0, totalBytes: 0, byKind: {}
          });
          for (const entry of entries.slice(0, 500)) {
            const path = join(dir, entry);
            const row = readJson(path, {});
            if (row.kind && Number.isFinite(Number(row.bytes))) {
              rollup.count += 1;
              rollup.totalBytes += Number(row.bytes);
              const summary = rollup.byKind[row.kind] ||= {
                count: 0, totalBytes: 0, maxBytes: 0
              };
              summary.count += 1;
              summary.totalBytes += Number(row.bytes);
              summary.maxBytes = Math.max(summary.maxBytes, Number(row.bytes));
            }
            rmSync(path, { force: true });
          }
          rollup.updatedAt = now();
          writeJson(rollupPath, rollup);
        }
      } finally {
        if (lock !== null) closeSync(lock);
        if (lock !== null) rmSync(lockPath, { force: true });
      }
    }
  } catch (error) {
    if (process.env.FOUNDATION_TELEMETRY_DEBUG === "1")
      console.error(`WARNING: context telemetry unavailable: ${error.message}`);
  }
}

function recordPhaseContext(id, phase) {
  try {
    const path = join(LOGS, id, "phase-context.jsonl");
    const prior = readJsonLinesTolerant(path).at(-1) || null;
    const host = claudeHostContext();
    const sessionId = host?.sessionId || process.env.FOUNDATION_SESSION_ID || null;
    const recommendedTier = {
      change: "deep",
      build: "standard",
      prove: "fast",
      land: "fast"
    }[phase] || "standard";
    const contextMode = !sessionId ? "unavailable" :
      !prior?.sessionId ? "initial" :
      prior.sessionId === sessionId ? "retained" : "fresh";
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({
      version: 1,
      changeId: id,
      phase,
      sessionId,
      contextMode,
      recommendedModelTier: recommendedTier,
      actualModel: process.env.FOUNDATION_MODEL_ID || null,
      trigger: process.env.FOUNDATION_PHASE_TRIGGER || null,
      priorPhase: prior?.phase || null,
      priorSessionId: prior?.sessionId || null,
      timestamp: now()
    })}\n`);
  } catch (error) {
    if (process.env.FOUNDATION_TELEMETRY_DEBUG === "1")
      console.error(`WARNING: phase telemetry unavailable: ${error.message}`);
  }
}

function eventTokenCount(event) {
  const values = [event.inputTokens, event.outputTokens, event.cacheTokens]
    .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  return values.length ? values.reduce((sum, value) => sum + Number(value), 0) : null;
}

function ensureBudgetTargets(state) {
  state.budget ||= {};
  if (!Number.isFinite(Number(state.budget.targetTokens))) {
    const configured = foundationPolicy().execution.tokenBudgets;
    state.budget.targetTokens = state.schema === "foundation-rapid"
      ? configured.rapid : configured.standard;
  }
  return state.budget;
}

function budgetDecision(state) {
  const budget = ensureBudgetTargets(state);
  const requestRatio = Number.isFinite(Number(budget.usedRequests))
    ? Number(budget.usedRequests) / Number(budget.targetRequests || 1) : 0;
  const tokenRatio = Number.isFinite(Number(budget.usedTokens))
    ? Number(budget.usedTokens) / Number(budget.targetTokens || 1) : 0;
  const ratio = Math.max(requestRatio, tokenRatio);
  const limiter = tokenRatio > requestRatio ? "tokens" : "requests";
  const action = ratio >= 1 ? "STOP_AND_SPLIT" : ratio >= 0.85 ? "STOP_EXPLORATION" :
    ratio >= 0.7 ? "BATCH_AND_REUSE" : "CONTINUE";
  return { ratio, limiter, action };
}

function reportBudget(id, state, stop = false, quiet = false) {
  const decision = budgetDecision(state);
  const message = `BUDGET ${id}: ${(decision.ratio * 100).toFixed(1)}% ${decision.action} (${decision.limiter})`;
  if (!quiet) console.log(message);
  else if (decision.ratio >= 0.7) console.error(`WARNING: ${message}`);
  if (stop && decision.ratio >= 1) process.exit(2);
  return decision;
}

function recordEvent(id, flags) {
  const state = loadRuntime(id);
  if (flags.repo) repositoryById(id, flags.repo, state);
  if (flags.task) {
    const taskId = String(flags.task).toUpperCase();
    const known = taskBlocks(readFileSync(join(activeChangePath(id), "tasks.md"), "utf8"))
      .some((task) => task.id === taskId);
    if (!known) die(`event references unknown task '${flags.task}'`);
    flags.task = taskId;
  }
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
    repositoryId: flags.repo || null,
    taskId: flags.task || null,
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
  const budget = ensureBudgetTargets(state);
  budget.usedRequests = Number(budget.usedRequests || 0) + 1;
  const eventTokens = eventTokenCount(event);
  if (eventTokens !== null) budget.usedTokens = Number(budget.usedTokens || 0) + eventTokens;
  state.budget.measurement = "external-events";
  saveRuntime(state);
  reportBudget(id, state, true);
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
    repositoryId: row.repositoryId || row.repository_id || row.repository || null,
    taskId: row.taskId || row.task_id || row.task || null,
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
    const allEvents = readJsonLines(target);
    const budget = ensureBudgetTargets(state);
    budget.usedRequests = allEvents.length;
    const knownTokens = allEvents.map(eventTokenCount).filter((value) => value !== null);
    budget.usedTokens = knownTokens.length
      ? knownTokens.reduce((sum, value) => sum + value, 0) : null;
    state.budget.measurement = format === "claude"
      ? "claude-transcript"
      : `host-events:${format}`;
    saveRuntime(state);
    reportBudget(id, state, true, true);
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

function readJsonLinesTolerant(path) {
  if (!existsSync(path)) return [];
  const rows = [];
  for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    try { rows.push(JSON.parse(line)); }
    catch {
      if (process.env.FOUNDATION_TELEMETRY_DEBUG === "1")
        console.error(`WARNING: skipped invalid telemetry row in ${relative(ROOT, path)}`);
    }
  }
  return rows;
}

function contextMetricState(id) {
  const rows = readJsonLinesTolerant(join(LOGS, id, "context.jsonl"));
  const dir = join(LOGS, id, "context-events");
  if (existsSync(dir))
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const row = readJson(join(dir, entry.name), {});
      if (row.kind && Number.isFinite(Number(row.bytes))) rows.push(row);
    }
  const rollup = readJson(join(LOGS, id, "context-rollup.json"), {
    count: 0, totalBytes: 0, byKind: {}
  });
  return { rows, rollup };
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
  const contextState = contextMetricState(id);
  const contextRows = contextState.rows;
  const contextRollup = contextState.rollup;
  const phaseContextRows = readJsonLines(join(LOGS, id, "phase-context.jsonl"));
  const reuseRows = readJsonLines(join(LOGS, id, "reuse.jsonl"));
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
  const groupUsage = (field) => {
    const result = {};
    for (const event of events) {
      const key = event[field] || "unknown";
      result[key] ||= {
        requests: 0, inputTokens: null, outputTokens: null,
        cacheTokens: null, cost: null
      };
      const row = result[key];
      row.requests += 1;
      for (const metric of ["inputTokens", "outputTokens", "cacheTokens", "cost"])
        if (event[metric] !== null && event[metric] !== undefined &&
            Number.isFinite(Number(event[metric])))
          row[metric] = Number(row[metric] || 0) + Number(event[metric]);
    }
    return result;
  };
  const contextByKind = {};
  for (const row of contextRows) {
    contextByKind[row.kind] ||= [];
    contextByKind[row.kind].push(Number(row.bytes || 0));
  }
  const context = Object.fromEntries(Object.entries(contextByKind)
    .map(([kind, values]) => {
      const sorted = [...values].sort((left, right) => left - right);
      const percentile = (ratio) => sorted[Math.min(
        sorted.length - 1, Math.floor((sorted.length - 1) * ratio)
      )] || 0;
      return [kind, {
        count: values.length,
        totalBytes: values.reduce((sum, value) => sum + value, 0),
        medianBytes: percentile(0.5),
        p95Bytes: percentile(0.95),
        maxBytes: sorted.at(-1) || 0
      }];
    }));
  for (const [kind, archived] of Object.entries(contextRollup.byKind || {})) {
    const summary = context[kind] ||= {
      count: 0, totalBytes: 0, medianBytes: null, p95Bytes: null, maxBytes: 0
    };
    summary.count += Number(archived.count || 0);
    summary.totalBytes += Number(archived.totalBytes || 0);
    summary.maxBytes = Math.max(summary.maxBytes || 0, Number(archived.maxBytes || 0));
    summary.archivedCount = Number(archived.count || 0);
  }
  const currentContextBytes = contextRows.reduce(
    (sum, row) => sum + Number(row.bytes || 0), 0);
  const contextBytes = contextRows.length || Number(contextRollup.count || 0)
    ? currentContextBytes + Number(contextRollup.totalBytes || 0) : null;
  const operationActiveTimeMs = operations.length
    ? operations.reduce((sum, row) => sum + Number(row.durationMs || 0), 0) : null;
  const evidenceExecutionTimeMs = executions.size
    ? [...executions.values()].reduce((sum, value) => sum + value, 0) : null;
  const activeTimeMs = operationActiveTimeMs === null
    ? evidenceExecutionTimeMs
    : evidenceExecutionTimeMs === null
      ? operationActiveTimeMs
      : Math.max(operationActiveTimeMs, evidenceExecutionTimeMs);
  const wallTimeMs = operations.length
    ? Math.max(...operations.map((row) => Date.parse(row.finishedAt))) -
      Math.min(...operations.map((row) => Date.parse(row.startedAt))) : null;
  const contextModes = {};
  for (const row of phaseContextRows)
    contextModes[row.contextMode || "unknown"] =
      Number(contextModes[row.contextMode || "unknown"] || 0) + 1;
  console.log(JSON.stringify({
    version: 3, changeId: id,
    wallTimeMs,
    activeTimeMs,
    unattributedWaitMs: wallTimeMs === null || activeTimeMs === null
      ? null : Math.max(0, wallTimeMs - activeTimeMs),
    humanWaitMs: null,
    humanWaitReason: "not inferred without an explicit host/user transition signal",
    phases, providers,
    evidenceExecutionTimeMs,
    requests: events.length || null,
    inputTokens: sumKnown(events, "inputTokens"),
    outputTokens: sumKnown(events, "outputTokens"),
    cacheCreationTokens: sumKnown(events, "cacheCreationTokens"),
    cacheReadTokens: sumKnown(events, "cacheReadTokens"),
    cacheTokens: sumKnown(events, "cacheTokens"),
    cost: totalCost,
    byModel: groupUsage("modelId"),
    byRepository: groupUsage("repositoryId"),
    byTask: groupUsage("taskId"),
    context: {
      totalBytes: contextBytes,
      estimatedTokens: contextBytes === null ? null : Math.ceil(contextBytes / 4),
      measurement: "emitted-plan-and-packet-bytes-only",
      estimateBasis: "four-bytes-per-token",
      excluded: [
        "always-on-rules", "loaded-skills", "artifact-reads",
        "tool-results", "conversation-history"
      ],
      byKind: context,
      retainedEvents: contextRows.length,
      archivedEvents: Number(contextRollup.count || 0),
      phaseTransitions: phaseContextRows,
      modes: contextModes
    },
    evidenceReuse: {
      count: reuseRows.length,
      byReason: reuseRows.reduce((result, row) => {
        const reason = row.reason || "unknown";
        result[reason] = Number(result[reason] || 0) + 1;
        return result;
      }, {})
    },
    rework: {
      failedOperations: operations.filter((row) => row.status !== "completed").length,
      providerRebindings: reuseRows.length
    },
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

  if (flags.unattended) {
    if (!flags.change) die("doctor --unattended requires --change <id>");
    const isolation = isolationInspection(flags.change, flags);
    checks.push({
      level: isolation.execution.safeForUnattended ? "ok" : "error",
      name: "unattended-security-boundary",
      detail: isolation.execution.safeForUnattended
        ? `${isolation.securityBoundary.kind} detected without host-control hazards`
        : isolation.execution.reasons.join("; ")
    });
  }
  const nodeParts = process.versions.node.split(".").map(Number);
  const nodeOk = nodeParts[0] > 20 || (nodeParts[0] === 20 && nodeParts[1] >= 19);
  checks.push({ level: nodeOk ? "ok" : "error", name: "node", detail: process.versions.node });
  const protocols = protocolDescriptor();
  const protocolOk = String(protocols.runtimeApi) === RUNTIME_API_VERSION &&
    String(protocols.providerProtocol) === PROVIDER_PROTOCOL_VERSION &&
    String(protocols.adapterProtocol) === ADAPTER_PROTOCOL_VERSION &&
    String(protocols.proofProtocol) === PROOF_PROTOCOL_VERSION &&
    String(protocols.packetSchema) === PACKET_SCHEMA_VERSION &&
    String(protocols.agentPlanSchema) === AGENT_PLAN_SCHEMA_VERSION &&
    String(protocols.contextEventSchema) === CONTEXT_EVENT_SCHEMA_VERSION &&
    String(protocols.reviewProtocol) === REVIEW_PROTOCOL_VERSION &&
    String(protocols.acceptanceProtocol) === ACCEPTANCE_PROTOCOL_VERSION &&
    String(protocols.reviewPacketSchema) === REVIEW_PACKET_SCHEMA_VERSION;
  checks.push({
    level: protocolOk ? "ok" : "error",
    name: "protocol-bundle",
    detail: protocolOk
      ? `runtime API ${RUNTIME_API_VERSION}; provider ${PROVIDER_PROTOCOL_VERSION}; proof ${PROOF_PROTOCOL_VERSION}; packet ${PACKET_SCHEMA_VERSION}; review ${REVIEW_PROTOCOL_VERSION}/${REVIEW_PACKET_SCHEMA_VERSION}; acceptance ${ACCEPTANCE_PROTOCOL_VERSION}; plan ${AGENT_PLAN_SCHEMA_VERSION}; context ${CONTEXT_EVENT_SCHEMA_VERSION}`
      :
      "protocol.json is incompatible with foundation.mjs; reinstall Foundation"
  });
  const catalog = repositoryCatalog();
  checks.push({
    level: catalog.drift.length ? "warn" : "ok",
    name: "repository-topology",
    detail: catalog.drift.length
      ? `unregistered submodules: ${catalog.drift.map((item) => item.path).join(", ")}`
      : `${catalog.repositories.length} repository node(s)`
  });
  const modelPolicy = foundationPolicy();
  checks.push({
    level: "ok",
    name: "model-policy",
    detail: `fast=${modelPolicy.models.fast.family}; standard=${modelPolicy.models.standard.family}; deep=${modelPolicy.models.deep.family}; max-parallel=${modelPolicy.execution.maxParallelAgents}`
  });
  checks.push({
    level: modelPolicy.execution.legacyNumericPacketBytes === undefined
      ? "ok" : "warn",
    name: "packet-policy",
    detail: modelPolicy.execution.legacyNumericPacketBytes === undefined
      ? `task=${modelPolicy.execution.packetBytes.task}; review=${modelPolicy.execution.packetBytes.review}; repository=${modelPolicy.execution.packetBytes.repository}; global=${modelPolicy.execution.packetBytes.global}`
      : `legacy numeric limit ${modelPolicy.execution.legacyNumericPacketBytes}; migrate to scoped task/repository/global limits`
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
    const selected = selectedRepositories(requestedChange, state);
    for (const repository of selected) {
      const available = existsSync(repository.path);
      const initialized = available && (
        repository.type === "external" ||
        Boolean(gitHead(repository.path))
      );
      checks.push({
        level: initialized ? "ok" : (repository.mode === "write" ? "error" : "warn"),
        name: `repository:${repository.id}`,
        detail: !available ? "missing" :
          initialized ? `${repository.type}; ${repository.mode}; ${repository.relativePath}` :
            "not initialized as Git"
      });
    }
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
      const providerCwd = providerWorkspace(requestedChange, provider, config);
      const commandAvailable = commandExists(executable, providerCwd);
      checks.push({
        level: commandAvailable ? "ok" : (stage === "prove" ? "error" : "info"),
        name: `provider:${provider}:command`,
        detail: commandAvailable ? executable :
          `${executable || "missing"} ${stage === "prove" ? "unavailable" : "planned"}`
      });
      if (config.adapter === "playwright") {
        const providerPlaywright = playwrightAvailability(providerCwd);
        checks.push({
          level: providerPlaywright.packageOwned && providerPlaywright.binaryAvailable ? "ok" :
            (stage === "prove" ? "error" : "info"),
          name: "playwright:package",
          detail: providerPlaywright.packageOwned && providerPlaywright.binaryAvailable ? "project-owned dependency available" :
            "install and lock @playwright/test in the project"
        });
        checks.push({
          level: providerPlaywright.config ? "ok" : "warn",
          name: "playwright:config",
          detail: providerPlaywright.config || "no config found; command must provide complete setup"
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

  if (flags.json) console.log(JSON.stringify({ version: 1, stage, checks }, null, 2));
  else for (const check of checks)
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
  doctor [--stage change|build|prove] [--require-archive] [--change <id>] [--unattended] [--json]
  repos [change]
  models
  agent-plan <change> [--group <n>] [--full] [--pretty]
  agent-task <change> <task> [--pretty]
  agent-acquire <change> <task> --owner <agent-id>
  agent-release <change> <task> --owner <agent-id>
  new <intent> [--id <id>] [--rapid] [--draft <project-file.json>]
  resolve <change> --impact <low|medium|high> --coupling <isolated|coupled>
  changes
  providers
  packet <change> [--phase change|build|prove|review|land] [--repo <id>] [--task <id>] [--pretty]
  metrics <change>
  validate <change>
  hash <change>
  proof-plan <change>
  proof-readiness <change>
  proof-run <change>
  proof-preflight <change>
  proof-execute <change>
  proof-audit <change>
  receipt <change> <provider> <pass|fail|inconclusive|error> [--claims=a,b]
  evidence-upgrade <change>
  run-provider <change> <provider> -- <command> [args...]
  prove <change>
  land-check <change>
  land-plan <change>
  land-record <change> --repo <id> --commit <sha> [--ci pass|fail|pending]
  land-pointers <change>
  land-resume <change>
  sandbox inspect <change> [--json] [--unattended]
  sandbox create <change> [--all] [--unattended]
  sandbox sync|apply <change>
  archive <change>
  event <change> --request <id> [metrics...]
  telemetry-sync <change> [transcript.jsonl]
  telemetry-import <change> <file> [--format generic|codex|claude]
  migrate [legacy-id] [--apply]`);
}

const [command, ...values] = process.argv.slice(2);
const unattendedMentioned = command === "sandbox" &&
  ["create", "inspect"].includes(values[0]) &&
  values.slice(1).some((value) =>
    value === "--unattended" || value.startsWith("--unattended="));
const telemetrySuppressed = command === "sandbox" && (
  values[0] === "inspect" ||
  (values[0] === "create" && unattendedMentioned)
);
if (telemetrySuppressed) process.env.FOUNDATION_TELEMETRY = "0";
operationName = command || null;
operationChangeId = command === "sandbox" ? values[1] :
  ["resolve", "validate", "hash", "packet", "agent-plan", "agent-task", "agent-acquire", "agent-release", "metrics", "proof-plan", "proof-readiness", "proof-run", "proof-preflight", "proof-execute", "proof-audit", "evidence-upgrade", "receipt", "run-provider", "prove",
    "land-check", "land-plan", "land-record", "land-pointers", "land-resume", "archive", "event", "telemetry-sync", "telemetry-import"].includes(command) ? values[0] : null;

const telemetryPhase = {
  resolve: "change",
  "evidence-upgrade": "change",
  sandbox: "build",
  "proof-plan": "prove",
  "proof-readiness": "prove",
  "proof-run": "prove",
  "proof-preflight": "prove",
  "proof-execute": "prove",
  "proof-audit": "prove",
  receipt: "prove",
  "run-provider": "prove",
  prove: "prove",
  "land-check": "land",
  "land-plan": "land",
  "land-record": "land",
  "land-pointers": "land",
  "land-resume": "land",
  archive: "land"
}[command];
if (!telemetrySuppressed && operationChangeId && telemetryPhase && existsSync(runtimePath(operationChangeId)))
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
  case "repos": showRepositories(values[0] || null); break;
  case "models": console.log(JSON.stringify(foundationPolicy().models, null, 2)); break;
  case "agent-plan": {
    const { flags, rest } = parseFlags(values);
    showAgentPlan(rest[0], flags); break;
  }
  case "agent-task": {
    const { flags, rest } = parseFlags(values);
    showAgentTask(rest[0], rest[1], flags); break;
  }
  case "agent-acquire": {
    const { flags, rest } = parseFlags(values);
    acquireAgentLease(rest[0], rest[1], flags); break;
  }
  case "agent-release": {
    const { flags, rest } = parseFlags(values);
    releaseAgentLease(rest[0], rest[1], flags); break;
  }
  case "packet": {
    const { flags, rest } = parseFlags(values);
    if (flags.phase && !["change", "build", "prove", "review", "land"].includes(flags.phase))
      die("packet --phase must be change|build|prove|review|land");
    if (flags.phase && flags.phase !== "review") {
      prepareClaudeTelemetry(rest[0], flags.phase);
      recordPhaseContext(rest[0], flags.phase);
    }
    showPacket(rest[0], flags); break;
  }
  case "metrics": showMetrics(values[0]); break;
  case "doctor": {
    const { flags, rest } = parseStrictCommandFlags(values, "doctor", {
      boolean: ["require-archive", "unattended", "json"],
      value: ["stage", "change"]
    });
    if (rest.length) die(`unexpected doctor argument(s): ${rest.join(", ")}`);
    doctor(flags); break;
  }
  case "validate": validate(values[0]); break;
  case "hash": console.log(relevantHash(values[0])); break;
  case "proof-plan": proofPlan(values[0]); break;
  case "proof-readiness": proofReadiness(values[0]); break;
  case "proof-run": await proofRun(values[0]); break;
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
  case "land-plan": showLandPlan(values[0]); break;
  case "land-record": {
    const { flags, rest } = parseFlags(values);
    recordRepositoryLand(rest[0], flags); break;
  }
  case "land-pointers": stageRootPointers(values[0]); break;
  case "land-resume": resumeLand(values[0]); break;
  case "sandbox":
    if (values[0] === "inspect") {
      const { flags, rest } = parseStrictCommandFlags(
        values.slice(1), "sandbox inspect", { boolean: ["json", "unattended"] }
      );
      if (rest.length !== 1) die("sandbox inspect requires exactly one change");
      showSandboxInspection(rest[0], flags);
    }
    else if (values[0] === "create") {
      const { flags, rest } = parseStrictCommandFlags(
        values.slice(1), "sandbox create", { boolean: ["all", "unattended"] }
      );
      if (rest.length !== 1) die("sandbox create requires exactly one change");
      createSandbox(rest[0], flags);
    }
    else if (values[0] === "sync") syncSandbox(values[1]);
    else if (values[0] === "apply") {
      const { flags, rest } = parseFlags(values.slice(1));
      applySandbox(rest[0], flags);
    }
    else die("sandbox requires inspect|create|sync|apply <change>");
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
