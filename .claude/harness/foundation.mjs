#!/usr/bin/env node

import {
  appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync,
  mkdtempSync, rmSync, writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const VERSION = "1.0.0";
const RUNTIME_API_VERSION = "1";
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
function runtimePath(id) { return join(RUNTIME, `${id}.json`); }
function changePath(id) { return join(CHANGES, id); }
function receiptPath(id, provider) { return join(RECEIPTS, id, `${provider}.json`); }
function proofPath(id) { return join(RECEIPTS, id, "proof.json"); }

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

function relevantHash(id, workspaceOverride = null) {
  const state = existsSync(runtimePath(id)) ? readJson(runtimePath(id)) : {};
  const workspace = resolve(workspaceOverride || state.workspace?.path || ROOT);
  const hash = createHash("sha256");
  const excludedDirs = new Set([".git", ".foundation", ".workflow", "node_modules", "coverage", "test-results"]);
  const files = [];
  function collect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (excludedDirs.has(entry.name)) continue;
      const path = join(dir, entry.name);
      const rel = relative(workspace, path).replaceAll("\\", "/");
      if (rel.startsWith("openspec/changes/archive/")) continue;
      if (rel.startsWith("openspec/changes/") &&
          !rel.startsWith(`openspec/changes/${id}/`)) continue;
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
  const excludedDirs = new Set([".git", ".foundation", ".workflow", "node_modules", "coverage", "test-results"]);
  function collect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (excludedDirs.has(entry.name)) continue;
      const path = join(dir, entry.name);
      const rel = relative(workspace, path).replaceAll("\\", "/");
      if (rel.startsWith("openspec/changes/archive/")) continue;
      if (rel.startsWith("openspec/changes/") &&
          (excludeChange || !rel.startsWith(`openspec/changes/${id}/`))) continue;
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
    budget: { targetRequests: schema === "foundation-rapid" ? 80 : 160, usedRequests: 0 },
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

function evidence(id) {
  const path = join(changePath(id), "evidence.yaml");
  const value = readJson(path);
  if (value.version !== 1 || !Array.isArray(value.claims) || value.claims.length === 0)
    die(`${id}/evidence.yaml must contain at least one claim`);
  const ids = new Set();
  for (const claim of value.claims) {
    if (!claim.id || ids.has(claim.id)) die(`evidence claim IDs must be non-empty and unique`);
    ids.add(claim.id);
    if (!claim.scenario || !Array.isArray(claim.capabilities) || claim.capabilities.length === 0)
      die(`claim '${claim.id}' needs scenario and capabilities`);
    for (const provider of claim.capabilities)
      if (!PROVIDERS.has(provider)) die(`claim '${claim.id}' uses unknown provider '${provider}'`);
  }
  return value;
}

function pendingTasks(id) {
  const state = loadRuntime(id);
  const workspace = state.workspace?.path || ROOT;
  const content = readFileSync(join(workspace, "openspec", "changes", id, "tasks.md"), "utf8");
  return content.split("\n").filter((line) =>
    /^\s*-\s*\[\s\]/.test(line) && !line.includes("/prove"));
}

function validate(id) {
  const state = loadRuntime(id);
  const dir = changePath(id);
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
  const claims = evidence(id).claims;
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

function receiptValidity(id, provider, hash = relevantHash(id)) {
  const path = receiptPath(id, provider);
  if (!existsSync(path)) return { provider, validity: "missing" };
  const value = readJson(path);
  if (value.workspaceHash !== hash) return { provider, validity: "stale", status: value.status };
  if (value.status !== "pass") return { provider, validity: value.status };
  const requiredClaims = evidence(id).claims
    .filter((claim) => claim.capabilities.includes(provider) ||
      (provider === "discovery" && claim.capabilities.includes("test")) ||
      provider === "review")
    .map((claim) => claim.id);
  const covered = new Set(value.claims || []);
  if (requiredClaims.some((claim) => !covered.has(claim)))
    return { provider, validity: "incomplete-claims", status: value.status };
  return { provider, validity: "valid", receipt: value };
}

function proofPlan(id) {
  validate(id);
  const hash = relevantHash(id);
  const rows = requiredProviders(id).map((provider) => receiptValidity(id, provider, hash));
  console.log(`PROOF PLAN ${id}\n  workspace: ${hash}`);
  for (const row of rows) console.log(`  ${row.provider}: ${row.validity}`);
}

function recordReceipt(id, provider, status, flags = {}) {
  if (!PROVIDERS.has(provider)) die(`unknown provider '${provider}'`);
  if (!["pass", "fail", "inconclusive", "error"].includes(status)) die(`invalid receipt status '${status}'`);
  const allClaims = evidence(id).claims.map((claim) => claim.id);
  const requestedClaims = String(flags.claims || allClaims.join(",")).split(",").filter(Boolean);
  const unknownClaims = requestedClaims.filter((claim) => !allClaims.includes(claim));
  if (unknownClaims.length) die(`receipt references unknown claim(s): ${unknownClaims.join(", ")}`);
  const receipt = {
    version: 1, changeId: id, provider, providerVersion: flags.version || "1",
    workspaceHash: relevantHash(id), claims: requestedClaims,
    status, observed: flags.observed || "", capability: {
      inputMode: flags["input-mode"] || null,
      foregroundRequired: flags.foreground === "required",
      foregroundAvailable: flags.foreground === "available" || flags.foreground === "not-required"
    },
    command: flags.command || null, log: flags.log || null,
    startedAt: flags.started || now(), finishedAt: now()
  };
  if (provider === "browser" && status === "pass" && receipt.capability.foregroundRequired &&
      !receipt.capability.foregroundAvailable) die("browser cannot pass when required foreground input is unavailable");
  if (provider === "browser" && status === "pass" &&
      !["dom-event", "os-input", "both"].includes(receipt.capability.inputMode))
    die("passing browser receipt requires --input-mode dom-event|os-input|both");
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
  const command = values[split + 1];
  const commandArgs = values.slice(split + 2);
  const started = now();
  const result = spawnSync(command, commandArgs, {
    cwd: loadRuntime(id).workspace?.path || ROOT, encoding: "utf8",
    env: { ...process.env, FOUNDATION_CHANGE_ID: id }
  });
  const logDir = join(LOGS, id);
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `${provider}-${Date.now()}.log`);
  writeFileSync(logPath, `${result.stdout || ""}${result.stderr || ""}`);
  recordReceipt(id, provider, result.status === 0 ? "pass" : "fail", {
    started, command: [command, ...commandArgs].join(" "),
    log: relative(ROOT, logPath), observed: `exit ${result.status ?? "error"}`
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function prove(id) {
  validate(id);
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
  const proof = existsSync(proofPath(id)) ? readJson(proofPath(id)) : null;
  if (!proof || proof.status !== "pass") die(`change '${id}' has no passing proof`);
  const hash = relevantHash(id);
  if (proof.workspaceHash !== hash) die(`proof is stale (${proof.workspaceHash.slice(0, 8)} != ${hash.slice(0, 8)})`);
  for (const provider of requiredProviders(id)) {
    const check = receiptValidity(id, provider, hash);
    if (check.validity !== "valid") die(`${provider} evidence is ${check.validity}`);
  }
  console.log(`LAND READY ${id}\n  workspace: ${hash}`);
}

function createCopySandbox(id, state, reason) {
  const path = mkdtempSync(join(tmpdir(), `foundation-${id}-`));
  cpSync(ROOT, path, {
    recursive: true,
    filter: (source) => {
      const rel = relative(ROOT, source).replaceAll("\\", "/");
      return rel === "" && source === ROOT || !(
        rel === ".git" || rel.startsWith(".git/") ||
        rel === ".foundation" || rel.startsWith(".foundation/") ||
        rel === "node_modules" || rel.startsWith("node_modules/") ||
        rel === ".workflow" || rel.startsWith(".workflow/")
      );
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
  if (state.workspace?.mode === "worktree" && existsSync(state.workspace.path))
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
  landCheck(id);
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
    `:(exclude)openspec/changes/${id}/**`
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
  saveRuntime(state);
  const targetHash = relevantHash(id, ROOT);
  if (targetHash !== sandboxHash) die("post-apply workspace identity mismatch");
  console.log(`APPLIED ${id}\n  workspace: ${targetHash}`);
}

function archive(id) {
  landCheck(id);
  const state = loadRuntime(id);
  if (state.workspace?.mode === "worktree" && !state.workspace.applied)
    die("sandbox diff has not been applied");
  const installed = spawnSync("openspec", ["--version"], { cwd: ROOT, encoding: "utf8" });
  if (installed.error?.code === "ENOENT")
    die("OpenSpec CLI is required for safe spec sync and archive (@fission-ai/openspec@1.7.0)");
  const installedVersion = `${installed.stdout || ""}${installed.stderr || ""}`;
  if (!installedVersion.includes("1.7.0"))
    die(`OpenSpec version mismatch; required 1.7.0, found '${installedVersion.trim()}'`);
  const cli = spawnSync("openspec", ["archive", id, "--yes"], { cwd: ROOT, encoding: "utf8" });
  if (cli.status !== 0) die(`OpenSpec archive failed: ${(cli.stderr || cli.stdout).trim()}`);
  state.status = "archived"; state.archivedAt = now(); saveRuntime(state);
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

function recordEvent(id, flags) {
  const state = loadRuntime(id);
  const event = {
    runId: flags.run || id, operationId: flags.operation || "unknown",
    agentId: flags.agent || null, modelId: flags.model || null,
    requestId: flags.request || null, parentRequestId: flags.parent || null,
    timestamp: now(), inputTokens: Number(flags.input || 0), outputTokens: Number(flags.output || 0),
    cacheTokens: Number(flags.cache || 0), cost: Number(flags.cost || 0),
    tool: flags.tool || null, workspaceHash: relevantHash(id), changeId: id
  };
  if (!event.requestId) die("event requires --request for unique telemetry identity");
  const path = join(LOGS, id, "events.jsonl"); mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
  state.budget.usedRequests = Number(state.budget.usedRequests || 0) + 1;
  const ratio = state.budget.usedRequests / Number(state.budget.targetRequests || 1);
  saveRuntime(state);
  const action = ratio >= 1 ? "STOP_AND_SPLIT" : ratio >= 0.85 ? "STOP_EXPLORATION" :
    ratio >= 0.7 ? "BATCH_AND_REUSE" : "CONTINUE";
  console.log(`BUDGET ${id}: ${(ratio * 100).toFixed(1)}% ${action}`);
  if (ratio >= 1) process.exit(2);
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
  new <intent> [--id <id>] [--rapid]
  resolve <change> --impact <low|medium|high> --coupling <isolated|coupled>
  changes
  providers
  validate <change>
  hash <change>
  proof-plan <change>
  receipt <change> <provider> <pass|fail|inconclusive|error> [--claims=a,b]
  run-provider <change> <provider> -- <command> [args...]
  prove <change>
  land-check <change>
  sandbox create|sync|apply <change>
  archive <change>
  event <change> --request <id> [metrics...]
  migrate [legacy-id] [--apply]`);
}

const [command, ...values] = process.argv.slice(2);
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
  case "validate": validate(values[0]); break;
  case "hash": console.log(relevantHash(values[0])); break;
  case "proof-plan": proofPlan(values[0]); break;
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
