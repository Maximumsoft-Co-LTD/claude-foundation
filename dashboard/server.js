'use strict';

/**
 * claude-foundation dashboard — central presence server.
 *
 * Every installed agent runs `claude-foundation dashboard --key=…` which POSTs
 * a heartbeat here every few seconds. This server keeps an in-memory map of
 * agents and reports who has been seen within ONLINE_TTL_MS as "online". It
 * also serves the static web dashboard from ./public.
 *
 * Zero runtime dependencies — Node >= 24. Designed to run on Railway,
 * which sets PORT for us.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const APP_VERSION = require('./package.json').version; // surfaced in /api/health, /api/online, and the UI footer

// ── Config (env) ────────────────────────────────────────────────────────────
const PORT = toInt(process.env.PORT, 8473); // off the common dev ports; Railway overrides via PORT
const SHARED_KEY = process.env.SHARED_KEY || '';
const VIEW_KEY = process.env.VIEW_KEY || SHARED_KEY; // who may read /api/online
const ONLINE_TTL_MS = toInt(process.env.ONLINE_TTL_MS, 75_000); // online window — 2.5x the client's 30s beat, so one dropped beat doesn't flicker
const PRUNE_AFTER_MS = ONLINE_TTL_MS * 20; // forget agents gone this long
const ONLINE_CACHE_MS = toInt(process.env.ONLINE_CACHE_MS, 2_000); // /api/online is recomputed at most this often, shared by all viewers
const MAX_BODY_BYTES = 512 * 1024; // rich change payloads (many repos × files × ranges)
const MAX_FIELD_LEN = 200;
const MAX_AGENTS = toInt(process.env.MAX_AGENTS, 500); // roster ceiling — a shared key must not buy unbounded rows
const MAX_PROFILES = toInt(process.env.MAX_PROFILES, 500); // profile ceiling — /api/profile takes the same shared key
const MIN_HEARTBEAT_INTERVAL_MS = toInt(process.env.MIN_HEARTBEAT_INTERVAL_MS, 5_000); // persisted writes per agent; the client beats every 30s
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!SHARED_KEY) {
  console.error('FATAL: SHARED_KEY env var is required — the shared key every agent presents on heartbeat.');
  process.exit(1);
}

// ── Persistence (SQLite, zero-dep via node:sqlite — Node >= 24) ─────────────
// On Railway attach a volume and we pick its mount up from
// RAILWAY_VOLUME_MOUNT_PATH automatically; DB_PATH overrides. Without SQLite
// support (old Node) the server still runs — in-memory only, like before.
const HEARTBEAT_LOG_DAYS = toInt(process.env.HEARTBEAT_LOG_DAYS, 7); // raw beat log is debug-only now — presence reads presence_hourly
const HISTORY_DAYS = toInt(process.env.HISTORY_DAYS, 400); // retention for date-keyed history tables (usage/work/edits/conflicts/commits)
const DB_PATH = process.env.DB_PATH
  || path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data'), 'dashboard.db');

let db = null;
try {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  // v2: usage_daily gains a `project` dimension (PK reshape → drop, it repopulates
  // from the next heartbeats); runs gains an `artifacts` column.
  const dbVersion = db.prepare('PRAGMA user_version').get().user_version;
  if (dbVersion < 2) {
    db.exec('DROP TABLE IF EXISTS usage_daily;');
    try { db.exec('ALTER TABLE runs ADD COLUMN artifacts TEXT;'); } catch { /* fresh db — CREATE below carries it */ }
    db.exec('PRAGMA user_version = 2;');
  }
  // v3: runs gain owner/owner_email/size/repo_id (true per-run attribution +
  // effort points), agents gain git_email, and presence moves to an hourly
  // aggregate (backfilled from the raw beat log below, after CREATE).
  const needsV3 = dbVersion < 3;
  if (needsV3) {
    for (const sql of [
      'ALTER TABLE runs ADD COLUMN owner TEXT',
      'ALTER TABLE runs ADD COLUMN owner_email TEXT',
      'ALTER TABLE runs ADD COLUMN size TEXT',
      'ALTER TABLE runs ADD COLUMN repo_id TEXT',
      'ALTER TABLE agents ADD COLUMN git_email TEXT',
    ]) { try { db.exec(sql); } catch { /* fresh db — CREATE below carries them */ } }
    db.exec('PRAGMA user_version = 3;');
  }
  const needsV4 = dbVersion < 4;
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS agents (
      agent_id   TEXT PRIMARY KEY,
      git_user   TEXT, git_email TEXT, host TEXT, version TEXT, status TEXT,
      first_seen INTEGER, last_seen INTEGER,
      state      TEXT              -- full sanitized record (runs/changes/usage/…) as JSON
    );
    CREATE TABLE IF NOT EXISTS heartbeats (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      ts       INTEGER NOT NULL,
      agent_id TEXT, git_user TEXT, host TEXT, version TEXT, status TEXT,
      runs_n   INTEGER, changes_n INTEGER, files_n INTEGER, usage_n INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_hb_ts    ON heartbeats(ts);
    CREATE INDEX IF NOT EXISTS idx_hb_agent ON heartbeats(agent_id, ts);
    CREATE TABLE IF NOT EXISTS runs (
      agent_id TEXT, repo TEXT, run_id TEXT,
      git_user TEXT, type TEXT, phase TEXT,
      started INTEGER, finished INTEGER, done INTEGER,
      artifacts TEXT,               -- {"spec":<epoch>,"plan":<epoch>,…} for the phase funnel
      owner TEXT, owner_email TEXT, -- who actually ran it (state.json / first-commit author) — '' = unknown, attribute to reporter
      size TEXT,                    -- XS/S/M/L from state.json — powers effort points
      repo_id TEXT,                 -- normalized remote URL (host/org/repo) — cross-clone dedupe key
      PRIMARY KEY (agent_id, repo, run_id)
    );
    CREATE TABLE IF NOT EXISTS usage_daily (
      agent_id TEXT, git_user TEXT, date TEXT, model TEXT, project TEXT,
      input INTEGER, output INTEGER, cache_create INTEGER, cache_read INTEGER, count INTEGER,
      PRIMARY KEY (agent_id, date, model, project)
    );
    CREATE TABLE IF NOT EXISTS sessions_daily (
      agent_id TEXT, git_user TEXT, date TEXT, count INTEGER, seconds INTEGER,
      PRIMARY KEY (agent_id, date)
    );
    CREATE TABLE IF NOT EXISTS tools (
      agent_id TEXT, git_user TEXT, tool TEXT, count INTEGER, ts INTEGER,
      PRIMARY KEY (agent_id, tool)
    );
    CREATE TABLE IF NOT EXISTS commits_daily (
      repo_id TEXT, date TEXT, n INTEGER, reported_by TEXT, ts INTEGER,
      PRIMARY KEY (repo_id, date)
    );
    CREATE TABLE IF NOT EXISTS followups (
      repo_id TEXT PRIMARY KEY, open INTEGER, closed INTEGER, ts INTEGER
    );
    CREATE TABLE IF NOT EXISTS file_edits (
      day TEXT, repo_id TEXT, path TEXT, git_user TEXT,
      PRIMARY KEY (day, repo_id, path, git_user)
    );
    CREATE TABLE IF NOT EXISTS conflict_log (
      day TEXT, repo_id TEXT, path TEXT, users TEXT, last_ts INTEGER,
      PRIMARY KEY (day, repo_id, path, users)
    );
    CREATE TABLE IF NOT EXISTS work_daily (
      agent_id TEXT, git_user TEXT, date TEXT,
      commits INTEGER, added INTEGER, deleted INTEGER, pushes INTEGER, prs INTEGER,
      PRIMARY KEY (agent_id, date)
    );
    CREATE TABLE IF NOT EXISTS profiles (
      user TEXT PRIMARY KEY,        -- the gitUser display string every aggregate groups by
      email TEXT, org TEXT,
      teams TEXT,                   -- JSON array of team tags, e.g. ["payments","platform"]
      color TEXT,                   -- '#rrggbb' or '' = auto (hashed palette)
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS presence_hourly (
      hour INTEGER, git_user TEXT, minutes INTEGER,
      PRIMARY KEY (hour, git_user)  -- hour = epoch_ms/3600000; replaces raw-beat presence scans
    );
    CREATE TABLE IF NOT EXISTS presence_minutes (
      minute INTEGER, git_user TEXT,
      PRIMARY KEY (minute, git_user) -- union across all machines owned by one person
    );
    CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_daily(date);
    CREATE INDEX IF NOT EXISTS idx_work_date  ON work_daily(date);
  `);
  // One-time presence backfill so the heatmap doesn't reset when v3 lands.
  if (needsV3) {
    try {
      db.exec(`
        INSERT OR IGNORE INTO presence_hourly (hour, git_user, minutes)
        SELECT ts/3600000, git_user, COUNT(DISTINCT ts/60000)
        FROM heartbeats WHERE status != 'offline' GROUP BY ts/3600000, git_user;
      `);
    } catch (err) { console.warn(`presence backfill failed: ${err.message}`); }
  }
  if (needsV4) db.exec('PRAGMA user_version = 4;');
  console.log(`sqlite: persisting to ${DB_PATH} (heartbeat log kept ${HEARTBEAT_LOG_DAYS}d)`);
} catch (err) {
  console.warn(`sqlite unavailable (${err.message}) — running in-memory only; presence and history reset on restart.`);
}

const stmts = db && {
  upsertAgent: db.prepare(`
    INSERT INTO agents (agent_id, git_user, git_email, host, version, status, first_seen, last_seen, state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      git_user=excluded.git_user, git_email=excluded.git_email, host=excluded.host, version=excluded.version,
      status=excluded.status, last_seen=excluded.last_seen, state=excluded.state`),
  deleteAgent: db.prepare('DELETE FROM agents WHERE agent_id = ?'),
  insertBeat: db.prepare(`
    INSERT INTO heartbeats (ts, agent_id, git_user, host, version, status, runs_n, changes_n, files_n, usage_n)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  upsertRun: db.prepare(`
    INSERT INTO runs (agent_id, repo, run_id, git_user, type, phase, started, finished, done, artifacts, owner, owner_email, size, repo_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id, repo, run_id) DO UPDATE SET
      git_user=excluded.git_user, type=excluded.type, phase=excluded.phase,
      started=excluded.started, finished=excluded.finished, done=excluded.done,
      artifacts=excluded.artifacts, owner=excluded.owner, owner_email=excluded.owner_email,
      size=excluded.size, repo_id=excluded.repo_id`),
  upsertUsage: db.prepare(`
    INSERT INTO usage_daily (agent_id, git_user, date, model, project, input, output, cache_create, cache_read, count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id, date, model, project) DO UPDATE SET
      git_user=excluded.git_user, input=excluded.input, output=excluded.output,
      cache_create=excluded.cache_create, cache_read=excluded.cache_read, count=excluded.count`),
  upsertSession: db.prepare(`
    INSERT INTO sessions_daily (agent_id, git_user, date, count, seconds)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(agent_id, date) DO UPDATE SET
      git_user=excluded.git_user, count=excluded.count, seconds=excluded.seconds`),
  upsertTool: db.prepare(`
    INSERT INTO tools (agent_id, git_user, tool, count, ts)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(agent_id, tool) DO UPDATE SET
      git_user=excluded.git_user, count=excluded.count, ts=excluded.ts`),
  deleteToolsForAgent: db.prepare('DELETE FROM tools WHERE agent_id = ?'),
  upsertCommits: db.prepare(`
    INSERT INTO commits_daily (repo_id, date, n, reported_by, ts)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(repo_id, date) DO UPDATE SET
      n=MAX(n, excluded.n), reported_by=excluded.reported_by, ts=excluded.ts`),
  upsertFollowups: db.prepare(`
    INSERT INTO followups (repo_id, open, closed, ts)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(repo_id) DO UPDATE SET
      open=excluded.open, closed=excluded.closed, ts=excluded.ts`),
  upsertFileEdit: db.prepare(`
    INSERT OR IGNORE INTO file_edits (day, repo_id, path, git_user) VALUES (?, ?, ?, ?)`),
  upsertConflict: db.prepare(`
    INSERT INTO conflict_log (day, repo_id, path, users, last_ts)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(day, repo_id, path, users) DO UPDATE SET last_ts=excluded.last_ts`),
  upsertWork: db.prepare(`
    INSERT INTO work_daily (agent_id, git_user, date, commits, added, deleted, pushes, prs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id, date) DO UPDATE SET
      git_user=excluded.git_user, commits=excluded.commits, added=excluded.added,
      deleted=excluded.deleted, pushes=excluded.pushes, prs=excluded.prs`),
  presence: db.prepare(`
    SELECT git_user AS user, hour, MIN(minutes, 60) AS minutes
    FROM presence_hourly WHERE hour >= ?`),
  upsertPresence: db.prepare(`
    INSERT INTO presence_hourly (hour, git_user, minutes) VALUES (?, ?, 1)
    ON CONFLICT(hour, git_user) DO UPDATE SET minutes = minutes + 1`),
  insertPresenceMinute: db.prepare(`
    INSERT OR IGNORE INTO presence_minutes (minute, git_user) VALUES (?, ?)`),
  upsertProfile: db.prepare(`
    INSERT INTO profiles (user, email, org, teams, color, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user) DO UPDATE SET
      email=excluded.email, org=excluded.org, teams=excluded.teams,
      color=excluded.color, updated_at=excluded.updated_at`),
  loadProfiles: db.prepare('SELECT * FROM profiles'),
  historyWork: db.prepare(`
    SELECT date, git_user AS gitUser, MAX(commits) AS commits, MAX(added) AS added,
           MAX(deleted) AS deleted, MAX(pushes) AS pushes, MAX(prs) AS prs
    FROM work_daily WHERE date >= ? GROUP BY date, git_user`),
  historyUsage: db.prepare(`
    SELECT date, model, SUM(input) AS input, SUM(output) AS output,
           SUM(cache_create) AS cacheCreate, SUM(cache_read) AS cacheRead, SUM(count) AS count
    FROM usage_daily WHERE date >= ? GROUP BY date, model`),
  historyProjects: db.prepare(`
    SELECT project, SUM(input) AS input, SUM(output) AS output, MAX(date) AS last
    FROM usage_daily WHERE date >= ? AND project != ''
    GROUP BY project ORDER BY SUM(input)+SUM(output) DESC LIMIT 30`),
  hotspots: db.prepare(`
    SELECT repo_id AS repoId, path, COUNT(DISTINCT day) AS days,
           COUNT(DISTINCT git_user) AS users, MAX(day) AS last
    FROM file_edits WHERE day >= ?
    GROUP BY repo_id, path ORDER BY COUNT(DISTINCT git_user) DESC, COUNT(DISTINCT day) DESC LIMIT 40`),
  conflictHistory: db.prepare(`
    SELECT day, repo_id AS repoId, path, users, last_ts AS lastTs
    FROM conflict_log ORDER BY last_ts DESC LIMIT 100`),
  pruneBeats: db.prepare('DELETE FROM heartbeats WHERE ts < ?'),
  prunePresence: db.prepare('DELETE FROM presence_hourly WHERE hour < ?'),
  prunePresenceMinutes: db.prepare('DELETE FROM presence_minutes WHERE minute < ?'),
  pruneByDate: [
    db.prepare('DELETE FROM usage_daily WHERE date < ?'),
    db.prepare('DELETE FROM work_daily WHERE date < ?'),
    db.prepare('DELETE FROM commits_daily WHERE date < ?'),
    db.prepare('DELETE FROM file_edits WHERE day < ?'),
    db.prepare('DELETE FROM conflict_log WHERE day < ?'),
  ],
  loadAgents: db.prepare('SELECT * FROM agents'),
  logBeats: db.prepare(`
    SELECT ts, agent_id AS agentId, git_user AS gitUser, host, version, status,
           runs_n AS runs, changes_n AS changes, files_n AS files, usage_n AS usage
    FROM heartbeats
    WHERE ts >= ? AND (? = '' OR agent_id = ?) AND (? = '' OR git_user = ?)
    ORDER BY ts DESC LIMIT ?`),
};

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value || [])).digest('hex');
}

