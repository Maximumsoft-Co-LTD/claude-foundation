---
description: Transactionally land and archive a proven OpenSpec change.
argument-hint: <change>
---

Land **$ARGUMENTS**.

Read [the change loop](../orchestrator.md). First run
`claude-foundation land check <change>`. Stop on stale,
failed, error, inconclusive, or missing evidence. If the runtime uses an
isolated workspace, run
`claude-foundation sandbox apply <change>`; this applies only
the proven diff and verifies the resulting hash. Then synchronize delta specs
and archive with `claude-foundation land archive <change>`.

Commit, push, or open a PR only when the user or repository policy explicitly
authorizes it.
