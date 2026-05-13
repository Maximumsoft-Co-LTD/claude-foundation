# Transactions

A transaction is a unit of work that the database treats as atomic: it either fully happens or fully doesn't. Inside the transaction, the work is also (to some degree) isolated from other concurrent work. Both properties — atomicity and isolation — have costs, and the cost compounds as the transaction stays open.

## ACID, in one paragraph each

- **Atomicity** — all the statements between `BEGIN` and `COMMIT` succeed together, or none of them take effect. A crash mid-transaction rolls back to the state before `BEGIN`.
- **Consistency** — committed state respects the constraints declared on the schema (`NOT NULL`, `UNIQUE`, `CHECK`, foreign keys). Often the "C" people care least about, because it's enforced by the schema, not by the transaction mechanism.
- **Isolation** — concurrent transactions don't see each other's intermediate state. The strength of this guarantee depends on the isolation level — see below.
- **Durability** — once `COMMIT` returns, the change survives a crash. The database flushes the change to disk before acknowledging.

## Isolation levels and anomalies

The SQL standard defines four levels. Each prevents some anomalies and allows others. Knowing your level — and what it lets slip — is the difference between correct and "mostly correct."

| Level              | Dirty read | Non-repeatable read | Phantom read | Lost update | Serialization anomaly |
|--------------------|------------|---------------------|--------------|-------------|----------------------|
| `READ UNCOMMITTED` | Possible   | Possible            | Possible     | Possible    | Possible             |
| `READ COMMITTED`   | Prevented  | Possible            | Possible     | Possible    | Possible             |
| `REPEATABLE READ`  | Prevented  | Prevented           | Possible*    | Prevented*  | Possible             |
| `SERIALIZABLE`     | Prevented  | Prevented           | Prevented    | Prevented   | Prevented            |

*Postgres `REPEATABLE READ` prevents phantoms and lost updates (it uses snapshot isolation). MySQL InnoDB `REPEATABLE READ` prevents phantoms via gap locks but its handling of write-write conflicts differs. Check your engine's docs — the SQL standard is loose.

**The anomalies, in plain language:**
- **Dirty read** — you see another transaction's uncommitted write. Almost never enabled in practice.
- **Non-repeatable read** — you read row X, do some work, read row X again in the same transaction, and the value changed because someone else committed in between.
- **Phantom read** — you `SELECT * WHERE status = 'pending'` twice in the same transaction and get different rows because another transaction inserted (or deleted) a matching row.
- **Lost update** — two transactions both read a value, both compute a new value based on it, both write. One write is silently overwritten. **The most common bug in real systems.**
- **Serialization anomaly** — the result of running concurrent transactions is something no serial order could produce. Real but subtle; relevant for complex multi-row invariants.

## Defaults you should memorize

- **Postgres:** `READ COMMITTED`. Allows lost updates. Use `FOR UPDATE` or `REPEATABLE READ` when you need to protect a read-modify-write.
- **MySQL InnoDB:** `REPEATABLE READ`. Stronger than Postgres's default, but still has some lost-update edge cases on write-skew patterns.
- **SQLite:** `SERIALIZABLE` (effectively — only one writer at a time). Strong, but throughput is limited.
- **DynamoDB / most cloud KV stores:** per-item atomicity only; multi-item transactions are an explicit opt-in with sharp limits.

## The lost-update problem

This is the bug to internalize. It's not theoretical — it shows up the first time two users hit the same screen at the same time.

```sql
-- T1                                            -- T2
BEGIN;                                            BEGIN;
SELECT balance FROM accounts WHERE id=1; -- 100   SELECT balance FROM accounts WHERE id=1; -- 100
-- app computes: 100 - 30 = 70                    -- app computes: 100 - 50 = 50
UPDATE accounts SET balance=70 WHERE id=1;        UPDATE accounts SET balance=50 WHERE id=1;
COMMIT;                                           COMMIT;

-- Final balance: 50. The $30 withdrawal vanished.
```

Three fixes, in order of preference:

