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

test('unchanged aggregate hashes suppress repeat dataset persistence', () => {
  const record = { runs: [], changes: [], usage: [{ date: 'x' }], sessions: [], tools: [], prs: [] };
  const hashes = _internals.datasetHashes(record);
  assert.deepEqual(_internals.changedDatasets({ datasetHashes: hashes }, hashes), {
    runs: false, changes: false, usage: false, sessions: false, tools: false, prs: false,
  });
});

test('heartbeat rejects an unknown status', async () => {
  const result = await heartbeat('bad-status', { status: 'pretending' });
  assert.equal(result.response.status, 400);
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
