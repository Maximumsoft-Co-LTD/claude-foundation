# Logs, metrics, traces

## Contents

- [Pick the pillar for the question](#pick-the-pillar-for-the-question)
- [Structured logging: field conventions](#structured-logging-field-conventions)
- [Log levels: the action each one demands](#log-levels-the-action-each-one-demands)
- [Metrics: RED and USE recipes](#metrics-red-and-use-recipes)
- [Traces and spans: following one request](#traces-and-spans-following-one-request)
- [Correlation: propagating the id across boundaries](#correlation-propagating-the-id-across-boundaries)
- [SLI, SLO, error budget: a worked example](#sli-slo-error-budget-a-worked-example)
- [Alert on symptoms](#alert-on-symptoms)
- [Cardinality and cost pitfalls](#cardinality-and-cost-pitfalls)

Field manual for the SKILL.md steps: field names, level semantics, metric
shapes, propagation code, a worked SLO, alert shape, and the cardinality traps.

## Pick the pillar for the question

Metrics are cheap, aggregatable, alertable: they say *that* and *how many*,
never *which one*. Logs carry per-event detail: *why* this one failed. Traces
follow one request across every hop: *where* the time went. Incident flow is
metric → trace → log.

```
Incident: "checkout is slow"
  metric  →  http_request_duration p99 on POST /checkout jumped 200ms → 8s
  trace   →  7.8s of one /checkout trace is in the inventory call
  log     →  inventory: "lock wait timeout on table reservations, retried 5x"
```

Do not reconstruct a metric by querying logs on a hot path, and do not debug
one request from metrics alone.

## Structured logging: field conventions

Emit key-value records (JSON or logfmt), never interpolated strings, with
field names standardized across services so one query pulls the whole story.

| Field | Type | Why |
|---|---|---|
| `timestamp` | RFC3339 UTC | sortable; let the logger add it |
| `level` | enum | the dial that filters the firehose |
| `event` | dotted name (`order.placed`) | a stable key to count and alert on |
| `request_id` / `trace_id` | string | the correlation handle |
| `service` | string | auto-injected emitter |
| `msg` | short string | for the human reading one line |

Attach the ids and the outcome a stranger needs six months from now:

```json
{ "level":"error", "event":"payment.failed", "request_id":"req_7f3a",
  "service":"checkout", "user_id":"u_91", "order_id":"o_88", "amount_cents":4200,
  "provider":"stripe", "provider_code":"card_declined", "attempt":3, "duration_ms":812 }
```

Never log secrets or credentials (passwords, API keys, bearer tokens, session
cookies, connection strings), full PII (PANs, CVV, SSNs), or whole
request/response bodies on a hot path. Log `user_id`, not email; `card_last4`,
not the card.

## Log levels: the action each one demands

| Level | What it asks of the reader | Prod default |
|---|---|---|
| `ERROR` | A human should look; it is not self-healing and should be alertable. If nobody needs to act, it is not an error. | on |
| `WARN` | Degraded but handled: retry succeeded, fell back, approaching a quota. | on |
| `INFO` | A notable business event, sparse by design. | on |
| `DEBUG` | Developer detail. | off, switchable per request |
| `TRACE` | Firehose. | off |

Two common mistakes: everything is `INFO` (level carries no information) and
`ERROR` for handled conditions (trains on-call that errors are ignorable).

## Metrics: RED and USE recipes

Types matter: a **counter** only goes up (requests, errors) and yields a
rate; a **gauge** goes up and down (pool in use, queue depth); a
**histogram** is a bucketed distribution and the only way to get fleet-wide
percentiles. You cannot average per-instance percentiles.

RED for a request-serving endpoint:

```
http_requests_total{route="/checkout", method="POST", status="200"}      # rate
http_requests_total{route="/checkout", status="500"}                     # errors
http_request_duration_seconds_bucket{route="/checkout", le="0.1"}        # duration
# p99: histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
```

USE for every resource a request can wait on (pool, thread pool, queue,
cache, disk):

```
db_pool_connections_in_use / db_pool_size      # utilization
db_pool_wait_queue_depth                       # saturation
db_pool_acquire_timeouts_total                 # errors
```

When a RED symptom fires, USE on the dependencies names the bottleneck.
Percentiles, never averages: 95 requests at 50 ms plus 5 at 10 s average to
550 ms, a latency nobody experiences; p99 shows the five.

## Traces and spans: following one request

A trace is a tree of spans sharing one `trace_id`; each span has `span_id`,
`parent_span_id`, duration, and attributes (`http.route`, parameterized
`db.statement`, `error=true`).

```
└─ POST /checkout                 [checkout]   8.10s
   ├─ validate cart               [checkout]   0.02s
   ├─ POST inventory.reserve      [checkout]   7.80s   ← the time sink
   │  └─ SELECT ... FOR UPDATE    [inventory]  7.78s   error=true
   └─ POST payment.charge         [checkout]   0.21s
```

Auto-instrument the framework with OpenTelemetry; add manual spans around
business operations it cannot see. A span attribute is as leaky as a log
field.

## Correlation: propagating the id across boundaries

The trace is continuous only if the id survives every hop. Standardize on W3C
Trace Context (`traceparent`).

```ts
// 1. Edge: adopt the inbound id or mint one; bind to request-scoped context
const ctx = { requestId: req.headers["x-request-id"] ?? crypto.randomUUID(),
              traceparent: req.headers["traceparent"] }
runWithContext(ctx, () => handler(req))

// 2. Outbound HTTP: propagate on every call
await fetch(url, { headers: { "x-request-id": ctx.requestId, traceparent: currentTraceparent() } })

// 3. Publish: the id rides in message metadata
await queue.publish(topic, payload, { headers: { "x-request-id": ctx.requestId, traceparent: currentTraceparent() } })

// 4. Consume: read it back and rebind; minting a fresh id severs the chain
function onMessage(msg) {
  runWithContext({ requestId: msg.headers["x-request-id"], traceparent: msg.headers["traceparent"] },
    () => process(msg))
}
```

The async hop (steps 3–4) is where correlation is most often lost and most
valuable.

## SLI, SLO, error budget: a worked example

An **SLI** is `good events / valid events` for one user-facing quality; an
**SLO** is the target over a window; the **error budget** is `1 − SLO`, the
currency for reliability-versus-velocity decisions. Pick one to three SLIs
per service; justify every extra nine (99.99% costs ten times 99.9%).

```
SLI:           POST /checkout requests that are non-5xx AND < 500 ms / valid requests
SLO:           99.9% over a rolling 30 days
Error budget:  0.1% of requests ≈ 43 min of "down" per 30 days

budget 80% left mid-month      → ship the risky migration
budget exhausted on day 12     → freeze risky deploys; spend the cycle on reliability
one deploy burned 40% in 1 h   → fast-burn alert fires; roll back
```

## Alert on symptoms

Page on what users feel (error ratio, latency percentile, budget burn), never
on a cause (`CPU > 80%`). Causes go on dashboards consulted after a symptom
fires. Every page carries a runbook link and first action; if the honest 3 a.m.
answer is "look and go back to sleep", demote it. Use multi-window burn-rate
alerts so a one-minute blip does not page:

```
ALERT CheckoutBudgetFastBurn            # burn 14.4 exhausts a 30-day budget in ~2 days
  IF   burn_rate(slo="checkout-availability", window="1h") > 14.4
   AND burn_rate(slo="checkout-availability", window="5m") > 14.4
  FOR  2m   SEVERITY page   ANNOT runbook="https://wiki/runbooks/checkout-availability"

ALERT CheckoutBudgetSlowBurn
  IF   burn_rate(... window="6h") > 1  AND  burn_rate(... window="30m") > 1
  SEVERITY ticket
```

Audit periodically: an alert that fired and needed no action is a candidate
for deletion.

## Cardinality and cost pitfalls

Every distinct label combination is a separate stored time series. Safe
labels are bounded and known in advance: templated `route`, `method`,
`status_class`, `region`. Unsafe: `user_id`, `order_id`, `request_id`,
`email`, raw URL, raw error message, full SQL. Identifiers belong in logs and
traces.

```
http_requests_total{route="/checkout", user_id="u_91"}   # 1M users → 1M series
http_requests_total{route="/order/8821"}                 # un-templated path, unbounded
http_requests_total{route="/order/:id", status_class="2xx"}   # bounded
```

Volume: keep production at `INFO` with `DEBUG` switchable per request; sample
traces (errors 1.0, slow > 1 s 1.0, normal success 0.01); set retention by
value (raw debug logs days, sampled traces days, aggregated metrics months).
Review the telemetry bill like any infrastructure cost.
