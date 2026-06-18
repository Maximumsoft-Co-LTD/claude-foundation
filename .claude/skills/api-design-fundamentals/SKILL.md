---
name: api-design-fundamentals
description: Apply API-design fundamentals to the surface a client codes against — HTTP semantics, request/response contracts, errors, idempotency, pagination, and versioning. Use BEFORE designing or changing any HTTP/REST, GraphQL, or RPC endpoint — a new route, resource model, request/response body, status-code or error shape, pagination scheme, or version bump — even when no principle is named. Skip throwaway scripts, internal one-off RPCs with a single trusted caller, and pure transport/config changes with no contract impact.
---

# API Design Fundamentals

## The 8 principles

The api/architecture/hexagonal seam and cross-skill run order are owned by the always-on router (`.claude/rules/fundamentals.md` → "Seams that blur"): this skill owns one service's published surface — after [[hexagonal-backend]] defines the port, before [[architecture-fundamentals]] draws runtime relationships. The per-principle pointers below name [[security-fundamentals]], [[ddd-strategic]], and [[database-fundamentals]] where their ownership touches the surface.

---

### 1. Model resources and the ubiquitous language, not RPC verbs

**Rule:** Design the API around **nouns** (resources) the client cares about, named in the domain's language, and let the HTTP method carry the verb. A REST URL identifies a *thing*; it should not contain an action. Choose REST-resource, GraphQL-graph, or RPC-procedure shape deliberately based on the access pattern — but whichever you pick, the names are the public vocabulary and they are forever.

**Why:** An RPC surface can't be cached, has no consistent shape, and invents a new convention per operation. A clean resource model is predictable — a client who learns one resource guesses the next. Names leak the domain permanently: conflating "customer" across bounded contexts ([[ddd-strategic]]) publishes that confusion to every consumer forever.

**How to apply:**
- Identify the **resources** — the durable nouns clients manipulate (`order`, `invoice`, `subscription`). Pluralize collections (`/orders`), address members by id (`/orders/{id}`), nest only for genuine ownership (`/orders/{id}/items`) and stop nesting at ~2 levels (deep nesting couples URLs to your hierarchy).
- Put the verb in the **method**, not the path: `GET` to read, `POST` to create, `PUT`/`PATCH` to update, `DELETE` to remove. Reserve a verb-y "action" sub-resource (`POST /orders/{id}/refunds`) for genuine operations that aren't CRUD on a noun — model the *action's result* as a resource (a refund) rather than an RPC call where you can.
- Name fields and resources in the **bounded context's ubiquitous language** ([[ddd-strategic]]). Be consistent: `snake_case` or `camelCase`, but one of them everywhere; `created_at` not `created` in one place and `creationDate` in another.
- **Pick the protocol for the access pattern, not fashion.** REST for resource-oriented CRUD with HTTP caching and broad client reach; **GraphQL** when clients need to select wildly varying field subsets and you want to avoid over-/under-fetching (accept the cost: query-complexity limits, N+1 resolvers, harder caching); **gRPC** for high-throughput internal service-to-service calls with a strict schema and codegen (accept: weaker browser story, binary-on-the-wire debugging). The principles below (status/errors/idempotency/versioning) apply to all three; only the mechanics change.

**Example:**
```
Wrong (RPC bolted onto HTTP):
  POST /api/getOrders          body: {userId: 42}
  POST /api/createOrder
  POST /api/cancelOrderById    body: {orderId: 99}
  → no caching, no consistency, every op a bespoke shape

Right (resource model, verbs in the method):
  GET    /users/42/orders            # list a user's orders (cacheable)
  POST   /orders                     # create — returns 201 + Location: /orders/99
  GET    /orders/99                  # read one
  DELETE /orders/99                  # cancel (or POST /orders/99/cancellations if cancel is a domain event)
```

---

### 2. Use HTTP semantics and status codes honestly

**Rule:** Let the HTTP method and status code carry their standard meaning. The method tells the client what the call *does to state*; the status code tells the client what *happened*, in a class (2xx/3xx/4xx/5xx) it can branch on without parsing the body.

**Why:** HTTP codes are a shared vocabulary caches, proxies, and retry middleware already understand. `200 {"success": false}` breaks infra that trusts the status line. Wrong class breaks client retry logic (`400` for "not logged in" tells the client to fix its request body).

