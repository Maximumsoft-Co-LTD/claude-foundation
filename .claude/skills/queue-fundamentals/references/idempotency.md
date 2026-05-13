# Idempotency patterns

Companion to principle 3 of [[queue-fundamentals]]. Use this when designing or fixing a consumer that has to survive at-least-once delivery, which is to say: every production consumer.

The whole skill rests on this: if duplicates can't break you, retries and redeliveries stop being dangerous, and most operational concerns become routine instead of critical.

## The three layers of idempotency

Reach for them in this order. The earlier layers are simpler and have fewer failure modes.

1. **Natural idempotency** — the operation is idempotent by construction.
2. **Conditional idempotency** — the operation is non-idempotent in general, but a conditional write makes the *repeat* a no-op.
3. **Keyed idempotency** — a side table records "this message ID already produced this effect," and the consumer checks it before acting.

When the operation reaches an external system (Stripe, SendGrid, an internal API), there's a fourth concern: passing the idempotency key *through* to that system so it doesn't double-act either.

## Layer 1: natural idempotency

**Definition:** `f(x) == f(f(x))`. Running the operation twice has the same observable effect as running it once.

**Examples:**
- `SET balance = 100` (idempotent) vs `balance += 5` (not).
- `INSERT ... ON CONFLICT (id) DO UPDATE` (idempotent on a stable id) vs blind `INSERT` (not — duplicates row or violates uniqueness).
- `tags = ['a', 'b', 'c']` (idempotent) vs `tags.append('a')` (not).
- "Send the user to onboarding state X" (idempotent) vs "advance the user one state" (not).

**How to lean into it:** when modeling state changes, prefer the absolute form to the relative form whenever the domain allows. "Set status to paid" is idempotent; "transition status from pending to paid" is too, with a condition (next layer). "Increment retry count" is not idempotent at all — model the desired state explicitly instead.

## Layer 2: conditional idempotency

**Definition:** the operation only takes effect if a condition still holds; on the second call the condition no longer holds and the operation no-ops.

**Pattern:**
```sql
-- Bad: blind update. Run twice, status overwritten twice (probably fine here,
--      but the pattern fails on operations that are visibly destructive).
UPDATE orders SET status = 'shipped' WHERE id = $1;

-- Good: conditional. Second call updates 0 rows, harmlessly.
UPDATE orders SET status = 'shipped'
WHERE id = $1 AND status = 'paid';
```

**Where this shines:**
- **State machines.** The next state is only reachable from the current state. Run the message twice and the second one has nothing to do.
- **Versioned writes.** Carry a version (`updated_at`, `seq`, `version`) on the message; apply only if the message's version is newer than what's stored. This also gives you out-of-order safety (principle 6).
- **Unique constraints.** A `UNIQUE (user_id, event_id)` constraint on a side-effects table turns the second `INSERT` into a constraint violation you can catch and treat as a duplicate.

**Worked example (Go) — versioned write:**
```go
// The message carries `Version`. We only apply if it's strictly newer.
result, err := db.ExecContext(ctx,
    `UPDATE users
       SET email = $1, version = $2, updated_at = $3
     WHERE id = $4 AND version < $2`,
    msg.Email, msg.Version, msg.UpdatedAt, msg.UserID,
)
if err != nil {
    return err
}
n, _ := result.RowsAffected()
if n == 0 {
    // Either the row doesn't exist (different bug) or a newer version is already
    // stored. Either way, this message is stale — drop it.
    return nil
}
return nil
```

## Layer 3: keyed idempotency

Use when the operation isn't naturally idempotent and you can't make it conditional. The cost is one extra table and a small amount of write amplification; the benefit is bulletproof dedup.

**Schema:**
```sql
CREATE TABLE processed_messages (
    message_id TEXT PRIMARY KEY,           -- broker message ID or producer-chosen idempotency key
    consumer   TEXT NOT NULL,              -- which consumer? same message_id can be processed by several
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    result     JSONB                       -- optional: cache the result if it's small and the caller might re-ask
);
```

**Critical detail:** the insert into `processed_messages` and the side effect must be in the **same DB transaction**. Otherwise a crash between the two leaves you either double-processed (effect committed, marker missing) or silently dropped (marker committed, effect missing).

