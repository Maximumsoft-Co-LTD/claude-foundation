---
name: concurrency-fundamentals
description: Apply concurrency fundamentals — don't share mutable state, make shared access atomic, prevent deadlock by design, treat async/await as concurrency, make operations idempotent and cancellable, bound your concurrency, test the races you can. Use BEFORE writing code where things run at once in one process — threads, async/await, shared mutable state, locks, parallel tasks, event loops, callbacks that can race, worker pools — even when no principle is named. Includes a reference on shared-state escape hatches, locking, deadlock recipes, async pitfalls, and bounded concurrency. Skip single-threaded request/response with no shared mutable state, pure functions, and throwaway scripts.
---

# Concurrency Fundamentals

## Why this exists

Concurrency bugs are the heisenbugs: the test that only fails under load, the lost update from a read-modify-write with no lock, the deadlock from two locks taken in different orders, the async footgun where you forgot to `await` and the error vanished into a dropped promise, the data race nobody can reproduce on their laptop. They pass review, pass CI, pass staging, and surface in production at 3 a.m. when traffic finally interleaves two operations the wrong way.

These are the hardest bugs to reproduce and the easiest to prevent by design. You cannot reliably test your way out of a race after the fact — the failing interleaving might happen one time in ten million, and adding a `console.log` changes the timing enough to hide it. The leverage is all up front: choose a shape where the race *cannot* occur, and you never have to debug the version where it does.

This skill owns **in-process concurrency** — threads, async tasks, shared memory, locks, event loops inside a single process. It sits between [[programming-fundamentals]] (the single-threaded shape of the code) and [[queue-fundamentals]] (cross-process async over a broker). When work crosses a process boundary — a message broker, an event stream, a background-job queue between services — that's [[queue-fundamentals]], not this skill; the failure modes (redelivery, poison messages, exactly-once) live there. When the shared state is rows in a database and the contention is between transactions, that's [[database-fundamentals]] — isolation levels, `SELECT FOR UPDATE`, optimistic version columns. This skill covers the same *ideas* (atomicity, lost updates, optimistic concurrency) one layer up, in your own process's memory. Cross-reference both; don't duplicate them.

## The 7 principles

Each principle has a one-line rule, a *why*, and a worked example. Apply them in roughly this order — the early ones design away problems the later ones would otherwise have to manage.

---

### 1. Don't share mutable state — the easiest concurrency bug is the one you designed out

**Rule:** Before reaching for a lock, ask whether the state needs to be shared and mutable at all. If you can make it immutable, confine it to one owner, or pass it by message instead of by reference, the race disappears — no lock required.

**Why:** Every locking bug, every deadlock, every torn read is a problem you only have because two things touch the same mutable cell. Remove the sharing or remove the mutation and the entire category is gone. Locks are the *fallback* for when you genuinely can't avoid sharing — not the default. The cheapest race to fix is the one that was never representable.

**How to apply:**
- **Immutability** — if a value never changes after construction, any number of tasks can read it concurrently with zero coordination. Build new values instead of mutating shared ones. Frozen config, snapshots, copy-on-write.
- **Confinement** — give mutable state a single owner. One task, one actor, one thread owns the data; everyone else asks it to act. No other code holds a reference to mutate.
- **Share by communicating** — instead of "share memory and lock it," pass ownership through a channel/queue so only one task holds the data at a time (Go's mantra, Erlang's actors, JS Web Workers with `postMessage`). The hand-off is the synchronization.
- **Thread-local / task-local** — per-worker scratch state that's never shared needs no protection at all.

**Example:**
```ts
// Bad — shared accumulator whose read-modify-write straddles an await
let total = 0
await Promise.all(items.map(async (it) => {
  total += await score(it)   // reads `total`, suspends at await, writes later: two tasks
                             // read the SAME old value and one increment is lost
}))

// Good — no shared mutable state; each task returns its own value, combine after
const scores = await Promise.all(items.map((it) => score(it)))  // each task owns its result
const total = scores.reduce((a, b) => a + b, 0)                  // single-threaded fold, no race
```

In single-threaded JS the race is the read-modify-write that *straddles* an `await`: `total += await score(it)` reads `total`, suspends, and a second task reads the same old value before either writes. (A `+=` with no `await` between its read and write is atomic here — see principle 4.) The fix is the same — don't share the accumulator.