**How to apply:**
- **2xx** — `200` read/update OK, `201 Created` (with a `Location` header to the new resource), `202 Accepted` (async work queued — pair with a status resource, see [[architecture-fundamentals]] on async), `204 No Content` (success, nothing to return, e.g. `DELETE`).
- **4xx — the client must change something:** `400` malformed/invalid input, `401` not authenticated, `403` authenticated but not authorized, `404` resource not found, `409` conflict (duplicate, version mismatch), `422` semantically invalid (well-formed but breaks a business rule, when you distinguish it from 400), `429` rate-limited (with `Retry-After`).
- **5xx — the server failed, the client did nothing wrong:** `500` unhandled, `503` dependency down / overloaded (with `Retry-After` when you can), `504` upstream timeout. A 5xx invites a retry; a 4xx does not — get the class right so client retry logic behaves.
- Match **method semantics** (principle 5): `GET`/`HEAD` safe (no state change, cacheable), `PUT`/`DELETE` idempotent, `POST` neither by default.
- Honour `GET` cacheability: return `ETag`/`Cache-Control` for reads worth caching, and `304 Not Modified` on a matching `If-None-Match`. (GraphQL/gRPC don't get this for free — another reason REST wins for cache-heavy public reads.)

**Example:**
```
Wrong:  HTTP/1.1 200 OK
        {"success": false, "error": "not logged in"}
        → caches store it; retry layers don't retry it; every client parses the body to find the failure

Right:  HTTP/1.1 401 Unauthorized
        WWW-Authenticate: Bearer
        {"error": {"code": "unauthenticated", "message": "Missing or expired token"}}
        → the client branches on the status class; infra treats it correctly
```

---

### 3. The request and response body is a contract — define and validate it at the edge

**Rule:** Specify the exact shape of every request and response — field names, types, which are required, what's nullable — and validate every incoming request against it at the boundary, rejecting malformed input with a 4xx before it reaches domain logic. The wire shape is decoupled from your internal model; never serialize an ORM row straight to the client.

**Why:** Clients marshal the body into their own types; an undocumented or drifting shape breaks them silently. Validate at the edge ([[security-fundamentals]]) — the one place to reject bad input with a useful error. Serializing internal models is the most common way a DB rename silently breaks the API.

**How to apply:**
- **Write the schema down** — OpenAPI for REST, the SDL for GraphQL, `.proto` for gRPC. The schema is the source of truth; generate docs and client types from it, don't hand-maintain them in parallel.
- **Validate at the boundary** against that schema: required fields present, types correct, enums in range, strings within length, numbers within bounds. Reject with `400`/`422` and a field-level error (principle 4) — don't let bad input reach the use case. (The *how* of safe validation/canonicalization is [[security-fundamentals]]; this principle says *do it here, at the edge*.)
- **Separate the wire model from the domain model.** Map explicitly (a DTO / response shape) so an internal rename never leaks to the API and you never accidentally expose a field (password hash, internal flags). This is the [[hexagonal-backend]] adapter's job — translate, don't pass through.
- **Be a tolerant reader on input where it's safe:** ignore unknown request fields rather than 400-ing on them (lets clients send a superset), but **be strict on output**: don't add fields you haven't committed to keeping.
- Set explicit **nullability and defaults**. "Absent", "null", and "empty" are three different things — decide what each means per field and document it.

**Example:**
```
Wrong: return res.json(await db.orders.findById(id))
       → leaks internal_status, ships db column names, breaks the API on any schema rename

Right: a defined response DTO, mapped explicitly
       OrderResponse = { id, status: "pending"|"paid"|"refunded", total_cents: int, currency: string }
       return res.json(toOrderResponse(order))   // internal_* fields never reach the wire
       // and on input: validate(CreateOrderRequest, req.body) → 400 with field errors if it fails
```

---

### 4. Errors are a first-class part of the contract

**Rule:** Design the error response as deliberately as the success response: a consistent, machine-readable shape with a stable error **code**, a human message, and (for validation) per-field detail. Document the errors each endpoint can return. The error body is an API, not an afterthought.

**Why:** An inconsistent error surface means per-endpoint error parsing that still falls back to "something went wrong." A stable machine `code` lets clients branch reliably while human `message` text changes freely. Undocumented errors are discovered in production.

**How to apply:**
- **One error envelope across the whole API.** A widely-used shape is RFC 9457 *Problem Details* (`type`, `title`, `status`, `detail`, `instance`); or a simple `{"error": {"code", "message", "details": [...]}}`. Pick one and use it everywhere, including framework-default 404/500s (override them so they match).
- **Stable, enumerated `code`s** clients branch on, decoupled from the human `message`. Treat the set of codes as part of the contract — adding one is safe, repurposing one is a break.
- **Field-level detail for validation errors:** `details: [{field: "quantity", code: "min", message: "must be > 0"}]` so a form can highlight the offending input.
- **Never leak internals** in the message — no stack traces, SQL, internal hostnames, or "user 42 not found" (an enumeration oracle). Log the detail server-side with a correlation id ([[architecture-fundamentals]] principle 6 / observability); return the id to the client so support can trace it.
- **Document the error set per endpoint** in the schema (OpenAPI `responses`, GraphQL error extensions). The `on error / at boundary` clause your spec's ACs carry maps directly onto these.

**Example:**
```
Wrong (three different shapes across one API, prose as the only signal):
  {"error": "bad request"}                         # endpoint A
  {"msg": "Not enough balance", "ok": false}       # endpoint B  ← reword breaks clients
  "Internal Server Error: at OrderService.java:88"  # endpoint C  ← leaks internals

Right (one envelope, stable code, safe message, traceable):
  HTTP/1.1 422 Unprocessable Entity
  {"error": {
     "code": "insufficient_funds",                 # stable — clients branch on this
     "message": "Order total exceeds available balance.",
     "trace_id": "req_01H...",                      # correlate to server logs
     "details": [{"field": "amount_cents", "code": "exceeds_balance"}]
  }}
```

---

### 5. Respect method safety and make mutations idempotent

**Rule:** Keep `GET`/`HEAD` **safe** (no observable state change) and `PUT`/`DELETE` **idempotent** (calling N times == calling once). For `POST` and any non-idempotent mutation, accept an **idempotency key** so a client can safely retry a request whose response it never saw.

**Why:** Networks drop responses; a retry on `POST /charges` double-charges without idempotency. Safety and idempotency also let proxies, caches, and circuit breakers retry on the client's behalf. A `GET` with a side effect breaks caches; a non-idempotent `PUT` breaks every retry layer.

**How to apply:**
- **Safe methods change nothing observable.** Never mutate on `GET`/`HEAD`. If reading needs to record something (analytics), do it out-of-band; don't make the read unsafe.
- **`PUT` and `DELETE` are idempotent by contract** — design the handler so a repeat is a no-op (delete an already-deleted resource → still `204`/`404`, not `500`; `PUT` the same body twice → same final state).
- **`POST`/`PATCH` non-idempotent mutations take an `Idempotency-Key`** header (client-generated UUID). Persist the key → response mapping; on a repeat key, return the *stored* original response instead of re-executing. This is part of the public contract, not an optimization (the [[architecture-fundamentals]] principle 7 point). The same idea applies to message consumers — see [[queue-fundamentals]] for idempotent consumers on the async side.
- **Use `409 Conflict` for optimistic concurrency:** accept `If-Match: <etag>` on updates; reject a stale write with `409` so a client can't silently clobber another's change (the API-surface mirror of [[database-fundamentals]]'s optimistic-locking).

**Example:**
```
Wrong:  POST /charges  {amount_cents: 5000}
        client times out, retries → two charges, angry customer, manual refund

Right:  POST /charges
        Idempotency-Key: 9f1c...-client-generated-uuid
        {amount_cents: 5000}
        → server stores key→result; the retry with the same key returns the FIRST charge's
          201 response verbatim. One charge, safe retry.
```

---

### 6. Design pagination, filtering, and sorting before the collection grows

**Rule:** Never return an unbounded collection. Decide the pagination scheme (cursor vs offset), the default and max page size, and the filter/sort surface up front — changing it later is a breaking change to every client that paged through the old shape.

**Why:** An unbounded `GET /orders` is fine at 10 rows and fatal at 10M. Retrofitting pagination breaks every consumer. Offset pagination scans N rows for page N and skips/duplicates rows when the list mutates ([[database-fundamentals]] keyset-vs-offset); cursor is stable at any depth.

**How to apply:**
- **Always cap the result set.** A default page size (e.g. 20) and a hard max (e.g. 100); clamp, don't error, on an over-large `limit`.
- **Prefer cursor (keyset) pagination** for anything large or mutating: return an opaque `next_cursor`; the client passes it back (`?cursor=...`). It's stable under inserts/deletes and `O(log n)` at any depth. Reserve offset pagination for small, stable, human-browsable lists where "jump to page 7" is a real requirement.
- **Return pagination metadata** consistently: `next_cursor` (or `total`/`page` for offset), and a stable `Link: rel="next"` header or body envelope — the same shape on every collection.
- **Make filtering and sorting an explicit, allow-listed surface** (`?status=paid&sort=-created_at`), not arbitrary query passthrough (which couples the API to your column names and is an injection/perf footgun — validate against an allow-list per [[security-fundamentals]]). Each filterable field is part of the contract; index it ([[database-fundamentals]] principle 3).

**Example:**
```
Wrong:  GET /orders           → returns all 4,000,000 rows. Times out. Repeat with ?offset=200000
        → OFFSET 200000 scans-and-throws 200k rows AND skips rows inserted since page 1.

Right:  GET /orders?limit=20                     → 20 items + "next_cursor": "eyJpZCI6..."
        GET /orders?limit=20&cursor=eyJpZCI6...  → stable next page, fast at any depth
        GET /orders?status=paid&sort=-created_at → allow-listed filter + sort, indexed columns
```

---

### 7. Authentication, authorization, and rate-limiting live at the boundary

**Rule:** Every endpoint authenticates the caller, authorizes the specific action on the specific resource (deny by default), and is protected by a rate limit. Decide per endpoint who may call it and how often — public, authenticated, owner-only, admin-only — and enforce it at the edge, not in scattered helpers.

**Why:** The endpoint is the trust boundary. BOLA/IDOR (OWASP API Top 10 #1): checking authentication but not object-level authorization lets any logged-in user enumerate resources. Without a rate limit, one client exhausts the service for everyone.

**How to apply:**
- **Authenticate** with a standard scheme — `Authorization: Bearer <token>` (OAuth2/OIDC/JWT) for users, API keys for service clients — and document which each endpoint requires. `401` when missing/expired. (The crypto/token mechanics are [[security-fundamentals]]; name the scheme here.)
- **Authorize every access on the object, deny by default.** Don't stop at "is authenticated" — check "may *this* caller do *this* action on *this* resource". Owner checks (`order.user_id == caller.id`), role/scope checks (`scope: orders:write`), tenant isolation. A missing check is a `403` you forgot, and that's the BOLA hole.
- **Rate-limit every endpoint**, tighter on auth/expensive/write paths. Return `429` with `Retry-After` and surface the budget (`RateLimit-Limit`/`RateLimit-Remaining` headers) so well-behaved clients can self-throttle.
- **Don't leak existence to unauthorized callers:** a resource the caller may not see is a `404`, not a `403` that confirms it exists.
- Defer the full threat model and implementation to [[security-fundamentals]] — this principle's job is to make sure *every endpoint on the surface* has an answer for authn, authz, and rate limit before it ships.

**Example:**
```
Wrong:  GET /orders/{id}
        handler: if (!req.user) return 401
                 return db.orders.findById(id)      # any logged-in user reads ANY order — BOLA/IDOR

Right:  GET /orders/{id}    (scope: orders:read, rate-limit: 100/min/user)
        handler: if (!req.user) return 401
                 order = db.orders.findById(id)
                 if (!order || order.user_id !== req.user.id) return 404   # authorize the object; don't confirm existence
                 return toOrderResponse(order)
```

---

### 8. Version for backwards-compatibility; break only with a deprecation cycle

**Rule:** Treat the published surface as a contract you evolve **additively**. Add optional fields and new endpoints freely; never rename, remove, retype, or change the meaning of an existing field without a versioned, deprecation-cycled migration that gives every consumer time to move.

**Why:** Clients are other teams, pinned mobile builds, and two-year-old scripts — you can't deploy them atomically with the API. Additive changes are invisible and free; breaking changes are quarters of coordination. (Surface-level mechanics of [[architecture-fundamentals]] principle 7.)

**How to apply:**
- **Additive is safe; mutating is a break.** Safe: a new optional field with a default, a new endpoint, a new optional query param, a new enum value clients can ignore. Break: removing/renaming a field, making an optional field required, narrowing a type, changing units or semantics, removing an endpoint or enum value clients switch on.
- **Version explicitly only when you genuinely must break** — URL (`/v1/`, `/v2/`), header (`Accept: application/vnd.api+json; version=2`), or media-type. Run both versions in parallel; don't break v1 the day v2 ships. (Prefer additive evolution over a version bump — a new major version is a parallel surface to maintain.)
- **Tolerant reader on both sides:** clients ignore unknown response fields (so you can add them); the server doesn't require clients to send fields they predate.
- **Deprecate on a real horizon:** announce, mark deprecated in the schema, **instrument usage of the old shape by consumer**, notify, and remove only when usage is *zero* — not "low". A `Deprecation`/`Sunset` header (RFC 8594) tells clients programmatically.
- **A schema-diff / contract-compatibility check in CI** (openapi-diff, Buf breaking-change detection for protobuf, GraphQL schema checks) rejects an accidental break before it ships — the cheapest possible place to catch it. This is the [[delivery-engineering]] CI-gate point applied to the API contract.

**Example:**
```
Wrong: rename response field `customer_email` → `email` in place.
       Every client parsing `customer_email` breaks on the next deploy. Roll back, hold a meeting,
       migrate the whole consumer fleet over a quarter.

Right: add `email` alongside `customer_email`; populate both. Mark `customer_email` deprecated in the
       OpenAPI schema + a Deprecation header. Track per-consumer usage until it hits zero, THEN remove.
       Cost: one extra line in the serializer and a quarter of patient observation — no client ever breaks.
```

---

## Pre-flight checklist

Before designing or changing any endpoint, run through these:

1. **Resource model:** is the surface organized around domain nouns in the ubiquitous language, with verbs in the HTTP method — not RPC actions in the path? Are names consistent and would a client guess the next route from the last?
2. **HTTP semantics:** does every response use the honest status code and class (no `200` wrapping a failure)? Are `GET` reads cacheable and is the right method chosen for each operation?
3. **Body contract:** is every request/response shape written down in a schema, validated at the boundary, and mapped from a *separate* wire DTO so internal renames don't leak? Is nullability explicit?
4. **Errors:** one consistent error envelope, stable machine `code`s decoupled from human text, field-level validation detail, no leaked internals, documented per endpoint?
5. **Idempotency & safety:** are `GET`/`HEAD` safe and `PUT`/`DELETE` idempotent? Does every non-idempotent mutation accept an idempotency key so retries are safe?
6. **Pagination:** is every collection bounded with a default and max page size, cursor pagination for anything large/mutating, and an allow-listed filter/sort surface?
7. **Auth & limits:** does every endpoint authenticate, authorize the specific object/action (deny by default — no BOLA hole), and carry a rate limit? Is existence hidden from unauthorized callers?
8. **Versioning:** is this change additive? If it must break, is there an explicit version and a deprecation cycle with usage instrumentation — and a CI contract-compatibility check?

If any answer is "I don't know," stop and decide before publishing the surface — it's far cheaper now than after a client has coded against it.

## When to skip this skill

- Throwaway scripts, spikes, internal one-off RPCs with a single trusted caller changeable in lockstep.
- Pure transport/config changes with no contract impact (framework swap, timeout tweak, TLS cert) → [[architecture-fundamentals]] / [[delivery-engineering]].
- Internal module boundaries inside one service that never cross the process edge → [[programming-fundamentals]] / [[hexagonal-backend]].

For everything else — any endpoint another team, client, or future version of your own app will code against — these fundamentals apply.

## Reference files

- `references/resource-modeling.md` — resources vs RPC, URL design and nesting depth, collection/member conventions, the REST-vs-GraphQL-vs-gRPC decision matrix and when each wins. Use when shaping the surface (principles 1–2).
- `references/contracts-and-errors.md` — OpenAPI/SDL/proto as source of truth, edge validation, wire-DTO vs domain-model mapping, the RFC 9457 Problem Details error envelope, stable error codes, field-level validation detail. Use when designing request/response bodies and the error surface (principles 3–4).
- `references/evolution.md` — idempotency keys, optimistic concurrency with ETags, cursor vs offset pagination, allow-listed filtering, additive-vs-breaking change rules, versioning schemes, the deprecation lifecycle, and CI contract-compatibility checks. Use when designing for safe retries, large collections, and long-term evolution (principles 5, 6, 8).
