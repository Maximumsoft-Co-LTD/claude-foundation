---
description: Start the /dev workflow (spec → plan → gate → implement → review → test → retro)
argument-hint: <intent>
---

Run the `/dev` workflow on this intent: **$ARGUMENTS**

Spawn the `orchestrator` agent via the `Agent` tool with `subagent_type: orchestrator`. Pass the intent above as the prompt. If `$ARGUMENTS` is empty, the orchestrator asks the user via `AskUserQuestion`.

The orchestrator owns:
- ID assignment from `.workflow/INDEX.md` (`NNNN-<type>-<slug>`)
- Run folder creation under `.workflow/<id>/`
- Phase 1 — delegate to `pm` (interview + `spec.md`) → `lead` (plan + `plan.md`, or `epic.md` if scope splits) → gate (`approve` / `revise` / `swap`)
- Phase 2 — delegate to `engineer` (implement) → `lead` (review) → `qa` (tests) → `engineer` (docs touch-up) → `retro` (closeout)
- All status updates to `.workflow/INDEX.md`
- Cycle-limit enforcement (review max 2, test max 3) before escalating to user

Do not do any of the orchestrator's work yourself — your job here is just to hand off.

Reference: [`WORKFLOW.md`](../../WORKFLOW.md) for the full flow definition.
