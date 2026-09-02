'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { migrateDashboardSchema, SCHEMA_VERSION } = require('../migrations');

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { /* optional on Node < 24 */ }
const sqliteTest = DatabaseSync ? test : test.skip;

function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function legacyDatabase(version) {
  const db = new DatabaseSync(':memory:');
  const artifacts = version >= 2 ? ', artifacts TEXT' : '';
  const modelColumns = version >= 3 ?
    ', owner TEXT, owner_email TEXT, size TEXT, repo_id TEXT' : '';
  const gitEmail = version >= 3 ? ', git_email TEXT' : '';
  db.exec(`
    CREATE TABLE agents (
      agent_id TEXT PRIMARY KEY, git_user TEXT${gitEmail}, host TEXT, version TEXT,
      status TEXT, first_seen INTEGER, last_seen INTEGER, state TEXT
    );
    CREATE TABLE runs (
      agent_id TEXT, repo TEXT, run_id TEXT, git_user TEXT, type TEXT, phase TEXT,
      started INTEGER, finished INTEGER, done INTEGER${artifacts}${modelColumns},
      PRIMARY KEY (agent_id, repo, run_id)
    );
    CREATE TABLE heartbeats (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
      agent_id TEXT, git_user TEXT, host TEXT, version TEXT, status TEXT,
      runs_n INTEGER, changes_n INTEGER, files_n INTEGER, usage_n INTEGER
    );
    PRAGMA user_version = ${version};
  `);
  return db;
}

sqliteTest('fresh database migrates atomically to the current schema', () => {
  const db = new DatabaseSync(':memory:');
  const result = migrateDashboardSchema(db);
  assert.deepEqual(result, { from: 0, to: SCHEMA_VERSION });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    .map((row) => row.name));
  for (const table of ['agents', 'runs', 'usage_daily', 'presence_hourly', 'profiles'])
    assert.ok(tables.has(table), `missing ${table}`);
  db.close();
});

sqliteTest('migration is idempotent', () => {
  const db = new DatabaseSync(':memory:');
  migrateDashboardSchema(db);
  assert.deepEqual(migrateDashboardSchema(db), { from: SCHEMA_VERSION, to: SCHEMA_VERSION });
  db.close();
});

for (const version of [1, 2, 3]) sqliteTest(`schema v${version} upgrades to the current schema`, () => {
  const db = legacyDatabase(version);
  assert.deepEqual(migrateDashboardSchema(db), { from: version, to: SCHEMA_VERSION });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  for (const name of ['artifacts', 'owner', 'owner_email', 'size', 'repo_id'])
    assert.ok(columns(db, 'runs').has(name), `runs.${name} missing after v${version} upgrade`);
  assert.ok(columns(db, 'agents').has('git_email'));
  db.close();
});

sqliteTest('future schema is rejected without rewriting its version marker', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1};`);
  assert.throws(() => migrateDashboardSchema(db), /newer than supported schema/);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION + 1);
  db.close();
});

test('failed migration rolls its transaction back', () => {
  const calls = [];
  const db = {
    prepare: () => ({ get: () => ({ user_version: 0 }) }),
    exec: (sql) => {
      calls.push(sql);
      if (sql.includes('CREATE TABLE IF NOT EXISTS agents')) throw new Error('injected DDL failure');
    },
  };
  assert.throws(() => migrateDashboardSchema(db), /injected DDL failure/);
  assert.equal(calls.at(-1), 'ROLLBACK;');
});
