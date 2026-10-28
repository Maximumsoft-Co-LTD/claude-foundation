# Resource modeling, URLs, protocol choice, status codes

## Finding the resources

A resource is a durable noun the client manipulates, named in the bounded
context's language, not the database schema.

- The noun the client talks about is the resource (`subscription`) even if it
  is three tables internally.
- An action with a lasting result is a resource: `POST /orders/{id}/refunds`
  creates a `refund`; never `POST /refundOrder`.
- A transient action with no durable result is the rare verb sub-resource
  (`POST /carts/{id}/checkout`). Keep these few.

## URL conventions

| Shape | Pattern | Example |
|---|---|---|
| Collection | `/{plural}` | `GET /orders` |
| Member | `/{plural}/{id}` | `GET /orders/99` |
| Owned sub-resource | `/{plural}/{id}/{plural}` | `GET /orders/99/items` |
| Action result | `POST /{plural}/{id}/{noun}` | `POST /orders/99/refunds` |
| Singleton | `/{singular}` | `GET /users/me/settings` |
| Search | `/{plural}?{filters}` | `GET /orders?status=paid` |

Nesting stops at two levels; past that, address the resource by its own id
and carry the parent in the body. Pick one casing for every field, parameter,
and path segment; a rename is a breaking change ([evolution](evolution.md)).

## Protocol decision matrix

| Axis | REST | GraphQL | gRPC |
|---|---|---|---|
| Best for | resource CRUD, unknown clients, cache-heavy reads | varied first-party views, avoiding over/under-fetch | high-throughput internal service calls |
| HTTP caching | free (`ETag`, `304`) | not free (POST) | none |
| Browser | native | native | needs grpc-web |
| Streaming | SSE/WebSocket bolt-on | subscriptions | first-class |
| Main cost | endpoint sprawl, over-fetch | query-complexity limits, N+1 resolvers | weak browser reach, binary debugging |

Public API for unknown clients → REST. One first-party app with hungry views
→ GraphQL. Internal mesh you control both ends of → gRPC. Mixing is fine.

## HTTP status codes

| Code | Use when |
|---|---|
| 200 / 201 / 204 | read or update; created (add `Location`); success with no body |
| 202 | async work queued; return a status resource to poll |
| 304 | conditional `GET` matched `If-None-Match` |
| 400 / 422 | malformed input; well-formed but breaks a business rule |
| 401 / 403 / 404 | not authenticated; not permitted (prefer 404 to hide existence); not found |
| 409 | duplicate or optimistic-concurrency version mismatch |
| 429 | rate-limited, with `Retry-After` |
| 500 / 503 / 504 | unhandled fault; dependency down (`Retry-After`); upstream timeout |

The 4xx/5xx split is a retry contract: 5xx invites a retry, 4xx means change
the request. `200 {success:false}` hides failure from every cache and retry
layer.

## Caching reads honestly

Return `ETag` and `Cache-Control` on cacheable reads; answer `If-None-Match`
with `304`. The `ETag` is the per-resource version also used for optimistic
concurrency. Use `private` for per-user data, `public` only for shared-safe
reads. See [contracts-and-errors](contracts-and-errors.md) for the body shape.
