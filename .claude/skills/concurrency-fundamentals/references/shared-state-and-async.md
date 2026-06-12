# Shared state, locking, and async

This is the deep guide for the in-process concurrency principles. It covers, in order: the escape hatches that let you *avoid* shared mutable state; the decision rules for when you can't (lock vs atomic vs CAS vs optimistic version); deadlock-avoidance recipes; the async/await pitfalls that bite even single-threaded runtimes; and the bounded-concurrency patterns that keep fan-out from melting your pools. Examples are TypeScript or pseudo-threaded — translate the primitive to your stack.

Scope reminder: this is **in-process** concurrency. Contention across processes over a broker is [[queue-fundamentals]]; contention across database transactions is [[database-fundamentals]]. The ideas rhyme (atomicity, lost updates, optimistic versions, idempotency) — apply the one that owns the boundary you're actually crossing.

---

## 1. Escape hatches: avoid the sharing entirely

The fastest race fix is to make the race unrepresentable. Reach for these *before* a lock.

### Immutability

If a value never mutates after construction, unlimited readers can share it with zero coordination. There is no read-modify-write to interleave because there is no write.

```ts
// Do this: build a new value, never mutate the shared one
function applyDiscount(cart: ReadonlyCart, pct: number): ReadonlyCart {
  return { ...cart, total: cart.total * (1 - pct) }   // new object; original untouched
}

// Not this: mutating a shared object that other tasks may be reading
function applyDiscount(cart: Cart, pct: number): void {
  cart.total *= (1 - pct)        // any concurrent reader sees a half-applied state
}
```

`Object.freeze`, `readonly`, persistent/immutable collections, and "compute a new snapshot" all serve here. The cost is allocation; usually cheap relative to a bug you can't reproduce.

### Confinement (single owner)

Give each piece of mutable state exactly one owner. Everyone else sends the owner a request; nobody else holds a reference that can mutate it. This is the actor model and Go's "share by communicating."

```ts
// A single-owner counter: only the owner task mutates `n`; others post messages
class CounterActor {
  private n = 0
  private queue = new AsyncQueue<{ op: "inc" | "get"; reply: (v: number) => void }>()
  constructor() { this.loop() }
  private async loop() {
    for await (const msg of this.queue) {       // serial: one message at a time
      if (msg.op === "inc") this.n++            // no lock needed — single owner
      msg.reply(this.n)
    }
  }
  inc() { return new Promise<number>((r) => this.queue.push({ op: "inc", reply: r })) }
}
```

The queue *is* the synchronization. The owner processes one message at a time, so its internal mutation never races.

### Message-passing / hand-off

Instead of two tasks sharing a buffer behind a lock, pass ownership through a channel so only one holds it at a time. JS Web Workers (`postMessage` transfers an `ArrayBuffer`), Go channels, Rust's `mpsc`. The transfer point is the only synchronization, and it's explicit.

### Thread-local / task-local

Per-worker scratch state that nothing else can see needs no protection. A buffer allocated inside a task, a request-scoped context — keep it local and the question of races never arises.

**Decision:** can I make it immutable? → do that. Else, can one owner hold it? → confine it. Else, can I hand it off by message? → do that. Only if none of those fit do you reach for a lock.

---

## 2. When you must share: lock vs atomic vs CAS vs optimistic version

You've decided the state is genuinely shared and mutable. Now protect the **critical section** — the smallest span that must run without another task observing or changing the value mid-flight.

`count++` is three machine steps (load, add, store). Two threads interleaving them lose an increment. This is the in-process lost update — the same bug as [[database-fundamentals]]'s lost update, one layer up.

### The decision rules

| Situation | Use | Why |
|-----------|-----|-----|
| Single counter / flag, preemptive threads | **Atomic** (`AtomicInteger`, `Interlocked`, `std::atomic`) | No blocking, no deadlock, hardware-level indivisible |
| Multi-step invariant over several fields | **Lock / mutex** | Atomics only cover one word; a lock spans the whole critical section |
| Lock-free single-value update under contention | **CAS loop** | Read, compute, swap-if-unchanged, retry; no blocking |
| Coarse state, low contention, "detect & retry" is fine | **Optimistic version** | Cheap on the happy path; pay only when a conflict actually happens |
| Read-mostly, rare writes | **RWLock / copy-on-write** | Many concurrent readers, exclusive writer |

### Lock — the workhorse

```ts
import { Mutex } from "async-mutex"
const mutex = new Mutex()
async function deposit(amt: number) {
  await mutex.runExclusive(() => {        // critical section: one task at a time
    balance = balance + amt               // read-modify-write is now indivisible
  })
}
```

Rules: hold the lock for the *smallest* span that preserves the invariant; never `await` un-owned I/O while holding it (principle 3); prefer a lock *per key/shard* over one global lock so independent work stays parallel.

### Atomic — for a single value

```ts
// Pseudo-threaded: an atomic increment can't lose updates the way ++ can
counter.incrementAndGet()                 // indivisible; no lock, no deadlock
```

