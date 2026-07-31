---
name: api-design-fundamentals
description: Apply API-design fundamentals before changing a published HTTP, GraphQL, or RPC contract. Covers resource language, semantics, request/response validation, errors, idempotency, pagination, authorization boundaries, and compatibility. Skip private one-off transport with no contract impact.
---

# API design fundamentals

Use this as the primary skill when clients must code against the changed
surface.

## Rules

1. Model resources and domain language, not controller or RPC verbs.
2. Use protocol semantics honestly: methods, status, caching, and safety must
   match behavior.
3. Define request and response schemas, defaults, limits, and validation at the
   boundary. Do not expose persistence models.
4. Treat errors as versioned contract data with stable machine codes and safe
   human detail.
5. Make retryable mutations idempotent and define the identity, scope,
   retention, and conflict behavior of idempotency keys.
6. Bound collections from day one; define pagination ordering, cursors,
   filtering, and limits.
7. Authenticate at the edge and authorize each action/object server-side.
   Define rate and abuse limits separately.
8. Prefer additive evolution. Breaking changes require versioning, migration,
   observability, and a deprecation window.

## Check before finishing

- Can a client distinguish validation, conflict, auth, absence, and server
  failure without parsing prose?
- Are retries, duplicates, concurrent updates, and partial results defined?
- Does every identifier expose only authorized objects?
- Can old and new clients overlap safely?

References: `references/resource-modeling.md`, `contracts-and-errors.md`,
`auth-and-limits.md`, and `evolution.md`. Read only the matching file.
