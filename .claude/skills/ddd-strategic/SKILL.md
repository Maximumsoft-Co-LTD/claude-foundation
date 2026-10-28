---
name: ddd-strategic
description: "Use when business terms, bounded contexts, aggregates, or who owns a model are unclear. Skip generic CRUD and settled single-context code."
---

# Strategic DDD

Settle what a concept means and where that meaning is valid before deciding
runtimes.

## Steps

1. Classify each subdomain as core, supporting, or generic. Invest custom
   design in differentiation; buy, borrow, or keep it pragmatic elsewhere.
2. Discover boundaries from real workflows, events, actors, policies, and
   language shifts — not from a noun list or existing tables.
3. Keep one ubiquitous language per bounded context. When one word carries two
   meanings, record two concepts.
4. Name each context relationship: Shared Kernel, Customer/Supplier,
   Conformist, Anticorruption Layer, Open Host Service, Published Language, or
   Separate Ways.
5. Size aggregates around invariants that must change atomically; keep them
   small, reference others by identity, coordinate across aggregates eventually.
6. Keep internal domain events rich and private; translate cross-context
   integration events into narrow, versioned contracts at the boundary.

Capture only what resolves the active decision: changed terms, the changed
context map, the invariant behind each aggregate boundary, and event ownership.
Then use `programming-fundamentals` for value objects, `hexagonal-backend`
inside one context, and `architecture-fundamentals` for runtime boundaries.

## Harness

Changed vocabulary and boundary decisions go in the active OpenSpec design, not
a standalone glossary or ADR store. Project providers prove behavior through
the harness; Build never stages or commits.

## References

- `references/subdomain-classification.md` — core/supporting/generic and investment
- `references/event-storming.md` — event-first boundary discovery
- `references/bounded-contexts.md` — language, context maps, relationship patterns
- `references/aggregate-design.md` — aggregate sizing, invariants, events
- `references/failure-modes.md` — diagnostics when the model is going wrong
