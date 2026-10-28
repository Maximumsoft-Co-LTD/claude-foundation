---
name: architecture-fundamentals
description: "Use when deciding how services, runtimes, or deployables split, talk, fail, or scale. Skip single-process module design (programming-fundamentals) and domain meaning (ddd-strategic)."
---

# Architecture fundamentals

Draw the boundaries before the boxes; compare distinct designs when the
uncertainty is consequential.

## Steps

1. Split by cohesive ownership and rate of change, not technology or org chart.
   Settle business meaning first (`ddd-strategic`).
2. Give every durable fact exactly one write owner; others read through its
   contract, event stream, or projection.
3. Choose sync or async per interaction: synchronous only when the caller needs
   the result now. Default cross-boundary state to eventual consistency with a
   named staleness budget; confine strong consistency to one transaction.
4. Treat every cross-process call as fallible: latency budget, timeouts, bounded
   jittered retries, breakers/bulkheads, graceful degradation.
5. Make each critical path operable: structured events, correlation, an SLI, an
   owner, and a rollback path. Evolve contracts additively; version breaks and
   let old and new consumers overlap.
6. For each changed boundary record owner, callers, sync/async rationale,
   failure and consistency expectations, compatibility window, and rollback.

Then use `queue-fundamentals` for the async boundary,
`api-design-fundamentals` for the published contract, and `hexagonal-backend`
inside one service.

## Harness

Record boundary decisions in the active OpenSpec design; project providers
prove behavior through the harness. No parallel architecture plan or status
ledger; Build never stages or commits.

## References

- `references/boundaries.md` — split, merge, extraction, anti-corruption layers
- `references/communication.md` — sync/async matrix, consistency, contract evolution
- `references/resilience.md` — timeouts, retries, breakers, load shedding, health checks
- `../observability-fundamentals/references/logs-metrics-traces.md` — telemetry, SLOs, alerting
