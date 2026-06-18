---
name: hexagonal-backend
description: Apply hexagonal architecture (ports & adapters) to backend code. Use BEFORE writing or restructuring any backend with real business logic — services, APIs, repositories, use cases, domain models, persistence, message handling — even when the user doesn't say "hexagonal". Defines the 3-layer structure (domain / application / infrastructure), driving vs driven (primary/secondary) ports, dependency direction, persistence-model mapping, testing strategy, and common pitfalls, with TypeScript and Go (core/port/adapter) examples. Skip throwaway scripts and trivial CRUD with no real domain logic.
---

# Hexagonal Backend Architecture (Ports & Adapters)

## Why this exists

Standing preference: every backend with real domain logic uses hexagonal architecture. The goal is **resilience to requirement changes** — swapping a database, framework, broker, or external API touches only adapters, never the core. "Postgres → DynamoDB?" or "REST → gRPC?" is days in a hexagonal codebase, months in a coupled one.

> **Runnable examples live in references.** This body is the conceptual layer — the 3 layers, the two port kinds, the dependency rule, transactions/errors/query/testing *concepts*, pitfalls, and the workflow. Every pattern's full runnable code is in [`references/typescript.md`](references/typescript.md) and [`references/go.md`](references/go.md); read the matching reference file when you implement. The TypeScript examples call the concrete use case; the Go examples use a driving port — both correct.

## The 3 layers

### Domain (core)
- Entities, value objects, domain services, business rules
- **Zero external dependencies** — no ORM imports, no HTTP libs, no framework types, no `fetch`, no `db.query`
- Pure functions and plain types only; must compile and test in isolation

### Application (use cases)
- Orchestrates domain logic to fulfill a single user-facing intent (`PlaceOrder`, `CancelSubscription`, `RefundPayment`)
- Defines **ports** — both the *driven* interfaces it needs from outside (`OrderRepository`, `PaymentGateway`) and, optionally, the *driving* interface it offers callers (`OrderService`). See *Two kinds of ports* below.
- Depends on: domain only. Never imports infrastructure.

### Infrastructure (adapters)
Two flavors:
- **Driving adapters** (call into the application): HTTP controllers, gRPC handlers, CLI commands, message consumers, cron jobs
- **Driven adapters** (called by the application via ports): DB repositories, external API clients, message publishers, file storage, email senders

## Two kinds of ports: driving and driven

A *port* is an interface the application owns. Two kinds:

- **Driven (secondary) ports** — what the application *needs* from outside: `OrderRepository`, `PaymentGateway`, `Clock`. The application declares them; **driven adapters implement** them.
- **Driving (primary) ports** — what the application *offers* its callers: the use-case surface (`OrderService`). **Driving adapters depend on** it. Publish as an interface when multiple entry points (HTTP, queue, cron) share one application surface.

One caller → the concrete class is simpler ([[coding-discipline]] *simplicity-first*); many entry points → the driving port earns its keep. (The reference files show both: Go uses a driving port `port.OrderService`; TypeScript calls the concrete use case.)

## The one rule you must not break

**Dependency direction: Infrastructure → Application → Domain**

Never the other way. Domain must compile without adapters. Application must compile without adapters. If a domain file imports anything from `adapters/` (or any concrete framework/library), the architecture is broken.

## Folder structure

Both stacks express the same logical rule (*The one rule you must not break*) with different names — the physical layout is a style choice (see *Relation to Vertical Slice Architecture*). TypeScript uses `domain/ application/ adapters/`; Go uses the community `core/ port/ adapter/` idiom (all ports in one `core/port` package). Full annotated trees: [`references/typescript.md`](references/typescript.md) and [`references/go.md`](references/go.md).

## Patterns

Each pattern's full runnable implementation is in the reference files (TypeScript: [`references/typescript.md`](references/typescript.md); Go: [`references/go.md`](references/go.md)). The hexagonal point of each:

