---
description: Implement one OpenSpec change in isolation.
argument-hint: <change>
---

Build **$ARGUMENTS**.

Run `claude-foundation advance <change> --through build`. It validates the
agreement and isolation, then returns one protocol-v3 action. Follow it and its
exact `resume` route until `DONE` at Build or a real boundary.

- `EDIT`: implement returned tasks and focused checks.
- `REPAIR`: apply the dependency-ordered batch; amend new behavior.
- `RUN_EXTERNAL`: run the configured operation once.
- `WAIT`/`ASK_USER`: preserve state and relay the boundary choices.
- `DONE`: Build is complete; do not continue into Proof from this command.

Read `references/build-policy.md` only for edits/repair and
`references/build-dispatch.md` only for parallel work or leases.

Edit only allowed sandbox paths. Host owns leases and task ledger. Declare new
files in `[paths:]`; move unauthorized work to `handoffs.yaml`. Never replay
history, expose internal JSON, archive, commit, or Land. Report behavior, checks, remaining risk,
and the resume action.
