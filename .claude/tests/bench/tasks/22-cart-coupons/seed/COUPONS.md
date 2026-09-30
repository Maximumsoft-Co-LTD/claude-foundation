# Coupons

Add coupon support to checkout. All money is integer cents. Existing behavior
(cart operations, `subtotalCents`, `taxCents`, and `checkout(cart)` without
coupons) must not change.

## Module contract

Create `src/coupons.js` exporting:

- `CouponError` — a subclass of `Error` with a string `code` property.
- `createCouponStore(definitions, { now } = {})` — returns a store holding the
  coupon definitions. `now` is a function returning the current `Date`
  (default: `() => new Date()`); expiry is always evaluated through it.
  Invalid definitions throw `CouponError` with code `INVALID_COUPON`.

Extend `src/checkout.js`:

```js
checkout(cart)                                   // unchanged totals, discountCents: 0
checkout(cart, { coupons: store, codes: ["SAVE10", "BOGO-APPAREL"] })
// → { subtotalCents, discountCents, taxCents, totalCents }
```

`codes` defaults to `[]`. Codes are matched exactly (case-sensitive).

## Coupon definitions

| Type | Fields | Rule |
|---|---|---|
| `PERCENT` | `percent`: integer 1–100 | discount = `base × percent / 100`, rounded half up to a whole cent |
| `FIXED` | `amountCents`: positive integer | discount = `min(amountCents, base)`; the base never goes below 0 |
| `BOGO` | `category`: non-empty string | buy one, get one free within that category (below) |

Every definition has a unique non-empty string `code` and may also have:

- `minSubtotalCents` — non-negative integer; the coupon requires the cart
  subtotal (before any discount) to be at least this amount.
- `expiresAt` — ISO date `YYYY-MM-DD`; the coupon is valid through the end of
  that day in UTC and expired from `00:00:00Z` of the following day.

Any other shape (unknown type, percent 0 or 101, non-integer values, missing
category, duplicate code) is `INVALID_COUPON`.

### BOGO

Expand the cart's units in the coupon's category (a line with quantity 3 is
three units), sort them by unit price from highest to lowest, and group them into
consecutive pairs. The cheaper unit of every complete pair is free; an unpaired
last unit is paid. Example: units 1999, 1250, 599 → 1250 is free.
Units 1999, 1999, 1250, 599 → 1999 + 599 are free.

## Applying coupons

1. Validate every code before applying anything.
2. Stacking: at most one `PERCENT`-or-`FIXED` coupon plus at most one `BOGO`
   coupon per checkout. Anything else (two order-level coupons, two BOGO
   coupons, the same code twice) is rejected.
3. The BOGO discount is applied first. The `PERCENT`/`FIXED` base is the
   subtotal minus the BOGO discount.
4. `discountCents` is the sum of all discounts. Tax is computed on
   `subtotalCents − discountCents` with the existing `taxCents`.
   `totalCents = subtotalCents − discountCents + taxCents`.

## Single use

A successful `checkout` redeems each applied code in its store; using a
redeemed code again is rejected. A checkout that throws redeems nothing.

## Errors

Rejected checkouts throw `CouponError` with one of these codes:

| `code` | When |
|---|---|
| `UNKNOWN_CODE` | code is not in the store |
| `EXPIRED` | `now()` is past the coupon's expiry day |
| `MIN_SUBTOTAL_NOT_MET` | cart subtotal is below `minSubtotalCents` |
| `ALREADY_USED` | the code was redeemed by an earlier successful checkout |
| `NOT_STACKABLE` | the combination violates the stacking rule |

## Tests

Add `node --test` tests (`npm test`) covering the coupon rules. Keep the
existing tests passing.
