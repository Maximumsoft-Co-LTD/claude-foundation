---
description: Team mode — lead writes plan.md + tasks.md (the /dev design plan + task breakdown). Runs plan-prep, the lead agent plans against an existing spec, and stops (no gate, no implement).
argument-hint: [<run-id>] (defaults to the most recent run)
---

Write the implementation plan for: **$ARGUMENTS**

This is the **planning slice of `/dev`, run on its own** — the `lead` agent turns an approved-enough `spec.md` into `plan.md` (the design plan — sized, with the architecture diagram, current-state mapping, risks, rollback) **plus `tasks.md`** (the dependency-ordered `T###` task breakdown). You — the main agent — play the orchestrator (plan-prep fanout, the plan check, single-writer `state.json`); `lead` writes the files. You stop after the plan check — the gate, test plan, UX, and implementation are separate commands.

> **Spawn `lead` by name** (`Agent({ subagent_type: "lead" })`); never `general-purpose`/`orchestrator` — the spawn guard blocks both (`orchestrator.md > Rules`). *You* are the orchestrator.

## What to do

1. **Read [`.claude/orchestrator.md`](../orchestrator.md)** — section **`Phase 1 — Requirements` step 8 (Plan)** plus **`State discipline`** and the **`Fanout dispatch`** section. Those are the source of truth for plan-prep fanout, the `lead` plan-mode spawn contract (including the model override), the plan check, and bookkeeping. Follow them as written, with the deltas below.

2. **Resolve the run** — shared selection in [`.claude/orchestrator/references/resolve-run.md`](../orchestrator/references/resolve-run.md). Deltas: **no run / no `spec.md`** → point the user at `/spec <intent>` first (no plan without a spec); **`spec.md` carries `[NEEDS CLARIFICATION]`** → surface + stop, resolve via `/spec <id>` (spec-patch) before planning over an ambiguous contract.

3. **Plan-prep fanout (push-based, when it pays).** Per orchestrator step 8: when `repo_root` is set AND `spec.md > Constraints > Integration points` names **≥ 2** points **in disjoint surfaces** (separate modules/folders/repos — not raw point count) in existing code (or one large/unfamiliar one), dispatch **one `team-codebase-explorer` per integration point in a single message** to map current state, and **one `team-best-practice-researcher`** only if `spec.md` flags an unfamiliar framework/API/security choice. Skip the prep entirely for XS/S, pure-greenfield, or a single simple integration point. Save the findings + `Dispatched-as:` map for the `lead` prompt.

4. **Clarify any open plan-level decision** (approach/tech/placement/rollback) before spawning `lead` — [`references/interview.md > Team-slice clarify`](../orchestrator/references/interview.md). Don't re-ask what `spec.md` / step-3 prep settle; contract gaps → `/spec <id>` per step 2.

5. **Spawn `lead` in plan mode.** **Make `team-slice: plan` the first line of the spawn prompt** — it tags this as a parallel-safe Phase-1 shard producer so the state hooks scope correctly (`orchestrator.md > State discipline > Team-mode Phase-1 sharding`). Pass the run id, the `Type`, the recorded `size` (read `state.json`; if absent, let `lead` derive it), `repo_root`/`branch`, the explorer findings + `Dispatched-as:` map, and any plan answers gathered in step 4. Point `lead` at `spec.md` as authoritative; don't re-list the ACs inline. **Model override (per step 8):** spawn with `model: sonnet` by default; **keep opus** (omit the override) when `spec.md` signals L-tier complexity — cross-subsystem change, schema migration, public API / event-contract change, or any breaking change. `lead` writes `plan.md` + `tasks.md` (or `epic.md` if the scope check splits the work). If `lead` returns `FANOUT_REQUESTED: plan:<point-list>`, follow `Fanout dispatch` — dispatch explorers/researchers for the residual points, then re-spawn `lead` for synthesis.

6. **Plan check.** Read `plan.md` + `tasks.md` (or `epic.md`). Confirm `tasks.md` has ≥ 1 `T###` task with an `[AC#]` tag + `verify:` (an epic: ≥ 1 slice), `plan.md` has a `## Phases for this task` block (matrix-default one-liner or deviation table — epics may omit it), and no `[NEEDS CLARIFICATION]` markers remain. Re-spawn `lead` plan mode **once** with the issue noted if any check fails; escalate to the user if it still fails.

7. **Write your shard and stop.** Write `state.plan.json` per [`.claude/orchestrator/references/team-mode-sharding.md`](../orchestrator/references/team-mode-sharding.md) — `next_step` = `test-plan` (feat/fix/refactor) else `gate`, and set `ac_covered` = the AC numbers tagged in `tasks.md` + `ac_total` = the AC count in `spec.md` (the gate set-compares these; a complete map lets the gate skip the artifact re-read); an epic scope-split writes the `epic:true` shard instead (tell the user — epic supersedes the parallel-slice flow). Leave `state.json`/`INDEX.md` untouched (the gate folds the shard). **Don't run the gate or implement.** Tell the user the run id + next moves: `/test-plan <id>`, `/uxui-plan <id>` (if UI), then `/implement <id>` (or `/dev --resume <id>`).

Reference: [`.claude/orchestrator.md`](../orchestrator.md) (step 8 + Fanout dispatch + State discipline), [`.claude/agents/lead.md`](../agents/lead.md) (`Mode A` plan), [`.claude/skills/plan-writing/SKILL.md`](../skills/plan-writing/SKILL.md), [`.workflow/_templates/plan.md`](../../.workflow/_templates/plan.md), [`.workflow/_templates/tasks.md`](../../.workflow/_templates/tasks.md).