---

### 2. When you must share, make access atomic

**Rule:** If state genuinely must be shared and mutated, identify the **critical section** — the smallest span that must execute without interleaving — and protect it. A read-modify-write is never atomic by default. `i++` is not atomic.

**Why:** `count++` is three operations: read `count`, add one, write it back. Two threads can both read 41, both compute 42, both write 42 — one increment lost. This is the in-process twin of the database lost update ([[database-fundamentals]] principle 6). The fix is to make the read-modify-write indivisible: nobody else can observe or change the value between the read and the write.

**How to apply:**
- **Lock / mutex** — take the lock, do the read-modify-write, release. Hold it for the *smallest* span that preserves the invariant, and never across I/O or `await` you don't control (that's where deadlocks and starvation come from — see principle 3).
- **Atomic primitives** — `AtomicInteger`, `std::atomic`, `Interlocked.Increment`, an atomic CAS. For a single counter or flag these beat a lock: no blocking, no deadlock risk.
- **Compare-and-swap (CAS) loop** — read the current value, compute the new one, swap *only if* the value is unchanged; retry if it moved. Lock-free, the basis of most atomics.
- **Optimistic version** — for coarser state, attach a version number; on write, fail if the version moved and retry. Same shape as the DB optimistic-locking pattern, in memory.
- **Pick the right granularity** — one giant lock around everything is correct but serializes the whole system; a lock per shard/key keeps parallelism. Too fine and you reintroduce ordering bugs (principle 3).

**Example:**
```ts
// Bad — read-modify-write with an await in the middle; classic in-process lost update
async function reserve(seatId: string) {
  const seat = cache.get(seatId)          // read: { taken: false }
  await persist(seat)                     // <-- another task interleaves here
  cache.set(seatId, { taken: true })      // write: clobbers a concurrent reservation
}

// Good — serialize the critical section with a per-key lock (e.g. async-mutex)
const locks = new KeyedMutex()
async function reserve(seatId: string) {
  return locks.runExclusive(seatId, async () => {   // only one task per seatId at a time
    const seat = cache.get(seatId)
    if (seat.taken) throw new AlreadyReserved(seatId)
    await persist({ ...seat, taken: true })
    cache.set(seatId, { taken: true })
  })
}
```

---

### 3. Prevent deadlock by design

**Rule:** A deadlock is a cycle of waiting — A holds lock 1 and wants lock 2 while B holds lock 2 and wants lock 1. Break the cycle structurally: take locks in a consistent global order, keep lock scope tiny, avoid nested locks, and put a timeout on every acquire.

**Why:** Deadlocks don't crash — they hang. The process is alive, the request never returns, the connection pool drains, and the whole service wedges. They're maddening to reproduce because they need a precise interleaving. You can't test them away; you design them out by making the waiting graph acyclic.

**How to apply:**
- **Consistent lock ordering** — if any code path needs both lock A and lock B, *every* path takes them in the same order (e.g., always lower id first). A cycle is impossible if there's a total order. This is the single most effective rule.
- **Minimize scope** — hold a lock for the fewest statements possible. Compute outside the lock, mutate inside it, release immediately. The shorter the hold, the smaller the window for contention.
- **Avoid nested locks** — needing two locks at once is the precondition for deadlock. Often you can restructure to hold one at a time, or merge the two into one coarser lock.
- **Never lock across un-owned I/O** — holding a lock while you `await` a network call or wait on user input invites both deadlock and pathological latency. Load → release → call out → reacquire.
- **Timeout every acquire** — `tryLock(timeout)` instead of `lock()`. A timeout turns a silent permanent hang into a loud, recoverable error you can log, retry, or fail fast on.

**Example:**
```ts
// Bad — transfer locks accounts in argument order; two opposite transfers deadlock
async function transfer(from: Account, to: Account, amt: number) {
  await from.lock()      // T1: lock A, wants B   |  T2: lock B, wants A  -> cycle
  await to.lock()
  from.bal -= amt; to.bal += amt
  to.unlock(); from.unlock()
}

// Good — always acquire in a consistent order (by id); no cycle can form
async function transfer(from: Account, to: Account, amt: number) {
  const [first, second] = from.id < to.id ? [from, to] : [to, from]
  await first.lock()
  await second.lock()
  try { from.bal -= amt; to.bal += amt }
  finally { second.unlock(); first.unlock() }
}
```

