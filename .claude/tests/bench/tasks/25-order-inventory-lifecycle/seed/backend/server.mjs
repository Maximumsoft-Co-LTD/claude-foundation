import http from 'node:http';
import { query, initializeLegacy } from './database.mjs';

export function createServer({ dbFile, now = Date.now, tokens = {} }) {
  initializeLegacy(dbFile);
  return http.createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    let status = 404;
    let body = { error: 'NOT_FOUND' };
    if (req.method === 'GET' && path.startsWith('/v1/stock/')) {
      const [rows] = query(dbFile, [{ sql: 'SELECT sku, stock FROM products WHERE sku=?',
        params: [decodeURIComponent(path.slice('/v1/stock/'.length))] }]);
      if (rows.length) { status = 200; body = rows[0]; }
    }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
}
