---
description: Compose change → build → prove.
argument-hint: <intent> | --resume <change> | --plan-only <intent>
---

`--resume` reads state. When sandbox has zero pending tasks, skip Build;
invoke fresh `/prove <id>`. `--plan-only`: Change.

For all fresh work use `/change`. After its Decision Sheet, run
`claude-foundation change new "<intent>"` to bind budget. Use
`change start --template` only with a complete draft.

After Change, await fresh Agents for `/build <id>`, then `/prove <id>`. Parent
never runs Build inspection/tests, proof readiness/advance, or authority
commands; phase agents own boundaries.

Do not reread framework files. Report evidence in the user's language.

Use Edit/Write.

Code/test success without Foundation runtime state is a failed `/dev` invocation.

Never Land, commit, push, open PR, or add a ledger.
