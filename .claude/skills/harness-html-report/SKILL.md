---
name: harness-html-report
description: "Use when asked for an HTML report of Change Loop state, tasks, gates, or evidence. Read-only; skip anything that changes runtime state."
---

# Harness HTML report

A read-only projection of `.foundation/` and `openspec/`; never mutate harness
state or create a parallel status store.

## Steps

1. Read `references/report.md` for the data sources, metrics, and section
   structure.
2. Read only the listed sources; treat missing or stale data as unknown, never
   as a pass.
3. Render the sections in the report language with evidence freshness shown.
4. Write the artifact where the request names; publish only with separate
   authority.

## Harness

The report explains state; it is not proof and grants no completion,
publication, or Land authority. Never edit receipts, proof, or journals.

## References

- `references/report.md` — data sources, metrics, structure, render rules.
