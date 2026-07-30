# Tests: <title>

**Test plan**: [./test-plan.md](./test-plan.md)
**Plan**: [./plan.md](./plan.md)
**Status**: pending | impacted-passing | passing | failing | skipped
**Cycle**: 1 of max 3

The authoritative acceptance record: Test maps every AC to executable evidence and runs Impacted; the Ship Gate later changes `impacted-passing` to `passing` after one final Full-suite + lint/type/static run. (chore / docs / spike have no test plan — fill only Skipped.)

Every result row records `AC# · declared evidence · actual evidence · test/observable · result`. A declared `rendered` AC cannot pass from jsdom/DOM structure alone; a declared `integration`, `measured`, or `security` AC must cite evidence at that boundary.

## Type-aware mode *(required)*

- [ ] **Full** (feat / refactor)
- [ ] **Fix** (fix — regression test mandatory)
- [ ] **Skipped** (chore / docs) — reason under Skipped, leave the rest blank

---

**Sections by mode** — fill only the active mode's, delete the rest:

Acceptance-criteria coverage · Regression test (fix) · Baseline (refactor / brownfield feat) · Edge-case gaps · Results · Coverage (diff vs floor) · Failing · Commands (Impacted + Full-suite + rendered smoke + cwd/env/dependencies + expected groups/min tests + existing lint/type/static checks) · Rendered verification (whenever an AC declares `rendered`; full E2E remains opt-in) · Per-repo results (surface fanout) · Skipped

When each applies → **qa.md > Mode: Execute** (per-repo → orchestrator/references/fanout-dispatch.md > QA — Execute (Test)).
