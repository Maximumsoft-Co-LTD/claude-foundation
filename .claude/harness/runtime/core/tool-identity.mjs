// Content-keyed, per-process memoization for external tool probes.
//
// A probe result is reused only while every input that could change it is
// byte-identical: the resolved executable (and its package manifest), and for
// strict lint the OpenSpec tree it reads. Keys never involve time, and only
// successful results are retained, so any byte change or failure re-runs the
// real tool.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";

const MAX_HASHED_EXECUTABLE_BYTES = 8 * 1024 * 1024;
const versionProbes = new Map();
const strictLints = new Map();
const indexQueries = new Map();

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function executableFile(path) {
  try {
    const stat = statSync(path);
    return stat.isFile() && (process.platform === "win32" || (stat.mode & 0o111) !== 0);
  } catch { return false; }
}

// Same lookup order as the OS for a bare command name. Windows PATHEXT
// resolution is not modelled; there the caller simply never memoizes.
export function resolveExecutable(command, env = process.env, cwd = process.cwd()) {
  if (!command || process.platform === "win32") return null;
  if (command.includes("/") || isAbsolute(command)) {
    const path = resolve(cwd, command);
    return executableFile(path) ? path : null;
  }
  for (const directory of String(env.PATH || "").split(delimiter)) {
    if (!directory) continue;
    const path = join(resolve(cwd, directory), command);
    if (executableFile(path)) return path;
  }
  return null;
}

function fileContentIdentity(path) {
  const stat = statSync(path);
  if (stat.size <= MAX_HASHED_EXECUTABLE_BYTES) return digest(readFileSync(path));
  return `stat:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

// The resolved path, every link on the way, the target's bytes, and the
// nearest package manifest (an npm-installed CLI's version lives there).
export function executableIdentity(command, env = process.env, cwd = process.cwd()) {
  try {
    const path = resolveExecutable(command, env, cwd);
    if (!path) return null;
    const real = realpathSync(path);
    const rows = [path, real, fileContentIdentity(real)];
    if (lstatSync(path).isSymbolicLink()) rows.push(readlinkSync(path));
    let directory = dirname(real);
    for (let depth = 0; depth < 4; depth += 1) {
      const manifest = join(directory, "package.json");
      if (existsSync(manifest)) {
        rows.push(manifest, fileContentIdentity(manifest));
        break;
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    return digest(JSON.stringify(rows));
  } catch { return null; }
}

// `openspec --version` with the spawnSync result shape. A successful probe is
// reused while the resolved CLI is byte-identical; failures always re-probe.
export function probeOpenSpecVersion({
  cwd, timeout = null, spawn = spawnSync, env = process.env
} = {}) {
  const identity = spawn === spawnSync ? executableIdentity("openspec", env, cwd) : null;
  if (identity && versionProbes.has(identity))
    return { ...versionProbes.get(identity), identity, memoized: true };
  const probe = spawn("openspec", ["--version"], {
    cwd, encoding: "utf8", ...(timeout ? { timeout } : {})
  });
  if (identity && !probe.error && probe.status === 0 &&
      executableIdentity("openspec", env, cwd) === identity) {
    versionProbes.set(identity, {
      status: probe.status, stdout: probe.stdout, stderr: probe.stderr
    });
    return { ...probe, identity };
  }
  return { ...probe, identity: null };
}

function treeRows(path, prefix, rows) {
  let entries;
  try { entries = readdirSync(path, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = join(path, entry.name);
    const relativePath = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) rows.push(["link", relativePath, readlinkSync(absolute)]);
    else if (entry.isDirectory()) treeRows(absolute, `${relativePath}/`, rows);
    else if (entry.isFile()) rows.push(["file", relativePath, digest(readFileSync(absolute))]);
    else rows.push(["other", relativePath]);
  }
}

// Everything under openspec/ that `openspec validate <id>` can read: the
// change itself, main specs, schemas, and project configuration. Other
// active changes and the archive are excluded; they cannot affect this lint.
export function openSpecLintInputDigest(projectRoot, id) {
  const openspec = join(projectRoot, "openspec");
  const rows = [];
  let entries = [];
  try { entries = readdirSync(openspec, { withFileTypes: true }); }
  catch { /* an absent tree hashes as empty */ }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = join(openspec, entry.name);
    if (entry.name === "changes" && entry.isDirectory())
      treeRows(join(absolute, id), `changes/${id}/`, rows);
    else if (entry.isSymbolicLink()) rows.push(["link", entry.name, readlinkSync(absolute)]);
    else if (entry.isDirectory()) treeRows(absolute, `${entry.name}/`, rows);
    else if (entry.isFile()) rows.push(["file", entry.name, digest(readFileSync(absolute))]);
  }
  const environment = Object.entries(process.env)
    .filter(([key]) => key.startsWith("OPENSPEC"))
    .sort(([left], [right]) => left.localeCompare(right));
  return digest(JSON.stringify({ projectRoot: resolve(projectRoot), id, rows, environment }));
}

export function strictLintMemoKey(projectRoot, id, cliIdentity) {
  if (!cliIdentity) return null;
  try { return digest(JSON.stringify([cliIdentity, openSpecLintInputDigest(projectRoot, id)])); }
  catch { return null; }
}

export function strictLintPassed(key) {
  return Boolean(key) && strictLints.has(key);
}

export function recordStrictLintPass(key) {
  if (key) strictLints.set(key, true);
}

// Git rewrites the index through a lock file and rename, so every write gives
// it a new inode; together with size and nanosecond times this identifies the
// index state without reading it. Unknown layouts and env overrides are
// unidentifiable and never memoized.
export function gitIndexIdentity(workspace, env = process.env) {
  if (env.GIT_DIR || env.GIT_INDEX_FILE || env.GIT_WORK_TREE) return null;
  try {
    const dotGit = join(workspace, ".git");
    const entry = lstatSync(dotGit);
    let gitDir = null;
    if (entry.isDirectory()) gitDir = dotGit;
    else if (entry.isFile()) {
      const match = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, "utf8"));
      if (match) gitDir = resolve(workspace, match[1]);
    }
    if (!gitDir) return null;
    const index = statSync(join(gitDir, "index"), { bigint: true });
    return [resolve(gitDir), index.dev, index.ino, index.size, index.mtimeNs, index.ctimeNs]
      .map(String).join(":");
  } catch { return null; }
}

// A pure function of one repository's index, memoized for this process while
// the index is unchanged; anything unidentifiable is computed every time.
export function memoizeByGitIndex(workspace, key, compute) {
  const identity = gitIndexIdentity(workspace);
  if (!identity) return compute();
  const memoKey = `${resolve(workspace)}\0${identity}\0${key}`;
  if (indexQueries.has(memoKey)) return indexQueries.get(memoKey);
  const value = compute();
  if (gitIndexIdentity(workspace) === identity) indexQueries.set(memoKey, value);
  return value;
}
