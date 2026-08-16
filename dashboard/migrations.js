'use strict';

const SCHEMA_VERSION = 4;

function tryAlter(db, sql) {
  try { db.exec(sql); } catch { /* fresh database or column already present */ }
}

function migrateDashboardSchema(db, { warn = console.warn } = {}) {
  const dbVersion = db.prepare('PRAGMA user_version').get().user_version;
  if (dbVersion > SCHEMA_VERSION)
    throw new Error(
      `dashboard schema ${dbVersion} is newer than supported schema ${SCHEMA_VERSION}; ` +
      'refusing to rewrite its migration marker');
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec('BEGIN IMMEDIATE;');
  try {
    if (dbVersion < 2) {
      db.exec('DROP TABLE IF EXISTS usage_daily;');
      tryAlter(db, 'ALTER TABLE runs ADD COLUMN artifacts TEXT');
    }
    if (dbVersion < 3) {
      for (const sql of [
        'ALTER TABLE runs ADD COLUMN owner TEXT',
        'ALTER TABLE runs ADD COLUMN owner_email TEXT',
        'ALTER TABLE runs ADD COLUMN size TEXT',
        'ALTER TABLE runs ADD COLUMN repo_id TEXT',
        'ALTER TABLE agents ADD COLUMN git_email TEXT',
      ]) tryAlter(db, sql);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        git_user TEXT, git_email TEXT, host TEXT, version TEXT, status TEXT,
        first_seen INTEGER, last_seen INTEGER, state TEXT
      );
      CREATE TABLE IF NOT EXISTS heartbeats (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
        agent_id TEXT, git_user TEXT, host TEXT, version TEXT, status TEXT,
        runs_n INTEGER, changes_n INTEGER, files_n INTEGER, usage_n INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_hb_ts ON heartbeats(ts);
      CREATE INDEX IF NOT EXISTS idx_hb_agent ON heartbeats(agent_id, ts);
      CREATE TABLE IF NOT EXISTS runs (
        agent_id TEXT, repo TEXT, run_id TEXT, git_user TEXT, type TEXT, phase TEXT,
        started INTEGER, finished INTEGER, done INTEGER, artifacts TEXT,
        owner TEXT, owner_email TEXT, size TEXT, repo_id TEXT,
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
        user TEXT PRIMARY KEY, email TEXT, org TEXT, teams TEXT, color TEXT, updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS presence_hourly (
        hour INTEGER, git_user TEXT, minutes INTEGER, PRIMARY KEY (hour, git_user)
      );
      CREATE TABLE IF NOT EXISTS presence_minutes (
        minute INTEGER, git_user TEXT, PRIMARY KEY (minute, git_user)
      );
      CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_daily(date);
      CREATE INDEX IF NOT EXISTS idx_work_date ON work_daily(date);
    `);
    if (dbVersion < 3) {
      try {
        db.exec(`
          INSERT OR IGNORE INTO presence_hourly (hour, git_user, minutes)
          SELECT ts/3600000, git_user, COUNT(DISTINCT ts/60000)
          FROM heartbeats WHERE status != 'offline' GROUP BY ts/3600000, git_user;
        `);
      } catch (error) { warn(`presence backfill failed: ${error.message}`); }
    }
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    db.exec('COMMIT;');
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch { /* preserve the migration error */ }
    throw error;
  }
  return { from: dbVersion, to: SCHEMA_VERSION };
}

module.exports = { migrateDashboardSchema, SCHEMA_VERSION };
