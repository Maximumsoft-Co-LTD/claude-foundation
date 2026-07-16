---
name: hexagonal-backend
description: Apply hexagonal architecture (ports & adapters) to backend code. Use BEFORE writing or restructuring any backend with real business logic — services, APIs, repositories, use cases, domain models, persistence, message handling — even when the user doesn't say "hexagonal". Defines the 3-layer structure (domain / application / infrastructure), driving vs driven (primary/secondary) ports, dependency direction, persistence-model mapping, testing strategy, and common pitfalls, with TypeScript and Go (core/port/adapter) examples. Skip throwaway scripts and trivial CRUD with no real domain logic.
---

# Hexagonal Backend Architecture (Ports & Adapters)

## Why this exists

Standing preference: every backend with real domain logic uses hexagonal architecture for **resilience to requirement changes** — swapping a database, framework, broker, or external API touches only adapters, never the core. "Postgres → DynamoDB?" or "REST → gRPC?" is days in a hexagonal codebase, months in a coupled one.

> **Runnable examples live in references** — [`references/typescript.md`](references/typescript.md) (calls the concrete use case) and [`references/go.md`](references/go.md) (uses a driving port); both correct, read the matching file when you implement. This body stays conceptual.

## The 3 layers

### Domain (core)
- Entities, value objects, domain services, business rules
- **Zero external dependencies** — no ORM/HTTP/framework imports, no `fetch`, no `db.query`
- Pure functions and plain types only; compiles and tests in isolation

### Application (use cases)
- Orchestrates domain logic for one user-facing intent (`PlaceOrder`, `CancelSubscription`, `RefundPayment`)
- Defines **ports** — *driven* interfaces it needs from outside (`OrderRepository`, `PaymentGateway`) and, optionally, the *driving* interface it offers callers (`OrderService`); see *Two kinds of ports*.
- Depends on domain only; never imports infrastructure.

### Infrastructure (adapters)
- **Driving** (call into the application): HTTP controllers, gRPC handlers, CLI commands, message consumers, cron jobs
- **Driven** (called by the application via ports): DB repositories, external API clients, message publishers, file storage, email senders

## Two kinds of ports: driving and driven

A *port* is an interface the application owns:

- **Driven (secondary)** — what the application *needs* from outside: `OrderRepository`, `PaymentGateway`, `Clock`. The application declares them; **driven adapters implement** them.
- **Driving (primary)** — what the application *offers* callers: the use-case surface (`OrderService`), depended on by driving adapters. Publish as an interface when multiple entry points (HTTP, queue, cron) share one surface.

One caller → the concrete class is simpler ([[coding-discipline]] *simplicity-first*); many entry points → the driving port earns its keep.

## The one rule you must not break

**Dependency direction: Infrastructure → Application → Domain**

Never the other way. Domain and application must both compile without adapters. If a domain file imports anything from `adapters/` (or any concrete framework/library), the architecture is broken.

## Folder structure

Same logical rule (*The one rule you must not break*), different names — physical layout is a style choice (see *Relation to Vertical Slice Architecture*). TypeScript: `domain/ application/ adapters/`; Go: the community `core/ port/ adapter/` idiom (all ports in one `core/port` package). Full annotated trees: [`references/typescript.md`](references/typescript.md), [`references/go.md`](references/go.md).

## Patterns

Six building blocks; full detail in `references/patterns-and-pitfalls.md`, runnable code in the stack references:

- **Domain entity** — rich, invariant-enforcing methods (`order.markPaid()`), no infra tags; `NewX` (validates) vs `Rehydrate` (trusts storage). Sizing: [[ddd-strategic]].
- **Port definition** — narrow, use-case-focused interfaces the application owns.
- **Driven adapter (repository)** — implements a port; owns the persistence model + mapping so storage types never leak inward.
- **Use case** — orchestrates domain against ports only; plain commands in, domain types out.
- **Driving adapter (HTTP/handler)** — wire shape → command → port call → transport translation; JSON tags stay here.
- **Composition root** — the single place that instantiates adapters and injects them; everything else takes ports via constructors.

