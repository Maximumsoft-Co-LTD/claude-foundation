---
name: api-design-fundamentals
description: Apply API-design fundamentals before shaping the surface a client codes against — resource and endpoint modeling, HTTP semantics and status codes, request/response contracts and validation, errors as a first-class contract, idempotency and method safety, pagination and filtering, backwards-compatible versioning, and auth/rate-limiting at the boundary. Use BEFORE designing or changing any HTTP/REST, GraphQL, or RPC endpoint — a new route, a resource model, a request or response body, a status-code or error shape, a pagination scheme, or a version bump — even when no principle is named. Covers the REST-vs-GraphQL/gRPC trade-off and includes references on resource modeling, errors and validation, and versioning. Skip throwaway scripts, internal one-off RPCs with a single trusted caller, and pure transport/config changes with no contract impact.
---

# API Design Fundamentals

## Why this exists

An API is a contract you publish to people you will never meet, who will build on it, depend on its exact shape, and feel every break. Most API pain is not a bug in the handler — it is a design decision that was never made deliberately: a `POST` that isn't idempotent so a retry double-charges, a 200 response carrying `{"error": ...}` so clients can't tell success from failure, an unversioned response whose new required field breaks every consumer on deploy, offset pagination that silently skips rows when the underlying list shifts, a "flexible" endpoint that accepts anything and validates nothing. Each is cheap to get right while you are sketching the surface and expensive-to-impossible to fix once clients have coded against it. The surface outlives the implementation behind it — you will rewrite the service three times; the URL and the response shape have to survive all three.

This skill is a **pre-flight** for designing the *surface* of one API: the resources, routes, methods, status codes, request and response bodies, errors, pagination, and versioning that a client codes against. Read it before you write the first route, not after the first breaking-change incident. The principles are stack- and protocol-agnostic — they apply to REST over HTTP (the default for backend work), and most translate directly to GraphQL and gRPC where noted; the mechanics differ, the decisions do not.

Where this sits next to its neighbours — keep the seams clean, cross-link rather than restate:

- [[architecture-fundamentals]] owns the **runtime relationship between components** — whether a call is sync or async, timeouts and retries and circuit breakers, who owns which data, and contracts as a *system* concern (the same change rippling across services). This skill owns the **design of one API's surface** — the shape a single client codes against. Architecture decides *whether* two components talk and *how reliably*; api-design decides *what the message looks like* when they do. (Contract *evolution* is shared: architecture-fundamentals principle 7 frames it as a multi-service rollout concern; here, principle 8 frames it as the surface-versioning mechanics for one API.)
- [[hexagonal-backend]] — the API is a **driving adapter** over an application port. The endpoint translates HTTP/GraphQL/gRPC into a use-case call and back; it must not leak domain internals (ORM rows, internal enums) into the wire shape, and the port — not the framework — is the real boundary. Design the surface here; wire it to the port there.
- [[security-fundamentals]] — every endpoint is a **trust boundary**. Authentication, authorization on every access (deny by default), input validation and canonicalization, and output encoding live there; this skill names *where* on the surface they attach (principle 7), security-fundamentals owns *how* to implement them.
- [[ddd-strategic]] — the API should speak the **ubiquitous language** of its bounded context. Resource names and field names are the public vocabulary; a leaky or inconsistent vocabulary is a design smell that ddd-strategic diagnoses.

## The 8 principles

Each principle has a one-line rule, a *why*, and a worked example. Apply them in roughly this order — the early ones (the resource model, the method semantics) constrain the later ones (errors, pagination, versioning).

---

### 1. Model resources and the ubiquitous language, not RPC verbs

**Rule:** Design the API around **nouns** (resources) the client cares about, named in the domain's language, and let the HTTP method carry the verb. A REST URL identifies a *thing*; it should not contain an action. Choose REST-resource, GraphQL-graph, or RPC-procedure shape deliberately based on the access pattern — but whichever you pick, the names are the public vocabulary and they are forever.

