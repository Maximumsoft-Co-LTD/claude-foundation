# Shared state, locking, and async

## Contents

- [Principle 5 (from SKILL.md): Make operations idempotent and cancellable](#principle-5-from-skillmd-make-operations-idempotent-and-cancellable)
- [1. Escape hatches: avoid the sharing entirely](#1-escape-hatches-avoid-the-sharing-entirely)
- [2. When you must share: lock vs atomic vs CAS vs optimistic version](#2-when-you-must-share-lock-vs-atomic-vs-cas-vs-optimistic-version)
- [3. Deadlock-avoidance recipes](#3-deadlock-avoidance-recipes)
- [4. async/await pitfalls](#4-asyncawait-pitfalls)
- [5. Bounded concurrency patterns](#5-bounded-concurrency-patterns)
- [6. Testing races](#6-testing-races)
- [Quick reference](#quick-reference)

Recipes for the SKILL.md steps. Steps 1–4 and 6 (do not share; make access
atomic; prevent deadlock by design; async/await is concurrency too; bound
concurrency) are expanded in sections 1–5 below. Step 5 keeps its full rule
here because repair tooling depends on its exact wording.

## Principle 5 (from SKILL.md): Make operations idempotent and cancellable

**Rule:** Concurrent systems retry and double-fire — a user double-clicks, a timeout fires while the work is still running, a supervisor restarts a task. Design operations so doing them twice equals doing them once, and so a cancellation or timeout cleanly unwinds whatever was half-started.

**Why:** Under concurrency an operation can fire more than once — retries, timeout races, re-entrant handlers. A non-idempotent charge double-charges; a cancelled task leaking a lock or partial write poisons the next attempt. (In-process cousin of `queue-fundamentals` at-least-once delivery.)

**How to apply:**
- **Idempotency key / dedup** — guard the effectful step with a key so a repeat is a no-op: "if this requestId already processed, return the prior result." A `Set` of in-flight keys, an atomic "insert if absent," a CAS on a status flag.
- **Make the in-flight state single.** Collapse concurrent identical requests into one shared promise (request coalescing / single-flight) so ten callers asking for the same thing trigger one operation, not ten.
- **Cancellation must clean up.** Plumb an `AbortSignal` / cancellation token through. On cancel, release locks, close handles, roll back partial writes — in a `finally`, so it runs whether the task completed, threw, or was cancelled.
- **Timeouts are cancellation.** A timeout that abandons a task without cancelling its underlying work leaks the work (and any resources it holds). Wire the timeout to the same cancellation path.
- **Answer the three rerun questions** for every state-mutating step: *What if it runs twice? What if the previous run crashed halfway? What if two runs overlap?* "It depends on what was left behind" means the step needs reconciliation.
- **Derive each step from current state.** Read what exists, compare it with the goal, and apply only the difference; a repeat then finds nothing to do. Do not replay what the previous run intended.
- **Write to a temp file, then rename.** Build output at a temporary path in the same directory and rename it into place, so a reader sees the old file or the complete new one, never a torn write.
- **Judge staleness by evidence valid at every crash point.** A leftover lock, temp file, partial record, or claimed job must be recognizable as stale wherever the prior run stopped (owner liveness, content digest, completed marker), not by timestamp order or the common-case path.

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

## 1. Escape hatches: avoid the sharing entirely

Locking bugs exist only because two things touch the same mutable cell.
Remove the sharing or the mutation and the race category disappears.

- **Immutability:** a value that never changes after construction can be read
  by any number of tasks with no coordination. Build new values
  (`{ ...cart, total }`) instead of mutating shared ones; `Object.freeze`,
  `readonly`, persistent collections, snapshots.
- **Confinement:** one owner per piece of mutable state; everyone else sends
  it a message. The queue is the synchronization.
- **Share by communicating:** pass ownership through a channel (Go channels,
  Rust `mpsc`, Web Worker `postMessage` transfers) so only one task holds the
  data at a time.
- **Task-local scratch state** needs no protection at all.

```ts
// Bad — read-modify-write straddles an await; two tasks read the same old total
let total = 0
await Promise.all(items.map(async (it) => { total += await score(it) }))

// Good — each task owns its result; fold single-threaded afterwards
const scores = await Promise.all(items.map((it) => score(it)))
const total = scores.reduce((a, b) => a + b, 0)
```

```ts
class CounterActor {                       // single owner: no lock needed
  private n = 0
  private queue = new AsyncQueue<{ op: "inc"; reply: (v: number) => void }>()
  constructor() { this.loop() }
  private async loop() { for await (const msg of this.queue) { this.n++; msg.reply(this.n) } }
  inc() { return new Promise<number>((r) => this.queue.push({ op: "inc", reply: r })) }
}
```

Decision: immutable? do that. One owner? confine it. Hand off by message?
do that. Only then reach for a lock.

---

## 2. When you must share: lock vs atomic vs CAS vs optimistic version

Protect the critical section, the smallest span that must run without
interleaving. `count++` is load, add, store; two threads lose an increment.
This is the in-memory twin of the database lost update.

| Situation | Use | Why |
|---|---|---|
| Single counter or flag, preemptive threads | atomic (`AtomicInteger`, `Interlocked`, `std::atomic`) | no blocking, no deadlock |
| Multi-step invariant over several fields | lock / mutex | atomics cover one word; a lock spans the section |
| Lock-free single-value update under contention | CAS loop | read, compute, swap-if-unchanged, retry |
| Coarse state, rare conflicts | optimistic version | cheap on the happy path; retry on conflict |
| Read-mostly, rare writes | RWLock / copy-on-write | many readers, one writer |

```ts
const locks = new KeyedMutex()
async function reserve(seatId: string) {
  return locks.runExclusive(seatId, async () => {   // one task per seatId
    const seat = cache.get(seatId)
    if (seat.taken) throw new AlreadyReserved(seatId)
    await persist({ ...seat, taken: true })
    cache.set(seatId, { taken: true })
  })
}

function addLockFree(delta: number) {               // CAS loop
  for (;;) {
    const cur = atomic.get()
    if (atomic.compareAndSet(cur, cur + delta)) return
  }
}

async function update(store: Map<string, Doc>, key: string, fn: (s: string) => Promise<string>) {
  for (;;) {                                        // optimistic version
    const cur = store.get(key)!
    const newValue = await fn(cur.value)            // the only interleave point
    if (store.get(key)!.version !== cur.version) continue
    store.set(key, { value: newValue, version: cur.version + 1 })  // check + set with no await
    return
  }
}
```

Rules: hold a lock for the smallest span; never `await` un-owned I/O while
holding it; prefer a lock per key or shard over one global lock. Cooperative
runtimes (JS event loop, asyncio) make a section with no `await` atomic;
preemptive parallel runtimes (OS threads, Go goroutines) race even on `i++`.

---

## 3. Deadlock-avoidance recipes

A deadlock is a cycle of waiting; break it structurally.

1. **Consistent lock ordering** — every path that needs two locks takes them
   in the same global order; a total order makes a cycle impossible.
2. **Minimize scope** — compute outside the lock, mutate inside, release at
   once.
3. **Avoid nested locks** — hold one at a time or merge into one coarser lock.
4. **Never lock across un-owned I/O** — load, release, call out, reacquire.
5. **Timeout every acquire** — `tryLock(timeout)` turns a silent hang into a
   loud, recoverable error.

```ts
async function transfer(from: Account, to: Account, amt: number) {
  const [first, second] = from.id < to.id ? [from, to] : [to, from]   // recipe 1
  await first.lock(); await second.lock()
  try { from.bal -= amt; to.bal += amt }
  finally { second.unlock(); first.unlock() }
}

const data = await fetch(url)                                 // recipe 4: I/O outside
await mutex.runExclusive(() => cache.set(key, data))          // lock only the mutation

const acquired = await mutex.acquire({ timeout: 5_000 })      // recipe 5
if (!acquired) throw new LockTimeout("could not acquire within 5s")
```

---

## 4. async/await pitfalls

"Single-threaded" is not race-free: logical races happen at every `await`.

- **Floating promise:** an un-awaited promise swallows its rejection and lets
  downstream code run first. Await it, or `void p.catch(log)` when
  fire-and-forget is deliberate. Enforce with
  `@typescript-eslint/no-floating-promises`.
- **Accidental serialization:** `await` inside a loop is N sequential
  round-trips; `Promise.all(ids.map(fetchUser))` runs them concurrently (then
  bound it, section 5). Use `allSettled` when every outcome matters.
- **Blocking the event loop:** a sync CPU loop or sync API
  (`pbkdf2Sync`, `readFileSync`, a huge `JSON.parse`) stalls every request on
  the thread; use the async variant, chunk, or a worker thread.
- **Logical race across an await:** `const cur = seq; await tick(); seq = cur
  + 1` loses an update; do not share, or serialize with a mutex.
- **Cancellation:** a timeout must abort the underlying work and release its
  resources, with cleanup in `finally`.

```ts
async function fetchWithTimeout(url: string, ms: number) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(url, { signal: ctrl.signal }) }
  finally { clearTimeout(timer) }
}
```

---

## 5. Bounded concurrency patterns

Unbounded fan-out is self-inflicted denial of service: `Promise.all` over
50,000 items opens 50,000 connections. Size N to the real limiter (DB pool,
downstream rate limit, cores); the right N is usually small.

```ts
import pLimit from "p-limit"
const limit = pLimit(10)                                          // semaphore
await Promise.all(records.map((r) => limit(() => db.insert(r))))

async function runPool<T>(items: T[], workers: number, job: (t: T) => Promise<void>) {
  const queue = [...items]                                         // worker pool
  const work = async () => { let t; while ((t = queue.shift()) !== undefined) await job(t) }
  await Promise.all(Array.from({ length: workers }, work))
}

class BoundedQueue<T> {                                            // backpressure
  private buf: T[] = []
  constructor(private capacity: number) {}
  async push(item: T) {
    while (this.buf.length >= this.capacity) await this.spaceAvailable()  // producer waits
    this.buf.push(item)
  }
}
```

A full queue is a signal to slow the producer, not a buffer to grow until
OOM. Prefer platform mechanisms (Node streams `highWaterMark`) when present.

---

## 6. Testing races

No test proves the absence of a race; a one-in-ten-million interleaving
will not fail in CI. Prefer designs that are race-free by construction
(immutability, confinement, atomics), then: inject the scheduler and clock so
critical sections are deterministically testable; force interleavings with
barriers and assert the invariant over many runs; run the tools (Go `-race`,
ThreadSanitizer, `jcstress`, floating-promise lint).

```ts
it("increments are not lost under contention", async () => {
  const counter = new AtomicCounter()
  const start = new Barrier(100)
  await Promise.all(Array.from({ length: 100 }, async () => {
    await start.wait()
    for (let i = 0; i < 1000; i++) counter.inc()
  }))
  expect(counter.value).toBe(100_000)
})
```

---

## Quick reference

- **First move:** immutable, confined, or message-passed; no lock needed.
- **Must share:** atomic for one value; lock for a multi-field invariant; CAS
  for lock-free single value; optimistic version for rare-conflict state.
- **Locks:** smallest scope, consistent global order, no nesting, no un-owned
  I/O inside, timeout on acquire.
- **Async:** await or explicitly `.catch` every promise; choose concurrent vs
  sequential on purpose; never block the event loop; cancel cleans up in
  `finally`.
- **Fan-out:** always bounded, sized to the real bottleneck.
- **Boundary:** broker → `queue-fundamentals`; DB rows →
  `database-fundamentals`; in-process memory → here.
