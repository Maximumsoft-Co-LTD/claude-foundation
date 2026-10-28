# Error handling

## The three buckets

| Bucket | Examples | Handling |
|---|---|---|
| Expected failure (domain) | validation failed, not found, insufficient funds | in the return type (`Result`, `Either`, `(value, error)`); the caller is forced to handle it |
| Bug (invariant violation) | null where non-null was promised, "cannot happen" branch | crash loudly (throw, panic, assert); log with full context; a ticket, not a retry |
| Infrastructure failure | network blip, DB connection lost, disk full | handle at the layer with retry/fallback context; wrap with context as it propagates (`fmt.Errorf("save order: %w", err)`, `new Error(msg, { cause })`) |

## Where to handle

Handle at the lowest layer that has enough context to do something useful;
propagate everywhere above.

```ts
async function fetchOrder(id: string) {                 // bottom: just propagates
  const res = await http.get(`/orders/${id}`)
  if (!res.ok) throw new Error(`fetch order ${id}: ${res.status}`)
  return res.json()
}
async function fetchOrderWithRetry(id: string) {        // middle: knows retry is appropriate
  for (let i = 0; i < 3; i++) {
    try { return await fetchOrder(id) } catch (e) { if (i === 2) throw e }
  }
}
app.get('/orders/:id', async (req, res) => {            // boundary: translates for the user
  try { res.json(await fetchOrderWithRetry(req.params.id)) }
  catch (e) { logger.error({ err: e, orderId: req.params.id }, 'fetch failed'); res.status(502).json({ error: 'upstream unavailable' }) }
})
```

System boundaries (HTTP handlers, message consumers, CLI entry points,
scheduled jobs) must catch everything: catch, log with full context,
translate to the boundary's error model (status, exit code, NACK).

## What not to do

- `catch { }` or `catch (e) { console.log(e) }` and continue: the program now
  runs in an unknown state.
- `if err != nil { return nil }`: swallowing in Go.
- Catching in the deepest helper "to be safe": it has no idea whether to
  retry or fail and hides information from layers that could decide.

## Result types without native support

TypeScript: a discriminated union `{ ok: true; value } | { ok: false; error }`.
Python: a `Result` class or `(value, error)` tuple; do not rely only on
exceptions for expected failures. Go: `(T, error)` with `%w` wrapping. Rust:
`Result` and `?`.

## The smell test

For every `catch`/`recover`/`if err != nil`: if this code did not exist, what
would go wrong? "The user sees a confusing 500" → boundary handling, keep it.
"Nothing, we would notice the bug sooner" → delete it.
