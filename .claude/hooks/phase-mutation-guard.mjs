#!/usr/bin/env node

// Phase-aware PreToolUse guard. Rollout is deliberately audit-only by default.
// Hosts enable enforcement with FOUNDATION_GUARDRAIL_MODE=block after exporting
// FOUNDATION_ACTIVE_PHASE and, for Build, FOUNDATION_WORKSPACE_ROOT.

import { appendFileSync, existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const mode = (process.env.FOUNDATION_GUARDRAIL_MODE || "audit").toLowerCase();
if (mode === "off") process.exit(0);

let event;
try {
  event = JSON.parse(await readStdin());
} catch {
  process.exit(0); // A broken hook must not brick the host.
}

const tool = String(event.tool_name || "");
const input = event.tool_input || {};
const mutatingTools = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
if (!mutatingTools.has(tool) && tool !== "Bash") process.exit(0);
if (tool === "Bash" && !looksMutating(String(input.command || ""))) process.exit(0);

const projectRoot = canonical(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const phase = String(process.env.FOUNDATION_ACTIVE_PHASE || "").toLowerCase();
const violations = [];

if (!phase) {
  violations.push("active phase is unavailable");
} else if (!new Set(["change", "build", "prove", "land"]).has(phase)) {
  violations.push(`unsupported active phase: ${phase}`);
} else if (tool === "Bash") {
  inspectBash(String(input.command || ""));
} else {
  for (const rawPath of eventPaths(input)) inspectPath(rawPath);
}

if (violations.length === 0) process.exit(0);

const reason = `phase guard (${phase || "unknown"}/${tool}): ${violations.join("; ")}`;
recordAudit({ phase: phase || "unknown", tool, mode, reason });

if (mode === "block") {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

function inspectPath(rawPath) {
  const target = canonicalTarget(rawPath, projectRoot);
  if (!target) {
    violations.push("mutation target is missing or invalid");
    return;
  }

  if (isWithin(target, join(projectRoot, ".foundation"))) return;

  if (phase === "change") {
    if (!isWithin(target, join(projectRoot, "openspec", "changes")))
      violations.push("Change may write only OpenSpec change drafts or .foundation state");
    return;
  }

  if (phase === "prove") {
    violations.push("Prove keeps product and instruction files read-only");
    return;
  }

  if (phase === "land") {
    if (process.env.FOUNDATION_LAND_TRANSACTION !== "1")
      violations.push("Land mutations require the runtime transaction marker");
    return;
  }

  if (phase === "build") {
    const workspace = process.env.FOUNDATION_WORKSPACE_ROOT;
    if (!workspace) {
      violations.push("Build workspace is unavailable");
      return;
    }
    const roots = [canonicalTarget(workspace, projectRoot), ...allowedPaths()];
    if (!roots.some((root) => root && isWithin(target, root)))
      violations.push("Build mutation is outside its isolated workspace and declared paths");
  }
}

function inspectBash(command) {
  if (!looksMutating(command)) return;
  if (phase === "prove" || phase === "change") {
    violations.push(`${phase === "prove" ? "Prove" : "Change"} cannot run mutating shell commands`);
  } else if (phase === "land" && process.env.FOUNDATION_LAND_TRANSACTION !== "1") {
    violations.push("Land shell mutations require the runtime transaction marker");
  } else if (phase === "build" && !process.env.FOUNDATION_WORKSPACE_ROOT) {
    violations.push("Build shell mutations require an isolated workspace");
  }
}

function looksMutating(command) {
  // Conservative command-word screening. This intentionally does not claim to
  // be a shell sandbox; enforcement of arbitrary shell effects belongs to the host.
  const stripped = command.replace(/(['"])(?:\\.|(?!\1).)*\1/g, " ");
  return /(^|[;&|`()]|\b(?:then|do)\b)\s*(?:sudo\s+|env\s+)*(?:rm|mv|cp|install|mkdir|touch|truncate|tee|chmod|chown|git\s+(?:commit|push|merge|rebase|checkout|switch|reset|clean|apply)|npm\s+(?:install|publish)|pnpm\s+(?:install|publish)|yarn\s+(?:add|install|publish))\b/m.test(stripped)
    || /(?:^|[^<])(?:>>?|2>>?)\s*[^&]/m.test(stripped);
}

function eventPaths(value) {
  const paths = [];
  if (typeof value.file_path === "string") paths.push(value.file_path);
  if (typeof value.notebook_path === "string") paths.push(value.notebook_path);
  if (Array.isArray(value.edits)) {
    for (const edit of value.edits) if (typeof edit?.file_path === "string") paths.push(edit.file_path);
  }
  return paths;
}

function allowedPaths() {
  try {
    const values = JSON.parse(process.env.FOUNDATION_ALLOWED_PATHS_JSON || "[]");
    return Array.isArray(values) ? values.map((value) => canonicalTarget(value, projectRoot)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function canonicalTarget(value, base) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return null;
  const absolute = isAbsolute(value) ? resolve(value) : resolve(base, value);
  let cursor = absolute;
  const suffix = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    suffix.unshift(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    cursor = parent;
  }
  try {
    if (lstatSync(cursor).isSymbolicLink()) cursor = realpathSync(cursor);
    else cursor = realpathSync(cursor);
    return resolve(cursor, ...suffix);
  } catch {
    return null;
  }
}

function canonical(value) {
  try { return realpathSync(resolve(value)); } catch { return resolve(value); }
}

function isWithin(target, root) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function recordAudit(row) {
  try {
    const logDir = join(projectRoot, ".foundation", "logs");
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
    appendFileSync(join(logDir, "guardrail-audit.jsonl"), `${JSON.stringify({
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      ...row,
    })}\n`, { mode: 0o600 });
  } catch {
    // Audit storage failure must not transform audit-only rollout into a block.
  }
}

async function readStdin() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value;
}
