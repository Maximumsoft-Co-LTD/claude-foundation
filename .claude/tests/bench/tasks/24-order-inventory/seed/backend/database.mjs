import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function query(dbFile, statements) {
  const run = spawnSync('python3', [fileURLToPath(new URL('./sqlite.py', import.meta.url)), dbFile], {
    input: JSON.stringify(statements), encoding: 'utf8', timeout: 30000
  });
  if (run.status !== 0) throw new Error('SQLite transport unavailable');
  const result = JSON.parse(run.stdout);
  if (result.error) throw new Error(result.error);
  return result.rows;
}

export function initializeLegacy(dbFile, rows = []) {
  query(dbFile, [
    { sql: 'CREATE TABLE IF NOT EXISTS products (sku TEXT PRIMARY KEY, stock INTEGER NOT NULL)' },
    ...rows.map(({ sku, stock }) => ({
      sql: 'INSERT INTO products VALUES (?, ?)', params: [sku, stock]
    }))
  ]);
}
