# Requirement update 1 for the order and inventory change

The product owner approved this update after Build started. It applies to the
same in-flight change and to `ORDER-INVENTORY.md`; everything not mentioned
here is unchanged. Amend the existing change, keep work that is still valid,
and add meaningful tests for the new and revised behavior.

## Revised: reservation TTL

`ttlMs` is an integer from 1 to 3600000 (one hour), replacing the previous
upper bound of 86400000. 3600000 is accepted; 3600001 and 86400000 are
rejected with 400 `INVALID`. Every other reservation rule is unchanged.

## New: partial release

`POST /v2/orders/:id/release`, operator, body `{quantity}`, with a non-empty
`Idempotency-Key` header. It reduces a `reserved` order's quantity by
`quantity` and restores exactly that much available stock once. The order
stays `reserved`; `expiresAt` and `lastSequence` do not change. Response: 200
with the updated order.

- `quantity` is a positive safe integer (no booleans or coercion), otherwise
  400 `INVALID`. A quantity greater than or equal to the order's current
  quantity is 409 `INVALID_RELEASE` (use cancel to release everything).
- An order that is not `reserved` (confirmed, cancelled or expired) is 409
  `NOT_RESERVED`. Due reservations are settled before the check, so an order
  that expired at `expiresAt <= now()` is `NOT_RESERVED` and its stock was
  restored by expiry only once.
- Release keys are tenant-wide and a separate namespace from reservation
  keys. An exact retry (same key, order and quantity) returns the current
  order with 200 without restoring again, including after a restart or a later
  terminal transition. The same key with a different order or quantity is 409
  `IDEMPOTENCY_CONFLICT`. Failed requests do not consume the key.
- Authentication precedes validation; viewers get 403 `FORBIDDEN`; another
  tenant's order is 404 `NOT_FOUND`. Rejected requests change nothing.
- Reservation idempotency compares a retry with the original request, not
  with the order's current quantity: after a release, an exact retry of the
  original `POST /v2/orders` returns the reduced order with 200, and a retry
  with a different sku, quantity or TTL is still 409 `IDEMPOTENCY_CONFLICT`.

## SDK and web state

Add `release(id, quantity, key)` to the SDK client (path-encoded, bearer and
idempotency headers, typed errors as for the other methods). Web state needs no
new action: `order-updated` with a released order (same `lastSequence`) must
replace the stored reserved order.
