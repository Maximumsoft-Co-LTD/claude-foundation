// Oracle calibration answer for the lifecycle lane: order/inventory with
// amendment 1 (TTL <= 3600000, partial release) plus catalogue paging.
// Repository-only; never copied into a lab seed.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { query, initializeLegacy } from './database.mjs';

class Failure extends Error {
  constructor(status, code) { super(code); this.status = status; }
}
const fail = (status, code) => { throw new Failure(status, code); };
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const integer = (value, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const statement = (sql, params = [], extra = {}) => ({ sql, params, ...extra });

export function createServer({ dbFile, now = Date.now, tokens = {} }) {
  initializeLegacy(dbFile);
  query(dbFile, [
    statement('CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY)'),
    statement('CREATE TABLE IF NOT EXISTS inventory (tenant TEXT, sku TEXT, stock INTEGER CHECK(stock>=0), PRIMARY KEY(tenant,sku))'),
    statement('INSERT OR IGNORE INTO inventory SELECT ?,sku,stock FROM products WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE version=2)', ['legacy']),
    statement('INSERT OR IGNORE INTO migrations VALUES (2)'),
    statement('CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, tenantId TEXT, sku TEXT, quantity INTEGER, status TEXT, expiresAt INTEGER, lastSequence INTEGER, requestKey TEXT, ttlMs INTEGER, origQuantity INTEGER, UNIQUE(tenantId,requestKey))'),
    statement('CREATE TABLE IF NOT EXISTS releases (tenant TEXT, key TEXT, orderId TEXT, quantity INTEGER, PRIMARY KEY(tenant,key))'),
    statement('CREATE TABLE IF NOT EXISTS events (tenant TEXT, eventId TEXT, payload TEXT, PRIMARY KEY(tenant,eventId))')
  ]);
  const sql = (...steps) => query(dbFile, steps);
  const get = (id, tenant) => {
    const order = sql(statement('SELECT * FROM orders WHERE id=? AND tenantId=?', [id, tenant]))[0][0];
    if (!order) fail(404, 'NOT_FOUND');
    return order;
  };
  const publicOrder = ({ requestKey, ttlMs, origQuantity, ...order }) => order;
  const expire = (tenant) => {
    const time = now();
    return sql(
      statement("UPDATE inventory SET stock=stock+COALESCE((SELECT SUM(quantity) FROM orders WHERE tenantId=? AND sku=inventory.sku AND status='reserved' AND expiresAt<=?),0) WHERE tenant=?", [tenant, time, tenant]),
      statement("UPDATE orders SET status='expired' WHERE tenantId=? AND status='reserved' AND expiresAt<=? RETURNING id", [tenant, time])
    )[1].length;
  };
  const transition = (order, type, sequence, event) => {
    const live = ['reserved', 'confirmed'].includes(order.status);
    const steps = [statement('UPDATE orders SET status=?,lastSequence=? WHERE id=? AND tenantId=? AND status=? AND lastSequence=?',
      [type, sequence, order.id, order.tenantId, order.status, order.lastSequence], { changes: 1, error: 'RETRY' })];
    if (type === 'cancelled' && live) steps.push(statement('UPDATE inventory SET stock=stock+? WHERE tenant=? AND sku=?', [order.quantity, order.tenantId, order.sku]));
    if (event) steps.push(statement('INSERT INTO events VALUES (?,?,?)', [order.tenantId, event.eventId, JSON.stringify(event)]));
    sql(...steps);
    return publicOrder(get(order.id, order.tenantId));
  };
  const bodies = new WeakMap();
  const parseBody = async (req) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    let value; try { value = JSON.parse(raw); } catch { fail(400, 'INVALID'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'INVALID');
    return value;
  };
  const body = (req) => {
    if (!bodies.has(req)) bodies.set(req, parseBody(req));
    return bodies.get(req);
  };
  async function route(req) {
    const path = new URL(req.url, 'http://localhost').pathname;
    const parts = path.split('/').slice(1).map(decodeURIComponent);
    if (req.method === 'GET' && parts[0] === 'v1' && parts[1] === 'stock' && parts.length === 3) {
      const row = sql(statement('SELECT * FROM products WHERE sku=?', [parts[2]]))[0][0];
      return row ? [200, row] : fail(404, 'NOT_FOUND');
    }
    if (req.method === 'GET' && parts[0] === 'v1' && parts[1] === 'skus' && parts.length === 2) {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const one = (name) => {
        const all = params.getAll(name);
        if (all.length > 1) fail(400, 'INVALID');
        return all.length ? all[0] : null;
      };
      const prefix = one('prefix') ?? '', limitText = one('limit'), cursor = one('cursor');
      if (limitText !== null && !/^[0-9]+$/.test(limitText)) fail(400, 'INVALID');
      const limit = limitText === null ? 20 : Number(limitText);
      if (!integer(limit, 1, 100) || cursor === '') fail(400, 'INVALID');
      const rows = sql(statement('SELECT sku, stock FROM products WHERE substr(sku, 1, ?) = ? AND (? IS NULL OR sku > ?) ORDER BY sku LIMIT ?',
        [prefix.length, prefix, cursor, cursor, limit + 1]))[0];
      return [200, { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].sku : null }];
    }
    if (parts[0] !== 'v2') fail(404, 'NOT_FOUND');
    const identity = tokens[String(req.headers.authorization || '').replace(/^Bearer /, '')];
    if (!identity) fail(401, 'UNAUTHORIZED');
    if (req.method !== 'GET' && identity.role !== 'operator') fail(403, 'FORBIDDEN');
    const tenant = identity.tenantId;
    // Explicit expiry reports its own settled count; all other v2 operations
    // settle first, including idempotent retries and stock reads.
    if (parts.length === 2 && parts[1] === 'expire' && req.method === 'POST')
      return [200, { expired: expire(tenant) }];
    expire(tenant);
    if (parts[1] === 'stock' && parts.length === 3) {
      const sku = parts[2]; if (!text(sku)) fail(400, 'INVALID');
      if (req.method === 'PUT') {
        const value = await body(req); if (!integer(value.stock, 0)) fail(400, 'INVALID');
        sql(statement("INSERT INTO inventory VALUES (?,?,?) ON CONFLICT(tenant,sku) DO UPDATE SET stock=excluded.stock WHERE NOT EXISTS (SELECT 1 FROM orders WHERE tenantId=? AND sku=? AND status='reserved')",
          [tenant, sku, value.stock, tenant, sku], { changes: 1, error: 'ACTIVE_RESERVATIONS' }));
      } else if (req.method !== 'GET') fail(404, 'NOT_FOUND');
      const row = sql(statement('SELECT sku,stock FROM inventory WHERE tenant=? AND sku=?', [tenant, sku]))[0][0];
      return row ? [200, row] : fail(404, 'NOT_FOUND');
    }
    if (parts[1] === 'orders' && parts.length === 2 && req.method === 'POST') {
      const value = await body(req); const key = req.headers['idempotency-key'];
      if (!text(key) || !text(value.sku) || !integer(value.quantity, 1) || !integer(value.ttlMs, 1, 3600000)) fail(400, 'INVALID');
      const previous = sql(statement('SELECT * FROM orders WHERE tenantId=? AND requestKey=?', [tenant, key]))[0][0];
      if (previous) {
        if (previous.sku !== value.sku || previous.origQuantity !== value.quantity || previous.ttlMs !== value.ttlMs) fail(409, 'IDEMPOTENCY_CONFLICT');
        return [200, publicOrder(previous)];
      }
      if (!sql(statement('SELECT 1 FROM inventory WHERE tenant=? AND sku=?', [tenant, value.sku]))[0].length) fail(404, 'NOT_FOUND');
      const id = randomUUID();
      try {
        sql(statement('UPDATE inventory SET stock=stock-? WHERE tenant=? AND sku=? AND stock>=?', [value.quantity, tenant, value.sku, value.quantity], { changes: 1, error: 'OUT_OF_STOCK' }),
          statement('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?)', [id, tenant, value.sku, value.quantity, 'reserved', now() + value.ttlMs, 0, key, value.ttlMs, value.quantity]));
      } catch (error) {
        if (error.message === 'OUT_OF_STOCK' && sql(statement('SELECT 1 FROM orders WHERE tenantId=? AND requestKey=?', [tenant, key]))[0].length)
          throw new Error('RETRY');
        throw error;
      }
      return [201, publicOrder(get(id, tenant))];
    }
    if (parts[1] === 'orders' && parts.length >= 3) {
      const order = get(parts[2], tenant);
      if (req.method === 'GET' && parts.length === 3) return [200, publicOrder(order)];
      if (req.method === 'POST' && parts.length === 4 && parts[3] === 'cancel') {
        if (['cancelled', 'expired'].includes(order.status)) return [200, publicOrder(order)];
        return [200, transition(order, 'cancelled', order.lastSequence)];
      }
      if (req.method === 'POST' && parts.length === 4 && parts[3] === 'release') {
        const value = await body(req); const key = req.headers['idempotency-key'];
        if (!text(key) || !integer(value.quantity, 1)) fail(400, 'INVALID');
        const previous = sql(statement('SELECT * FROM releases WHERE tenant=? AND key=?', [tenant, key]))[0][0];
        if (previous) {
          if (previous.orderId !== order.id || previous.quantity !== value.quantity) fail(409, 'IDEMPOTENCY_CONFLICT');
          return [200, publicOrder(order)];
        }
        if (order.status !== 'reserved') fail(409, 'NOT_RESERVED');
        if (value.quantity >= order.quantity) fail(409, 'INVALID_RELEASE');
        sql(statement("UPDATE orders SET quantity=quantity-? WHERE id=? AND tenantId=? AND status='reserved' AND quantity>?",
            [value.quantity, order.id, tenant, value.quantity], { changes: 1, error: 'INVALID_RELEASE' }),
          statement('UPDATE inventory SET stock=stock+? WHERE tenant=? AND sku=?', [value.quantity, tenant, order.sku]),
          statement('INSERT INTO releases VALUES (?,?,?,?)', [tenant, key, order.id, value.quantity]));
        return [200, publicOrder(get(order.id, tenant))];
      }
    }
    if (parts[1] === 'events' && parts.length === 2 && req.method === 'POST') {
      const value = await body(req);
      if (!text(value.eventId) || !text(value.orderId) || !integer(value.sequence, 1) || !['confirmed', 'cancelled'].includes(value.type)) fail(400, 'INVALID');
      const event = { eventId: value.eventId, orderId: value.orderId, sequence: value.sequence, type: value.type };
      const order = get(event.orderId, tenant);
      const previous = sql(statement('SELECT payload FROM events WHERE tenant=? AND eventId=?', [tenant, event.eventId]))[0][0];
      if (previous) {
        if (previous.payload !== JSON.stringify(event)) fail(409, 'EVENT_CONFLICT');
        return [200, publicOrder(order)];
      }
      if (event.sequence <= order.lastSequence) fail(409, 'STALE_EVENT');
      if (order.status === 'expired' || (order.status === 'cancelled' && event.type === 'confirmed')) fail(409, 'TERMINAL_ORDER');
      return [200, transition(order, event.type, event.sequence, event)];
    }
    fail(404, 'NOT_FOUND');
  }
  return http.createServer(async (req, res) => {
    let response;
    // Optimistic read conflicts must retry the whole operation, including its
    // idempotency check; failed SQLite transactions leave no partial writes.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try { response = await route(req); break; }
      catch (error) {
        if (error.message === 'RETRY' || error.message.startsWith('UNIQUE constraint failed')) continue;
        const known = ['OUT_OF_STOCK', 'ACTIVE_RESERVATIONS', 'INVALID_RELEASE'].includes(error.message);
        response = [error.status || (known ? 409 : 500), { error: error.status || known ? error.message : 'INTERNAL' }];
        break;
      }
    }
    response ||= [500, { error: 'INTERNAL' }];
    res.writeHead(response[0], { 'content-type': 'application/json' }); res.end(JSON.stringify(response[1]));
  });
}
