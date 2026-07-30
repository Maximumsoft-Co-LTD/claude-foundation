---
description: Produce and validate content-bound evidence for an OpenSpec change.
argument-hint: <change>
---

Prove **$ARGUMENTS**.

Read [the change loop](../orchestrator.md). Run:

1. `claude-foundation validate <change>`
2. `claude-foundation proof plan <change>`
3. Execute only stale/missing providers. Record each with
   `claude-foundation evidence run` or `claude-foundation evidence record`.
4. Run risk-triggered review only when resolver state requires it.
5. `claude-foundation proof finalize <change>`

Do not describe a check as passed without a matching receipt. Do not land.