**Pattern (TypeScript):**
```ts
async function handle(msg: Message) {
  await db.transaction(async (tx) => {
    // 1. Try to claim the message. If someone else (or a previous attempt) already claimed it, bail.
    const inserted = await tx.query(
      `INSERT INTO processed_messages (message_id, consumer)
       VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING message_id`,
      [msg.id, 'order-processor'],
    )
    if (inserted.rowCount === 0) {
      // Already processed. Treat as success and ack.
      return
    }

    // 2. Do the side effect IN THE SAME TRANSACTION.
    await tx.query(`UPDATE orders SET status='paid' WHERE id=$1`, [msg.orderId])
  })
}
```

**When `consumer` matters:** if a single message ID is processed by multiple independent consumers (fan-out), each consumer needs its own dedup row. Hence the `(message_id, consumer)` composite key — make it the primary key instead.

**Cleanup:** the table grows unbounded. Set a retention policy ("delete rows older than 30 days") matched to the broker's max redelivery age. Stay safely above any realistic retry/replay window.

## External side effects: pass the key through

When the side effect is *not* in your DB — a Stripe charge, a SendGrid email, an internal REST call — your dedup table doesn't help, because the external system already acted by the time you record it.

The fix: pass an **idempotency key** to the external API. Modern APIs accept one and collapse duplicate requests to the same response.

**Pattern (Stripe):**
```ts
// Stripe's `idempotencyKey` makes the API call itself idempotent. Two charges
// with the same key return the same charge object — no double-billing.
await stripe.charges.create(
  { customer: msg.customerId, amount: msg.amount, currency: 'usd' },
  { idempotencyKey: msg.messageId },  // ← stable, derived from the message
)
```

**Choosing the key:**
- The broker message ID works if it's stable across redeliveries. Most are; verify.
- Otherwise, the producer should generate a domain-level idempotency key (`charge:order:<order_id>:attempt:<n>` or a UUID stored on the entity) and put it on the message. The consumer passes that through.
- **Never** derive the key from time, randomness, or the receive timestamp — those change between retries, defeating the whole point.

**When the external API doesn't support idempotency keys:**
- **Mark before, confirm after.** Write `external_call_started_at` to your DB before the call, and `external_call_completed_at` after. On retry, check the marker — if started but not completed, you don't know if the external system acted. You have to either (a) call its query API to find out, (b) treat the call as completed and risk one duplicate, or (c) treat it as not-completed and risk one missed call. Pick consciously based on which failure mode is worse.
- **Tighten the window.** Make the unknown-state window as small as possible — keep the external call alone in its critical section, with no other work that could fail and force a retry.

## Common idempotency mistakes

- **Idempotency at the framework layer, not the operation.** Frameworks that promise "we won't deliver the same message twice" don't extend that promise across consumer crashes, redeployments, or rebalances. Make the operation idempotent regardless.
- **Recording the dedup marker outside the transaction.** Defeats the whole point. The marker insert and the side effect must commit together.
- **Idempotency key that includes time or a random salt.** `idempotencyKey: \`${msg.id}-${Date.now()}\`` will be different on retry. Use the message ID alone.
- **No retention on the dedup table.** Grows forever. Set a TTL above the broker's max redelivery age and run a cleanup job.
- **Trusting the broker's "deduplication."** Most brokers offer dedup within a window (SQS FIFO: 5 minutes). That's a convenience, not a guarantee. Crash + replay + cross-region failover routinely exceed those windows. Build idempotency at the consumer regardless.
- **Idempotent on the DB write, not on the side effect.** "We marked the order paid idempotently" doesn't help if the email was sent twice. Each side effect needs its own idempotency story.

## Choosing the right layer

A quick decision flow:

1. Can I phrase the operation as setting an absolute state? → **Layer 1 (natural).** Done.
2. Can the operation be a conditional write that no-ops on retry? → **Layer 2 (conditional).** Add the condition; you're done.
3. Does it touch only your DB but isn't conditional-friendly? → **Layer 3 (keyed).** Add a dedup row inside the transaction.
4. Does it call an external system? → Layer 3 *plus* pass the key through to the external system. Both, not either-or.

If a consumer can't answer "how do you survive a duplicate?" with one of these four answers, you have a bug waiting to happen.
