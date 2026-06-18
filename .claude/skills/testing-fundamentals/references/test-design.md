# Test Design

How an individual test is shaped, named, fed data, and aimed at the inputs that actually break code. This file is the canonical home of the edge-case checklist — the `/dev` `qa` agent's edge-case discovery pass resolves here.

## Arrange / Act / Assert

Every test has three jobs: set up the world, do the one thing, check the outcome. Keep them visibly separate — blank lines or comments — so the test reads top to bottom.

```py
def test_orders_over_100_get_a_discount():
    # arrange — build only the inputs this test cares about
    order = make_order(subtotal_cents=15_000)
    # act — the single call under test
    total = discounted_total(order)
    # assert — the expected outcome
    assert total == 13_500
```

Rules that follow from the shape:
- **One act.** If a test calls the thing under test twice with different inputs, it's two tests. Exception: a sequence *is* the behaviour ("withdraw then withdraw again is rejected") — the second call is the act and the first is arrange.
- **Don't assert mid-arrange.** Assertions sprinkled through setup check more than one thing and don't tell you which failed.
- **No logic in the test.** Loops, conditionals, and `try/except` in a test body are where test bugs hide. Use parameterized tests (below), not hand-rolled `for`.

## One reason to fail

A test should fail for exactly one reason. That is *not* the same as "one assert statement."

- Asserting three fields of one returned object is **one reason** — the object came out wrong. Fine.
- Asserting that creating a user *and* that listing users *and* that deleting a user all work is **three reasons** in one test. When it goes red you don't know which broke, and the first failure hides the other two. Split it.

The test name is the contract for "one reason": if you can write a single sentence describing what broke, it's one test. If the sentence needs an "and", split it.

## Naming: state the behaviour, not the method

The name is read at 2 a.m. by someone who didn't write it. It should say what *rule* the test enforces so a red name explains the break without opening the body.

```js
// Bad — names the function or a number; tells you nothing about the expectation
test('calculateDiscount')
test('discount test 2')
test('returns 13500')

// Good — names the rule; a failure is self-explaining
test('orders over $100 get a 10% discount')
test('orders under $100 get no discount')
test('discount applies before tax, not after')
test('refund fails when the order is already refunded')
```

Conventions that scale: `<subject> <condition> <expected outcome>`, or the BDD `describe('refund', () => it('fails when already refunded'))`. Pick one per project and keep it. The smell to avoid is the method name plus a serial number (`testFoo`, `testFoo2`) — that's a name that has given up.

## Test data: builders over fixtures

Each test should make the *one* input it cares about obvious and leave everything else as a sane default.

- **Builders / factories beat shared fixtures.** `make_order(subtotal_cents=15_000)` lets the test state price and ignore address, tier, timestamps. A big shared `setUp` fixture couples every test to one shape.
- **Realistic but minimal.** Set the fields the behaviour reads; leave the rest defaulted.
- **No production data.** Real user data in a test repo is a leak waiting to happen and tends to be brittle.
- **Name the magic values.** `subtotal_cents=15_000  # $150, over the $100 discount threshold` turns a bare number into the reason it was chosen.

```py
# A builder with defaults — each test overrides only what it asserts on
def make_order(subtotal_cents=10_000, tier='STANDARD', items=None, coupon=None):
    return Order(
        subtotal_cents=subtotal_cents,
        tier=tier,
        items=items if items is not None else [Item(price_cents=subtotal_cents)],
        coupon=coupon,
    )
```

## Parameterized / table tests

When the *same rule* is exercised by many inputs, don't copy-paste the test — drive it from a table. One rule, many rows, each row a named case so a failure reports which input broke.

```py
# pytest
@pytest.mark.parametrize("subtotal_cents, expected, case", [
    (   9_900,  9_900, "under threshold: no discount"),
    ( 10_000, 10_000, "exactly at threshold: no discount (boundary)"),
    ( 10_001,  9_000, "one cent over: discount applies (boundary)"),
    (100_000, 90_000, "well over: discount applies"),
])
def test_discount_threshold(subtotal_cents, expected, case):
    assert discounted_total(make_order(subtotal_cents)) == expected, case
```

```js
// vitest / jest
test.each([
  [ 9_900,  9_900, 'under threshold'],
  [10_000, 10_000, 'at threshold (boundary)'],
  [10_001,  9_000, 'one cent over (boundary)'],
])('subtotal %i cents -> total %i (%s)', (subtotal, expected) => {
  expect(discountedTotal(makeOrder(subtotal))).toBe(expected)
})
```

