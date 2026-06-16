# Tests: <title>

**Test plan**: [./test-plan.md](./test-plan.md) · **Plan**: [./plan.md](./plan.md)
**Status**: pending | passing | failing | skipped
**Cycle**: 1 of max 3

The **execution record**: `qa` runs the strategy designed in [./test-plan.md](./test-plan.md) and records what actually happened here. The plan is the design; this is the result. (`chore` / `docs` / `spike` have no test plan — fill the Skipped section only.)

## Type-aware mode
Pick one. Fill the rest of the doc only for the active mode (full fill rules live in qa.md).

- [ ] **Full** (type = feat / refactor)
- [ ] **Fix** (type = fix — regression test mandatory)
- [ ] **Skipped** (type = chore / docs) — write the reason under Skipped, leave the rest blank.

<!--
Type-aware mode is the only always-required section. Add ONLY the sections your mode needs, then DELETE the rest:
- Acceptance-criteria coverage — Full/Fix (table mapping every spec.md AC → the ACTUAL test that verifies it + pass/fail — this is the executed form of test-plan.md > Coverage plan, including each AC's `on error / at boundary:` clause and any `measured:` target. Justify any untestable criterion + tag it for retro. Flag any drift from the planned level.)
- Regression test — REQUIRED for Fix (executes test-plan.md > Regression contract: Path · reproduces spec.md > Reproduction? · pre-fix verification: how QA confirmed it fails on the old code, e.g. `git stash && test` → ❌ / pop → ✅, with the two SHAs).
- Baseline — REQUIRED for Refactor, and for a brownfield feat editing uncovered existing behaviour (the characterization/golden-master from test-plan.md > Baseline: result before ✅ → after ✅). No baseline AND uncovered touched behaviour = blocking gap — nothing proves the change preserved what already worked (for refactor, the equivalence claim is unverifiable; for a brownfield feat, a regression in existing behaviour ships unnoticed).
- Edge-case gaps — Full/Fix (reachable inputs the spec leaves undefined, surfaced DURING the run beyond what test-plan.md > Edge cases to probe already listed: input · why reachable · open question · blocking? — findings, not test rows; omit if none).
- Visual verification — Full/Fix, UI-touching diffs only (executes test-plan.md > Visual verification: screenshots captured by REUSING the e2e browser session — not a fresh boot — then viewed via Read. Table: Viewport | What you saw | Pass / defect. A real layout/readability defect [mid-word break, overflow, overlap, clipping] is BLOCKING → engineer, same as a failing assertion [scrollWidth-passing ≠ readable]; a cosmetic nit the spec doesn't pin → Edge-case gaps. If no reusable live browser session exists (jsdom-only e2e, no e2e at all, or no browser tooling), one line: `visual: deferred to orchestrator MCP backstop`. Omit for non-UI diffs.)
- Results — Full/Fix (table: Suite | Run | Pass | Fail | Notes)
- Coverage (diff vs floor) — Full/Fix (diff coverage on the CHANGED code, each level over the slice it owns, measured against test-plan.md > Coverage targets. Table: Level | Floor | Measured | Tool/cmd | Met? — Unit ≥80% unit-testable lines · Integration ≥70% boundary-crossing lines [not pure logic] · E2E ≥50% of critical user journeys [journeys, not line coverage — list them, mark which an e2e hits]. Include a level only when its slice is non-empty. Advisory ratchets: a below-floor row is a finding [what's dark · why], not a failing suite — orchestrator escalates; never pad to clear a number.)
- Failing — when any suite fails (`path:line` — symptom + root cause + fix attempt)
- Commands — Full/Fix (fenced bash block: how to re-run locally)
- Per-repo results — ONLY when surface-axis fanout ran (one per-repo tester per changed repo in a control-plane run; orchestrator.md step 13 + Surface fanout). One `### Repo: <path>` subsection per changed repo under `## Per-repo results`, each carrying that repo's Results table + diff-coverage + any Failing. The Acceptance-criteria coverage, aggregate Status, and Cycle stay GLOBAL (one AC walk across all repos; Status = passing iff every repo passed; one run-level cycle).
- Skipped — REQUIRED when mode = Skipped (Reason: chore|docs + why no tests apply · Risk accepted: one line). `spike` never reaches qa — it has no tests.md; recommendations.md is its deliverable.
-->
