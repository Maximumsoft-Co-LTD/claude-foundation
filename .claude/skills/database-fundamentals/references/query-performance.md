# Query performance

Run `EXPLAIN ANALYZE` before you guess. Plain `EXPLAIN` shows estimates,
which are often wrong.

## Reading the plan

A Postgres plan reads bottom-up: leaf nodes fetch data, each parent processes
its children, the top node returns to the client.

```
Limit  (cost=0..1.50 rows=20) (actual time=0.05..0.06 rows=20 loops=1)
  ->  Index Scan using orders_user_status_placed_idx on orders
        Index Cond: (user_id = $1 AND status = 'paid')
```

- **Operator:** Index Only Scan (cheapest) → Index Scan → Bitmap Heap Scan →
  Seq Scan (problematic on large tables with a selective `WHERE`).
- **`actual rows` vs `rows`:** a 100× mismatch means stale statistics; run
  `ANALYZE <table>`.
- **`loops`:** a nested loop's inner time is per iteration; total is
  `time × loops`.
- **`Rows Removed by Filter`:** a million removed means a million scanned;
  the index did not narrow them.

A Seq Scan on a million-row table with a selective filter means a missing
index, or one the planner cannot use (often a type mismatch such as
`WHERE user_id = '5'` against `BIGINT`).

## N+1: fetch in sets, not loops

One query returning 1,000 rows is cheap; 1,000 queries returning one row is
1,000× slower. ORMs hide it behind attribute access.

```ts
// Bad — one query per user
for (const u of users) u.orders = await db.orders.find({ userId: u.id })

// Good — one batched query and an in-memory join
const orders = await db.orders.find({ userId: { in: users.map(u => u.id) } })
const byUser = groupBy(orders, o => o.userId)
for (const u of users) u.orders = byUser.get(u.id) ?? []
```

Every ORM has the word: Prisma/Sequelize `include`, Rails `includes`,
SQLAlchemy `joinedload`/`selectinload`, Django `select_related`/
`prefetch_related`, Hibernate `JOIN FETCH`. For graph fetches across many
call sites use a dataloader. Detect with a per-request query counter or
`pg_stat_statements`: an N+1 is a tiny query fired hundreds of thousands of
times.

## Pagination: keyset over offset

`OFFSET 10000 LIMIT 20` fetches and discards 10,000 rows. Keyset uses the
last seen sort key as the cursor and costs the same on every page:

```sql
SELECT * FROM orders
WHERE user_id = $1 AND (placed_at, id) < ($last_placed_at, $last_id)
ORDER BY placed_at DESC, id DESC LIMIT 20;      -- index (user_id, placed_at DESC, id DESC)
```

No "jump to page N"; use offset only for small, bounded admin grids.

## Overfetching and counting

`SELECT *` wastes network, prevents Index Only Scan, and serializes blobs
nobody reads; project the columns you use. `COUNT(*)` on a large table is
`O(rows)`: show "1000+" with `LIMIT 1000`, read `reltuples` from `pg_class`
for an estimate, maintain a counter, or count a small indexed slice.

## The slow-query diagnostic flow

1. `EXPLAIN ANALYZE` the exact query with realistic parameters.
2. Find the largest cumulative `actual time`.
3. Classify: Seq Scan + selective `WHERE` → missing index; Sort after Index
   Scan → index lacks the `ORDER BY` column; Nested Loop with high `loops` →
   N+1 as a join; big `Rows Removed by Filter` → wrong index shape;
   `actual rows` ≫ estimate → run `ANALYZE`.
4. Propose one change, apply, re-explain.
5. Watch `pg_stat_statements` after deploy; dev data hides skew.

## Pitfalls

Implicit type casts in `WHERE`; `OR` across columns (use two indexes or a
`UNION`); functions on indexed columns (use an expression index or store the
normalized form); `NOT IN` with NULLs (use `NOT EXISTS`); leading-wildcard
`LIKE`; `LIMIT` without `ORDER BY`.
