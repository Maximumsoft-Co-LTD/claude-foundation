---
name: api-design-fundamentals
description: Apply API-design fundamentals to the surface a client codes against — HTTP semantics, request/response contracts, errors, idempotency, pagination, and versioning. Use BEFORE designing or changing any HTTP/REST, GraphQL, or RPC endpoint — a new route, resource model, request/response body, status-code or error shape, pagination scheme, or version bump — even when no principle is named. Skip throwaway scripts, internal one-off RPCs with a single trusted caller, and pure transport/config changes with no contract impact.
---

# API Design Fundamentals

## The 8 principles

Seam ownership and cross-skill run order live in the always-on router (`.claude/rules/fundamentals.md` → "Seams that blur"). This skill owns one service's published surface — after [[hexagonal-backend]] defines the port, before [[architecture-fundamentals]] draws runtime relationships.

Each principle states its **Rule** plus a one-line how-to; the *why*, examples, and full mechanics live in the linked reference files (indexed at the end) — pull the one matching the work in front of you.

---

### 1. Model resources and the ubiquitous language, not RPC verbs

**Rule:** Design around domain **nouns** (resources) named in the ubiquitous language ([[ddd-strategic]]); let the HTTP method carry the verb. A URL identifies a *thing*, not an action — names are the public vocabulary, and they are forever. Pick REST / GraphQL / gRPC for the access pattern, not fashion.

→ `references/resource-modeling.md` (URL conventions, nesting depth, protocol decision matrix).

---

### 2. Use HTTP semantics and status codes honestly

**Rule:** The method says what the call does to state; the status code says what happened, in a class (2xx/3xx/4xx/5xx) the client branches on without parsing the body. Never `200 {"success": false}`. The 4xx/5xx split is a retry contract — a 5xx invites a retry, a 4xx tells the client to fix its request.

→ `references/resource-modeling.md` (status-code table, caching semantics).

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

**Rule:** Every endpoint authenticates the caller, authorizes the **specific action on the specific object** (deny by default — a missing object-level check is the BOLA/IDOR hole, OWASP API Top 10 #1), and carries a rate limit; a caller who may not see a resource gets `404`, not a confirming `403`. The endpoint is the trust boundary — enforce at the edge, not in scattered helpers.

The crypto/token mechanics and full threat model are [[security-fundamentals]]; this principle ensures every endpoint has an answer for authn, authz, and rate limit before it ships. → `references/auth-and-limits.md`.

---

### 8. Version for backwards-compatibility; break only with a deprecation cycle

**Rule:** Evolve the surface **additively** — add optional fields and new endpoints freely; never rename, remove, retype, or change the meaning of an existing field without a versioned, deprecation-cycled migration that gives consumers time to move.

→ `references/evolution.md` (additive-vs-breaking table, versioning schemes, deprecation lifecycle, CI contract-compatibility checks — [[delivery-engineering]]).

---

## Pre-flight checklist

Before designing or changing any endpoint, run through these:

1. **Resource model:** domain nouns in the ubiquitous language, verbs in the HTTP method — not RPC actions in the path? Names consistent enough that a client could guess the next route?
2. **HTTP semantics:** honest status code and class on every response (no `200` wrapping a failure)? `GET` reads cacheable, right method per operation?
3. **Body contract:** every shape written in a schema, validated at the boundary, mapped from a separate wire DTO (no internal leaks)? Nullability explicit?
4. **Errors:** one error envelope, stable machine `code`s decoupled from human text, field-level validation detail, no leaked internals, documented per endpoint?
5. **Idempotency & safety:** `GET`/`HEAD` safe, `PUT`/`DELETE` idempotent? Every non-idempotent mutation accepts an idempotency key?
6. **Pagination:** every collection bounded (default + max page size), cursor pagination for large/mutating sets, allow-listed filter/sort?
7. **Auth & limits:** every endpoint authenticates, authorizes the specific object (deny by default — no BOLA hole), rate-limits, and hides existence from unauthorized callers?
8. **Versioning:** is this change additive? If it must break: explicit version, deprecation cycle with usage instrumentation, CI contract-compatibility check?

If any answer is "I don't know," stop and decide now — cheaper before a client has coded against it.

## When to skip this skill

- Throwaway scripts, spikes, internal one-off RPCs with a single trusted caller changeable in lockstep.
- Pure transport/config changes with no contract impact (framework swap, timeout tweak, TLS cert) → [[architecture-fundamentals]] / [[delivery-engineering]].
- Internal module boundaries inside one service that never cross the process edge → [[programming-fundamentals]] / [[hexagonal-backend]].

For everything else — any endpoint another team, client, or future version of your own app will code against — these fundamentals apply.

## Reference files

Read the one matching the work in front of you — not all of them upfront.

- `references/resource-modeling.md` — resources vs RPC, URL design and nesting depth, collection/member conventions, REST-vs-GraphQL-vs-gRPC decision matrix. Principles 1–2.
- `references/contracts-and-errors.md` — OpenAPI/SDL/proto as source of truth, edge validation, wire-DTO vs domain-model mapping, RFC 9457 error envelope, stable error codes, field-level validation. Principles 3–4.
- `references/evolution.md` — idempotency keys, optimistic concurrency with ETags, cursor vs offset pagination, allow-listed filtering, additive-vs-breaking rules, versioning schemes, deprecation lifecycle, CI contract checks. Principles 5, 6, 8.
- `references/auth-and-limits.md` — authentication scheme, object-level authorization (BOLA/IDOR), rate-limiting, hiding existence from unauthorized callers. Principle 7.
