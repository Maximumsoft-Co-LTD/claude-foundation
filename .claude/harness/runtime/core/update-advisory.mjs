import {
  existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireProcessLock } from "./process-lock.mjs";

export const UPDATE_CACHE_VERSION = 1;
export const UPDATE_NOTIFICATION_STATE_VERSION = 1;
export const UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_TIMEOUT_MS = 1200;
export const LATEST_RELEASE_URL =
  "https://api.github.com/repos/Maximumsoft-Co-LTD/claude-foundation/releases/latest";
export const UPDATE_BOUNDARY_COMMANDS = Object.freeze(new Set([
  "investigate", "change", "build"
]));

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACKAGE_ROOT = resolve(HERE, "../../../..");

export function defaultUpdateCachePath(env = process.env) {
  const cacheRoot = env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(cacheRoot, "claude-foundation", "update-status.json");
}

export function defaultUpdateNotificationStatePath(env = process.env) {
  const cacheRoot = env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(cacheRoot, "claude-foundation", "update-notifications.json");
}

export function stableVersion(value) {
  const match = String(value || "").trim().match(
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z.-]+)?$/
  );
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : null;
}

export function compareVersions(left, right) {
  const a = stableVersion(left);
  const b = stableVersion(right);
  if (!a || !b) return null;
  const aa = a.split(".").map(Number);
  const bb = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (aa[index] < bb[index]) return -1;
    if (aa[index] > bb[index]) return 1;
  }
  return 0;
}

function validCache(value) {
  return value?.version === UPDATE_CACHE_VERSION &&
    Boolean(stableVersion(value.latestVersion)) &&
    Number.isFinite(Date.parse(value.checkedAt));
}

