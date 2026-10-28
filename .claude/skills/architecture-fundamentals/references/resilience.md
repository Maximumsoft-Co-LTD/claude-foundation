# Resilience

Every cross-process call can fail. The outage script is always the same: a
dependency blips, connection pools fill with hung waits, the upstream stops
responding, and one blip cascades system-wide.

```ts
// Bad — default-infinite timeout, no retries, no breaker, no fallback
const profile = await fetch(`${userService}/profile/${id}`).then(r => r.json())

// Good — bounded, retried with backoff, circuit-broken, graceful fallback
const profile = await breaker.call(() => withTimeout(2000, () =>
  httpClient.get(`/profile/${id}`, { retries: 2, backoff: { initial: 100, max: 500, jitter: 0.2 } })))
  .catch(() => CACHED_OR_DEFAULT_PROFILE)
```

## Timeouts and time budgets

Node `fetch`, Go `http.DefaultClient`, Python `requests`, and most ORMs
default to no timeout. Every outbound call gets an explicit connection
timeout, read timeout, and overall deadline, shorter than the caller's, with
budget left for retries; pass the deadline down the chain.

```
User → A (5 s budget) → B (4 s timeout) → C (3 s timeout; B keeps 1 s for itself)
```

Inner timeouts longer than outer ones leak work the user stopped waiting for.

## Retries, backoff, budgets

Retry only idempotent operations (or ones guarded by an idempotency key) on
retryable errors: network errors, timeouts, 5xx, 408, 429. Never retry other
4xx or application-level "your data is invalid". Cap at three to five
attempts for sync calls. Back off exponentially with jitter:

```
delay_n = min(max_delay, initial × multiplier^(n−1)), jittered ±20%
initial=100 ms, multiplier=2, max=5 s
```

Cap retries service-wide as a fraction of base request rate (about 10%) so a
downstream slowdown cannot amplify into a thundering herd; service meshes
(Envoy, Istio, Linkerd) implement retry budgets natively.

## Circuit breakers

A state machine per dependency: closed (count failures) → open (fail fast
for a cool-down) → half-open (a few test requests decide). Trip on N
consecutive failures, a failure-rate threshold, or sustained latency. Use a
library (Resilience4j, Polly, opossum, gobreaker, pybreaker); the half-open
transition is where hand-rolled breakers hide bugs. One breaker per
dependency, not per service.

## Bulkheads and load shedding

Separate thread pools, connection pools, or semaphores per dependency so one
slow dependency cannot exhaust what the others need. Under overload, shed
deliberately before the system sheds itself: rate limit at the edge (`429`
with `Retry-After`), cap in-flight requests (`503`), use adaptive
concurrency, and drop low-priority traffic before the checkout path.

## Graceful degradation

For every dependency decide before the incident: the request fails (on the
critical path), we return a degraded response (cached value with a stale
indicator, a default, a feature flag, an async fill-in), or it does not
matter (maybe the dependency is not needed on this path). Most "5xx during a
downstream blip" incidents are undecided degraded cases.

## Health checks

**Liveness** ("is the process functioning") is cheap and never checks
dependencies; a DB blip must not trigger a mass restart. **Readiness** ("can
this instance serve now") may check dependencies, and flips to not-ready
before the listener closes so the load balancer drains traffic.

## Operational concerns

Stateless components scale behind a load balancer; state lives in a shared
store. Every cache has an invalidation story (TTL or explicit; read-through,
write-through, or aside; stampede protection). Every cross-component call
crosses a trust boundary. Know rough throughput per component and the next
bottleneck. Every component has a deploy story, a rollback story, and a
runbook with its top failure modes. Telemetry and SLOs are
[observability-fundamentals](../../observability-fundamentals/references/logs-metrics-traces.md).

## Chaos testing

Untested resilience is theoretical. A quarterly game day finds bugs no suite
catches because they live between components. Start with: kill a random
instance (does the LB drain?); black-hole the DB for 30 s (do timeouts trip,
do retries back off?); make a downstream return 500 for 1% (does the breaker
trip at the right rate, does the fallback work?); add 500 ms of latency
(does the time budget hold?).
