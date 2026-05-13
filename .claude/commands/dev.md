---
description: Start the /dev workflow (spec → plan → gate → implement → review → security → test → docs → ship → retro). Pass --resume <id> to continue an interrupted run.
argument-hint: <intent> | --resume <id>
---

Run the `/dev` workflow on this intent: **$ARGUMENTS**

Spawn the `orchestrator` agent via the `Agent` tool with `subagent_type: orchestrator`. Pass `$ARGUMENTS` as the prompt verbatim.

- If `$ARGUMENTS` is empty, the orchestrator asks the user via `AskUserQuestion`.
- If `$ARGUMENTS` starts with `--resume`, the orchestrator reads `.workflow/<id>/state.json` and continues from the recorded step instead of starting fresh.

The orchestrator owns:
- ID assignment from `.workflow/INDEX.md` (`NNNN-<type>-<slug>`)
- Run folder creation under `.workflow/<id>/` (including `state.json`)
- Phase 1 — delegate to `pm` (interview + `spec.md`, reading `.workflow/FOLLOWUPS.md`) → `lead` (plan + `plan.md`, or `epic.md` if scope splits) → gate (`approve` / `revise` / `swap`)
- Phase 2 — delegate to `engineer` (implement) → `lead` (review) → `lead` (security review, if triggered) → `qa` (tests, type-aware) → `engineer` (docs touch-up) → `engineer` (ship — commit + optional PR) → `retro` (closeout) → skill-creator handoff for each user-approved skill candidate
- Type-aware branching per `WORKFLOW.md > Type-aware phase matrix` (skipping QA for chore/docs/spike, mandating regression-test-first for fix, etc.)
- `state.json` updates after every step so `--resume` works
- Follow-up tracking via `.workflow/FOLLOWUPS.md` (pm reads, retro appends + closes)
- All status updates to `.workflow/INDEX.md`
- Cycle-limit enforcement (review max 2, test max 3) before escalating to user

Do not do any of the orchestrator's work yourself — your job here is just to hand off.

Reference: [`WORKFLOW.md`](../../WORKFLOW.md) for the full flow definition.
