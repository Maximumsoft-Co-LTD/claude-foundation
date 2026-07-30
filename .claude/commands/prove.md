---
description: Produce and validate content-bound evidence for an OpenSpec change.
argument-hint: <change>
---

Prove **$ARGUMENTS**.

Read [the change loop](../orchestrator.md). Run:

1. `node .claude/harness/foundation.mjs validate <change>`
2. `node .claude/harness/foundation.mjs proof-plan <change>`
3. Execute only stale/missing providers. Record each with
   `foundation.mjs run-provider` or `foundation.mjs receipt`.
4. Run risk-triggered review only when resolver state requires it.
5. `node .claude/harness/foundation.mjs prove <change>`

Do not describe a check as passed without a matching receipt. Do not land.