---

### 4. async/await is concurrency too

**Rule:** `async`/`await` is concurrency, not parallelism, and it has its own footguns. An un-awaited promise swallows its error and races ahead of the code that should follow it. Blocking the event loop stalls *everything*. Know whether your runtime is cooperative or preemptive, and whether you want concurrent or sequential.

**Why:** People think single-threaded JS/Python is "safe" from races. It isn't — logical races happen at every `await` point, where another task can interleave. And the async-specific failure modes (dropped promises, blocked loops, accidental serialization) are just as production-breaking as a thread race, while looking like ordinary linear code.

**How to apply:**
- **Always await (or deliberately handle) every promise.** A floating promise runs detached: if it rejects, the error vanishes (unhandled rejection), and downstream code runs before it finishes. If you truly want fire-and-forget, say so explicitly and attach a `.catch`.
- **Concurrent vs sequential is a choice.** `await a(); await b();` runs them in series. `await Promise.all([a(), b()])` runs them concurrently. Pick on purpose — series for dependencies, parallel for independent work. (`Promise.allSettled` when you want every result even if some reject.)
- **Don't block the event loop.** A synchronous CPU-heavy loop or a sync FS/crypto call freezes every other task and request on the same thread. Offload to a worker thread, chunk the work, or use the async API. The same applies to Python's asyncio and a blocking call.
- **Cooperative vs preemptive.** In a cooperative runtime (JS event loop, Python asyncio) a task runs uninterrupted until it `await`s/yields — so a critical section with no `await` inside it is effectively atomic. In a preemptive *and* parallel model (OS threads, **Go goroutines** — multiple run simultaneously on `GOMAXPROCS>1`, and the scheduler also preempts asynchronously) two tasks execute at the same instant, so even `i++` races and every shared mutation needs an atomic or a lock. Know which you're in; it changes what needs a lock.

**Example:**
```ts
// Bad — floating promise: error is swallowed, and the email may not be sent before we return
async function checkout(cart: Cart) {
  sendReceiptEmail(cart)        // not awaited; rejection becomes an unhandled rejection
  return { ok: true }           // returns before the email resolves or fails
}

// Bad — accidental serialization: 100 independent fetches run one at a time
const out = []
for (const id of ids) out.push(await fetchUser(id))   // N sequential round-trips

// Good — await what must complete; run independent work concurrently
async function checkout(cart: Cart) {
  await sendReceiptEmail(cart)                 // failure propagates; ordering guaranteed
  return { ok: true }
}
const out = await Promise.all(ids.map(fetchUser))   // concurrent — but bound it (principle 6)
```

---

### 5. Make operations idempotent and cancellable

**Rule:** Concurrent systems retry and double-fire — a user double-clicks, a timeout fires while the work is still running, a supervisor restarts a task. Design operations so doing them twice equals doing them once, and so a cancellation or timeout cleanly unwinds whatever was half-started.

**Why:** Under concurrency you cannot assume an operation runs exactly once. Retries, races between a timeout and a completion, and re-entrant event handlers all cause the same logical action to fire more than once. If "charge the card" isn't idempotent, the customer gets double-charged. If a cancelled task leaves a lock held, a file open, or a half-written buffer, the next attempt inherits the mess. (This is the in-process cousin of broker redelivery in [[queue-fundamentals]] — there it's at-least-once delivery; here it's retries and re-entrancy.)

**How to apply:**
- **Idempotency key / dedup** — guard the effectful step with a key so a repeat is a no-op: "if this requestId already processed, return the prior result." A `Set` of in-flight keys, an atomic "insert if absent," a CAS on a status flag.
- **Make the in-flight state single.** Collapse concurrent identical requests into one shared promise (request coalescing / single-flight) so ten callers asking for the same thing trigger one operation, not ten.
- **Cancellation must clean up.** Plumb an `AbortSignal` / cancellation token through. On cancel, release locks, close handles, roll back partial writes — in a `finally`, so it runs whether the task completed, threw, or was cancelled.
- **Timeouts are cancellation.** A timeout that abandons a task without cancelling its underlying work leaks the work (and any resources it holds). Wire the timeout to the same cancellation path.

