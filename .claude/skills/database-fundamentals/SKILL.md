---
name: database-fundamentals
description: Apply database fundamentals — schema design and types, constraints as invariants, indexes that match queries, reading the query plan, avoiding N+1, transactions and isolation, safe migrations. Use BEFORE designing a table, writing a non-trivial query, adding an index or migration, debugging a slow query, or modeling persistent data; also on repository/adapter work where domain state crosses into storage. The trigger is real database work (schema, SQL, EXPLAIN, deadlock, N+1, ORM), even when no principle is named. Skip throwaway scripts and one-off ad-hoc queries.
---

# Database Fundamentals

## The 7 principles

Assumes relational DB (Postgres, MySQL, SQLite) by default; underlying ideas apply broadly. Run order vs sibling skills (`programming-fundamentals`, `hexagonal-backend`, and the rest of the chain) is owned by the always-on router `.claude/rules/fundamentals.md`.

---

### 1. Model the data first

**Rule:** Decide the shape of the data before you decide the queries. Pick types that match the domain, and start in a normalized shape. Denormalize only when a query forces it, not as a default.

**Why:** The schema outlives the code. A wrong type (`FLOAT` for money, `VARCHAR` for timestamps) queues a year of bugs; duplicated facts make every update a race.

**How to apply:**
- Choose types that match the domain. Money is integer cents (or `NUMERIC`/`DECIMAL`), **never** `FLOAT` or `DOUBLE` — floating point loses pennies. Dates and timestamps are `DATE` / `TIMESTAMPTZ`, never strings. Identifiers have a single canonical type used everywhere they appear.
- Start in 3rd normal form: every non-key column depends on the key, the whole key, and nothing but the key. One fact lives in one place.
- Recognize relationship shapes and model them honestly. 1:1 collapses into one row (or a true 1:1 with a shared key). 1:N is a foreign key on the many side. N:N needs a join table — never a comma-separated string column.
- Use `TIMESTAMPTZ` (Postgres) or UTC `TIMESTAMP` for any moment-in-time. Store wall-clock local time only when you genuinely mean "a clock on a wall in some city" (e.g., a recurring 9 AM reminder in the user's timezone), and store the zone alongside.
- Reserve `JSON`/`JSONB` for genuinely schemaless or rarely-queried payloads. The moment you find yourself indexing or filtering inside a JSON blob frequently, those fields want to be real columns.

**Example:**
```sql
-- Awkward — three different schemas hiding in one table
CREATE TABLE orders (
  id           TEXT PRIMARY KEY,            -- sometimes uuid, sometimes integer
  user_id      VARCHAR(255),                -- type mismatches users.id
  total        FLOAT,                       -- loses pennies
  placed_at    VARCHAR(50),                 -- "2025-01-04T..."  string sort, no validation
  line_items   TEXT                         -- comma-separated SKUs
);

-- Better — domain shape, honest types, real relationships
CREATE TABLE orders (
  id           UUID PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id),
  total_cents  BIGINT NOT NULL,
  currency     CHAR(3) NOT NULL,
  placed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku          TEXT NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (order_id, sku)
);
```

---

### 2. Constraints are invariants — push them into the schema

**Rule:** Every invariant the application "always" guarantees should also be a constraint in the database. `NOT NULL`, `UNIQUE`, foreign keys, `CHECK` constraints — use all of them.

**Why:** [[programming-fundamentals]] "make illegal states unrepresentable" at the storage layer. The application will have a bug; a future script will write the same tables. Constraints protect every writer forever; application checks get forgotten. A unique index is the **only** way to enforce uniqueness across concurrent writers — `SELECT then INSERT` has a race window.

**How to apply:**
- Default every column to `NOT NULL`. A nullable column is a claim that "missing" is a meaningful value for this field. If you can't explain what `NULL` means here in business terms, the column should be `NOT NULL`.
- Foreign keys on every reference. They cost a tiny bit on write; they pay it back forever in dangling-row bugs you never have to debug.
- `UNIQUE` for any field a human might think of as identifying (`email`, `slug`, `(tenant_id, name)`). Don't enforce uniqueness only in application code.
- `CHECK` constraints encode invariants that have a closed form: `CHECK (quantity > 0)`, `CHECK (status IN ('pending','paid','refunded'))`, `CHECK (ended_at IS NULL OR ended_at >= started_at)`.
- Use `ON DELETE` actions deliberately. `CASCADE` for genuinely owned children (order → order_items). `RESTRICT` (the default) for references that should block deletion (you cannot delete a user with open invoices). `SET NULL` only when null genuinely means "the parent is gone but the child remains."

**Example:**
```sql
-- Bad — schema says nothing about the domain rules; app has to remember everything
CREATE TABLE subscriptions (
  id          UUID,
  user_id     UUID,
  plan        TEXT,
  started_at  TIMESTAMPTZ,
  ended_at    TIMESTAMPTZ,
  trial_days  INTEGER
);

-- Good — the schema enforces what "well-formed subscription" means
CREATE TABLE subscriptions (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan        TEXT NOT NULL CHECK (plan IN ('basic','pro','enterprise')),
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ CHECK (ended_at IS NULL OR ended_at > started_at),
  trial_days  INTEGER NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  UNIQUE (user_id, plan, started_at)   -- can't double-subscribe the same plan
);
```

NoSQL note: most document stores don't give you foreign keys or rich `CHECK` constraints. That doesn't make the invariant go away — it just means the application owns more of the enforcement, and you accept the cost (orphan documents, drift across collections, manual cleanup). If the data is truly relational, prefer a relational store.

---

### 3. Indexes match queries, not tables

**Rule:** Index for the queries you actually run. Composite indexes are ordered — the column order matters. Don't index every column; writes pay the cost.

**Why:** The right index turns O(n) scans into O(log n); every index taxes every write. Right indexes turn 10s into 10ms; wrong ones slow writes with no read benefit.

**How to apply:**
- Read the `WHERE`, `JOIN`, and `ORDER BY` clauses of your hottest queries. Those columns — together — are your index candidates.
- A composite index on `(a, b, c)` accelerates queries that filter on `a`, or `a AND b`, or `a AND b AND c`. It does **not** help a query that filters only on `b` or only on `c`. The leftmost prefix rule. Put the most-filtered column first.
- High-selectivity columns (`user_id`, `email`) benefit more from indexing than low-selectivity ones (`status` with three values, `is_active` boolean) — for low-selectivity, prefer composite or partial indexes.
- A foreign key column should almost always be indexed. The database does not index `REFERENCES` columns for you automatically (Postgres doesn't; MySQL InnoDB does). Without it, deletes/updates on the referenced parent scan the child table.
- Index on what the query already filters by, not on what feels important. `created_at` is rarely the right index unless you actually order by or filter on it.
- See `references/indexing.md` for composite ordering, covering indexes, partial indexes, when not to index, and how to find unused indexes.

**Example:**
```sql
-- Query: list a user's recent orders for a given status
SELECT * FROM orders
WHERE user_id = $1 AND status = $2
ORDER BY placed_at DESC
LIMIT 20;

-- Bad — single-column index, can use it but still sorts in memory
CREATE INDEX ON orders (user_id);

-- Better — composite matches the WHERE; sort still happens
CREATE INDEX ON orders (user_id, status);

-- Best — index supports filter AND order, no sort step
CREATE INDEX ON orders (user_id, status, placed_at DESC);
```

---

### 4. Read the query plan before you guess

**Rule:** Before you decide a query is slow, before you add an index, before you "optimize" — run `EXPLAIN ANALYZE` and read the plan.

**Why:** Intuition is usually wrong. `EXPLAIN ANALYZE` shows what the planner actually chose and why. Optimizing without a plan is guessing.

**How to apply:**
- Use `EXPLAIN ANALYZE` (Postgres / MySQL 8) — runs the query and reports actual times and row counts. Plain `EXPLAIN` only shows the estimated plan, which is often wrong.
- Look for the operator type. `Seq Scan` on a large table is a red flag if you have a `WHERE`. `Index Scan` is good. `Index Only Scan` is best — the query is satisfied entirely from the index.
- Compare `rows=` estimated vs `actual rows=`. A 100x mismatch means the planner has stale statistics and is making bad decisions — `ANALYZE` the table or rebuild statistics.
- Look at the *bottom* of the plan first — that's where the data actually comes from. Costs and times accumulate upward.
- Don't optimize until you have a slow query in front of you with a plan to show why. "Premature optimization" applies to SQL too.
- See `references/query-performance.md` for reading plans, pagination patterns, and the slow-query diagnostic flow.

**Example:**
```sql
EXPLAIN ANALYZE
SELECT id, total_cents FROM orders
WHERE user_id = '...' AND status = 'paid'
ORDER BY placed_at DESC LIMIT 20;

-- Bad plan you want to NOT see:
-- Seq Scan on orders  (cost=0..100000 rows=200 actual rows=120)
--   Filter: (user_id = '...' AND status = 'paid')
--   Rows Removed by Filter: 1_000_000      ← scanned a million rows to find 120
-- → Add (user_id, status, placed_at DESC) index. Re-run. Confirm Index Scan.
```

---

### 5. Fetch in sets, not loops (N+1 is the bug that hides everywhere)

**Rule:** When you need data for many things, fetch it in one query, not one query per thing. The "loop and query" pattern is the most common database performance bug.

**Why:** [[programming-fundamentals]] complexity applied to I/O. One query returning 1000 rows is cheap; 1000 queries returning one row is 1000× slower. ORMs hide this via lazy-loading — `user.orders` fires a query per user unless you opt out.

**How to apply:**
- Whenever a function loops and calls the database inside the loop, stop. That's an N+1 candidate. Either join, or batch-fetch by IDs, or use a dataloader.
- ORM-side: every framework has the magic word. Sequelize `include`, Prisma `include`, Rails `includes`, SQLAlchemy `joinedload`/`selectinload`, Django `select_related`/`prefetch_related`, Hibernate `JOIN FETCH`, ActiveRecord `eager_load`. Learn the one for your stack and reach for it by default.
- Watch out for "looks like one query, actually N." `users.map(u => formatUser(u))` is fine. `users.map(u => formatUser(u, await getOrders(u.id)))` is N+1.
- For graph fetches across services, use the **dataloader pattern**: collect IDs during the request, fire one batch query, hand each consumer their slice.
- See `references/query-performance.md` for the specific N+1 patterns and fixes.

**Example:**
```ts
// Bad — N+1: one query for users, then one per user for orders
const users = await db.users.findAll()
for (const u of users) {
  u.orders = await db.orders.find({ userId: u.id })   // N queries
}

// Good — one query for users, one batched query for all orders
const users = await db.users.findAll()
const userIds = users.map(u => u.id)
const orders = await db.orders.find({ userId: { in: userIds } })  // 1 query
const ordersByUser = groupBy(orders, o => o.userId)
for (const u of users) u.orders = ordersByUser.get(u.id) ?? []

// Or, in one shot via the ORM
const users = await db.users.findAll({ include: { orders: true } })
```

---

### 6. Transactions: keep them short, know your isolation level

**Rule:** Wrap multi-step writes in a transaction so they succeed or fail together. Keep transactions short — open, do the work, commit. Know what isolation level you're running under and what anomalies it leaves possible.

**Why:** Open transactions hold locks, block writers, consume connections, and prevent vacuum — the longer they live, the worse. Isolation level determines which anomalies are possible: `READ COMMITTED` (Postgres default) allows lost updates — two transactions read the same value, both write, one silently clobbered.

**How to apply:**
- The unit of a transaction is "a thing that must succeed or fail atomically together." Usually that's one HTTP request, one use case, one event handler. Not "the whole user session."
- Never wait on external I/O (HTTP, message broker, user input) inside an open transaction. Load → close → call out → reopen if needed → commit.
- For read-modify-write on a shared row, choose one:
  - **Pessimistic:** `SELECT ... FOR UPDATE` locks the row until commit. Simple, blocks other readers-who-want-to-write.
  - **Optimistic:** add a `version` column or use `WHERE updated_at = $1`. On update, check the affected row count — if zero, someone else wrote first, retry or fail.
- Know your default *and that `REPEATABLE READ` means different things in different engines*. Postgres: `READ COMMITTED` by default; its `REPEATABLE READ` is snapshot isolation and prevents lost updates by aborting the second committer with error 40001. MySQL InnoDB: `REPEATABLE READ` by default; uses next-key locks to prevent phantoms but **still allows lost updates** on the read-modify-write pattern unless you take a row lock. SQLite: `SERIALIZABLE` (but it serializes everything).
- For balance transfers, inventory decrements, ticket bookings — anything where lost updates would be money or correctness — bump isolation to `SERIALIZABLE` or use explicit row locks. **Postgres `SERIALIZABLE` (SSI — Serializable Snapshot Isolation)** is a real first-class option: the engine detects read-write conflicts and aborts the offending transaction with 40001; your app retries. Often a cleaner answer than `SELECT FOR UPDATE` when transactions are short and the retry cost is small.
- See `references/transactions.md` for the anomalies table, lock types, and concrete patterns.

**Example:**
```sql
-- Bad — two transactions both read 100, both write 90, one decrement is lost
BEGIN;
SELECT balance FROM accounts WHERE id = $1;     -- 100
-- ... app subtracts 10 ...
UPDATE accounts SET balance = 90 WHERE id = $1;
COMMIT;

-- Good — row lock prevents the race
BEGIN;
SELECT balance FROM accounts WHERE id = $1 FOR UPDATE;   -- locks the row
UPDATE accounts SET balance = balance - 10 WHERE id = $1;
COMMIT;

-- Or optimistic: detect concurrent write and retry
UPDATE accounts SET balance = balance - 10, version = version + 1
WHERE id = $1 AND version = $expected_version;
-- If affected_rows == 0 → someone else updated first, reload and retry
```

---

### 7. Migrations are forward-only contracts — expand → backfill → contract

**Rule:** A migration runs against a live database under load with an old version of the application still pointing at it. Every migration must be safe to apply *while the old code is still running*. The pattern is: expand the schema (additive, backwards-compatible) → backfill data → deploy the new code → contract (drop the old shape) in a later release.

**Why:** "Easy" migrations take down production: renaming a column the running app reads, adding `NOT NULL` with null rows, `CREATE INDEX` without `CONCURRENTLY` — each locks or errors. A migration is a public API change; treat it that way.

**How to apply:**
- **Never** combine schema changes with code changes that depend on them in the same deploy. Ship the schema change first; ship the code that uses it next.
- **Rename a column:** add the new column → backfill → write to both → switch reads to new → stop writing to old → drop old. Multiple deploys. Never a single `ALTER COLUMN RENAME`.
- **Add a `NOT NULL` column:** add it nullable with a default → backfill existing rows → flip to `NOT NULL` once full. On Postgres 11+ a default on `ADD COLUMN` doesn't rewrite the table, but the `NOT NULL` flip still requires a full check; for big tables, use a `CHECK NOT VALID` then `VALIDATE`.
- **Add an index on a big table:** Postgres → `CREATE INDEX CONCURRENTLY`. MySQL → use `pt-online-schema-change` or `gh-ost` for anything large.
- **Drop a column:** ship code that stops reading and writing it first → then drop in a later release. Never drop a column the app still references.
- Migrations are versioned, ordered, and forward-only. You don't "down-migrate" production — you roll forward with a corrective migration.
- See `references/migrations.md` for the full expand-contract sequences and lock-aware migration patterns per engine.

**Example:**
```sql
-- Bad — single migration that breaks the running app
ALTER TABLE users RENAME COLUMN full_name TO display_name;
-- → all running app instances suddenly hit "column full_name does not exist"

-- Good — expand → backfill → contract over multiple deploys

-- Migration 1 (expand): add new column, sync from old
ALTER TABLE users ADD COLUMN display_name TEXT;
UPDATE users SET display_name = full_name WHERE display_name IS NULL;
-- (app code: writes to BOTH columns now; reads from full_name still)

-- Migration 2 (switch reads): app deploys reading display_name first
-- No schema change; only code change.

-- Migration 3 (stop writing old, drop): only after the new code is fully rolled out
ALTER TABLE users DROP COLUMN full_name;
```

---

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

- `references/indexing.md` — composite ordering, leftmost prefix, covering / index-only scans, partial indexes, when **not** to index, finding unused indexes.
- `references/transactions.md` — ACID, isolation levels and the anomalies table, optimistic vs pessimistic locking, common patterns, deadlocks.
- `references/query-performance.md` — reading `EXPLAIN ANALYZE`, N+1 fixes, keyset vs offset pagination, `COUNT(*)` and `SELECT *` pitfalls, the slow-query diagnostic flow.
- `references/migrations.md` — expand → backfill → contract sequences for renames / type changes / NOT NULL / dropping columns, lock-aware migrations, `CREATE INDEX CONCURRENTLY`, online schema-change tools.
