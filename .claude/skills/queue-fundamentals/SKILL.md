---
name: queue-fundamentals
description: "Use when work crosses processes through a broker, stream, job queue, or worker: delivery semantics, idempotency, retries, ordering, backpressure. Skip in-process async (concurrency-fundamentals)."
---

# Queue fundamentals

Assume at-least-once delivery and no global order unless the broker contract
proves otherwise; verify effect-plus-ack across crash and replay.

## Steps

1. Name the purpose before the technology: task queue, buffer, pub/sub,
   replayable log, or DB-backed job table.
2. State delivery semantics and the loss/duplication window. Never claim
   end-to-end exactly-once across independent systems.
3. Make every consumer idempotent — natural operation, conditional
   write/version, or durable deduplication key — and acknowledge only after the
   effect is durable, with a visibility/lease timeout longer than the work.
4. Classify transient versus permanent failure: cap attempts, back off with
   jitter, route poison messages to a DLQ, name who replays them.
5. Partition by the smallest ordering key that matters, or make processing
   commutative/version-aware. Never dual-write database and broker; use a
   transactional outbox or CDC.
6. Bound producers and consumers, expose lag/age/saturation, and apply
   backpressure before overload becomes unbounded storage.

Broker retry limits do not cap product repair. Use `database-fundamentals` for
outbox/dedup schema, `api-design-fundamentals` for message contracts, and
`observability-fundamentals` when failure visibility changes.

## Harness

Capture purpose, schema owner/version, delivery semantics, idempotency key, ack
point, retry/DLQ/replay policy, ordering key, capacity limit, and SLI in the active
OpenSpec design; the harness runs the evidence. No separate checklist; Build never stages or commits.

## References

- `references/broker-selection.md` — queue shapes, delivery semantics, ordering
- `references/idempotency.md` — the three idempotency layers and rerun questions
- `references/operating.md` — ack, visibility timeout, retries, DLQ, backpressure, signals
- `references/outbox.md` — transactional outbox versus CDC