- **Domain entity** — a *rich* entity: private/unexported fields, state changes only through invariant-enforcing methods (`order.markPaid()`, not a setter), and **no** `json`/`bson`/ORM tags or infra imports. Split construction into `NewX` (the only way to build a valid new instance — enforces invariants) vs `Rehydrate` (rebuilds already-valid storage state, skips checks; adapters use it). Aggregate boundaries and how rich the entity should be: [[ddd-strategic]].
- **Port definition** — driven ports declare what the app needs; the optional driving port is the use-case surface. Keep them narrow (Interface Segregation). In Go, all ports sit in one `core/port` package so the dependency arrows are visible in one place; a compile-time check (`var _ port.OrderRepository = (*OrderRepository)(nil)`) catches drift at build, not runtime.
- **Driven adapter (repository)** — implements a driven port and owns the **persistence model** plus mapping to/from the domain, so storage tags and column types never leak into the domain.
- **Use case** — orchestrates domain logic against ports only; never imports a concrete adapter. Takes plain command objects, returns domain types or primitives.
- **Driving adapter (HTTP / handler)** — decodes into a wire-shape struct (**not** domain types — JSON tags stay in the adapter), maps it to a command, calls the port, and translates the result/error to the transport. Translation lives here, not in the use case.
- **Composition root** — the single place that instantiates concrete adapters and injects them into use cases; everywhere else receives ports through constructors.

## Transactions and atomicity

The hexagonal concern here is *where the transaction boundary lives*: passing a raw `db.Tx` into the use case re-couples application to infrastructure. (Isolation levels, locking, and atomicity mechanics are [[database-fundamentals]].)

**Unit of Work pattern** — expose a transaction port; the use case hands it a function; the adapter runs that function in a transaction, and repositories inside pick up the same transaction. The use case knows transactions exist; it doesn't know Postgres, Mongo sessions, or savepoints. Runnable `UnitOfWork` port + `TransferFunds` use case: [`references/typescript.md`](references/typescript.md).

**Crossing systems (DB + message broker)** — don't dual-write; use a transactional outbox. The hexagonal framing: the outbox table is an adapter concern, so the use case still sees only `orders.save(order)`. Outbox/relay mechanics and delivery semantics: [[queue-fundamentals]].

## Errors: domain → application → adapter

The hexagonal concern is the *layered translation* — each layer translates the one beneath it, so infra/framework error types never leak inward. The published error shape and status-code taxonomy at the edge is [[api-design-fundamentals]]; errors-as-values modeling is [[programming-fundamentals]].

- **Domain errors** — broken business invariants, in business language: `InsufficientFundsError`, `OrderAlreadyShipped`. Live next to the entities. No HTTP status, no SQL code.
- **Application errors** — broken use-case preconditions: `OrderNotFound`, `Unauthorized`, `IdempotencyConflict`. Live in the application layer.
- **Infrastructure errors** — leakage from external systems. Adapters catch those with domain meaning and re-raise as domain/application errors (unique constraint on `email` → `EmailAlreadyTaken`). Anything else propagates as a generic infra failure.

Driving adapters translate at the edge — domain/application errors become HTTP status codes, gRPC codes, or CLI exit codes. Keep that map in the driving adapter, not in the use case: the use case throws; HTTP decides the status. Runnable `toHttp` translator: [`references/typescript.md`](references/typescript.md); the Go `writeError` switch is inside the HTTP handler in [`references/go.md`](references/go.md).

## Queries that don't fit save/findById

The repository is shaped for the *write* path. When the read path needs pagination, projections, joins, or aggregate stats, forcing it through a repository creates a god object. Introduce a separate **query port** that returns plain DTOs; the adapter issues whatever SQL or denormalized read it needs without dragging the domain in. The DTO lives in the application layer but carries no behavior. This is the CQRS seam: writes through repositories and domain; reads through query ports. Start with the repository; add a query port when it grows read-only methods the domain never uses. Example query port: [`references/typescript.md`](references/typescript.md).

## Testing strategy

Ports make each layer testable in isolation — that is the hexagonal payoff. The layer→level mapping below is what's specific here; test-double discipline and level selection in general are [[testing-fundamentals]].

