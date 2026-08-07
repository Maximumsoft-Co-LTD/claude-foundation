---
title: The change loop
description: The five commands, why they are separate, and how work moves backward when reality changes.
---

Foundation's workflow is five commands, one of them optional:

```text
Investigate? → Change → Build → Prove → Land
```

## Why this shape

An earlier design encoded quality as a long sequence of agent roles and phases — PM, lead, engineer, QA, retro. That preserved quality, but the orchestration itself came to dominate cost and latency. Every handoff meant re-establishing context that a previous persona already had.

The current shape separates three concerns instead:

- **OpenSpec** stores the agreement.
- **The native coding agent** implements the agreement.
- **Deterministic providers** prove the agreement.

Nothing in that split needs a persona relay, so there isn't one.

## It is not a waterfall

The arrows describe *what must be true before what*, not a one-way schedule. Change, Build, and Prove move backward freely:

```text
Change ⇄ Build ⇄ Prove
```

When requirements shift, you revise the same change rather than opening a new one. Foundation syncs the sandbox and invalidates any proof the revision made stale. Only Land is a boundary you cross once, deliberately.

## The steps

| Step | Command | What it owns |
|---|---|---|
| 00 | [`/investigate`](/docs/loop/investigate/) | Read-only exploration. **Optional** — use only when direction is genuinely unclear |
| 01 | [`/change`](/docs/loop/change/) | The agreement: intent, delta specs, tasks, claims, risk, evidence contract |
| 02 | [`/build`](/docs/loop/build/) | Implementation, inside an isolated worktree |
| 03 | [`/prove`](/docs/loop/prove/) | Executable evidence, reusing valid receipts |
| 04 | [`/land`](/docs/loop/land/) | The explicit completion transaction |

Two more commands sit outside the loop. `/changes` lists active work and the next useful action for each, mutating nothing. `/dev` is a compatibility composition of change → build → prove for callers that predate the split.

## Rigor comes from risk, not size

`/change` resolves a handful of properties and those decide how much process applies:

- **impact** — low, medium, or high
- **coupling** — isolated or coupled
- **security triggers** — matched as whole words against the intent, so `access` no longer fires on "accessibility" while "sign in with a passkey" does fire
- **evidence capabilities** — what would actually demonstrate the claims
- **size** — used for budget and slicing *only*

That last line is the important one. Size never downgrades quality. A one-line change across a trust boundary gets the treatment its risk deserves.

## Where state lives

Durable intent belongs in OpenSpec; machine state belongs in `.foundation/`. Nothing important lives in the conversation, which is what lets a fresh session resume from files.

```text
openspec/changes/add-profile-auth/
├── proposal.md
├── design.md
├── tasks.md          # sole task ledger
├── evidence.yaml     # stable claims + capabilities
├── execution.yaml    # provider + service wiring
├── repositories.yaml # write scope
└── specs/

.foundation/
├── runtime/          # lifecycle + resolver
├── receipts/         # content-bound evidence
├── authority/        # review + acceptance requests
├── transactions/     # recoverable Land journals
├── logs/             # provider output + events
├── recovery/         # abandoned change records
└── sandboxes/        # isolated worktrees
```

`.foundation/` is machine-owned and gitignored. `openspec/` is yours to read and review.
