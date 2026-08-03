---
description: Implement one OpenSpec change in isolation.
argument-hint: <change>
---

Build **$ARGUMENTS**.

Validate; run `claude-foundation sandbox create <change>` or `sandbox sync`.
Start from
`claude-foundation packet <change> --phase build`; read references.

If the host declares unattended execution, use one bare `--unattended` flag on
doctor/create. Detection never authorizes. The runtime cannot infer external
Allow All, so stop when blocked; never fall back to create.

For multi-repo work, run `claude-foundation agents plan`. Keep single-agent work
single. Lease workers, pass only their `agents task` packet, then release.

Edit only allowed sandbox paths. Run focused checks and update the sole ledger,
`tasks.md`. Run `claude-foundation proof readiness <change>` and resolve
code/configuration blockers before fresh Prove.

Never replay history, mirror tasks, archive, commit, or Land.
