import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, reduce } from './state.mjs';

test('filter updates without mutating state', () => {
  const before = initialState();
  assert.equal(reduce(before, { type: 'filter', value: 'shoe' }).filter, 'shoe');
  assert.equal(before.filter, '');
});
