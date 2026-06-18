---
name: architecture-fundamentals
description: Apply system-level architecture fundamentals before designing how modules, services, processes, APIs, events, or teams relate at runtime. Use for service/module boundaries, ownership, sync vs async, resilience, consistency, observability, API/event contracts, scaling, extraction, strangler-fig work, or any cross-component call. If the open question is business meaning, language, bounded contexts, or subdomain investment, use ddd-strategic first; this skill then decides runtime/component boundaries, communication, failure modes, and contract evolution. Skip purely within-one-service code work, throwaway prototypes, and code-level refactors with no cross-boundary concern.
---

# Architecture Fundamentals

## Skills this sits next to

Run order, when-to-use, and the ddd→…→architecture→queue chain live in the router (`.claude/rules/fundamentals.md`, including "Seams that blur"). Architecture-specific distinctions to keep in mind:

- [[hexagonal-backend]] defines how *one* service is built internally; this skill defines how multiple services relate. The two compose.
- [[queue-fundamentals]] — this skill decides *whether* a queue belongs; queue-fundamentals decides how to operate it correctly.
- [[debug-fundamentals]] — when a system bug crosses boundaries, this skill names the fix layer; debug-fundamentals finds the cause.

## The 7 principles

Apply them in roughly this order — the early ones unblock the later ones.

---

### 1. Draw the boundaries before the boxes

**Rule:** Decide what's *one thing* before deciding whether to put it in one module, one service, or one team. Boundaries follow the domain, not the org chart or the technology you happen to like.

**Why:** Every painful rewrite is a boundary problem. Conway's Law: the system mirrors your communication structure — if you don't choose boundaries deliberately, your org chart, your last hire, and your "we already have a service for that" reflex will choose them for you, and those choices last a decade.

**How to apply:**
- Name the **bounded contexts** — clusters of concepts where words have one definition. "Customer" in billing is not the same as "customer" in CRM; one model cannot serve both. The boundary goes where the language changes.
- Within a bounded context, prefer the **smallest deployment unit that lets the team own a coherent piece of business value**. A new service is a permanent operational cost — separate deploy, monitoring, on-call, a network call where a function call used to be. Pay that cost only when the boundary buys genuine independence a module couldn't. **The 2024 Fowler/Newman consensus is "monolith unless you have a really good reason"** — extraction to services (via the strangler fig, see [[boundaries]]) happens when a specific piece earns its way out. Starting microservices-first is a known anti-pattern.
- **Boundaries hide implementation.** If exposing internals is the only way to make a feature work across a boundary, the boundary is in the wrong place. Move it before cementing it.
- Watch the "two services that always deploy together" smell. They're really one. Either merge them, or fix the contract so changes don't ripple.
- See [[boundaries]] for bounded contexts, Conway's Law, extracting a service from a monolith, and anti-corruption layers.

**Example:**
```
Wrong: split "user profile" and "user authentication" into two services because they "feel different".
       Every signup touches both. Every login changes both. They redeploy in lockstep forever.
       Two services' worth of operational cost for one cohesive concept.

Right: one Identity service owns the user concept end-to-end. Months later, when notifications grow
       into a multi-channel product with its own backlog and on-call rotation, pull it out then —
       when the boundary has earned its cost.
```

---

### 2. One owner per piece of data

**Rule:** Every piece of state has exactly one component that owns its write path. Everyone else reads through that owner — via API, an event stream, or a read-only projection — and never writes directly to the owner's store.

**Why:** Two writers to the same data = two truths, no tie-breaker. "The data is right in service A but the dashboard shows it wrong" and "we changed it in one place but the other place never noticed" both trace back to unnamed ownership. A single owner is one place to enforce invariants, run migrations, and add new fields.

**How to apply:**
- Pick the component whose **business rules govern the data** — that's the owner. Billing owns invoices, even though Support reads them.
- Other components have three legitimate options, in order of preference:
  1. **Read through the owner's API.** Always consistent at read time, costs a network hop.
  2. **Subscribe to the owner's event stream** and build a local projection. Fast reads, eventually consistent, requires the outbox pattern (see [[queue-fundamentals]]).
  3. **Shared read-only view or read replica.** Last resort — couples the consumer to the owner's storage schema.