**Why:** The resource model is the part of the API clients reason about, bookmark, cache, and build mental models around. A surface full of `/getUserOrders`, `/createOrder`, `/cancelOrderById` is an RPC list bolted onto HTTP — it can't use HTTP caching, it has no consistent shape, and every new operation invents its own convention. A clean resource model (`/users/{id}/orders`, `POST /orders`, `DELETE /orders/{id}`) is predictable: a client who learns one resource can guess the next. And the *names* leak your domain to the world — if "customer" means one thing in billing and another in CRM (a [[ddd-strategic]] bounded-context boundary), an API that conflates them publishes the confusion to every consumer permanently.

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

**Why:** HTTP is a contract clients, proxies, caches, and load balancers already understand. Returning `200 OK` with `{"success": false}` forces every client to parse the body to learn the call failed — and breaks every piece of infrastructure that trusts the status line (a cache will happily cache your "error", a retry layer won't retry your 200-wrapped 503). Using the wrong code is worse than a vague one: a `400` for "you're not logged in" sends the client to fix its request body when it needs to authenticate; a `200` for "created" denies the client the `201 + Location` it needs to find the new resource. The codes are a finite, shared vocabulary — spend them correctly and clients write less special-case code.

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

**Why:** The body is the part of the contract clients marshal into their own types; an undocumented or drifting shape means every consumer reverse-engineers it from example responses and breaks when you change a field they didn't know was load-bearing. Validating at the edge is both a correctness and a [[security-fundamentals]] concern: unvalidated input is the root of injection, mass-assignment, and "the server 500'd because `quantity` was a string" bugs — and the boundary is the one place you can reject it cleanly with a useful error instead of a stack trace. Serializing the internal model directly is the most common way a refactor becomes a breaking change: rename a DB column and you've silently broken the API.

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

**Why:** Clients spend as much code on the unhappy path as the happy one, and an inconsistent error surface makes that code impossible to write well. If one endpoint returns `{"error": "bad"}`, another returns `{"message": "...", "errors": [...]}`, and a third returns a bare string, every client writes per-endpoint error parsing and still falls back to "something went wrong". A **stable machine code** (`insufficient_funds`, not the prose "You don't have enough balance" which Marketing will reword next sprint) lets clients branch reliably and lets you change the human text freely. Undocumented errors mean clients only discover the `409` exists when it happens in production.

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

**Why:** Networks drop responses. A client that sends `POST /charges`, times out, and retries has no idea whether the first charge succeeded — without idempotency, the safe-looking retry double-charges the customer. Safety and idempotency are also what let *everyone else* — proxies, the browser, retry middleware, [[architecture-fundamentals]]'s circuit breakers — retry on your behalf without asking. A `GET` with a side effect (a "track view" that mutates on read) breaks caches and prefetchers; a non-idempotent `PUT` breaks every retry layer that assumed the verb's contract. These guarantees are the difference between "retries are free" and "retries are a liability".

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

**Why:** A `GET /orders` that returns "all orders" is a latent outage: it's fine with 10 rows in dev and falls over at 10 million in prod, taking the database and the client with it. Retrofitting pagination onto a shipped unbounded endpoint breaks every consumer. And the *kind* of pagination matters: naive `?offset=N&limit=M` (`OFFSET` in SQL) both scans-and-discards N rows (slow on deep pages — the [[database-fundamentals]] keyset-vs-offset point) and **skips or duplicates rows** when the underlying list changes between pages, which silently corrupts any client doing a full sync. Cursor pagination is stable under concurrent writes and stays fast at any depth.

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

**Why:** The endpoint is the trust boundary; everything past it assumes the caller is allowed. Skipping authorization is the most common serious API vulnerability — **Broken Object-Level Authorization** (BOLA / IDOR) tops the OWASP API Security Top 10: `GET /orders/99` that checks you're logged in but not that order 99 is *yours* lets any user read every order by incrementing the id. Without a rate limit, one client (or one attacker) can exhaust the service for everyone, brute-force tokens, or run up your bill. These are surface decisions: *which* auth scheme, *what* the scope of each token is, and *what* the limit is are part of the contract clients integrate against.

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

**Why:** You cannot deploy your API and all of its clients atomically — clients are other teams, other companies, mobile apps pinned to an old build, scripts written two years ago. A breaking change turns "ship a field" into "coordinate a fleet-wide migration", and discovering the break in production means an emergency rollback. The asymmetry is enormous: additive changes are invisible to clients who haven't adopted them and free to ship continuously; breaking changes are quarters of coordination. (This is the surface-level mechanics of [[architecture-fundamentals]] principle 7's system-level contract-evolution stance.)

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

