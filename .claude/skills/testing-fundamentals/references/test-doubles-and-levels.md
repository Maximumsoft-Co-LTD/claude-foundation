# Test Doubles and Levels

Two decisions dominate test design: *at which level* do I test this, and *what do I replace the real dependencies with*. This file gives the decision rules for both, plus the taxonomy of doubles, the case for a real database, contract tests across services, and how to kill flakiness.

## Levels: unit vs integration vs e2e

The levels trade **speed** against **fidelity**. Pick the lowest level that can actually prove the thing.

| Level | Speed | What it proves | Doubles | Count |
|-------|-------|----------------|---------|-------|
| **Unit** | ~ms | One unit's logic is correct in isolation | Fake the seams (DB, network, clock) | Hundreds–thousands |
| **Integration** | ~10–100ms | Two+ real components wire together correctly | Real DB/FS; fake only external/3rd-party | Tens–hundreds |
| **E2E** | seconds | A whole user journey works through the real stack | Almost nothing — real everything | A handful |

### Decision rules

- **Is it pure logic with branches** (pricing, validation, a state machine, a parser)? → **unit**. No I/O, runs in milliseconds, pinpoints the failure. This is the backbone and should be most of the suite.
- **Does it cross a boundary you own** — your database, the filesystem, in-process IPC? → **integration**, against the *real* dependency (a real test DB; see below). This is where migration/contract/SQL bugs surface — the bugs a unit test with a mocked DB structurally cannot catch.
- **Is it a user-observable journey across the full stack** (sign up → verify → log in; add to cart → pay → receipt)? → **e2e**, one per critical path. Not one per variation — test variations at the unit level.
- **Could a lower level prove the same thing?** Then use the lower level. Before writing an e2e test for a discount rule, ask whether a unit test on the discount function proves it in 2ms instead of 20s. The answer is usually yes.

### The pyramid, and why inverting it hurts

```
        /\          few    e2e          slow, broad blast radius, flakiest — critical paths only
       /  \         some   integration  real wiring, real DB — boundary crossings
      /____\        many    unit         fast, sharp failures — all the branchy logic
```

The **inverted pyramid / ice-cream cone** — mostly e2e, few unit — is the most common bad suite. It's slow (minutes, so it's skipped on save), it has a broad blast radius (one broken login fails fifty journey tests, telling you little), and e2e is the flakiest level (real network, real timing). The fix is to push tests down: most of what e2e tests is logic that a unit test proves faster and more precisely. Keep e2e for "the whole thing is wired together and a real user can complete this journey."

The opposite failure — *only* unit tests — ships integration bugs: every unit passes against its mocks, and the system is broken at the seams the mocks papered over. You need the middle layer.

## The double taxonomy

"Mock" gets used for five distinct things. They differ in what they do and how they fail, and the difference decides which one is safe to reach for.

