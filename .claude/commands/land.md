---
description: Transactionally land and archive a proven OpenSpec change.
argument-hint: <change>
---

Land **$ARGUMENTS**.

Read [the change loop](../orchestrator.md). First run
`claude-foundation land check <change>`. Stop on stale, failed, error,
inconclusive, or missing evidence. Then run
`claude-foundation land archive <change>`. The transaction applies an isolated
workspace when necessary, verifies identity, synchronizes delta specs, and
archives the change.

For multiple repositories, inspect `claude-foundation land plan <change>`.
Child commits and CI remain explicit external effects. After an authorized child
commit exists, bind it with
`claude-foundation land record <change> --repo <id> --commit <sha> [--ci pass]`,
then use `claude-foundation land pointers <change>` to stage verified submodule
pointers in the control sandbox and target index. Re-run Prove because pointer
identity changed, then use `claude-foundation land resume <change>`. Archive
only after every child is landed, required CI passes, root submodule pointers
match the recorded commits, and the resulting composite workspace has fresh
proof.
Archive is idempotent. If the runtime reports `ALREADY ARCHIVED`, stop
successfully; do not recreate the change or synchronize specs again.

Commit, push, or open a PR only when the user or repository policy explicitly
authorizes it.
