# The outbox pattern

Never write to a database and publish to a broker as two separate steps.
They cannot be made atomic across systems, and the gap is where events are
lost.

```
1. INSERT order row            ← commits independently
2. broker.publish(...)         ← commits independently
crash between 1 and 2, or broker down → lost event
2 succeeds, 1 rolls back       → ghost event
retry the whole thing          → duplicate event
```

No ordering of the two steps avoids this; two-phase commit across Postgres
and a broker is impractical. Write both to one system and let a separate
process bridge to the other.

## The outbox table

```sql
CREATE TABLE outbox (
    id           BIGSERIAL PRIMARY KEY,   -- monotonic: preserves per-entity order
    topic        TEXT NOT NULL,
    payload      JSONB NOT NULL,
    headers      JSONB,                   -- message id, trace id, partition key
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ              -- NULL = pending
);
CREATE INDEX outbox_pending_idx ON outbox (created_at) WHERE published_at IS NULL;
```

Generate the message id at insert time so a relay retry publishes the same
id and consumer dedup still works. Keep published rows for a retention
window; sweep on a schedule.

```ts
async function placeOrder(cmd: PlaceOrderCommand): Promise<OrderId> {
  return await uow.run(async (tx) => {
    const order = Order.create(cmd)
    await orders.save(order, tx)
    await events.publish(OrderPlaced.from(order), tx)   // OutboxPublisher: INSERT INTO outbox
    return order.id
  })
}
```

The use case writes to an outbox-shaped port and never knows the broker
exists (`hexagonal-backend`).

## The relay

```
loop:
  rows = SELECT id, topic, payload, headers FROM outbox
         WHERE published_at IS NULL ORDER BY id ASC LIMIT 100
         FOR UPDATE SKIP LOCKED;          -- scale relays horizontally
  for row in rows: publish; UPDATE outbox SET published_at = now() WHERE id = row.id
  COMMIT; sleep(200ms) if empty
```

Three flavors: polling (100–500 ms lag), Postgres `LISTEN/NOTIFY` (a trigger
wakes the relay in milliseconds), or CDC (Debezium reads the WAL; no relay
code, but Connect, a schema registry, and log retention to operate). Default
to polling; move to `LISTEN/NOTIFY` for latency-sensitive paths; move to CDC
when many services amortize the ops cost.

The relay is at-least-once: a crash between publish and the `UPDATE`
publishes again. Outbox eliminates lost events; idempotent consumers
([idempotency](idempotency.md)) eliminate duplicate effects. Together they
are what people mean by "exactly-once".

Per-entity order is preserved by `ORDER BY id` and serial publishing; with
parallel relays set a partition-key header. Do not attempt global order.

## Pitfalls

- Outbox insert in a separate transaction from the domain write: dual-write
  again. Pass `tx` through or use a Unit of Work.
- No partial index on pending rows: a full scan kills the relay.
- Deleting rows on publish: no audit, no replay after a relay bug.
- Message id generated at publish time: retries break consumer dedup.
- Relay without `SKIP LOCKED`: two workers publish the same row.
- Publishing the whole DB row: events are intentional contracts; pick fields,
  version the shape.
- Outbox when a DB-backed job table would do: same service, same DB → insert
  a job row in the same transaction and skip the broker.
