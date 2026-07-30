# Tests: <title>

**Test plan**: [./test-plan.md](./test-plan.md)
**Plan**: [./plan.md](./plan.md)
**Status**: pending | impacted-passing | passing | failing | skipped
**Cycle**: 1 of max 3

The authoritative acceptance record: Test maps every AC to executable evidence and runs Impacted; the Ship Gate later changes `impacted-passing` to `passing` after one final Full-suite + lint/type/static run. (chore / docs / spike have no test plan — fill only Skipped.)

## Type-aware mode *(required)*

- [ ] **Full** (feat / refactor)
- [ ] **Fix** (fix — regression test mandatory)
- [ ] **Skipped** (chore / docs) — reason under Skipped, leave the rest blank

---

**Sections by mode** — fill only the active mode's, delete the rest:

Acceptance-criteria coverage · Regression test (fix) · Baseline (refactor / brownfield feat) · Edge-case gaps · Results · Coverage (diff vs floor) · Failing · Commands (Impacted + Full-suite + existing lint/type/static checks) · Visual verification (e2e_visual=on) · Per-repo results (surface fanout) · Skipped

When each applies → **qa.md > Mode: Execute** (per-repo → orchestrator/references/fanout-dispatch.md > QA — Execute (Test)).
