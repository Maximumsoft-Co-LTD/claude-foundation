# Recommendations: queue comparison

## What we learned

BullMQ fits the Node-first, Redis-backed stack with the least operational overhead and first-class TypeScript types. Sidekiq would pull in a Ruby worker runtime the team does not otherwise run, adding a second language to operate.

## Recommendation

Adopt BullMQ for the notifications service. Open a follow-up `feat` run to migrate the current inline processing behind the queue, with a dead-letter path for poisoned jobs.
