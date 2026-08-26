import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import {
  advisoryFromVersions, baseUpdateNotificationDirective, cachedUpdateAdvisory,
  compareVersions, nextNotificationState, notificationSessionId, printHuman,
  readUpdateCache, resolveUpdateAdvisory, stableVersion, updateNotificationDirective,
  updateStatus, writeUpdateCache
} from "../../harness/runtime/core/update-advisory.mjs";
import { resolveHostInstructionWithUpdate } from
  "../../harness/runtime/core/host-instruction.mjs";
import { attachPhaseUpdateAdvisory } from
  "../../harness/runtime/workflow/packet-runtime.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const NOW = Date.parse("2026-08-19T12:00:00.000Z");
const UPDATE_ADVISORY_URL = pathToFileURL(join(ROOT, ".claude", "harness", "runtime",
  "core", "update-advisory.mjs")).href;

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "foundation-update-advisory-"));
  return { directory, cachePath: join(directory, "cache", "update-status.json") };
}

function cached(cachePath, latestVersion = "3.3.2", checkedAt = new Date(NOW).toISOString()) {
  writeUpdateCache(cachePath, { version: 1, latestVersion, checkedAt });
}

test("stable versions normalize tags and build metadata", () => {
  assert.equal(stableVersion("v3.3.2"), "3.3.2");
  assert.equal(stableVersion("3.3.2+source.abc"), "3.3.2");
  assert.equal(stableVersion("3.3.2-beta.1"), null);
});

test("semantic comparison is numeric", () => {
  assert.equal(compareVersions("3.10.0", "3.9.9"), 1);
  assert.equal(compareVersions("3.3.1", "3.3.2"), -1);
  assert.equal(compareVersions("3.3.2", "3.3.2"), 0);
});

test("current CLI reports current", () => {
  assert.equal(advisoryFromVersions({
    installedVersion: "3.3.2", latestVersion: "3.3.2"
  }).status, "current");
});

test("older CLI reports an available update", () => {
  const value = advisoryFromVersions({
    installedVersion: "3.3.1", latestVersion: "3.3.2"
  });
  assert.equal(value.status, "cli-update-available");
  assert.deepEqual(value.actions.map((action) => action.type), ["upgrade-cli"]);
});

test("project mismatch is locally knowable without release data", () => {
  const value = advisoryFromVersions({
    installedVersion: "3.3.2", projectVersion: "3.3.1"
  });
  assert.equal(value.status, "project-refresh-required");
  assert.deepEqual(value.actions.map((action) => action.type), ["refresh-project"]);
});

test("older CLI and project report both outdated", () => {
  const value = advisoryFromVersions({
    installedVersion: "3.3.1", projectVersion: "3.3.1", latestVersion: "3.3.2"
  });
  assert.equal(value.status, "both-outdated");
  assert.equal(value.actions.length, 2);
});

test("an installed version newer than the stable release reports a head installation", () => {
  const value = advisoryFromVersions({
    installedVersion: "3.3.3", latestVersion: "3.3.2"
  });
  assert.equal(value.status, "head-installation");
  assert.deepEqual(value.actions, []);
});

test("a head installation still reports an older project runtime", () => {
  const value = advisoryFromVersions({
    installedVersion: "3.3.3", projectVersion: "3.3.2", latestVersion: "3.3.2"
  });
  assert.equal(value.status, "project-refresh-required");
  assert.deepEqual(value.actions.map((action) => action.type), ["refresh-project"]);
});

test("status and advisory values fail open for incomplete version identities", () => {
  assert.equal(updateStatus(null, null, null), "unknown");
  assert.equal(updateStatus("3.3.2", "3.3.2", null), "unknown");
  const unknown = advisoryFromVersions({
    installedVersion: "source-build", projectVersion: "project-build",
    latestVersion: "invalid", reason: "unverified"
  });
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.installedVersion, "source-build");
  assert.equal(unknown.projectVersion, "project-build");
  assert.equal(unknown.latestVersion, null);
  assert.equal(unknown.reason, "unverified");
});