**Example:**
```ts
// Bad — double-click fires charge twice; timeout abandons the call but it keeps running
async function pay(orderId: string) {
  await chargeCard(orderId)            // no dedup; second click double-charges
}

// Good — single-flight + idempotency + cancellable cleanup
const inflight = new Map<string, Promise<Receipt>>()
async function pay(orderId: string, signal: AbortSignal) {
  if (inflight.has(orderId)) return inflight.get(orderId)!   // coalesce concurrent retries
  const p = (async () => {
    const lock = await acquire(orderId)
    try {
      if (await alreadyCharged(orderId)) return loadReceipt(orderId)  // idempotent
      return await chargeCard(orderId, { signal })                    // honors cancellation
    } finally { lock.release() }      // cleanup on success, throw, OR cancel
  })()
  inflight.set(orderId, p)
  try { return await p } finally { inflight.delete(orderId) }
}
```

---

### 6. Bound your concurrency

**Rule:** Unbounded fan-out is a self-inflicted denial of service. `Promise.all` over 50,000 items opens 50,000 sockets, 50,000 DB connections, 50,000 file handles — and falls over. Cap in-flight work with a semaphore, a worker pool, or a queue with backpressure.

**Why:** "Run them all at once" works in the demo with ten items and melts with ten thousand: connection pool exhausted, memory blown, downstream service rate-limited or knocked over, the event loop starved. Concurrency is a resource you spend, and resources are finite — pools, sockets, RAM, file descriptors. The cap is what keeps throughput high and the system standing instead of thrashing.

**How to apply:**
- **Semaphore / concurrency limit** — allow at most N tasks in the critical resource at once; the N+1th waits. `p-limit`, a counting semaphore, a `Semaphore(N)`. Pick N from the real bottleneck (DB pool size, downstream rate limit), not a guess.
- **Worker pool** — a fixed set of workers pull from a shared queue. Bounded workers, bounded memory, natural load-leveling.
- **Backpressure** — when producers outrun consumers, *slow the producer* (bounded queue that blocks/rejects on full), don't buffer unboundedly until you OOM. A full queue is a signal, not a problem to paper over.
- **Match N to the limiter.** More concurrency than the downstream can absorb just converts to queueing and timeouts. The right N is usually small.

**Example:**
```ts
// Bad — unbounded fan-out: 10k concurrent DB writes exhaust the pool, everything times out
await Promise.all(records.map((r) => db.insert(r)))

// Good — cap concurrency at the pool size; at most 10 writes in flight
import pLimit from "p-limit"
const limit = pLimit(10)                       // size to the actual DB pool, not a guess
await Promise.all(records.map((r) => limit(() => db.insert(r))))

// Or a worker pool draining a bounded queue, with backpressure when full
const queue = new BoundedQueue(records, { capacity: 1000 })  // producer blocks when full
await Promise.all(Array.from({ length: 10 }, () => worker(queue)))
```

---

### 7. Test the races you can — but design so correctness doesn't depend on timing

**Rule:** Write deterministic tests around the critical section, add stress/fuzz tests where you can, and run a race detector if your toolchain has one. But the real safety comes from a design whose correctness does **not** depend on a particular interleaving — because no test can prove the absence of a race.

**Why:** A race that fires one time in ten million won't fail in CI, and the act of observing it (a log line, a debugger, a `sleep`) changes the timing and hides it. Tests catch the races you can force; they can't certify that no bad interleaving exists. So tests are the second line of defense — the first is principles 1–3, which remove the possibility instead of probing for it.

**How to apply:**
- **Make critical sections deterministically testable.** Inject the scheduler/clock, expose seams to release two tasks at a known point, assert the post-condition. Test the lock does what you think.
- **Force the interleaving.** Use barriers/latches to start N tasks at exactly the same moment and hammer the shared resource; assert the invariant (e.g., final count equals N) holds over many runs.
- **Use the tools.** Go's `-race`, ThreadSanitizer (C/C++/Rust), Java's `jcstress`, linters for floating promises (`no-floating-promises`). They catch real races cheaply.
- **Prefer designs that don't need the test.** Immutability, confinement, a single owner, an atomic op — these are *provably* race-free, so the test only confirms what the design guarantees. If correctness hinges on "the lock is probably fast enough," redesign.

