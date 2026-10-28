# Operating queues in production

Most queue incidents are operational: ack timing, poison messages, unbounded
depth, nobody watching the DLQ.

## Ack after the effect is durable

Ack-before-work loses messages on crash; ack-after-work duplicates on crash,
which [idempotency](idempotency.md) handles. Set the visibility timeout above
p99 work time with margin, or heartbeat to extend it from inside the handler;
a 30 s timeout on a 5 min job runs the job three times in parallel. For
long jobs, a `status='running', claimed_at` row plus a watchdog that reclaims
by timestamp is independent of the broker's window. For Kafka, commit offsets
after the work is durable; auto-commit is a footgun.

```go
func handleLong(ctx context.Context, msg Message) error {
    stop := startHeartbeat(ctx, msg, 20*time.Second) // extend visibility while running
    defer stop()
    if err := processAndSave(ctx, msg); err != nil {
        return err                                    // no ack; broker redelivers
    }
    return broker.Ack(ctx, msg)
}
```

Never ack inside a `try` whose wide `catch` can run after the ack.

## Retries: three numbers and one destination

Configure before the first message flows:

1. **Max attempts:** 5–10 for cheap idempotent work; 3–5 for external side
   effects.
2. **Exponential backoff** `base * 2^attempt`, capped at 5–15 min.
3. **Jitter** `± 20%` so retries from many consumers do not synchronize.
4. **DLQ target** once the cap is hit.

Distinguish retryable (timeouts, 5xx, rate limits, lock contention) from
permanent (schema validation, 4xx other than 408/429, missing fields, deleted
references). Permanent failures go to the DLQ on the first attempt.

```ts
try { await process(msg) }
catch (e) {
  if (isPermanent(e)) { await broker.deadLetter(msg, { reason: e.message }); return }
  throw e   // broker retries with backoff
}
```

## The DLQ is a human inbox

Alert on depth > 0 for 5 min and oldest age > 30 min. Triage: sample a
message, classify (consumer bug, bad producer data, permanent downstream
failure, stale reference), fix the cause, redrive in small batches, record
the pattern. Never re-enqueue silently on a timer, delete without
inspection, or use the DLQ as overflow.

## Backpressure

An unbounded queue looks healthy while everything downstream times out.
Strategies, from least to most aggressive: reject producers (`429`/`503`),
slow producers (rate limit), shed load (sample), drop oldest. Bound with a
per-queue max depth or max age, a producer-side token bucket, and a consumer
concurrency limit so growing depth signals upstream.

## Four signals

1. **Queue depth** trending up: consumers cannot keep up.
2. **Consumer lag** per group (log brokers).
3. **Age of oldest unacked message:** the most honest signal.
4. **Error rate / DLQ growth** versus baseline.

Alerts from day one: sustained depth (warn 5 min, page 15 min); oldest age >
5 min warn, > 30 min page; consumer lag; DLQ depth > 0; error rate > 3×
baseline.

## Message hygiene

Keep messages under ~256 KB; use the claim-check pattern (store the blob,
send the URL) for anything larger. Treat the schema as a public API once it
has two consumers: add fields with defaults, never rename or remove silently,
version breaking changes, use a schema registry past a handful of topics.
Every message carries a stable message id, trace id, schema version, and
created-at timestamp.

## Launch checklist

- [ ] Max attempts, backoff, jitter, DLQ configured; permanent errors
      short-circuit.
- [ ] Dashboards for depth, oldest age, lag, DLQ depth, error rate; alerts
      wired.
- [ ] Explicit backpressure strategy and bound.
- [ ] Visibility timeout > p99 work time, or heartbeats.
- [ ] Payloads under the broker limit; required headers populated.
- [ ] DLQ triage runbook linked from the alert.
