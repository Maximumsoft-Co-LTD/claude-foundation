---
description: Produce content-bound evidence for an OpenSpec change.
argument-hint: <change>
---

Prove **$ARGUMENTS**. Shared rules: `.claude/harness/AGENT.md`.

Run `claude-foundation advance <change> --through proven`. The coordinator
reuses fresh receipts, wires evidence, syncs the sandbox, runs providers and
agent-runnable review, routes configured review, and finalizes proof.

Execute each protocol-v6 action, then its exact `resume`. `REPAIR` and `EDIT`
return a bounded invalidation/repair set to apply whole; `RUN_EXTERNAL` names
one configured external boundary. Stay in-session while a review runs: ending
the reply kills it. Never rerun unchanged checks or search for alternate
commands. Never fabricate evidence or invent a checker.

## Gate: review timeout or no progress

Review shares one 30-minute window that extends once automatically. At the
next expiry, or after repeated no-progress, report completed findings, what
was tried, and unreviewed scope. Let the user choose another window, Land with
explicit risk acceptance, or pause; record the answer through
`.claude/skills/prove/references/workflow.md`. Read that reference otherwise
only for a named non-automatic boundary.

Never Land. `DONE` at `proven` is success for this command, not delivery.
Report what passed, what remains unproven, and the next action in the
user's language.
