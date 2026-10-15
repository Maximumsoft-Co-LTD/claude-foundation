# Checkout pricing

`src/pricing.js` prices a checkout in integer cents:

- `subtotalCents(lines)` sums `priceCents * quantity`.
- `loyaltyPercent(points)` returns the loyalty discount percent for a balance.
- `priceOrder(lines, { points })` returns
  `{ subtotalCents, discountPercent, discountCents, totalCents }`.

Release notes live in `CHANGELOG.md`.