test("notification value helpers preserve timing, identity, and bounded history", () => {
  assert.deepEqual(baseUpdateNotificationDirective({}, "change"), {
    actionable: false,
    directive: {
      surface: false, kind: "update-available", timing: "phase-entry",
      dedupeKey: null, blocking: false, reason: "no-update-action"
    }
  });
  const build = baseUpdateNotificationDirective({
    latestVersion: "v3.4.0", actions: [{ command: "upgrade" }]
  }, "build");
  assert.equal(build.actionable, true);
  assert.equal(build.directive.kind, "update-reminder");
  assert.equal(build.directive.timing, "before-build");
  assert.equal(build.directive.dedupeKey, "foundation-update:3.4.0");
  assert.equal(notificationSessionId({ sessionId: " explicit ", env: {
    FOUNDATION_SESSION_ID: "environment"
  } }), "explicit");
  assert.equal(notificationSessionId({ env: {
    FOUNDATION_SESSION_ID: " environment "
  } }), "environment");

  const sessions = {};
  for (let index = 0; index < 101; index += 1)
    sessions[`old-${index}`] = {
      notifiedAt: new Date(NOW - index * 1000).toISOString()
    };
  const next = nextNotificationState({ sessions }, "new-session", build.directive,
    "change", NOW + 1000);
  assert.equal(Object.keys(next.sessions).length, 100);
  assert.equal(next.sessions["new-session"].trigger, "change");
  assert.equal(next.sessions["old-100"], undefined);
  const incomplete = nextNotificationState({
    sessions: { missingA: {}, missingB: {} }
  }, "latest", build.directive, "change", NOW);
  assert.equal(Object.keys(incomplete.sessions).length, 3);
  assert.equal(incomplete.sessions.latest.notifiedAt, new Date(NOW).toISOString());
});

test("human update rendering covers current and actionable output", () => {
  const current = [];
  printHuman({
    installedVersion: "3.3.2", latestVersion: "3.3.2", status: "current",
    freshness: "fresh", actions: []
  }, (line) => current.push(line));
  assert.deepEqual(current, [
    "Foundation update status", "CLI       3.3.2", "Status    current",
    "Freshness fresh"
  ]);
  const update = [];
  printHuman({
    installedVersion: "3.3.1", projectVersion: "3.3.0", latestVersion: "3.3.2",
    status: "both-outdated", freshness: "stale",
    actions: [{ command: "upgrade" }, { command: "refresh" }]
  }, (line) => update.push(line));
  assert.deepEqual(update, [
    "Foundation update status", "CLI       3.3.1 -> 3.3.2",
    "Project   3.3.0", "Status    both-outdated", "Freshness stale",
    "Next      upgrade", "Next      refresh"
  ]);
});

test("fresh user cache prevents a network request", async () => {
  const item = fixture();
  try {
    cached(item.cachePath);
    let requests = 0;
    const value = await resolveUpdateAdvisory({
      installedVersion: "3.3.1", cachePath: item.cachePath, now: NOW,
      fetchImpl: async () => { requests += 1; throw new Error("unexpected"); }
    });
    assert.equal(requests, 0);
    assert.equal(value.source, "cache");
    assert.equal(value.status, "cli-update-available");
  } finally {
    rmSync(item.directory, { recursive: true, force: true });
  }
});

test("stale cache refreshes once and writes only the validated tag", async () => {
  const item = fixture();
  try {
    cached(item.cachePath, "3.3.1", "2026-08-17T00:00:00.000Z");
    let requests = 0;
    const value = await resolveUpdateAdvisory({
      installedVersion: "3.3.1", cachePath: item.cachePath, now: NOW,
      fetchImpl: async () => {
        requests += 1;
        return {
          ok: true,
          async json() {
            return { tag_name: "v3.3.2", body: "$(touch must-not-run)" };
          }
        };
      }
    });
    assert.equal(requests, 1);
    assert.equal(value.source, "remote");
    assert.equal(readUpdateCache(item.cachePath).latestVersion, "3.3.2");
    assert.deepEqual(readdirSync(dirname(item.cachePath)), ["update-status.json"]);
  } finally {
    rmSync(item.directory, { recursive: true, force: true });
  }
});

