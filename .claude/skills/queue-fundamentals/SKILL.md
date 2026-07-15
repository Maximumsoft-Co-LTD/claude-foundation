---
name: queue-fundamentals
description: Apply queue fundamentals — broker selection, delivery semantics, idempotent consumers, ack discipline, retries/DLQ, ordering, and the outbox pattern for DB + broker writes. Use BEFORE introducing, modifying, or debugging any queue, message broker, event stream, background job, async worker, or pub/sub topic, with any broker (Kafka, SQS, RabbitMQ, BullMQ, Redis Streams, Celery). The trigger is any queue-shaped or async-processing problem, even when no broker is named. Skip pure in-process data structures with no concurrency, persistence, or cross-process concerns.
---

# Queue Fundamentals

## Why this exists

Every async boundary in a distributed system is a queue. Almost every "ghost in the machine" production bug traces to the same handful of missed fundamentals: silent message loss, duplicate processing that double-charged a customer, an ordering assumption that broke under load, no DLQ so a single bad payload wedged the pipeline, a DB write that committed while the matching event never published. This skill is a **pre-flight** for anything queue-shaped — broker-agnostic, applies equally to SQS, Kafka, RabbitMQ, BullMQ, or a Postgres job table. The mechanics differ; the contract does not.

Run order and the concurrency/queue/database seam are owned by `.claude/rules/fundamentals.md` (the router) — this skill operates the queue once `architecture-fundamentals` has decided to use one, over code that `programming-fundamentals` governs. Domain hand-offs unique to this skill: outbox/dedup/DB-backed job tables are `database-fundamentals` schema work (indexes, constraints, transactions); producers and consumers are `hexagonal-backend` adapters and this skill expands its outbox note; `ddd-strategic` draws the internal-domain-event vs cross-context integration-event line (the versioned contract the broker carries).

## When to skip this skill

- In-process channels, worker pools, and async tasks inside one process are `concurrency-fundamentals`; a bare `List`/`Deque`/`Queue`/`chan` used as a plain data structure with no concurrency is `programming-fundamentals` (the router's "Seams that blur" owns this split). This skill starts where the work crosses a **process boundary**.
- Throwaway scripts or one-shot data fixes where loss is acceptable and there's no production system on the other end.
- Synchronous request/response paths that don't involve a queue at all.

For everything else — any async boundary, any background job, any event publication, any message broker — these fundamentals apply, even on the "small" feature, even on the "internal" event.

## The 7 principles

Full rule/why/how-to-apply/example for each principle now lives in its reference file — read the one that matches the work in front of you.

| # | Principle | Rule | Reference |
|---|---|---|---|
| 1 | Pick the right queue for the purpose | Decide what the queue is *for* (buffer / task queue / pub-sub / log / DB-backed job table) before picking a broker — the wrong shape turns a feature into an operational nightmare. | `references/broker-selection.md` |
| 2 | Know your delivery semantics | Pick one of {at-most-once, at-least-once, exactly-once} consciously. Default assumption: at-least-once. "Exactly-once" only holds within one broker's transactional boundary, never across systems. | `references/broker-selection.md` |
| 3 | Make consumers idempotent | Every handler must produce the same observable effect whether run once, twice, or N times with the same message — natural, conditional, or keyed. | `references/idempotency.md` |
| 4 | Ack only after the work is durably done | Ack after the effect commits, never before. Set the visibility timeout longer than p99 work time, or heartbeat/extend it from inside the handler. | `references/operating.md` |
| 5 | Plan for poison messages | Configure max attempts, exponential backoff + jitter, and a DLQ before the first message flows; short-circuit permanent errors straight to the DLQ. | `references/operating.md` |
| 6 | Ordering is opt-in, not a default | Most brokers don't preserve global order. Route by partition/message-group key for per-entity order, or make the handler version-aware/commutative. | `references/broker-selection.md` |
| 7 | Don't dual-write to DB and queue | Never write to a DB and publish to a broker as two separate steps — use a transactional outbox (or CDC), and keep consumers idempotent for the redelivery it introduces. | `references/outbox.md` |

## Pre-flight checklist

Before introducing or modifying a queue-based path, run through these:

1. **Purpose:** can I name in one sentence what this queue is for? Does the broker shape match (task / pub-sub / log / buffer)?
2. **Delivery:** what semantics does the broker provide, and have I read the docs for the failure modes? (Default assumption: at-least-once.)
3. **Idempotency:** is the handler idempotent under duplicate delivery? Natural, conditional, or keyed?
4. **Ack:** does the ack happen *after* the durable side effect? Is the visibility timeout longer than the work time (or am I heartbeating)?
5. **Retries + DLQ:** are max attempts, backoff (with jitter), and a DLQ configured? Do permanent errors short-circuit to the DLQ?
6. **Ordering:** does the handler assume order? If so, is it routed by partition key, or is it version-aware/commutative?
7. **Dual-write:** is anything writing to both a DB and a broker in two steps? If so, replace with an outbox.

If any answer is "I don't know," stop and find out before shipping. Backpressure, dashboards/alerting, and message-schema hygiene are operational concerns beyond the 7 principles — see `references/operating.md`.

## Reference files

| File | Read when |
|---|---|
| `references/broker-selection.md` | Picking a broker (principle 1), reasoning about delivery semantics per broker (principle 2), or routing/ordering by partition key (principle 6) — decision matrix, per-broker cheat sheet, common selection mistakes. |
| `references/idempotency.md` | Designing a consumer (principle 3) — natural/conditional/keyed idempotency, dedup tables, idempotency keys for external APIs and your own mutation endpoints. |
| `references/operating.md` | Wiring up ack/visibility-timeout discipline (principle 4), retries/backoff/DLQ (principle 5), or dashboards, alerting thresholds, backpressure, claim-check, schema evolution. |
| `references/outbox.md` | A use case writes to both a DB and a broker (principle 7) — outbox table schema, relay design, CDC trade-offs. |

## How to use this skill in a conversation

Always-on for queue-shaped work (per `.claude/rules/fundamentals.md`). Don't ask the user to opt in. If the task is in "When to skip", say so in one sentence and proceed without it.

When the skill applies:
- **Designing a new async path** — name the purpose first (principle 1), then delivery semantics (2), then walk the rest of the checklist before writing code.
- **Reviewing queue code** — go through the 7 principles as a checklist; cite the principle number when flagging an issue.
- **Debugging a queue incident** — symptom → principle: "double-charged" → P3 (idempotency); "lost event" → P7 (dual-write) or P4 (ack order); "stuck processing" → P5 (poison/no DLQ); "out-of-order state" → P6.
- Non-obvious calls (turning off auto-commit, introducing an outbox, FIFO vs Standard, retry cap): say *why* in one sentence and cite the principle.
