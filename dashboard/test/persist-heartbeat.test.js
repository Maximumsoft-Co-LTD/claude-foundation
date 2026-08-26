'use strict';

const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-dashboard-persist-'));
process.env.SHARED_KEY = 'persist-test-key';
process.env.DB_PATH = path.join(temp, 'dashboard.db');
process.env.PORT = '0';

const { _internals } = require('../server');
const {
  heartbeatFileCount, heartbeatToolTotals, persistHeartbeatIfAvailable,
  persistHeartbeatOperation,
} = _internals;

after(() => {
  if (_internals.db) _internals.db.close();
  fs.rmSync(temp, { recursive: true, force: true });
});

function statementFixture(presenceChanges = 1) {
  const calls = [];
  const names = [
    'insertBeat', 'deleteAgent', 'upsertAgent', 'insertPresenceMinute',
    'upsertPresence', 'upsertRun', 'upsertUsage', 'upsertSession',
    'deleteToolsForAgent', 'upsertTool', 'upsertCommits', 'upsertFollowups',
    'upsertFileEdit', 'upsertWork',
  ];
  const stmts = Object.fromEntries(names.map((name) => [name, {
    run: (...args) => {
      calls.push([name, ...args]);
      return name === 'insertPresenceMinute' ? { changes: presenceChanges } : {};
    },
  }]));
  return { stmts, calls };
}

function context(options = {}) {
  const fixture = statementFixture(options.presenceChanges);
  const dbCalls = [];
  const warnings = [];
  return {
    ...fixture,
    dbCalls,
    warnings,
    value: {
      stmts: fixture.stmts,
      db: { exec: (command) => dbCalls.push(command) },
      workRowsFor: options.workRowsFor || (() => []),
      warn: (message) => warnings.push(message),
    },
  };
}

test('heartbeat aggregate helpers count files and merge duplicate tools', () => {
  assert.equal(heartbeatFileCount(null), 0);
  assert.equal(heartbeatFileCount([
    { files: [{}, {}] }, { files: null }, {}, { files: [{}] },
  ]), 3);
  assert.deepEqual([...heartbeatToolTotals(null)], []);
  assert.deepEqual([...heartbeatToolTotals([
    { tool: 'Read', count: 2 }, { tool: 'Write', count: 1 },
    { tool: 'Read', count: 3 },
  ])], [['Read', 5], ['Write', 1]]);
});

test('heartbeat persistence writes every changed online dataset in transaction order', () => {
  const fixture = context({
    workRowsFor: () => [{
      date: '2026-08-26', commits: 2, added: 3, deleted: 4, pushes: 5, prs: 6,
    }],
  });
  const agent = {
    agentId: 'agent', gitUser: 'user', host: 'host', version: '1', status: 'online',
    firstSeen: 10, lastSeen: 20,
    runs: [{
      repo: 'repo', id: 'run', type: 'test', phase: 'prove', started: 1,
      finished: 2, done: true, art: { report: 'x' }, owner: 'owner',
      ownerEmail: 'owner@example.test', size: 'small', repoId: 'root',
    }, {
      repo: 'repo', id: 'fallback', type: 'test', phase: 'prove', done: false,
    }],
    changes: [{
      repoId: 'root', fuOpen: 2, fuClosed: 1,
      commits: [{ date: '2026-08-26', n: 2 }],
      files: [{ path: 'src/a.js' }],
    }, { repoId: 'empty', fuOpen: 0, fuClosed: 0 }],
    usage: [{
      date: '2026-08-26', model: 'model', input: 1, output: 2,
      cacheCreate: 3, cacheRead: 4, count: 5,
    }],
    sessions: [{ date: '2026-08-26', count: 1, seconds: 60 }],
    tools: [{ tool: 'Read', count: 2 }, { tool: 'Read', count: 3 }],
    prs: [{ date: '2026-08-26', n: 1 }],
    sourceSchema: 'schema', foundationVersion: '3',
  };
  persistHeartbeatOperation(fixture.value, agent, Date.UTC(2026, 7, 26, 12), {
    runs: true, changes: true, usage: true, sessions: true, tools: true, prs: true,
  });
  assert.deepEqual(fixture.dbCalls, ['BEGIN', 'COMMIT']);
  assert.deepEqual(fixture.calls.map(([name]) => name), [
    'insertBeat', 'upsertAgent', 'insertPresenceMinute', 'upsertPresence',
    'upsertRun', 'upsertRun', 'upsertUsage', 'upsertSession',
    'deleteToolsForAgent', 'upsertTool', 'upsertCommits', 'upsertFollowups',
    'upsertFileEdit', 'upsertFollowups', 'upsertWork',
  ]);
  assert.equal(fixture.calls.find(([name]) => name === 'upsertTool')[3], 'Read');
  assert.equal(fixture.calls.find(([name]) => name === 'upsertTool')[4], 5);
  const fallbackRun = fixture.calls.filter(([name]) => name === 'upsertRun')[1];
  assert.deepEqual(fallbackRun.slice(-5), ['{}', '', '', '', '']);
  assert.equal(fixture.warnings.length, 0);
});

