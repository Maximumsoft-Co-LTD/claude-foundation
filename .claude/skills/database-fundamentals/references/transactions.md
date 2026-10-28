# Transactions

Wrap multi-step writes so they succeed or fail together; keep transactions
short; know which anomalies your isolation level still allows. The unit is
one request, one use case, one event handler, never a user session. Never
wait on external I/O inside an open transaction: load → close → call out →
reopen → commit.

## Isolation levels and anomalies

| Level | Dirty read | Non-repeatable read | Phantom | Lost update |
|---|---|---|---|---|
| `READ UNCOMMITTED` | possible | possible | possible | possible |
| `READ COMMITTED` | prevented | possible | possible | possible |
| `REPEATABLE READ` | prevented | prevented | engine-dependent | engine-dependent |
| `SERIALIZABLE` | prevented | prevented | prevented | prevented |

The engines disagree on `REPEATABLE READ`:

- **Postgres** (default `READ COMMITTED`): its `REPEATABLE READ` is snapshot
  isolation and prevents lost updates by aborting the second committer with
  `40001`; `SERIALIZABLE` (SSI) also detects read-write conflicts across
  rows. Abort-and-retry is often cleaner than row locks for short
  transactions.
- **MySQL InnoDB** (default `REPEATABLE READ`): next-key locks prevent most
  phantoms but lost updates on read-modify-write still happen; take a row
  lock or move to `SERIALIZABLE`.
- **SQLite:** effectively `SERIALIZABLE`, one writer at a time.

**Lost update** is the most common bug in real systems: two transactions
read 100, one writes 70, the other writes 50, and a withdrawal vanishes.

## Three fixes, in order of preference

```sql
-- 1. Atomic SQL: the DB locks the row implicitly
UPDATE accounts SET balance = balance - 30 WHERE id = 1;

-- 2. Pessimistic row lock: blocks other writers until commit
BEGIN;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;
UPDATE accounts SET balance = $new WHERE id = 1;
COMMIT;

-- 3. Optimistic version: detect and retry when conflicts are rare
UPDATE accounts SET balance = $new, version = version + 1
WHERE id = 1 AND version = $expected_version;   -- zero rows affected → reload, retry
```

When locking several rows, lock them in a deterministic order (by id) to
avoid deadlocks. Optimistic wins when conflicts are rare; pessimistic when
retrying costs more than waiting.

## Common patterns

- **Idempotency keys:** `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`
  in the same transaction as the work; the unique index is the guarantee, an
  application-level existence check is the race window.
- **Upserts:** `INSERT ... ON CONFLICT` (or MySQL `ON DUPLICATE KEY UPDATE`)
  for single-row OLTP; `MERGE` for bulk apply, with a retry loop because it
  can raise `40001` under concurrent writes.
- **Job queue:** `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` lets workers
  claim unlocked rows; fine for thousands of jobs a minute.
- **Transactional outbox:** write the row change and an `outbox` row in one
  transaction; a relay publishes later (`queue-fundamentals`).

## Pitfalls

- Holding a transaction across user input or external HTTP: one locked row
  plus a 30 s timeout blocks every other writer.
- Long-running reads inside a transaction hold the snapshot and block
  `VACUUM`; run analytics on a replica.
- Transactions do not compose across services; a cross-service "transaction"
  is a saga with compensation.
- `autocommit` is on by default in most drivers; multi-statement workflows
  need an explicit `BEGIN`.

## Quick decision guide

Single statement on one row → autocommit. Several statements that must
succeed together → transaction. Read-modify-write on a shared row → atomic
SQL, else `FOR UPDATE`, else version column. Multi-row invariants under
concurrency → `SERIALIZABLE` or restructure. Cross-service consistency →
saga or outbox.
