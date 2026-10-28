# Test Design

How an individual test is shaped, named, fed data, and aimed at the inputs that actually break code. This file is the canonical home of the edge-case checklist.

## Behaviour, not implementation

Assert the observable outcome — the return value, the persisted row, the message published, the error raised — not the internal steps. If a refactor that preserves behaviour breaks the test, the test was wrong. A test that is mostly `expect(mock).toHaveBeenCalledWith(...)` is a snapshot of the call graph. Reserve "was this collaborator called" for cases where the call *is* the behaviour ("on payment success, the receipt email is sent"). Test private methods through the public surface; if one is hard to reach that way, that is a design signal.

```js
// Bad — any refactor of the internals breaks it
expect(repo.findRate).toHaveBeenCalledWith('GOLD')

// Good — survives any internal rewrite
test('gold-tier orders over $100 get 10% off', () => {
  expect(applyDiscount(makeOrder({ tier: 'GOLD', subtotalCents: 15_000 }))).toBe(13_500)
})
```

## Judge a test by two edits

Imagine two edits to the code under test before trusting a test:

1. **Break the behavior** — return the wrong value, skip the write, drop the
   check. The test must fail. If it still passes, it pins nothing.
2. **Change the internals while keeping behavior** — rename a helper, reorder
   independent steps, swap the algorithm. The test must pass. If it fails, it
   pins the implementation.

A test that survives the first edit is hollow. Common causes:

- **Expected value computed by the code under test** — `expect(total(x)).toBe(total(x))`, or a helper that reuses production logic to build the expectation. Derive expected values by hand or from an independent oracle.
- **Restated constant** — asserting `RATE === 0.1` repeats the source; assert the outcome the constant produces.
- **"Not called" without a positive case** — `expect(send).not.toHaveBeenCalled()` passes when the whole path is dead. Pair it with a test where the same setup, changed in one input, does call it.

For idempotent behavior, do the effect twice: apply the operation, apply it
again, and assert the state, rows, or emitted events equal the single-run
result. Breaking idempotency must make that test fail.

## Where bugs live

Spend test effort on the contract a caller depends on, the edges of every input range, the failure paths, and any bug that has shipped once. Skip getters, DTOs, generated code, and thin wrappers around well-tested libraries. For a fix, the regression test comes *first* and must fail on the old code (see [reproduction](../../debug-fundamentals/references/reproduction.md)). For a reachable input the requirement never defines, do not invent the assertion — surface it as a gap.

```py
def test_orders_over_100_get_discount():        # contract
    assert discounted_total(make_order(15_000)) == 13_500
def test_empty_order_totals_zero():             # boundary: emptiness
    assert discounted_total(make_order(items=[])) == 0
def test_negative_line_item_is_rejected():      # error path
    with pytest.raises(ValueError):
        discounted_total(make_order(items=[Item(price_cents=-1)]))
def test_discount_never_exceeds_subtotal():     # the bug that shipped once
    assert discounted_total(make_order(1, coupon='FREE200')) == 0
```

## Arrange / Act / Assert, one reason to fail

Keep the three sections visibly separate. One act per test — if it calls the thing under test twice with different inputs, it is two tests (a sequence that *is* the behaviour is the exception: the last call is the act). No assertions mid-arrange, no loops or conditionals in the body.

"One reason to fail" is not "one assert": three fields of one returned object are one reason; create-and-list-and-delete are three. If the sentence describing the break needs an "and", split the test.

## Naming: state the behaviour, not the method

```js
test('calculateDiscount')                              // bad: names the function
test('orders over $100 get a 10% discount')            // good: names the rule
test('refund fails when the order is already refunded')
```

Pick one convention per project (`<subject> <condition> <expected outcome>` or BDD `describe/it`) and keep it. `testFoo2` is a name that has given up.

## Test data: builders over fixtures

`make_order(subtotal_cents=15_000)` states the one input the test cares about and defaults the rest; a big shared fixture couples every test to one shape. Name magic values (`15_000  # $150, over the $100 threshold`). Never use production data.

```py
def make_order(subtotal_cents=10_000, tier='STANDARD', items=None, coupon=None):
    return Order(subtotal_cents=subtotal_cents, tier=tier,
                 items=items if items is not None else [Item(price_cents=subtotal_cents)],
                 coupon=coupon)
```

