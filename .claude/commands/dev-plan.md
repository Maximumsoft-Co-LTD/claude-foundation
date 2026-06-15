---
description: Team mode — lead writes plan.md only (the /dev implementation plan). Runs plan-prep, the lead agent plans against an existing spec, and stops (no gate, no implement).
argument-hint: [<run-id>] (defaults to the most recent run)
---

Write the implementation plan for: **$ARGUMENTS**

This is the **planning slice of `/dev`, run on its own** — the `lead` agent turns an approved-enough `spec.md` into `plan.md` (the step-by-step build plan, sized, with the architecture diagram, current-state mapping, risks, and rollback). You — the main agent — play the orchestrator (plan-prep fanout, the plan check, single-writer `state.json`); `lead` writes the file. You stop after the plan check — the gate, test plan, UX, and implementation are separate commands.

> **Spawn the `lead` worker by name** — `Agent({ subagent_type: "lead", ... })`. Do **not** use `subagent_type: "general-purpose"` or `"orchestrator"` (the spawn guard blocks both). There is no `orchestrator` sub-agent; *you* play that role here.

## What to do

1. **Read [`.claude/orchestrator.md`](../orchestrator.md)** — section **`Phase 1 — Requirements` step 8 (Plan)** plus **`State discipline`** and the **`Fanout dispatch`** section. Those are the source of truth for plan-prep fanout, the `lead` plan-mode spawn contract (including the model override), the plan check, and bookkeeping. Follow them as written, with the deltas below.

2. **Resolve the run.**
   - **`$ARGUMENTS` names a run** (a `NNNN-…` id or a path under `.workflow/`) → use it.
   - **`$ARGUMENTS` is empty** → pick the most-recently-updated run under `.workflow/` (by `state.json > last_updated`, excluding `_templates`). Ask via `AskUserQuestion` if more than one is plausibly active.
   - **No run / no `spec.md`** → the plan is written against a spec, so point the user at `/spec <intent>` first and offer to start one. Don't plan without a spec.
   - **Spec not ready** → if `spec.md` still carries `[NEEDS CLARIFICATION]` markers, surface them and stop — resolve them via `/spec <id>` (spec-patch) before planning over an ambiguous contract.

3. **Plan-prep fanout (push-based, when it pays).** Per orchestrator step 8: when `repo_root` is set AND `spec.md > Constraints > Integration points` names **≥ 2** points in existing code (or one large/unfamiliar one), dispatch **one `team-codebase-explorer` per integration point in a single message** to map current state, and **one `team-best-practice-researcher`** only if `spec.md` flags an unfamiliar framework/API/security choice. Skip the prep entirely for XS/S, pure-greenfield, or a single simple integration point. Save the findings + `Dispatched-as:` map for the `lead` prompt.

4. **Spawn `lead` in plan mode.** Pass the run id, the `Type`, the recorded `size` (read `state.json`; if absent, let `lead` derive it), `repo_root`/`branch`, and the explorer findings + `Dispatched-as:` map. Point `lead` at `spec.md` as authoritative; don't re-list the ACs inline. **Model override (per step 8):** spawn with `model: sonnet` by default; **keep opus** (omit the override) when `spec.md` signals L-tier complexity — cross-subsystem change, schema migration, public API / event-contract change, or any breaking change. `lead` writes `plan.md` (or `epic.md` if the scope check splits the work). If `lead` returns `FANOUT_REQUESTED: plan:<point-list>`, follow `Fanout dispatch` — dispatch explorers/researchers for the residual points, then re-spawn `lead` for synthesis.

5. **Plan check.** Read `plan.md` (or `epic.md`). Confirm a `Steps` section with ≥ 1 step (an epic: ≥ 1 slice), and no `[NEEDS CLARIFICATION]` markers remain. Re-spawn `lead` plan mode **once** with the issue noted if either check fails; escalate to the user if it still fails.

6. **Write `state.json` and stop.** Per `State discipline`, write the complete `state.json`: `step=plan`, `next_step=test-plan` for feat/fix/refactor (else `gate`), `last_agent=lead`, fresh `last_updated`. Set `INDEX.md` status → `planned` (or `epic`). **Do not run the gate or implement.** End by telling the user the run id and the next moves: `/test-plan <id>` (test strategy), `/uxui-plan <id>` (UX, if it has a UI), then `/implement <id>` (or `/dev --resume <id>`) to gate → implement → ship.

Reference: [`.claude/orchestrator.md`](../orchestrator.md) (step 8 + Fanout dispatch + State discipline), [`.claude/agents/lead.md`](../agents/lead.md) (`Mode A` plan), [`.claude/skills/plan-writing/SKILL.md`](../skills/plan-writing/SKILL.md), [`.workflow/_templates/plan.md`](../../.workflow/_templates/plan.md).