test('offline heartbeat deletes the agent and skips presence and unchanged datasets', () => {
  const fixture = context();
  persistHeartbeatOperation(fixture.value, {
    agentId: 'offline', gitUser: 'user', host: 'host', version: '1', status: 'offline',
  }, 120000, {
    runs: false, changes: false, usage: false, sessions: false, tools: false, prs: false,
  });
  assert.deepEqual(fixture.calls.map(([name]) => name), ['insertBeat', 'deleteAgent']);
  assert.deepEqual(fixture.dbCalls, ['BEGIN', 'COMMIT']);
});

test('deduplicated presence and unchanged aggregates perform no extra writes', () => {
  const fixture = context({ presenceChanges: 0 });
  persistHeartbeatOperation(fixture.value, {
    agentId: 'agent', gitUser: 'user', gitEmail: 'mail', host: 'host', version: '1',
    status: 'online', firstSeen: 1, lastSeen: 2,
  }, 120000, {
    runs: false, changes: false, usage: false, sessions: false, tools: false, prs: false,
  });
  assert.deepEqual(fixture.calls.map(([name]) => name), [
    'insertBeat', 'upsertAgent', 'insertPresenceMinute',
  ]);
});

test('changed flags tolerate sparse aggregate payloads as empty datasets', () => {
  const fixture = context({ workRowsFor: () => [] });
  persistHeartbeatOperation(fixture.value, {
    agentId: 'sparse', gitUser: 'user', host: 'host', version: '1',
    status: 'online', firstSeen: 1, lastSeen: 2,
  }, 120000, {
    runs: true, changes: true, usage: true, sessions: true, tools: true, prs: true,
  });
  assert.deepEqual(fixture.calls.map(([name]) => name), [
    'insertBeat', 'upsertAgent', 'insertPresenceMinute', 'upsertPresence',
    'deleteToolsForAgent',
  ]);
  assert.deepEqual(fixture.dbCalls, ['BEGIN', 'COMMIT']);
});

test('persistence rolls back and warns even when rollback itself fails', () => {
  const fixture = context();
  fixture.value.db.exec = (command) => {
    fixture.dbCalls.push(command);
    if (command === 'BEGIN' || command === 'ROLLBACK') throw new Error(`${command} failed`);
  };
  persistHeartbeatOperation(fixture.value, {}, 0, {});
  assert.deepEqual(fixture.dbCalls, ['BEGIN', 'ROLLBACK']);
  assert.deepEqual(fixture.warnings, ['sqlite write failed: BEGIN failed']);
});

test('persistence availability guard is inert without a database', () => {
  assert.doesNotThrow(() => persistHeartbeatIfAvailable({
    db: null,
    stmts: new Proxy({}, { get: assert.fail }),
    workRowsFor: assert.fail,
    warn: assert.fail,
  }, {}, 0, {}));
  const fixture = context();
  persistHeartbeatIfAvailable(fixture.value, {
    agentId: 'guarded', gitUser: 'user', host: 'host', version: '1', status: 'offline',
  }, 0, {});
  assert.deepEqual(fixture.dbCalls, ['BEGIN', 'COMMIT']);
});