- Throwaway scripts, spikes, and internal one-off RPCs with a single trusted caller you control and can change in lockstep — there's no external contract to protect.
- Pure transport or config changes with no contract impact (swapping the web framework behind an unchanged surface, a timeout tweak, a TLS cert) — that's [[architecture-fundamentals]] / [[delivery-engineering]] territory.
- Internal function or module boundaries inside one service that never cross the process edge — that's [[programming-fundamentals]] and [[hexagonal-backend]] (the port), not a published API.
- Trivial, fully-internal CRUD over a private network where the consumer is the same team and the same deploy, with no third-party or cross-team client — apply judgement; the versioning and auth principles still earn their keep the moment a second consumer appears.

For everything else — any endpoint an outside client, another team, or a future version of your own app will code against — these fundamentals apply. They apply on the "internal" API that always eventually gets a second consumer, and especially on the "we'll version it later" endpoint.

## How to use this skill in a conversation

This skill is always-on for API-surface work (per the project rule at `.claude/rules/api-design-fundamentals.md`). Don't ask the user to opt in. If the task is in "When to skip," say so in one sentence and proceed without it.

When the skill applies:
- **Designing a new API or endpoint** — walk the principles in order: name the resources and language (1), the methods and status codes (2), the body contracts (3) and error shape (4), the idempotency/safety guarantees (5), pagination/filtering (6), auth and limits (7), and the versioning stance (8). Show the user the surface — routes, request/response shapes, error envelope — before writing handlers.
- **Changing an existing API** — the load-bearing question is principle 8: is this additive or breaking? Name it explicitly and propose the additive path or the deprecation cycle; never silently mutate a published field.
- **Reviewing an API** — use the principles as a checklist and cite the number when flagging an issue ("this is a principle-7 violation: `GET /orders/{id}` authenticates but never authorizes the object — BOLA").
- **Wiring an endpoint to the backend** — this skill designs the surface; [[hexagonal-backend]] connects it to the application port (translate the wire DTO to a use-case call, don't pass the domain model through), and [[security-fundamentals]] implements the authn/authz/validation the boundary demands.
- When you make a non-obvious call — choosing GraphQL over REST, cursor over offset, a version bump over an additive field, `422` vs `400` — say *why* in one sentence and cite the principle. Don't emit API decisions silently.

## Reference files

Deeper guides for individual principles. Read the one that matches the work in front of you; you don't need to read them all upfront. (These are described here for scope; the bodies are authored on demand.)

- `references/resource-modeling.md` — resources vs RPC, URL design and nesting depth, collection/member conventions, the REST-vs-GraphQL-vs-gRPC decision matrix and when each wins. Use when shaping the surface (principles 1–2).
- `references/contracts-and-errors.md` — OpenAPI/SDL/proto as source of truth, edge validation, wire-DTO vs domain-model mapping, the RFC 9457 Problem Details error envelope, stable error codes, field-level validation detail. Use when designing request/response bodies and the error surface (principles 3–4).
- `references/evolution.md` — idempotency keys, optimistic concurrency with ETags, cursor vs offset pagination, allow-listed filtering, additive-vs-breaking change rules, versioning schemes, the deprecation lifecycle, and CI contract-compatibility checks. Use when designing for safe retries, large collections, and long-term evolution (principles 5, 6, 8).