test("a future-dated cache is not fresh and triggers a bounded refresh", async () => {
  const item = fixture();
  try {
    cached(item.cachePath, "3.3.2", "2099-01-01T00:00:00.000Z");
    let requests = 0;
    const value = await resolveUpdateAdvisory({
      installedVersion: "3.3.1", cachePath: item.cachePath, now: NOW,
      fetchImpl: async () => {
        requests += 1;
        return { ok: true, async json() { return { tag_name: "v3.3.3" }; } };
      }
    });
    assert.equal(requests, 1);
    assert.equal(value.source, "remote");
    assert.equal(value.latestVersion, "3.3.3");
  } finally {
    rmSync(item.directory, { recursive: true, force: true });
  }
});

test("offline refresh falls back to a valid stale cache", async () => {
  const item = fixture();
  try {
    cached(item.cachePath, "3.3.2", "2026-08-17T00:00:00.000Z");
    const value = await resolveUpdateAdvisory({
      installedVersion: "3.3.1", cachePath: item.cachePath, now: NOW,
      fetchImpl: async () => { throw new Error("offline"); }
    });
    assert.equal(value.status, "cli-update-available");
    assert.equal(value.freshness, "stale");
    assert.equal(value.reason, "release-unavailable");
  } finally {
    rmSync(item.directory, { recursive: true, force: true });
  }
});

test("offline without a cache returns unknown and never blocks", async () => {
  const item = fixture();
  try {
    const value = await resolveUpdateAdvisory({
      installedVersion: "3.3.1", cachePath: item.cachePath, now: NOW,
      fetchImpl: async () => { throw new Error("offline"); }
    });
    assert.equal(value.status, "unknown");
    assert.equal(value.blocking, false);
  } finally {
    rmSync(item.directory, { recursive: true, force: true });
  }
});

test("environment opt-out performs no request", async () => {
  let requests = 0;
  const value = await resolveUpdateAdvisory({
    installedVersion: "3.3.1", env: { FOUNDATION_UPDATE_CHECK: "0" },
    fetchImpl: async () => { requests += 1; throw new Error("unexpected"); }
  });
  assert.equal(requests, 0);
  assert.equal(value.status, "disabled");
});

test("network policy and explicit refresh select the expected cache route", async () => {
  const item = fixture();
  try {
    cached(item.cachePath);
    let requests = 0;
    const cachedOnly = await resolveUpdateAdvisory({
      installedVersion: "3.3.1", cachePath: item.cachePath, now: NOW,
      refresh: true, allowNetwork: false,
      fetchImpl: async () => { requests += 1; throw new Error("unexpected"); }
    });
    assert.equal(requests, 0);
    assert.equal(cachedOnly.source, "cache");

    const refreshed = await resolveUpdateAdvisory({
      installedVersion: "3.3.1", cachePath: item.cachePath, now: NOW,
      refresh: true,
      fetchImpl: async () => ({
        ok: true, async json() { return { tag_name: "v3.3.4" }; }
      })
    });
    assert.equal(refreshed.latestVersion, "3.3.4");
    assert.equal(refreshed.source, "remote");
  } finally {
    rmSync(item.directory, { recursive: true, force: true });
  }
});

test("remote protocol and timeout failures retain non-blocking cache semantics", async () => {
  const item = fixture();
  try {
    cached(item.cachePath, "3.3.2", "2026-08-17T00:00:00.000Z");
    const http = await resolveUpdateAdvisory({
      installedVersion: "3.3.1", cachePath: item.cachePath, now: NOW,
      fetchImpl: async () => ({ ok: false, status: 503 })
    });
    assert.equal(http.reason, "release-unavailable");
    assert.equal(http.latestVersion, "3.3.2");

    const timeoutError = new Error("timeout");
    timeoutError.name = "AbortError";
    const timeout = await resolveUpdateAdvisory({
      installedVersion: "3.3.1", cachePath: item.cachePath, now: NOW,
      fetchImpl: async () => { throw timeoutError; }
    });
    assert.equal(timeout.reason, "release-timeout");

    rmSync(item.cachePath, { force: true });
    const invalid = await resolveUpdateAdvisory({
      installedVersion: "3.3.1", cachePath: item.cachePath, now: NOW,
      fetchImpl: async () => ({ ok: true, async json() { return { tag_name: "beta" }; } })
    });
    assert.equal(invalid.status, "unknown");
    assert.equal(invalid.reason, "release-unavailable");
  } finally {
    rmSync(item.directory, { recursive: true, force: true });
  }
});

