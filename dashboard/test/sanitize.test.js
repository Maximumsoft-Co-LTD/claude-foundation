'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  clean, cleanChanges, cleanRanges, cleanRuns, cleanUsage, hasChangeActivity
} = require('../sanitize');

test('clean bounds strings and removes control characters', () => {
  assert.equal(clean('  a\u0000b\n ', 10), 'ab');
  assert.equal(clean('abcdef', 3), 'abc');
});

test('run and usage sanitizers reject invalid rows and negative counters', () => {
  assert.deepEqual(cleanRuns([{ id: '' }, { id: 'run-1', started: -2, art: { spec: 5, nope: 8 } }]), [
    {
      id: 'run-1', type: '', repo: '', repoId: '', branch: '', owner: '',
      ownerEmail: '', size: '', phase: '', started: 0, finished: 0,
      done: false, art: { spec: 5 }, operationMs: {},
    },
  ]);
  assert.deepEqual(cleanUsage([{ date: 'bad', model: 'x' }]), []);
});

test('change sanitizer retains history-only repository rows', () => {
  const rows = cleanChanges([{ repoId: 'org/repo', commits: [{ date: '2026-08-16', n: 2 }] }]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].commits, [{ date: '2026-08-16', n: 2 }]);
});

test('run timing retains every measured phase, including zero, and rejects unknown fields', () => {
  const [run] = cleanRuns([{ id: 'measured', operationMs: {
    change: 0, build: 120000, prove: 3000, land: 500, unknown: 100
  } }]);
  assert.deepEqual(run.operationMs, { change: 0, build: 120000, prove: 3000, land: 500 });
});

test('run timing never coerces missing, invalid, or unsafe measurements into evidence', () => {
  for (const value of [null, undefined, -1, 0.5, NaN, Infinity, '100', true,
    Number.MAX_SAFE_INTEGER + 1]) {
    const [run] = cleanRuns([{ id: 'invalid', operationMs: {
      change: value, build: value, prove: value, land: value
    } }]);
    assert.deepEqual(run.operationMs, {}, String(value));
  }
  assert.deepEqual(cleanRuns([{ id: 'missing', operationMs: null }])[0].operationMs, {});
});

test('range sanitizer rejects malformed rows and normalizes numeric boundaries', () => {
  assert.deepEqual(cleanRanges(null), []);
  assert.deepEqual(cleanRanges([null, [1], ['3.9', '8.2'], [-2, -1], [9, 4],
    ['bad', 'also-bad']]), [
    [3, 8], [0, 0], [9, 9], [0, 0]
  ]);
});

test('change activity recognizes every retained source and requires repository identity', () => {
  const empty = { repoId: 'repo', files: [], work: [], commits: [], pushes: [], fuOpen: 0, fuClosed: 0 };
  assert.equal(hasChangeActivity(empty), false);
  assert.equal(hasChangeActivity({ ...empty, repoId: '', files: [{}] }), false);
  for (const activity of [
    { files: [{}] }, { work: [{}] }, { commits: [{}] }, { pushes: [{}] },
    { fuOpen: 1 }, { fuClosed: 1 }
  ]) assert.equal(hasChangeActivity({ ...empty, ...activity }), true);

  const rows = cleanChanges([
    { repoId: 'files', files: [{ path: 'src/a.js', ranges: [[1, 2]] }] },
    { repoId: 'work', work: [{ date: '2026-08-27', commits: 1 }] },
    { repoId: 'pushes', pushes: [{ date: '2026-08-27', n: 1 }] },
    { repoId: 'open', fuOpen: 1 },
    { repoId: 'closed', fuClosed: 1 },
    { repoId: 'empty' },
    { repoId: '', fuOpen: 1 }
  ]);
  assert.deepEqual(rows.map((row) => row.repoId),
    ['files', 'work', 'pushes', 'open', 'closed']);
});
