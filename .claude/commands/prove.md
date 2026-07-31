---
description: Produce content-bound evidence for an OpenSpec change.
argument-hint: <change>
---

Prove **$ARGUMENTS**.

Start from `claude-foundation packet <change> --phase prove`, not Build history.
Run the atomic proof path:

```text
claude-foundation doctor --stage prove --change <change>
claude-foundation proof readiness <change>
claude-foundation proof run <change>
```

If readiness blocks, follow only its structured next commands. External passes
require an observation, provenance, and durable artifact or reference. Run
required independent review. Never claim a pass without its valid receipt, and
do not Land.
