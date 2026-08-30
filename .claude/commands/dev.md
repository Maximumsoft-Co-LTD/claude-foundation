---
description: Compose change → build → prove.
argument-hint: <intent> | --resume <change> | --plan-only <intent>
---

`--resume` continues; `--plan-only` stops after Change.

For all fresh work use `/change`; follow its workflow. After doctor and its
Decision Sheet, immediately run `claude-foundation change new "<intent>"` to bind
Change ID/budget before authoring. `change start --template` requires a complete
supplied draft.

Run Build and Prove in separate fresh Agent sessions with phase command and change ID;
await each.

Do not reread framework files. Report evidence and next action.

Author artifacts with Edit or Write, never mutating Bash commands.

Workflow is mandatory. Code/test success without Foundation runtime state is a failed `/dev` invocation.

Never Land, commit, push, open a PR, or create another ledger.
