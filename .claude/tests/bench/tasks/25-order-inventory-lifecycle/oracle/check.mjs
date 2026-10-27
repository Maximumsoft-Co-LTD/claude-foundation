// Hidden acceptance: never copied into the consumer or used as project tests.
// ORDER_ORACLE_SCOPE selects the cases a lifecycle phase owes: `a` is the
// amended order/inventory change, `b` the independent catalogue-paging change,
// `full` (default) the landed result of both.
import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'order-oracle-'));
const work = join(scratch, 'work');
const results = {};
const diagnostics = {};
const children = new Set();
// Only the repository calibration test calls this file with a case filter.
// The lab's run.sh accepts solely the workspace and always runs every case.
const onlyCase = process.argv[3];
const scope = process.env.ORDER_ORACLE_SCOPE || 'full';
if (!['a', 'b', 'full'].includes(scope)) throw new Error('unknown oracle scope');
const inScope = (id) => scope === 'full' || id.startsWith('CASE_TESTS_') || id === 'CASE_DELIVERED_TESTS'
  || (id.startsWith('CASE_B_') ? scope === 'b' : scope === 'a');
cpSync(resolve(process.argv[2]), work, { recursive: true,
  filter: (path) => !['.git', '.claude', '.foundation', 'openspec', 'node_modules', '__pycache__'].includes(path.split('/').at(-1)) });
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
let nextDb = 0;