**Example:**
```ts
// Stress test — force the interleaving the unit test never would
it("increments are not lost under contention", async () => {
  const counter = new AtomicCounter()
  const start = new Barrier(100)                       // release all 100 at once
  await Promise.all(Array.from({ length: 100 }, async () => {
    await start.wait()
    for (let i = 0; i < 1000; i++) counter.inc()
  }))
  expect(counter.value).toBe(100_000)                  // fails immediately if inc() races
})
```

---

## Pre-flight checklist

Before writing code where two things run at once in one process, run through these in your head:

1. **Sharing:** does this state actually need to be both shared and mutable? Can I make it immutable, confine it to one owner, or pass it by message instead?
2. **Atomicity:** for any state that *is* shared, where is the critical section? Is every read-modify-write protected (lock, atomic, CAS, version)? Am I assuming `i++` is atomic when it isn't?
3. **Deadlock:** does any path take more than one lock? If so, does every path take them in the same global order? Is the lock scope minimal, with no `await` on un-owned I/O inside it, and a timeout on acquire?
4. **Async:** is every promise awaited or its rejection deliberately handled? Did I choose concurrent vs sequential on purpose? Is anything CPU-heavy blocking the event loop?
5. **Idempotency & cancellation:** if this fires twice (double-click, retry, timeout race), is the effect the same as once? On cancel/timeout, does cleanup release every lock, handle, and partial write?
6. **Bounding:** is the fan-out capped to the real bottleneck (pool size, rate limit) with a semaphore, pool, or backpressuring queue — not an unbounded `Promise.all`?
7. **Testing vs design:** can I force the worst interleaving in a stress test, and — more importantly — is correctness independent of timing rather than relying on the race "probably" not happening?

If any answer is "I don't know," stop and find out before writing.

## When to skip this skill

- Single-threaded request/response handlers with no shared mutable state — each request reads inputs, computes, returns, touches nothing another request touches.
- Pure functions and pure transforms — no shared state, no I/O, nothing to race.
- Throwaway scripts and prototypes that run once, sequentially, and get deleted.
- Read-only access to immutable/config data shared across tasks — concurrent reads of data that never changes need no coordination.

For anything else — threads, async tasks touching shared state, locks, parallel fan-out, event loops with interleaving `await`s, worker pools, anything where two operations can be in flight against the same memory at once — these fundamentals apply. When the contention is across processes over a broker, defer to [[queue-fundamentals]]; when it's across database transactions, defer to [[database-fundamentals]].

## How to use this skill in a conversation

This skill is always-on for in-process concurrency work (per the project rule at `.claude/rules/concurrency-fundamentals.md`). Don't ask the user to opt in. If the task matches "When to skip", say so in one sentence and proceed.

When the skill applies:
- **Designing concurrent code** — start by trying to design the sharing away (principle 1). State the chosen model — immutable, confined, message-passing, or locked — and *why*, before writing it.
- **Adding a lock** — name the critical section and the invariant it protects, the lock granularity, and the lock-ordering rule if more than one lock exists. Don't sprinkle locks reactively.
- **Writing async code** — be explicit about which calls run concurrently vs sequentially, that every promise is awaited or handled, and that fan-out is bounded.
- **Debugging a race or deadlock** — this is also [[debug-fundamentals]] territory: reproduce (or force the interleaving) before changing code, fix the design layer where the sharing lives, not the symptom.

Mind the scope boundary. This skill is **in-process** concurrency. The moment the concurrency crosses a process boundary over a message broker, event stream, or background-job queue, that's [[queue-fundamentals]] — redelivery, poison messages, idempotent consumers, exactly-once. The moment the contended state is database rows, that's [[database-fundamentals]] — isolation levels, `SELECT FOR UPDATE`, optimistic version columns. Cross-reference them; don't restate them here.

When you make a non-obvious call (choosing a lock over an atomic, optimistic over pessimistic, a particular concurrency cap, single-flight coalescing), say *why* in one sentence. Cite the specific failure mode you're preventing — don't just emit synchronization primitives silently.

## Reference files

Deeper guidance for the principles above. Read the one that matches the work in front of you; you don't need to read it upfront.

- `references/shared-state-and-async.md` — the shared-state escape hatches (immutability, confinement, message-passing) with examples; the lock vs atomic vs CAS vs optimistic-version decision rules; deadlock-avoidance recipes; async/await pitfalls (error swallowing, blocking the loop, `Promise.all` vs sequential, cancellation); and bounded-concurrency patterns (semaphore, worker pool, backpressure) with code.
