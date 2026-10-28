# Complexity

Do not write `O(n²)` when `O(n)` is the same code length.

| Operation | Array | Hash map / set | Tree map / set |
|---|---|---|---|
| Lookup / contains | O(n) | O(1) avg | O(log n) |
| Insert at end | O(1) amortized | O(1) avg | O(log n) |
| Insert at start | O(n) | O(1) avg | O(log n) |
| Sort | O(n log n) | — | already sorted |

Two facts that catch most engineers: array `.includes`/`.find`/`.indexOf`
is O(n), so inside a loop it is O(n²); array prepend (`unshift`, `[x, ...arr]`)
is O(n), so prepending in a loop is O(n²).

## Accidentally quadratic patterns

```js
orders.map(o => customers.find(c => c.id === o.customerId))   // O(orders × customers)
const byId = new Map(customers.map(c => [c.id, c]))
orders.map(o => byId.get(o.customerId))                       // O(orders + customers)
```

- String building by `+=` in a loop copies the prefix each time; use `join`.
- `Array.from`/`.toArray()` inside a loop.
- Recursion on overlapping subproblems without memoization.
- Chained `.filter` passes over a large dataset on a hot path.

## Pick the structure for the access pattern

Lookup by id → `Map`; uniqueness → `Set`; sorted with frequent inserts →
tree/sorted set; FIFO at scale → a real deque, not `array.shift()`.

## When to optimize

Profile first; algorithmic wins beat micro-optimizations; chunk large
datasets; cache only when you can name the invalidation rule. For every loop:
how big is the input, what does one iteration cost, and is the product fine
at the largest realistic size? If you cannot answer the first, find out.