function datasetHashes(a) {
  return {
    runs: digest(a.runs), changes: digest(a.changes), usage: digest(a.usage),
    sessions: digest(a.sessions), tools: digest(a.tools), prs: digest(a.prs),
  };
}

function changedDatasets(existing, nextHashes) {
  const previous = existing?.datasetHashes || {};
  return Object.fromEntries(Object.keys(nextHashes).map((key) => [key, previous[key] !== nextHashes[key]]));
}

/** Write one heartbeat through to SQLite, skipping unchanged aggregate datasets. */
function persistHeartbeat(a, now, changed) {
  if (!db) return;
  try {
    const filesN = (a.changes || []).reduce((s, c) => s + (Array.isArray(c.files) ? c.files.length : 0), 0);
    db.exec('BEGIN');
    stmts.insertBeat.run(now, a.agentId, a.gitUser, a.host, a.version, a.status,
      (a.runs || []).length, (a.changes || []).length, filesN, (a.usage || []).length);
    if (a.status === 'offline') stmts.deleteAgent.run(a.agentId);
    else stmts.upsertAgent.run(a.agentId, a.gitUser, a.gitEmail || '', a.host, a.version, a.status,
      a.firstSeen, a.lastSeen,
      JSON.stringify({ sourceSchema: a.sourceSchema, foundationVersion: a.foundationVersion,
        runs: a.runs, changes: a.changes, usage: a.usage, sessions: a.sessions, tools: a.tools, prs: a.prs }));
    // Presence is the union of a person's machines: the minute key prevents two
    // agents with the same git identity from double-crediting the same minute.
    const minuteBucket = Math.floor(now / 60000);
    if (a.status !== 'offline') {
      const credit = stmts.insertPresenceMinute.run(minuteBucket, a.gitUser);
      if (Number(credit.changes || 0) > 0) stmts.upsertPresence.run(Math.floor(now / 3600000), a.gitUser);
    }
    for (const r of changed.runs ? (a.runs || []) : []) {
      stmts.upsertRun.run(a.agentId, r.repo, r.id, a.gitUser, r.type, r.phase,
        r.started, r.finished, r.done ? 1 : 0, JSON.stringify(r.art || {}),
        r.owner || '', r.ownerEmail || '', r.size || '', r.repoId || '');
    }
    for (const u of changed.usage ? (a.usage || []) : []) {
      stmts.upsertUsage.run(a.agentId, a.gitUser, u.date, u.model, u.project || '',
        u.input, u.output, u.cacheCreate, u.cacheRead, u.count);
    }
    for (const s of changed.sessions ? (a.sessions || []) : []) {
      stmts.upsertSession.run(a.agentId, a.gitUser, s.date, s.count, s.seconds);
    }
    if (changed.tools) stmts.deleteToolsForAgent.run(a.agentId);
    const toolTotals = new Map();
    for (const t of changed.tools ? (a.tools || []) : []) {
      toolTotals.set(t.tool, (toolTotals.get(t.tool) || 0) + t.count);
    }
    for (const [tool, count] of toolTotals) {
      stmts.upsertTool.run(a.agentId, a.gitUser, tool, count, now);
    }
    const today = new Date(now).toISOString().slice(0, 10);
    for (const c of changed.changes ? (a.changes || []) : []) {
      for (const cm of c.commits || []) stmts.upsertCommits.run(c.repoId, cm.date, cm.n, a.agentId, now);
      stmts.upsertFollowups.run(c.repoId, c.fuOpen, c.fuClosed, now);
      for (const f of c.files || []) stmts.upsertFileEdit.run(today, c.repoId, f.path, a.gitUser);
    }
    for (const w of (changed.changes || changed.prs) ? workRowsFor(a) : []) {
      stmts.upsertWork.run(a.agentId, a.gitUser, w.date, w.commits, w.added, w.deleted, w.pushes, w.prs);
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* not in a tx */ }
    console.warn(`sqlite write failed: ${err.message}`);
  }
}

