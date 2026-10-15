# Change: Add loyalty discount

## Why

Returning customers asked for a reward for their loyalty points. Checkout
should apply a tiered discount based on the customer's point balance.

## What Changes

- Add `loyaltyPercent(points)` with three tiers: none, silver, and gold.
- `priceOrder(lines, { points })` applies the tier discount to the subtotal,
  rounding the discount to the nearest cent (half up).
- Reject negative or non-integer point balances with a `RangeError`.

## Impact

- Affected specs: `pricing`
- Affected code: `src/pricing.js`, `test/pricing.test.js`
