---
name: database-fundamentals
description: Apply database fundamentals — schema design and types, constraints as invariants, indexes that match queries, reading the query plan, avoiding N+1, transactions and isolation, safe migrations. Use BEFORE designing a table, writing a non-trivial query, adding an index or migration, debugging a slow query, or modeling persistent data; also on repository/adapter work where domain state crosses into storage. The trigger is real database work (schema, SQL, EXPLAIN, deadlock, N+1, ORM), even when no principle is named. Skip throwaway scripts and one-off ad-hoc queries.
---

# Database Fundamentals

## The 7 principles

Assumes relational DB (Postgres, MySQL, SQLite) by default; underlying ideas apply broadly. Run order vs sibling skills (`programming-fundamentals`, `hexagonal-backend`, and the rest of the chain) is owned by the always-on router `.claude/rules/fundamentals.md`.

Full rule/why/how-to-apply/example for each lives in the linked reference file.

| # | Principle | Compressed rule | Reference |
|---|---|---|---|
| 1 | Model the data first | Decide the data's shape before the queries. Honest types (money as integer/decimal, timestamps as `TIMESTAMPTZ`), start normalized, denormalize only when a query forces it. | `references/schema-design.md` |
| 2 | Constraints are invariants — push them into the schema | Every "always true" the app assumes should be `NOT NULL`, `UNIQUE`, a foreign key, or `CHECK` in the DB — constraints protect every writer forever, app checks get forgotten. | `references/schema-design.md` |
| 3 | Indexes match queries, not tables | Index for the `WHERE`/`JOIN`/`ORDER BY` you actually run. Composite indexes are ordered (leftmost prefix); don't index every column — writes pay the cost. | `references/indexing.md` |
| 4 | Read the query plan before you guess | Run `EXPLAIN ANALYZE` before deciding a query is slow or adding an index. Compare estimated vs actual rows; read from the bottom up. | `references/query-performance.md` |
| 5 | Fetch in sets, not loops (N+1 is the bug that hides everywhere) | Fetch data for many things in one query, not one query per thing. Join, batch-fetch by IDs, or dataloader; ORMs hide N+1 via lazy-loading. | `references/query-performance.md` |
| 6 | Transactions: keep them short, know your isolation level | Wrap multi-step writes atomically; open → work → commit, never waiting on external I/O inside. Know your isolation level's anomalies (lost updates under `READ COMMITTED`). | `references/transactions.md` |
| 7 | Migrations are forward-only contracts — expand → backfill → contract | A migration runs against a live DB with old code still pointing at it. Expand (additive) → backfill → deploy new code → contract (drop old shape) in a later release. | `references/migrations.md` |

## Pre-flight checklist

Before writing schema, a non-trivial query, or a migration, run through these in your head:

1. **Data shape:** are the types honest (money in integer/decimal, timestamps as `TIMESTAMPTZ`, ids consistent)? Is the schema normalized, with one fact per place?
2. **Constraints:** is every "the app always guarantees X" expressed as `NOT NULL`, `UNIQUE`, foreign key, or `CHECK`? Could a future bug or backfill script break the invariant by writing directly?
3. **Indexes:** for the hot queries, is there an index whose leftmost columns match the `WHERE` (and ideally also the `ORDER BY`)? Is every foreign key indexed?
4. **Plan:** for a non-obvious query, have I run `EXPLAIN ANALYZE`? Is the planner using the index I think it is? Are estimates close to actuals?
5. **N+1:** does any loop call the database inside it? Can I batch with an `IN`, a `JOIN`, or an eager-load?
6. **Transactions:** is the multi-step write wrapped? Is the transaction short? Is read-modify-write protected against lost updates (row lock or version column)?
7. **Migration safety:** can the running old code survive this change? If renaming/dropping/tightening a constraint, am I doing it in an expand → backfill → contract sequence?

If any answer is "I don't know," stop and find out before writing.

## When to skip this skill

- One-off ad-hoc queries on a local DB.
- Throwaway scripts and prototypes.
- Pure config edits (connection strings, env vars).
- Trivial reads on a known-good schema.

## Reference files

- `references/schema-design.md` — data shape, honest types, normalization, relationship shapes, `ON DELETE` actions, the NoSQL note; principles 1 and 2's full rule/why/how-to-apply/example.
- `references/indexing.md` — composite ordering, leftmost prefix, covering / index-only scans, partial indexes, when **not** to index, finding unused indexes; principle 3's full rule/why/how-to-apply/example.
- `references/query-performance.md` — reading `EXPLAIN ANALYZE`, N+1 fixes, keyset vs offset pagination, `COUNT(*)` and `SELECT *` pitfalls, the slow-query diagnostic flow; principles 4 and 5's full rule/why/how-to-apply/example.
- `references/transactions.md` — ACID, isolation levels and the anomalies table, optimistic vs pessimistic locking, common patterns, deadlocks; principle 6's full rule/why/how-to-apply/example.
- `references/migrations.md` — expand → backfill → contract sequences for renames / type changes / NOT NULL / dropping columns, lock-aware migrations, `CREATE INDEX CONCURRENTLY`, online schema-change tools; principle 7's full rule/why/how-to-apply/example.
