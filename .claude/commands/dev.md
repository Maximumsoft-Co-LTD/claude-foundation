---
description: Compose change → build → prove.
argument-hint: <intent> | --resume <change> | --plan-only <intent>
---

`--resume` reads state. When sandbox has zero pending tasks, skip Build;
invoke fresh `/prove <id>`. `--plan-only`: Change.

For all fresh work use `/change`. It owns the Decision Sheet and
`change start --template`; do not create a parallel `change new` scaffold.

After Change, await fresh Agents for `/build <id>`, then `/prove <id>`. Parent
never runs Build inspection/tests, proof readiness/advance, or authority
commands; phase agents own boundaries.

Normally stop after Prove. When the invocation already contains explicit Land
authority, await a fresh `/land <id>` phase agent after Prove and do not report
success until runtime status is `archived`.

Do not reread framework files. Report evidence in the user's language.

Use Edit/Write.

Code/test success without Foundation runtime state is a failed `/dev` invocation.

Never infer Land authority, commit, push, open PR, or add a ledger.
