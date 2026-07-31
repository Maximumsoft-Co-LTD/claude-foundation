---
description: Implement one OpenSpec change in isolation.
argument-hint: <change>
---

Build **$ARGUMENTS**.

Validate the change. Create or sync its sandbox, then start from
`claude-foundation packet <change> --phase build`; read referenced files only
when needed.

For multi-repo work, run `claude-foundation agents plan`. Keep single-agent
recommendations single. For each worker, acquire its lease and pass only
`claude-foundation agents task <change> <task>`, then release the lease.

Edit only the packet sandbox and allowed paths. Run focused checks and update
the sole ledger, `tasks.md`. Finish by running
`claude-foundation proof readiness <change>` and resolve code/configuration
blockers before handing off to a fresh Prove context.

Do not replay history, mirror tasks, run lifecycle personas, archive, commit,
push, or Land.
