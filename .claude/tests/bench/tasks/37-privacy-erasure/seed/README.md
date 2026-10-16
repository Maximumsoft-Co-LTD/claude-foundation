# shopledger

Customer and order records for a small web shop (Node.js, no dependencies).

- `src/store.js`: `createStore({ customers, orders })` returns an in-memory store
  `{ customers, orders, audit }` (plain arrays; `audit` starts empty).
- `src/reports.js`: `revenueByCurrency(store)` and `customerSummary(store, id)`
  power finance reports and the support console.

Finance must be able to reconcile revenue for seven years, so order amounts are
never deleted. Personal data handling is described in
[docs/erasure-policy.md](docs/erasure-policy.md).