- **No shared writable store.** "We'll just have both services write to the same table to keep things simple" is the single most regretted decision in service-oriented systems. The "simplicity" lasts six weeks; the cleanup lasts six quarters.
- If two components genuinely co-own a concept, you have two concepts hiding inside one name. Each owns its own version.

**Example:**
```
Wrong: Orders and Inventory both write to `products` table. Schema migrations need both teams.
       Bugs ping-pong: "who set the stock to -1?"

Right: Catalog owns `products`. Inventory writes to its own `stock_levels` keyed by product ID.
       Orders reads display name through Catalog's API. One owner per row, one place for invariants.
```

---

### 3. Choose sync or async for each interaction, deliberately

**Rule:** For every cross-boundary call, name whether the caller must wait for the callee to finish (sync) or can move on while work happens later (async). The right answer follows from whether the caller needs the result *now*, not from what's fashionable.

**Why:** Sync couples in time — callee slow means caller slow; callee down means caller down. Long chains become outage multipliers ("service A waits on B waits on C waits on D, which has a 99.5% SLO, so the chain delivers 98%"). Async decouples time but introduces eventual consistency, duplicate-delivery, and ordering. Picking wrong is a permanent tax: sync-when-async-works creates cascade failures; async-when-sync-needed creates "I saved and nothing changed… then it did later."

**How to apply:**
- **Sync for:** queries the user is actively waiting on, operations where the caller needs the result to make the *next* decision, simple reads.
- **Async for:** side effects the caller doesn't need to wait on (email, indexing, analytics), fan-out to many independent consumers, smoothing bursts, decoupling deploy/scale/failure between components.
- **The wait-and-poll pattern is async with extra friction.** If the caller polls a status endpoint, you needed async events with a status update or a webhook.
- **Chain depth matters.** Fan-out in parallel and gather rather than chain serially. Per-hop timeouts must fit inside the overall budget (see principle 4).
- **Async ≠ free.** At-least-once delivery, idempotency, outbox to avoid lost events, and operating a broker. Pay it where the decoupling is worth it.
- See [[communication]] for the decision matrix, sync transport choices, and relationship to [[queue-fundamentals]] for async mechanics.

**Example:**
```
"Charge the customer's card during checkout"
  Sync: user is staring at a spinner; next screen depends on whether charge succeeded.

"Send the welcome email after signup"
  Async: publish UserSignedUp; emailer consumes, retries on failure, DLQs on permanent failure.
        Signup never breaks because SMTP is having a moment.

"Recompute search index after a product update"
  Async: seconds of search staleness is fine; blocking the product API on indexing is not.
```

---

### 4. Every cross-process call can fail — design for it

**Rule:** Set explicit timeouts, bounded retries with backoff and jitter, circuit breakers around dependencies, and bulkheads between failure domains. No infinite waits. No retry storms. No code path where one slow dependency takes the whole system down.

**Why:** HTTP clients and ORMs default to infinite or 30-second timeouts — genuinely dangerous. The outage script is always the same: a dependency blips, connection pools fill with hung waits, the upstream becomes unresponsive, and a one-component blip cascades system-wide. Designing for failure costs hours upfront; not designing for it costs days of recovery and customer trust.

