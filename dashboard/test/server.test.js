'use strict';

const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-dashboard-server-'));
process.env.SHARED_KEY = 'test-key';
process.env.VIEW_KEY = 'view-key';
process.env.DB_PATH = path.join(temp, 'dashboard.db');
process.env.PORT = '0';

const { server, startServer, _internals } = require('../server');
let origin;

async function request(route, options = {}) {
  const response = await fetch(`${origin}${route}`, options);
  const body = await response.json();
  return { response, body };
}

function heartbeat(agentId, overrides = {}) {
  return request('/api/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cf-key': 'test-key' },
    body: JSON.stringify({
      agentId, gitUser: 'same-user', host: agentId, status: 'online',
      runs: [], changes: [], usage: [], sessions: [], tools: [], prs: [],
      ...overrides,
    }),
  });
}

before(async () => {
  await new Promise((resolve) => startServer(0).once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (_internals.db) _internals.db.close();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('presence credits one user-minute across multiple machines', async () => {
  assert.equal((await heartbeat('agent-one')).response.status, 200);
  assert.equal((await heartbeat('agent-two')).response.status, 200);
  const { response, body } = await request('/api/presence?days=1', {
    headers: { 'x-cf-key': 'view-key' },
  });
  if (!_internals.db) {
    assert.equal(response.status, 503);
    assert.equal(body.error, 'no database attached');
    return;
  }
  assert.equal(response.status, 200);
  assert.equal(body.buckets.filter((row) => row.user === 'same-user').reduce((sum, row) => sum + row.minutes, 0), 1);
});

test('usage is served on the slow endpoint and excluded from live presence', async () => {
  await heartbeat('usage-agent', {
    gitUser: 'usage-user',
    usage: [{ date: '2026-08-02', model: 'claude-sonnet', project: 'demo', input: 10, output: 2 }],
    sessions: [{ date: '2026-08-02', count: 1, seconds: 5 }],
    tools: [{ date: '2026-08-02', tool: 'Read', count: 3 }],
  });
  const online = await request('/api/online', { headers: { 'x-cf-key': 'view-key' } });
  assert.equal(Object.hasOwn(online.body, 'usage'), false);
  const usage = await request('/api/usage', { headers: { 'x-cf-key': 'view-key' } });
  assert.deepEqual(usage.body.tools.map(({ date, tool, count }) => ({ date, tool, count })), [
    { date: '2026-08-02', tool: 'Read', count: 3 },
  ]);
});

test('measured phase timing survives heartbeat and online projection without inventing values', async () => {
  await heartbeat('timing-agent', { runs: [{ id: 'timing-run', repo: 'timing',
    operationMs: { build: 4000, prove: 0, land: -1, change: null, secret: 123 } }] });
  const { body } = await request('/api/online', { headers: { 'x-cf-key': 'view-key' } });
  assert.deepEqual(body.runs.find((run) => run.id === 'timing-run').operationMs,
    { build: 4000, prove: 0 });
});

test('unchanged aggregate hashes suppress repeat dataset persistence', () => {
  const record = { runs: [], changes: [], usage: [{ date: 'x' }], sessions: [], tools: [], prs: [] };
  const hashes = _internals.datasetHashes(record);
  assert.deepEqual(_internals.changedDatasets({ datasetHashes: hashes }, hashes), {
    runs: false, changes: false, usage: false, sessions: false, tools: false, prs: false,
  });
});

test('work rows merge commits, pushes, and pull requests by day', () => {
  assert.deepEqual(_internals.workRowsFor({
    changes: [
      {
        work: [{ date: '2026-08-01', commits: 2, added: 10, deleted: 3 }],
        pushes: [{ date: '2026-08-02', n: 4 }],
      },
      {
        work: [{ date: '2026-08-01', commits: 1, added: 5, deleted: 2 }],
        pushes: [{ date: '2026-08-01', n: 2 }],
      },
    ],
    prs: [{ date: '2026-08-01', n: 3 }],
  }), [
    { date: '2026-08-01', commits: 3, added: 15, deleted: 5, pushes: 2, prs: 3 },
    { date: '2026-08-02', commits: 0, added: 0, deleted: 0, pushes: 4, prs: 0 },
  ]);
  assert.deepEqual(_internals.workRowsFor({}), []);
});

test('range overlap includes merge-context padding', () => {
  assert.equal(_internals.rangesOverlap([[10, 12]], [[15, 18]]), true);
  assert.equal(_internals.rangesOverlap([[10, 12]], [[16, 18]]), false);
  assert.equal(_internals.rangesOverlap([], [[1, 2]]), false);
});

test('conflicts include only live parties with overlapping edits', () => {
  const now = Date.now();
  const original = new Map(_internals.agents);
  _internals.agents.clear();
  const change = (branch, path, ranges) => [{ repoId: 'repo-1', branch, files: [{ path, ranges }] }];
  _internals.agents.set('one', {
    gitUser: 'alice', status: 'online', lastSeen: now,
    changes: change('feature-a', 'src/app.js', [[10, 12]]),
  });
  _internals.agents.set('two', {
    gitUser: 'bob', status: 'online', lastSeen: now,
    changes: change('feature-b', 'src/app.js', [[15, 16]]),
  });
  _internals.agents.set('three', {
    gitUser: 'carol', status: 'online', lastSeen: now,
    changes: change('feature-c', 'src/app.js', [[40, 42]]),
  });
  _internals.agents.set('offline', {
    gitUser: 'dave', status: 'offline', lastSeen: now,
    changes: change('feature-d', 'src/app.js', [[10, 12]]),
  });
  try {
    assert.deepEqual(_internals.computeConflicts(now), [{
      repoId: 'repo-1', path: 'src/app.js', parties: [
        { gitUser: 'alice', branch: 'feature-a', ranges: [[10, 12]] },
        { gitUser: 'bob', branch: 'feature-b', ranges: [[15, 16]] },
      ],
    }]);
  } finally {
    _internals.agents.clear();
    for (const [key, value] of original) _internals.agents.set(key, value);
  }
});

test('run deduplication preserves explicit ownership and can pick newest data', () => {
  const original = new Map(_internals.agents);
  _internals.agents.clear();
  _internals.agents.set('one', { gitUser: 'reporter-a', runs: [
    { repoId: 'repo-1', id: 'run-1', finished: 10, phase: 'old' },
    { repo: 'fallback', id: 'run-2', finished: 30, owner: '', phase: 'first' },
  ] });
  _internals.agents.set('two', { gitUser: 'reporter-b', runs: [
    { repoId: 'repo-1', id: 'run-1', finished: 20, owner: 'owner', phase: 'new' },
    { repo: 'fallback', id: 'run-2', finished: 20, owner: 'late-owner', phase: 'older' },
  ] });
  try {
    const newest = _internals.dedupeRuns(true);
    assert.deepEqual(newest.map(({ id, phase, owner, gitUser }) => ({ id, phase, owner, gitUser })), [
      { id: 'run-1', phase: 'new', owner: 'owner', gitUser: 'owner' },
      { id: 'run-2', phase: 'first', owner: 'late-owner', gitUser: 'late-owner' },
    ]);
    assert.equal(_internals.dedupeRuns(false)[0].phase, 'old');
  } finally {
    _internals.agents.clear();
    for (const [key, value] of original) _internals.agents.set(key, value);
  }
});

test('agent restoration tolerates corrupt state and storage failure', () => {
  const restored = new Map();
  const logs = [];
  const warnings = [];
  const row = {
    agent_id: 'restored', git_user: 'alice', git_email: null, host: 'host',
    version: '1', status: 'online', first_seen: 1, last_seen: 2, state: '{bad json',
  };
  _internals.restoreAgents(restored, {
    db: {}, stmts: { loadAgents: { all: () => [row] } }, clean: (value) => value || '',
    dbPath: '/tmp/test.db', log: (message) => logs.push(message), warn: (message) => warnings.push(message),
  });
  assert.equal(restored.get('restored').gitEmail, '');
  assert.deepEqual(restored.get('restored').runs, []);
  assert.equal(logs.length, 1);
  _internals.restoreAgents(new Map(), {
    db: {}, stmts: { loadAgents: { all: () => { throw new Error('read failed'); } } },
    clean: String, dbPath: '', log: assert.fail, warn: (message) => warnings.push(message),
  });
  assert.match(warnings[0], /read failed/);
  _internals.restoreAgents(new Map(), { db: null });
});

test('restored agents retain valid aggregate arrays and discard invalid ones', () => {
  assert.deepEqual(_internals.parseRestoredState(''), {});
  const restored = _internals.restoredAgent({
    agent_id: 'agent', git_user: 'alice', git_email: 'a@example.test', host: 'host',
    version: '1', status: 'online', first_seen: 1, last_seen: 2,
    state: JSON.stringify({
      sourceSchema: 'schema', foundationVersion: '2', runs: [{ id: 'run' }],
      changes: [{ repoId: 'repo' }], usage: [{ input: 1 }], sessions: [{ count: 1 }],
      tools: [1], prs: [{ n: 1 }],
    }),
  }, (value) => value || '');
  assert.equal(restored.sourceSchema, 'schema');
  assert.deepEqual(restored.runs, [{ id: 'run' }]);
  assert.deepEqual(restored.changes, [{ repoId: 'repo' }]);
  assert.deepEqual(restored.usage, [{ input: 1 }]);
  assert.deepEqual(restored.sessions, [{ count: 1 }]);
  assert.deepEqual(restored.tools, [1]);
  assert.deepEqual(restored.prs, [{ n: 1 }]);
});

test('persisted log and history endpoints enforce keys and bound queries', async () => {
  assert.equal((await request('/api/log/heartbeats')).response.status, 401);
  const log = await request('/api/log/heartbeats?limit=9999&since=0&agent=agent-one&user=same-user', {
    headers: { 'x-cf-key': 'view-key' },
  });
  if (!_internals.db) {
    assert.equal(log.response.status, 503);
    assert.equal(log.body.error, 'no database attached');
    const history = await request('/api/history?days=1', {
      headers: { 'x-cf-key': 'view-key' },
    });
    assert.equal(history.response.status, 503);
    assert.equal(history.body.error, 'no database attached');
    return;
  }
  assert.equal(log.response.status, 200);
  assert.equal(log.body.ok, true);
  assert.equal(log.body.since, 0);
  assert.equal(log.body.beats.every((row) => row.agentId === 'agent-one'), true);

  assert.equal((await request('/api/history')).response.status, 401);
  const shortHistory = await request('/api/history?days=1', { headers: { 'x-cf-key': 'view-key' } });
  assert.equal(shortHistory.response.status, 200);
  assert.equal(shortHistory.body.days, 7);
  assert.deepEqual(
    ['usage', 'projects', 'hotspots', 'conflicts', 'work'].filter((key) => Array.isArray(shortHistory.body[key])),
    ['usage', 'projects', 'hotspots', 'conflicts', 'work'],
  );
  const longHistory = await request('/api/history?days=9999', { headers: { authorization: 'Bearer view-key' } });
  assert.equal(longHistory.body.days, 365);
});

test('request routing handles preflight, unknown APIs, and static misses', async () => {
  const preflight = await fetch(`${origin}/api/online`, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
  assert.equal((await request('/api/not-real')).response.status, 404);
  const missing = await fetch(`${origin}/not-real.txt`);
  assert.equal(missing.status, 404);
});

test('request target parsing supplies safe defaults and rejects an invalid host', () => {
  const fallback = _internals.requestUrl({ url: '', headers: {} });
  assert.equal(fallback.href, 'http://localhost/');
  assert.equal(_internals.requestUrl({ url: '/', headers: { host: '[' } }), null);

  const writes = [];
  _internals.handleRequest({ url: '/', headers: { host: '[' } }, {
    writeHead: (status, headers) => writes.push({ status, headers }),
    end: (body) => writes.push(JSON.parse(body)),
  });
  assert.equal(writes[0].status, 400);
  assert.equal(writes[1].error, 'bad request target');
});

test('heartbeat rejects an unknown status', async () => {
  const result = await heartbeat('bad-status', { status: 'pretending' });
  assert.equal(result.response.status, 400);
});

test('heartbeat requires its shared key and a non-empty agent identity', async () => {
  const unauthorized = await request('/api/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cf-key': 'wrong-key' },
    body: JSON.stringify({ agentId: 'intruder' }),
  });
  assert.equal(unauthorized.response.status, 401);
  const missing = await heartbeat('   ');
  assert.equal(missing.response.status, 400);
  assert.equal(missing.body.error, 'agentId required');
});

test('an offline heartbeat persists the transition and removes the live agent', async () => {
  await heartbeat('leaving-agent', { gitUser: '', sourceSchema: '', foundationVersion: '' });
  _internals.agents.get('leaving-agent').lastAccepted -= 60_000;
  const result = await heartbeat('leaving-agent', { status: 'offline' });
  assert.equal(result.response.status, 200);
  assert.equal(_internals.agents.has('leaving-agent'), false);
});

test('heartbeat exposes bounded runtime source metadata', async () => {
  await heartbeat('runtime-agent', {
    sourceSchema: 'foundation-runtime-v2', foundationVersion: '3.1.7',
  });
  const online = await request('/api/online', { headers: { 'x-cf-key': 'view-key' } });
  const agent = online.body.agents.find((item) => item.agentId === 'runtime-agent');
  assert.equal(agent.sourceSchema, 'foundation-runtime-v2');
  assert.equal(agent.foundationVersion, '3.1.7');
});

test('an unparseable request target does not kill the process', async () => {
  // `new URL('//', base)` throws synchronously inside the request listener.
  const response = await fetch(`${origin}//`, { redirect: 'manual' });
  assert.equal(response.status < 500, true);
  const health = await request('/api/health');
  assert.equal(health.body.ok, true);
});

test('a double slash does not misroute to a protocol-relative host', async () => {
  const response = await fetch(`${origin}//api/online?key=view-key`);
  assert.notEqual(response.status, 502);
  const body = await response.json();
  assert.equal(Object.hasOwn(body, 'agents'), true);
});

test('health exposes liveness only', async () => {
  const { body } = await request('/api/health');
  assert.deepEqual(Object.keys(body).sort(), ['ok']);
});

test('a null JSON body is a bad request, not a crash', async () => {
  for (const raw of ['null', '1', '"x"', '[]']) {
    const response = await fetch(`${origin}/api/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cf-key': 'test-key' },
      body: raw,
    });
    assert.equal(response.status, 400, `body ${raw}`);
  }
  const profile = await fetch(`${origin}/api/profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cf-key': 'test-key' },
    body: 'null',
  });
  assert.equal(profile.status, 400);
  const health = await request('/api/health');
  assert.equal(health.body.ok, true);
});

test('an invalid status is rejected even on a throttled beat', async () => {
  assert.equal((await heartbeat('throttle-status')).response.status, 200);
  // The second beat lands inside the throttle window. Validating status only
  // after the throttle check would let this one through with a 200.
  const { response } = await heartbeat('throttle-status', { status: 'pretending' });
  assert.equal(response.status, 400);
  _internals.agents.delete('throttle-status');
});

test('a client beating faster than the interval still persists again', async () => {
  await heartbeat('throttle-window', { gitUser: 'before' });
  for (let i = 0; i < 5; i += 1) {
    const { body } = await heartbeat('throttle-window', { gitUser: 'ignored' });
    assert.equal(body.throttled, true);
  }
  assert.equal(_internals.agents.get('throttle-window').gitUser, 'before');
  // Age the last *accepted* beat past the window while lastSeen stays fresh —
  // exactly the state those rejected beats leave behind. A window measured from
  // lastSeen would have been pushed out of reach by them, permanently.
  _internals.agents.get('throttle-window').lastAccepted -= 60_000;
  const { body } = await heartbeat('throttle-window', { gitUser: 'after' });
  assert.equal(body.throttled, undefined);
  assert.equal(_internals.agents.get('throttle-window').gitUser, 'after');
  _internals.agents.delete('throttle-window');
});

test('the profile roster is bounded', async () => {
  let rejected = 0;
  for (let i = 0; i < 600; i += 1) {
    const response = await fetch(`${origin}/api/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cf-key': 'test-key' },
      body: JSON.stringify({ user: `flood-profile-${i}` }),
    });
    await response.json();
    if (response.status === 429) { rejected += 1; break; }
  }
  assert.equal(rejected, 1);
  const online = await request('/api/online', { headers: { 'x-cf-key': 'view-key' } });
  assert.equal(online.body.profiles.length <= 500, true);
  for (let i = 0; i < 600; i += 1) _internals.profiles.delete(`flood-profile-${i}`);
});

test('the agent roster is bounded', async () => {
  let rejected = 0;
  for (let i = 0; i < 600; i += 1) {
    const { response } = await heartbeat(`flood-${i}`);
    if (response.status === 429) { rejected += 1; break; }
  }
  assert.equal(rejected, 1);
  for (let i = 0; i < 600; i += 1) _internals.agents.delete(`flood-${i}`);
});
