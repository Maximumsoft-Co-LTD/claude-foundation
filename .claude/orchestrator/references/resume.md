# Orchestrator reference — Resume

> Loaded on demand by the main agent (`.claude/orchestrator.md`). Open this only when invoked as `/dev --resume <id>`. A fresh run never needs it.

### Resume (`/dev --resume <id>`)

1. Read `.workflow/<id>/state.json`.
2. If `repo_root` is set: run `git -C <repo_root> checkout <branch>`. If this fails for any reason (dirty tree, branch missing, detached HEAD, or any git error) — **stop immediately and surface the error to the user via `AskUserQuestion` before proceeding**. Never continue a resume on an incorrect or unverified branch.
3. Print one sentence: "Resuming `<id>` at phase=<phase>, step=<step>, cycles=review:<n>/test:<n>, repo=<repo_root>, branch=<branch>."
4. Jump to the matching step. Don't replay completed steps. **Team-built run reconciliation:** if `.workflow/<id>/` holds Phase-1 shards (`state.plan.json`/`state.test-plan.json`/`state.uxui.json`), Phase 1 advanced the shards, not the cursor — a stale `spec`/`plan` `step` doesn't mean that work is undone. Route to the **gate (step 9)** (it folds the shards), don't replay a `plan`/`test-plan` step whose artifact exists. `step=test-plan` → **step 8a** (re-run the check, then gate). `step=revise-spec`/`revise-plan`/`revise-test-plan` → the **gate (step 9)** (re-present the in-progress artifact). **When `step=implement`, read step 10's `Resume guard` BEFORE the "Spawn `engineer`" heading** — a mid-fanout resume (non-empty `impl_phases_done`) routes to the Integration variant. Missing/malformed `state.json` → ask (`AskUserQuestion`) whether to start fresh.
5. **Legacy/missing `size` → treat as M/L (full machinery).** Never infer a fast path on resume — `null` `size` runs every remaining step full M/L. Backfill `size` only from an existing `plan.md > Size`; else leave null and stay full. **Missing `field` goes the *other* way — leave it null** (the step-13½ guard reads null as not-brownfield, skips improve — adding a phase to an in-flight run is the unsafe direction). Backfill `field` only from an existing `plan.md > Field`.
