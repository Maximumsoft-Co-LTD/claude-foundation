---
description: Team mode — PM writes spec.md only. Runs the Phase-1 interview, then the pm agent writes the spec for a new or existing run, and stops (no plan, no implement).
argument-hint: <intent> | <run-id> (to refine an existing spec)
---

Write a spec for: **$ARGUMENTS**

This is the **PM slice of `/dev`, run on its own** — the first link of team mode. You — the main agent — set up the run and run the interview (sub-agents can't call `AskUserQuestion`), then the `pm` sub-agent writes `spec.md` from your answers. You stop after the spec check; planning, UX, tests, and implementation are separate commands (`/uxui-plan`, `/test-plan`, then `/dev --resume <id>`).

> **Spawn the `pm` worker by name** — `Agent({ subagent_type: "pm", ... })`. Do **not** use `subagent_type: "general-purpose"` or `"orchestrator"` (the `.claude/hooks/dev-agent-guard.sh` PreToolUse guard blocks both). There is no `orchestrator` sub-agent; *you* play that role here.

## What to do

1. **Read [`.claude/orchestrator.md`](../orchestrator.md)** — sections **`On invocation`**, **`State discipline`**, and **`Phase 1 — Requirements` steps 6–7**. Those are the source of truth for setup, the interview discipline, the `pm` spawn contract, and the `state.json`/`INDEX.md` bookkeeping. Follow them as written, with the deltas below.

2. **Resolve the run.**
   - **`$ARGUMENTS` is empty** → ask the user for the intent via `AskUserQuestion`, then proceed as a new intent.
   - **`$ARGUMENTS` names an existing run** (a `NNNN-…` id or a path that resolves under `.workflow/`) → open that run to **refine** its spec. Read its `state.json` + `spec.md`; treat the new message as spec feedback and re-spawn `pm` in **spec-patch mode** (`pm.md > Spec-patch mode`) for a targeted edit — do not start a fresh run. Skip the new-run setup in step 3.
   - **`$ARGUMENTS` is a new intent** → run the **Fresh run** setup (orchestrator `On invocation > Fresh run`): read `INDEX.md` + `FOLLOWUPS.md`, repo detection, pick `NNNN-<type>-<slug>`, create + checkout the branch (skip when no-git), create `.workflow/<id>/`, copy `state.json`, append the `INDEX.md` row (status `spec`). Also run the **not-actually-fresh guard** (step 0) so spec feedback on an in-flight run revises it instead of spinning up a duplicate.

3. **Interview (you run it).** Follow orchestrator Phase 1 step 6 in full: distil the prior conversation into a **requirements digest**, estimate size, run spec-prep fanout when there's anything independent to chase, then ask **one `AskUserQuestion` batch of 3–4 questions** (the NFR-detection and per-AC error/boundary questions are mandatory for a runtime-shipping feat/fix) plus the free-text catch-all. Fetch + inline any external-URL reference before saving (the `pm` agent has no web access).

4. **Spawn `pm` (always).** Per step 7, spawn `Agent({ subagent_type: "pm" })` with the run id, type, intent, the requirements digest + free-text catch-all, the full Q&A, any `References / examples to follow` (URLs inlined), the confirmed `FOLLOWUPS.md` IDs, the `Assumptions (inferred)` list, and any fanout findings + `Dispatched-as:` map. **Delta from `/dev`: always spawn `pm`** — do **not** take the XS/S "skip pm, combined `lead` spec+plan" fast path. This command's whole purpose is the PM artifact; the fast-path merge is a `/dev`-only optimisation. Handle `FANOUT_REQUESTED: research:` and `BLOCKER:` returns exactly as step 7 prescribes (dispatch workers / surface the blocker, then re-spawn `pm`).

5. **Spec check.** Run the post-spec check from step 7 (Type set; Outcome + AC present; every section's trigger fires; `fix` has Reproduction; `spike` has Timebox; unresolved slots carry inline `[NEEDS CLARIFICATION]`). Re-spawn `pm` once if a real answer didn't make it in.

6. **Write `state.json` and stop.** Per `State discipline`, write the complete `state.json`: `step=spec`, `next_step=plan`, `last_agent=pm` (or `main` if you patched inline), fresh `last_updated`. Set `INDEX.md` status → `planned`. **Do not proceed to the plan.** End by telling the user the run id and the next moves: `/uxui-plan <id>` (UX, if the change has a UI), `/test-plan <id>` (test strategy, after a plan exists), or `/dev --resume <id>` to carry the run through plan → gate → implement → ship.

Reference: [`.claude/orchestrator.md`](../orchestrator.md) (setup + interview + step 7), [`.claude/agents/pm.md`](../agents/pm.md) (spec contract + spec-patch mode).