test("Investigate and Change host instructions carry boundary advisories", async () => {
  for (const command of ["investigate", "change"]) {
    const value = await resolveHostInstructionWithUpdate(command, {
      packageRoot: ROOT, arguments: "demo", env: { FOUNDATION_UPDATE_CHECK: "0" }
    });
    assert.equal(value.update.trigger, command);
    assert.equal(value.update.blocking, false);
    assert.equal("notification" in value.update, false,
      "protocol-v1's closed update object must remain backward compatible");
    assert.equal(value.notification.blocking, false);
  }
});

test("non-selected host phases carry no automatic advisory", async () => {
  for (const command of ["prove", "land", "changes"]) {
    const value = await resolveHostInstructionWithUpdate(command, {
      packageRoot: ROOT, arguments: command === "changes" ? "" : "demo",
      env: { FOUNDATION_UPDATE_CHECK: "0" }
    });
    assert.equal("update" in value, false);
  }
});

test("shipped agent policy notifies once and reminds before Build", () => {
  const contract = readFileSync(join(ROOT, ".claude", "harness", "AGENT.md"), "utf8");
  const policy = readFileSync(join(ROOT, ".claude", "harness", "README.md"), "utf8");
  assert.match(contract, /For `notification\.surface: true`, load `README\.md`/);
  assert.match(policy, /harness owns the phase timing and session-level/);
  assert.match(policy, /do not override a false `surface`/);
  assert.match(policy, /reminder immediately before that Build entry/);
  assert.match(policy, /must not\s+run an update\s+action unless the user requests it/);
  assert.match(policy, /Do not surface an automatic\s+update notice\s+during Prove or Land/);
});

test("Change reuses the fresh cache created at Investigate", async () => {
  const item = fixture();
  try {
    let requests = 0;
    const options = {
      packageRoot: ROOT, arguments: "demo", cachePath: item.cachePath, now: NOW,
      fetchImpl: async () => {
        requests += 1;
        return { ok: true, async json() { return { tag_name: "v3.3.2" }; } };
      }
    };
    await resolveHostInstructionWithUpdate("investigate", options);
    await resolveHostInstructionWithUpdate("change", options);
    assert.equal(requests, 1);
  } finally {
    rmSync(item.directory, { recursive: true, force: true });
  }
});

test("Investigate and Change use durable session deduplication", async () => {
  const item = fixture();
  try {
    // A synthetic future version, not the current release: pinning the then-
    // latest tag made this test rot the moment that tag shipped — equal
    // versions stop being an update and the notification never surfaces.
    cached(item.cachePath, "99.0.0");
    const options = {
      packageRoot: ROOT,
      arguments: "demo",
      cachePath: item.cachePath,
      notificationStatePath: join(item.directory, "notifications.json"),
      sessionId: "session-1",
      now: NOW
    };
    const investigate = await resolveHostInstructionWithUpdate("investigate", options);
    const change = await resolveHostInstructionWithUpdate("change", options);
    assert.equal(investigate.notification.surface, true);
    assert.equal(investigate.notification.kind, "update-available");
    assert.equal(change.notification.surface, false);
    assert.equal(change.notification.reason, "already-notified-in-session");
  } finally {
    rmSync(item.directory, { recursive: true, force: true });
  }
});

test("notification-state filesystem failures remain non-blocking", () => {
  const item = fixture();
  try {
    const regularFile = join(item.directory, "not-a-directory");
    writeFileSync(regularFile, "file\n");
    const value = updateNotificationDirective({
      latestVersion: "3.3.3",
      actions: [{ type: "upgrade-cli", command: "upgrade" }]
    }, "investigate", {
      sessionId: "session-fail-open",
      notificationStatePath: join(regularFile, "state.json")
    });
    assert.equal(value.surface, true);
    assert.equal(value.blocking, false);
    assert.equal(value.reason, "notification-state-unavailable");
  } finally {
    rmSync(item.directory, { recursive: true, force: true });
  }
});

