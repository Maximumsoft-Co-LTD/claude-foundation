---
description: Team mode — start Phase 2 directly on a planned run. Confirms the run is gated (approves it if not), then runs the autonomous build: implement → review → security → test → improve (brownfield feat/fix) → docs → ship → retro.
argument-hint: [<run-id>] (defaults to the most recent run)
---

Run Phase 2 (implementation → ship → retro) for: **$ARGUMENTS**

This is the **Phase 2 entry point of `/dev`, run on its own** — for when the requirements work is already done (via `/spec`, `/dev-plan`, `/test-plan`, and optionally `/uxui-plan`, or an earlier `/dev` Phase 1) and you just want to build it. You — the main agent — play the orchestrator: confirm the run is ready, take it through the **gate** (the human sign-off, if it hasn't happened yet), then run the autonomous Phase 2 exactly as `.claude/orchestrator.md` defines it.

> **Spawn workers by name** — `engineer`, `lead`, `qa`, `retro` (and `team-*` for fanout) via `Agent({ subagent_type: "<name>" })`. Do **not** use `subagent_type: "general-purpose"` or `"orchestrator"` (the spawn guard blocks both). *You* are the orchestrator.
>
> This command runs the **same** Phase 2 as `/dev` and writes the same `state.json`, so `/dev --resume <id>` and `/implement <id>` are interchangeable mid-build. `/implement` just makes the "the plan's done — go" intent explicit and checks you're actually ready.

## What to do

1. **Read [`.claude/orchestrator.md`](../orchestrator.md)** — sections **`Phase 1 — Requirements` step 9 (Gate)**, **all of `Phase 2 — Implementation`**, **`State discipline`**, **`Cycle escalation`**, and **`Fanout dispatch`**. Phase 2 is intricate (implement fanout, review/security/test cycles, ship gate, retro) — that file is the source of truth. Do **not** re-derive it here; follow it, with the entry conditions below.

2. **Resolve the run.**
   - **`$ARGUMENTS` names a run** (a `NNNN-…` id or a path under `.workflow/`) → use it.
   - **`$ARGUMENTS` is empty** → pick the most-recently-updated run under `.workflow/` (by `state.json > last_updated`, excluding `_templates`). Ask via `AskUserQuestion` if more than one is plausibly active.
   - **No run exists** → there's nothing to build; point the user at `/spec` → `/dev-plan` (or `/dev`). Don't fabricate a run.
   - **If `repo_root` is set**, check out the run's `branch` first (orchestrator `Resume` step 2) — if the checkout fails for any reason (dirty tree, missing branch, detached HEAD), stop and surface it via `AskUserQuestion`; never build on an unverified branch.

3. **Prerequisite check (you must be ready for autonomous work).**
   - **`spec.md` missing or still has `[NEEDS CLARIFICATION]`** → stop; route to `/spec <id>`.
   - **`plan.md` (or `epic.md`) missing** → stop; route to `/dev-plan <id>`.
   - **`test-plan.md` missing for `feat` / `fix` / `refactor`** → it's a gate prerequisite (the consistency scan maps every AC to a Coverage-plan row). Produce it first by running orchestrator **step 8a** here. For a normal `/dev` XS/S resume, the combined `lead` spawn should already have written it; if it is still missing, write the minimal fallback inline from the template for XS/S. For team-built or M/L runs, spawn `qa` in test-plan mode unless the absence is a legacy/partial-run recovery where an inline fallback is the only safe option. (chore/docs/spike correctly have none.)
   - Already mid-Phase-2 (`state.step` is `implement`/`review`/`test`/`improve`/`docs`/`ship` with progress recorded) → this is a resume: follow the orchestrator **`Resume`** rules and the step-10 **Resume guard** (a non-empty `impl_phases_done` routes to the Integration variant, not a re-dispatch).

4. **Gate (human sign-off — runs unless already approved).** Phase 2 is *autonomous through ship*, so a human must approve the contract first; this never shrinks at any size. If `state.step` is `gate` with `next_step=implement`, or `INDEX.md` status is `approved` (the run was already gated), the shards were already folded — **skip straight to step 5**. Otherwise run orchestrator **step 9** in full, which **begins by folding any Phase-1 shards** (`state.plan.json` / `state.test-plan.json` / `state.uxui.json` — written by the team-mode commands instead of the contended cursor; `orchestrator.md > State discipline > Team-mode Phase-1 sharding`) into `state.json`, absorbing the plan shard's `size`/`field`/`phase_plan`/`next_step`. Then the pre-gate consistency scan (every `spec.md` AC has delivering + verifying steps in `plan.md`, zero dangling cross-refs, zero `[NEEDS CLARIFICATION]`, and — feat/fix/refactor — a `test-plan.md` Coverage-plan row per AC), then present the contract (per-line AC confirmation, inferred-assumptions veto, hard-to-reverse decisions, plan/scaffold/test-plan summary, and the per-task phase plan with **any matrix deviation surfaced for explicit confirmation** — `WORKFLOW.md > Per-task phase plan`) and ask `approve` | `skip <n>` | `run <n>` | `revise <notes>` via `AskUserQuestion`. Route `revise` through the incremental spec/plan/test-plan-revise paths and `skip <n>`/`run <n>` through the phase-disposition flip (step 9); loop until `approve`. On `approve`: `INDEX.md` → `approved`, `state.step=gate, next_step=implement`, and record the gate-confirmed `state.phase_plan`.

5. **Run Phase 2 (orchestrator steps 10–18).** Implement (step 10, with implement-fanout consumer contract for `feat` when the plan declares disjoint parallel phases), review (step 11, per-repo fanout for control-plane runs), security (step 12, trigger-based), test (step 13, executing `test-plan.md`), improve (step 13½, bounded Mode D cleanup for a brownfield `feat`/`fix`), docs (step 14), ship (step 15, commit + optional PR + CI ship-gate), `done_at` stamp + retro spawn (step 16), skill-candidate handoff (step 17), close (step 18). Honour every rule in those steps: write the complete `state.json` after each step (`State discipline`), respect the review/test cycle limits (`Cycle escalation`), fire the security review only when the diff trips the sensitive-paths trigger, and surface any worker `BLOCKER:` / "needs user input" via `AskUserQuestion`.

6. **Close out.** After retro, report the commit SHA / PR URL, the acceptance-criteria status, and where `retro.md` surfaced memory/skill candidates for your confirmation (orchestrator does not auto-save them).

Reference: [`.claude/orchestrator.md`](../orchestrator.md) (step 9 gate + Phase 2 + State discipline + Cycle escalation + Fanout dispatch), [`WORKFLOW.md`](../../WORKFLOW.md) (type-aware phase matrix + security trigger list).
