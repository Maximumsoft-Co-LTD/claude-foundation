---
name: api-design-fundamentals
description: "Use when workType includes api or library, or a requirement defines a request, response, status code, error body, pagination, or version other code consumes. Skip private module interfaces (use programming-fundamentals)."
---

# API design fundamentals

A published contract is for clients you cannot see; trace external consumers
and serialized bytes before changing it.

## Steps

1. Model resources in domain language, not controller or RPC verbs. Use
   protocol semantics honestly: method, status, caching, and safety match
   behavior.
2. Define request/response schemas, defaults, limits, and validation at the
   boundary. Never expose persistence models.
3. Treat errors as versioned contract data: stable machine codes, safe human
   detail, one envelope everywhere. A client must distinguish validation,
   conflict, auth, absence, and server failure without parsing prose.
4. Make retryable mutations idempotent; define key identity, scope, retention,
   and conflict behavior. Bound every collection with pagination, ordering, and
   filter limits.
5. Authenticate at the edge, authorize each action and object server-side, and
   set rate/abuse limits separately.
6. Evolve additively. A breaking change needs a version, migration path,
   deprecation window, and observability so old and new clients overlap.

Use `change-impact-analysis` for unverified consumer assumptions.

## Harness

Record the public contract, compatibility window, and failure cases in the
active OpenSpec change; project contract/integration providers prove it through
the harness. No parallel API document; Build never stages or commits.

## References

- `references/resource-modeling.md` — URL conventions, protocol choice, status codes
- `references/contracts-and-errors.md` — schema boundary, error envelope, authn/authz and rate limits at the edge
- `references/evolution.md` — idempotency keys, pagination, versioning, deprecation
