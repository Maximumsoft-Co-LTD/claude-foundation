---
description: Team mode — UX/UI designer writes uxui-plan.md only. The uxui agent designs the Scenes (screens/states), ASCII wireframes, Scenarios (user flows), UX direction, and AC↔scene mapping for a UI-bearing change, before the frontend is built.
argument-hint: [<run-id>] | <intent>
---

Write the UX/UI plan for: **$ARGUMENTS**

This is the **UX/UI slice of team mode** — design-time, before the frontend is built. You — the main agent — resolve the run, gather any missing UX direction (sub-agents can't call `AskUserQuestion`), and spawn the `uxui` sub-agent; it reads `spec.md` and writes `.workflow/<id>/uxui-plan.md` — the Scenes, ASCII wireframes, Scenarios, UX direction & components, and the AC↔scene mapping. No UI code is written here (that's `frontend-design` / the engineer in `/dev`); `qa > Visual verification` later checks the rendered result against this plan.

> **Spawn `uxui` by name** (`Agent({ subagent_type: "uxui" })`); never `general-purpose`/`orchestrator` — the spawn guard blocks both (`orchestrator.md > Rules`).

## What to do

1. **Resolve the run** — shared selection in [`.claude/orchestrator/references/resolve-run.md`](../orchestrator/references/resolve-run.md). Delta: **new intent + no run** → prefer `/spec <intent>` first (AC↔scene needs a spec); if the user wants UX *before* a spec, create a lightweight run (mirror orchestrator `On invocation > Fresh run` — don't re-derive the bookkeeping) and design UX-from-intent — `uxui` marks requirement gaps `[NEEDS CLARIFICATION]`.

2. **UI gate.** Confirm the run actually has a rendered surface. If `spec.md` (or the intent) describes a pure API / CLI / backend change with no UI, say so and stop — there's nothing to design. Borderline? Ask the user once.

3. **Clarify any open UX-direction decision** (target devices/breakpoints, visual style or a design system to match, a reference to model after) before spawning `uxui` — grill via [`brainstorming/references/interview-tactics.md`](../skills/brainstorming/references/interview-tactics.md) (+ [`visual-companion.md`](../skills/brainstorming/references/visual-companion.md) for visual Qs) when open, scoped by [`references/interview.md > Team-slice clarify`](../orchestrator/references/interview.md). Don't re-ask what the spec settles; requirement-level gaps (what screens exist, what an AC means) stay `[NEEDS CLARIFICATION]` for `uxui` (step 5), not asked here.

4. **Spawn `uxui`.** `Agent({ subagent_type: "uxui" })` with the run id, type, `repo_root` / `branch`, the intent, the gathered UX direction, **`context.md` when `state.json > context_built`** (the shared brownfield-M/L map — `uxui` reads its `## UI surface` for the existing design system / components / routes instead of re-grepping), and any `References / examples to follow` (URLs inlined). Point it at `spec.md` as authoritative; don't re-list the ACs inline. `uxui` reads the spec + the existing design system, drives `ui-ux-pro-max` / `frontend-design` for direction, and writes `uxui-plan.md`.

5. **Plan check.** Confirm `uxui-plan.md` exists, every Scene has at least one ASCII wireframe, every `spec.md` AC with a UI surface has a mapping row, and there are no orphan scenes/scenarios (a scene satisfying no AC is scope creep; an unmapped AC is a design gap). If `uxui` flagged orphan scenes as scope-creep candidates, route them to the user (fold into `spec.md > Scope — Out` via `/spec <id>`, or accept). **Don't carry clarifications to the gate:** an inferred default (colour/copy/spacing) → decided **assumption** in `uxui-plan.md` (gate's `Assumptions` line surfaces it), not `[NEEDS CLARIFICATION]`; a real **requirement gap** (AC meaning, undefined reachable state) → `/spec <id>` **now**, so the shard lands clarification-free.

6. **Write your shard and stop.** Write `state.uxui.json` per [`.claude/orchestrator/references/team-mode-sharding.md`](../orchestrator/references/team-mode-sharding.md) — set `ac_covered` to the AC numbers with a mapped Scene (the gate set-compares it). Leave `state.json`/`INDEX.md` untouched (the resume cursor never moves for UX). Tell the user the path + that `frontend-design` (or `/dev --resume <id>`) builds from this plan and `qa` visual-verifies against it.

Reference: [`.claude/agents/uxui.md`](../agents/uxui.md), [`.workflow/_templates/uxui-plan.md`](../../.workflow/_templates/uxui-plan.md), and the `ui-ux-pro-max` / `frontend-design` skills for direction.
