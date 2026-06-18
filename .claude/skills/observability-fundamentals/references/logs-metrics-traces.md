# Logs, Metrics & Traces

Concrete recipes for the three pillars. The SKILL gives the principles; this is the field manual — field names, level semantics, metric shapes, propagation code, a worked SLO, and the cardinality traps.

---

## Structured logging: field conventions

Emit logs as key-value (JSON or logfmt), not interpolated strings. Standardize field names across the codebase so one query (`order_id = "o_88"`) pulls the whole story regardless of which service emitted each line.

### The baseline fields every line should carry

| Field | Type | Why |
|---|---|---|
| `timestamp` | ISO-8601 / RFC3339, UTC | sortable, unambiguous; let the logger add it |
| `level` | enum (see below) | the dial that lets you filter the firehose |
| `event` | dotted name, e.g. `order.placed` | a stable key you can count and alert on — not a free-text sentence |
| `request_id` / `trace_id` | string | the correlation handle (see propagation section) |
| `service` | string | which service emitted it (auto-injected) |
| `msg` | short human string | for the human reading one line; not for machines to parse |

### Context fields — attach what the next debugger needs

Pick the ids and the outcome of the operation. Test: *could a stranger reconstruct what happened from this line alone, six months from now?*

```json
{ "timestamp":"2026-06-12T09:31:02.114Z", "level":"error", "event":"payment.failed",
  "request_id":"req_7f3a", "service":"checkout", "user_id":"u_91", "order_id":"o_88",
  "amount_cents":4200, "currency":"USD", "provider":"stripe", "provider_code":"card_declined",
  "attempt":3, "duration_ms":812, "msg":"payment declined after 3 attempts" }
```

### Never log these

Logs are indexed, replicated, and shipped to third-party aggregators — the single most common accidental data-leak surface.

- **Secrets / credentials**: passwords, API keys, bearer/JWT tokens, session cookies, private keys, DB connection strings with passwords.
- **Full PII**: full card numbers (PANs), CVV, SSNs, full DOB, raw email/phone in bulk where regulated.
- **Whole request/response bodies** on a hot path — they smuggle in all of the above and blow up volume.

Do / don't:

```
DON'T  log.info("auth ok for " + email + " jwt=" + token)
DO     log.info({ event:"auth.ok", user_id: user.id, request_id: ctx.requestId })

DON'T  log.error({ event:"charge.fail", card: "4242424242424242", cvv:"311" })
DO     log.error({ event:"charge.fail", card_last4:"4242", provider_code:"do_not_honor" })
```

---

## Log levels: the action each one demands

Make each level encode *what it asks of a reader*, so `level=error` returns exactly what a human must act on.

| Level | Meaning — what it asks of the reader | Prod default |
|---|---|---|
| `ERROR` | **A human should look.** Something failed and isn't self-healing. Should be alertable. If nobody needs to act, it is **not** an error. | on |
| `WARN` | Degraded but handled — retry eventually succeeded, fell back to a default, approaching a quota. Worth a dashboard, not a page. | on |
| `INFO` | A notable business event: order placed, user registered, job completed. **Sparse by design** — one or a few per request, not per loop iteration. | on |
| `DEBUG` | Developer detail: branch taken, intermediate value, cache hit. | off (switchable) |
| `TRACE` | Firehose — every function entry, full payloads. Local/incident only. | off |

Two most common level mistakes:
- **Everything is `INFO`** — level carries zero information; the real `ERROR` drowns. Demote noise.
- **`ERROR` for handled conditions** — logging `ERROR` on a successfully-retried failure trains on-call that errors are ignorable. That's a `WARN`. Reserve `ERROR` for "this actually failed."

Keep prod at `INFO`. Make `DEBUG` flippable per request or per service (header, feature flag, config push) — never always-on.

---

## Metrics: RED and USE recipes

**RED** covers request-serving services; **USE** covers resources. Use the right *type* — counter, gauge, or histogram — or the math comes out wrong.

### Metric types (get this right or percentiles lie)

