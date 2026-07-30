---
description: Transactionally land and archive a proven OpenSpec change.
argument-hint: <change>
---

Land **$ARGUMENTS**.

Read [the change loop](../orchestrator.md). First run
`node .claude/harness/foundation.mjs land-check <change>`. Stop on stale,
failed, error, inconclusive, or missing evidence. If the runtime uses an
isolated workspace, run
`node .claude/harness/foundation.mjs sandbox apply <change>`; this applies only
the proven diff and verifies the resulting hash. Then synchronize delta specs
and archive with `node .claude/harness/foundation.mjs archive <change>`.

Commit, push, or open a PR only when the user or repository policy explicitly
authorizes it.
