---
description: Implement one OpenSpec change in isolation.
argument-hint: <change>
---

Build **$ARGUMENTS**.

Validate. Create or sync its sandbox, then start from
`claude-foundation packet <change> --phase build`; read referenced files as needed.

If the host declares unattended execution, use one bare `--unattended` flag on
doctor/create. Detection never authorizes; stop when blocked. The runtime cannot
infer an external Allow All setting, so never silently fall back to ordinary
create after an unattended guard fails.

For multi-repo work, run `claude-foundation agents plan`. Keep single-agent work
single. Lease each worker, pass only
`claude-foundation agents task <change> <task>`, then release.

Edit only the packet sandbox and allowed paths. Run focused checks and update
the sole ledger, `tasks.md`. Finish by running
`claude-foundation proof readiness <change>` and resolve code/configuration
blockers before handing off to a fresh Prove context.

Do not replay history, mirror tasks, run lifecycle personas, archive, commit, or Land.