### CAS loop — lock-free update

```ts
// Compare-and-swap: only write if nobody changed it since we read
function addLockFree(delta: number) {
  for (;;) {
    const cur = atomic.get()
    const next = cur + delta
    if (atomic.compareAndSet(cur, next)) return   // succeeded — nobody raced us
    // else: someone wrote between our read and swap — loop and retry
  }
}
```

### Optimistic version — detect-and-retry on coarse state

Same shape as DB optimistic locking, in memory: stamp the state with a version, only commit if the version is unchanged.

```ts
type Doc = { value: string; version: number }
async function update(store: Map<string, Doc>, key: string, fn: (s: string) => Promise<string>) {
  for (;;) {
    const cur = store.get(key)!
    const newValue = await fn(cur.value)               // the only interleave point is here
    if (store.get(key)!.version !== cur.version) continue   // someone wrote during the await — retry
    store.set(key, { value: newValue, version: cur.version + 1 })  // check + set with NO await
    return                                              // between them, so it's atomic in JS
  }
}
```

Optimistic wins when conflicts are *rare* (cheap happy path). Pessimistic locks win when conflicts are *common* (retrying repeatedly is worse than waiting once).

---

## 3. Deadlock-avoidance recipes

A deadlock is a cycle in the "who waits for whom" graph. Make the graph acyclic and deadlock is impossible.

### Recipe 1: consistent lock ordering (the big one)

If any code path acquires two locks, *every* path acquires them in the same global order. A total order on locks makes a cycle impossible.

```ts
// Order locks by a stable key (id) so A→B and B→A both lock low-id first
async function transfer(from: Account, to: Account, amt: number) {
  const [first, second] = from.id < to.id ? [from, to] : [to, from]
  await first.lock(); await second.lock()
  try { from.bal -= amt; to.bal += amt }
  finally { second.unlock(); first.unlock() }   // release in reverse
}
```

### Recipe 2: minimize lock scope

Compute *outside* the lock; mutate *inside* it; release immediately. The shorter the hold, the smaller the contention window.

```ts
// Bad: expensive work done while holding the lock blocks everyone
await mutex.runExclusive(async () => {
  const result = await expensiveComputation()   // others wait on this for no reason
  shared.value = result
})

// Good: compute first, lock only for the mutation
const result = await expensiveComputation()
await mutex.runExclusive(() => { shared.value = result })   // tiny critical section
```

### Recipe 3: avoid nested locks

Needing two locks at once is the *precondition* for deadlock. Often you can hold one at a time, or merge two fine-grained locks into one coarser lock. One lock can't deadlock against itself (unless you take it re-entrantly — use a re-entrant mutex or restructure).

### Recipe 4: never lock across un-owned I/O

Holding a lock while you `await` a network call, a DB query, or user input can wedge the system: the call is slow or hangs, and everyone waiting on that lock hangs with it.

```ts
// Bad: HTTP call inside the lock — every other task blocks on a remote latency
await mutex.runExclusive(async () => {
  const data = await fetch(url)        // lock held for the whole round-trip
  cache.set(key, data)
})

// Good: do I/O outside the lock; lock only the in-memory mutation
const data = await fetch(url)
await mutex.runExclusive(() => cache.set(key, data))
```

### Recipe 5: timeout every acquire

`tryLock(timeout)` instead of `lock()`. A timeout converts a silent permanent hang into a loud, recoverable error.

```ts
const acquired = await mutex.acquire({ timeout: 5_000 })
if (!acquired) throw new LockTimeout("could not acquire within 5s")  // fail loud, not hang
```

---

## 4. async/await pitfalls

Single-threaded does not mean race-free. At every `await`, another task can interleave. And async has its own footguns that look like ordinary linear code.

### Pitfall: the floating (un-awaited) promise

A promise you don't await runs detached. If it rejects, the error becomes an unhandled rejection and is *swallowed* — the calling code already moved on. Worse, downstream code runs before the work finishes.

```ts
// Bad: error vanishes; "done" logs before save completes (or fails)
function handler() {
  saveToDb(record)          // not awaited
  console.log("done")       // runs immediately, save may still be in flight or rejected
}

// Good: await it — the error propagates and ordering is guaranteed
async function handler() {
  await saveToDb(record)
  console.log("done")
}

// If you truly want fire-and-forget, say so AND handle the error explicitly
void saveToDb(record).catch((err) => log.error("background save failed", err))
```

Enforce it: ESLint `@typescript-eslint/no-floating-promises`.

### Pitfall: accidental serialization

`await` inside a loop runs the iterations one at a time. For independent work that's N sequential round-trips when it could be one concurrent batch.

```ts
// Bad: sequential — total latency is the SUM of all calls
const users = []
for (const id of ids) users.push(await fetchUser(id))

// Good: concurrent — total latency is the MAX of the calls (but bound it, §5)
const users = await Promise.all(ids.map(fetchUser))
```

### Pitfall: Promise.all vs allSettled

`Promise.all` rejects on the *first* failure and abandons the rest's results. If you need every outcome (even failures), use `allSettled`.

