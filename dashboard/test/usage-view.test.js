'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
  aggregateModels,
  buildUsageView,
  dailySeries,
  modelListHtml,
  renderUsage,
  usageTokens
} = require('../public/usage-view.js');

const range = { fromStr: '2026-08-01', toStr: '2026-08-03' };
const usage = [
  {
    model: 'claude-sonnet-20260801', project: 'alpha', gitUser: 'alice',
    date: '2026-08-01', input: 100, output: 50, cacheCreate: 10,
    cacheRead: 5, count: 2
  },
  {
    model: 'claude-sonnet-20260801', date: '2026-08-02',
    input: 20, output: 10, count: 1
  },
  {
    model: 'claude-opus-20260801', project: 'beta', gitUser: 'bob',
    date: '2026-08-02', input: 30, output: 20, count: 3
  }
];

test('usage view aggregates totals, rankings, dates, and model detail', () => {
  const view = buildUsageView(usage,
    [{ date: '2026-08-01', count: 1 }, { date: '2026-08-01', count: 2 }],
    [{ tool: 'Read', count: 2 }, { tool: 'Read', count: 3 }, { tool: 'Edit' }],
    range, (row) => row.input || 0);
  assert.equal(view.empty, false);
  assert.equal(view.totalTokens, 230);
  assert.equal(view.outputTokens, 80);
  assert.equal(view.cost, 150);
  assert.equal(view.modelCount, 2);
  assert.deepEqual(view.projects, [['alpha', 150], ['beta', 50], ['unknown', 30]]);
  assert.deepEqual(view.tools, [['Read', 5], ['Edit', 0]]);
  assert.deepEqual(view.people, [['alice', 150], ['bob', 50], ['unknown', 30]]);
  assert.deepEqual(view.sessions.map((column) => column.count), [3, 0, 0]);
  assert.deepEqual(view.daily.map((column) => column.count), [150, 80, 0]);
  assert.equal(view.modelList[0][0], 'claude-sonnet-20260801');
  assert.deepEqual(view.modelList[0][1], {
    input: 120, output: 60, cacheCreate: 10, cacheRead: 5,
    count: 3, last: '2026-08-02'
  });
});

test('token totals retain either side when usage counters are sparse', () => {
  assert.equal(usageTokens({}), 0);
  assert.equal(usageTokens({ input: 4 }), 4);
  assert.equal(usageTokens({ output: 6 }), 6);
});

test('classic browser script exposes the view API to the following script', () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(join(__dirname, '..', 'public', 'usage-view.js'), 'utf8'),
    context, { filename: 'usage-view.js' });
  assert.equal(vm.runInContext('typeof FoundationUsageView.renderUsage', context), 'function');
});

test('daily series switches to weekly buckets and retains zero columns', () => {
  const columns = dailySeries(
    { fromStr: '2026-01-01', toStr: '2026-02-15' },
    { '2026-01-01': 2, '2026-01-07': 3, '2026-01-08': 5 });
  assert.equal(columns.length, 7);
  assert.equal(columns[0].count, 5);
  assert.equal(columns[1].count, 5);
  assert.equal(columns.at(-1).count, 0);
});

test('model aggregation applies numeric defaults and latest-date ordering', () => {
  assert.deepEqual(aggregateModels([
    { model: 'm', date: '2026-01-02', input: 1 },
    { model: 'm', date: '2026-01-01', output: 2 },
    { model: 'z', date: '2026-01-03' }
  ]), [
    ['m', { input: 1, output: 2, cacheCreate: 0, cacheRead: 0, count: 0, last: '2026-01-02' }],
    ['z', { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, count: 0, last: '2026-01-03' }]
  ]);
});

function rendererFixture() {
  const elements = new Map();
  const $ = (id) => {
    if (!elements.has(id)) elements.set(id, { hidden: false, textContent: '', innerHTML: '' });
    return elements.get(id);
  };
  const escapeHtml = (value) => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const dependencies = {
    $,
    barRow: (label, value, maximum, color, text) =>
      `${label}|${value}|${maximum}|${color}|${text}`,
    escapeHtml,
    estCost: (row) => (row.input || 0) / 100,
    fmtTok: (value) => `T${value}`,
    fmtUsd: (value) => `$${value.toFixed(2)}`,
    modelColor: (model) => model.includes('sonnet') ? 'blue' : 'purple',
    rangeInfo: () => range,
    renderBars: (element, rows) => { element.rows = rows; },
    renderCols: (element, columns) => { element.columns = columns; },
    shortModel: (model) => model.replace('claude-', ''),
    userColor: (person) => person === 'alice' ? 'green' : 'gray'
  };
  return { $, dependencies, elements };
}

test('renderer updates every usage surface and returns its view model', () => {
  const fixture = rendererFixture();
  const view = renderUsage(fixture.dependencies, usage,
    [{ date: '2026-08-01', count: 2 }], [{ tool: 'Read', count: 4 }],
    Date.parse('2026-08-03'), range);
  assert.equal(fixture.$('usage-empty').hidden, true);
  assert.equal(fixture.$('us-total').textContent, 'T230');
  assert.equal(fixture.$('us-week').textContent, 'T80');
  assert.equal(fixture.$('us-cost').textContent, '$1.50');
  assert.equal(fixture.$('us-models').textContent, 2);
  assert.equal(fixture.$('us-byproject').rows.length, 3);
  assert.match(fixture.$('us-bymodel').rows[0], /sonnet-20260801/);
  assert.equal(fixture.$('us-sessions').columns[0].text, '2');
  assert.equal(fixture.$('us-daily').columns[2].text, '');
  assert.match(fixture.$('us-modellist').innerHTML, /cache write/);
  assert.equal(view.totalTokens, 230);
});

test('renderer and model table preserve empty and escaped states', () => {
  const fixture = rendererFixture();
  const view = renderUsage(fixture.dependencies, null, null, null,
    Date.parse('2026-08-03'));
  assert.equal(view.empty, true);
  assert.equal(fixture.$('usage-empty').hidden, false);
  assert.match(fixture.$('us-modellist').innerHTML, /no data yet/);
  const html = modelListHtml([['<model>', {
    input: 0, output: 0, cacheCreate: 0, cacheRead: 0, count: 0,
    last: '<today>'
  }]], fixture.dependencies);
  assert.match(html, /&lt;model&gt;/);
  assert.match(html, /&lt;today&gt;/);
  assert.doesNotMatch(html, /<today>/);
});
