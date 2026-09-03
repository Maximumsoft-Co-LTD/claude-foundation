---
description: Compose change → build → prove.
argument-hint: <intent> | --resume <change> | --plan-only <intent>
---

`--resume` reads current state. `--plan-only` runs only `/change`.

For fresh work use `/change`; it compiles one semantic draft. Then run
`claude-foundation advance <id> --through proven` and follow each returned
protocol-v3 action plus its exact `resume` route. The coordinator skips already
completed Build work and reused evidence automatically. Do not reconstruct
`sandbox`, `packet`, dispatch, proof, or authority chains manually.

Normally stop only at `DONE`/`proven` or a real typed boundary. When this
invocation already contains explicit Land authority, use `--through archived`
instead and do not report completion before runtime status is `archived`.

Do not reread framework files. Report evidence in the user's language.

Use Edit/Write.

Code/test success without the corresponding Foundation state is incomplete.

Never infer Land authority, commit, push, open PR, or add a ledger.