| Layer | What to test | How |
|---|---|---|
| Domain | Business rules, invariants | Pure unit tests. No mocks. |
| Use case | Orchestration logic | Replace ports with **in-memory fakes** (preferred) or mocks |
| Adapter | Real integration | Integration tests against real DB / real HTTP / testcontainers |

**Hexagonal-specific rules:** mock at port boundaries only (never inside the use-case body), never mock the domain, and let adapter tests run against real dependencies so they exercise the real translation. Runnable in-memory fake + the Go fakes-vs-generated-mocks note are in the reference files.

## Common pitfalls (read this before writing code)

- ❌ **ORM model in domain** — importing `@prisma/client` or `gorm.Model` into a domain file. Use plain types in domain; map at the adapter.
- ❌ **Domain entity doubling as the DB/JSON model** — `json:`/`bson:`/`gorm:` tags on a domain type, or reusing the entity as the table row/wire shape. Keep a separate persistence model in the adapter (`orderModel`) and map it ↔ domain.
- ❌ **Use case returning DB rows or framework types** — return domain types or primitives; the driving adapter translates to HTTP/JSON.
- ❌ **Domain calling out** — `fetch()`, `db.query()`, `redis.get()` inside domain. Invert via a port.
- ❌ **Adapter doing business logic** — adapters only translate (DB row ↔ entity, HTTP body ↔ command). Logic stays in use case or domain.
- ❌ **One mega-port** — `interface DataStore { saveOrder, saveUser, savePayment, ... }`. Keep ports narrow and use-case-focused (Interface Segregation Principle).
- ❌ **Hidden time/randomness in domain** — `new Date()` or `Math.random()` in domain. Inject a `Clock` port and a `Random` port.
- ❌ **Use case depending on framework** — no `express.Request` in use case signatures. Use case takes plain command objects.
- ❌ **Anemic domain** — entities with only getters/setters. Push behavior into the entity (`order.cancel()`, `subscription.renew()`).
- ❌ **Skipping the composition root** — instantiating adapters inside use cases (`new PostgresRepo()`). Always inject via constructor.

## Workflow when starting a new backend feature

1. **Name the use case.** One verb + noun: `PlaceOrder`, `RefundPayment`, `ResetPassword`.
2. **Sketch the domain.** What entities/value objects? What invariants must hold?
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

**Ports are not the speculative abstraction [[coding-discipline]]'s *simplicity-first* warns against.** A port is the *deliberate* seam that buys requirement-change resilience; it earns its keep wherever this skill applies. The skip-list above is where simplicity-first wins.

## Relation to Vertical Slice Architecture

**Vertical Slice Architecture (VSA)** organizes by feature instead of layer: one folder per use case (`features/place-order/`) containing the handler, types, validation, and persistence call. Treat VSA as **complementary, not competing**:

- Same goals: low coupling, testable units, clear seams.
- VSA's per-feature folder is a *physical layout choice*; hexagonal's dependency direction is a *logical invariant*. They compose: organize by feature, keep domain types pure, inject via ports inside the slice.
- CRUD-heavy / read-mostly services → lean VSA; ports/adapters across many layers is overkill for one query and one mapping.
- Real invariants, multi-aggregate transactions, or many adapters per use case → hexagonal-internal layering pays off; VSA folder structure still works on top.

The **logical layering rule** (domain has zero external dependencies; ports define the interface; adapters depend inward) is load-bearing. Expressing it as `domain/`/`application/`/`infrastructure/` folders or feature-scoped slices is a style choice.

## How to use this skill in a conversation

Always-on for backend work with real domain logic (per `.claude/rules/fundamentals.md`). If the task matches "When NOT to apply strictly," say so in one sentence and proceed without hexagonal.

- **Starting fresh** — propose folder structure first, then sketch domain entities and ports before code.
- **Refactoring** — classify existing code into domain/application/infrastructure; migrate one use case at a time.
- **Writing code** — follow the patterns above and the runnable reference for the stack in use. On a non-obvious call (a `Clock` port, unit-of-work, query port), say *why* in one sentence. Cite relevant pitfalls.
