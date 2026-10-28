# Communication

## Sync or async, deliberately

Sync couples in time: a slow callee makes a slow caller; a down callee makes
a down caller; a chain of three 99.9% services delivers 99.7%. Async
decouples time but brings eventual consistency, at-least-once delivery, and
ordering questions. Choose from whether the caller needs the result now.

| Question | Sync | Async |
|---|---|---|
| Caller actively waiting, result feeds the next decision? | yes | no |
| Caller's response can be sent before the work finishes? | no | yes |
| Many independent consumers of this fact? | no (N calls) | yes |
| Dependency slow or flaky? | couples availability | decouples it |
| Staleness of seconds matters? | fresh | eventual |
| Smoothing a burst, or expensive work on a user-facing path? | no | yes |

```
"Charge the card during checkout"      → sync: the next screen depends on it
"Send the welcome email after signup"  → async: publish UserSignedUp; the
                                         emailer retries and dead-letters
"Recompute the search index"           → async: seconds of staleness is fine
```

"I need to know it succeeded" needs a status mechanism (webhook, status
endpoint, "queued" response), not sync. Avoid sync chains deeper than two
hops; fan out in parallel and gather. Async is not free: idempotency, outbox,
and a broker to operate (`queue-fundamentals`).

## Transports

| | REST/JSON | gRPC | GraphQL |
|---|---|---|---|
| Best for | public APIs, browsers, cacheable reads | internal, latency-sensitive, polyglot | aggregating reads for one client shape |
| Strengths | universal, cacheable, curl-debuggable | binary, typed, streaming, generated clients | client-driven shape, no over-fetch |
| Weaknesses | verbose, weak typing | needs a gateway for browsers | hard caching, N+1 resolvers, harder authz |

Async topologies: event log (one producer, many independent replayable
consumers), task queue (one producer, a worker pool), webhook (an external
consumer the producer knows by URL; the producer retries and signs). Two
services coordinating per request are usually sync RPC. Do not mix
transports without a reason.

## Eventual consistency by default

For each cross-boundary write ask how stale a reader can be without the
business breaking. "Never" is rare; when it is real, keep the operation
inside one component, one database, one transaction. Everything else:
write the source of truth → publish an event (outbox) → downstream catches
up. Multi-step cross-component workflows start as sagas with compensating
actions; 2PC only inside a narrow, homogeneous boundary. Surface staleness
(`updated_at`, "refreshed 2 s ago"); hidden staleness is worse than visible.

```
Wrong: dashboard needs the balance "instantly" → cross-service transaction
       that cannot even render a stale value when billing is down.
Right: Billing owns the balance; the dashboard subscribes to balance-changed
       events and shows "updated 2 s ago".
Wrong: eventually consistent inventory for a flash sale → oversold seats.
Right: Inventory is the consistency boundary; decrement-and-reserve in one
       conditional UPDATE; others consume reservation events.
```

## Evolve contracts; never break them

Producer and consumer deploy on different schedules, so a breaking change
without a version is an incident. Add optional fields with defaults; never
rename, remove, or change a field's type or semantics in place; grow enums
and make consumers tolerate unknown values; ignore unknown fields and
default missing optional ones (tolerant reader); accept an `Idempotency-Key`
on every public mutation because it is the only way clients can retry
safely; put a schema registry in CI so a breaking change fails the build.

Events outlive every other artifact: a replayed event must still parse.
Backward compatibility (new schema reads old data) is the usual need;
forward compatibility (old consumers read new data) is required when
consumers cannot all upgrade at once. When you must break, carry
`schema_version`, run both versions in parallel, and stop emitting v1 only
after every consumer confirms and the replay window has aged out.

Versioning schemes, the deprecation lifecycle (announce → mark →
instrument per consumer → remove at zero, not "low"), and idempotency-key
mechanics are in
[api-design evolution](../../api-design-fundamentals/references/evolution.md).