/**
 * One agent's per-day output, merged across their repos: commits + lines from
 * git log, pushes from remote-ref reflogs, PRs from the gh CLI.
 */
function workRowsFor(a) {
  const byDate = new Map();
  const row = (date) => {
    if (!byDate.has(date)) byDate.set(date, { date, commits: 0, added: 0, deleted: 0, pushes: 0, prs: 0 });
    return byDate.get(date);
  };
  for (const c of a.changes || []) {
    for (const w of c.work || []) {
      const r = row(w.date);
      r.commits += w.commits; r.added += w.added; r.deleted += w.deleted;
    }
    for (const p of c.pushes || []) row(p.date).pushes += p.n;
  }
  for (const p of a.prs || []) row(p.date).prs += p.n;
  return [...byDate.values()];
}

/** Log today's live conflicts so "who keeps colliding" has history. */
function persistConflicts(now) {
  if (!db) return;
  try {
    const day = new Date(now).toISOString().slice(0, 10);
    for (const c of computeConflicts(now)) {
      const users = (c.parties || []).map((p) => p.gitUser).sort().join('+');
      stmts.upsertConflict.run(day, c.repoId, c.path, users, now);
    }
  } catch (err) {
    console.warn(`sqlite conflict log failed: ${err.message}`);
  }
}

