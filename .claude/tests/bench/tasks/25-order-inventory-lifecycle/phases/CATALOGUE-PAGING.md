# Catalogue paging: independent feature

Add paging over the original legacy catalogue. This feature does not use
tenants, orders or any v2 behavior; build it against the code as it exists in
the repositories now. Backend, SDK and web state are the separate writable
repositories `backend`, `sdk`, `web`. Keep all existing exports and tests
working. No network dependencies or credentials are needed.

## Backend

`GET /v1/skus?prefix=&limit=&cursor=`, unauthenticated like the existing
`GET /v1/stock/:sku`. It reads only the original `products` table and never
modifies it. Response 200:
`{items: [{sku, stock}], nextCursor: string | null}`.

- Items are ordered by `sku` in byte order (SQLite binary collation, so
  uppercase sorts before lowercase), ascending.
- `prefix` is optional; only SKUs that begin with it are returned. `%`, `_`
  and `\` in the prefix are literal characters, never wildcards. An absent or
  empty prefix matches everything.
- `limit` is optional, an integer from 1 to 100 as decimal digits, default 20.
  Anything else is 400 `{error: "INVALID"}`.
- `cursor` is optional. `nextCursor` is `null` on the last page, otherwise an
  opaque string; sending it back as `cursor` with the same `prefix` returns the
  next page, so walking cursors visits every matching SKU exactly once; a page
  that ends exactly at the last match has `nextCursor: null`. An empty
  `cursor=` and a repeated parameter are 400 `INVALID`.
- Errors are JSON `{error: CODE}`; do not expose SQLite errors. Unknown routes
  stay 404 `NOT_FOUND`.

## SDK

Add `legacySkus({prefix, limit, cursor} = {})` to the client in
`sdk/client.mjs`: encode query values, omit absent ones, return the parsed JSON
page, and throw an Error with `.status` and `.code` for HTTP failures.
`legacyStock` keeps working.

## Web state

`initialState()` gains `catalogue: {items: [], nextCursor: null}`; keep every
existing key. Add the action
`{type: 'catalogue-loaded', items, nextCursor, append}`: without `append` it
replaces the catalogue, with `append: true` it appends items whose `sku` is not
already present (first occurrence wins). Actions preserve `filter` and every
other key, never mutate their inputs, and a malformed action leaves the state
unchanged.

## Required verification

Add meaningful backend, SDK and state tests: ordering, literal prefix
characters, limit bounds, a full cursor walk, invalid input, an untouched
`products` table and state immutability. Use fresh disposable databases.
