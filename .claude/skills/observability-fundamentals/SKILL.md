---
name: observability-fundamentals
description: Apply observability fundamentals — the three pillars (logs/metrics/traces), structured leveled logging, correlation ids across services, metrics that answer questions (RED/USE, percentiles), alerting on symptoms not causes, SLI/SLO/error budgets, cost and cardinality discipline. Use BEFORE shipping runtime code that adds a new failure mode or op surface, adding logging/metrics/tracing, defining SLOs or alerts, or debugging a prod blind spot. The trigger is making a running system diagnosable, even when no principle is named. Skip throwaway scripts and pure offline/library code with no runtime op surface.
---

# Observability Fundamentals

## Why this exists

Incidents are made longer by the same handful of missed fundamentals: the failing path that logged nothing; the log firehose that buried the one relevant line; the average-latency dashboard hiding a catastrophic p99; logs with no request id threading them across services; pages on `CPU > 80%` that train on-call to ignore the pager. This skill is a **pre-flight** — read it before shipping code, wiring a metric, or writing an alert. Observability is a property you build in; you can't bolt it on during an incident.

Inverse of [[debug-fundamentals]]: debug is reactive (failure happened, find the cause). Observability is proactive (decide what evidence will exist next time). Pairs with [[architecture-fundamentals]] (service boundaries correlation ids must cross) and [[queue-fundamentals]] (async hops where a trace is the only way to follow a request).

## The 7 principles

---

### 1. Know the three pillars and what each is for

**Rule:** Logs are discrete events, metrics are aggregatable numbers, traces are the causal path of one request. Reach for the right pillar for the question — don't try to make one do another's job.

**Why:** Each pillar carries different information and costs differently. **Metric**: cheap, aggregatable, alertable — tells you *that* and *how many*, never *which one*. **Log**: high detail per event — tells you *why* that operation failed. **Trace**: follows one request across every hop with timing — tells you *where* time was spent. The wrong pillar is expensive: counting log lines for a rate is slow; finding one failing request in metrics is impossible. Incident flow: metric → trace → log.

**How to apply:**
- Emit a **metric** for anything you'd want to alert on, graph, or count: request rate, error rate, latency, queue depth, cache hit ratio.
- Emit a **log** at the points where a human will need the specifics: an error with its cause, a security-relevant decision, a state transition.
- Emit/propagate a **trace** for any request that crosses an async boundary or more than one service — that's the only pillar that reconstructs the cross-service path.
- Don't reconstruct a metric by querying logs in a hot path, and don't try to debug a single request from metrics alone.

**Example:**
```
Incident: "checkout is slow"
  metric  →  http_request_duration p99 on POST /checkout jumped 200ms → 8s   (THAT it's slow, widespread)
  trace   →  one /checkout trace: 7.8s of the 8s is in the `inventory` service call   (WHERE)
  log     →  inventory service log: "lock wait timeout on table reservations, retried 5x"   (WHY)
```

---

### 2. Logs are structured and leveled — key-value, not string-concat

**Rule:** Emit logs as structured key-value records (JSON or logfmt), at a level that means something. `ERROR` means "a human should act." Include enough context (ids, not secrets) to debug the event six months from now, with no access to your memory of today.

**Why:** A log line is written once and read under pressure months later. An interpolated string is unparseable at scale — you can't filter, count, or alert on it. Key-value is queryable: filter by `order_id`, group by `level`, alert on a field. Levels give the firehose a dial: if everything is `INFO`, the real `ERROR` drowns. And logs leak: a line with a password, bearer token, or PAN is a breach sitting in your aggregator's index. Log the *id*, never the secret.

