# Payments service

A small payments HTTP API (Node.js, no dependencies). State lives in a JSON
ledger file so the service survives restarts.

`createServer({ ledgerFile })` from `src/server.js` returns an `http.Server`;
`node src/server.js` serves `LEDGER_FILE` (default `./ledger.json`) on `PORT`.

## Ledger file

```json
{
  "payments": {
    "pay_1": { "amountCents": 10000, "capturedCents": 10000 }
  }
}
```

The service may add its own top-level keys and payment fields; a ledger in the
shape above must always load.

## Routes

All amounts are integer cents. All bodies are JSON.

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/payments/:id` | `200 {"id","amountCents","capturedCents","refundedCents"}` or `404 {"error":"not_found"}` |
| `POST` | `/payments/:id/capture` | Body `{"amountCents": positive integer}`; captures up to the authorized amount. `200` payment, `400 {"error":"invalid_amount"}`, `404`, or `409 {"error":"exceeds_authorized"}` |

Any other route returns `404 {"error":"not_found"}`; malformed JSON returns
`400 {"error":"invalid_json"}`.
