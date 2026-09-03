---
description: Land and archive a proven OpenSpec change.
argument-hint: <change>
---

Land **$ARGUMENTS** explicitly.

This invocation supplies Land authority to
`claude-foundation advance <change> --through archived`. The coordinator checks
proof freshness and handoffs, prepares/applies the recoverable transaction,
verifies, archives, and cleans up safely.

During Land never edit product or agreement files. Follow a returned `WAIT`,
`REPAIR`, `RUN_EXTERNAL`, or `ASK_USER` action exactly and resume with its
`resume` command. Relay its cause, actor, alternatives, and preserved state.
Conflicts, interrupted apply, external handoffs, missing permission, and moved
bases are real boundaries. `DONE` requires `archived`; store no credentials.

For compatibility, a legacy `automaticRecovery` is projected as
`recovery.type: AUTO_RECOVER`: Execute returned safe steps before asking, then
explain blockers in plain language.

Never commit, push, or open a PR without separate authority.
