---
description: Team mode — UX/UI designer writes uxui-plan.md only. The uxui agent designs the Scenes (screens/states), Scenarios (user flows), UX direction, and AC↔scene mapping for a UI-bearing change, before the frontend is built.
argument-hint: [<run-id>] | <intent>
---

Write the UX/UI plan for: **$ARGUMENTS**

This is the **UX/UI slice of team mode** — design-time, before the frontend is built. You — the main agent — resolve the run, gather any missing UX direction (sub-agents can't call `AskUserQuestion`), and spawn the `uxui` sub-agent; it reads `spec.md` and writes `.workflow/<id>/uxui-plan.md` — the Scenes, Scenarios, UX direction & components, and the AC↔scene mapping. No UI code is written here (that's `frontend-design` / the engineer in `/dev`); `qa > Visual verification` later checks the rendered result against this plan.

> **Spawn the `uxui` worker by name** — `Agent({ subagent_type: "uxui", ... })`. Do **not** use `subagent_type: "general-purpose"` (use the named agent — `.claude/agents/uxui.md`).

## What to do

1. **Resolve the run.**
   - **`$ARGUMENTS` names a run** (a `NNNN-…` id or a path under `.workflow/`) → use it.
   - **`$ARGUMENTS` is empty** → pick the most-recently-updated run under `.workflow/` (by `state.json > last_updated`, excluding `_templates`). Ask via `AskUserQuestion` if more than one is plausibly active.
   - **`$ARGUMENTS` is a new intent and no run exists** → prefer running `/spec <intent>` first (the AC↔scene mapping needs a spec) and say so. If the user wants UX direction *before* a spec, you may create a lightweight run folder (mirror orchestrator `On invocation > Fresh run` setup: pick `NNNN-<type>-<slug>`, create `.workflow/<id>/`, copy `state.json`, append the `INDEX.md` row) and proceed UX-from-intent — `uxui` will write the plan from the intent and mark requirement gaps as `[NEEDS CLARIFICATION]`.

2. **UI gate.** Confirm the run actually has a rendered surface. If `spec.md` (or the intent) describes a pure API / CLI / backend change with no UI, say so and stop — there's nothing to design. Borderline? Ask the user once.

3. **Gather missing UX direction (only what's unspecified).** Sub-agents can't interview, so you collect any UX input the spec and prior conversation leave genuinely open — and only that. If the spec already carries `References / examples to follow`, a design system, or a stated style/audience/devices, don't re-ask. Otherwise a single small `AskUserQuestion` batch (≤ 3) on the open ones: target devices/breakpoints, visual style or an existing design system to match, any reference to model after. **Fetch + inline any external-URL reference** (the `uxui` agent has no web access) so it reaches the agent self-contained.

4. **Spawn `uxui`.** `Agent({ subagent_type: "uxui" })` with the run id, type, `repo_root` / `branch`, the intent, the gathered UX direction, and any `References / examples to follow` (URLs inlined). Point it at `spec.md` as authoritative; don't re-list the ACs inline. `uxui` reads the spec + the existing design system, drives `ui-ux-pro-max` / `frontend-design` for direction, and writes `uxui-plan.md`.

5. **Plan check.** Confirm `uxui-plan.md` exists, every `spec.md` AC with a UI surface has a mapping row, and there are no orphan scenes/scenarios (a scene satisfying no AC is scope creep; an unmapped AC is a design gap). If `uxui` flagged orphan scenes as scope-creep candidates, route them to the user (fold into `spec.md > Scope — Out` via `/spec <id>`, or accept). Resolve or surface any `[NEEDS CLARIFICATION]`.

6. **Write `state.json` and stop.** Update the complete `state.json`: bump `last_updated`, set `last_agent=uxui`, and add a `notes` entry that `uxui-plan.md` was written. **Leave `step` / `next_step` as they were** — the UX plan is a team-mode artifact, not a `/dev` state-machine step, so don't move the resume cursor. Tell the user the path and that `frontend-design` (or `/dev --resume <id>`) builds from this plan and `qa`'s visual verification checks against it.

Reference: [`.claude/agents/uxui.md`](../agents/uxui.md), [`.workflow/_templates/uxui-plan.md`](../../.workflow/_templates/uxui-plan.md), and the `ui-ux-pro-max` / `frontend-design` skills for direction.
