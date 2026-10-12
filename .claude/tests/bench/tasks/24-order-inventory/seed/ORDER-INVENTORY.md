# Order and inventory: brownfield delivery contract

Extend the existing catalogue into a multi-tenant order/reservation system.
Backend, SDK and web state are separate writable repository directories:
`backend`, `sdk`, `web`. Keep existing exports and catalogue tests working.
Use Node >=20.19 and Python 3's standard-library SQLite bridge; no network
dependencies, credentials, Docker, external payments or deployment are needed.
Run `npm test` at the control root; each directory's `node --test` must work too.

## Backend interface and persistence

Keep `createServer({ dbFile, now, tokens })` in `backend/server.mjs`, returning
a Node HTTP server. `now()` returns integer milliseconds; its default is
`Date.now`. `tokens` maps trusted opaque bearer tokens to `{tenantId, role}`;
roles are `operator` or `viewer`. Never trust a tenant or role from the body or
an `x-tenant-id` header. No registration or production auth is in scope.

`initializeLegacy(dbFile, rows)` and `query(dbFile, statements)` are retained
from `backend/database.mjs`. Existing SQLite databases have
`products(sku TEXT PRIMARY KEY, stock INTEGER NOT NULL)`; preserve these rows
as tenant `legacy` when upgrading. Migration must be repeatable, preserve
SKU spelling and quantities, and not modify the original products table.
Existing `GET /v1/stock/:sku` returns `{sku, stock}` from that original table,
without auth, as before. New operations use independent migrated inventory.
All mutations, stock changes and event/idempotency records must be durable
and atomic in SQLite, including when two server instances share one file.

## HTTP v2

Bodies and responses are JSON objects. Errors are `{error: CODE}`. Missing or
unknown bearer token: 401 `UNAUTHORIZED`; viewer writes: 403 `FORBIDDEN`.
Cross-tenant resources return 404 `NOT_FOUND`. Unknown routes: 404 `NOT_FOUND`.
Malformed JSON and invalid fields: 400 `INVALID`. Rejected requests cannot
change stock, orders or event records. Reads are allowed to both roles.

- `PUT /v2/stock/:sku`, operator, `{stock}`: 200 `{sku, stock}`. Non-empty
  SKU, stock must be a non-negative safe integer (no booleans/coercion).
  This sets available stock. Reject 409 `ACTIVE_RESERVATIONS` if that tenant
  and SKU has an unexpired reserved order. Reads return 404 if SKU is absent.
- `GET /v2/stock/:sku`: 200 `{sku, stock}` for the authenticated tenant.
- `POST /v2/orders`, operator, `{sku, quantity, ttlMs}`, with non-empty
  `Idempotency-Key`: 201 order on first success, 200 the same order on retry.
  Quantity is a positive safe integer; TTL is an integer from 1 to 86400000.
  Atomically subtract quantity from available stock. Missing SKU: 404;
  insufficient stock: 409 `OUT_OF_STOCK`. Same tenant/key with different
  sku, quantity or TTL: 409 `IDEMPOTENCY_CONFLICT`. Key scope is tenant-wide.
  Exact retries return the current stored order without reserving twice,
  including after restart or a terminal transition. Failed requests do not
  consume the key. Orders include `{id, tenantId, sku, quantity, status,
  expiresAt, lastSequence}`; IDs are non-empty strings, initial status
  `reserved`, expiresAt = now() + TTL, lastSequence = 0.
- `GET /v2/orders/:id`: 200 order, scoped to authenticated tenant.
- `POST /v2/orders/:id/cancel`, operator: 200 order. Reserved or confirmed
  orders become `cancelled`, restoring quantity exactly once. Repeated cancel
  returns the same order; expired orders stay expired without another restore.
- `POST /v2/expire`, operator: 200 `{expired}`. Lazily expire this tenant's
  reserved orders where expiresAt <= now(), restore stock exactly once.
  All v2 reads and writes also settle this tenant's due reservations before
  their operation. Confirmed orders do not expire.
- `POST /v2/events`, operator, `{eventId, orderId, sequence, type}`: 200 order.
  Non-empty eventId/orderId; positive safe-integer sequence; type `confirmed`
  or `cancelled`. Event IDs are scoped to tenant. Exact duplicate payloads
  return the current order. Reuse with a different payload: 409
  `EVENT_CONFLICT`. A new event with sequence <= lastSequence: 409
  `STALE_EVENT`. Confirm accepts reserved/confirmed, sets confirmed and
  lastSequence. Cancel accepts reserved/confirmed/cancelled, restores only
  when still live, and sets cancelled/lastSequence. Confirm after cancelled
  or expired: 409 `TERMINAL_ORDER`; cancel after expiry also returns 409
  `TERMINAL_ORDER`. Rejected events are not recorded or sequenced.

No public list endpoint is required. Authentication precedes body validation.
Successful operation results have no secret tokens. Do not expose SQLite errors.

## SDK and web state

Keep `createClient({baseUrl, token})` in `sdk/client.mjs`, preserving async
`legacyStock(sku)`. Add `stock(sku)`, `setStock(sku, stock)`,
`reserve(input, key)`, `order(id)`, `cancel(id)`, `event(input)`, `expire()`.
Encode path components, send bearer and idempotency headers, return parsed
JSON, and throw an Error with `.status` and `.code` for HTTP failures.

Keep `initialState()` and `reduce(state, action)` in `web/state.mjs`, preserving
`filter` actions. State also has `orders: {}` and `pending: {}`.
`reserve-start` with `key` adds pending[key]=true; `reserve-done` with `key`
and `order` removes that pending entry and stores the order by id.
`order-updated` stores an order only when its lastSequence is >= the current
one and cannot replace cancelled/expired with reserved/confirmed. Actions
must preserve filter and other orders, never mutate inputs, and repeated
completion must not duplicate orders. No visual layout is requested.

## Required verification

Add meaningful backend, SDK and state tests. Test real SQLite persistence,
tenant isolation, invalid inputs, repeat/reordered events, boundary expiry,
and concurrent reservations. With stock 10, fifty simultaneous quantity-1
reservations across two servers sharing a database must succeed exactly ten
times and never produce negative stock. Concurrent identical keys must create
one order. Original catalogue behavior must still pass after the upgrade.
Use fresh disposable databases and injected clocks; never sleep for expiry.
Hidden acceptance runs separately before Land. Delivery ends at archived;
installation and ordinary tests must pass from a clean copy.
