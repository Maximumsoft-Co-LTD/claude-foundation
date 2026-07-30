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