```ts
const results = await Promise.allSettled(ids.map(fetchUser))
const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value)
const failed = results.filter((r) => r.status === "rejected")
```

### Pitfall: blocking the event loop

A synchronous CPU-heavy loop or a sync API (`crypto.pbkdf2Sync`, `fs.readFileSync`, a big JSON parse) freezes *every* task and request on that thread. Offload or chunk.

```ts
// Bad: blocks the loop; every other request stalls until this finishes
const hash = crypto.pbkdf2Sync(pw, salt, 600_000, 32, "sha256")

// Good: async variant yields the loop; or move to a worker thread
const hash = await promisify(crypto.pbkdf2)(pw, salt, 600_000, 32, "sha256")
```

### Pitfall: logical race across an await

Even single-threaded, two tasks can interleave at `await` points and clobber shared state.

```ts
// Bad: both tasks read the same `seq`, both write seq+1 — one increment lost
let seq = 0
async function next() {
  const cur = seq            // task A and task B both read 0
  await tick()               // interleave point
  seq = cur + 1              // both write 1 — lost update
  return seq
}
// Fix: don't share (return per-task values), or serialize with a mutex (§2)
```

### Cancellation: AbortSignal and cleanup

A timeout or user cancel must actually *stop* the work and release its resources, not just stop waiting for it.

```ts
async function fetchWithTimeout(url: string, ms: number) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)    // cancel the underlying work
  try {
    return await fetch(url, { signal: ctrl.signal })  // honors abort
  } finally {
    clearTimeout(timer)                                // cleanup runs on success, throw, OR abort
  }
}
```

Plumb the signal *through* every layer; a timeout that abandons a request without aborting it leaks the connection (and anything it holds). Put resource release in `finally` so it runs on completion, throw, and cancellation alike.

---

## 5. Bounded concurrency patterns

Unbounded fan-out is a self-inflicted DoS: `Promise.all` over 50k items opens 50k sockets/connections/handles at once. Cap in-flight work to the real bottleneck.

### Semaphore / concurrency limit

Allow at most N tasks into the constrained resource; the rest wait.

```ts
import pLimit from "p-limit"
const limit = pLimit(10)          // size to the DB pool / downstream rate limit, not a guess
const results = await Promise.all(
  items.map((it) => limit(() => processWithDb(it)))   // at most 10 concurrent
)
```

Roll-your-own counting semaphore (the shape, if you have no library):

```ts
class Semaphore {
  private avail: number
  private waiters: Array<() => void> = []
  constructor(n: number) { this.avail = n }
  async acquire() {
    if (this.avail > 0) { this.avail--; return }
    await new Promise<void>((r) => this.waiters.push(r))   // block until a slot frees
  }
  release() {
    const w = this.waiters.shift()
    if (w) w(); else this.avail++
  }
}
```

### Worker pool draining a queue

A fixed set of workers pull from a shared queue. Bounded workers → bounded memory and connections, with natural load-leveling.

```ts
async function runPool<T>(items: T[], workers: number, job: (t: T) => Promise<void>) {
  const queue = [...items]
  const work = async () => { let t; while ((t = queue.shift()) !== undefined) await job(t) }
  await Promise.all(Array.from({ length: workers }, work))   // exactly `workers` in flight
}
await runPool(records, 10, (r) => db.insert(r))
```

### Backpressure

When producers outrun consumers, *slow the producer* — don't buffer unboundedly until you OOM. A bounded queue blocks (or rejects) the producer when full; that pushback is the signal.

```ts
class BoundedQueue<T> {
  private buf: T[] = []
  constructor(private capacity: number) {}
  async push(item: T) {
    while (this.buf.length >= this.capacity) await this.spaceAvailable()  // producer waits
    this.buf.push(item)
  }
  // consumers pop and signal spaceAvailable(); a full queue throttles the producer
}
```

Node streams give you this for free via the `highWaterMark` and `pipe` honoring backpressure — prefer the platform mechanism when one exists.

### Choosing N

N is the *real* bottleneck, not a vibe: the DB connection-pool size, the downstream service's rate limit, the number of CPU cores for CPU-bound work. More concurrency than the limiter can absorb just converts into queueing and timeouts — it doesn't speed anything up. The right N is usually small (single or low double digits).

---

## Quick reference

- **First move:** make it immutable, confined, or message-passed — no lock needed.
- **Must share:** atomic for one value; lock for a multi-field invariant; CAS for lock-free single value; optimistic version for rare-conflict coarse state.
- **Locks:** smallest scope, consistent global order, no nested locks, no un-owned I/O inside, timeout on acquire.
- **Async:** await or explicitly `.catch` every promise; choose concurrent vs sequential on purpose; never block the event loop; cancellation cleans up in `finally`.
- **Fan-out:** always bounded — semaphore, worker pool, or backpressuring queue, sized to the real bottleneck.
- **Boundary check:** broker → [[queue-fundamentals]]; DB rows → [[database-fundamentals]]; in-process memory → here.
