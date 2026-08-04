---
description: Implement one OpenSpec change in isolation.
argument-hint: <change>
---

Build **$ARGUMENTS**.

Validate; run `sandbox create <change>` or `sandbox sync`. Start from
`packet <change> --phase build`; read references.

For unattended execution, use one bare `--unattended` on doctor/create.
Detection never authorizes; stop when blocked.

For multi-repo work, run `agents plan`; keep single-agent work single. The host
owns leases and gives workers only `packet --task <task>`.

Edit only allowed sandbox paths. Run focused checks and update the sole ledger,
`tasks.md`. Run `claude-foundation proof readiness <change>` and resolve
code/configuration blockers before fresh Prove.

Never replay history, mirror tasks, archive, commit, or Land.