export function readUpdateCache(path = defaultUpdateCachePath()) {
  try {
    if (!existsSync(path)) return null;
    const value = JSON.parse(readFileSync(path, "utf8"));
    return validCache(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeUpdateCache(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function updateActions(status) {
  const actions = [];
  if (["cli-update-available", "both-outdated"].includes(status))
    actions.push({
      type: "upgrade-cli",
      command: "brew update && brew upgrade claude-foundation"
    });
  if (["project-refresh-required", "both-outdated"].includes(status))
    actions.push({
      type: "refresh-project",
      command: "claude-foundation init . --yes"
    });
  return actions;
}

export function advisoryFromVersions({
  installedVersion, projectVersion = null, latestVersion = null,
  checkedAt = null, freshness = "unavailable", source = "none", reason = null
}) {
  const installed = stableVersion(installedVersion);
  const project = projectVersion === null ? null : stableVersion(projectVersion);
  const latest = latestVersion === null ? null : stableVersion(latestVersion);
  let status = "unknown";
  if (installed && latest) {
    const cliAhead = compareVersions(installed, latest) > 0;
    const cliBehind = compareVersions(installed, latest) < 0;
    const projectBehind = Boolean(project && compareVersions(project, installed) < 0);
    const projectLatestBehind = Boolean(project && compareVersions(project, latest) < 0);
    if (cliAhead && projectBehind) status = "project-refresh-required";
    else if (cliAhead) status = "head-installation";
    else if (cliBehind && projectLatestBehind) status = "both-outdated";
    else if (cliBehind) status = "cli-update-available";
    else if (projectBehind) status = "project-refresh-required";
    else status = "current";
  } else if (installed && project && compareVersions(project, installed) < 0)
    status = "project-refresh-required";
  return {
    status,
    installedVersion: installed || String(installedVersion || "unknown"),
    ...(projectVersion !== null
      ? { projectVersion: project || String(projectVersion || "unknown") } : {}),
    latestVersion: latest,
    checkedAt,
    freshness,
    source,
    blocking: false,
    reason,
    actions: updateActions(status)
  };
}

export function cachedUpdateAdvisory(options = {}) {
  const env = options.env || process.env;
  const installedVersion = options.installedVersion || "unknown";
  const projectVersion = options.projectVersion ?? null;
  if (env.FOUNDATION_UPDATE_CHECK === "0") return {
    status: "disabled",
    installedVersion: stableVersion(installedVersion) || String(installedVersion),
    ...(projectVersion !== null
      ? { projectVersion: stableVersion(projectVersion) || String(projectVersion) } : {}),
    latestVersion: null,
    checkedAt: null,
    freshness: "unavailable",
    source: "disabled",
    blocking: false,
    reason: "disabled-by-environment",
    actions: []
  };
  const now = options.now ?? Date.now();
  const cache = readUpdateCache(options.cachePath || defaultUpdateCachePath(env));
  if (!cache) return advisoryFromVersions({
    installedVersion, projectVersion, reason: "cache-unavailable"
  });
  const age = now - Date.parse(cache.checkedAt);
  const fresh = age >= 0 && age <= (options.ttlMs ?? UPDATE_CACHE_TTL_MS);
  return advisoryFromVersions({
    installedVersion,
    projectVersion,
    latestVersion: cache.latestVersion,
    checkedAt: cache.checkedAt,
    freshness: fresh ? "fresh" : "stale",
    source: "cache",
    reason: fresh ? null : "cache-expired"
  });
}

function readNotificationState(path) {
  try {
    if (!existsSync(path)) return null;
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value?.version === UPDATE_NOTIFICATION_STATE_VERSION &&
      value.sessions && typeof value.sessions === "object" ? value : null;
  } catch {
    return null;
  }
}

export function updateNotificationDirective(advisory, trigger, options = {}) {
  const actionable = Array.isArray(advisory?.actions) && advisory.actions.length > 0;
  const sessionId = String(options.sessionId ||
    options.env?.FOUNDATION_SESSION_ID || process.env.FOUNDATION_SESSION_ID || "").trim();
  const version = stableVersion(advisory?.latestVersion) || null;
  const kind = trigger === "build" ? "update-reminder" : "update-available";
  const directive = {
    surface: actionable,
    kind,
    timing: trigger === "build" ? "before-build" : "phase-entry",
    dedupeKey: version ? `foundation-update:${version}` : null,
    blocking: false,
    reason: actionable ? null : "no-update-action"
  };
  if (!actionable || trigger === "build") return directive;
  if (!sessionId) return { ...directive, reason: "session-unavailable" };

  const path = options.notificationStatePath ||
    defaultUpdateNotificationStatePath(options.env || process.env);
  let lock;
  try {
    const deadline = Date.now() + Number(options.notificationLockTimeoutMs ?? 250);
    do {
      lock = acquireProcessLock(`${path}.lock`);
      if (lock.acquired) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    } while (Date.now() < deadline);
    if (!lock?.acquired)
      return { ...directive, surface: false, reason: "notification-state-busy" };

    const state = readNotificationState(path) || {
      version: UPDATE_NOTIFICATION_STATE_VERSION,
      sessions: {}
    };
    const previous = state.sessions[sessionId];
    if (previous?.dedupeKey === directive.dedupeKey)
      return { ...directive, surface: false, reason: "already-notified-in-session" };

    const sessions = Object.fromEntries(Object.entries({
      ...state.sessions,
      [sessionId]: {
        dedupeKey: directive.dedupeKey,
        trigger,
        notifiedAt: new Date(options.now ?? Date.now()).toISOString()
      }
    }).sort(([, left], [, right]) => String(right?.notifiedAt || "")
      .localeCompare(String(left?.notifiedAt || ""))).slice(0, 100));
    writeUpdateCache(path, {
      version: UPDATE_NOTIFICATION_STATE_VERSION,
      sessions
    });
    return directive;
  } catch {
    return { ...directive, reason: "notification-state-unavailable" };
  } finally {
    lock?.release();
  }
}

async function fetchLatestVersion(fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(LATEST_RELEASE_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "claude-foundation-update-advisory"
      },
      signal: controller.signal
    });
    if (!response?.ok) throw new Error(`release-http-${response?.status || "unknown"}`);
    const payload = await response.json();
    const latestVersion = stableVersion(payload?.tag_name);
    if (!latestVersion) throw new Error("release-tag-invalid");
    return latestVersion;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveUpdateAdvisory(options = {}) {
  const env = options.env || process.env;
  const cached = cachedUpdateAdvisory(options);
  if (cached.status === "disabled") return cached;
  const now = options.now ?? Date.now();
  const cachePath = options.cachePath || defaultUpdateCachePath(env);
  const shouldRefresh = options.refresh === true || cached.freshness !== "fresh";
  if (!shouldRefresh || options.allowNetwork === false) return cached;
  try {
    const latestVersion = await fetchLatestVersion(
      options.fetchImpl || globalThis.fetch,
      options.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS
    );
    const checkedAt = new Date(now).toISOString();
    writeUpdateCache(cachePath, {
      version: UPDATE_CACHE_VERSION,
      latestVersion,
      checkedAt
    });
    return advisoryFromVersions({
      installedVersion: options.installedVersion,
      projectVersion: options.projectVersion ?? null,
      latestVersion,
      checkedAt,
      freshness: "fresh",
      source: "remote"
    });
  } catch (error) {
    if (cached.latestVersion) return {
      ...cached,
      freshness: "stale",
      reason: error?.name === "AbortError" ? "release-timeout" : "release-unavailable"
    };
    return {
      ...cached,
      reason: error?.name === "AbortError" ? "release-timeout" : "release-unavailable"
    };
  }
}

export function updateBoundary(command) {
  return UPDATE_BOUNDARY_COMMANDS.has(command) ? command : null;
}

function readInstalledVersion(packageRoot) {
  return readFileSync(join(packageRoot, "VERSION"), "utf8").trim();
}

function printHuman(advisory) {
  console.log("Foundation update status");
  console.log(`CLI       ${advisory.installedVersion}${
    advisory.latestVersion && advisory.status !== "current"
      ? ` -> ${advisory.latestVersion}` : ""}`);
  if (advisory.projectVersion) console.log(`Project   ${advisory.projectVersion}`);
  console.log(`Status    ${advisory.status}`);
  console.log(`Freshness ${advisory.freshness}`);
  for (const action of advisory.actions) console.log(`Next      ${action.command}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.shift() !== "check" || args.some((arg) => !["--json", "--refresh"].includes(arg))) {
    console.error("usage: claude-foundation update check [--refresh] [--json]");
    process.exitCode = 1;
    return;
  }
  const advisory = await resolveUpdateAdvisory({
    installedVersion: readInstalledVersion(DEFAULT_PACKAGE_ROOT),
    refresh: args.includes("--refresh")
  });
  if (args.includes("--json")) console.log(JSON.stringify(advisory, null, 2));
  else printHuman(advisory);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)))
  await main();