**How to apply:**
- Use a structured logger (`pino`, `zerolog`, `structlog`, `slog`, `serilog`) and pass fields as key-value, never via string interpolation.
- Pick the level by **what it asks of the reader**, not by vague severity:
  - `ERROR` — something failed and a human should look (it should be alertable; if no one needs to act, it's not an error).
  - `WARN` — degraded but handled (retry succeeded, fell back, approaching a limit).
  - `INFO` — a notable business event (order placed, user registered) — sparse by design.
  - `DEBUG` — developer detail, off in production by default.
- Attach context fields every reader will want: ids (`user_id`, `order_id`, `request_id`), the operation, the outcome, the duration. Make ids consistent across the codebase (principle 3 depends on it).
- **Never** log secrets, credentials, tokens, full PANs, or full PII — log identifiers and redacted forms. ([[security-fundamentals]] owns the trust-boundary rule; this is its application to what you *write* into logs, mirroring the repo's `protect-secrets.sh` guard on what you *read*.)

**Example:**
```ts
// Bad — unparseable, no level discipline, leaks the token, no ids to correlate
console.log("user logged in " + email + " token=" + jwt)

// Good — structured, leveled, correlatable, no secret
log.info({ event: "user.login", user_id: user.id, request_id: ctx.requestId, method: "password" })
log.error({ event: "payment.failed", order_id: o.id, request_id: ctx.requestId,
            amount_cents: o.totalCents, reason: "card_declined", provider_code: "do_not_honor" })
// note: user_id not email, provider_code not raw card data
```

---

### 3. Correlate — one id threaded through every log and across every boundary

**Rule:** Stamp each request with a correlation id (request id / trace id) at the edge, attach it to every log line that request produces, and propagate it across every service and queue boundary it crosses. Without it you cannot reconstruct what happened.

**Why:** Once a request fans out across services or async hops, logs from different processes interleave. Without a shared id, "what happened to order 8821" is unanswerable — you can't know which lines belong together. With a correlation id, one filter pulls the whole causal story. It costs one header and one log field and is the highest-leverage observability investment. The id must survive every boundary — drop propagation at one hop and the trace dead-ends there.

**How to apply:**
- Generate (or accept from the inbound header) a correlation id at the edge — gateway, first handler, message consumer.
- Bind it to the request context (async-local storage, context object, MDC) so every log call inside that request picks it up automatically — don't thread it by hand through every function signature.
- Propagate outbound: set the trace header on every HTTP/gRPC call; copy it into every published message's metadata; include it in every enqueued job.
- Standardize on **W3C Trace Context** (`traceparent`) if you can — it's what OpenTelemetry and most vendors speak, so the id survives across third-party hops.
- On the consume side of a queue, *read the id back out* of the message and rebind it — a worker that generates a fresh id severs the chain to the producer.

**Example:**
```ts
// Edge: adopt inbound id or mint one, bind to context
const requestId = req.headers["x-request-id"] ?? crypto.randomUUID()
withContext({ requestId }, () => handler(req))   // every log inside now carries request_id

// Outbound HTTP — propagate, don't drop
await fetch(url, { headers: { "x-request-id": ctx.requestId, traceparent: ctx.traceparent } })

// Publishing to a queue — id rides in metadata, not lost at the async hop
await queue.publish(topic, payload, { headers: { "x-request-id": ctx.requestId } })

// Consuming — REBIND from the message, don't mint a fresh one (that severs the chain)
const requestId = msg.headers["x-request-id"]
withContext({ requestId }, () => process(msg))
```

---

### 4. Metrics that answer questions — RED for services, USE for resources, percentiles not averages

**Rule:** Don't emit metrics at random. For a request-serving **service**, measure RED: **R**ate, **E**rrors, **D**uration. For a **resource** (CPU, pool, disk, queue), measure USE: **U**tilization, **S**aturation, **E**rrors. Report duration as percentiles, never as a mean.

**Why:** "Add some metrics" produces a junk drawer no one reads. RED and USE are checklists that guarantee metrics answer the questions you'll ask in an incident. Service: rate, errors, duration cover "is this healthy" almost completely. Resource: utilization, saturation, errors localize a bottleneck fast. Averages lie: 95 requests at 50ms + 5 at 10s = 550ms mean — a latency *no single user experiences*. The slow 5 file the tickets; only p99 shows them.

**How to apply:**
- For each service/endpoint, emit: a **counter** for request count (the rate, by route and status), a **counter** for errors (so you can compute error ratio), and a **histogram** for duration (so you can read percentiles).
- For each constrained resource — DB connection pool, thread pool, queue, cache, disk — emit utilization (in use / capacity), saturation (waiting / rejected / queue depth), and error count.
- Read latency as **p50/p95/p99**, never `avg`. Use a histogram metric type so percentiles are computed correctly server-side — you cannot average pre-aggregated percentiles across instances.
- Label metrics by the dimensions you'll slice by (route, status_class, region) — but mind cardinality (principle 7).
- Counters for things that only go up (requests, errors), gauges for levels (pool in-use, queue depth), histograms for distributions (latency, payload size).

**Example:**
```
# RED for the checkout service
http_requests_total{route="/checkout", status="200"}        counter   → rate & error ratio
http_requests_total{route="/checkout", status="500"}        counter
http_request_duration_seconds_bucket{route="/checkout"}     histogram → p50/p95/p99

# USE for the DB connection pool it depends on
db_pool_connections_in_use / db_pool_size                   → utilization
db_pool_wait_queue_depth                                    → saturation
db_pool_acquire_timeouts_total                              → errors

# Bad: a single avg gauge that hides the tail
checkout_latency_avg_ms  723   ← means nothing; whose latency? the p99 could be 30s
```

---

### 5. Alert on symptoms users feel, not on causes — and make every alert actionable

**Rule:** Page on the symptom a user experiences (requests failing, requests slow, SLO budget burning), not on a cause (`CPU > 80%`, `memory high`). Every alert that pages a human must be actionable — if there's nothing to do, it shouldn't page.

**Why:** Causes are not outcomes. High CPU might be invisible to users. Paging on causes produces false alarms; false alarms train on-call to ignore the pager; alert fatigue is how good monitoring leads to *worse* response. The fix: alert on what the user feels — errors, slow requests, SLO budget burning. Causes belong on dashboards consulted *after* a symptom fires. The actionability test: "when this fires at 3 a.m., is there a specific thing to do?" If the honest answer is "look and go back to sleep," it's a dashboard panel, not an alert — demote it.

**How to apply:**
- Alert on **SLO burn rate** (principle 6), elevated error ratio, and latency-percentile breach — symptoms. Use **multi-window burn-rate** alerts (each alert pairs a long window with a short one — e.g. page on 1h AND 5m both burning; ticket on 6h AND 30m) so you page on real budget loss, not a one-minute blip.
- Put causes (CPU, memory, GC, pool saturation) on **dashboards**, not pagers — they're diagnostic context, consulted after a symptom fires.
- For every paging alert, write the **runbook link** and the first action into the alert itself. No runbook → not ready to page.
- Tier by urgency: **page** = user-facing and needs action now; **ticket** = needs attention this week; **dashboard** = context only. Most things are not pages.
- Periodically audit: every alert that fired and required no action is a candidate for deletion or demotion.

**Example:**
```
# Bad — a cause, fires constantly, nothing to do, trains people to ignore
ALERT HighCPU  IF  cpu_usage > 80%  FOR 5m   → pages at 3am during a harmless batch job

# Good — a symptom users feel, actionable, with a runbook
ALERT CheckoutErrorBudgetFastBurn
  IF   error_budget_burn_rate(slo="checkout-availability", window="1h") > 14
   AND error_budget_burn_rate(slo="checkout-availability", window="5m") > 14
  FOR  2m
  ANNOT runbook="https://wiki/runbooks/checkout-availability"
        summary="Checkout burning 30-day budget 14x — see runbook step 1: check inventory svc"
```

---

### 6. Define SLI/SLO/error budgets — measure "healthy" before you alert on it

**Rule:** Before you can alert meaningfully or make a reliability tradeoff, define what "healthy" *measurably* means: an **SLI** (the metric), an **SLO** (the target on it), and the **error budget** (1 − SLO) that the target implies.

**Why:** "Is the service healthy?" is unanswerable without a number. An **SLI** measures one user-facing quality (fraction of `/checkout` requests non-5xx and < 500ms). An **SLO** sets the target (99.9% over 30 days). The **error budget** is what the target permits to fail (0.1% ≈ 43 min/month) — the currency for reliability-vs-velocity decisions: budget left → ship; exhausted → stabilize. Without an SLO you either chase 100% (infinitely expensive) or have no bar at all (every degradation is an argument).

**How to apply:**
- Pick SLIs that reflect **user experience**, expressed as good-events / valid-events: availability (non-5xx ratio), latency (fraction under a threshold), correctness/freshness where relevant. One to three per service — not dozens.
- Set the SLO target from what users actually need, not from "as high as possible." 99.9% and 99.99% differ by 10× the cost; justify the extra nine.
- Compute the error budget and *use it*: it's the shared currency between "ship faster" and "stabilize." Burn it fast → reliability work; budget healthy → feature velocity.
- Drive principle-5 alerts off **burn rate** against the budget, not off raw thresholds — that's what makes them symptom-based and tunable.

**Example:**
```
SLI:  proportion of POST /checkout requests that are non-5xx AND < 500ms
SLO:  99.9% over a rolling 30 days
Error budget:  0.1% of requests  →  over 30 days ≈ 43m12s of total unavailability allowed

Budgeting in practice:
  budget 80% remaining, mid-month  →  green: ship the risky migration
  budget exhausted on day 12       →  freeze risky deploys, spend remaining cycle on reliability
  one bad deploy burned 40% in 1h  →  fast-burn alert fired (principle 5), roll it back
```

---

### 7. Cost and cardinality discipline — sample and budget, or the bill and the noise bury you

**Rule:** Telemetry is not free. High-cardinality metric labels can multiply your time-series count into the millions; a debug-log firehose can cost more than the service it watches and bury the one signal that mattered. Choose labels, sample, and budget retention deliberately.

**Why:** Two failure modes. **Cardinality**: every unique label combination is a separate stored time series. A `user_id` label on a service with 1M users = 1M series — the backend falls over and the bill explodes. **Volume**: debug-logging every request in prod generates terabytes and buries the one `ERROR` in ten million lines. More telemetry past a point is more cost and more noise, not more observability. High-cardinality ids belong in logs/traces (built for per-event detail), never in metric labels.

**How to apply:**
- **Metric labels**: only bounded, low-cardinality dimensions — `route`, `status_class`, `region`, `method`. **Never** `user_id`, `order_id`, `email`, `request_id`, raw URL with ids, or anything unbounded. Put those identifiers on logs/traces instead.
- Watch derived cardinality: a `route` label with un-templated paths (`/order/8821`, `/order/8822`, …) is secretly unbounded — template it to `/order/:id`.
- **Sample** high-volume traces and logs: keep all errors and slow requests, sample a small percentage of normal successes (head or tail sampling). You don't need every healthy request's full trace.
- Keep production at `INFO`; make `DEBUG` switchable per-request or per-service for incidents rather than always-on.
- Set **retention** by value: detailed traces days, aggregated metrics months/years (they're cheap), raw debug logs short. Budget ingestion and review the bill — runaway telemetry cost is a real outage-of-the-finance-kind.

**Example:**
```
# Bad — user_id label: 1 metric × 1M users = 1M time series, backend dies, bill explodes
http_requests_total{route="/checkout", user_id="u_91", status="200"}

# Good — user_id lives in the log (per-event detail), metric stays low-cardinality
http_requests_total{route="/checkout", status_class="2xx"}        # bounded labels only
log.info({ event: "checkout.ok", user_id: "u_91", request_id: ctx.requestId })   # detail here

# Bad — un-templated path is secretly unbounded cardinality
http_requests_total{route="/order/8821"}   # a new series per order id

# Good — templated, bounded
http_requests_total{route="/order/:id"}

# Sampling: keep the signal, drop the bulk
trace_sample_rate: errors=1.0, slow(>1s)=1.0, normal_success=0.01
```

---

## Pre-flight checklist

Before shipping runtime code with a new failure mode, wiring telemetry, or writing an alert, run through these:

1. **Pillars:** for each question I'll ask in an incident, am I emitting the right pillar — metric for "that/how many," trace for "where," log for "why"? Am I not abusing one pillar to do another's job?
2. **Structured + leveled logs:** are logs key-value (not concatenated strings), at a level that means something (`ERROR` = act), carrying the ids/context a stranger needs in six months — and free of secrets and PII?
3. **Correlation:** does a correlation/trace id get minted at the edge, ride on every log line automatically, and propagate across every HTTP call, queue message, and job — *and get rebound* on the consume side?
4. **Metrics that answer questions:** for each service do I have RED (rate/errors/duration), for each resource USE (utilization/saturation/errors), and is latency a percentile (p95/p99), never an average?
5. **Symptom alerts:** does each paging alert fire on something a user feels (errors, latency, SLO burn) rather than a cause (CPU%), and is every page actionable with a runbook?
6. **SLO defined:** is there an SLI/SLO/error budget that makes "healthy" a number, so the alerts have something real to fire against and reliability tradeoffs have a currency?
7. **Cost & cardinality:** are metric labels all low-cardinality (no `user_id`/raw ids — those go in logs/traces)? Are high-volume traces/logs sampled, levels sane in prod, retention budgeted?

If any answer is "I don't know," stop and find out before writing.

## When to skip this skill

- Throwaway scripts and prototypes deleted within the hour — a `print` is fine.
- Pure offline or library code with **no runtime operational surface** — a parser, a pure data transform, a math utility that another service operates. (Its *caller's* op surface is where this skill applies.)
- Trivial config edits with no new failure mode (a copy tweak, a formatter rule, a constant bump).
- Local-only one-off debugging where the telemetry will never reach production.

For anything else — runtime code that introduces a new way to fail or a new operation to watch, a logging/metrics/tracing change, an SLO or alert definition, or diagnosing a production blind spot — these fundamentals apply. This skill backs the `## Observability` section of `plan.md`: when a `feat`/`fix` ships runtime code adding a new failure mode or op surface, that section names the new log line + metric, and this skill is the standard it's held to.

## How to use this skill in a conversation

Always-on for runtime observability work — `.claude/rules/fundamentals.md` owns the trigger and run order (it's cross-cutting, applied last). Don't ask the user to opt in; if the task matches *When to skip*, say so in one sentence and proceed.

Apply the principles inline, not after the fact: when a code path adds a failure mode, name its metric (RED/USE), its failure log (with ids, no secrets), and whether a trace must span it *alongside the code* — not later; drive any alert off an SLI/SLO + burn rate with a runbook action (an alert with no action is a dashboard panel); for a prod blind spot, name the missing evidence and add the instrumentation so the next incident is shorter. The pre-flight checklist above is the standard to hold the work to. For non-obvious calls (sampling rate, dropping a label for cardinality, an SLO target) say *why* in one sentence — tie instrumentation to the failure mode it illuminates, don't emit telemetry silently.

## Reference files

Deeper guides for the principles. Read the one that matches the work in front of you; you don't need to read them all upfront.

- `references/logs-metrics-traces.md` — structured-log field conventions and level-to-action mapping, RED/USE metric recipes (counter/gauge/histogram), trace/span basics and correlation-id propagation across HTTP/queue boundaries, a worked SLI/SLO/error-budget example with burn-rate alerting, and the cardinality/cost pitfalls with concrete do/don't.
