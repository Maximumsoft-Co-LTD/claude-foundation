---
description: Implement one OpenSpec change in isolation.
argument-hint: <change>
---

Build **$ARGUMENTS**.

`sandbox create <change>` or `sandbox sync`; read the Build packet and
`.claude/commands/references/build-policy.md`.
Treat `verificationPlan` as the check schedule: run its boundary command once
when eligible, and do not run `avoidBefore` commands against unchanged inputs.
Call `agents dispatch <change>` and obey its single action until
`build-complete`. Run `run-in-session` locally. The deferred readiness command
becomes eligible only when no tasks remain. For `run-leased-in-session`,
`spawn-group`, or `wait`, read `.claude/commands/references/build-dispatch.md`.
Relay `blocked`.
Treat `spawn-group` as concurrent authority: spawn every successfully leased
worker before waiting for any worker. Never serialize that group in the parent.

Edit only allowed sandbox paths. Host owns leases and task ledger. Declare new
files in `[paths:]`; move unauthorized operations to `handoffs.yaml`. Auto-repair
in-contract findings and use typed recovery.
Never replay history, expose raw JSON, archive, commit, or Land. Report
behavior, checks, remaining risk, and next action.
