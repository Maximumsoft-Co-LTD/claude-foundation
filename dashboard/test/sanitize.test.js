'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { clean, cleanChanges, cleanRuns, cleanUsage } = require('../sanitize');

test('clean bounds strings and removes control characters', () => {
  assert.equal(clean('  a\u0000b\n ', 10), 'ab');
  assert.equal(clean('abcdef', 3), 'abc');
});

test('run and usage sanitizers reject invalid rows and negative counters', () => {
  assert.deepEqual(cleanRuns([{ id: '' }, { id: 'run-1', started: -2, art: { spec: 5, nope: 8 } }]), [
    {
      id: 'run-1', type: '', repo: '', repoId: '', branch: '', owner: '',
      ownerEmail: '', size: '', phase: '', started: 0, finished: 0,
      done: false, art: { spec: 5 },
    },
  ]);
  assert.deepEqual(cleanUsage([{ date: 'bad', model: 'x' }]), []);
});

test('change sanitizer retains history-only repository rows', () => {
  const rows = cleanChanges([{ repoId: 'org/repo', commits: [{ date: '2026-08-16', n: 2 }] }]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].commits, [{ date: '2026-08-16', n: 2 }]);
});
