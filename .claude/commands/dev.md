---
description: Compatibility one-shot over the OpenSpec-native change loop: change → build → prove.
argument-hint: <intent> | --resume <change> | --plan-only <intent>
---

Run Foundation for **$ARGUMENTS**.

Read [the change loop](../orchestrator.md). This command is only a composition:

1. `--resume <change>`: continue that change at its first incomplete operation.
2. Otherwise run `/change $ARGUMENTS`.
3. With `--plan-only`, stop after the change artifacts validate.
4. Run `/build <change>`.
5. Run `/prove <change>`.

Do not land, commit, push, or open a PR. Do not create legacy `.workflow/`
artifacts, lifecycle agents, phase state, or a second task ledger.
