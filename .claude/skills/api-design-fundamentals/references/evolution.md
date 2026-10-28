# Safe retries, large collections, and evolution

Idempotency-key storage, optimistic concurrency, cursor pagination, the
additive-vs-breaking table, and the deprecation lifecycle.

## Idempotency keys

`GET`/`HEAD` are safe and `PUT`/`DELETE` idempotent by contract (deleting a
deleted resource is still `204`/`404`). `POST`/`PATCH` need a client-generated
`Idempotency-Key`:

1. Miss: execute, then persist `key → {fingerprint, status, body}` atomically
   with the side effect (same transaction or the `queue-fundamentals` outbox).
2. Hit, same fingerprint: return the stored response verbatim; do not re-run.
3. Hit, in flight: `409`.
4. Hit, different body: `422`; the key was reused for a different operation.

Scope keys per endpoint and client, TTL them (24 h is typical), fingerprint
method+path+body, and document the key per endpoint as part of the contract.

## Optimistic concurrency

Guard mutating endpoints with `ETag` + `If-Match`: `200` when the version
matches, `412` when `If-Match` is missing, `409` when another writer moved the
version. The `ETag` is the same per-resource version used for read caching in
[resource-modeling](resource-modeling.md); the `409` lets the client re-fetch
and re-merge instead of overwriting blind.

## Pagination

Decide the scheme before the collection grows; retrofitting breaks every
consumer. Always cap: a default page size and a hard max; clamp, do not error.

Prefer cursor (keyset) pagination: `?limit=20&cursor=<opaque>` returning
`next_cursor`. The cursor encodes `{last_sort_value, last_id}`, is `O(log n)`
at any depth, and is stable under inserts and deletes. Offset pagination scans
and discards rows and skips or duplicates across a moving boundary; reserve it
for small, stable, human-browsable lists. Return the same metadata shape on
every collection.

## Filtering and sorting

Expose an allow-listed surface (`?status=paid&sort=-created_at`), never query
passthrough: passthrough couples the API to column names and is an injection
and performance hazard. Each filterable or sortable field is contract and must
be indexed.

## Versioning: additive first

| Safe (additive) | Breaking (needs a version and deprecation) |
|---|---|
| new optional field with a default | removing or renaming a field |
| new endpoint, query param, or header | making an optional field required |
| new enum value clients can ignore | narrowing a type or tightening validation |
| | changing units or semantics; removing an endpoint or enum value |

Version explicitly only when you must break: URL (`/v2/orders`, visible but
pollutes every URL), header (`Accept-Version: 2`, clean but easy to forget),
or media type. Run both versions in parallel; tolerant readers on both sides.

## Deprecation lifecycle

1. Announce in the changelog and directly to known consumers.
2. Mark deprecated in the schema and emit `Deprecation` and `Sunset: <date>`
   headers.
3. Instrument usage of the old shape per consumer.
4. Remove only when usage is zero, not "low".

Example: do not rename `customer_email` to `email` in place. Add `email`,
populate both, deprecate `customer_email`, watch per-consumer usage to zero,
then remove.

## Catch breaks in CI

Run a schema-diff check as a required build gate: `oasdiff`/`openapi-diff`
for REST, Buf breaking detection for protobuf, `graphql-inspector` for
GraphQL. A breaking change then needs an explicit, reviewed version bump.
