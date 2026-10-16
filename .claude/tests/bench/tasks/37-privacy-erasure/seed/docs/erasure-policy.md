# Erasure policy

A customer may ask us to erase their personal data. An erasure request is
handled by `eraseCustomer(store, customerId, { requestedBy, now })`, exported
from `src/erasure.js`. `now` is a `Date`; `requestedBy` is the staff id that
processed the request.

## What changes

| Record | Field | After erasure |
|---|---|---|
| customer | `name` | `"Erased customer"` |
| customer | `email`, `phone`, `address` | `null` |
| customer | `erasedAt` | `now` as an ISO 8601 string |
| order of that customer | `shippingAddress`, `giftMessage` | `null` |

## What is kept

- Customer `id` and `createdAt`.
- Every order field not listed above: `id`, `customerId`, `placedAt`,
  `currency`, `total`, and `items` (sku, quantity, unit price). Revenue reports
  must give the same numbers before and after an erasure.
- Other customers and their orders are not touched.

## Audit

Each erasure appends exactly one entry to `store.audit`:
`{ action: "customer_erased", customerId, requestedBy, at }` where `at` is
`now` as an ISO 8601 string. The audit log is retained, so the entry must not
contain any of the erased personal data.

## Result and errors

- Returns `{ customerId, ordersAnonymized, alreadyErased: false }`.
- Repeating a request for an erased customer changes nothing, adds no audit
  entry, and returns `{ customerId, ordersAnonymized: 0, alreadyErased: true }`.
- An unknown customer id throws an error whose `code` is `"CUSTOMER_NOT_FOUND"`
  and changes nothing.
