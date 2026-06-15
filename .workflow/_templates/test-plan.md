# Test plan: <title>

**Spec**: [./spec.md](./spec.md) · **Plan**: [./plan.md](./plan.md)
**Status**: draft | approved
**Type-aware mode**: Full (type = feat / refactor) | Fix (type = fix — regression contract mandatory)

The test **strategy**, written before any code and signed off at the gate alongside the spec and plan: which level proves each acceptance criterion, which edge cases to probe, what won't be tested and why, and the fixtures/data a run needs. `qa` executes this plan at the test phase and records what actually happened in [./tests.md](./tests.md) — **this file is the design, that file is the record.** Only `feat` / `fix` / `refactor` runs get a test plan (the types whose test phase runs); `chore` / `docs` / `spike` skip it.

## Coverage plan
One row per `spec.md` acceptance criterion — the happy path AND its `on error / at boundary:` clause are separate rows (each is its own checkable assertion). Pick the level that **owns** the behaviour; don't push logic up the pyramid. Every AC maps to ≥ 1 planned test.

| AC | Level (unit / integration / e2e) | What the test asserts | Notes |
|----|----------------------------------|-----------------------|-------|
| AC1 | unit | <behaviour the test pins down> | |
| AC1 (on error / boundary) | unit | <unhappy-path assertion: bad input / limit hit / unauthorized caller> | |
| AC2 (measured: <target>) | integration | <test that runs the measurement> | NFR-class AC — its `measured:` clause is the verify |

<!--
Coverage plan is the only always-required section. Add ONLY the sections this run needs, then DELETE the rest (no empty headers, no "N/A"):

- Edge cases to probe — reachable inputs worth a test BEYOND the AC `on error / at boundary` rows above. Walk the edge-case checklist (testing-fundamentals > references/test-design.md) against plan.md's Files touched + Steps; keep it bounded (only cases the planned change can reach; skip what a type or guard makes impossible). Per case: input · why reachable · expected behaviour — OR `undefined → spec gap` when the spec never says what should happen (do NOT invent an assertion; record it so the gate can decide, and flag BLOCKER if the undefined path is a reachable security / data-integrity hole). This is the discovery shifted LEFT — probed before code so the engineer handles it, not after. Omit only when nothing is reachable beyond the AC rows.
- Visual verification — UI-touching diffs only (rendered output changes: html/css/jsx/tsx/vue/svelte/templates/styling). One row per UI surface: viewport(s) to inspect (≥ a narrow mobile ≈375px + desktop + every CSS breakpoint) · the visual properties an eye must confirm that no DOM assertion can (no mid-word break / overflow / clipping / overlap / unreadable truncation, correct stacking + wrap order, legible contrast). Captured by reusing the e2e browser at execute time (NOT a separate browser boot); if no reusable live browser session will exist, note `visual: deferred to orchestrator MCP backstop`. Omit for non-UI diffs.
- Out of test scope — behaviours deliberately NOT tested this run + a one-line why each (third-party internals, generated code, a journey deferred to a follow-up). Keeps the coverage honest about its edges.
- Fixtures / test data / environment — what a run needs: real test DB vs in-memory, seed / fixture data, which boundaries run real vs doubled, env vars / external services, **execution mechanism** (the runner — name it proactively, e.g. Playwright headless; and the dev-only-tooling-vs-shipped-runtime separation when the app has a no-build / zero-dep constraint the harness might seem to violate). (No mocking the database in integration tests — see qa.md Rules.)
- Regression contract — REQUIRED for Fix. The failing test from plan step 1 (Path · reproduces spec.md > Reproduction) and how qa will confirm it fails on the pre-fix code (clean two-commit history `test-commit` → `fix-commit`, or the stash/revert fallback). Without a test that fails on the old code, the fix isn't pinned.
- Baseline — REQUIRED for Refactor when the touched behaviour isn't already covered by a test. The characterization / golden-master that pins current behaviour and is captured BEFORE the structural change (what gets pinned · where · how it's compared after). No baseline + uncovered behaviour = the equivalence claim is unverifiable.
- Coverage targets — the per-level diff-coverage floors this run aims for, each over the slice it owns: Unit ≥ 80% of unit-testable changed lines · Integration ≥ 70% of boundary-crossing changed lines (not pure logic) · E2E ≥ 50% of critical user journeys (list them). Advisory ratchets measured at the test phase, not a ship gate — include only the levels in scope for this change.
-->
