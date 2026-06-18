# Test plan: <title>

**Spec**: [./spec.md](./spec.md) · **Plan**: [./plan.md](./plan.md) · **Status**: draft | approved
**Mode**: Full (feat / refactor) | Fix (fix)

## Coverage plan *(required)*

One row per `spec.md` AC — happy path AND its `on error / at boundary:` clause are separate rows. Pick the level that **owns** the behaviour; every AC maps to ≥ 1 planned test. (e2e is opt-in — only when `e2e_visual=on`; under `off` map a user journey to integration.)

| AC | Level (unit / integration / e2e) | What the test asserts | Notes |
|----|----------------------------------|-----------------------|-------|
| AC1 | unit | <behaviour the test pins down> | |
| AC1 (on error / boundary) | unit | <unhappy-path assertion> | |
| AC2 (measured: <target>) | integration | <test that runs the measurement> | NFR-class — `measured:` is the verify |

<!--
Optional sections — add only when they apply; delete the rest (no "N/A"):
Edge cases to probe · Out of test scope · Fixtures / data / env · Regression contract (fix) ·
Baseline (refactor / brownfield feat editing uncovered behaviour) · Coverage targets · Visual verification (e2e_visual=on).
When each applies + how to fill: see  qa.md > Mode: Test plan.
-->