function dbDeleteAgent(agentId) {
  if (!db) return;
  try { stmts.deleteAgent.run(agentId); } catch (err) { console.warn(`sqlite delete failed: ${err.message}`); }
}

/** Reload the presence map from SQLite so a redeploy doesn't blank the board. */
function restoreAgents(agentsMap) {
  if (!db) return;
  try {
    for (const row of stmts.loadAgents.all()) {
      let state = {};
      try { state = JSON.parse(row.state || '{}'); } catch { /* corrupt row — presence only */ }
      const restored = {
        agentId: row.agent_id,
        gitUser: row.git_user, gitEmail: row.git_email || '', host: row.host, version: row.version, status: row.status,
        sourceSchema: clean(state.sourceSchema, 64),
        foundationVersion: clean(state.foundationVersion, 64),
        runs: Array.isArray(state.runs) ? state.runs : [],
        changes: Array.isArray(state.changes) ? state.changes : [],
        usage: Array.isArray(state.usage) ? state.usage : [],
        sessions: Array.isArray(state.sessions) ? state.sessions : [],
        tools: Array.isArray(state.tools) ? state.tools : [],
        prs: Array.isArray(state.prs) ? state.prs : [],
        firstSeen: row.first_seen, lastSeen: row.last_seen,
      };
      restored.datasetHashes = datasetHashes(restored);
      agentsMap.set(row.agent_id, restored);
    }
    if (agentsMap.size) console.log(`sqlite: restored ${agentsMap.size} agent(s) from ${DB_PATH}`);
  } catch (err) {
    console.warn(`sqlite restore failed: ${err.message}`);
  }
}

// Trim the heartbeat log + long-tail history tables on boot and then hourly.
function pruneHeartbeatLog() {
  if (!db) return;
  try {
    const now = Date.now();
    stmts.pruneBeats.run(now - HEARTBEAT_LOG_DAYS * 86400000);
    stmts.prunePresence.run(Math.floor((now - HISTORY_DAYS * 86400000) / 3600000));
    stmts.prunePresenceMinutes.run(Math.floor((now - 2 * 3600000) / 60000));
    const cutoffDay = new Date(now - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
    for (const stmt of stmts.pruneByDate) stmt.run(cutoffDay);
  }
  catch (err) { console.warn(`sqlite prune failed: ${err.message}`); }
}
pruneHeartbeatLog();
setInterval(pruneHeartbeatLog, 3600_000).unref();

// ── Profiles (who's on which team) ──────────────────────────────────────────
// user -> { user, email, org, teams: [..], color, updatedAt }. Read-through
// memory map (served on every /api/online), written through to SQLite.
const profiles = new Map();
if (db) {
  try {
    for (const row of stmts.loadProfiles.all()) {
      let teams = [];
      try { teams = JSON.parse(row.teams || '[]'); } catch { /* corrupt row — keep empty */ }
      profiles.set(row.user, {
        user: row.user, email: row.email || '', org: row.org || '',
        teams: Array.isArray(teams) ? teams : [], color: row.color || '', updatedAt: row.updated_at || 0,
      });
    }
    if (profiles.size) console.log(`sqlite: restored ${profiles.size} profile(s)`);
  } catch (err) { console.warn(`sqlite profile restore failed: ${err.message}`); }
}

// ── Presence store ──────────────────────────────────────────────────────────
// agentId -> { agentId, gitUser, host, version, status, firstSeen, lastSeen }
const agents = new Map();
restoreAgents(agents);

/** Drop agents we have not heard from in a long time. */
function prune(now) {
  for (const [id, a] of agents) {
    if (now - a.lastSeen > PRUNE_AFTER_MS) { agents.delete(id); dbDeleteAgent(id); }
  }
}

// A reported /dev run counts as live "activity" on the team card if it's not
// done and its state.json was touched within this window.
const ACTIVE_RUN_WINDOW_MS = 24 * 3600 * 1000;

/** Derive the card's live /dev activity from an agent's reported runs. */
function deriveActivity(runs, now) {
  return (runs || [])
    .filter((r) => !r.done && r.finished && now - r.finished * 1000 <= ACTIVE_RUN_WINDOW_MS)
    .slice(0, 10)
    .map((r) => ({ repo: r.repo, branch: r.branch, runId: r.id, type: r.type, phase: r.phase }));
}

/** Shape the public view of one agent. */
function snapshot(a, now) {
  const ageMs = now - a.lastSeen;
  return {
    agentId: a.agentId,
    gitUser: a.gitUser,
    host: a.host,
    version: a.version,
    sourceSchema: a.sourceSchema || 'unknown',
    foundationVersion: a.foundationVersion || 'unknown',
    status: a.status,
    activity: deriveActivity(a.runs, now),
    // Compact "working in" summary — repo + branch + file count, derived from the
    // reported changes. Full paths/line-ranges stay server-side for conflict math.
    // Only dirty entries: a clean repo reporting history stats isn't "working in".
    repos: (a.changes || []).filter((c) => Array.isArray(c.files) && c.files.length).map((c) => ({
      repo: String(c.repoId).split('/').slice(-2).join('/'),
      branch: c.branch,
      dir: c.path || '',
      label: c.label || '',
      files: Array.isArray(c.files) ? c.files.length : 0,
    })),
    firstSeen: a.firstSeen,
    lastSeen: a.lastSeen,
    ageMs,
    online: ageMs <= ONLINE_TTL_MS && a.status !== 'offline',
  };
}

// ── Pure helpers ────────────────────────────────────────────────────────────
function toInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Coerce to a clean, bounded, control-char-free string. */
function clean(v, max = MAX_FIELD_LEN) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max).trim();
}

/** Sanitize the reported /dev runs (active + completed) used for activity + stats. */
function cleanRuns(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 300)
    .map((r) => ({
      id: clean(r && r.id, 80),
      type: clean(r && r.type, 20),
      repo: clean(r && r.repo, 120),
      repoId: clean(r && r.repoId, 200),
      branch: clean(r && r.branch, 120),
      owner: clean(r && r.owner, 80),
      ownerEmail: clean(r && r.ownerEmail, 120),
      size: clean(r && r.size, 8),
      phase: clean(r && r.phase, 40),
      started: Math.max(0, toInt(r && r.started, 0)),
      finished: Math.max(0, toInt(r && r.finished, 0)),
      done: !!(r && r.done),
      art: cleanArtifacts(r && r.art),
    }))
    .filter((r) => r.id);
}

