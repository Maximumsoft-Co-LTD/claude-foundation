# Orchestrator reference — Gate (step 9)

> Loaded on demand by the main agent (`.claude/orchestrator.md`). The gate's decision flow stays inline in step 9; this holds the summary contents + option-routing detail. Read it at the gate or when handling a gate option.

The gate is **non-negotiable** and never shrinks at any size. It is a **loop** until `approve`; free-form input = `revise` for **this** run (never a fresh Phase 1).

### Summary contents (print a tight block)

- Spec goal + Type + `Ship as`. **The acceptance criteria as the contract** — every AC (with `e.g.:`, `on error/at boundary:`, `measured:`), *"done when each is true — confirm each line, or correct it."* Per-line confirmation is the only user-validated link in spec→plan→code.
- **`Assumptions (inferred — correct any wrong)`** (step-6 list; omit if empty). Constraints/stack. **`Hard-to-reverse decisions`** (from `plan.md`, one line each, *"expensive to undo — confirm each"*). Plan outline + risks + rollback. **Scaffold (M/L)** when present.
- **Test plan (feat/fix/refactor)** — Coverage plan + edge cases + out-of-scope; surface a veto line for any new test runner. **E2E+visual** — one line, default `off`; `e2e on` to add.
- **Per-task phase plan** from `plan.md > Phases for this task` (e.g. `"Will run: …. Skipping: 6 (no sensitive paths)."`; name 7½ when it runs; Review is a default skip for chore/docs at XS). **`Phase deviations (confirm each)`** — each `(deviates from matrix)` row; does NOT ride a plain `approve`; a `7 Test` skip on feat/fix/refactor is highest-stakes (waives the regression/baseline contract). **Fanout plan** one line (`fanout <phase> on|off`); it's a prediction. Open follow-ups flagged as candidates.

### Options (`AskUserQuestion`)

`approve` | `skip <n>` | `run <n>` | `fanout <phase> on|off` | `e2e on|off` | `revise <notes>` | (epic) `swap <n>`.

- `revise` → **targeted incremental edit, never full regeneration.** Plan-only → `lead` plan-revise (`.claude/agents/references/lead.md > Revise variant`), edits only affected sections. Requirements → `pm` spec-patch mode (edit affected sections; re-interview only if a new slot opened), then `lead` plan-revise + (feat/fix/refactor) `qa` test-plan-revise if an AC moved or a gap resolved. Test-plan-only → `qa` test-plan-revise. Re-present only changed parts; loop until `approve`.
- `skip <n>`/`run <n>` → discretionary only (5 Review / 7 Test / 7½ Improve / 8 Docs); refuse protected (1/2/3/6/10) or non-discretionary (4/9). Edit `plan.md` row + `state.json > phase_plan.<…>`. `skip 7` on feat/fix/refactor needs explicit waiver of the regression/baseline contract.
- `fanout <phase> on|off` → flip `plan.md > Fanout plan` + `state.json > fanout_plan.<phase>`; can't defeat hard guardrails (non-independent work; size-tier — `fanout review on` on XS/S → `SIZE_UPGRADE` prompt). Log if blocked. `e2e on|off` → set `state.json > e2e_visual`. `swap` → `lead` opens the chosen slice.
- `approve` → INDEX → `approved`. Record final `phase_plan`/`fanout_plan`/`e2e_visual` (resolve null `e2e_visual` → `off`). **Don't accept `approve` while a `(deviates)` row is unconfirmed.** State: `step=gate, next_step=implement`.
