# Indexing

Index for the queries you run, not the tables you have. Every index taxes
every write.

## The two rules that catch most engineers

**Leftmost prefix.** A composite index on `(a, b, c)` serves filters on `a`,
`a AND b`, `a AND b AND c`, never `b` or `c` alone. Put the most-filtered,
most-selective column first: `(tenant_id, status)`, rarely `(status,
tenant_id)`.

**Range filters consume the rest.** Once the index hits `<`, `>`,
`BETWEEN`, or `LIKE 'foo%'`, columns to the right narrow nothing more.
Equality first, range last.

```sql
SELECT * FROM orders WHERE user_id = $1 AND status = $2 ORDER BY placed_at DESC LIMIT 20;

CREATE INDEX ON orders (user_id);                          -- usable, sorts in memory
CREATE INDEX ON orders (user_id, status);                  -- matches WHERE, still sorts
CREATE INDEX ON orders (user_id, status, placed_at DESC);  -- filter and order, no sort step
```

## Covering, partial, and other index types

- **Covering:** `INCLUDE (total_cents, id)` lets the query answer from the
  index alone (Index Only Scan). Cover hot read paths only; every included
  column inflates size and write cost.
- **Partial:** `CREATE INDEX ON users (created_at) WHERE status =
  'suspended'` indexes the 1% you query; `CREATE UNIQUE INDEX ON users
  (email) WHERE deleted_at IS NULL` makes uniqueness conditional for
  soft-delete.
- **Types:** B-tree by default (equality, range, order); GIN for full-text,
  JSONB containment, array membership; GiST for geometric and nearest-
  neighbor; BRIN for append-only data physically ordered by the column.

## Foreign keys need indexes

Postgres does not index `REFERENCES` columns automatically (InnoDB does).
Without `CREATE INDEX ON order_items (order_id)`, a parent delete scans the
child table while holding locks.

## When not to add an index

Small tables (the planner ignores it); low-selectivity columns alone (use
composite or partial); heavy-write, rarely-read columns; before measuring.

## Find unused indexes (Postgres)

```sql
SELECT indexrelname, pg_size_pretty(pg_relation_size(i.indexrelid)) AS size, idx_scan
FROM pg_stat_user_indexes i JOIN pg_index USING (indexrelid)
WHERE idx_scan = 0 AND NOT indisunique
ORDER BY pg_relation_size(i.indexrelid) DESC;
```

Confirm no infrequent batch job uses it before dropping.

## Diagnostic flow

1. Find the slow query (`pg_stat_statements`, slow query log).
2. `EXPLAIN ANALYZE` it with realistic parameters.
3. Identify the seq scan or sort that costs the most.
4. Propose an index: equality columns, then range/order columns, then
   included columns if covering helps.
5. `CREATE INDEX CONCURRENTLY` on large tables.
6. Re-explain; confirm the planner uses it and actual time dropped. Drop
   indexes that did not help.
