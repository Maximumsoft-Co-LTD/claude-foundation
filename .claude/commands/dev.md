---
description: Compose change → build → prove.
argument-hint: <intent> | --resume <change> | --plan-only <intent>
---

Execute **$ARGUMENTS**.

`--resume` continues incomplete work without replay. `--plan-only` stops after Change.

For all fresh work use `/change`; only it runs `change start --template` after
the complete read and Decision Sheet. Run Build and Prove in separate fresh Agent
sessions with only the phase command and change ID; await each.

Do not reread framework files unless blocked. Report progress, behavior,
evidence, risk, and next action in the user's language.

Workflow is mandatory. Code/test success without Foundation runtime state is a failed `/dev` invocation.

Never Land, commit, push, open a PR, create `.workflow/` state, lifecycle agents,
phase mirrors, or another ledger.
