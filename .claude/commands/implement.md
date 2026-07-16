---
description: Team mode — start Phase 2 directly on a planned run. Confirms the run is gated (approves it if not), then runs the autonomous build: implement → test → review → security → docs → ship → retro.
argument-hint: [<run-id>] (defaults to the most recent run)
---

Run Phase 2 (implementation → ship → retro) for: **$ARGUMENTS**

This is the **Phase 2 entry point of `/dev`, run on its own** — for when the requirements work is already done (via `/spec`, `/dev-plan`, `/test-plan`, and optionally `/uxui-plan`, or an earlier `/dev` Phase 1) and you just want to build it. You — the main agent — play the orchestrator: confirm the run is ready, take it through the **gate** (the human sign-off, if it hasn't happened yet), then run the autonomous Phase 2 exactly as `.claude/orchestrator.md` defines it.

> **Spawn workers by name** — `engineer`/`lead`/`qa`/`retro` (+ `team-*` for fanout); never `general-purpose`/`orchestrator` — the guard blocks both (`orchestrator.md > Rules`). *You* are the orchestrator.
>
> This command runs the **same** Phase 2 as `/dev` and writes the same `state.json`, so `/dev --resume <id>` and `/implement <id>` are interchangeable mid-build. `/implement` just makes the "the plan's done — go" intent explicit and checks you're actually ready.

## What to do

1. **Read [`.claude/orchestrator.md`](../orchestrator.md)** — sections **`Phase 1 — Requirements`** (**Gate**), **all of `Phase 2 — Implementation`**, **`State discipline`**, **`Cycle escalation`**, and **`Fanout dispatch`**. Phase 2 is intricate (implement fanout, review/security/test cycles, ship gate, retro) — that file is the source of truth. Do **not** re-derive it here; follow it, with the entry conditions below.

2. **Resolve the run** — shared selection in [`.claude/orchestrator/references/resolve-run.md`](../orchestrator/references/resolve-run.md). Deltas: **no run** → nothing to build, route to `/spec` → `/dev-plan` (or `/dev`); **`repo_root` set** → check out the run's `branch` first (orchestrator `Resume` step 2), checkout fails (dirty tree, missing branch, detached HEAD) → stop + `AskUserQuestion` (never build on an unverified branch).

3. **Prerequisite check (you must be ready for autonomous work).**
   - **`spec.md` missing or still has `[NEEDS CLARIFICATION]`** → stop; route to `/spec <id>`.
   - **`plan.md` (or `epic.md`) missing** → stop; route to `/dev-plan <id>`.
   - **`test-plan.md` missing for `feat` / `fix` / `refactor`** → it's a gate prerequisite (the consistency scan maps every AC to a Coverage-plan row). Produce it first by running the orchestrator's **Test-plan** step here. For a normal `/dev` XS/S resume, the combined `lead` spawn should already have written it; if it is still missing, write the minimal fallback inline from the template for XS/S. For team-built or M/L runs, spawn `qa` in test-plan mode unless the absence is a legacy/partial-run recovery where an inline fallback is the only safe option. (chore/docs/spike correctly have none.)
   - **`uxui-plan.md` present** (optional UI artifact) → the **UI design contract**; no action here — the **Implement** step points the engineer at it (build to its Scenes/wireframes), `qa` visual-verifies the render. Absent is fine — engineer builds from `plan.md > ## Scaffold` + frontend skills.
   - Already mid-Phase-2 (`state.step` is `implement`/`test`/`review`/`docs`/`ship` with progress recorded) → this is a resume: follow the orchestrator **`Resume`** rules and the **Implement** step's **Resume guard** (a non-empty `impl_phases_done` routes to the Integration variant, not a re-dispatch).

4. **Gate (human sign-off — runs unless already approved).** Phase 2 is autonomous through ship, so a human approves the contract first; never shrinks at any size. If `state.step=gate` with `next_step=implement`, or `INDEX.md` is `approved` (already gated, shards folded) → **skip to step 5**. Otherwise run the orchestrator's **Gate** in full (it folds the shards, backfills the spec-only `test-plan.md`, runs the consistency scan, presents the contract for per-line AC sign-off, and on `approve` writes the `INDEX.md`/`state`/`phase_plan` transition — don't re-derive it here); loop until `approve`.

5. **Run Phase 2 — the orchestrator's ops from Implement through Done, exactly as written** (implement → test → review → security → docs → ship → `done_at`+retro → skill handoff → close). **Do not re-derive them here** (step 1 — that file is the source of truth); the orchestrator owns every rule: the implement-fanout consumer contract for disjoint-phase `feat`, the review/test cycle limits (`Cycle escalation`), the trigger-gated security review, the gate-decided ship (default no → ready-to-run commit command). Write the complete `state.json` after each step (`State discipline`). Test runs before review and a review/security fix re-enters it, so test stays the final pre-ship gate. Surface any worker `BLOCKER:` / "needs user input" via `AskUserQuestion`.

6. **Close out.** After retro, report the commit SHA / PR URL, the acceptance-criteria status, and where `retro.md` surfaced memory/skill candidates for your confirmation (orchestrator does not auto-save them).

Reference: [`.claude/orchestrator.md`](../orchestrator.md) (Gate + Phase 2 + State discipline + Cycle escalation + Fanout dispatch), [`WORKFLOW.md`](../../WORKFLOW.md) (type-aware phase matrix + security trigger list).
