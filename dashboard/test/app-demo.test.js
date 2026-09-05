'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { Window } = require('happy-dom');

const PUBLIC = join(__dirname, '..', 'public');

function dashboardWindow(url = 'https://dashboard.example.test/?demo') {
  const window = new Window({ url });
  window.document.write(readFileSync(join(PUBLIC, 'index.html'), 'utf8'));
  global.window = window;
  global.document = window.document;
  global.localStorage = window.localStorage;
  global.location = window.location;
  global.history = window.history;
  global.FoundationModalManager = require('../public/modal-manager.js');
  global.FoundationUsageView = require('../public/usage-view.js');
  global.FoundationWorkloadView = require('../public/workload-view.js');
  global.FoundationPresenceView = require('../public/presence-view.js');
  global.FoundationAgentView = require('../public/agent-view.js');
  global.setInterval = () => 1;
  global.clearInterval = () => {};
  return window;
}

test('demo mode renders and filters every dashboard surface without a server', async () => {
  const window = dashboardWindow();
  global.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ profile: { user: 'alice', org: 'acme', teams: ['platform'], color: '#123456' } }),
  });
  delete require.cache[require.resolve('../public/app.js')];
  require('../public/app.js');

  assert.equal(window.document.getElementById('demo-banner').hidden, false);
  assert.equal(window.document.getElementById('status-text').textContent, '3 online');
  assert.notEqual(window.document.getElementById('online-grid').innerHTML, '');
  assert.notEqual(window.document.getElementById('feed').innerHTML, '');
  assert.notEqual(window.document.getElementById('us-bymodel').innerHTML, '');
  assert.notEqual(window.document.getElementById('ins-work').innerHTML, '');
  assert.notEqual(window.document.getElementById('pr-heatmap').innerHTML, '');
  assert.notEqual(window.document.getElementById('cf-hotspots').innerHTML, '');

  window.document.querySelector('#ins-filter [data-user="alice"]').click();
  assert.match(window.document.querySelector('#ins-filter [data-user="alice"]').className, /is-active/);
  window.document.querySelector('#ins-filter [data-group]').click();
  window.document.querySelector('#ins-filter [data-group]').click();
  window.document.querySelector('#ins-filter [data-user=""]').click();
  window.document.getElementById('ins-filter').click();
  window.document.querySelector('#ins-range [data-range="7"]').click();
  assert.match(window.document.querySelector('#ins-range [data-range="7"]').className, /is-active/);
  window.document.querySelector('#ins-range [data-range="0"]').click();
  const from = window.document.querySelector('#ins-range .rf-from');
  from.value = '2026-01-01';
  from.dispatchEvent(new window.Event('change', { bubbles: true }));

  const more = window.document.createElement('button');
  more.className = 'wk-more';
  more.dataset.agent = 'demo-a';
  window.document.getElementById('online-grid').appendChild(more);
  more.click();
  const replacement = window.document.createElement('button');
  replacement.className = 'wk-more';
  replacement.dataset.agent = 'demo-a';
  window.document.getElementById('online-grid').appendChild(replacement);
  replacement.click();
  window.document.getElementById('online-grid').click();

  window.document.getElementById('profile-btn').click();
  window.document.getElementById('pf-user').value = 'alice';
  window.document.getElementById('pf-org').value = 'acme';
  window.document.getElementById('pf-teams').value = 'platform, api';
  window.document.getElementById('pf-color-clear').click();
  window.document.getElementById('profile-form').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(window.localStorage.getItem('cf-dashboard-me'), 'alice');
  window.document.getElementById('profile-btn').click();
  assert.equal(window.document.getElementById('pf-color').value, '#123456');
  window.document.getElementById('pf-color').dispatchEvent(new window.Event('input', { bubbles: true }));
  window.document.getElementById('pf-user').value = '';
  window.document.getElementById('profile-form').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true }),
  );
  window.document.getElementById('pf-user').value = 'alice';
  global.fetch = async () => ({ ok: false, status: 500 });
  window.document.getElementById('profile-form').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(window.document.getElementById('pf-error').hidden, false);
  window.document.dispatchEvent(new window.Event('visibilitychange'));
});

test('keyless startup opens the gate and range controls render empty state', () => {
  const window = dashboardWindow('https://dashboard.example.test/');
  delete require.cache[require.resolve('../public/app.js')];
  require('../public/app.js');

  assert.equal(window.document.getElementById('gate').hidden, false);
  window.document.querySelector('#ins-range [data-range="7"]').click();
  assert.match(window.document.querySelector('#ins-range [data-range="7"]').className, /is-active/);
  const more = window.document.createElement('button');
  more.className = 'wk-more';
  more.dataset.agent = 'missing';
  window.document.getElementById('online-grid').appendChild(more);
  more.click();
  window.document.dispatchEvent(new window.Event('visibilitychange'));
});

test('authenticated startup polls live and durable dashboard datasets', async () => {
  const window = dashboardWindow('https://dashboard.example.test/');
  window.localStorage.setItem('cf-dashboard-key', 'view-key');
  const now = Date.now();
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    const body = String(url).includes('/online') ? {
      ok: true, now, ttlMs: 75000, onlineCount: 0, totalCount: 0,
      agents: [], conflicts: null, profiles: null, runs: [
        { id: 'current', gitUser: 'alice', started: now / 1000, finished: now / 1000,
          operationMs: { build: 120000 }, art: {} },
        { id: 'legacy', gitUser: 'alice', started: now / 1000, finished: now / 1000,
          art: { spec: now / 1000 - 60, plan: now / 1000 } },
      ],
    } : String(url).includes('/presence') ? { ok: true, buckets: [] }
      : String(url).includes('/history') ? {
        ok: true, usage: [], projects: [], hotspots: [], conflicts: [], work: [],
      } : { ok: true, usage: [], sessions: [], tools: [], work: [], repoStats: [] };
    return { ok: true, status: 200, json: async () => body };
  };
  delete require.cache[require.resolve('../public/app.js')];
  require('../public/app.js');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(window.document.getElementById('status-text').textContent, '0 online');
  assert.equal(window.document.getElementById('online-empty').hidden, false);
  assert.equal(calls.some((url) => url.includes('/online')), true);
  assert.equal(calls.some((url) => url.includes('/history')), true);
  const timing = window.document.getElementById('ins-funnel').textContent;
  assert.match(timing, /build · observed operations/);
  assert.match(timing, /legacy spec → plan/);
  assert.doesNotMatch(timing, /land · observed operations/);
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  await new Promise((resolve) => setImmediate(resolve));
});

test('polling contains unauthorized and unavailable endpoint responses', async () => {
  const window = dashboardWindow('https://dashboard.example.test/');
  window.localStorage.setItem('cf-dashboard-key', 'view-key');
  global.fetch = async (url) => ({
    ok: false,
    status: String(url).includes('/online') ? 401 : 503,
    json: async () => ({}),
  });
  delete require.cache[require.resolve('../public/app.js')];
  require('../public/app.js');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(window.localStorage.getItem('cf-dashboard-key'), null);
  assert.equal(window.document.getElementById('gate-error').hidden, false);
});

test('polling contains transport failures', async () => {
  const window = dashboardWindow('https://dashboard.example.test/');
  window.localStorage.setItem('cf-dashboard-key', 'view-key');
  global.fetch = async () => { throw new Error('network down'); };
  delete require.cache[require.resolve('../public/app.js')];
  require('../public/app.js');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(window.document.getElementById('status-text').textContent, 'offline — retrying');
});
