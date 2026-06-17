---
name: testing-fundamentals
description: Apply testing fundamentals — test behaviour not implementation, the test pyramid, what to test (contract, boundaries, error paths, the bug you just fixed), test doubles with discipline, isolated/deterministic/fast tests, behaviour-named arrange-act-assert, coverage as a flashlight. Use BEFORE writing a test, deciding what to test, designing a suite, choosing test levels (unit/integration/e2e), or reviewing coverage; the trigger is any "how should this be tested" decision, even when no principle is named. Skip throwaway scripts, chore/docs/spike work, and trivial config.
---

# Testing Fundamentals

## Why this exists

Most of the pain a test suite causes — rather than prevents — traces back to the same handful of missed fundamentals. Tests that assert *how* the code works instead of *what* it does break on every refactor, so the suite punishes the cleanup it should be protecting. A pyramid inverted into a tower of slow, flaky end-to-end tests turns a five-second feedback loop into five minutes, and the team stops running it. Mocking everything — especially the database — lets tests stay green while the integration that actually ships is broken. Coverage chased as a number produces 100%-covered trivia and 0%-covered business logic. And the bug that recurs every quarter is the one nobody pinned with a test the first time.

This skill is a **pre-flight**: read it before you write the test, choose the level, or design the suite. It owns test *strategy and design* — what deserves a test, at which level, with which doubles, asserting what. It is the design-time companion to what the `/dev` `qa` agent does — design the test strategy into `test-plan.md` at phase 2½ (level per criterion, edge cases to probe, fixtures), then execute it at phase 7 (run the suite, map every acceptance criterion to a test, record results in `tests.md`); this skill is the "how to test well" that `qa` and `engineer` reach for, not a copy of `qa`'s procedure.

