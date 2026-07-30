---
description: Team mode — lead writes plan.md + tasks.md (the /dev design plan + task breakdown). Runs plan-prep, the lead agent plans against an existing spec, and stops (no gate, no implement).
argument-hint: [<run-id>] (defaults to the most recent run)
---

Write the implementation plan for: **$ARGUMENTS**

This is the **planning slice of `/dev`, run on its own** — the `lead` agent turns an approved-enough `spec.md` into `plan.md` (the design plan — sized, with the architecture diagram, current-state mapping, risks, rollback) **plus `tasks.md`** (the dependency-ordered `T###` task breakdown). You — the main agent — play the orchestrator (plan-prep fanout, the plan check, single-writer `state.json`); `lead` writes the files. You stop after the plan check — the gate, test plan, UX, and implementation are separate commands.

> **Spawn `lead` by name** (`Agent({ subagent_type: "lead" })`); never `general-purpose`/`orchestrator` — the spawn guard blocks both (`orchestrator.md > Rules`). *You* are the orchestrator.

## What to do

1. **Read [`.claude/orchestrator.md`](../orchestrator.md)** — section **`Phase 1 — Requirements`** (**Plan**) plus **`State discipline`** and the **`Fanout dispatch`** section. Those are the source of truth for plan-prep fanout, the `lead` plan-mode spawn contract (including the model override), the plan check, and bookkeeping. Follow them as written, with the deltas below.

2. **Resolve the run** — shared selection in [`.claude/orchestrator/references/resolve-run.md`](../orchestrator/references/resolve-run.md). Deltas: **no run / no `spec.md`** → point the user at `/spec <intent>` first (no plan without a spec); **`spec.md` carries `[NEEDS CLARIFICATION]`** → surface + stop, resolve via `/spec <id>` (spec-patch) before planning over an ambiguous contract.

3. **Plan-prep fanout (push-based, when it pays).** **`context_built` (shared `context.md` from `/spec`, brownfield M/L) → skip plan-prep; pass `context.md` to `lead`** (it reads it as the Current state map + LSP-verifies deltas; may still direct-nest a `team-best-practice-researcher` itself for residual best-practice research). Otherwise run plan-prep per orchestrator's **Plan** step / `Fanout dispatch` (≥ 2 disjoint-surface integration points in existing code → one `team-codebase-explorer` each, + a `team-best-practice-researcher` for an unfamiliar framework/API/security choice; skip for XS/S / pure-greenfield / a single simple point). Save the findings + `Dispatched-as:` map for the `lead` prompt.

4. **Clarify any open plan-level decision** (approach/tech/placement/rollback) before spawning `lead` — grill via [`brainstorming/references/interview-tactics.md`](../skills/brainstorming/references/interview-tactics.md) when open, scoped by [`references/interview.md > Team-slice clarify`](../orchestrator/references/interview.md). Don't re-ask what `spec.md` / step-3 prep settle; contract gaps → `/spec <id>` per step 2.

5. **Spawn `lead` in plan mode.** **Make `team-slice: plan` the first line of the spawn prompt** — it tags this as a parallel-safe Phase-1 shard producer so the state hooks scope correctly (`orchestrator.md > State discipline > Team-mode Phase-1 sharding`). Pass the run id, the `Type`, the recorded `size` (read `state.json`; if absent, let `lead` derive it), `repo_root`/`branch`, **`context.md` when `context_built`** (else the explorer findings + `Dispatched-as:` map), and any plan answers gathered in step 4. Point `lead` at `spec.md` as authoritative; don't re-list the ACs inline. **Model:** omit the override for the Sonnet default; pass `model="opus"` explicitly only for the high-stakes planning triggers in `model-tiers.md`. `lead` writes `plan.md` + `tasks.md` (or `epic.md` if the scope check splits the work). `lead` direct-nests any residual explorer/research points itself — no signal to dispatch.

6. **Plan check.** Run `sh .claude/hooks/artifact-lint.sh .workflow/<id>/` for slice-local structure, then do one semantic check for architecture/guardrail contradictions. Fail → patch the named row or re-spawn once only for a real context gap.

7. **Write your shard and stop.** Write `state.plan.json` per [`.claude/orchestrator/references/team-mode-sharding.md`](../orchestrator/references/team-mode-sharding.md) — `next_step` = `test-plan` (feat/fix/refactor) else `gate`, and set `ac_covered`/`ac_total` as progress telemetry; Contract Gate later derives exact sets from artifacts. An epic writes the `epic:true` shard. Leave `state.json`/`INDEX.md` untouched. Tell the user the next commands.

Reference: [`.claude/orchestrator.md`](../orchestrator.md) (Plan + Fanout dispatch + State discipline), [`.claude/agents/lead.md`](../agents/lead.md) (`Mode A` plan; it loads `plan-writing` itself), [`.workflow/_templates/plan.md`](../../.workflow/_templates/plan.md), [`.workflow/_templates/tasks.md`](../../.workflow/_templates/tasks.md).