## Parameterized / table tests

One rule, many rows, each row named so a failure reports which input broke:

```py
@pytest.mark.parametrize("subtotal_cents, expected, case", [
    (  9_900,  9_900, "under threshold"),
    ( 10_000, 10_000, "at threshold (boundary)"),
    ( 10_001,  9_000, "one cent over (boundary)"),
])
def test_discount_threshold(subtotal_cents, expected, case):
    assert discounted_total(make_order(subtotal_cents)) == expected, case
```

Do not table-ize cases that differ in shape (different setup or assertion); that produces a parameter list of `null`s and conditionals.

## Testing error paths

Assert the specific error (`InsufficientFunds`, not `Exception`) and its content when callers depend on it (status code, error code, field). Assert that the failed path left clean state — a failed transfer moved no money, a rejected upload left no partial file. If errors are returned as values (`Result`/`Either`), assert the `Err` branch the same way.

```ts
test('transfer fails and moves no money when the source is overdrawn', () => {
  const bank = makeBank({ alice: 50, bob: 0 })
  expect(() => bank.transfer('alice', 'bob', 100)).toThrow(InsufficientFunds)
  expect(bank.balance('alice')).toBe(50)   // state intact — the real assertion
})
```

## Boundary testing

For any limit `n`, test `0, 1, n-1, n, n+1`; for any collection, empty, single, many; for any range, below-min, min, max, above-max. Mnemonic — **CORRECT**: Conformance, Ordering, Range, Reference, Existence, Cardinality, Time.

## Edge-case checklist

Walk the list against the **actual code under test**; skip any case a type or guard already makes impossible.

- **Emptiness / absence** — empty string, empty list/map, `null`/`None`, missing optional field, zero rows.
- **Boundaries** — min, max, ±1 around every limit; first/last element, single-element collection.
- **Numbers** — negative, zero, overflow, floating-point rounding, division by zero, money in the smallest unit.
- **Strings** — unicode, emoji, combining chars, surrounding whitespace, very long input, injection-ish payloads (`'`, `<`, `;`, `../`), mixed newlines.
- **Time** — timezone and DST boundaries, leap year/second, clock skew, expiry exactly at `now`, equal timestamps.
- **Collections / ordering** — duplicates, unsorted input where sorted is assumed, pagination at the boundary.
- **Concurrency / repetition** — retry after partial success, two writers racing one row, out-of-order delivery.
- **Failure / partial state** — dependency errors mid-operation, network drops between a write and its side effect, rollback.
- **Auth / tenancy** — unauthenticated, authenticated-but-unauthorized, one tenant reaching another's data.

For each reachable case decide: **Covered** (a test already asserts it), **Specified** (the requirement implies the behaviour → write the test), or **Reachable-but-undefined** (surface as a gap: input · why reachable · open question; never guess an assertion).

## Interaction, sequence & combination

- **State & transitions** — model states and events, then probe every *invalid* transition ("pay" a cancelled order), one per negative test.
- **Sequences / interrupt / repeat** — vary operation order; run the same action twice (double-submit → idempotency); interrupt mid-flight then resume → no half-written state.
- **Combinations** — ≥ 2 interacting settings: pairwise/all-pairs to bound the explosion; stacked conditions with distinct outcomes → a decision table.
- **Persisted round-trip** — `load(save(x)) == x`; a malformed or old-schema stored value degrades, never crashes; read-after-delete returns absence.
- **Property-based** — when a rule holds for all inputs, assert the property (round-trip, idempotence, invariant, model/oracle) and let the generator hunt the minimal breaker.

Techniques: state-transition (Chow 1978; ISTQB), pairwise (NIST), property-based (QuickCheck), CORRECT / Right-BICEP (Pragmatic Unit Testing), Hendrickson's heuristics, Bach's HTSM.

## When tests are painful to write

- "I have to mock 12 things" → extract the pure logic and test that directly.
- "I can't tell what this should do" → clarify the requirement first.
- "The test is longer than the code" → the test does too much, or the code hides complexity.

The fix is usually in the production code.
