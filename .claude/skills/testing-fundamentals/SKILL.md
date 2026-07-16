---
name: testing-fundamentals
description: Apply testing fundamentals — test behaviour not implementation, the test pyramid, what to test (contract, boundaries, error paths, the bug you just fixed), test doubles with discipline, isolated/deterministic/fast tests, behaviour-named arrange-act-assert, coverage as a flashlight. Use BEFORE writing a test, deciding what to test, designing a suite, choosing test levels (unit/integration/e2e), or reviewing coverage; the trigger is any "how should this be tested" decision, even when no principle is named. Skip throwaway scripts, chore/docs/spike work, and trivial config.
---

# Testing Fundamentals

## Why this exists

Classic test suite anti-patterns: implementation tests that break on every refactor, an inverted pyramid of slow flaky e2e tests the team stops running, mocking the database so tests stay green while the real integration is broken, and bugs that recur because nobody pinned them with a regression test the first time.

This skill is a **pre-flight**: read it before you write a test, choose the level, or design the suite. It is the design-time companion to the construction skills (run order in `.claude/rules/fundamentals.md`) and the "how to test well" the `/dev` `qa` agent reaches for at its test phases (those phase mechanics live in `WORKFLOW.md`).

Two neighbours own adjacent territory: [[refactoring-fundamentals]] owns **characterization tests** (captured before reshaping untested code); [[debug-fundamentals]] owns **reproduction** (pinning a failure into a reliable repro). For a `fix`, the regression test comes first and must fail on the old code; for a `refactor`, the safety net is a characterization test captured before the structural change. This skill owns everything else about a test: its shape, level, doubles, and assertions.

Composes with [[programming-fundamentals]] (pure cores are easiest to test) and [[hexagonal-backend]] (whose ports are exactly the seams you fake at).

## The 7 principles

The early ones unblock the later ones. Full rule/why/how-to-apply/example for each lives in the linked reference file.

| # | Principle | Compressed rule | Reference |
|---|---|---|---|
| 1 | Test behaviour, not implementation | Assert the observable outcome (return value, persisted row, published message, raised error), not the internal call graph. If a behaviour-preserving refactor breaks the test, the test was wrong. | `references/test-design.md` |
| 2 | The test pyramid — push every test to the cheapest level that proves the thing | Many fast units, fewer integrations, a few e2e. For each thing to prove, pick the lowest level that can actually prove it. | `references/test-doubles-and-levels.md` |
| 3 | Test the contract, the boundaries, the error paths — and the bug you just fixed | Spend effort where bugs live: caller contract, input edges, failure paths, once-shipped bugs (regression test first, failing on old code). Skip getters, DTOs, framework code. | `references/test-design.md` |
| 4 | Use test doubles with discipline — fake at the seams, real for what you're testing | Double only at a port/seam, only when the real thing is slow/costly/non-deterministic/out of scope. Real database in integration tests — never mocked. | `references/test-doubles-and-levels.md` |
| 5 | A good test is isolated, deterministic, and fast | Each test owns its world: no shared mutable state, injected clock/RNG/IDs, no sleeps, no order dependence. A flaky test is worse than no test. | `references/test-doubles-and-levels.md` |
| 6 | Arrange-Act-Assert, one reason to fail, names that state the behaviour | Three visible sections, one assertable behaviour per test, named after the rule it pins so a CI failure explains itself. Builders for test data, table tests for many inputs. | `references/test-design.md` |
| 7 | Coverage is a flashlight, not a goal | Use the report to find uncovered branches on critical paths; never chase a percentage. Branch coverage beats line coverage; a threshold is a ratchet, not a target. | `references/coverage.md` |

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
- `chore`, `docs`, and `spike` work (a config bump, a docs edit, a research spike) — no executable surface to test. (In `/dev` these are `qa`'s skipped types; see `WORKFLOW.md`.)
- Trivial config edits — formatter rules, env vars, dependency version bumps — with no logic to assert.
- Generated code or thin pass-through wrappers around an already-tested library: test what *you* added, not the library.

For anything else — a function with branches, a boundary crossing, a contract a caller depends on, a bug being fixed, a refactor that needs a safety net, or a suite whose shape you're deciding — these fundamentals apply.

## How to use this skill in a conversation

Always-on for testing-design work (per `.claude/rules/fundamentals.md`). Don't ask the user to opt in. If the task matches "When to skip", say so in one sentence and proceed.

This skill is design-time: in `/dev`, `qa` and `engineer` both reach for these fundamentals to decide *what good looks like* (their test phases are defined in `WORKFLOW.md`). Type-specific hand-offs: for a **fix**, the regression test comes first and must fail on the old code (get the repro via [[debug-fundamentals]]); for a **refactor**, the baseline is a **characterization test** owned by [[refactoring-fundamentals]] — capture it before the structural change, then this skill governs any *new* tests you add.

When making a non-obvious call (faking a collaborator that could be real, choosing an e2e where a unit test wouldn't suffice, leaving a reachable input untested because spec-undefined), say *why* in one sentence. Don't emit tests silently.

## Reference files

Deeper guides for individual principles. Read the one that matches the work in front of you; you don't need to read them all upfront.

- `references/test-design.md` — arrange-act-assert, behaviour naming, one-reason-to-fail, parameterized/table tests, testing error paths and boundaries, test-data builders, and the canonical **edge-case checklist** (emptiness, boundaries, numbers, strings, time, ordering, concurrency, partial failure, auth/tenancy) with the covered/specified/undefined classification; principles 1, 3, and 6's full rule/why/how-to-apply/example.
- `references/test-doubles-and-levels.md` — unit vs integration vs e2e decision rules and ratios, the dummy/stub/spy/mock/fake taxonomy and when each fails, faking at ports/seams, why integration uses a real database, contract tests across services, and taming flakiness (fake timers, test containers, no-sleep waiting, retries as a last resort); principles 2, 4, and 5's full rule/why/how-to-apply/example.
- `references/coverage.md` — reading the report over the number, branch vs line coverage, thresholds as ratchets, the `/dev` diff-coverage note; principle 7's full rule/why/how-to-apply/example.
