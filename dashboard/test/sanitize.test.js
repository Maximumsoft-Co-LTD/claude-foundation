'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  clean, cleanChanges, cleanRuns, cleanUsage, hasChangeActivity
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
