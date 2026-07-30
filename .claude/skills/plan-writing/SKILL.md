---
name: plan-writing
description: Write or improve an OpenSpec change's design.md and tasks.md after proposal and delta requirements are clear. Use when implementation has meaningful sequencing, compatibility, migration, rollback, or cross-component decisions. Skip simple rapid changes.
---

# OpenSpec design and tasks

Planning produces no parallel plan artifact. It completes the active OpenSpec
change.

## `design.md`

Record only load-bearing information:

- verified current-state anchors;
- decisions and the constraints that forced them;
- public compatibility and persisted-data consequences;
- rollout and rollback;
- risks mapped to evidence owners.

Do not repeat proposal or requirement prose. Do not narrate a lifecycle.

## `tasks.md`

This is the sole ledger. Each checkbox is a coherent implementation outcome with
an affected surface and a focused verification. Order dependencies first. Mark
parallel work only when files/symbols and verification are genuinely independent.
Group large changes by behavioral slice; each slice must be provable.

Do not create one native task per checkbox, agent-role handoffs, planning/testing
phases, or a second status store. Finish by checking that every delta scenario has
an implementation owner and an evidence claim.