- **Dummy** — a placeholder passed only to satisfy a signature; never actually used. (A `null` logger you must pass but the test path never logs.) Harmless.
- **Stub** — returns canned answers to calls the test makes. (`repo.findRate()` always returns `0.1`.) Provides indirect *input* to the unit under test. Low-risk: it feeds state, doesn't assert on calls.
- **Spy** — a real or stub object that *records* how it was called, so the test can inspect afterward. Useful when the call itself is the behaviour (an email was sent), risky when used to assert internal call graphs (principle 1's trap).
- **Mock** — pre-programmed with expectations and *fails the test if they aren't met* in the right way/order. A strict mock asserts on the interaction. This is the highest-risk double — a mock that asserts call order is testing the implementation, not the behaviour.
- **Fake** — a working but lightweight implementation of the real thing (an in-memory repository, an in-memory payment gateway, an in-memory clone of the *same* DB engine). Behaves like the real dependency, so tests exercise real logic against it. (Swapping in a *different* engine — SQLite for Postgres — is the dialect-mismatch trap the real-DB section below warns against, not a safe fake.) Often the best double when many tests need the same collaborator.

**Rule of thumb on risk:** dummy < stub < fake < spy < mock. Prefer **fakes and stubs** (state-based: set up input, assert output). Reach for **spies/mocks** only when the *interaction* is the behaviour under test ("on success, the receipt is sent") — and even then, assert *that it happened*, not the exact call count and argument order, unless those are part of the contract.

A second signal: 20 lines of mock setup for a 5-line assertion means the unit has too many dependencies. Fix the production design (extract the pure core), don't write more elaborate mocks.

## Fake at the seams (ports)

A double belongs at an **architectural seam** — a port, an interface, a boundary the design already draws. [[hexagonal-backend]] makes this natural: the repository port, the email-sender port, the clock are exactly the interfaces you swap. Faking at a seam is honest because the seam is a real contract; reaching *inside* a unit to stub a private helper is not — that couples the test to the implementation.

```ts
// The seam is the port. The unit under test depends on the interface, not the concrete adapter.
interface Clock { now(): Date }
interface OrderRepo { findPaid(userId: string): Promise<Order[]> }

// Unit test of the use case: fake both ports, exercise the real use-case logic.
const clock: Clock = { now: () => new Date('2026-01-01T00:00:00Z') }   // stub
const repo  = new InMemoryOrderRepo([paidOrder, openOrder])             // fake
const result = await summarizeOrders(repo, clock)                       // real logic runs
expect(result.paidCount).toBe(1)
```

If a dependency has no seam — the code `new`s a concrete client inline — that's a design problem the test is surfacing. Introduce the port, then fake it.

## Why integration tests use a real database

Mocking your own database is the single most common way a test passes while the system is broken.

A mocked DB returns whatever you told it to. It will happily "accept" a query that the real database would reject for:
- a column that a migration dropped or renamed,
- a `NOT NULL` / `UNIQUE` / foreign-key / `CHECK` constraint the data violates,
- a SQL dialect or syntax error,
- a transaction/isolation behaviour the mock doesn't model.

So a repository test against a mocked DB asserts that *your code calls a function you stubbed* — it proves nothing about whether the real SQL and the real schema agree, which is the entire reason the repository exists. The bug ships green.

Use a real test database in integration tests. Three workable strategies:
- **Test containers** — spin up a real Postgres/MySQL in Docker for the test run (`testcontainers` in most languages). Highest fidelity; the same engine you ship.
- **Transactional rollback** — wrap each test in a transaction and roll back at the end. Fast, perfectly isolated, no cleanup. Caveat: can't test code that itself commits or relies on cross-transaction visibility.
- **Same-family in-memory** — an in-memory build of the same engine. Faster than a container; only safe when it's the *same* engine (an in-memory clone of a *different* DB reintroduces the dialect-mismatch risk you were avoiding).

Pick per project; default to containers for fidelity, transactional rollback for speed. What you don't do is mock it.

## Contract tests across services

When service A calls service B over the network, A's integration tests can't spin up the real B, and mocking B in A's tests just re-creates the "passes while broken" problem at the service boundary — A's mock of B can drift from what B actually returns. **Contract tests** close that gap: A (the consumer) declares the requests it makes and the responses it expects; that contract is verified against B (the provider) in B's own CI. If B changes its response shape, B's build fails against A's contract *before* the break reaches production. Consumer-driven contract testing (Pact and similar) is the usual tooling. Reach for this when independently-deployed services integrate; for a monolith with in-process boundaries, an integration test across the real components is simpler and sufficient.

## Taming flakiness

A flaky test — passes and fails without a code change — trains the team to ignore red, which is worse than having no test. Every flake is a determinism leak; fix the leak, don't add a retry.

- **Control time.** Inject the clock; use fake timers (`vi.useFakeTimers`, `freezegun`, a `Clock` port) and advance them. Never assert against the real `now`, and never `sleep` to "let time pass."
- **Control randomness and IDs.** Seed the RNG; inject the UUID/ID generator. A test that asserts on a random value is asserting on noise.
- **Isolate state.** Each test owns its fixtures and tears them down (transactional rollback, fresh temp dir, fresh in-memory store). If tests pass alone but fail together, you have shared mutable state — find it.
- **Kill order-dependence.** A test must pass run alone, and the suite must pass when **randomized**. Turn on the runner's shuffle (`pytest-randomly`, `--shuffle`, `go test -shuffle=on`) to surface coupling early.
- **Don't sleep — wait on a condition.** Replace `sleep(200)` with poll-until-true, await-a-signal, or fake-timer advance. A fixed sleep is flaky when too short and slow when too long, usually both.
- **Quarantine, don't ignore.** If a flake can't be fixed immediately, mark it quarantined (tracked, excluded from the gate) — never leave it failing intermittently in the main suite where it erodes trust in every red.
- **Retries are a last resort, and a smell.** Auto-retrying a flaky test hides the determinism leak instead of fixing it; a "passed on attempt 3" is still a bug in the test. Use retries only for genuinely external, irreducibly-flaky boundaries (a real third-party endpoint in an e2e test), and log when they trigger so the flake stays visible.

## Running the suite in one command

The run that *decides* pass/fail is always the full suite in a single process — not a loop of one invocation per file. Most runners auto-discover and run everything in one command (`pytest`, `go test ./...`, `cargo test`, `npm test`/`vitest`); monorepos have an aggregator (`pnpm -r test`, `turbo run test`, `nx run-many -t test`). Only when nothing ties the suites together do you write a one-shot script that loops *internally* and commit it as the permanent entrypoint. Targeting one file is fine while iterating on a single failure; the status-deciding run is the whole suite, once. (This is the execution contract the `/dev` `qa` agent follows.)
