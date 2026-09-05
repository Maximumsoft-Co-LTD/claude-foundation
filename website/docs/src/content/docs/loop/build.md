---
title: /build
description: Implement the compiled agreement in isolation through one coordinator.
---

```text
/build <change>
```

Build uses one model-facing command:

```bash
claude-foundation advance <change> --through build
```

The coordinator validates the agreement, creates or synchronizes the isolated
workspace, compiles task dependencies, accounts for active leases, and returns
one protocol-v4 action. After doing that action, the agent calls the exact
`resume` route. It never reconstructs a `sandbox → packet → plan → dispatch`
chain.

## The six actions

| Action | Meaning |
|---|---|
| `EDIT` | Implement only the returned task(s), workspace, and allowed paths; run the listed focused checks once |
| `REPAIR` | Apply one complete dependency-ordered repair batch, then resume |
| `RUN_EXTERNAL` | Run the one configured boundary operation |
| `WAIT` | A live resource/external owner must finish; state is preserved |
| `ASK_USER` | A material choice or authority is genuinely missing |
| `DONE` | The requested Build target is reached |

Every non-done action names the cause, responsible actor, safe alternatives,
preserved state, and exact resume command. Automatic recovery stays inside the
agent's current authority; the harness never turns a stale lease or repeated
execution into a pass.

## Isolation and concurrency

Product writes are allowed only in the exact workspace and paths returned by
`EDIT`. Shell mutation must anchor itself to that workspace. A worktree contains
tracked files only; configure `sandbox.setupCommand` or a per-repository setup
command when dependencies must be installed.

The phase hook and `claude-foundation exec` use the same containment policy.
They reject absolute outside operands, later directory escapes, and writes
through symlinks outside the workspace; `exec` derives the phase from runtime
state and starts Build children in the canonical workspace. This is cooperative
containment, so the host still owns process isolation for indirect effects.

Parallel mode returns only independent tasks and lease instructions. The host
starts every successfully leased worker before waiting, observes the writes,
and resumes the same `advance` command. Primitive `sandbox`, `packet`, `agents
plan`, and `agents dispatch` commands remain available under `help --all` for
operator diagnostics and host integrations.

## New behavior discovered during Build

Do not edit several OpenSpec ledgers by hand. Submit one semantic amendment:

```bash
claude-foundation change amend <change> <amendment.json> --consume-amendment
```

The compiler preserves completed tasks and manual sections, validates the new
agreement transactionally, and returns to `advance`. `updateTasks` may extend
claim coverage but cannot replace an existing outcome or verification command;
add a new task when that contract changes. Permission-bound cloud,
secret, Terraform, deployment, or restart work becomes a typed external
operation; Build never asks for credentials.

`DONE` at Build does not prove or land the change.
