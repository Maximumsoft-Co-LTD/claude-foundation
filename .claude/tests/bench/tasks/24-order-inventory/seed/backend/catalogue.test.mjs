import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './server.mjs';
import { initializeLegacy } from './database.mjs';

test('existing catalogue exposes original stock', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'catalogue-'));
  const dbFile = join(dir, 'stock.sqlite');
  initializeLegacy(dbFile, [{ sku: 'old-SKU', stock: 7 }]);
  const server = createServer({ dbFile });
  try {
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/stock/old-SKU`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { sku: 'old-SKU', stock: 7 });
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    rmSync(dir, { recursive: true, force: true });
  }
});