- **Counter** — monotonically increasing total. Requests, errors, bytes. You compute a *rate* from it (`rate(http_requests_total[5m])`). Never use a gauge for a count.
- **Gauge** — a value that goes up and down. Pool connections in use, queue depth, temperature. A point-in-time level.
- **Histogram** — bucketed distribution. Latency, payload size. **The way to get fleet-wide percentiles** — the backend computes p95/p99 from buckets across all instances (summaries/sketches also yield percentiles but don't aggregate across instances). You cannot average per-instance percentiles into a fleet percentile.

### RED — for a request-serving service / endpoint

```
# Rate  — how many requests (a counter; rate() derives requests/sec)
http_requests_total{service="checkout", route="/checkout", method="POST", status="200"}

# Errors — count failures so you can compute error ratio = errors / total
http_requests_total{... status="500"}        # 5xx (server fault)
# error ratio: sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# Duration — a histogram, so p50/p95/p99 are correct
http_request_duration_seconds_bucket{service="checkout", route="/checkout", le="0.1"}
http_request_duration_seconds_bucket{... le="0.5"}
http_request_duration_seconds_bucket{... le="1.0"}
http_request_duration_seconds_bucket{... le="+Inf"}
# p99: histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
```

Those three answer "is this service healthy" almost completely: serving traffic (rate), failing (errors), slow (duration).

### USE — for a constrained resource

For every resource a request can wait on — DB connection pool, thread pool, queue, cache, disk, CPU:

```
# Utilization — how busy (fraction of capacity in use)
db_pool_connections_in_use   /   db_pool_size                # gauge ratio

# Saturation — the work that can't be served right now (queued / rejected)
db_pool_wait_queue_depth                                     # gauge
worker_queue_depth                                           # gauge

# Errors — the resource's own failures
db_pool_acquire_timeouts_total                               # counter
```

When a RED symptom fires, USE on the dependencies tells you *which resource* is the bottleneck — utilization near 100% with rising saturation is your culprit.

### Percentiles, never averages

```
# DON'T — avg hides the tail, describes nobody
checkout_latency_avg_ms  723

# DO — histogram, read as percentiles
p50 = 48ms   p95 = 210ms   p99 = 9_400ms
#  → 1-in-100 checkouts takes 9.4s; the 723ms avg made that invisible.
```

---

## Traces & spans: following one request

A **trace** is the end-to-end story of one request — a tree of **spans** (HTTP handler, DB query, outbound call), each with start time, duration, and parent. The trace answers what metrics and logs can't: *where did this one request spend its time across every service?*

### Trace / span anatomy

- **trace_id** — one id for the whole request; the same across every service and span.
- **span_id** — id of one operation within the trace.
- **parent_span_id** — links a span to the operation that caused it, building the tree.
- **attributes** — key-values on the span (`http.route`, `db.statement` (parameterized!), `error=true`).

```
trace_id = 4bf92f...   (one id for the entire /checkout request)
└─ span: POST /checkout                 [checkout svc]   8.10s
   ├─ span: validate cart               [checkout svc]   0.02s
   ├─ span: POST inventory.reserve      [checkout svc]   7.80s   ← the time sink
   │  └─ span: SELECT ... FOR UPDATE    [inventory svc]  7.78s   error=true, lock_wait_timeout
   └─ span: POST payment.charge         [checkout svc]   0.21s
```

One look localizes the 8s to the inventory lock wait. Then the inventory service's logs (filtered by the same `trace_id`) tell you *why*.

### Instrument

- Auto-instrument the framework (OpenTelemetry SDKs wrap HTTP servers/clients, DB drivers, queue clients) for the common spans.
- Add manual spans around meaningful business operations the framework can't see (`reserve_inventory`, `compute_pricing`).
- Put a parameterized statement, not interpolated values, in `db.statement` — a span attribute is as leaky as a log field.

---

## Correlation: propagating the id across boundaries

The trace is only continuous if the id **survives every hop** — drop it at one boundary and logs after that point are orphaned. Standardize on **W3C Trace Context** (`traceparent`) — OpenTelemetry and most vendors speak it, so the id survives third-party hops.

### The pattern, end to end

```ts
// 1. EDGE — adopt an inbound id or mint one; bind it to request-scoped context
//    so EVERY log/span inside this request inherits it without manual threading.
const ctx = {
  requestId: req.headers["x-request-id"] ?? crypto.randomUUID(),
  traceparent: req.headers["traceparent"],   // W3C; SDK continues the trace from it
}
runWithContext(ctx, () => handler(req))       // async-local-storage / context.WithValue / MDC

// 2. OUTBOUND HTTP — propagate on every call. Dropping this severs the trace.
await fetch(inventoryUrl, {
  headers: { "x-request-id": ctx.requestId, traceparent: currentTraceparent() },
})

// 3. PUBLISH TO A QUEUE — the id rides in MESSAGE METADATA (a header is gone once
//    the request returns; the consumer runs later, in another process).
await queue.publish("inventory.reserve", payload, {
  headers: { "x-request-id": ctx.requestId, traceparent: currentTraceparent() },
})

// 4. CONSUME — READ the id back out and REBIND. Minting a fresh id here is the
//    classic mistake: it severs the chain to the producer and you lose the link
//    between "request enqueued the job" and "worker ran the job."
function onMessage(msg) {
  const ctx = {
    requestId: msg.headers["x-request-id"],
    traceparent: msg.headers["traceparent"],
  }
  runWithContext(ctx, () => process(msg))
}
```

Steps 3-4 (the async hop) are where correlation is most often lost and most valuable — the one boundary where logs are guaranteed to be in different processes at different times.

---

## SLI / SLO / error budget: a worked example

Three nested definitions make "healthy" a number:
- **SLI** — `good events / valid events` for one user-facing quality.
- **SLO** — the target on the SLI over a window.
- **Error budget** — `1 − SLO`: what you're *allowed* to fail. The currency for reliability-vs-velocity decisions.

### Worked: checkout availability

```
SLI:           proportion of POST /checkout requests that are non-5xx AND < 500ms
               = count(non-5xx AND <500ms) / count(valid requests)
SLO:           99.9% over a rolling 30-day window
Error budget:  1 − 0.999 = 0.1% of requests may fail
               in time terms over 30 days ≈ 43m 12s of total "down"
```

### Using the budget

```
budget 80% remaining, mid-month     → green: ship the risky migration
budget 100% remaining for months    → SLO too loose; you can spend it or loosen
budget exhausted on day 12          → freeze risky deploys; spend remaining cycle on reliability
one bad deploy burned 40% in 1 hour → fast-burn alert fires → roll back now
```

### Burn-rate alerting (the symptom alert from principle 5)

Alert on *how fast you're burning the 30-day budget*, with **multi-window** confirmation so a one-minute blip doesn't page:

```
# Burn rate 14.4 means: at this pace you'd exhaust the entire 30-day budget in ~2 days.
# Require BOTH a long and a short window to be burning, to filter transients.
ALERT CheckoutBudgetFastBurn
  IF   burn_rate(slo="checkout-availability", window="1h")  > 14.4
   AND burn_rate(slo="checkout-availability", window="5m")  > 14.4
  FOR  2m
  SEVERITY page
  ANNOT runbook="https://wiki/runbooks/checkout-availability"

# A separate, gentler slow-burn alert catches steady low-grade erosion (ticket, not page).
ALERT CheckoutBudgetSlowBurn
  IF   burn_rate(... window="6h")  > 1   AND  burn_rate(... window="30m") > 1
  SEVERITY ticket
```

Fast-burn pages; slow-burn tickets. Both fire on the *symptom* — budget loss — not on a cause like CPU.

---

## Cardinality & cost pitfalls

### Cardinality — unique label combinations explode time-series count

Every distinct label-value combination is a **separate stored time series**. A high-cardinality label multiplies your series count without bound; the backend OOMs and the bill detonates. Identifiers belong in **logs and traces**, never in metric labels.

```
# DON'T — user_id on a metric: 1 metric × 1,000,000 users = 1,000,000 series. Backend dies.
http_requests_total{route="/checkout", user_id="u_91", status="200"}

# DO — keep the metric low-cardinality; the id lives in the correlated log/trace
http_requests_total{route="/checkout", status_class="2xx"}
log.info({ event:"checkout.ok", user_id:"u_91", request_id: ctx.requestId })
```

**Hidden cardinality** — a label that *looks* bounded but isn't, because un-templated values leak in:

```
# DON'T — raw path is a new series per id (and per uuid, per search query…)
http_requests_total{route="/order/8821"}        # /order/8822, /order/8823, … unbounded

# DO — template the route to its pattern
http_requests_total{route="/order/:id"}
```

Safe labels: **bounded and known in advance** — `route` (templated), `method`, `status_class`, `region`, `tenant_tier`. Unsafe: `user_id`, `order_id`, `request_id`, `email`, raw URL, raw error message, full SQL.

### Volume — the debug firehose costs money and hides the signal

Logging every request at `DEBUG` in prod produces terabytes and buries the one `ERROR` in ten million lines. More telemetry past a point is cost and noise, not observability.

```
# Sampling: keep 100% of what matters, a fraction of the routine
trace_sample_rate:
  errors:           1.00     # always keep failures
  slow (>1s):       1.00     # always keep the tail
  normal success:   0.01     # 1% of healthy requests is plenty to characterize normal

log levels in prod:  INFO        # DEBUG switchable per-request for incidents, not always-on
```

### Retention — budget by value

```
raw debug logs        → short (days)
detailed traces       → days  (sampled)
aggregated metrics    → long  (months/years — cheap and needed for trend analysis)
```

Review the telemetry bill like any infra cost. Runaway observability spend is an incident your finance team reports instead of your pager.
