# Orchestrator reference — Gate

> Loaded on demand by the main agent (`.claude/orchestrator.md`). The gate's decision flow stays inline in the Gate step; this holds the summary contents + option-routing detail. Read it at the gate or when handling a gate option.

The gate is **non-negotiable** and never shrinks at any size. It is a **loop** until `approve`; free-form input = `revise` for **this** run (never a fresh Phase 1).

### Summary contents (print a tight block)

- Spec goal + Type + `Ship as`. **Ship disposition** — `commit on ship` asked every run, default `no` (off → ready-to-run commit command, no PR); PR only when commit=yes (its spec default). **The acceptance scenarios as the contract** — every scenario (Given/When/Then `AC#`, with its boundary/error scenario + any `measured:`), grouped under its User Story by priority, *"done when each is true — confirm each line, or correct it."* Per-line confirmation is the only user-validated link in spec→plan→code.
- **`Assumptions (inferred — correct any wrong)`** (Interview list; omit if empty). Constraints/stack. **`Hard-to-reverse decisions`** (from `plan.md` — **reuse the copy already read for the consistency scan / backfill; don't re-read it for the summary**, one line each, *"expensive to undo — confirm each"*). Plan outline + risks + rollback. **Scaffold (M/L)** when present.
- **Test plan (feat/fix/refactor)** — Coverage plan + edge cases + out-of-scope; surface a veto line for any new test runner. **E2E+visual** — one line, default `off`; `e2e on` to add.
- **Per-task phase plan** from `plan.md > Phases for this task` (e.g. `"Will run: …. Skipping: 7 (no sensitive paths)."`; Review is a default skip for chore/docs at XS). **`Phase deviations (confirm each)`** — each `(deviates from matrix)` row; does NOT ride a plain `approve`; a `Test` skip on feat/fix/refactor is highest-stakes (waives the regression/baseline contract). **Fanout plan** one line (`fanout <phase> on|off`); it's a prediction. Open follow-ups flagged as candidates.

### Options (`AskUserQuestion`)

`approve` | `skip <n>` | `run <n>` | `commit on|off` | `fanout <phase> on|off` | `e2e on|off` | `revise <notes>` | (epic) `swap <n>`.

- `revise` → **targeted incremental edit, never full regeneration.** Plan-only → `lead` plan-revise (`.claude/agents/references/lead.md > Revise variant`), edits only affected sections. Requirements → `pm` spec-patch mode (edit affected sections; re-interview only if a new slot opened), then `lead` plan-revise + (feat/fix/refactor) `qa` test-plan-revise if an AC moved or a gap resolved. Test-plan-only → `qa` test-plan-revise. Re-present only changed parts; loop until `approve`.
- `skip <n>`/`run <n>` → discretionary only (Test / Review / Docs); refuse protected (Interview+Spec / Plan / Gate / Security / Retro) or non-discretionary (Implement / Ship). Edit `plan.md` row + `state.json > phase_plan.<…>`. `skip 5` on feat/fix/refactor needs explicit waiver of the regression/baseline contract.
- `commit on|off` → set `state.json > commit_on_ship`. **Asked every run** (gate-entry batch, No leads/`(Recommended)`); default `off` → no commit/push/PR + ready-to-run command, forces `open_pr_on_ship=no`. `on` → ship commits; resolve a blank `open_pr_on_ship` here (ask once).
- `fanout <phase> on|off` → flip `plan.md > Fanout plan` + `state.json > fanout_plan.<phase>`; can't defeat hard guardrails (non-independent work; size-tier — `fanout review on` on XS/S → `SIZE_UPGRADE` prompt). Log if blocked. `e2e on|off` → set `state.json > e2e_visual`. `swap` → `lead` opens the chosen slice.
- `approve` → INDEX → `approved`. Record final `phase_plan`/`fanout_plan`/`e2e_visual`/`commit_on_ship`/`open_pr_on_ship` (resolve null `e2e_visual` → `off`, null `commit_on_ship` → `no`). **Don't accept `approve` while a `(deviates)` row is unconfirmed.** State: `step=gate, next_step=implement`.