/** Sanitize the run's artifact mtimes ({spec: <epoch>, plan: <epoch>, …}). */
const ARTIFACT_KEYS = ['spec', 'plan', 'test-plan', 'tests', 'review', 'security', 'retro'];
function cleanArtifacts(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const k of ARTIFACT_KEYS) {
      const v = toInt(raw[k], 0);
      if (v > 0) out[k] = v;
    }
  }
  return out;
}

/** Sanitize the reported Claude token usage rows (per day × model aggregates). */
function cleanUsage(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 3000)
    .map((u) => ({
      date: clean(u && u.date, 10),
      model: clean(u && u.model, 80),
      project: clean(u && u.project, 80),
      input: Math.max(0, toInt(u && u.input, 0)),
      output: Math.max(0, toInt(u && u.output, 0)),
      cacheCreate: Math.max(0, toInt(u && u.cacheCreate, 0)),
      cacheRead: Math.max(0, toInt(u && u.cacheRead, 0)),
      count: Math.max(0, toInt(u && u.count, 0)),
    }))
    .filter((u) => /^\d{4}-\d{2}-\d{2}$/.test(u.date) && u.model);
}

/** Sanitize the reported per-day Claude session stats. */
function cleanSessions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 100)
    .map((s) => ({
      date: clean(s && s.date, 10),
      count: Math.max(0, toInt(s && s.count, 0)),
      seconds: Math.max(0, toInt(s && s.seconds, 0)),
    }))
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date));
}

/** Sanitize a list of {date, <field>} count rows. */
function cleanDateCounts(raw, field) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 20)
    .map((c) => ({ date: clean(c && c.date, 10), [field]: Math.max(0, toInt(c && c[field], 0)) }))
    .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.date));
}

/** Sanitize the reported tool-call counts. */
function cleanTools(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 3000)
    .map((t) => ({
      date: clean(t && t.date, 10),
      tool: clean(t && t.tool, 60),
      count: Math.max(0, toInt(t && t.count, 0)),
    }))
    .filter((t) => t.tool && /^\d{4}-\d{2}-\d{2}$/.test(t.date));
}

/** Sanitize a list of [start,end] line ranges. */
function cleanRanges(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw.slice(0, 200)) {
    if (!Array.isArray(r) || r.length < 2) continue;
    const s = Math.max(0, Math.floor(Number(r[0])) || 0);
    const e = Math.max(s, Math.floor(Number(r[1])) || s);
    out.push([s, e]);
  }
  return out;
}

/** Sanitize the optional changes array (per-repo changed files+line-ranges for conflict detection). */
function cleanChanges(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 60)
    .map((r) => ({
      repoId: clean(r && r.repoId, 200),
      branch: clean(r && r.branch, 120),
      path: clean(r && r.path, 300),
      label: clean(r && r.label, 80),
      fuOpen: Math.max(0, toInt(r && r.fuOpen, 0)),
      fuClosed: Math.max(0, toInt(r && r.fuClosed, 0)),
      commits: cleanDateCounts(r && r.commits, 'n'),
      pushes: cleanDateCounts(r && r.pushes, 'n'),
      work: Array.isArray(r && r.work)
        ? r.work
            .slice(0, 20)
            .map((w) => ({
              date: clean(w && w.date, 10),
              commits: Math.max(0, toInt(w && w.commits, 0)),
              added: Math.max(0, toInt(w && w.added, 0)),
              deleted: Math.max(0, toInt(w && w.deleted, 0)),
            }))
            .filter((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.date))
        : [],
      files: Array.isArray(r && r.files)
        ? r.files
            .slice(0, 100)
            .map((f) => ({ path: clean(f && f.path, 300), ranges: cleanRanges(f && f.ranges) }))
            .filter((f) => f.path && f.ranges.length)
        : [],
    }))
    // File-less entries are legit since client 1.10: a clean-but-recently-active
    // repo still reports commits/work/pushes so finished work keeps counting.
    .filter((r) => r.repoId && (
      r.files.length || r.work.length || r.commits.length || r.pushes.length || r.fuOpen || r.fuClosed
    ));
}

/** Constant-time string compare that tolerates length differences. */
function keyMatches(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Pull the presented key from header or ?key= query. */
function presentedKey(req, url) {
  const auth = req.headers['authorization'] || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return req.headers['x-cf-key'] || bearer || url.searchParams.get('key') || '';
}

// ── HTTP plumbing ───────────────────────────────────────────────────────────
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-cf-key, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/** Read a size-capped JSON body. Resolves { ok, value | error }. */
function readJsonBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    let over = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        // Stop buffering but keep draining so the connection ends cleanly — a
        // req.destroy() here makes the upstream proxy surface a 502.
        over = true;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (over) return resolve({ ok: false, error: 'body too large' });
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({ ok: true, value: {} });
      try {
        // `JSON.parse('null')` succeeds and yields null, as do '1', '"x"' and
        // '[]'. Every caller reads named fields off this, so anything that is
        // not a JSON object is a bad request, not a body.
        const value = JSON.parse(raw);
        if (!value || typeof value !== 'object' || Array.isArray(value))
          return resolve({ ok: false, error: 'body must be a JSON object' });
        resolve({ ok: true, value });
      } catch {
        resolve({ ok: false, error: 'invalid JSON' });
      }
    });
    req.on('error', () => resolve({ ok: false, error: 'read error' }));
  });
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Serve a static file from PUBLIC_DIR, guarding against path traversal. */
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ── Route handlers ──────────────────────────────────────────────────────────
async function handleHeartbeat(req, res, url) {
  if (!keyMatches(presentedKey(req, url), SHARED_KEY)) {
    return sendJson(res, 401, { ok: false, error: 'bad key' });
  }
  const body = await readJsonBody(req);
  if (!body.ok) return sendJson(res, 400, { ok: false, error: body.error });

  const agentId = clean(body.value.agentId);
  if (!agentId) return sendJson(res, 400, { ok: false, error: 'agentId required' });

  const now = Date.now();
  const status = clean(body.value.status) || 'online';
  // Validate before the throttle: a throttled beat still returns 200, so a
  // status checked afterwards is a status a fast client never has to pass.
  if (!['online', 'offline'].includes(status)) return sendJson(res, 400, { ok: false, error: 'invalid status' });
  const existing = agents.get(agentId);
  // A shared key plus an arbitrary agentId is enough to register unbounded
  // agents; prune() only evicts after idle minutes, far slower than a loop
  // adds. Cap the roster, and rate-limit each agent's writes — the client
  // beats every 30s, so anything faster is not a real beat.
  if (!existing && agents.size >= MAX_AGENTS)
    return sendJson(res, 429, { ok: false, error: 'agent capacity reached' });
  // Throttle against the last ACCEPTED beat, not the last one seen. Sliding the
  // window on rejections would let a client beating faster than the interval
  // throttle itself forever and never persist data again; lastSeen still moves
  // so liveness keeps working.
  if (existing && now - (existing.lastAccepted ?? existing.lastSeen) < MIN_HEARTBEAT_INTERVAL_MS && status !== 'offline') {
    existing.lastSeen = now;
    return sendJson(res, 200, {
      ok: true,
      onlineCount: [...agents.values()].filter((a) => now - a.lastSeen <= ONLINE_TTL_MS).length,
      ttlMs: ONLINE_TTL_MS,
      throttled: true,
    });
  }
  const next = {
    agentId,
    gitUser: clean(body.value.gitUser) || 'unknown',
    gitEmail: clean(body.value.gitEmail, 120).toLowerCase(),
    host: clean(body.value.host),
    version: clean(body.value.version),
    sourceSchema: clean(body.value.sourceSchema, 64) || 'unknown',
    foundationVersion: clean(body.value.foundationVersion, 64) || 'unknown',
    status,
    runs: cleanRuns(body.value.runs),
    changes: cleanChanges(body.value.changes),
    usage: cleanUsage(body.value.usage),
    sessions: cleanSessions(body.value.sessions),
    tools: cleanTools(body.value.tools),
    prs: cleanDateCounts(body.value.prs, 'n'),
    firstSeen: existing ? existing.firstSeen : now,
    lastSeen: now,
    lastAccepted: now,
  };
  next.datasetHashes = datasetHashes(next);
  const changed = changedDatasets(existing, next.datasetHashes);
  agents.set(agentId, next);

  persistHeartbeat(next, now, changed);
  if (status === 'offline') agents.delete(agentId);
  else if (!existing || changed.changes) persistConflicts(now);
  onlineCache.at = 0;
  if (changed.usage || changed.sessions || changed.tools || changed.changes || changed.prs) usageCache.at = 0;

  prune(now);
  const onlineCount = [...agents.values()].filter((a) => now - a.lastSeen <= ONLINE_TTL_MS).length;
  return sendJson(res, 200, { ok: true, onlineCount, ttlMs: ONLINE_TTL_MS });
}