async function worker(dbFile) {
  const child = fork(join(here, 'serve.mjs'), [join(work, 'backend/server.mjs'), dbFile],
    { env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  children.add(child);
  const port = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('server startup timed out')), 10000);
    child.once('error', fail);
    child.once('exit', () => { clearTimeout(timer); fail(new Error('server exited')); });
    child.once('message', (message) => { clearTimeout(timer); done(message.port); });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const call = async (method, path, body, token = 'a', key, raw = false, extraHeaders = {}) => {
    const response = await fetch(baseUrl + path, { method,
      signal: AbortSignal.timeout(10000), headers: {
        connection: 'close', 'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(key ? { 'idempotency-key': key } : {}), ...extraHeaders
      }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { call, baseUrl,
    clock: (time) => new Promise((done) => {
      child.once('message', done); child.send(time);
    }),
    close: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise((done) => { child.once('exit', done); child.kill('SIGKILL'); });
      children.delete(child);
    }
  };
}

async function fixture(fn, rows = [{ sku: 'old-SKU', stock: 7 }]) {
  const dbFile = join(scratch, `${++nextDb}.sqlite`);
  const { initializeLegacy } = await import(pathToFileURL(join(work, 'backend/database.mjs')));
  initializeLegacy(dbFile, rows);
  const servers = [];
  const open = async () => { const server = await worker(dbFile); servers.push(server); return server; };
  try { await fn(await open(), open); }
  finally { await Promise.all(servers.map((server) => server.close())); }
}

async function check(id, fn) {
  if ((onlyCase && id !== onlyCase) || !inScope(id)) return;
  try { await fn(); results[id] = 'pass'; }
  catch (error) { results[id] = 'fail'; diagnostics[id] = error.message; }
}
const ok = (response, status) => { assert.equal(response.status, status); return response.body; };
const error = (response, status, code) => {
  assert.equal(response.status, status); assert.equal(response.body.error, code);
};
const input = { sku: 'shoe', quantity: 1, ttlMs: 1000 };
const stock = (api, quantity = 10, tenant = 'a') => api.call('PUT', '/v2/stock/shoe', { stock: quantity }, tenant);
const reserve = (api, key = 'one', value = input, tenant = 'a') => api.call('POST', '/v2/orders', value, tenant, key);

try {
  await check('CASE_LEGACY_MIGRATION', () => fixture(async (api, open) => {
    assert.deepEqual(ok(await api.call('GET', '/v1/stock/old-SKU', undefined, null), 200), { sku: 'old-SKU', stock: 7 });
    assert.deepEqual(ok(await api.call('GET', '/v2/stock/old-SKU', undefined, 'legacy'), 200), { sku: 'old-SKU', stock: 7 });
    ok(await reserve(api, 'old', { ...input, sku: 'old-SKU', quantity: 2 }, 'legacy'), 201);
    const second = await open();
    assert.equal(ok(await second.call('GET', '/v2/stock/old-SKU', undefined, 'legacy'), 200).stock, 5);
    assert.equal(ok(await second.call('GET', '/v1/stock/old-SKU', undefined, null), 200).stock, 7);
  }));
  await check('CASE_AUTH_ROLES', () => fixture(async (api) => {
    error(await api.call('GET', '/v2/stock/shoe', undefined, null), 401, 'UNAUTHORIZED');
    error(await api.call('POST', '/v2/orders', '{bad', 'unknown', 'x', true), 401, 'UNAUTHORIZED');
    error(await stock(api, 10, 'view'), 403, 'FORBIDDEN');
    ok(await stock(api), 200);
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe', undefined, 'view'), 200).stock, 10);
    for (const [path, body] of [['/v2/orders', input], ['/v2/expire', {}], ['/v2/events', {}]])
      error(await api.call('POST', path, body, 'view', 'viewer'), 403, 'FORBIDDEN');
    const order = ok(await reserve(api), 201);
    error(await api.call('POST', `/v2/orders/${order.id}/cancel`, {}, 'view'), 403, 'FORBIDDEN');
  }));
  await check('CASE_TENANT_ISOLATION', () => fixture(async (api) => {
    ok(await stock(api, 10), 200); ok(await stock(api, 2, 'b'), 200);
    const a = ok(await reserve(api, 'shared'), 201);
    const b = ok(await reserve(api, 'shared', input, 'b'), 201);
    assert.notEqual(a.id, b.id); assert.equal(a.tenantId, 'a'); assert.equal(b.tenantId, 'b');
    error(await api.call('GET', `/v2/orders/${a.id}`, undefined, 'b'), 404, 'NOT_FOUND');
    error(await api.call('GET', `/v2/orders/${a.id}`, undefined, 'b', undefined, false,
      { 'x-tenant-id': 'a' }), 404, 'NOT_FOUND');
    error(await api.call('POST', `/v2/orders/${a.id}/cancel`, {}, 'b'), 404, 'NOT_FOUND');
    error(await api.call('POST', '/v2/events', { eventId: 'cross', orderId: a.id, sequence: 1, type: 'cancelled' }, 'b'), 404, 'NOT_FOUND');
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe', undefined, 'b'), 200).stock, 1);
    const attempt = ok(await reserve(api, 'spoof', { ...input, tenantId: 'b', role: 'operator' }), 201);
    assert.equal(attempt.tenantId, 'a');
  }));
  await check('CASE_VALIDATION_ATOMIC', () => fixture(async (api) => {
    ok(await stock(api), 200);
    for (const quantity of [0, -1, 1.5, true, '1', Number.MAX_SAFE_INTEGER + 1])
      error(await reserve(api, 'invalid', { ...input, quantity }), 400, 'INVALID');
    for (const ttlMs of [0, -1, 3600001, 86400000, 86400001, true, '1000'])
      error(await reserve(api, 'invalid', { ...input, ttlMs }), 400, 'INVALID');
    error(await api.call('POST', '/v2/orders', input), 400, 'INVALID');
    error(await api.call('POST', '/v2/orders', '{bad', 'a', 'invalid', true), 400, 'INVALID');
    error(await api.call('POST', '/v2/orders', [], 'a', 'invalid'), 400, 'INVALID');
    for (const value of [-1, true, '10', 1.5]) error(await stock(api, value), 400, 'INVALID');
    error(await reserve(api, 'invalid', { ...input, sku: 'absent' }), 404, 'NOT_FOUND');
    error(await reserve(api, 'invalid', { ...input, quantity: 11 }), 409, 'OUT_OF_STOCK');
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe'), 200).stock, 10);
    ok(await reserve(api, 'invalid'), 201);
    assert.equal(ok(await reserve(api, 'ttl-max', { ...input, ttlMs: 3600000 }), 201).expiresAt, 4600000);
  }));
  await check('CASE_RESERVATION_CONTRACT', () => fixture(async (api) => {
    ok(await stock(api), 200);
    const order = ok(await reserve(api), 201);
    assert.equal(typeof order.id, 'string'); assert.ok(order.id.length);
    assert.deepEqual({ ...order, id: '_' }, { id: '_', tenantId: 'a', sku: 'shoe', quantity: 1,
      status: 'reserved', expiresAt: 1001000, lastSequence: 0 });
    assert.deepEqual(ok(await api.call('GET', `/v2/orders/${order.id}`), 200), order);
    error(await stock(api, 99), 409, 'ACTIVE_RESERVATIONS');
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe'), 200).stock, 9);
  }));
  await check('CASE_IDEMPOTENCY_RESTART', () => fixture(async (api, open) => {
    ok(await stock(api), 200);
    const first = ok(await reserve(api), 201);
    assert.deepEqual(ok(await reserve(api), 200), first);
    error(await reserve(api, 'one', { ...input, quantity: 2 }), 409, 'IDEMPOTENCY_CONFLICT');
    error(await reserve(api, 'one', { ...input, ttlMs: 2 }), 409, 'IDEMPOTENCY_CONFLICT');
    await api.close(); const restarted = await open();
    assert.deepEqual(ok(await reserve(restarted), 200), first);
    ok(await restarted.call('POST', `/v2/orders/${first.id}/cancel`, {}), 200);
    assert.equal(ok(await reserve(restarted), 200).status, 'cancelled');
    assert.equal(ok(await restarted.call('GET', '/v2/stock/shoe'), 200).stock, 10);
  }));
  await check('CASE_CONCURRENT_STOCK', () => fixture(async (api, open) => {
    ok(await stock(api), 200); const second = await open();
    const burst = await Promise.all(Array.from({ length: 50 }, (_, i) => reserve(i % 2 ? api : second, `race-${i}`)));
    assert.equal(burst.filter((r) => r.status === 201).length, 10);
    assert.equal(new Set(burst.filter((r) => r.status === 201).map((r) => r.body.id)).size, 10);
    for (const rejected of burst.filter((r) => r.status !== 201)) error(rejected, 409, 'OUT_OF_STOCK');
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe'), 200).stock, 0);
    await api.close(); await second.close();
    assert.equal(ok(await (await open()).call('GET', '/v2/stock/shoe'), 200).stock, 0);
  }));
  await check('CASE_CONCURRENT_KEY', () => fixture(async (api, open) => {
    ok(await stock(api, 1), 200); const second = await open();
    const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => reserve(i % 2 ? api : second, 'same-key')));
    assert.equal(burst.filter((r) => r.status === 201).length, 1);
    assert.equal(burst.filter((r) => r.status === 200).length, 19);
    assert.equal(new Set(burst.map((r) => r.body.id)).size, 1);
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe'), 200).stock, 0);
  }));
  await check('CASE_EXPIRY_BOUNDARY', () => fixture(async (api) => {
    ok(await stock(api), 200); const order = ok(await reserve(api), 201);
    await api.clock(1000999);
    assert.equal(ok(await api.call('GET', `/v2/orders/${order.id}`), 200).status, 'reserved');
    await api.clock(1001000);
    assert.equal(ok(await api.call('GET', `/v2/orders/${order.id}`), 200).status, 'expired');
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe'), 200).stock, 10);
    assert.equal(ok(await api.call('POST', `/v2/orders/${order.id}/cancel`, {}), 200).status, 'expired');
    assert.equal(ok(await api.call('POST', '/v2/expire', {}), 200).expired, 0);
    error(await api.call('POST', '/v2/events', { eventId: 'late', orderId: order.id, sequence: 1, type: 'confirmed' }), 409, 'TERMINAL_ORDER');
  }));
  await check('CASE_EXPIRY_TENANT', () => fixture(async (api) => {
    ok(await stock(api), 200); ok(await stock(api, 5, 'b'), 200);
    ok(await reserve(api), 201); ok(await reserve(api, 'b', input, 'b'), 201);
    await api.clock(1001000);
    assert.equal(ok(await api.call('POST', '/v2/expire', {}), 200).expired, 1);
    assert.equal(ok(await api.call('POST', '/v2/expire', {}, 'b'), 200).expired, 1);
    assert.equal(ok(await api.call('POST', '/v2/expire', {}, 'b'), 200).expired, 0);
  }));
  await check('CASE_CANCEL_ONCE', () => fixture(async (api, open) => {
    ok(await stock(api), 200); const order = ok(await reserve(api), 201);
    const second = await open();
    const responses = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      (i % 2 ? api : second).call('POST', `/v2/orders/${order.id}/cancel`, {})));
    for (const response of responses) assert.equal(ok(response, 200).status, 'cancelled');
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe'), 200).stock, 10);
  }));
  await check('CASE_EVENT_DUPLICATE_RESTART', () => fixture(async (api, open) => {
    ok(await stock(api), 200); const order = ok(await reserve(api), 201);
    const event = { eventId: 'evt', orderId: order.id, sequence: 1, type: 'confirmed' };
    const first = ok(await api.call('POST', '/v2/events', event), 200);
    assert.equal(first.status, 'confirmed'); assert.equal(first.lastSequence, 1);
    await api.close(); const second = await open();
    assert.deepEqual(ok(await second.call('POST', '/v2/events', event), 200), first);
    error(await second.call('POST', '/v2/events', { ...event, type: 'cancelled' }), 409, 'EVENT_CONFLICT');
    await second.clock(1002000);
    assert.equal(ok(await second.call('GET', `/v2/orders/${order.id}`), 200).status, 'confirmed');
    assert.equal(ok(await second.call('POST', '/v2/expire', {}), 200).expired, 0);
  }));
  await check('CASE_EVENT_ORDERING_TERMINAL', () => fixture(async (api) => {
    ok(await stock(api), 200); const order = ok(await reserve(api), 201);
    const event = { eventId: 'cancel', orderId: order.id, sequence: 3, type: 'cancelled' };
    assert.equal(ok(await api.call('POST', '/v2/events', event), 200).status, 'cancelled');
    error(await api.call('POST', '/v2/events', { ...event, eventId: 'old', sequence: 2, type: 'confirmed' }), 409, 'STALE_EVENT');
    error(await api.call('POST', '/v2/events', { ...event, eventId: 'new', sequence: 4, type: 'confirmed' }), 409, 'TERMINAL_ORDER');
    for (const sequence of [0, 1.5, true, '4'])
      error(await api.call('POST', '/v2/events', { ...event, eventId: 'invalid', sequence }), 400, 'INVALID');
    assert.equal(ok(await api.call('POST', '/v2/events', { ...event, eventId: 'new', sequence: 4 }), 200).lastSequence, 4);
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe'), 200).stock, 10);
  }));
  await check('CASE_SDK_ROUNDTRIP', () => fixture(async (api) => {
    const { createClient } = await import(pathToFileURL(join(work, 'sdk/client.mjs')));
    const client = createClient({ baseUrl: api.baseUrl, token: 'a' });
    assert.equal((await client.legacyStock('old-SKU')).stock, 7);
    await client.setStock('sku / encoded', 3);
    const order = await client.reserve({ ...input, sku: 'sku / encoded' }, 'sdk-key');
    assert.equal((await client.stock('sku / encoded')).stock, 2);
    assert.deepEqual(await client.order(order.id), order);
    assert.deepEqual(await client.reserve({ ...input, sku: 'sku / encoded' }, 'sdk-key'), order);
    assert.equal((await client.event({ eventId: 'sdk', orderId: order.id, sequence: 1, type: 'confirmed' })).status, 'confirmed');
    assert.equal((await client.cancel(order.id)).status, 'cancelled');
    assert.equal((await client.expire()).expired, 0);
    await assert.rejects(() => client.order('missing'), (e) => e.status === 404 && e.code === 'NOT_FOUND');
    const viewer = createClient({ baseUrl: api.baseUrl, token: 'view' });
    await assert.rejects(() => viewer.setStock('shoe', 1), (e) => e.status === 403 && e.code === 'FORBIDDEN');
  }));
  await check('CASE_WEB_STATE', async () => {
    const { initialState, reduce } = await import(pathToFileURL(join(work, 'web/state.mjs')));
    const initial = initialState();
    // Landed state may also carry the catalogue key; the order keys are exact.
    const pick = (state) => ({ filter: state.filter, orders: state.orders, pending: state.pending });
    assert.deepEqual(pick(initial), { filter: '', orders: {}, pending: {} });
    const filtered = reduce(initial, { type: 'filter', value: 'kept' });
    const pending = reduce(filtered, { type: 'reserve-start', key: 'one' });
    const order = { id: 'o1', status: 'reserved', lastSequence: 0 };
    const done = reduce(pending, { type: 'reserve-done', key: 'one', order });
    assert.deepEqual(pick(done), { filter: 'kept', orders: { o1: order }, pending: {} });
    assert.deepEqual(pending.pending, { one: true }); assert.deepEqual(initial.orders, {});
    assert.deepEqual(reduce(done, { type: 'reserve-done', key: 'one', order }), done);
    const cancelled = reduce(done, { type: 'order-updated', order: { ...order, status: 'cancelled', lastSequence: 3 } });
    assert.deepEqual(reduce(cancelled, { type: 'order-updated', order: { ...order, status: 'confirmed', lastSequence: 2 } }), cancelled);
    assert.deepEqual(reduce(cancelled, { type: 'order-updated', order: { ...order, status: 'confirmed', lastSequence: 4 } }), cancelled);
    const other = reduce(cancelled, { type: 'order-updated', order: { ...order, id: 'o2' } });
    assert.equal(Object.keys(other.orders).length, 2); assert.equal(other.filter, 'kept');
    const released = { ...order, quantity: 1 };
    assert.deepEqual(reduce(done, { type: 'order-updated', order: released }).orders.o1, released);
  });

  // Amendment 1: revised TTL (above) and partial release.
  const release = (api, id, quantity, key = 'rel', tenant = 'a') =>
    api.call('POST', `/v2/orders/${id}/release`, { quantity }, tenant, key);
  const big = { ...input, quantity: 4, ttlMs: 5000 };
  await check('CASE_RELEASE_PARTIAL', () => fixture(async (api) => {
    ok(await stock(api), 200);
    const order = ok(await reserve(api, 'big', big), 201);
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe'), 200).stock, 6);
    const reduced = ok(await release(api, order.id, 1), 200);
    assert.deepEqual(reduced, { ...order, quantity: 3 });
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe'), 200).stock, 7);
    assert.deepEqual(ok(await api.call('GET', `/v2/orders/${order.id}`), 200), reduced);
    assert.equal(ok(await release(api, order.id, 2, 'rel-2'), 200).quantity, 1);
    error(await release(api, order.id, 1, 'rel-3'), 409, 'INVALID_RELEASE');
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe'), 200).stock, 9);
    // The reduced order still cancels, expires and takes events normally.
    assert.equal(ok(await api.call('POST', `/v2/orders/${order.id}/cancel`, {}), 200).status, 'cancelled');
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe'), 200).stock, 10);
  }));
  await check('CASE_RELEASE_IDEMPOTENT', () => fixture(async (api, open) => {
    ok(await stock(api), 200);
    const order = ok(await reserve(api, 'big', big), 201);
    const first = ok(await release(api, order.id, 1), 200);
    assert.deepEqual(ok(await release(api, order.id, 1), 200), first);
    error(await release(api, order.id, 2), 409, 'IDEMPOTENCY_CONFLICT');
    const other = ok(await reserve(api, 'other', { ...big, quantity: 2 }), 201);
    error(await release(api, other.id, 1), 409, 'IDEMPOTENCY_CONFLICT');
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe'), 200).stock, 5);
    // Reservation keys and release keys are separate namespaces.
    assert.equal(ok(await release(api, other.id, 1, 'big'), 200).quantity, 1);
    // A retry of the original reservation still matches the original request.
    assert.deepEqual(ok(await reserve(api, 'big', big), 200), first);
    error(await reserve(api, 'big', { ...big, quantity: 3 }), 409, 'IDEMPOTENCY_CONFLICT');
    await api.close(); const restarted = await open();
    assert.deepEqual(ok(await release(restarted, order.id, 1), 200), first);
    assert.equal(ok(await restarted.call('GET', '/v2/stock/shoe'), 200).stock, 6);
    ok(await restarted.call('POST', `/v2/orders/${order.id}/cancel`, {}), 200);
    assert.equal(ok(await release(restarted, order.id, 1), 200).status, 'cancelled');
    assert.equal(ok(await restarted.call('GET', '/v2/stock/shoe'), 200).stock, 9);
  }));
  await check('CASE_RELEASE_REJECTS', () => fixture(async (api) => {
    ok(await stock(api), 200); ok(await stock(api, 5, 'b'), 200);
    const order = ok(await reserve(api, 'big', big), 201);
    const foreign = ok(await reserve(api, 'foreign', big, 'b'), 201);
    error(await api.call('POST', `/v2/orders/${order.id}/release`, { quantity: 1 }, null, 'k'), 401, 'UNAUTHORIZED');
    error(await release(api, order.id, 1, 'k', 'view'), 403, 'FORBIDDEN');
    error(await release(api, order.id, 1, 'k', 'b'), 404, 'NOT_FOUND');
    error(await release(api, 'missing', 1), 404, 'NOT_FOUND');
    for (const quantity of [0, -1, 1.5, true, '1', undefined, Number.MAX_SAFE_INTEGER + 1])
      error(await release(api, order.id, quantity), 400, 'INVALID');
    error(await api.call('POST', `/v2/orders/${order.id}/release`, { quantity: 1 }), 400, 'INVALID');
    error(await api.call('POST', `/v2/orders/${order.id}/release`, '{bad', 'a', 'k', true), 400, 'INVALID');
    error(await release(api, order.id, 4), 409, 'INVALID_RELEASE');
    error(await release(api, order.id, 9), 409, 'INVALID_RELEASE');
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe'), 200).stock, 6);
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe', undefined, 'b'), 200).stock, 1);
    // Rejected requests did not consume the key.
    assert.equal(ok(await release(api, order.id, 1), 200).quantity, 3);
    ok(await api.call('POST', '/v2/events', { eventId: 'c', orderId: order.id, sequence: 1, type: 'confirmed' }), 200);
    error(await release(api, order.id, 1, 'after-confirm'), 409, 'NOT_RESERVED');
    // Expiry settles before the check and restores the released remainder once.
    const soon = ok(await reserve(api, 'soon', { ...input, quantity: 3, ttlMs: 1000 }), 201);
    await api.clock(1001000);
    error(await release(api, soon.id, 1, 'late'), 409, 'NOT_RESERVED');
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe'), 200).stock, 7);
    assert.equal(foreign.tenantId, 'b');
  }));
  await check('CASE_RELEASE_CONCURRENT', () => fixture(async (api, open) => {
    ok(await stock(api), 200); const second = await open();
    const order = ok(await reserve(api, 'big', { ...input, quantity: 10, ttlMs: 5000 }), 201);
    const burst = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      release(i % 2 ? api : second, order.id, 1, `r-${i}`)));
    const done = burst.filter((r) => r.status === 200).length;
    assert.equal(done, 9, 'quantity 10 can be released nine times and keeps one unit');
    for (const rejected of burst.filter((r) => r.status !== 200)) error(rejected, 409, 'INVALID_RELEASE');
    assert.equal(ok(await api.call('GET', `/v2/orders/${order.id}`), 200).quantity, 1);
    assert.equal(ok(await api.call('GET', '/v2/stock/shoe'), 200).stock, 9);
  }));
  await check('CASE_SDK_RELEASE', () => fixture(async (api) => {
    const { createClient } = await import(pathToFileURL(join(work, 'sdk/client.mjs')));
    const client = createClient({ baseUrl: api.baseUrl, token: 'a' });
    await client.setStock('sku / encoded', 5);
    const order = await client.reserve({ sku: 'sku / encoded', quantity: 3, ttlMs: 5000 }, 'sdk-big');
    const reduced = await client.release(order.id, 2, 'sdk-rel');
    assert.equal(reduced.quantity, 1);
    assert.deepEqual(await client.release(order.id, 2, 'sdk-rel'), reduced);
    assert.equal((await client.stock('sku / encoded')).stock, 4);
    await assert.rejects(() => client.release(order.id, 1, 'sdk-rel'),
      (e) => e.status === 409 && e.code === 'IDEMPOTENCY_CONFLICT');
    await assert.rejects(() => client.release(order.id, 1, 'sdk-last'),
      (e) => e.status === 409 && e.code === 'INVALID_RELEASE');
  }));

  // Change B: independent catalogue paging over the original products table.
  const catalogue = ['Z-1', 'a-1', 'a-2', 'b-1', 'b-10', 'b-2', 'c-1', 'p_1', 'pa1', '100%', '1000']
    .map((sku, index) => ({ sku, stock: index }));
  const sorted = [...catalogue].sort((x, y) => (x.sku < y.sku ? -1 : x.sku > y.sku ? 1 : 0));
  const skus = (api, query = '') => api.call('GET', `/v1/skus${query}`, undefined, null);
  const walk = async (api, query) => {
    const items = []; let cursor = null; let pages = 0;
    do {
      const page = ok(await skus(api, `?${query}${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`), 200);
      items.push(...page.items); cursor = page.nextCursor; pages += 1;
      assert.ok(pages < 50, 'cursor walk did not terminate');
    } while (cursor !== null);
    return { items, pages };
  };
  await check('CASE_B_PAGING_BACKEND', () => fixture(async (api, open) => {
    assert.deepEqual(ok(await skus(api, '?limit=100'), 200), { items: sorted, nextCursor: null });
    const first = ok(await skus(api, '?limit=3'), 200);
    assert.deepEqual(first.items, sorted.slice(0, 3)); assert.equal(typeof first.nextCursor, 'string');
    const walked = await walk(api, 'limit=3');
    assert.deepEqual(walked.items, sorted); assert.equal(walked.pages, 4);
    assert.deepEqual((await walk(api, 'limit=1')).items, sorted);
    assert.deepEqual(ok(await skus(api, '?prefix=b-&limit=2'), 200).items, sorted.filter((r) => r.sku.startsWith('b-')).slice(0, 2));
    assert.deepEqual((await walk(api, 'prefix=b-&limit=2')).items, sorted.filter((r) => r.sku.startsWith('b-')));
    assert.deepEqual(ok(await skus(api, `?prefix=${encodeURIComponent('p_')}`), 200).items, [{ sku: 'p_1', stock: 7 }]);
    assert.deepEqual(ok(await skus(api, `?prefix=${encodeURIComponent('100%')}`), 200).items, [{ sku: '100%', stock: 9 }]);
    assert.deepEqual(ok(await skus(api, '?prefix=nope'), 200), { items: [], nextCursor: null });
    assert.equal(ok(await skus(api, '?prefix='), 200).items.length, 11);
    assert.equal(ok(await skus(api), 200).items.length, 11);
    assert.deepEqual(ok(await skus(api, '?limit=11'), 200), { items: sorted, nextCursor: null });
    assert.equal(ok(await skus(api, '?limit=10'), 200).items.length, 10);
    for (const bad of ['?limit=0', '?limit=101', '?limit=-1', '?limit=1.5', '?limit=abc', '?limit=', '?limit=1&limit=2',
      '?prefix=a&prefix=b', '?cursor=', '?cursor=a&cursor=b'])
      error(await skus(api, bad), 400, 'INVALID');
    const stable = ok(await skus(api, '?limit=2'), 200);
    assert.deepEqual(ok(await skus(api, '?limit=2'), 200), stable);
    error(await api.call('GET', '/v1/stock/old-SKU', undefined, null), 404, 'NOT_FOUND');
    assert.deepEqual(ok(await api.call('GET', '/v1/stock/a-1', undefined, null), 200), { sku: 'a-1', stock: 1 });
    error(await api.call('POST', '/v1/skus', {}, null), 404, 'NOT_FOUND');
    const restarted = await open();
    assert.deepEqual((await walk(restarted, 'limit=4')).items, sorted);
  }, catalogue));
  await check('CASE_B_PAGING_SDK', () => fixture(async (api) => {
    const { createClient } = await import(pathToFileURL(join(work, 'sdk/client.mjs')));
    const client = createClient({ baseUrl: api.baseUrl });
    assert.equal(typeof client.legacyStock, 'function');
    assert.deepEqual(await client.legacyStock('a-1'), { sku: 'a-1', stock: 1 });
    assert.equal((await client.legacySkus()).items.length, 11);
    const page = await client.legacySkus({ limit: 2 });
    assert.deepEqual(page.items, sorted.slice(0, 2));
    assert.deepEqual((await client.legacySkus({ limit: 2, cursor: page.nextCursor })).items, sorted.slice(2, 4));
    assert.deepEqual((await client.legacySkus({ prefix: 'p_' })).items, [{ sku: 'p_1', stock: 7 }]);
    assert.deepEqual((await client.legacySkus({ prefix: 'b-', limit: 50, cursor: undefined })).items.length, 3);
    await assert.rejects(() => client.legacySkus({ limit: 0 }), (e) => e instanceof Error && e.status === 400 && e.code === 'INVALID');
    await assert.rejects(() => client.legacySkus({ limit: 101 }), (e) => e.status === 400 && e.code === 'INVALID');
  }, catalogue));
  await check('CASE_B_STATE', async () => {
    const { initialState, reduce } = await import(pathToFileURL(join(work, 'web/state.mjs')));
    const initial = initialState();
    assert.deepEqual(initial.catalogue, { items: [], nextCursor: null });
    assert.equal(initial.filter, '');
    const filtered = reduce(initial, { type: 'filter', value: 'kept' });
    const one = [{ sku: 'a', stock: 1 }, { sku: 'b', stock: 2 }];
    const loaded = reduce(filtered, { type: 'catalogue-loaded', items: one, nextCursor: 'c1' });
    assert.deepEqual(loaded.catalogue, { items: one, nextCursor: 'c1' }); assert.equal(loaded.filter, 'kept');
    assert.deepEqual(initial.catalogue, { items: [], nextCursor: null });
    const appended = reduce(loaded, { type: 'catalogue-loaded', items: [{ sku: 'b', stock: 99 }, { sku: 'c', stock: 3 }],
      nextCursor: null, append: true });
    assert.deepEqual(appended.catalogue, { items: [...one, { sku: 'c', stock: 3 }], nextCursor: null });
    assert.deepEqual(loaded.catalogue.items, one);
    const replaced = reduce(appended, { type: 'catalogue-loaded', items: [{ sku: 'z', stock: 0 }], nextCursor: 'z' });
    assert.deepEqual(replaced.catalogue, { items: [{ sku: 'z', stock: 0 }], nextCursor: 'z' });
    assert.deepEqual(reduce(replaced, { type: 'catalogue-loaded', items: 'bad' }), replaced);
    assert.deepEqual(reduce(replaced, { type: 'nope' }), replaced);
    assert.equal(reduce(replaced, { type: 'filter', value: 'x' }).catalogue, replaced.catalogue);
  });

  // Demand discriminating delivered tests for each changed surface, without
  // rewarding an arbitrary test-count floor or inspecting assertion prose.
  const suite = () => spawnSync(process.execPath, ['--test', '--test-reporter=tap'], {
    cwd: work, env, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024
  });
  const delivered = !onlyCase || onlyCase.startsWith('CASE_TESTS_') || onlyCase === 'CASE_DELIVERED_TESTS'
    ? suite() : null;
  await check('CASE_DELIVERED_TESTS', () => {
    assert.equal(delivered.status, 0);
    assert.ok(Number((delivered.stdout.match(/^# pass (\d+)/m) || [])[1]) > 0);
  });
  for (const [domain, file] of [['BACKEND', 'backend/server.mjs'], ['SDK', 'sdk/client.mjs'], ['WEB', 'web/state.mjs']]) {
    await check(`CASE_TESTS_${domain}`, () => {
      assert.equal(delivered.status, 0);
      const backup = join(scratch, `${domain}.mjs`);
      cpSync(join(work, file), backup);
      try {
        cpSync(join(here, '../seed', file), join(work, file));
        const mutant = suite();
        assert.notEqual(mutant.status, null, 'a timeout is not test discrimination');
        assert.notEqual(mutant.status, 0, 'delivered tests did not detect the original implementation');
      } finally { cpSync(backup, join(work, file)); }
    });
  }
} finally {
  for (const child of children) child.kill('SIGKILL');
  rmSync(scratch, { recursive: true, force: true });
}
const ids = Object.keys(results);
if (!ids.length) throw new Error('unknown oracle calibration case');
const score = ids.filter((id) => results[id] === 'pass').length;
process.stdout.write(`${JSON.stringify({ verdict: score === ids.length ? 'pass' : 'fail', score,
  max: ids.length, results, diagnostics })}\n`);
