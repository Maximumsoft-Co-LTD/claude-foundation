import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from './client.mjs';

test('legacy SDK surface is preserved', () => {
  assert.equal(typeof createClient({ baseUrl: 'http://localhost' }).legacyStock, 'function');
});
