# Operating queues in production

Companion to principle 5 of [[queue-fundamentals]]. Use when wiring up retries, dashboards, DLQ handling, or shaping messages. Most queue incidents are operational — these controls turn a queue from a liability into load-bearing infrastructure.

## Retries: the three numbers and one destination

Configure all four before the first message flows:

1. **Max attempts** — idempotent/cheap: 5–10; operations with external side effects (charges, emails): 3–5.
2. **Backoff strategy** — exponential: `delay = base * 2^attempt`. Cap max delay (5–15 min) so the queue doesn't go dormant after a few failures.
3. **Jitter** — randomize (`delay * (1 ± 0.2)`) so retries from many consumers don't synchronize into a thundering herd.
4. **DLQ target** — once max attempts is hit, the message goes here. Required, not optional.

**Worked example:**
```
attempt 1: try immediately
attempt 2: wait  1s ± 20%
attempt 3: wait  2s ± 20%
attempt 4: wait  4s ± 20%
attempt 5: wait  8s ± 20%
            └→ if still failing, route to DLQ
```

### Retryable vs permanent

- **Retryable:** transient failures, timeouts, 5xx, network errors, rate limits, lock contention.
- **Permanent:** schema validation failures, 4xx, missing fields, references to deleted entities. Retrying will fail the same way; DLQ on the **first** attempt — don't waste 5 retries with backoff before a human can inspect it.

**Pattern:**
```ts
async function handle(msg: Message) {
  try {
    await process(msg)
  } catch (e) {
    if (isPermanent(e)) {
      // Short-circuit: go straight to DLQ. No retry will help.
      await broker.deadLetter(msg, { reason: e.message })
      return
    }
    throw e // let the broker retry with backoff
  }
}

function isPermanent(e: unknown): boolean {
  return (
    e instanceof SchemaValidationError ||
    e instanceof EntityNotFoundError ||
    (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429)
  )
}
```

## The DLQ is a human inbox

A DLQ nobody watches is the same as no DLQ. Alert on it, triage it, drain it.

**Alerting thresholds (tune to traffic):**
- **DLQ depth > 0 for 5 minutes:** page. One message means something is broken.
- **Oldest message age > 30 minutes:** page. Redrive policy is working but nobody's looking.
- **DLQ growth rate > 0:** slope alert is more useful than a count threshold when volume is high.

**Triage runbook:**
1. **Look at a sample message.** Topic, headers, payload. Most DLQs have a one-shape problem ("all the bad messages are from publisher X after the schema change").
2. **Classify:** bug in the consumer, bad data from the producer, downstream-permanent-fail, or stale reference (entity deleted).
3. **Fix the cause.** Don't just redrive — redriving without a fix sends them back through the same broken path.
4. **Redrive in batches.** Most broker UIs / CLIs support "move N messages from DLQ back to main." Move in small batches, watch them succeed, then move more.
5. **Document the incident** if it's not trivial. The pattern of DLQ causes over time tells you what to invest in (validation, schemas, dead-link detection).

**Never:**
- Re-enqueue silently on a timer — hides recurring bugs.
- Delete DLQ messages without inspection — you're discarding the only signal.
- Treat DLQ as overflow — it's for **failing loudly**, not for waiting in line.

## Backpressure: bound your queues

Unbounded queues become latency black holes — work piles up, oldest-age grows, and the system looks healthy (accepting!) until everything downstream times out.

**Four strategies, ordered by aggressiveness:**

1. **Reject new producers** (return an error / 429 / 503). Best when callers can retry, like external API clients you control. Honest about overload.
2. **Slow producers** (apply rate limits at the producer side). Best when producers are internal services you can ask to behave.
3. **Shed load** (drop or sample messages). Best for low-value telemetry where some loss is preferable to lag.
4. **Drop oldest** (keep the newest N messages, evict the rest). Best when stale messages are useless — fresh metrics, live state syncs.

**Pick consciously.** "Accept everything and pray" is the worst option.

**Where to set the bound:**
- Per-queue max depth (broker-supported on most queues).
- Per-queue max age (oldest message > N seconds → reject incoming).
- Producer-side rate limit (token bucket on the publish call).
- Concurrency limit at the consumer (only N workers; if more work piles up, queue depth grows and signals upstream).

## Observability: the four signals

Every queue needs dashboards for these four:

1. **Queue depth** — trending up = consumers can't keep up.
2. **Consumer lag** — for log-based brokers (Kafka, Kinesis): how far behind each consumer group is.
3. **Age of oldest unacked message** — the most honest signal. Depth 1000 / oldest-age 30s is healthier than depth 100 / oldest-age 10 min.
4. **Error rate / DLQ growth** — "are we failing more than baseline?" Catches regressions.

**Secondary signals worth tracking:**
- Processing latency (p50/p95/p99 per consumer).
- Throughput (messages/sec into the queue and out).
- Retry rate (messages on attempt > 1 / total).
- Visibility-extension count (consumers heartbeating because work is slow).

**Alerting starter pack:**
- `queue_depth > N` sustained for 5 min → warning, 15 min → page.
- `oldest_unacked_age > 5 min` → warning. → 30 min → page.
- `consumer_lag > threshold` (Kafka) → page.
- `dlq_depth > 0 sustained` → page.
- `error_rate > 3x baseline` for 5 min → page.

Tune N and timeouts to your traffic, but configure all five from day one.

## Message hygiene

### Keep messages small

- **Under ~256 KB** is a safe heuristic; some brokers have hard limits below 1 MB.
- For blobs (image, file, large JSON), use the **claim-check pattern**: store in object storage (S3, GCS), send only the URL + small metadata header. Consumers fetch on demand.

### Treat the message schema as a public API

Once a message has more than one consumer, the schema is a contract.

- **Add fields with safe defaults** — old consumers ignore unknowns.
- **Never rename or remove fields silently** — add new field, dual-write for a deprecation window, then remove the old.
- **Version explicitly** on breaking changes (`topic.v2` or `schemaVersion` field).
- **Use a schema registry** (Avro/Protobuf + Confluent Schema Registry) once you have more than a handful of topics — catches breaking changes at publish time, not at 2 AM.

### Required headers

Every message should carry, at minimum:

- **Message ID** — stable across redeliveries, used by consumers for idempotency. See [[idempotency]].
- **Trace ID** — for distributed tracing across producer → broker → consumer.
- **Schema version** — even if implicit in the topic name, store it on the message for safety.
- **Created-at timestamp** — for measuring end-to-end latency and detecting old messages.

These are cheap to add up front and painful to retrofit.

## Putting it together: a launch checklist

Before a new queue path goes to production, verify all of these:

- [ ] Max attempts, backoff, jitter, and DLQ configured.
- [ ] Permanent errors short-circuit to DLQ on first attempt.
- [ ] Dashboards exist for depth, oldest-age, consumer lag, DLQ depth, error rate.
- [ ] Alerts wired for sustained depth, oldest-age, and DLQ > 0.
- [ ] Bound on queue depth or producer rate; explicit backpressure strategy chosen.
- [ ] Visibility timeout > p99 work time, or consumer heartbeats to extend.
- [ ] Message payloads under broker limit; claim-check for anything blob-shaped.
- [ ] Required headers (message ID, trace ID, schema version, created-at) populated.
- [ ] DLQ triage runbook exists and is linked from the alert.

If any of these is "no" or "I don't know," fix it before traffic.
