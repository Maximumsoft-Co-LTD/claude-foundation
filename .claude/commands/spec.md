---
description: Team mode — PM writes spec.md only. Runs the Phase-1 interview, then the pm agent writes the spec for a new or existing run, and stops (no plan, no implement).
argument-hint: <intent> | <run-id> (to refine an existing spec)
---

Write a spec for: **$ARGUMENTS**

This is the **PM slice of `/dev`, run on its own** — the first link of team mode. You — the main agent — set up the run and run the interview (sub-agents can't call `AskUserQuestion`), then the `pm` sub-agent writes `spec.md` from your answers. You stop after the spec check; planning, UX, tests, and implementation are separate commands (`/uxui-plan`, `/test-plan`, then `/dev --resume <id>`).

> **Spawn `pm` by name** (`Agent({ subagent_type: "pm" })`); never `general-purpose`/`orchestrator` — the spawn guard blocks both (`orchestrator.md > Rules`). *You* are the orchestrator.

## What to do

1. **Read [`.claude/orchestrator.md`](../orchestrator.md)** — sections **`On invocation`**, **`State discipline`**, and **`Phase 1 — Requirements`** (Interview → Spec). Those are the source of truth for setup, the interview discipline, the `pm` spawn contract, and the `state.json`/`INDEX.md` bookkeeping. Follow them as written, with the deltas below.

2. **Resolve the run.**
   - **`$ARGUMENTS` is empty** → ask the user for the intent via `AskUserQuestion`, then proceed as a new intent.
   - **`$ARGUMENTS` names an existing run** (a `NNNN-…` id or a path that resolves under `.workflow/`) → open that run to **refine** its spec. Read its `state.json` + `spec.md`; treat the new message as spec feedback and re-spawn `pm` in **spec-patch mode** (`references/pm.md > Spec-patch mode`) for a targeted edit — do not start a fresh run. Skip the new-run setup in step 3.
   - **`$ARGUMENTS` is a new intent** → run the **Fresh run** setup verbatim from orchestrator `On invocation > Fresh run` (the run-id / branch / `.workflow/` / `INDEX.md` bookkeeping — don't re-derive it here), including the **not-actually-fresh guard** (Setup) so feedback on an in-flight run revises it instead of spinning up a duplicate.

3. **Interview (you run it).** Run the orchestrator's **Interview** step in full (digest → size → spec-prep fanout → one `AskUserQuestion` batch — don't re-derive it). Two deltas to hold: the NFR-detection + per-AC error/boundary questions are mandatory for a runtime-shipping feat/fix, and you must fetch + inline any external-URL reference before saving (the `pm` agent has no web access).

4. **Spawn `pm` (always).** Per **Spec**, spawn `Agent({ subagent_type: "pm" })` with the run id, type, intent, the requirements digest + free-text catch-all, the full Q&A, any `References / examples to follow` (URLs inlined), the confirmed `FOLLOWUPS.md` IDs, the `Assumptions (inferred)` list, and any fanout findings + `Dispatched-as:` map. **Delta from `/dev`: always spawn `pm`** — do **not** take the XS/S "skip pm, combined `lead` spec+plan+test-plan" fast path. This command's whole purpose is the PM artifact; the fast-path merge is a `/dev`-only optimisation. Handle a `BLOCKER:` return exactly as **Spec** prescribes (surface the blocker, then re-spawn `pm`) — `pm` direct-nests its own research helpers, so there's no signal to dispatch.

5. **Spec check.** Run the post-spec check from the orchestrator's **Spec** step (presence of Type / User Stories / `AC#` / FR-### / SC-### / each fired section; inline `[NEEDS CLARIFICATION]` for gaps — don't re-list it here). Re-spawn `pm` once if a real answer didn't make it in.

5a. **Build shared context (brownfield M/L).** `field=brownfield` AND `size ∈ {M,L}` → build `.workflow/<id>/context.md` **once** per orchestrator's **Context** step (spawn `team-codebase-explorer`, synthesise into [`_templates/context.md`](../../.workflow/_templates/context.md) so `/dev-plan`/`/test-plan`/`/uxui-plan` read one map instead of each re-walking — don't re-derive the recipe). **You** write it (fanout = evidence; record `team_registry` + a `{phase:"context"}` `fanout_log` row per State discipline). Greenfield / XS / S → skip.

6. **Write `state.json` and stop.** Per `State discipline`, write the complete `state.json`: `step=spec`, `next_step=plan`, `last_agent=pm` (or `main` if you patched inline), `context_built=true` when step 5a built `context.md` (else leave `false`), fresh `last_updated`. Set `INDEX.md` status → `planned`. **Do not proceed to the plan.** End by telling the user the run id and the next moves: `/uxui-plan <id>` (UX, if the change has a UI), `/test-plan <id>` (test strategy, after a plan exists), or `/dev --resume <id>` to carry the run through plan → gate → implement → ship.

Reference: [`.claude/orchestrator.md`](../orchestrator.md) (setup + Interview + Spec), [`.claude/agents/pm.md`](../agents/pm.md) (spec contract + spec-patch mode).