### Fix 1: SQL-level atomic update (best when you can)

If the new value is a function of the old value, write it as one statement. The DB locks the row implicitly.

```sql
UPDATE accounts SET balance = balance - 30 WHERE id = 1;
```

Two concurrent decrements serialize automatically. No application-level read-then-write.

### Fix 2: Pessimistic row lock

When the new value depends on logic the database can't express, lock the row for the duration of the transaction.

```sql
BEGIN;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;
-- T2 trying the same SELECT FOR UPDATE waits here until T1 commits.
-- ... compute new value ...
UPDATE accounts SET balance = $new WHERE id = 1;
COMMIT;
```

Simple, blocks readers-who-want-to-write. Risk: deadlocks if multiple rows are locked in different orders. Always lock rows in a deterministic order (e.g., by id ascending) when locking more than one.

### Fix 3: Optimistic concurrency (version column)

Add a `version` column. Read it, then write only if it hasn't changed.

```sql
UPDATE accounts
SET balance = $new, version = version + 1
WHERE id = 1 AND version = $expected_version;
```

Check the affected-row count. If zero, someone else updated first — reload, recompute, retry. Good when conflicts are rare (most reads never collide); bad under high contention (lots of retries).

## Common patterns

### Idempotency keys

For "exactly once" semantics across retries (payment processing, message delivery), store the idempotency key in the same transaction as the work:

```sql
INSERT INTO charges (id, idempotency_key, amount, status)
VALUES ($1, $2, $3, 'pending');
-- ON CONFLICT (idempotency_key) DO NOTHING — second call returns no row inserted
```

The `UNIQUE` index on `idempotency_key` is the guarantee. The application-level `if (exists) return` check is the race window.

### SELECT ... FOR UPDATE SKIP LOCKED (job queues)

The poor-person's job queue, when you don't want to bring in Redis or Kafka:

```sql
SELECT id, payload FROM jobs
WHERE status = 'pending'
ORDER BY id
LIMIT 1
FOR UPDATE SKIP LOCKED;
```

Each worker grabs an unlocked row and skips ones held by other workers. Cheap, durable, no separate broker. Doesn't scale to millions of jobs per second, but for ~thousands per minute it's perfect.

### Transactional outbox

The dual-write problem: you `UPDATE` a row *and* publish a Kafka message. Either can succeed without the other. The fix:

1. In one DB transaction, write the row change *and* an `outbox` row containing the message.
2. A separate process polls the `outbox` table and publishes to Kafka, deleting after ack.

Now both changes commit atomically; the broker publish is async but guaranteed eventually-delivered.

## Pitfalls

- **Holding a transaction open across user input or external HTTP.** A locked row plus a 30-second HTTP timeout equals 30 seconds of every other writer blocked. Load data → close transaction → call external service → reopen transaction if needed → commit.
- **The "long-running read" trap.** A `SELECT` inside an open transaction in Postgres holds the snapshot, which blocks `VACUUM` from cleaning up dead rows. Run analytical queries outside of transactional code paths, or use a read replica.
- **Deadlocks from inconsistent lock order.** Two transactions lock rows in opposite order → both wait → DB kills one. Always lock multiple rows in the same deterministic order (e.g., by id ascending).
- **Transactions don't compose across services.** If your "transaction" spans two microservices' databases, you don't have a transaction — you have an eventually-consistent saga. Acknowledge it and design failure compensation.
- **`autocommit` is on by default in most drivers.** Without an explicit `BEGIN`, each statement commits on its own. Multi-statement workflows need explicit transactions — don't assume the driver groups them.

## Quick decision guide

- Single statement that touches one row → no transaction needed (autocommit is fine).
- Multiple statements that must succeed or fail together → wrap in a transaction.
- Read-modify-write on a shared row → atomic SQL if possible, else `FOR UPDATE`, else version column.
- Multi-row invariants under concurrency → `SERIALIZABLE` isolation, or restructure to avoid the invariant.
- Cross-service consistency → saga / outbox, not a transaction.
