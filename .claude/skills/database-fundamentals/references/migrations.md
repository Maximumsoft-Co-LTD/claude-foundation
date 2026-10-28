# Migrations

A migration runs against a live database while old application instances
are still running. The schema is a public API; every migration must be safe
with the old code still pointing at it. Ship the schema change first, the
code that depends on it next, never both in one deploy.

## What is safe and what is never one step

| Change | Safe? |
|---|---|
| Add a table or a nullable column | safe; old code ignores it |
| Add an index | safe for data, but lock-aware (`CONCURRENTLY`) |
| Rename a column | never one step: old code errors on the spot |
| Drop a column | never one step: old code may still write it |
| Change a column type | risky: expand with a new column instead |
| Add `NOT NULL` or a `CHECK` to an existing column | every row must satisfy it first |

## Expand → backfill → switch → contract

```sql
-- Migration 1 (expand)
ALTER TABLE users ADD COLUMN display_name TEXT;
-- Code deploy 1: write both columns, read full_name
-- Migration 2 (backfill)
UPDATE users SET display_name = full_name WHERE display_name IS NULL;
-- Code deploy 2: read display_name; still write both
-- Code deploy 3: stop writing full_name
-- Migration 3 (contract)
ALTER TABLE users DROP COLUMN full_name;
```

Four deploys for a rename, or one `RENAME` that takes production down during
rollout.

Adding a `NOT NULL` column on a large table: add it nullable (a constant
default is metadata-only on Postgres 11+), backfill in batches, then
`ADD CONSTRAINT ... CHECK (col IS NOT NULL) NOT VALID` followed by
`VALIDATE CONSTRAINT`, which checks existing rows under a weaker lock than
`SET NOT NULL`.

## Locking-aware DDL

**Postgres:** `CREATE INDEX` blocks writes; always `CREATE INDEX
CONCURRENTLY` (and `DROP INDEX CONCURRENTLY`). `ADD COLUMN ... DEFAULT
<constant>` is instant; `DEFAULT <expression>` rewrites the table under
`ACCESS EXCLUSIVE`. `SET NOT NULL` and `ADD FOREIGN KEY` scan the table; use
the `NOT VALID` / `VALIDATE` split.

**MySQL/InnoDB:** most `ALTER TABLE` on a large table needs an online
schema-change tool (`pt-online-schema-change`, `gh-ost`, or Spirit); they
build a shadow copy, sync writes, and swap. `ALGORITHM=INPLACE, LOCK=NONE`
covers some changes, not all.

## Long-running backfills

A 50M-row `UPDATE` in one transaction bloats WAL, blocks `VACUUM`, holds
locks, and redoes everything on failure. Batch, and sleep between batches so
replicas catch up:

```sql
WITH batch AS (
  SELECT id FROM orders WHERE currency IS NULL LIMIT 10000 FOR UPDATE SKIP LOCKED
)
UPDATE orders SET currency = 'USD' WHERE id IN (SELECT id FROM batch);
```

## Migration files

Use a framework (Flyway, Alembic, golang-migrate, Prisma Migrate, Rails,
Django). Migrations are numbered, applied once in order, forward-only in
production (fix a bad deploy with a new forward migration, not `down`), one
logical change each, and code-reviewed like any risky change.

When the new shape lives in another system, dual-write: write both and read
old → backfill → verify new matches old → switch reads → stop writing old →
decommission.

## Checklist before merging a migration

1. Strictly additive? If not, is it expand → backfill → contract across
   deploys?
2. For DDL on a large table: which lock, for how long; `CONCURRENTLY` or
   `NOT VALID`/`VALIDATE`?
3. Is every backfill batched?
4. Does the currently deployed code still work against the post-migration
   schema?
5. Does the migration avoid depending on application data shape (such as
   JSON contents)?
6. Has someone else read it?