## Cross-cutting concerns

Full detail in `references/patterns-and-pitfalls.md`:

- **Transactions & atomicity** — boundary lives behind a **Unit of Work port** (never a raw `db.Tx` in a use case); DB+broker crossings use a transactional outbox — an adapter concern. Mechanics: [[database-fundamentals]] / [[queue-fundamentals]].
- **Errors: domain → application → adapter** — each layer translates the one beneath: domain errors in business language, application errors for broken preconditions, infra errors re-raised with domain meaning; driving adapters map to status codes. Taxonomy: [[api-design-fundamentals]].
- **Query ports (CQRS seam)** — reads that don't fit `save`/`findById` get a separate query port returning behavior-free DTOs; add only when read-only methods accrete.
- **Testing strategy** — domain: pure unit tests, no mocks; use case: in-memory fakes at port boundaries (never mock the domain); adapter: integration tests against real dependencies. Levels: [[testing-fundamentals]].

## Common pitfalls

All ❌, fixes in `references/patterns-and-pitfalls.md > Common pitfalls`: ORM model in domain · domain entity doubling as DB/JSON model · use case returning DB rows/framework types · domain calling out (`fetch`/`db.query`) · adapter doing business logic · one mega-port · hidden time/randomness (inject `Clock`/`Random`) · use case depending on framework · anemic domain · skipping the composition root.

## Workflow when starting a new backend feature

1. **Name the use case.** One verb + noun: `PlaceOrder`, `RefundPayment`, `ResetPassword`.
2. **Sketch the domain.** Entities/value objects? Invariants?
3. **List the ports.** Each external dependency = one narrow *driven* port. Multiple entry points (HTTP, queue, cron) → add a *driving* port too.
4. **Write the use case** against ports. No real adapters yet.
5. **Test domain + use case** with in-memory fakes for ports.
6. **Implement adapters.** Real DB, HTTP client, broker.
7. **Wire the composition root.**
8. **Write adapter integration tests** against real dependencies.

## When NOT to apply strictly

- Throwaway scripts, one-shot migrations, prototypes meant to be deleted
- Trivial CRUD with no real business rules (a glorified spreadsheet)
- Very thin BFFs that only forward and reshape responses

For everything else — business rules, multiple data sources, or any chance of changing requirements — apply by default.

**Ports aren't the speculative abstraction [[coding-discipline]]'s *simplicity-first* warns against** — a port is the *deliberate* seam that buys requirement-change resilience, earning its keep wherever this skill applies; the skip-list above is where simplicity-first wins.

## Relation to Vertical Slice Architecture

Complementary, not competing: VSA's per-feature folder is a *physical layout choice*; hexagonal's dependency direction is a *logical invariant* — organize by feature, keep domain pure, inject via ports inside the slice. Details: `references/patterns-and-pitfalls.md > Relation to Vertical Slice Architecture`.

## How to use this skill in a conversation

Always-on for backend work with real domain logic; skip per *When NOT to apply strictly* (say why, in one sentence). Starting fresh: structure, then domain/ports, before code. Refactoring: classify into layers, migrate one use case at a time. Writing code: follow *Patterns* + the stack reference; flag non-obvious calls (`Clock` port, unit-of-work, query port) in one sentence. Full version: `references/patterns-and-pitfalls.md > Conversation guidance`.

## Reference files

| File | Read when |
|---|---|
| `references/patterns-and-pitfalls.md` | Full pattern write-ups, transactions/errors/query-port/testing sections, pitfall fixes, VSA comparison, conversation guidance |
| `references/typescript.md` | TypeScript — annotated tree + runnable domain/port/adapter/use-case/UnitOfWork/`toHttp` code |
| `references/go.md` | Go — `core/port/adapter` tree + runnable code, driving-port style, fakes-vs-generated-mocks note |
