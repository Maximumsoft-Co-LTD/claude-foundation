# PayRail webhook deliveries (provider documentation excerpt)

PayRail sends each event as a `POST` with a JSON body
`{ "id": "evt_...", "type": "...", "data": { ... } }`.

## Signatures

Every delivery carries a `PayRail-Signature` header:

```text
PayRail-Signature: t=1767225600,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
```

- `t` is the Unix time in seconds when PayRail signed the delivery.
- `v1` is the lowercase hex HMAC-SHA256 of the string `<t>.<raw request body>`
  using your endpoint secret. Sign the raw bytes exactly as received; do not
  re-serialize the JSON.
- While you rotate secrets, a header may carry several `v1` values (one per
  active secret). Accept the delivery if any `v1` matches any of your active
  secrets. Ignore unknown schemes such as `v0`.
- Compare signatures in constant time.

## Receiver requirements

- Reject a delivery with a missing, malformed or non-matching signature with
  `401 {"error":"invalid_signature"}` and do not process it.
- Reject a delivery whose `t` is more than 300 seconds before or after your
  current time with `401 {"error":"timestamp_out_of_tolerance"}` (replay
  protection), even when the signature matches.
- PayRail delivers at least once and retries with a fresh `t`. Process each
  event `id` at most once: a repeated `id` returns
  `200 {"status":"duplicate"}` without processing it again.
- A verified, new event returns `200 {"status":"processed"}`.
