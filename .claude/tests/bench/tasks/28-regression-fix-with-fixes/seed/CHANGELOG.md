# Changelog

## 2026-10-01 — Add loyalty discount

- Checkout grants a loyalty discount from the customer's point balance: 0%
  below 1000 points, 5% from 1000 points, and 10% from 5000 points.
- The discount is rounded to the nearest cent, half a cent up; the total is
  the subtotal minus the discount.
- Negative or non-integer point balances are rejected with a `RangeError`.

## 2026-09-12 — Initial checkout pricing

- `subtotalCents(lines)` and `priceOrder(lines)` in integer cents.
