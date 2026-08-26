'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
  buildPresenceView,
  dailyPresenceColumns,
  heatmapHtml,
  localDayKey,
  peakHour,
  presenceBuckets,
  presenceTotals,
  renderPresence,
  selectedBuckets
} = require('../public/presence-view.js');

const day = 86400000;
const now = new Date(2026, 7, 10, 12).getTime();
const range = { fromMs: now - day, toMsEx: now + day };
const hourBucket = (time, minutes, user) => ({
  hour: Math.floor(time / 3600000), minutes, user
});

test('presence buckets normalize absent data and selection keeps half-open boundaries', () => {
  assert.deepEqual(presenceBuckets(), []);
  assert.deepEqual(presenceBuckets({ buckets: {} }), []);
  const buckets = [{ hour: 1 }, { hour: 2 }, { hour: 3 }];
  assert.equal(presenceBuckets({ buckets }), buckets);
  assert.deepEqual(selectedBuckets(buckets, {
    fromMs: 2 * 3600000, toMsEx: 3 * 3600000
  }), [{ hour: 2 }]);
});

test('presence totals aggregate heat, users, days, hours, unknown users, and today', () => {
  const buckets = [
    hourBucket(now, 30, 'alice'),
    hourBucket(now, 15),
    hourBucket(now - day + 2 * 3600000, 20, 'alice')
  ];
  const totals = presenceTotals(buckets, now);
  const today = localDayKey(new Date(now));
  assert.equal(totals.byUser.alice, 50);
  assert.equal(totals.byUser.unknown, 15);
  assert.equal(totals.byDay[today], 45);
  assert.equal(totals.todayMinutes, 45);
  assert.equal(totals.totalMinutes, 65);
  assert.equal(totals.byHour[new Date(now).getHours()], 45);
  assert.equal(totals.heat[new Date(now).getDay()][new Date(now).getHours()], 45);
});

test('peak labels distinguish empty totals and pad the winning hour', () => {
  assert.equal(peakHour(new Array(24).fill(0)), '—');
  const totals = new Array(24).fill(0);
  totals[7] = 12;
  assert.equal(peakHour(totals), '07:00');
});

test('heatmap renders Monday-first labels, hour ticks, and scaled cells', () => {
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
  heat[1][3] = 10;
  const html = heatmapHtml(heat);
  assert.match(html, /hm-rowlab">Mon/);
  assert.ok(html.indexOf('Mon') < html.indexOf('Sun'));
  assert.match(html, />3<\/span>/);
  assert.match(html, /opacity:1\.00/);
  assert.match(html, /opacity:0\.04/);
});

test('daily columns cap at 31 days and retain empty and populated labels', () => {
  const toMsEx = new Date(2026, 7, 11).getTime();
  const date = new Date(toMsEx - day / 2);
  const columns = dailyPresenceColumns({
    fromMs: toMsEx - 40 * day, toMsEx
  }, { [localDayKey(date)]: 12.4 }, (minutes) => `H${minutes}`);
  assert.equal(columns.length, 31);
  assert.deepEqual(columns.at(-1), {
    label: `${date.getMonth() + 1}/${date.getDate()}`,
    count: 12,
    text: 'H12.4'
  });
  assert.equal(columns[0].text, '');
  assert.equal(dailyPresenceColumns({ fromMs: toMsEx, toMsEx }, {}, String).length, 1);
});

test('presence view reports every person while limiting chart rows to eight', () => {
  const buckets = Array.from({ length: 10 }, (_, index) =>
    hourBucket(now, index + 1, `user-${index}`));
  const view = buildPresenceView({ buckets }, range, now, (minutes) => `H${minutes}`);
  assert.equal(view.empty, false);
  assert.equal(view.peopleCount, 10);
  assert.equal(view.people.length, 8);
  assert.equal(view.people[0][0], 'user-9');
  assert.equal(view.peopleMaximum, 10);
  assert.equal(view.hours, 'H55');
  assert.equal(view.today, 'H55');
});

function rendererFixture() {
  const elements = new Map();
  const $ = (id) => {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, textContent: '', innerHTML: ''
    });
    return elements.get(id);
  };
  return {
    $,
    dependencies: {
      $,
      barRow: (...values) => values.join('|'),
      fmtHours: (minutes) => `H${minutes}`,
      rangeInfo: () => range,
      renderBars: (element, rows) => { element.rows = rows; },
      renderCols: (element, columns) => { element.columns = columns; },
      userColor: (user) => `color-${user}`
    }
  };
}

test('renderer updates every presence surface and returns the view model', () => {
  const fixture = rendererFixture();
  const view = renderPresence(fixture.dependencies, {
    buckets: [hourBucket(now, 30, 'alice')]
  }, now);
  assert.equal(fixture.$('presence-empty').hidden, true);
  assert.equal(fixture.$('pr-people').textContent, 1);
  assert.equal(fixture.$('pr-hours').textContent, 'H30');
  assert.match(fixture.$('pr-peak').textContent, /:00/);
  assert.equal(fixture.$('pr-today').textContent, 'H30');
  assert.match(fixture.$('pr-heatmap').innerHTML, /hm-grid/);
  assert.match(fixture.$('pr-people-bars').rows[0], /alice\|30\|30\|color-alice\|H30/);
  assert.ok(fixture.$('pr-daily').columns.length > 0);
  assert.equal(view.people[0][0], 'alice');

  renderPresence(fixture.dependencies, null, now);
  assert.equal(fixture.$('presence-empty').hidden, false);
  assert.equal(fixture.$('pr-peak').textContent, '—');
});

test('classic browser script exposes the presence API', () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(join(__dirname, '..', 'public', 'presence-view.js'),
    'utf8'), context, { filename: 'presence-view.js' });
  assert.equal(vm.runInContext('typeof FoundationPresenceView.renderPresence', context),
    'function');
});
