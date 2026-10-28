# Data modeling, illegal states, pure core

## Model the data first

Decide the shape of the data before the operations. Most "complex logic" is
an awkward data shape in disguise.

- Sketch the input and output types before writing the function; if you
  cannot write them down, you do not understand the problem yet.
- Prefer the most constrained shape that holds the data you have: a `Set`
  when there are no duplicates, a record when the keys are known.
- Group fields that travel together: three parameters that always appear
  together are one thing.

```ts
function chargeAll(userIds: string[], amounts: number[], currencies: string[])  // parallel arrays misalign
type Charge = { userId: UserId; amount: Money }
function chargeAll(charges: Charge[])                                           // misalignment impossible
```

## Make illegal states unrepresentable

A type constraint or smart constructor enforces a rule once, everywhere; an
application check gets forgotten or written five ways.

- Wrap a string with rules in a type (`Email`, `UserId`); the constructor
  validates once.
- Replace combining boolean flags with a sum type:
  `Loading | Error(e) | Ready(data)` instead of `{ isLoading, error, data }`.
- Replace conditionally-nullable fields with explicit states:
  `Unverified(email?) | Verified(email, at)`.

## Pure core, effectful shell

Push I/O, time, randomness, network, and storage to the edges; keep the logic
in the middle pure so it is cheap to test and change.

- Pass ambient effects as arguments or injected ports: `priceFor(order, now)`
  is testable; a hidden `Date.now()` is not.
- Sequence load → compute → write; do not interleave reads with computation.

```ts
function discountFor(total: Money): Money {
  return total.cents > 10_000 ? total.scale(0.1) : Money.zero(total.currency)
}
// shell: load order → discountFor → save
```

## Read before you write

Read the full error message, the failing function, its callers, and the
project's existing utilities before changing anything. The function's
contract is what callers depend on, not what its docstring claims. Unknown-
cause failures have their own procedure in `debug-fundamentals`.
