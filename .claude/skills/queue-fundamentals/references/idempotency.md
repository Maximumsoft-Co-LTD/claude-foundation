# Idempotency patterns

If duplicates cannot break you, retries and redeliveries stop being
dangerous. Every message handler must produce the same observable effect
whether called once or N times with the same message.

Before choosing a layer, answer the three rerun questions (twice, crashed
halfway, overlapping runs) in [concurrency Principle 5](../../concurrency-fundamentals/references/shared-state-and-async.md#principle-5-from-skillmd-make-operations-idempotent-and-cancellable).

## Three layers, in order

1. **Natural:** the operation is idempotent by construction. `SET balance =
   100` rather than `balance += 5`; `INSERT ... ON CONFLICT DO UPDATE`; model
   state as absolute, not relative.
2. **Conditional:** a condition makes the repeat a no-op.

   ```sql
   UPDATE orders SET status = 'shipped' WHERE id = $1 AND status = 'paid';
   -- second call updates zero rows
   ```

   State machines (next state reachable only from current), versioned writes
   (`WHERE version < $2`, which also gives out-of-order safety), and unique
   constraints (`UNIQUE (user_id, event_id)`) all live here.
3. **Keyed:** a dedup table records "this message already produced this
   effect". The marker insert and the side effect must commit in the **same
   transaction**; a crash between them means a double effect or a silent drop.

   ```sql
   CREATE TABLE processed_messages (
       message_id TEXT NOT NULL,     -- broker id or producer-chosen key
       consumer   TEXT NOT NULL,     -- each fan-out consumer dedups separately
       processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
       PRIMARY KEY (message_id, consumer)
   );
   ```

   ```ts
   await db.transaction(async (tx) => {
     const claimed = await tx.query(
       `INSERT INTO processed_messages (message_id, consumer) VALUES ($1, $2)
        ON CONFLICT DO NOTHING RETURNING message_id`, [msg.id, 'order-processor'])
     if (claimed.rowCount === 0) return                        // already done; ack
     await tx.query(`UPDATE orders SET status='paid' WHERE id=$1`, [msg.orderId])
   })
   ```

   Set retention above the broker's maximum redelivery age.

## External side effects: pass the key through

A dedup table cannot protect a Stripe charge or an email; the external
system already acted. Pass an idempotency key the external API supports:

```ts
await stripe.charges.create({ customer: msg.customerId, amount: msg.amount },
  { idempotencyKey: msg.messageId })
```

Use the broker message id when it is stable across redeliveries, otherwise a
producer-chosen domain key on the message. Never derive the key from time or
randomness. When the API has no key, record `started_at` before the call and
`completed_at` after, and decide consciously how a started-but-not-completed
retry behaves.

## Your own mutation API accepts `Idempotency-Key`

The same idea at the HTTP boundary: the client sends a UUID; the server
stores `(key, request_fingerprint, status, body)` for at least 24 h, replays
the cached response on a duplicate, and returns `422` when the fingerprint
differs. When your service is both an endpoint and a consumer, propagate the
HTTP key as the message key end to end. Request-side mechanics are in
[api-design-fundamentals](../../api-design-fundamentals/references/evolution.md).

## Common mistakes

Relying on framework-level dedup (crashes and rebalances exceed it); marker
outside the transaction; keys with time or randomness; no retention on the
dedup table; trusting SQS FIFO's five-minute window; idempotent DB write but
non-idempotent external side effect.

## Choosing the layer

Absolute state → natural. Conditional write possible → conditional. Touches
only your DB but not conditional-friendly → keyed. Calls an external system →
keyed plus pass the key through. A consumer that cannot answer "how do you
survive a duplicate?" with one of these is a bug waiting to ship.