Two neighbours own adjacent territory: [[refactoring-fundamentals]] owns **characterization tests** — the baseline you capture before reshaping untested code; [[debug-fundamentals]] owns **reproduction** — pinning a failure into a reliable repro before you touch the fix. This matters per `/dev` type: for a `fix`, the regression test comes **first** (it fails on the old code, passes on the new — that's the proof the bug is gone); for a `refactor`, the safety net is a characterization test captured before the structural change. This skill owns everything else about a test: its shape, level, doubles, and assertions.

Fundamentals compose with [[programming-fundamentals]] (pure cores are the easiest thing to test well) and [[hexagonal-backend]] (whose ports are exactly the seams you fake at). A clean test over the wrong behaviour still ships the wrong system — decide what "correct" means first.

## The 7 principles

Each principle has a one-line rule, a *why*, and a worked example. The early ones unblock the later ones.

---

### 1. Test behaviour, not implementation

**Rule:** Assert the observable outcome — the return value, the persisted row, the message published, the error raised — not the internal steps the code took to get there. If a refactor that preserves behaviour breaks the test, the test was wrong.

**Why:** A behaviour test asks "given this input, does the system produce the right outcome?" An implementation test asks "did this function call that function, in this order, exactly once?" The first survives a rename, an extraction, a swapped algorithm; the second fails on all of them while the system still works. The whole point of a suite is to give you the confidence to change the code — a suite coupled to the implementation does the opposite, it taxes every change and tells you nothing about whether the change was correct.

The clearest symptom is a test that's mostly `expect(mock).toHaveBeenCalledWith(...)`. That assertion is a snapshot of the *current* call graph, not a statement about what the code is supposed to do. The moment the code achieves the same outcome a different way, the assertion is a false alarm.

**How to apply:**
- Assert on outputs and effects you can observe from outside the unit: return values, the state of a store you can read back, an event/email/HTTP call at a real seam.
- Reserve "was this collaborator called" assertions for the cases where the *call itself is the behaviour* — "on payment success, the receipt email is sent" legitimately asserts the send happened.
- Treat private methods as implementation. Test them through the public surface that uses them; if a private method is hard to reach that way, that's a design signal, not a reason to test it directly.

**Example:**
```js
// Bad — asserts the call graph; any refactor of the internals breaks it
test('applyDiscount', () => {
  const repo = mockRepo()
  applyDiscount(order, repo)
  expect(repo.findRate).toHaveBeenCalledTimes(1)
  expect(repo.findRate).toHaveBeenCalledWith('GOLD')
})

// Good — asserts the outcome; survives any internal rewrite
test('gold-tier orders over $100 get 10% off', () => {
  const order = makeOrder({ tier: 'GOLD', subtotalCents: 15_000 })
  const total = applyDiscount(order)
  expect(total).toBe(13_500)
})
```

---

### 2. The test pyramid — push every test to the cheapest level that proves the thing

**Rule:** Many fast unit tests at the base, fewer integration tests in the middle, a few end-to-end tests at the top. For each thing you want to prove, choose the lowest level that can actually prove it.

**Why:** The levels trade speed against fidelity. A unit test runs in milliseconds and pinpoints the failure, but proves nothing about how the pieces connect. An e2e test exercises the real wiring but is slow, broad in blast radius when it fails, and the flakiest thing you own. A suite that's mostly e2e — the "inverted pyramid" or "ice-cream cone" — is slow to run, slow to diagnose, and quietly skipped under deadline. A suite that's *only* unit tests ships integration and contract bugs. You want both, in roughly the right ratio: hundreds-to-thousands of unit, tens-to-hundreds of integration, a handful of e2e.

The discipline is "push down": before writing an e2e test for a pricing rule, ask whether a unit test on the pricing function proves the same thing in 2ms instead of 20s. Reserve the expensive levels for what only they can prove — that the layers are wired together (integration) and that a whole user journey works through the real stack (e2e).

**How to apply:**
- Pure logic with branches → unit. Pricing, validation, state machines, parsers, formatters. This is the backbone; it should be most of your tests.
- A boundary crossing (DB, filesystem, HTTP, IPC) → integration, against the *real* dependency (principle 4).
- A user-observable journey across the whole stack → one e2e per critical path (sign up, checkout, refund), not one per variation. Test the variations at the unit level.
- If a "unit" test takes seconds, it's secretly doing I/O — find it and move it down a level or fake the seam (principle 4).
- Decision rules and the per-level mechanics live in `references/test-doubles-and-levels.md`.

**Example:**
```
A checkout feature with: a discount rule, a tax calc, an order repository, a payment gateway.

Inverted (bad):                       Pyramid (good):
  12 e2e tests through the browser      ~40 unit: discount × tax × validation branches
   2 unit tests                          ~6 integration: repository against a real test DB
  → 4 min run, flaky, vague failures     ~2 e2e: "guest checks out", "refund a paid order"
                                         → 8s run, sharp failures, real wiring proven
```

---

### 3. Test the contract, the boundaries, the error paths — and the bug you just fixed

**Rule:** Spend test effort where bugs live: the contract a caller depends on, the edges of every input range, the failure paths, and any bug that has shipped once. Don't spend it on getters, DTOs, or framework code.

**Why:** The requirement spells out the happy path; production breaks on everything else. The empty list, the off-by-one at the limit, the timeout mid-write, the second tenant reaching the first tenant's data — these are where regressions hurt users, and they're exactly what an unconsidered suite skips. Meanwhile `assertEquals(user.getName(), "Alice")` tests a field assignment that has no logic and no bug; testing that the ORM saves a row, or that the web framework routes a URL, tests someone else's code. Effort spent there is coverage theatre — it moves the number without protecting anything.

The recurring bug deserves special mention: a defect that ships, gets hot-fixed, and comes back is a defect nobody pinned. The regression test is the difference between "fixed" and "fixed until someone touches that file again." In the `/dev` `fix` flow this is non-negotiable and goes in *first* — the test that fails on the old code and passes on the new is the proof the fix is real (see [[debug-fundamentals]] for getting to a reliable repro before you write it).

**How to apply:**
- Name the contract and test it: for an endpoint or function, what does valid input return? Invalid input? An unauthorized caller? Those are separate tests.
- Walk the **edge-case checklist** (`references/test-design.md`) against the actual code under test — emptiness, boundaries, numbers, strings, time, ordering, concurrency, partial failure, auth/tenancy. Cover the cases the code can actually reach; skip inputs a type or guard already makes impossible (don't test illegal states you've made unrepresentable — that's noise).
- Test the error paths as first-class behaviour: feed the bad input, hit the limit, send the unauthorized caller, and assert the *defined* response — not just "it throws something."
- Skip trivial getters/setters/DTOs, generated code, and thin wrappers around well-tested libraries. Test what *you* added on top.
- For a reachable input the requirement never defines, don't invent the assertion — surface it as a gap (this is `qa`'s "undefined" classification).

**Example:**
```py
# The contract: discounted_total(order) -> int cents, never negative.
def test_orders_over_100_get_discount():        # happy path / contract
    assert discounted_total(make_order(15_000)) == 13_500

def test_empty_order_totals_zero():             # boundary: emptiness
    assert discounted_total(make_order(items=[])) == 0

def test_negative_line_item_is_rejected():      # error path
    with pytest.raises(ValueError):
        discounted_total(make_order(items=[Item(price_cents=-1)]))

def test_discount_never_exceeds_subtotal():     # boundary: the bug that shipped once
    assert discounted_total(make_order(1, coupon='FREE200')) == 0
```

---

### 4. Use test doubles with discipline — fake at the seams, real for what you're testing

**Rule:** Replace a dependency with a double only at an architectural seam (a port), and only when the real thing is slow, costly, non-deterministic, or out of scope. Use the *real* thing for the component you're actually testing — above all, a real database in integration tests.

**Why:** Doubles let you test in isolation; they also let you write tests that pass while the real system is broken. A mocked database happily accepts a query the real one would reject for a missing column, a violated constraint, or a migration that never ran — so the bug ships green. Rule of thumb: fake the things you *aren't* testing that are expensive or non-deterministic (third-party APIs, the clock, the payment gateway); use the real thing for the thing under test. For a repository, the thing under test is "does this code talk to the database correctly" — mocking the database deletes the point of the test.

The taxonomy matters because "mock" names five different things (dummy, stub, spy, mock, fake) that fail differently — a stub returning canned data is low-risk; a strict mock asserting call order is principle 1's trap in disguise. Full taxonomy and the decision tree: `references/test-doubles-and-levels.md`. A second signal: 20 lines of mock setup for a 5-line assertion means the unit has too many dependencies — fix the production design (extract the pure logic), not the mocks.

**How to apply:**
- Fake at ports/seams: the repository interface, the email-sender interface, the clock. Hexagonal code makes this natural — the port *is* the seam ([[hexagonal-backend]]).
- Integration tests use a **real test database** — Docker, an in-memory engine of the same family, or transactional rollback per test. Never a mocked DB.
- OK to mock: external APIs, slow services, things that cost money or send real email. Risky: your own database. Never: the function under test itself.
- Prefer a fake (a working in-memory implementation of the port) over a forest of per-test stubs when many tests need the same collaborator.

**Example:**
```ts
// Bad — mocked DB: this passes even if the real query references a dropped column
const db = { query: vi.fn().mockResolvedValue([{ id: 1, total: 100 }]) }
const repo = new OrderRepo(db)
expect(await repo.findPaid(userId)).toHaveLength(1)   // proves nothing about real SQL

// Good — integration test against a real test DB, rolled back after
const db = await testDb()                              // real Postgres, migrated
await seed(db, { orders: [{ userId, status: 'paid' }, { userId, status: 'open' }] })
const repo = new OrderRepo(db)
expect(await repo.findPaid(userId)).toHaveLength(1)    // proves the SQL + schema agree

// Fake the gateway you are NOT testing — it costs money and is non-deterministic
const gateway = new InMemoryPaymentGateway()           // a fake, not a mock
```

---

### 5. A good test is isolated, deterministic, and fast

**Rule:** Each test sets up its own world, depends on nothing another test left behind, and produces the same result every run. No shared mutable state, no real clock/network/randomness unless that *is* what you're testing, no dependence on test order.

**Why:** A flaky test — one that passes and fails without the code changing — is worse than no test, because it trains the team to ignore red. The causes are almost always a determinism leak: a test reads `Date.now()` and breaks at a DST boundary; two tests share a database row and the result depends on which ran first; a test asserts on the order of an unordered query; a test sleeps for a "long enough" 200ms that isn't long enough under load. Each of these is the same root cause — the test's outcome depends on something outside the test's control. Fast matters for the same reason the pyramid matters: a suite that takes minutes is a suite that gets run on push instead of on save, which means bugs are found later and cheaper feedback is wasted.

**How to apply:**
- No shared mutable state across tests. Each test builds its own fixtures and tears them down (transactional rollback, fresh temp dir, fresh in-memory store). If tests pass alone but fail together, you have leakage.
- Inject the clock, the random source, and IDs so the test controls them. Assert on a frozen `now`, a seeded RNG, a fixed UUID — never the real ones, unless the behaviour under test *is* "it uses the real clock."
- No order dependence — a test must pass when run alone, and the suite must pass when randomized. Many runners can shuffle order; turn it on to catch coupling.
- Don't `sleep`. Wait on a condition (poll until true, await a signal, use fake timers). A fixed sleep is either flaky (too short) or slow (too long), usually both.
- Flakiness-taming patterns (test containers, fake timers, retries-as-last-resort) are in `references/test-doubles-and-levels.md`.

**Example:**
```js
// Bad — depends on the real clock and on running before the cleanup test
test('token expires after 1h', () => {
  const t = issueToken()                  // embeds Date.now()
  // ...no way to advance time except to actually wait an hour
  expect(isExpired(t)).toBe(false)        // and flaky near boundaries
})

// Good — inject the clock; the test owns time, runs in microseconds, never flakes
test('token expires after 1h', () => {
  const clock = fakeClock('2026-01-01T00:00:00Z')
  const t = issueToken(clock)
  clock.advance(hours(1) + seconds(1))
  expect(isExpired(t, clock)).toBe(true)
})
```

---

### 6. Arrange-Act-Assert, one reason to fail, names that state the behaviour

**Rule:** Structure every test as three visible sections — arrange, act, assert. Give each test one reason to fail. Name it after the behaviour it pins, not the function it calls. Tests are read far more often than they're written.

**Why:** When a test fails in CI six months from now, its name is the first and often only thing a hurried engineer reads. `test('calculateDiscount')` tells them which function broke; `test('orders under $100 get no discount')` tells them which *rule* broke — which is what they actually need. The three-part shape makes a test scannable: inputs at the top, the single call in the middle, the expectation at the bottom. A test that interleaves five actions and five assertions is really five tests in a trench coat — when it fails you can't tell which behaviour regressed, and you have to read the whole body to find out.

"One reason to fail" is not "one `assert` statement" — asserting three fields of one returned object is one reason (the object is wrong). It *is* a rule against bundling unrelated behaviours into one test to save typing.

**How to apply:**
- Keep arrange / act / assert visually separated (blank lines or comments). Don't sprinkle assertions through the arrange.
- Name the rule, not the method: `'refund fails when the order is already refunded'`, not `'testRefund2'`. A failing name should explain the break without opening the body.
- One behaviour per test. If the name needs an "and", it's probably two tests.
- Use builders/factories for test data (`makeOrder(total_cents=15_000)`) so each test states the *one* input it cares about; big shared fixtures couple tests together. Never use production data, even a snapshot.
- For many inputs of the same rule, use parameterized/table tests instead of copy-paste (see `references/test-design.md`).

**Example:**
```py
def test_orders_over_100_get_a_discount():
    # arrange
    order = make_order(subtotal_cents=15_000)
    # act
    total = discounted_total(order)
    # assert
    assert total == 13_500
```

---

### 7. Coverage is a flashlight, not a goal

**Rule:** Use coverage to *find* untested code — especially uncovered branches on critical paths — not as a target to hit. A percentage is a floor and a diagnostic, never the objective.

**Why:** Coverage measures which lines ran, not whether the tests asserted anything meaningful. You can hit 100% line coverage with tests that call every function and assert nothing. Worse, a coverage *target* distorts effort: the cheapest way to move 78% to 85% is testing trivial code that has no bugs, while the gnarly branch in the pricing engine stays dark because testing it is hard — the number went up, the risk didn't move. Goodhart's law in a CI gate.

Used the other way, coverage is a flashlight: it shows the lines and branches your tests never touched. Point it at the code that matters — the critical path, the error handling, the new logic in this diff — and the uncovered branches are a worklist of real gaps. Branch coverage beats line coverage here, because the dangerous gap is usually the `else` you forgot, which line coverage happily counts as covered.

**How to apply:**
- Read the coverage *report*, not the coverage *number*. Look at which branches in important code are red, and write tests for the ones that matter.
- Prioritize uncovered branches on critical and error paths over chasing a percentage across trivial code.
- Prefer branch/condition coverage to line coverage for finding the real gaps.
- If you set a CI threshold, treat it as a ratchet that catches *drops* on changed code, not a bar that justifies testing trivia to clear it. The `/dev` workflow applies exactly this — **per-level diff-coverage floors on the changed code**: unit ≥ 80%, integration ≥ 70%, e2e ≥ 50% of the change's **critical user journeys** (journey coverage keeps the pyramid; e2e *line* coverage would invert it). Each floor covers the slice that level owns — integration over only the *boundary-crossing* changed lines, so it never fires against (or pressures you to test) pure logic in the same diff; an empty slice has no floor. They are **advisory**: below-floor is a finding `qa` records and the orchestrator escalates (accept → retro, or back to add tests), not a ship-block — the floor means *don't ship changed logic nothing exercises*, not *pad the number*. Read the report for the dark branches, then decide.
- 70% coverage of the hard logic beats 100% coverage that skips it.

**Example:**
```
Coverage report says 92% overall — looks great. Then you read it:

  pricing/discount.ts   54%   ← the branchy core is half-dark
  pricing/tier.ts       48%   ← the refund edge case is uncovered
  models/dto.ts        100%   ← trivial getters, padding the number

The 92% is a lie of averages. The flashlight says: write tests for the
two red files on the critical path; ignore the 100% on the DTOs.
```

---

## Pre-flight checklist

Before writing a test or designing a suite, run through these in your head:

1. **Behaviour vs implementation:** does each test assert an observable outcome (return value, stored state, emitted effect) rather than which internal functions got called? Would it survive a behaviour-preserving refactor?
2. **Level:** is each thing tested at the cheapest level that can prove it — unit for logic, integration for boundary crossings, a few e2e for whole journeys? Is the suite a pyramid, not an inverted cone?
3. **What to test:** are the contract, the edge cases (walked against the actual code), the error paths, and any once-shipped bug covered — and am I *not* testing getters, DTOs, or framework code?
4. **Doubles:** is every double at a real seam, faking only what's slow/costly/non-deterministic? Is the database real in integration tests? Am I avoiding mocking the thing under test?
5. **Isolation/determinism:** does each test own its state, control the clock/RNG/IDs, avoid sleeps and order-dependence? Would it pass run alone and in a shuffled suite?
6. **Shape & names:** is each test arrange-act-assert with one reason to fail, named after the behaviour so a failure explains itself without reading the body?
7. **Coverage:** am I using the report to find uncovered branches on critical paths, not chasing a percentage by testing trivia?

If any answer is "I don't know," stop and find out before writing.

## When to skip this skill

- Throwaway scripts and prototypes that will be deleted within the hour — no suite to design.
- The `qa` SKIPPED-mode types: `chore`, `docs`, and `spike` runs (a config bump, a docs edit, a research spike) have no executable surface to test; `qa` records the skip and its risk rather than writing tests.
- Trivial config edits — formatter rules, env vars, dependency version bumps — with no logic to assert.
- Generated code or thin pass-through wrappers around an already-tested library: test what *you* added, not the library.

For anything else — a function with branches, a boundary crossing, a contract a caller depends on, a bug being fixed, a refactor that needs a safety net, or a suite whose shape you're deciding — these fundamentals apply.

## How to use this skill in a conversation

This skill is always-on for testing-design work (per the always-on router `.claude/rules/fundamentals.md`). Don't ask the user to opt in. If the task matches "When to skip", say so in one sentence and proceed.

When the skill applies:
- **Writing a test** — name the behaviour first, pick the cheapest level that proves it, decide which seams to fake (and keep the DB real for integration), then write it arrange-act-assert with a behaviour name.
- **Deciding what to test** — start from the contract and the error paths, walk the edge-case checklist against the actual code, and classify each reachable case as covered / specified / undefined rather than inventing assertions for unspecified behaviour.
- **Designing a suite** — sketch the pyramid: which logic goes unit, which crossings go integration, which journeys justify an e2e. Push every test to the lowest level that can prove the thing.
- **Reviewing coverage** — read the report, not the number; point the flashlight at uncovered branches on critical and error paths.

This skill is design-time. In `/dev`, the `qa` agent *designs* the strategy into `test-plan.md` (phase 2½) and then *executes* the suite, recording results in `tests.md` (phase 7); the `engineer` writes tests as it implements — all reach for these fundamentals to decide *what good looks like*; this skill does not duplicate `qa`'s design/run/record procedure. Two type-specific contracts hand off to neighbours: for a **fix**, the regression test comes first and must fail on the old code (get the repro via [[debug-fundamentals]]); for a **refactor**, the baseline is a **characterization test** owned by [[refactoring-fundamentals]] — capture it before the structural change, then this skill governs any *new* tests you add.

When you make a non-obvious call (faking a collaborator that could have been real, choosing an e2e where a unit test wouldn't suffice, leaving a reachable input untested because it's spec-undefined), say *why* in one sentence. Don't emit tests silently.

## Reference files

Deeper guides for individual principles. Read the one that matches the work in front of you; you don't need to read them all upfront.

- `references/test-design.md` — arrange-act-assert, behaviour naming, one-reason-to-fail, parameterized/table tests, testing error paths and boundaries, test-data builders, and the canonical **edge-case checklist** (emptiness, boundaries, numbers, strings, time, ordering, concurrency, partial failure, auth/tenancy) with the covered/specified/undefined classification.
- `references/test-doubles-and-levels.md` — unit vs integration vs e2e decision rules and ratios, the dummy/stub/spy/mock/fake taxonomy and when each fails, faking at ports/seams, why integration uses a real database, contract tests across services, and taming flakiness (fake timers, test containers, no-sleep waiting, retries as a last resort).
