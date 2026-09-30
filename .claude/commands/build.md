---
description: Implement one OpenSpec change in isolation.
argument-hint: <change>
---

Build **$ARGUMENTS**.

Run `claude-foundation advance <change> --through build`. Follow its protocol-v6
action and exact `resume` route yourself until `DONE` or a real boundary.
Command and resume fields are agent-only control data; expose them only for
diagnosis.

- `EDIT`: implement returned work.
- `REPAIR`: apply the ordered batch; amend new behavior.
- `RUN_EXTERNAL`: run the operation.
- `WAIT`/`ASK_USER`: report waits; ask only for the decision; resume yourself.
- `DONE`: continue `--through proven`; never Land.

Rapid work needs only `references/rapid-path.md`. Read `references/build-policy.md`
for a new user request, amendment, or standard change, and
`references/build-dispatch.md` for parallel work or leases.
The policy owns follow-up intent routing.

Edit only allowed sandbox paths. Advance holds session leases and ticks passing
tasks. Start every mutating shell call with `cd <workspace> &&`. Edits outside
`[paths:]` are recorded; unauthorized work goes through a semantic amendment.
Never archive, commit, or Land. Report behavior, checks, remaining risk, and
outcome.
