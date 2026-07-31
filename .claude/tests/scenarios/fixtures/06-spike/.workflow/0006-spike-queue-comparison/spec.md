# Spec: Spike — compare BullMQ and Sidekiq

**ID**: 0006-spike-queue-comparison
**Type**: spike
**Status**: approved
**Field**: brownfield
**Timebox**: 1 day
**Deliverable**: recommendation

## Goal

Decide which background-job library to adopt for the notifications service.

## Questions & Timebox

Timebox: one day. Deliverable: a written recommendation, not shipped code.

Questions to answer:
- Which library fits a Redis-backed, Node-first stack with the least operational overhead?
- What is the migration cost from the current inline processing?

**Acceptance scenarios**

- [x] **AC1** — the spike ends with a written recommendation that names one library and the reasoning behind it.