// git performs 3-way merges with 3 lines of context, so edits within a few
// lines of each other can still collide — pad ranges before testing overlap.
const RANGE_PAD = 3;

function rangesOverlap(a, b) {
  for (const [s1, e1] of a) {
    for (const [s2, e2] of b) {
      if (s1 - RANGE_PAD <= e2 && s2 - RANGE_PAD <= e1) return true;
    }
  }
  return false;
}

/**
 * Cross-reference online agents' changes: for each repo+file touched by two or
 * more distinct (user, branch) parties with overlapping line ranges, emit a
 * potential-conflict entry. This is a heuristic early warning, not a guarantee.
 */
function computeConflicts(now) {
  const live = [...agents.values()].filter(
    (a) => a.status !== 'offline' && now - a.lastSeen <= ONLINE_TTL_MS && Array.isArray(a.changes) && a.changes.length,
  );

  // repoId -> path -> partyKey -> { gitUser, branch, ranges }
  const idx = new Map();
  for (const a of live) {
    for (const repo of a.changes) {
      for (const f of repo.files) {
        if (!idx.has(repo.repoId)) idx.set(repo.repoId, new Map());
        const files = idx.get(repo.repoId);
        if (!files.has(f.path)) files.set(f.path, new Map());
        const partyKey = `${a.gitUser}@@${repo.branch}`;
        const existing = files.get(f.path).get(partyKey);
        if (existing) existing.ranges = existing.ranges.concat(f.ranges);
        else files.get(f.path).set(partyKey, { gitUser: a.gitUser, branch: repo.branch, ranges: f.ranges.slice() });
      }
    }
  }

  const conflicts = [];
  for (const [repoId, files] of idx) {
    for (const [path, partyMap] of files) {
      const parties = [...partyMap.values()];
      if (parties.length < 2) continue;
      // Keep only parties that actually overlap with at least one other party,
      // so someone editing a different region of the same file isn't flagged.
      const involved = new Array(parties.length).fill(false);
      for (let i = 0; i < parties.length; i++) {
        for (let j = i + 1; j < parties.length; j++) {
          if (rangesOverlap(parties[i].ranges, parties[j].ranges)) involved[i] = involved[j] = true;
        }
      }
      const clashing = parties.filter((_, i) => involved[i]);
      if (clashing.length >= 2) conflicts.push({ repoId, path, parties: clashing });
    }
  }
  conflicts.sort((x, y) => y.parties.length - x.parties.length || x.path.localeCompare(y.path));
  return conflicts.slice(0, 100);
}

const DAY_MS = 86400 * 1000;

/**
 * Dedupe runs across all agents by repoId|id (repo basename as fallback).
 * Freshness: first/most-recent reporter wins the run's live fields. Attribution:
 * the run's own `owner` (state.json / first-commit author) ALWAYS beats the
 * reporting agent's identity — a teammate re-reporting your pulled .workflow/
 * dir must not steal the credit. Reporter identity is only the last resort.
 */
function dedupeRuns(pickNewest) {
  const seen = new Map();
  for (const a of agents.values()) {
    for (const r of a.runs || []) {
      const key = `${r.repoId || r.repo}|${r.id}`;
      const cur = seen.get(key);
      if (!cur || (pickNewest && r.finished > cur.finished)) {
        const owner = r.owner || (cur && cur.owner) || '';
        seen.set(key, { ...r, owner, gitUser: owner || a.gitUser });
      } else if (!cur.owner && r.owner) {
        cur.owner = r.owner;
        cur.gitUser = r.owner;
      }
    }
  }
  return [...seen.values()];
}

function median(sortedNums) {
  return sortedNums.length ? sortedNums[Math.floor(sortedNums.length / 2)] : 0;
}

/**
 * Flatten every agent's token-usage rows, tagged with who reported them.
 * Rows are already per-machine (agentId) day × model aggregates, so no dedupe
 * is needed — two agents are two machines, even for the same gitUser.
 */
function collectUsage() {
  const out = [];
  for (const a of agents.values()) {
    for (const u of a.usage || []) out.push({ ...u, gitUser: a.gitUser, agentId: a.agentId });
  }
  return out.slice(0, 12000);
}

/** Flatten every agent's per-day session stats / tool counts, tagged with reporter. */
function collectSessions() {
  const out = [];
  for (const a of agents.values()) {
    for (const s of a.sessions || []) out.push({ ...s, gitUser: a.gitUser, agentId: a.agentId });
  }
  return out.slice(0, 2000);
}
function collectTools() {
  const out = [];
  for (const a of agents.values()) {
    for (const t of a.tools || []) out.push({ ...t, gitUser: a.gitUser, agentId: a.agentId });
  }
  return out.slice(0, 2000);
}

/** Flatten every agent's per-day output (commits/lines/pushes/PRs), tagged with reporter. */
function collectWork() {
  const out = [];
  for (const a of agents.values()) {
    for (const w of workRowsFor(a)) out.push({ ...w, gitUser: a.gitUser, agentId: a.agentId });
  }
  return out.slice(0, 2000);
}

