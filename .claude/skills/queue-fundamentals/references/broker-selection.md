# Broker selection, delivery semantics, ordering

## Five shapes a queue can take

1. **In-process buffer** (Go `chan`, `asyncio.Queue`): same process, lost on
   restart, at-most-once.
2. **Task / work queue** (SQS, BullMQ, Sidekiq, Celery, `pg-boss`):
   point-to-point, one worker from a pool, retries and scheduled jobs built in.
3. **Pub/sub** (SNS+SQS, RabbitMQ fanout, Google Pub/Sub, NATS JetStream):
   every subscriber gets a copy and tracks its own progress.
4. **Event log** (Kafka, Kinesis, Redpanda, Redis Streams): append-only,
   partitioned, replayable; consumer groups with their own offsets.
5. **DB-backed job table** (`pg-boss`, Oban, Que): rows with `status`,
   `attempts`, `run_after`, claimed with `SELECT ... FOR UPDATE SKIP LOCKED`;
   transactional with your data, underrated.

Name which of the five your problem is before choosing a broker. "We use
Kafka" is not an architecture.

```
"Send a welcome email on signup"           → task queue with retries and a DLQ
"Notify analytics, billing, recommender"   → pub/sub or log; adding a fourth
                                             consumer does not touch the producer
```

## Decision matrix

| Question | If yes, lean toward |
|---|---|
| Same process, loss acceptable on restart? | in-process channel |
| Already have Postgres, jobs < ~100/s, no fan-out? | DB-backed job table |
| Point-to-point work, managed infra? | SQS / BullMQ / Sidekiq |
| Multiple independent consumers each need every message? | pub/sub |
| Replay history, audit, or add consumers retroactively? | event log |
| Strict per-entity ordering at high throughput? | log with partition key, or SQS FIFO |
| Scheduled or delayed jobs? | task queue with delay support |
| Exactly-once coupled to a DB write? | outbox + your broker ([outbox](outbox.md)) |

Quick path: DB-backed job table if it fits → point-to-point task queue →
pub/sub for fan-out → Kafka only for replay or per-key ordering at scale. If
you cannot justify the more complex broker in one sentence, drop a level.

## Delivery semantics

Almost every production broker is **at-least-once**: duplicates happen on
retries, crashes, rebalances, and network blips. At-most-once is acceptable
only when loss is cheaper than duplicates (telemetry, ephemeral hints).
"Exactly-once" exists narrowly inside one broker's domain (Kafka idempotent +
transactional producer + `read_committed` consumer, Kafka-to-Kafka only) and
breaks the moment you touch a DB, HTTP, or another broker; treat it as
at-least-once there and use the outbox.

| Broker | Delivery | Ordering | DLQ |
|---|---|---|---|
| SQS Standard | at-least-once | none | first-class redrive |
| SQS FIFO | exactly-once within a 5-min dedup window per group | per `MessageGroupId` | first-class; lower throughput; still write idempotent consumers |
| RabbitMQ (manual ack) | at-least-once | per queue, single consumer | dead-letter exchange per queue |
| Kafka (`acks=all`, replication 3) | at-least-once; auto-commit off | per partition | not built in: publish to a `*-dlq` topic, then commit |
| Redis Streams | at-least-once with `XACK` | per stream | pending list + `XCLAIM` |
| Google Pub/Sub | at-least-once | opt-in ordering keys | first-class |
| DB job table | at-least-once via row locks | by `created_at`/`priority` | a `failed_jobs` table you build |

Verify against current docs; defaults change (Kafka 4.0 is KRaft-only).

## Ordering is opt-in

"Process in the order sent" is the most-broken hidden assumption. Order
usually matters per entity, not globally: route by partition key or
`MessageGroupId` so one entity's messages land on one consumer. Better than
ordering: make the handler version-aware or commutative so out-of-order
delivery converges.

```ts
const result = await db.query(
  `UPDATE users SET name=$1, version=$2 WHERE id=$3 AND version < $2`,
  [msg.name, msg.version, msg.userId])
if (result.rowCount === 0) return   // a newer update already landed; drop this one
```

Global ordering means one consumer and a throughput ceiling; name it
explicitly if you really need it.

## Common selection mistakes

Kafka as a task queue (no per-message ack; you reinvent retries and DLQ);
SQS as an event log (no replay); Redis Pub/Sub for anything durable;
standing up Kafka for ten messages a minute; an in-process channel across
processes.
