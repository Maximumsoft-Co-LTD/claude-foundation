---
name: database-fundamentals
description: "Use when workType includes data or migration, or a requirement touches a schema, query, index, transaction, or persisted file. Skip read-only analysis and measured slowness (use performance-investigation)."
---

# Database fundamentals

Keep data correct, migrations rerunnable, and old records readable.

## Steps

1. Model domain facts with precise types, nullability, keys, and normalized
   ownership. Denormalize only for a measured read path.
2. Put durable invariants in the schema: `NOT NULL`, `UNIQUE`, foreign keys,
   checks. Application validation improves errors but is not the final guard.
3. Design indexes from real predicates, joins, ordering, and cardinality. Read
   the query plan on representative data before claiming performance; prevent
   N+1 with batching, joins, or bounded preloading.
4. Draw the transaction boundary around one business invariant; pick the
   weakest isolation level that preserves it; handle retries explicitly.
5. Migrate compatibly: expand → backfill in bounded batches → switch → verify →
   contract. State lock, write-amplification, and rollback risk; old and new
   application versions must overlap during rollout.
6. Before deleting a field, use `change-impact-analysis`; local callers alone
   do not establish external compatibility.

## Harness

Record compatibility, backfill, lock/load risk, rollback, and the provider that
proves each data claim in the active OpenSpec change. A migration is never an
implicit deployment or a manual proof step; Build never stages or commits.

## References

- `references/schema-design.md` — modeling and constraints
- `references/indexing.md` — index selection and diagnosis
- `references/query-performance.md` — EXPLAIN, N+1, keyset pagination
- `references/transactions.md` — isolation levels, lost updates, patterns
- `references/migrations.md` — expand/backfill/contract and locking-aware DDL