test("a live notification-state writer suppresses rather than duplicates", () => {
  const item = fixture();
  try {
    const statePath = join(item.directory, "busy-notifications.json");
    writeFileSync(`${statePath}.lock`, JSON.stringify({
      version: 1,
      pid: process.pid,
      token: "live-writer",
      acquiredAt: new Date(NOW).toISOString()
    }));
    const value = updateNotificationDirective({
      latestVersion: "3.3.3",
      actions: [{ type: "upgrade-cli", command: "upgrade" }]
    }, "change", {
      sessionId: "busy-session",
      notificationStatePath: statePath,
      notificationLockTimeoutMs: 0
    });
    assert.equal(value.surface, false);
    assert.equal(value.reason, "notification-state-busy");
    assert.equal(value.blocking, false);
  } finally {
    rmSync(item.directory, { recursive: true, force: true });
  }
});

async function notificationWorker(statePath, sessionId) {
  const source = `
    import { updateNotificationDirective } from ${JSON.stringify(UPDATE_ADVISORY_URL)};
    const value = updateNotificationDirective({
      latestVersion: "3.3.3",
      actions: [{ type: "upgrade-cli", command: "upgrade" }]
    }, "investigate", {
      sessionId: process.argv[2],
      notificationStatePath: process.argv[3],
      notificationLockTimeoutMs: 2000
    });
    process.stdout.write(JSON.stringify(value));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source,
    ROOT, sessionId, statePath], { encoding: "utf8" });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 0, stderr);
  return JSON.parse(stdout);
}

test("notification deduplication is serialized across processes", async () => {
  const item = fixture();
  try {
    const statePath = join(item.directory, "shared-notifications.json");
    const sameSession = await Promise.all(Array.from({ length: 8 }, () =>
      notificationWorker(statePath, "shared-session")));
    assert.equal(sameSession.filter((value) => value.surface).length, 1);
    assert.equal(sameSession.filter((value) =>
      value.reason === "already-notified-in-session").length, 7);

    const separatePath = join(item.directory, "separate-notifications.json");
    const sessions = Array.from({ length: 8 }, (_, index) => `session-${index}`);
    const separate = await Promise.all(sessions.map((session) =>
      notificationWorker(separatePath, session)));
    assert.equal(separate.every((value) => value.surface), true);
    const state = JSON.parse(readFileSync(separatePath, "utf8"));
    assert.deepEqual(Object.keys(state.sessions).sort(), sessions.sort());
  } finally {
    rmSync(item.directory, { recursive: true, force: true });
  }
});

test("Build packet advisory leaves the deterministic digest unchanged", () => {
  const item = fixture();
  try {
    cached(item.cachePath);
    const packet = { version: 7, packetDigest: "deterministic-digest" };
    attachPhaseUpdateAdvisory(packet, "build", {
      installedCliVersion: "3.3.2", foundationVersion: "3.3.1",
      cachePath: item.cachePath, now: NOW
    });
    assert.equal(packet.packetDigest, "deterministic-digest");
    assert.equal(packet.update.trigger, "build");
    assert.equal(packet.update.status, "project-refresh-required");
    assert.equal(packet.notification.surface, true);
    assert.equal(packet.notification.timing, "before-build");
  } finally {
    rmSync(item.directory, { recursive: true, force: true });
  }
});

test("Prove, Review, and Land packets remain quiet", () => {
  for (const phase of ["prove", "review", "land"]) {
    const packet = { packetDigest: "same" };
    attachPhaseUpdateAdvisory(packet, phase, {
      installedCliVersion: "3.3.2", foundationVersion: "3.3.1"
    });
    assert.deepEqual(packet, { packetDigest: "same" });
  }
});

test("explicit CLI check is machine-readable and honors opt-out", () => {
  const result = spawnSync("bash", [join(ROOT, "cli.sh"), "update", "check", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, FOUNDATION_UPDATE_CHECK: "0" }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "disabled");
});

test("malformed cache is treated as unavailable", () => {
  const item = fixture();
  try {
    writeUpdateCache(item.cachePath, {
      version: 1, latestVersion: "not-a-version", checkedAt: new Date(NOW).toISOString()
    });
    const value = cachedUpdateAdvisory({
      installedVersion: "3.3.1", cachePath: item.cachePath, now: NOW
    });
    assert.equal(value.status, "unknown");
    assert.equal(value.reason, "cache-unavailable");
  } finally {
    rmSync(item.directory, { recursive: true, force: true });
  }
});
