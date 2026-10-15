# Refunds

Support staff need to refund captured payments. Their tooling retries requests
on timeouts and network errors, so a retried refund must never pay out twice.

## `POST /payments/:id/refunds`

- Header `Idempotency-Key` (non-empty string) is required; without it respond
  `400 {"error":"idempotency_key_required"}`.
- Body `{"amountCents": positive integer}`; anything else is
  `400 {"error":"invalid_amount"}`.
- Unknown payment: `404 {"error":"not_found"}`.
- The total refunded for a payment may never exceed its captured amount; a
  refund that would is rejected with `409 {"error":"exceeds_captured"}` and
  changes nothing.
- Success: `201 {"refundId","paymentId","amountCents","refundedCents"}` where
  `refundedCents` is the payment's total refunded after this refund, and the
  payment's `refundedCents` (see `GET /payments/:id`) increases by `amountCents`.

## Retries

- Repeating a successful request with the same `Idempotency-Key`, the same
  payment, and the same body returns the original status and the identical
  response body, and does not refund again.
- Reusing a key with a different payment or a different body is rejected with
  `422 {"error":"idempotency_key_reused"}` and changes nothing.
- Retries must keep working after the service restarts on the same ledger
  file.
- Duplicate requests that arrive at the same time must still produce exactly
  one refund, and every one of them receives the original response.
