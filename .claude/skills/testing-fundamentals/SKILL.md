---
name: testing-fundamentals
description: "Use when a task's requirement has scenarios to prove: write a failing-first test per scenario and pick level and doubles. Skip docs, renames, and work with no behavior to prove."
---

# Testing fundamentals

A red test must fail for the predicted behavior, not a setup error; exercise
the real user path.

## Steps

1. Map each scenario to one test that asserts observable behavior: return
   value, persisted state, emitted contract, or error, not call order or shape.
2. Pick the cheapest level that proves the claim: unit for local decisions,
   integration for real boundaries, contract tests between independently
   evolving components, a few e2e tests for critical journeys.
3. Cover the contract, boundaries, failure paths, concurrency where relevant,
   and every shipped bug. Skip framework behavior and trivial accessors.
4. Double only at a real seam when the collaborator is slow, costly,
   nondeterministic, or out of scope; use the real DB/protocol in the focused
   integration test that claims that boundary.
5. Keep tests isolated and deterministic: own state, inject time/randomness/IDs,
   no sleeps or order dependence, one behavioral reason to fail.
6. Confirm the test fails for the intended reason on the old behavior and stays
   green through a behavior-preserving refactor. Use coverage to find untested
   critical branches, never as a target.

## Harness

The OpenSpec claim defines what must be true; the harness runs providers and
binds harness receipts, which establish proof. No parallel test plan or manual
completion claim; Build never stages or commits.

## References

- `references/test-design.md` — cases, assertions, the two-edit test, hollow assertions.
- `references/test-doubles-and-levels.md` — choosing level and seam.
- `references/coverage.md` — reading coverage.
- `references/verification-drivers.md` — executable surface checks.
