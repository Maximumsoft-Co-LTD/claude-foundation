---
description: Compatibility composition for change → build → prove.
argument-hint: <intent> | --resume <change> | --plan-only <intent>
---

Run Foundation for **$ARGUMENTS**.

`--resume` inspects runtime state and continues at the first incomplete
operation: Change artifacts, Build tasks, or Prove evidence. Never restart a
completed operation merely to replay the flow. Otherwise run `/change`; with
`--plan-only`, stop after validation. Then run `/build` and `/prove`.

Never Land, commit, push, open a PR, create `.workflow/` state, lifecycle
agents, phase mirrors, or a second task ledger.
