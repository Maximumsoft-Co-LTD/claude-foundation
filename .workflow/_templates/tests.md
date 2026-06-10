# Tests: <title>

**Plan**: [./plan.md](./plan.md)
**Status**: pending | passing | failing | skipped
**Cycle**: 1 of max 3

## Type-aware mode
Pick one. Fill the rest of the doc only for the active mode (full fill rules live in qa.md).

- [ ] **Full** (type = feat / refactor)
- [ ] **Fix** (type = fix — regression test mandatory)
- [ ] **Skipped** (type = chore / docs / spike) — write the reason under Skipped, leave the rest blank.

<!--
Type-aware mode is the only always-required section. Add ONLY the sections your mode needs, then DELETE the rest:
- Coverage plan — Full/Fix (Unit / Integration / E2E)
- Regression test — REQUIRED for Fix (Path · reproduces spec.md > Reproduction? · pre-fix verification: how QA confirmed it fails on the old code, e.g. `git stash && test` → ❌ / pop → ✅)
- Acceptance-criteria coverage — Full/Fix (table mapping every spec.md AC → ≥1 test; justify any untestable criterion + tag it for retro)
- Edge-case gaps — Full/Fix (reachable inputs the spec leaves undefined: input · why reachable · open question · blocking? — findings, not test rows; omit if none)
- Results — Full/Fix (table: Suite | Run | Pass | Fail | Notes)
- Failing — when any suite fails (`path:line` — symptom + root cause + fix attempt)
- Commands — Full/Fix (fenced bash block: how to re-run locally)
- Skipped — REQUIRED when mode = Skipped (Reason: chore|docs|spike + why no tests apply · Risk accepted: one line)
-->
