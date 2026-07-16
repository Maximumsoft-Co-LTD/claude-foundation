---
name: concurrency-fundamentals
description: Apply concurrency fundamentals — don't share mutable state, make shared access atomic, prevent deadlock by design, treat async/await as concurrency, make operations idempotent and cancellable, bound your concurrency. Use BEFORE writing code where things run at once in one process — threads, async/await, shared mutable state, locks, parallel tasks, event loops, callbacks that can race, worker pools — even when no principle is named. Skip single-threaded request/response with no shared mutable state, pure functions, and throwaway scripts.
---

# Concurrency Fundamentals

Scope: **in-process** concurrency — threads, async tasks, shared memory, event loops. The concurrency / queue / database seam is defined in the always-on router (`.claude/rules/fundamentals.md` → "Seams that blur").

## The 7 principles

Full rule/why/how-to-apply/example for each lives in the linked reference file.

| # | Principle | Compressed rule | Reference |
|---|---|---|---|
| 1 | Don't share mutable state | Before reaching for a lock, ask whether the state needs to be shared and mutable at all — immutability, single-owner confinement, or message-passing removes the race category entirely. | `references/shared-state-and-async.md` |
| 2 | When you must share, make access atomic | Identify the critical section and protect the read-modify-write with a lock, atomic primitive, CAS, or optimistic version. `i++` is never atomic by default. | `references/shared-state-and-async.md` |
| 3 | Prevent deadlock by design | A deadlock is a cycle of waiting. Break it structurally: consistent lock ordering, minimal scope, no nested locks, never lock across un-owned I/O, timeout every acquire. | `references/shared-state-and-async.md` |
| 4 | async/await is concurrency too | `async`/`await` has its own races: a floating promise swallows errors, accidental serialization, blocking the event loop. Know cooperative vs preemptive scheduling. | `references/shared-state-and-async.md` |
| 5 | Make operations idempotent and cancellable | Retries and double-fires are normal under concurrency — design so doing a thing twice equals doing it once, and cancellation/timeout cleanly unwinds partial work. | `references/shared-state-and-async.md` |
| 6 | Bound your concurrency | Unbounded fan-out is a self-inflicted denial of service. Cap in-flight work with a semaphore, worker pool, or backpressuring queue sized to the real bottleneck. | `references/shared-state-and-async.md` |
| 7 | Test the races you can — but design so correctness doesn't depend on timing | Deterministic and stress tests plus a race detector catch forceable races; the real safety is a design whose correctness doesn't depend on interleaving. | `references/shared-state-and-async.md` |

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

- Single-threaded handlers with no shared mutable state.
- Pure functions and pure transforms.
- Throwaway scripts that run once, sequentially.
- Read-only access to immutable/config data.

For the in-process / broker / database seam, see the router (`.claude/rules/fundamentals.md` → "Seams that blur").

## Reference files

- `references/shared-state-and-async.md` — principles 1-7's full rule/why/how-to-apply/example, plus the deeper recipes: escape hatches (immutability, confinement, message-passing); lock vs atomic vs CAS vs optimistic-version decision rules; deadlock recipes; async/await pitfalls; bounded-concurrency patterns (semaphore, worker pool, backpressure); a quick-reference summary.