/** Per-repo commit activity + follow-up backlog, deduped by repoId (newest reporter wins). */
function collectRepoStats() {
  const idx = new Map();
  const byRecency = [...agents.values()].sort((x, y) => y.lastSeen - x.lastSeen);
  for (const a of byRecency) {
    for (const c of a.changes || []) {
      if (idx.has(c.repoId)) continue;
      idx.set(c.repoId, {
        repoId: c.repoId,
        commits: c.commits || [],
        fuOpen: c.fuOpen || 0,
        fuClosed: c.fuClosed || 0,
      });
    }
  }
  return [...idx.values()].slice(0, 100);
}

/** Aggregate /dev completion stats across all known agents. */
function computeStats(now) {
  const all = dedupeRuns(false);
  const completed = all.filter((r) => r.done);
  const inFlight = all.filter((r) => !r.done && r.finished && now - r.finished * 1000 <= 7 * DAY_MS);

  const durs = completed.map((r) => r.finished - r.started).filter((d) => d > 0).sort((x, y) => x - y);
  const avgDuration = durs.length ? Math.round(durs.reduce((s, d) => s + d, 0) / durs.length) : 0;

  const byType = {};
  const durByTypeArr = {};
  for (const r of completed) {
    const t = r.type || 'other';
    byType[t] = (byType[t] || 0) + 1;
    const d = r.finished - r.started;
    if (d > 0) (durByTypeArr[t] = durByTypeArr[t] || []).push(d);
  }
  const durByType = {};
  for (const t of Object.keys(durByTypeArr)) durByType[t] = median(durByTypeArr[t].sort((x, y) => x - y));

  const weekAgo = now - 7 * DAY_MS;
  const completedThisWeek = completed.filter((r) => r.finished * 1000 >= weekAgo).length;

  const throughput = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * DAY_MS);
    d.setHours(0, 0, 0, 0);
    const start = d.getTime();
    throughput.push({
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      count: completed.filter((r) => r.finished * 1000 >= start && r.finished * 1000 < start + DAY_MS).length,
    });
  }

  const byPerson = {};
  const byRepo = {};
  for (const r of completed) {
    byPerson[r.gitUser || 'unknown'] = (byPerson[r.gitUser || 'unknown'] || 0) + 1;
    byRepo[r.repo || 'unknown'] = (byRepo[r.repo || 'unknown'] || 0) + 1;
  }
  const top = (obj, k) =>
    Object.entries(obj).map(([name, count]) => ({ [k]: name, count })).sort((a, b) => b.count - a.count).slice(0, 8);

  return {
    totalCompleted: completed.length,
    completedThisWeek,
    inFlight: inFlight.length,
    totalRuns: all.length,
    avgDuration,
    medianDuration: median(durs),
    byType,
    durByType,
    throughput,
    topPeople: top(byPerson, 'name'),
    topRepos: top(byRepo, 'repo'),
  };
}

/** Recent run events for the Activity feed (newest first). */
function computeFeed() {
  return dedupeRuns(true)
    .filter((r) => r.finished)
    .sort((a, b) => b.finished - a.finished)
    .slice(0, 25)
    .map((r) => ({
      id: r.id,
      type: r.type,
      repo: r.repo,
      gitUser: r.gitUser,
      phase: r.phase,
      done: r.done,
      finished: r.finished,
      durationSec: r.done && r.finished > r.started ? r.finished - r.started : 0,
    }));
}

/**
 * GET /api/log/heartbeats — the persisted heartbeat log (VIEW_KEY).
 * Query: limit (<=2000, default 200), agent, user, since (epoch ms, default 24h ago).
 */
function handleHeartbeatLog(req, res, url) {
  if (!keyMatches(presentedKey(req, url), VIEW_KEY)) {
    return sendJson(res, 401, { ok: false, error: 'bad key' });
  }
  if (!db) return sendJson(res, 503, { ok: false, error: 'no database attached' });
  const limit = Math.min(Math.max(toInt(url.searchParams.get('limit'), 200), 1), 2000);
  const since = toInt(url.searchParams.get('since'), Date.now() - 86400000);
  const agent = clean(url.searchParams.get('agent') || '', 64);
  const user = clean(url.searchParams.get('user') || '', 80);
  try {
    const rows = stmts.logBeats.all(since, agent, agent, user, user, limit);
    return sendJson(res, 200, { ok: true, since, count: rows.length, beats: rows });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'query failed' });
  }
}

/**
 * GET /api/presence?days=7 — who was online when, from the heartbeat log (VIEW_KEY).
 * Returns hour-bucketed online minutes per person; the client localizes and
 * renders the work-hours heatmap + per-person totals.
 */
function handlePresence(req, res, url) {
  if (!keyMatches(presentedKey(req, url), VIEW_KEY)) {
    return sendJson(res, 401, { ok: false, error: 'bad key' });
  }
  if (!db) return sendJson(res, 503, { ok: false, error: 'no database attached' });
  const days = Math.min(Math.max(toInt(url.searchParams.get('days'), 7), 1), 30);
  try {
    const buckets = stmts.presence.all(Math.floor((Date.now() - days * 86400000) / 3600000));
    return sendJson(res, 200, { ok: true, days, buckets });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'query failed' });
  }
}

/**
 * POST /api/profile — upsert one person's profile (VIEW_KEY: any dashboard
 * viewer may edit; it's team-membership metadata, not measurement data).
 * Body: { user, email?, org?, teams?: ["tag", …], color?: "#rrggbb" }.
 */
async function handleProfile(req, res, url) {
  if (!keyMatches(presentedKey(req, url), VIEW_KEY) && !keyMatches(presentedKey(req, url), SHARED_KEY)) {
    return sendJson(res, 401, { ok: false, error: 'bad key' });
  }
  const body = await readJsonBody(req);
  if (!body.ok) return sendJson(res, 400, { ok: false, error: body.error });
  const user = clean(body.value.user, 80);
  if (!user) return sendJson(res, 400, { ok: false, error: 'user required' });
  // Profiles have no idle eviction at all — unlike agents, nothing ever prunes
  // them — and every one is serialized into /api/online. Cap the map the same
  // way the agent roster is capped.
  if (!profiles.has(user) && profiles.size >= MAX_PROFILES)
    return sendJson(res, 429, { ok: false, error: 'profile capacity reached' });
  const teams = (Array.isArray(body.value.teams) ? body.value.teams : [])
    .map((t) => clean(t, 40).toLowerCase()).filter(Boolean).slice(0, 10);
  const color = /^#[0-9a-fA-F]{6}$/.test(String(body.value.color || '')) ? String(body.value.color).toLowerCase() : '';
  const p = {
    user,
    email: clean(body.value.email, 120).toLowerCase(),
    org: clean(body.value.org, 80),
    teams: [...new Set(teams)],
    color,
    updatedAt: Date.now(),
  };
  profiles.set(user, p);
  onlineCache.at = 0;
  if (db) {
    try { stmts.upsertProfile.run(p.user, p.email, p.org, JSON.stringify(p.teams), p.color, p.updatedAt); }
    catch (err) { console.warn(`sqlite profile write failed: ${err.message}`); }
  }
  return sendJson(res, 200, { ok: true, profile: p });
}

