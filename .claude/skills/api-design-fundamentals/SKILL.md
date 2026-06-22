---
name: api-design-fundamentals
description: Apply API-design fundamentals to the surface a client codes against — HTTP semantics, request/response contracts, errors, idempotency, pagination, and versioning. Use BEFORE designing or changing any HTTP/REST, GraphQL, or RPC endpoint — a new route, resource model, request/response body, status-code or error shape, pagination scheme, or version bump — even when no principle is named. Skip throwaway scripts, internal one-off RPCs with a single trusted caller, and pure transport/config changes with no contract impact.
---

# API Design Fundamentals

## The 8 principles

The api/architecture/hexagonal seam and cross-skill run order are owned by the always-on router (`.claude/rules/fundamentals.md` → "Seams that blur"): this skill owns one service's published surface — after [[hexagonal-backend]] defines the port, before [[architecture-fundamentals]] draws runtime relationships. The per-principle pointers below name [[security-fundamentals]], [[ddd-strategic]], and [[database-fundamentals]] where their ownership touches the surface.

This body is the **pre-flight digest** — each principle is its Rule plus the operative how-to in one line. The *why*, the worked examples, decision tables, and full mechanics live in the reference files linked per principle (and listed at the end); pull the one that matches the work, not all of them.

---

### 1. Model resources and the ubiquitous language, not RPC verbs

**Rule:** Design around domain **nouns** (resources) named in the ubiquitous language ([[ddd-strategic]]); let the HTTP method carry the verb. A URL identifies a *thing*, not an action — names are the public vocabulary, and they are forever. Pick REST / GraphQL / gRPC for the access pattern, not fashion.

Pluralize collections, address members by id, nest ≤2 levels for genuine ownership, model an action's *result* as a resource (`POST /orders/{id}/refunds`), keep casing consistent everywhere. → `references/resource-modeling.md` (URL conventions, protocol decision matrix).

---

### 2. Use HTTP semantics and status codes honestly

**Rule:** The method says what the call does to state; the status code says what happened, in a class (2xx/3xx/4xx/5xx) the client branches on without parsing the body. Never `200 {"success": false}`. The 4xx/5xx split is a retry contract — a 5xx invites a retry, a 4xx tells the client to fix its request.

Match method semantics (principle 5); honour `GET` cacheability (`ETag`/`Cache-Control`/`304`). → `references/resource-modeling.md` (status-code table, caching).

---

### 3. The request and response body is a contract — define and validate it at the edge

**Rule:** Specify every request/response shape (fields, types, required, nullable) in a schema, validate every incoming request against it at the boundary — rejecting with `4xx` before it reaches domain logic ([[security-fundamentals]]) — and map through a wire DTO separate from your internal model so a DB rename never leaks. Tolerant reader on input, strict writer on output.

→ `references/contracts-and-errors.md` (schema-first + codegen, DTO mapping, the absent/null/empty tri-state).

---

### 4. Errors are a first-class part of the contract

**Rule:** Use one consistent, machine-readable error envelope across the whole API (e.g. RFC 9457 Problem Details), with a **stable `code`** clients branch on (decoupled from the human message), field-level validation detail, and no leaked internals (log with a correlation id — [[observability-fundamentals]] — and return it). Document the error set per endpoint.

→ `references/contracts-and-errors.md` (RFC 9457 envelope, error-code-as-contract rules).

---

### 5. Respect method safety and make mutations idempotent

**Rule:** Keep `GET`/`HEAD` **safe** (no observable state change) and `PUT`/`DELETE` **idempotent** (N calls == one). Every non-idempotent mutation (`POST`/`PATCH`) accepts an **`Idempotency-Key`** so a client can safely retry a request whose response it never saw. Use `409` + `If-Match`/`ETag` for optimistic concurrency (the surface mirror of [[database-fundamentals]] optimistic locking).

→ `references/evolution.md` (idempotency-key algorithm + storage, optimistic concurrency).

---

### 6. Design pagination, filtering, and sorting before the collection grows

**Rule:** Never return an unbounded collection. Cap with a default + hard-max page size; prefer **cursor (keyset)** pagination for anything large or mutating ([[database-fundamentals]]); expose filtering/sorting as an explicit **allow-listed** surface ([[security-fundamentals]]), not arbitrary query passthrough. Retrofitting pagination breaks every consumer that paged the old shape.

→ `references/evolution.md` (cursor vs offset, filter/sort allow-list).

---

### 7. Authentication, authorization, and rate-limiting live at the boundary

**Rule:** Every endpoint authenticates the caller, authorizes the **specific action on the specific object** (deny by default), and carries a rate limit. The endpoint is the trust boundary — enforce at the edge, not in scattered helpers.

- **Authenticate** with a standard scheme (`Authorization: Bearer` for users, API keys for services); `401` when missing/expired.
- **Authorize the object, not just "is logged in"** — owner (`order.user_id == caller.id`), role/scope, tenant isolation. A missing object-level check is the BOLA/IDOR hole (OWASP API Top 10 #1).
- **Rate-limit** every endpoint, tighter on auth/expensive/write paths; `429` + `Retry-After`, surface the budget so clients self-throttle.
- **Hide existence** from unauthorized callers: a resource they may not see is `404`, not a `403` that confirms it exists.

The crypto/token mechanics and full threat model are [[security-fundamentals]] (its `authn-authz.md` reference); this principle's job is to ensure *every endpoint* has an answer for authn, authz, and rate limit before it ships. *(Auth is the one principle with no dedicated api-design reference — it defers to security-fundamentals.)*

---

### 8. Version for backwards-compatibility; break only with a deprecation cycle

**Rule:** Evolve the surface **additively** — add optional fields and new endpoints freely; never rename, remove, retype, or change the meaning of an existing field without a versioned, deprecation-cycled migration that gives consumers time to move. Prefer additive over a version bump (a new major version is a parallel surface to maintain). A schema-diff / contract-compatibility check in CI ([[delivery-engineering]]) rejects accidental breaks before they ship.

→ `references/evolution.md` (additive-vs-breaking table, versioning schemes, the deprecation lifecycle).

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

Deeper guides for individual principles. Read the one that matches the work in front of you; you don't need to read them all upfront.

- `references/resource-modeling.md` — resources vs RPC, URL design and nesting depth, collection/member conventions, the REST-vs-GraphQL-vs-gRPC decision matrix and when each wins. Use when shaping the surface (principles 1–2).
- `references/contracts-and-errors.md` — OpenAPI/SDL/proto as source of truth, edge validation, wire-DTO vs domain-model mapping, the RFC 9457 Problem Details error envelope, stable error codes, field-level validation detail. Use when designing request/response bodies and the error surface (principles 3–4).
- `references/evolution.md` — idempotency keys, optimistic concurrency with ETags, cursor vs offset pagination, allow-listed filtering, additive-vs-breaking change rules, versioning schemes, the deprecation lifecycle, and CI contract-compatibility checks. Use when designing for safe retries, large collections, and long-term evolution (principles 5, 6, 8).
