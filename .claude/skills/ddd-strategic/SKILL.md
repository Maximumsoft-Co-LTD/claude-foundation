---
name: ddd-strategic
description: Apply strategic Domain-Driven Design before deciding where a business model lives and what language it speaks. Use for subdomain classification, bounded contexts, ubiquitous language, context mapping, event-storming/domain-storytelling, aggregate sizing, domain vs integration events, or any feature that spans contexts with real business rules. This skill decides semantic/model boundaries; [[architecture-fundamentals]] decides runtime/component boundaries, communication, resilience, and contracts after those meanings are clear. Skip generic CRUD, throwaway prototypes, single-context work, and pure code-level changes.
---

# DDD Strategic

Most "we need to split this service" or "this codebase is unintelligible" stories are model problems: a `Customer` class with thirty nullable fields, teams using `record`/`row`/`entity`/`account`/`user` for the same thing, in-house CRM/auth/invoicing built instead of bought, microservices drawn around technologies instead of domain boundaries. Each is the same missed fundamental: **the strategic half of DDD** — where the model lives, what language it speaks per place, and which parts deserve full domain investment.

The **tactical** half (aggregates, entities, value objects, repositories, domain services) is covered by the construction skills already in this library. The one tactical piece kept here is **aggregate sizing** — Vernon's four rules sit between strategic design and code in a way nothing else in the library covers.

## Skills this sits next to

The cross-skill run order, triggers, and the `ddd-strategic` ↔ `architecture-fundamentals` seam are owned by `.claude/rules/fundamentals.md` (canonical) — point there, don't restate the seam. What's specific to *this* strategic skill is where each tactical piece it produces is governed:

- [[programming-fundamentals]] — the code inside an aggregate or value object (illegal-state elimination, pure core, error handling).
- [[hexagonal-backend]] — layering within one bounded context (domain/application/infrastructure); aggregates and value objects live in the domain layer, repositories are ports.
- [[database-fundamentals]] — one bounded context's persistence: schema, transactions, indexes.
- [[queue-fundamentals]] — the integration-event channel: internal domain events may not need a broker; integration events cross contexts and need outbox, idempotency, DLQ.
- [[debug-fundamentals]] — when a bug crosses contexts, this skill names the structural fix; debug-fundamentals finds the cause.

## The 6 principles

Run roughly in this order — early ones unblock later ones. Full rule/why/how-to-apply/example for each lives in the linked reference file.

| # | Principle | Compressed rule | Reference |
|---|---|---|---|
| 1 | Classify the subdomain before applying DDD | **Core** = differentiator, full custom design, always build in-house. **Supporting** = necessary, build pragmatically. **Generic** = commodity, buy/OSS. Re-classify periodically — the boundary drifts. | `references/subdomain-classification.md` |
| 2 | Discover boundaries from events, not entities | Don't list nouns — run Event Storming (Big Picture / Process Modelling / Software Design) or Domain Storytelling with real domain experts. Boundaries reveal themselves where language, actors, or clock change. | `references/event-storming.md` |
| 3 | One ubiquitous language per bounded context | Build a per-context glossary ratified by domain experts; rename code ruthlessly to match it. The same word in two contexts is two different concepts — name them distinctly. | `references/bounded-contexts.md` |
| 4 | Name the relationship between contexts deliberately | For each integrating pair, pick and name one of seven context-mapping patterns — Shared Kernel, Customer/Supplier, Conformist, Anticorruption Layer, Open Host Service, Published Language, Separate Ways. Draw a one-page context map. | `references/bounded-contexts.md` |
| 5 | Size aggregates around invariants, not entities | An aggregate is a transactional consistency boundary. Vernon's four rules: model true invariants, design small, reference other aggregates by ID, use eventual consistency outside. | `references/aggregate-design.md` |
| 6 | Separate internal domain events from integration events | Internal events are rich and evolve freely inside a context. Integration events crossing a context boundary are a narrow, versioned contract, translated via an outbox — never publish the internal event directly. | `references/aggregate-design.md` |

## Pre-flight checklist

Before strategic DDD work (designing or naming a context, integrating with another team, sizing an aggregate, running a discovery workshop, naming an event contract):

1. **Subdomain classification:** is the subdomain **core**, **supporting**, or **generic**? Am I over-engineering a generic subdomain or under-investing in a core one?
2. **Discovery:** if boundaries aren't known and the domain has real complexity, have I run (or planned) an Event Storming or Domain Storytelling with actual domain experts?
3. **Ubiquitous language:** can I produce a 20-term glossary the domain experts would ratify? Does the code use those exact terms? If a word means different things in two contexts, are they named distinctly?
4. **Context relationships:** for each integrating pair, have I named which of the seven patterns applies? Is the context map drawn and shared with the teams?
5. **Aggregate sizing:** for each aggregate, can I name the *specific business invariant* that requires its entities to change atomically? Am I referencing other aggregates by ID?
6. **Domain vs integration events:** for each event, is it *internal* (rich, evolves freely) or *integration* (contract, versioned, narrow)? Where is the translation? Where is the outbox?

If any answer is "I don't know," stop and find out before cementing the design in code.

## When to skip this skill

- Generic CRUD with no real domain logic — use boring CRUD with rich-enough types ([[programming-fundamentals]]).
- Throwaway prototypes, internal scripts, one-shot data fixes, proofs-of-concept before production.
- Single-context features with no cross-boundary concerns — run [[programming-fundamentals]] + [[hexagonal-backend]] + [[database-fundamentals]].
- Pure code-level work (renaming a function, adding a parameter, fixing a bug on screen) — [[debug-fundamentals]] or [[programming-fundamentals]] own that.
- Pure architecture-level operational decisions (timeouts, retries, instrumentation) — [[architecture-fundamentals]].
- Domains with no access to domain experts — fall back to whatever model exists, accept DDD Lite, apply [[hexagonal-backend]] + [[programming-fundamentals]] within existing boundaries.

## Reference files

- `references/subdomain-classification.md` — core/supporting/generic with the differentiation test, Wardley mapping, build/buy/borrow, drift between classifications, worked examples; principle 1's full rule/why/how-to-apply/example.
- `references/bounded-contexts.md` — bounded contexts as linguistic + model boundaries, glossary discipline, the seven context-mapping patterns, context-map drawing recipe, ACL depth, boundary smells; principles 3 and 4's full rule/why/how-to-apply/example.
- `references/event-storming.md` — Big Picture/Process Modelling/Software Design formats, sticky-color grammar, facilitation tips, Domain Storytelling as alternative, artifact-to-code mapping; principle 2's full rule/why/how-to-apply/example.
- `references/aggregate-design.md` — Vernon's four rules with examples, sizing test, Scrum-aggregate split walkthrough, aggregates and bounded contexts, ORM/persistence concerns; principles 5 and 6's full rule/why/how-to-apply/example.
- `references/failure-modes.md` — the failure-mode diagnostic table (symptom → failure → fix) and operational concerns (domain-expert bottleneck, logical vs physical contexts, CQRS/ES as amplifiers, Conway's Law, ORM friction).

## How to use this skill in a conversation

Always-on for strategic-DDD work — triggers and the cross-skill run order (this skill leads the construction chain) are owned by `.claude/rules/fundamentals.md`. If the task is in "When to skip," say so in one sentence and proceed without it.
