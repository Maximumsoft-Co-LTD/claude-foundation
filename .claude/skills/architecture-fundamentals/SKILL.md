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

Apply them in roughly this order — the early ones unblock the later ones. Full rule/why/how-to-apply/example for each lives in the linked reference file.

| # | Principle | Compressed rule | Reference |
|---|---|---|---|
| 1 | Draw the boundaries before the boxes | Decide what's *one thing* before deciding whether it's one module, one service, or one team. Boundaries follow the domain, not the org chart or a technology preference. | `references/boundaries.md` |
| 2 | One owner per piece of data | Every piece of state has exactly one component that owns its write path; everyone else reads through that owner's API, event stream, or a read-only projection. | `references/boundaries.md` |
| 3 | Choose sync or async for each interaction, deliberately | For every cross-boundary call, name whether the caller must wait (sync) or can move on (async) — driven by whether the result is needed *now*, not by fashion. | `references/communication.md` |
| 4 | Every cross-process call can fail — design for it | Explicit timeouts, bounded retries with backoff/jitter, circuit breakers, and bulkheads. No infinite waits, no retry storms, no single dependency that takes the whole system down. | `references/resilience.md` |
| 5 | Default to eventual consistency; treat strong consistency as opt-in | Assume changes propagate eventually across components. Reach for strong consistency only where the business genuinely requires it, confined to one transactional boundary. | `references/communication.md` |
| 6 | Build observability in from day one | Every request path produces structured logs, RED/USE metrics, and a cross-component trace. Define SLIs/SLOs before shipping, not after the first outage. | `references/observability.md` |
| 7 | Evolve contracts; don't break them | Treat every API/event schema as a contract: add fields backwards-compatibly, version explicitly when you must break, deprecate on a long, honest horizon. | `references/communication.md` |

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

Statelessness/scaling, cache invalidation, architectural security boundaries, capacity planning, and deploy/rollback/runbook ownership — see `references/resilience.md` → "Operational concerns."

## When to skip this skill

- Pure within-one-service code work — that's [[hexagonal-backend]] + [[programming-fundamentals]].
- Throwaway prototypes, internal scripts, one-shot data fixes, proofs-of-concept that will be deleted before production.
- Trivial CRUD or thin BFFs that only forward and reshape responses, with no domain rules, no async paths, no second component.
- Operational config tasks (a new env var, a dependency version bump) that don't change the shape of the system.

## Reference files

- `references/boundaries.md` — principles 1 and 2's full rule/why/how-to-apply/example, plus bounded contexts, module-vs-service decisions, Conway's Law, strangler fig, anti-corruption layers, boundary smells.
- `references/communication.md` — principles 3, 5, and 7's full rule/why/how-to-apply/example, plus the sync-vs-async decision matrix, REST/gRPC/GraphQL trade-offs, event-driven patterns, API versioning, event schema evolution, deprecation lifecycle.
- `references/resilience.md` — principle 4's full rule/why/how-to-apply/example, plus the operational-concerns addendum, timeout budgets, retry policies, backoff and jitter, circuit breakers, bulkheads, graceful degradation, health checks, chaos testing.
- `references/observability.md` — principle 6's full rule/why/how-to-apply/example, plus structured logging, RED/USE methods, histograms, SLI/SLO, error budgets, OpenTelemetry, DORA metrics, alerting on symptoms.

## How to use this skill in a conversation

Always-on for system-level architectural work (per `.claude/rules/fundamentals.md`). If the task is in "When to skip," say so in one sentence and proceed without it.

- **Designing a new system or feature spanning components** — walk the principles in order: boundaries (1), data owners (2), sync/async choices (3), failure modes (4), consistency story (5), observability (6), contract shape (7). Show structure before code.
- **Adding a new cross-component call** — work through principles 3, 4, 6, and 7 explicitly.
- **Reviewing an existing system** — use principles as a checklist; cite the principle number when flagging an issue ("principle-2 violation: both Orders and Inventory write to `products`").
- **Splitting a monolith or merging services** — go to `references/boundaries.md` first.
- **Debugging a distributed incident** — trace back through principles: lost event → principle 7 or queue outbox; cascading outage → principle 4; stale data → principle 5; can't tell what happened → principle 6.
- When making a non-obvious call, say *why* in one sentence and cite the principle.
