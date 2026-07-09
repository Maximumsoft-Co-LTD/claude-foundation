---
description: Team mode — QA writes test-plan.md only. The qa agent designs the test strategy (coverage per AC, edge cases, fixtures, regression/baseline contract) for an existing run, before any code.
argument-hint: [<run-id>] (defaults to the most recent run)
---

Write the test plan for: **$ARGUMENTS**

This is the **QA test-strategy slice of `/dev`, run on its own** — design-time, before code. You — the main agent — resolve the run and spawn the `qa` sub-agent in **test-plan mode**; `qa` reads `spec.md` + `plan.md` + `tasks.md` and writes `.workflow/<id>/test-plan.md`. No code is written or run here (that's `/dev`'s test phase, or `qa` execute mode).

> **Spawn `qa` by name** (`Agent({ subagent_type: "qa" })`); never `general-purpose`/`orchestrator` — the spawn guard blocks both (`orchestrator.md > Rules`).

## What to do

1. **Resolve the run** — shared selection in [`.claude/orchestrator/references/resolve-run.md`](../orchestrator/references/resolve-run.md). Delta: **no run** → route to `/spec <intent>` first (the test plan is designed against a spec).

2. **Pre-flight the inputs.**
   - **No `spec.md`** in the run → stop and point at `/spec` — the coverage plan maps every spec AC, so there's nothing to plan against without one.
   - **No `plan.md`** → **proceed spec-only, no go-ahead needed** (the designed parallel path — `/test-plan` alongside `/dev-plan`). `qa` maps every AC from the spec and marks plan-derived rows (edge cases off Files-touched, fixtures, regression/baseline path) `[pending plan]`; the **gate backfills** them once `plan.md` exists (`orchestrator.md` step 9). Tell the user it's spec-only, completed at the gate. (`plan.md` present → full mode.)
   - **Type check** — read `state.json > type` (or `spec.md` frontmatter). Only `feat` / `fix` / `refactor` get a test plan. For `chore` / `docs` / `spike`, say so and stop (their test phase is skipped/absent) — don't write a stub.

3. **Clarify any open test-level decision** (levels/fixtures/env/`e2e_visual`) before spawning `qa` — [`references/interview.md > Team-slice clarify`](../orchestrator/references/interview.md). Don't re-ask what `spec.md` / `plan.md` settle; a reachable security/data gap → `/spec <id>` (= a `qa` `BLOCKER:`, step 4).

4. **Spawn `qa` in test-plan mode** (`qa.md > Mode: Test plan`). **Make `team-slice: test-plan` the first line of the spawn prompt** — it tags this as a parallel-safe Phase-1 shard producer so the state hooks scope correctly (`orchestrator.md > State discipline > Team-mode Phase-1 sharding`). When step 2 found **no `plan.md`**, add **`spec-only`** to the prompt so `qa` defers plan-derived rows as `[pending plan]`. Pass the run id, the `Type`, `repo_root` / `branch`, any step-3 answers, **`context.md` when `state.json > context_built`** (the shared brownfield-M/L map — `qa` reads its `## Test infra` + invariants for the Baseline/Regression contract instead of re-reading touched code), and **`e2e_visual`** (read `state.json > e2e_visual`, else `spec.md` frontmatter `E2E + visual`; treat unset as `off` — browser-based e2e/visual is opt-in; step-3 opt-in → pass `on`) from `state.json`. Point it at `spec.md` (+ `plan.md` + `tasks.md` when present) as authoritative; don't re-list the ACs inline. `qa` writes `test-plan.md` per its `Mode: Test plan` contract (Coverage / Edge cases / Fixtures / type-specialised Regression / Baseline, + e2e & Visual rows only when `e2e_visual=on`) and returns its summary.
   - If `qa` returns a `BLOCKER:` first line (a reachable security / data-integrity path the spec leaves undefined), surface it to the user via `AskUserQuestion` and route the answer back to the spec (`/spec <id>` → spec-patch) before the plan is final — don't ship a test plan over an undefined hole.

5. **Test-plan check.** Confirm `test-plan.md` exists and has a Coverage-plan row for every `spec.md` acceptance scenario (including each AC's boundary/error scenario and any `measured:` target). Re-spawn `qa` once if an AC is unmapped. (Spec-only: `[pending plan]` rows are expected, not a failure — backfilled at the gate.)

6. **Write your shard and stop.** Write `state.test-plan.json` per [`.claude/orchestrator/references/team-mode-sharding.md`](../orchestrator/references/team-mode-sharding.md) — set `ac_covered` to the AC numbers with a Coverage-plan row (include the spec-only rows already written); a **spec-only** run adds `"pending_plan_backfill":true`. Leave `state.json`/`INDEX.md` untouched (the gate folds shards). Tell the user the path + that `/implement <id>` (or `/dev --resume <id>`) carries the run through the gate (which **backfills** `[pending plan]` rows once `plan.md` exists) → implement → the test phase that **executes** this plan.

Reference: [`.claude/agents/qa.md`](../agents/qa.md) (`Mode: Test plan`), [`.claude/orchestrator.md`](../orchestrator.md) (step 8a + State discipline), [`.workflow/_templates/test-plan.md`](../../.workflow/_templates/test-plan.md).