/**
 * GET /api/history?days=120 — durable aggregates from SQLite (VIEW_KEY):
 * long-range usage trend, top projects, file-edit hotspots, conflict history.
 */
function handleHistory(req, res, url) {
  if (!keyMatches(presentedKey(req, url), VIEW_KEY)) {
    return sendJson(res, 401, { ok: false, error: 'bad key' });
  }
  if (!db) return sendJson(res, 503, { ok: false, error: 'no database attached' });
  const days = Math.min(Math.max(toInt(url.searchParams.get('days'), 120), 7), 365);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  try {
    return sendJson(res, 200, {
      ok: true,
      days,
      usage: stmts.historyUsage.all(cutoff),
      projects: stmts.historyProjects.all(cutoff),
      hotspots: stmts.hotspots.all(cutoff),
      conflicts: stmts.conflictHistory.all(),
      // Per-person per-day output, MAX-merged across machines — powers the
      // workload comparison beyond the live clients' 14-day reporting window.
      work: stmts.historyWork.all(cutoff),
    });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: 'query failed' });
  }
}

// Usage changes every few minutes, so keep it off the 5-second presence route.
let usageCache = { at: 0, body: '' };
function handleUsage(req, res, url) {
  if (!keyMatches(presentedKey(req, url), VIEW_KEY)) {
    return sendJson(res, 401, { ok: false, error: 'bad key' });
  }
  const now = Date.now();
  if (!usageCache.body || now - usageCache.at >= 30_000) {
    usageCache = { at: now, body: JSON.stringify({
      ok: true, now,
      usage: collectUsage(), sessions: collectSessions(), tools: collectTools(),
      work: collectWork(), repoStats: collectRepoStats(),
    }) };
  }
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  return res.end(usageCache.body);
}

// Building /api/online walks every agent's live state (conflict math is
// O(files × parties²)) — memoize the serialized payload so 100 viewers polling
// every 5s cost one recompute per ONLINE_CACHE_MS, not one per request.
let onlineCache = { at: 0, body: '' };

function handleOnline(req, res, url) {
  if (!keyMatches(presentedKey(req, url), VIEW_KEY)) {
    return sendJson(res, 401, { ok: false, error: 'bad key' });
  }
  const now = Date.now();
  if (onlineCache.body && now - onlineCache.at < ONLINE_CACHE_MS) {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    });
    return res.end(onlineCache.body);
  }
  prune(now);
  const all = [...agents.values()].map((a) => snapshot(a, now));
  all.sort((x, y) => (x.online === y.online ? x.gitUser.localeCompare(y.gitUser) : x.online ? -1 : 1));
  const payload = {
    now,
    version: APP_VERSION,
    ttlMs: ONLINE_TTL_MS,
    onlineCount: all.filter((a) => a.online).length,
    totalCount: all.length,
    agents: all,
    profiles: [...profiles.values()].slice(0, MAX_PROFILES),
    conflicts: computeConflicts(now),
    // Deduped run list — the client computes stats + feed from this so it can
    // filter by teammate and use the viewer's own timezone for day buckets.
    // gitUser is already owner-corrected by dedupeRuns.
    runs: dedupeRuns(true).slice(0, 400).map((r) => ({
      id: r.id, type: r.type, repo: r.repo, gitUser: r.gitUser, owner: r.owner || '',
      size: r.size || '', phase: r.phase, started: r.started, finished: r.finished, done: r.done,
      art: r.art || {},
    })),
  };
  onlineCache = { at: now, body: JSON.stringify(payload) };
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  return res.end(onlineCache.body);
}

// ── Server ──────────────────────────────────────────────────────────────────
/**
 * Keep an async handler's rejection inside the request. Node's default is to
 * treat an unhandled rejection as fatal, so one malformed body from any key
 * holder would otherwise end the process.
 */
function guard(res, promise) {
  return Promise.resolve(promise).catch((error) => {
    console.error('handler failed:', error && error.stack ? error.stack : error);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal error' });
    else res.end();
  });
}

const server = http.createServer((req, res) => {
  // `new URL('//', base)` throws, and so does any Host header the parser
  // rejects. Both are reachable unauthenticated, so neither may reach the
  // top of a request listener that has nothing above it to catch.
  let url;
  try {
    // A leading '//' reads as protocol-relative, so '//api/online' would parse
    // to host 'api' and path '/online' and silently misroute. Proxies do emit
    // it; collapse it rather than serve the wrong thing.
    url = new URL(String(req.url || '/').replace(/^\/{2,}/, '/'),
      `http://${req.headers.host || 'localhost'}`);
  } catch {
    return sendJson(res, 400, { ok: false, error: 'bad request target' });
  }
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-cf-key, authorization',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    });
    return res.end();
  }

  // Railway's healthcheck needs this open, so it carries liveness and nothing
  // else. Headcount, build version and storage mode are operational detail an
  // unauthenticated caller has no claim on.
  if (pathname === '/api/health') return sendJson(res, 200, { ok: true });
  if (pathname === '/api/heartbeat' && req.method === 'POST') return guard(res, handleHeartbeat(req, res, url));
  if (pathname === '/api/online' && req.method === 'GET') return handleOnline(req, res, url);
  if (pathname === '/api/usage' && req.method === 'GET') return handleUsage(req, res, url);
  if (pathname === '/api/profile' && req.method === 'POST') return guard(res, handleProfile(req, res, url));
  if (pathname === '/api/log/heartbeats' && req.method === 'GET') return handleHeartbeatLog(req, res, url);
  if (pathname === '/api/presence' && req.method === 'GET') return handlePresence(req, res, url);
  if (pathname === '/api/history' && req.method === 'GET') return handleHistory(req, res, url);
  if (pathname.startsWith('/api/')) return sendJson(res, 404, { ok: false, error: 'unknown endpoint' });

  return serveStatic(req, res, pathname);
});

function startServer(port = PORT) {
  return server.listen(port, () => {
    const address = server.address();
    console.log(`claude-foundation dashboard listening on :${address && address.port}  (online window ${ONLINE_TTL_MS}ms)`);
  });
}

if (require.main === module) {
  startServer();
  // A restart policy turns a reproducible crash into a permanent outage: the
  // caller who triggers it can spend the retry budget in a few seconds. Log
  // and keep serving instead — a wedged request beats a dead deployment.
  process.on('uncaughtException', (error) => {
    console.error('uncaught exception:', error && error.stack ? error.stack : error);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('unhandled rejection:', reason && reason.stack ? reason.stack : reason);
  });
  // Railway sends SIGTERM on redeploy — shut the socket cleanly.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      console.log(`${sig} received — closing.`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}

module.exports = {
  server, startServer,
  _internals: { agents, profiles, db, datasetHashes, changedDatasets, computeConflicts },
};