**How to apply:**
- **Timeouts everywhere.** Every outbound call (HTTP, DB, broker, gRPC, external API) gets an explicit timeout, shorter than the upstream's, with budget left for retries.
- **Retries: bounded, with exponential backoff and jitter.** Only retry **idempotent** operations. Don't retry permanent errors (most 4xx except 408/429) — those just delay the inevitable.
- **Retry budget.** A service might cap retries at X% of its request rate. Without a budget, retries amplify a downstream blip into a thundering herd that prevents recovery.
- **Circuit breakers** around dependencies: after N failures, fail-fast for a cool-down period instead of stacking hung calls; half-open to test recovery. (Resilience4j on JVM, Polly on .NET, opossum on Node, gobreaker on Go, pybreaker/tenacity on Python. Netflix Hystrix is end-of-life — don't pick it for new work.)
- **Bulkheads** isolate failure: separate thread pools, connection pools per dependency. One slow dependency cannot exhaust resources another needs.
- **Graceful degradation.** When a non-critical dependency is down, return a degraded but useful response (cached data, defaults) rather than a 500. Decide what "non-critical" means *before* the incident.
- See [[resilience]] for patterns, numbers, library choices, and worked examples.

**Example (TypeScript sketch):**
```ts
// Bad — default-infinite timeout, no retries, no breaker, no fallback.
const profile = await fetch(`${userService}/profile/${id}`).then(r => r.json())

// Good — bounded, retried with backoff, circuit-broken, with a graceful fallback.
const profile = await breaker.call(
  () => withTimeout(2000, () =>
    httpClient.get(`/profile/${id}`, { retries: 2, backoff: { initial: 100, max: 500, jitter: 0.2 } })),
).catch(() => CACHED_OR_DEFAULT_PROFILE)
```

---

### 5. Default to eventual consistency; treat strong consistency as opt-in

**Rule:** Across components, assume changes propagate eventually. Reach for strong cross-component consistency only when the business *genuinely* requires it — and accept the cost deliberately.

**Why:** Most "needs to be consistent" requirements relax when someone asks "for how long?" A 200ms propagation lag is invisible to users; engineering a distributed transaction to eliminate it costs availability, latency, and permanent complexity. On the other side, casual eventual consistency where the business needs strong (charging the right amount, not overselling the last unit) leads to irreconcilable data and refund emails.

**How to apply:**
- For each cross-boundary write, ask: **how stale can a reader be without the business breaking?** Seconds? Minutes? Never?
- "Never" is rare. When it's real, **keep the consistent operation inside a single transactional boundary** — one component, one database, one transaction. Do not reach across components to enforce strong consistency.
- Most cross-component patterns: write source-of-truth → publish event → downstream catches up. Combine with the **outbox** pattern (see [[queue-fundamentals]]).
- For multi-step workflows across components, **start with sagas and compensating actions**. Reach for **2PC** only inside a narrow, homogeneous boundary where you can't tolerate a compensating window. The 2024 stance: sagas for user-facing flows, 2PC where participants and failure modes are tightly controlled.
- **Surface staleness to readers.** `updated_at` timestamps, "last refreshed N seconds ago." Hidden staleness is worse than visible staleness.

**Example:**
```
Wrong: "Dashboard must show the right account balance instantly" → synchronous cross-service
       transaction. Slow, brittle, breaks when billing is down — the dashboard can't even render
       a stale value because the design depended on freshness.

Right: Billing owns the balance. Dashboard subscribes to balance-changed events, caches projection.
       "Updated 2s ago." Strong consistency lives inside Billing; everything outside is eventual.

Wrong: "Eventually consistent inventory is fine for flash sale" → oversold seats, refund emails.

Right: Inventory is the consistency boundary for stock. Decrement-and-reserve inside one
       transaction (conditional UPDATE WHERE qty > 0). Others consume reservation events.
```

---

### 6. Build observability in from day one

**Rule:** Every request path produces structured logs, useful metrics, and a trace that crosses every component boundary. Define SLIs and SLOs *before* you ship — not after the first outage.

**Why:** In a distributed system, "what happened" is a relationship across N components — you can't reconstruct it without correlation IDs, propagated trace context, and metrics over time. Teams that bolt observability on after the first outage spend months instrumenting while trust burns.

**How to apply:**
- **Three pillars, all on, structured.**
  - **Logs:** structured (JSON), with `trace_id` and `span_id` on every line. No bare `console.log("got here")`.
  - **Metrics:** **RED** for request paths (Rate, Errors, Duration) and **USE** for resources (Utilization, Saturation, Errors). Use histograms for latency — averages hide the tail.
  - **Traces:** OpenTelemetry (OTel) is the default — CNCF standard, vendor-neutral; as of 2025 logs joined traces and metrics as stable signals over OTLP. Trace context propagates across every hop. (Pick vendor-specific SDK only with hard reason; OTel is portable across Datadog, Honeycomb, Tempo, Jaeger, New Relic, X-Ray.)
- **Define SLIs and SLOs.** SLI = what you measure; SLO = the target; error budget = the gap. The budget funds feature velocity vs. reliability work.
- **Track DORA delivery metrics alongside SLOs.** Deployment frequency, lead time, change failure rate, and failed-deployment recovery time (renamed from MTTR in 2023) describe how *fast and safely* you ship; SLOs describe how *well the running system performs*.
- **Correlate everything.** One trace ID generated at the edge flows through every hop and into every log line. Without this, multi-hop debugging is archaeology.
- **Alert on symptoms, not causes.** Page on "users are seeing errors," not "CPU is over 80%."
- See [[observability]] for instrumentation patterns, SLI/SLO definition, and OpenTelemetry idioms.

**Example:**
```ts
// Bad — unstructured, uncorrelated, no measurable signal.
console.log("processing order", orderId)
try {
  await chargeCard(orderId)
} catch (e) {
  console.log("error", e)
}

// Good — structured, correlated, measurable. RED in three lines, trace propagation, error class.
log.info({ event: "order.charge.start", order_id: orderId, trace_id: ctx.traceId })
const stop = metrics.histogram("order.charge.duration_ms", { route: "checkout" }).start()
try {
  await chargeCard(orderId, { ctx })           // ctx propagates trace context to the downstream
  metrics.counter("order.charge", { result: "success" }).inc()
} catch (e) {
  metrics.counter("order.charge", { result: "failure", reason: classify(e) }).inc()
  log.error({ event: "order.charge.failed", order_id: orderId, trace_id: ctx.traceId, err: serialize(e) })
  throw e
} finally {
  stop()
}
```

---

### 7. Evolve contracts; don't break them

**Rule:** Treat every public API, event schema, and shared message format as a contract. Add fields and behaviors backwards-compatibly. Remove only after an honest deprecation cycle, long enough for every consumer to migrate.

**Why:** In any multi-component system, you can't atomically update producer and consumer — they deploy on different schedules. Breaking a contract turns "ship the feature" into "coordinate a multi-team rollout." Backwards-compatible evolution is invisible to consumers who haven't adopted it; a breaking change without versioning is an incident.

**How to apply:**
- **Add, don't replace.** New optional fields with defaults are safe. New required fields, renames, type changes, and removals are all breaks.
- **Version explicitly when you must break.** `/v1/orders` and `/v2/orders` coexist; events carry `schema_version`. Both versions run until consumption hits zero, then v1 is removed.
- **Tolerant reader.** Consumers ignore unknown fields; producers don't depend on consumers having every field.
- **Deprecation is a long horizon.** Announce → instrument (count usage by consumer) → wait until usage is **zero** (not "low") → remove. "We told them six weeks ago" is not a deprecation.
- **Idempotency keys are part of the public contract.** Any public mutation API accepts an `Idempotency-Key`. Not an optimization — the only way clients can safely retry.
- **Schema registries help.** Avro, Protobuf, JSON Schema with a registry encodes compatibility rules so CI rejects breaking changes before they ship.
- See [[communication]] for versioning patterns and the deprecation runbook.

**Example:**
```
Wrong: Rename `customer_email` to `email` in the user-created event. Half the consumers parse
       the old field name and break on next producer deploy. Roll back, hold a meeting, ship
       the rename over a quarter with manual consumer coordination.

Right: Add `email` alongside `customer_email`. Both fields populated. Mark `customer_email`
       deprecated. Track consumption metrics until zero. Then — only then — remove.
```

---

## Pre-flight checklist

Before designing or modifying anything that spans more than one component:

1. **Boundaries:** what bounded contexts are at play? Am I splitting things that change together, or merging things that don't?
2. **Ownership:** for every piece of data, can I name *exactly one* owner? Does every other access go through that owner's API, events, or derived projection?
3. **Sync vs async:** for every cross-component call, did I deliberately choose based on whether the caller needs the result now? Are sync chains short enough to fit in the latency budget?
4. **Failure:** does every outbound call have a timeout, bounded retry policy, and fallback or breaker? No "wait forever" paths?
5. **Consistency:** for each cross-boundary write, did I name the staleness budget? Is strong consistency confined to a single transactional boundary?
6. **Observability:** does each new path produce structured logs with trace ID, RED metrics, and a trace span? Is the SLI defined? Are alerts on symptoms?
7. **Contracts:** is every API/event change backwards-compatible? If I must break, did I version explicitly and instrument the deprecated path?

If any answer is "I don't know," stop and find out before shipping the design.

## Below the principles: operational concerns

- **Statelessness scales; statefulness needs a strategy.** A stateless component scales horizontally with a load balancer. State must live in a shared store so any instance can serve any request. Sticky-session and in-memory caches are real but require explicit thought about cache coherence.
- **Cache deliberately, with an invalidation story.** Decide: TTL or invalidation? Read-through, write-through, or aside? Stampede protection? "We'll add a cache" without those answers is how stale-data incidents are born.
- **Security boundaries are architectural.** Every cross-component call crosses a trust boundary; auth and authz live at the boundary. Secrets live in a secret store, not in code or env files. A compromised service should compromise the minimum.
- **Capacity planning is not optional.** Know the rough throughput each component must handle and where the next bottleneck will appear.
- **Operations: deploys, rollbacks, runbooks.** Every component has a deploy story, a rollback story, and an on-call runbook with the top five known failure modes and first-response steps.

## When to skip this skill

- Pure within-one-service code work — that's [[hexagonal-backend]] + [[programming-fundamentals]].
- Throwaway prototypes, internal scripts, one-shot data fixes, proofs-of-concept that will be deleted before production.
- Trivial CRUD or thin BFFs that only forward and reshape responses, with no domain rules, no async paths, no second component.
- Operational config tasks (a new env var, a dependency version bump) that don't change the shape of the system.

## Reference files

- `references/boundaries.md` — bounded contexts, module-vs-service decisions, Conway's Law, strangler fig, anti-corruption layers, boundary smells. Use for principle 1.
- `references/communication.md` — sync-vs-async decision matrix, REST/gRPC/GraphQL trade-offs, event-driven patterns, API versioning, event schema evolution, deprecation lifecycle. Use for principles 3 and 7.
- `references/resilience.md` — timeout budgets, retry policies, backoff and jitter, circuit breakers, bulkheads, graceful degradation, health checks, chaos testing. Use for principle 4.
- `references/observability.md` — structured logging, RED/USE methods, histograms, SLI/SLO, error budgets, OpenTelemetry, alerting on symptoms. Use for principle 6.

## How to use this skill in a conversation

Always-on for system-level architectural work (per `.claude/rules/fundamentals.md`). If the task is in "When to skip," say so in one sentence and proceed without it.

- **Designing a new system or feature spanning components** — walk the principles in order: name boundaries (1), data owners (2), sync/async choices (3), failure modes (4), consistency story (5), observability (6), contract shape (7). Show structure before code.
- **Adding a new cross-component call** — work through principles 3, 4, 6, and 7 explicitly.
- **Reviewing an existing system** — use principles as a checklist; cite the principle number when flagging an issue ("principle-2 violation: both Orders and Inventory write to `products`").
- **Splitting a monolith or merging services** — go to [[boundaries]] first.
- **Debugging a distributed incident** — trace back through principles: lost event → principle 7 or queue outbox; cascading outage → principle 4; stale data → principle 5; can't tell what happened → principle 6.
- When making a non-obvious call, say *why* in one sentence and cite the principle.
