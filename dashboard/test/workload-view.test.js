'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
  buildWorkloadView, deduplicateWork, deltaCell, renderWorkload,
  runPoints, workloadHtml, workloadRow
} = require('../public/workload-view.js');

const day = 86400000;
const fromMs = Date.parse('2026-08-10T00:00:00Z');
const dependencies = {
  day,
  rangeInfo: () => ({
    fromMs, toMsEx: fromMs + 2 * day,
    fromStr: '2026-08-10', toStr: '2026-08-11'
  }),
  localDateStr: (time) => new Date(time).toISOString().slice(0, 10),
  escapeHtml: (value) => String(value).replaceAll('<', '&lt;'),
  fmtTok: (value) => `T${value}`,
  userDot: (user) => `[${user}]`
};

test('run points apply size weights and the S fallback', () => {
  assert.equal(runPoints({ size: 'xs' }), 1);
  assert.equal(runPoints({ size: 'M' }), 5);
  assert.equal(runPoints({ size: 'L' }), 8);
  assert.equal(runPoints({ size: 'unknown' }), 2);
  assert.equal(runPoints({}), 2);
});

test('delta cells distinguish empty, new, up, down, and flat values', () => {
  assert.match(deltaCell(0, 0), /—/);
  assert.match(deltaCell(3, 0), /new/);
  assert.match(deltaCell(6, 4), /▲ 50%/);
  assert.match(deltaCell(2, 4), /▼ 50%/);
  assert.match(deltaCell(4, 4), /=/);
});

test('workload rows initialize once and preserve accumulated values', () => {
  const aggregate = new Map();
  const first = workloadRow(aggregate, 'alice');
  first.points = 3;
  assert.equal(workloadRow(aggregate, 'alice').points, 3);
  assert.equal(workloadRow(aggregate, 'bob').prevLines, 0);
});

test('work rows max-merge live and historical data by person and date', () => {
  const selected = new Set(['alice', 'unknown']);
  const rows = [...deduplicateWork([
    { gitUser: 'alice', date: '2026-08-10', commits: 1, added: 4, deleted: 1 },
    { gitUser: 'bob', date: '2026-08-10', commits: 9 },
    { date: '', commits: 7 }
  ], { work: [
    { gitUser: 'alice', date: '2026-08-10', commits: 3, added: 2, deleted: 5 },
    { date: '2026-08-09', commits: 2 }
  ] }, selected)];
  assert.deepEqual(rows, [
    { user: 'alice', date: '2026-08-10', commits: 3, added: 4, deleted: 5 },
    { user: 'unknown', date: '2026-08-09', commits: 2, added: 0, deleted: 0 }
  ]);
  assert.deepEqual([...deduplicateWork([], null, new Set())], []);
  assert.deepEqual([...deduplicateWork([], { work: {} }, new Set())], []);
});

test('workload view aggregates current and previous windows and filters people', () => {
  const runs = [
    { done: true, finished: (fromMs + day) / 1000, gitUser: 'alice', size: 'M' },
    { done: true, finished: (fromMs - day) / 1000, gitUser: 'alice', size: 'S' },
    { done: true, finished: (fromMs + day) / 1000, gitUser: 'bob', size: 'L' },
    { done: false, finished: (fromMs + day) / 1000, gitUser: 'alice' },
    { done: true, finished: 0, gitUser: 'alice' },
    { done: true, finished: (fromMs - 4 * day) / 1000, gitUser: 'alice' }
  ];
  const work = [
    { gitUser: 'alice', date: '2026-08-10', commits: 3, added: 10, deleted: 2 },
    { gitUser: 'alice', date: '2026-08-09', commits: 1, added: 4, deleted: 1 },
    { gitUser: 'alice', date: '2026-08-01', commits: 20, added: 20 },
    { gitUser: 'bob', date: '2026-08-10', commits: 9, added: 90 }
  ];
  const view = buildWorkloadView(
    dependencies, fromMs, new Set(['alice']), runs, work, null);
  assert.equal(view.days, 2);
  assert.deepEqual(view.list, [['alice', {
    points: 5, prevPoints: 2, runs: 1, prevRuns: 1,
    commits: 3, prevCommits: 1, lines: 12, prevLines: 5
  }]]);
});

test('workload sorting uses points then commits and omits line-only rows', () => {
  const view = buildWorkloadView(dependencies, fromMs, new Set(), [
    { done: true, finished: fromMs / 1000, gitUser: 'alice', size: 'S' },
    { done: true, finished: fromMs / 1000, gitUser: 'bob', size: 'S' },
    { done: true, finished: fromMs / 1000, size: 'XS' }
  ], [
    { gitUser: 'alice', date: '2026-08-10', commits: 1 },
    { gitUser: 'bob', date: '2026-08-10', commits: 2 },
    { gitUser: 'lines-only', date: '2026-08-09', added: 5 }
  ], null);
  assert.deepEqual(view.list.map(([user]) => user), ['bob', 'alice', 'unknown']);
});

test('workload HTML renders escaped rows and the empty state', () => {
  const row = {
    points: 2, prevPoints: 1, runs: 1, prevRuns: 1,
    commits: 3, prevCommits: 0, lines: 4, prevLines: 8
  };
  const html = workloadHtml([['<alice>', row]], dependencies);
  assert.match(html, /&lt;alice>/);
  assert.match(html, /T3/);
  assert.match(html, /▼ 50%/);
  assert.match(workloadHtml([], dependencies), /no completed runs/);
});

test('renderer updates workload and subtitle and handles absent elements', () => {
  const elements = new Map([
    ['ins-workload', { innerHTML: '' }], ['wl-sub', { textContent: '' }]
  ]);
  const deps = { ...dependencies, $: (id) => elements.get(id) };
  const view = renderWorkload(deps, fromMs, new Set(), [
    { done: true, finished: fromMs / 1000, gitUser: 'alice', size: 'S' }
  ], [], null);
  assert.equal(view.list.length, 1);
  assert.match(elements.get('wl-sub').textContent, /previous 2d/);
  assert.match(elements.get('ins-workload').innerHTML, /alice/);
  elements.delete('wl-sub');
  assert.equal(renderWorkload(deps, fromMs, new Set(), [], [], null).list.length, 0);
  elements.delete('ins-workload');
  assert.equal(renderWorkload(deps, fromMs, new Set(), [], [], null), undefined);
});

test('renderer reads classic-script workload state when only now is supplied', () => {
  const elements = new Map([
    ['ins-workload', { innerHTML: '' }], ['wl-sub', { textContent: '' }]
  ]);
  const deps = { ...dependencies, $: (id) => elements.get(id) };
  Object.assign(globalThis, {
    selectedUsers: new Set(),
    lastRuns: [{
      done: true, finished: fromMs / 1000, gitUser: 'global-user', size: 'XS'
    }],
    lastWork: [],
    lastHistory: null
  });
  try {
    assert.equal(renderWorkload(deps, fromMs).list[0][0], 'global-user');
  } finally {
    for (const key of ['selectedUsers', 'lastRuns', 'lastWork', 'lastHistory'])
      delete globalThis[key];
  }
});

test('classic browser script exposes the workload API', () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(join(__dirname, '..', 'public', 'workload-view.js'), 'utf8'),
    context, { filename: 'workload-view.js' });
  assert.equal(vm.runInContext('typeof FoundationWorkloadView.renderWorkload', context),
    'function');
});