When *not* to table-ize: when the cases differ in shape (different setup, different assertion), not just in values. Forcing dissimilar cases into one table produces a parameter list full of `null`s and conditionals. Table tests are for one rule across a range of inputs, especially boundaries.

## Testing error paths

The unhappy path is its own behaviour and gets its own test — feed the bad input, assert the *defined* response, not merely "it throws."

- **Assert the specific error, not just that something threw.** `pytest.raises(InsufficientFunds)` beats `pytest.raises(Exception)`; the broad catch passes even when the code throws the wrong thing (e.g. a `NameError` from a typo) and gives you false confidence.
- **Assert the error's content when callers depend on it** — the status code, the error code/field, the message a client parses. If the contract says "422 with `{field: 'email'}`", test that, not just "4xx".
- **Test that the error path leaves clean state.** A failed transfer must not have moved half the money; a rejected upload must not have left a partial file. The assertion is on the *state after the failure*, which is where silent corruption hides.
- **Errors are values where the language allows it** ([[programming-fundamentals]]). If the function returns a `Result`/`Either` rather than throwing, assert on the `Err` branch the same way — it's still an error-path test.

```ts
test('transfer fails and moves no money when the source is overdrawn', () => {
  const bank = makeBank({ alice: 50, bob: 0 })
  expect(() => bank.transfer('alice', 'bob', 100)).toThrow(InsufficientFunds)
  expect(bank.balance('alice')).toBe(50)   // state intact — the real assertion
  expect(bank.balance('bob')).toBe(0)
})
```

## Boundary testing

Off-by-one is the most common logic bug; boundaries are where you catch it. For any limit `n`, test `0, 1, n-1, n, n+1`. For any collection, test empty, single-element, and "more than one." For any range, test below-min, min, max, above-max. Boundaries are the highest-value-per-test inputs you can write — they're exactly where the happy-path test passes and production fails.

## Edge-case checklist

The requirement usually spells out the happy path. These are the inputs that break code in production anyway. Walk the list against the **actual code under test** — skip any case a type or a guard already makes impossible (don't test illegal states you've made unrepresentable; that's noise).

- **Emptiness / absence** — empty string, empty list/map, `null`/`undefined`/`None`, missing optional field, zero rows returned.
- **Boundaries** — min, max, and ±1 around every limit (`0, 1, n-1, n, n+1`); off-by-one is the classic bug. First/last element, single-element collection.
- **Numbers** — negative, zero, very large (overflow), floating-point rounding, division by zero, money in the smallest unit.
- **Strings / text** — unicode, emoji, combining chars, leading/trailing whitespace, very long input, injection-ish payloads (`'`, `<`, `;`, `../`), mixed newline styles.
- **Time** — timezone boundaries, DST, leap year/second, clock skew, expiry exactly at `now`, events with equal timestamps.
- **Collections / ordering** — duplicates, unsorted input where sorted is assumed, ordering not guaranteed, pagination at the boundary.
- **Concurrency / repetition** — same request twice (idempotency), retry after partial success, two writers racing one row, out-of-order delivery.
- **Failure / partial state** — dependency times out or errors mid-operation, network drops between a DB write and its side effect, transaction rolls back.
- **Auth / tenancy** — unauthenticated, authenticated-but-unauthorized, one tenant reaching another's data.

For each case the code under test can actually reach, decide one of three:

- **Covered** — a test (or an acceptance criterion's `on error / at boundary` clause) already asserts it → nothing to do.
- **Specified** — the requirement clearly implies the correct behaviour → write the test now.
- **Reachable-but-undefined** — the code can hit this input but the requirement never says what *should* happen → do **not** invent the assertion. Surface it as a gap (input · why reachable · the open question). Guessing an assertion here bakes a guess into the suite and hides the missing decision.

## When tests are painful to write

Pain is design feedback:
- "I have to mock 12 things" → the unit has too many dependencies; extract the pure logic and test that directly.
- "I can't tell what this should do" → the behaviour isn't crisp; clarify the requirement before writing the test.
- "The test is longer than the code" → either the test is doing too much (split it) or the code hides complexity behind a simple interface.

Listen to the pain. The fix is usually in the production code.
