---
description: Implement one OpenSpec change with the native harness.
argument-hint: <change>
---

Build **$ARGUMENTS**.

The managed Foundation block already supplies the loop invariants. Start from
`claude-foundation packet <change> --phase build` as the compact handoff; this
also closes the prior telemetry phase without a per-tool hook. Do not reconstruct
the work by replaying prior conversation. Validate the change. If it has no
isolated workspace, run
`claude-foundation sandbox create <change>` and perform edits
at the returned path. Read its proposal/delta specs/design/tasks/evidence and
execution wiring, then
implement with native tools. `tasks.md` is the sole ledger. Use focused checks
during convergence, update its checkboxes, and stop when implementation is ready
for deterministic proof. Do not run lifecycle personas, mirror tasks, archive,
commit, or land.

For a change whose `repositories.yaml` selects multiple repositories, run
`claude-foundation sandbox create <change> --all` followed by
`claude-foundation agents plan <change>`. Spawn native subagents only for
independent groups in that plan. Give each worker
`claude-foundation packet <change> --repo <id> --task <task-id>` and the model
family selected by the plan. Agents may edit only their repository sandbox and
declared paths; they may not commit, push, update root pointers, or Land.
Acquire the task lease before spawning with
`claude-foundation agents acquire <change> <task> --owner <agent-id>` and
release it after the worker stops. A blocked lease means the task must wait.
