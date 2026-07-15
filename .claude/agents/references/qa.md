# qa — extended rules

Load a section only when its trigger fires; `qa.md` carries what fires on every invocation.

## Visual + a11y verification (when `e2e_visual == "on"` AND a rendered-output diff)

**Load when:** rendered-output diff touches `.html`/`.css`/`.jsx`/`.tsx`/`.vue`/`.svelte`/templates/styling; else (or `off`) skip.

DOM assertions prove structure, not appearance (`scrollWidth ≤ width` ≠ "readable").

**Plan (Test plan, step 3a).** Per UI surface: **viewports** (≥ narrow mobile ≈375px + desktop + every CSS breakpoint) and **eye-only visual properties** — no mid-word break / overflow / clipping / overlap / unreadable truncation, correct stacking + wrap order, legible contrast. **Flag surfaces reached via an animating state change** (Execute captures them settled). Record as `test-plan.md > Visual verification` rows. **a11y, same pass:** axe-core (or equiv) WCAG basics (contrast, labels/alt, focus order, ARIA), same browser session, same rows. **Reuse, don't boot** — screenshots from the e2e run's browser. No reusable session at execute → note `visual: deferred to orchestrator MCP backstop`.

**Execute (step 4b).** After the green run, **reuse the browser session your e2e tests opened** (`page.screenshot()`, never a fresh install). Each viewport → PNG of a **settled** render: after an animating change, `animations: "disabled"` **and** wait the transition out (mid-transition = false defect). **Open each PNG with `Read`**, judge the planned properties. **Finding = observation, not diagnosis** — grep CSS/JS to confirm a cause before naming it; unconfirmed → hypothesis, capture-timing flagged. Real layout/readability defect (mid-word break, overflow, overlap, clipping) = **blocking** → `tests.md` Status `failing`, route engineer (never `passing` with a visual defect). Cosmetic nit the spec doesn't pin → `tests.md > Edge-case gaps`. **a11y:** axe on the same session — serious WCAG (contrast, or a control with no accessible name/role) = **blocking** → engineer; nit → `Edge-case gaps`; axe is deterministic, route straight. **No reusable session** → don't boot one to screenshot — record `visual: deferred to orchestrator MCP backstop`, return that exact note.

**Browser-cost discipline (`on` only).** Wall-clock is dominated by *installing the browser binary*, not the tests. **First: system browser via `channel` (`'chrome'`/`'msedge'`) — NO download** (named in `test-plan.md > Execution mechanism`). Else reuse a cached bundled Chromium (`PLAYWRIGHT_BROWSERS_PATH` / default cache; install only if genuinely absent) — never a fresh `playwright install` over a cached browser. **One session serves both e2e assertions and visual screenshots.** Tiny visual surface, no real e2e journey → lighter DOM runner + `visual: deferred to orchestrator MCP backstop`; never install an engine solely for the visual pass. **E2E tool:** Playwright for web, else the stack's runner; ask before adding a harness to a bare repo (unless `test-plan.md` named it — then install without re-asking); never force Playwright into a non-web repo.

## Coverage-floor split-by-hand mechanics (Execute step 4a, M/L only)

**Load when:** sizing the diff-coverage check for an M/L run (XS/S shortcut: record `deferred — size XS/S, tests executed green` + any obvious dark spot as advisory, unless the gate requested diff-coverage accounting).

Measure coverage on **changed code only**, each floor over its level's slice, against `test-plan.md > Coverage targets`:
- **Unit ≥ 80%** of unit-testable changed lines.
- **Integration ≥ 70%** of boundary-crossing changed lines (DB/network/FS/IPC seams only — NOT pure logic).
- **E2E ≥ 50%** of critical journeys (only when `e2e_visual == "on"`; journey coverage, NOT line coverage).

Tools report the whole diff, not the logic-vs-boundary split — so split unit vs integration **by hand** (label each changed line logic/boundary/neither). Keep the one-command rule (split by level via vitest projects / pytest markers; e2e runs separately). Record each in-scope level in `tests.md > Coverage (diff vs floor)`. **Below-floor is a finding, not a failure** — don't pad with trivial tests, don't set `failing` on coverage; record the gap for the orchestrator to escalate. Empty slice → no floor; note "n/a — not in scope".

## Tiered run & targeted re-validation (Execute — wall-clock control)

**Load:** every Execute. Rule: **full suite runs ONCE per run (final gate), not per cycle.**

**Two commands** (`test-plan.md > Execution mechanism`):
- **Full-suite** — `npm test`/`pytest`/`go test ./...`/`cargo test`/monorepo aggregator. Only run that sets ship-blocking `passing`.
- **Impacted** — related-test selection: `vitest related <f>` · `jest --findRelatedTests <f>` · `pytest --testmon`/`-k` · `go test <pkg>` · `cargo test <mod>`. No related mode → Impacted = full suite (note it).

**Inner loop (every cycle: test-fail / review-fix / security-fix) → Impacted only**, never per-file Bash. Label `re-validated (targeted): <scope> — passing|failing`; **never the authoritative `passing`** (never fake green).

**Targeted re-entry** (orchestrator note `re-validate targeted: <files>`, guards Review/Security): run Impacted for those files + their AC-mapped tests; no full suite, no plan re-walk. Scope = files changed since last green — accumulated-edit correctness rests on the final gate.

**Final gate:** at convergence (review ∧ security clean, pre-docs) the Full-suite cmd runs once on the final diff = authoritative `passing`. Orchestrator runs it via Bash from `tests.md > Commands`. Red → `cycles.test++` → engineer → re-enter. Safety net for cross-module regressions Impacted misses.

## Revise variant (gate-revise — incremental, NOT a fresh plan)

**Load when:** the orchestrator re-spawns you with gate-revise notes (a wrong level, a missing edge case, a changed coverage target). **Edit only the affected rows/sections** of the existing `test-plan.md` — do not regenerate it, do not re-walk the whole codebase. Re-check that every `spec.md` AC still has a Coverage-plan row after the edit. Return the path + a 1–2 line summary of only what changed.

## Recruit help when the test surface is large (direct nesting)

**Load when:** the plan spans ≥ 2 of {unit, integration, e2e} AND a level has ≥ 3 tests worth a focused pass. You hold `Agent` — spawn analysis helpers yourself (v2.1.172+); no signal fallback — a genuine block returns `BLOCKER:` naming why. You still write every test and `tests.md`.

- **Split + spawn** — one `team-pr-test-analyzer` per category, **one message** (parallel), **cap 3**, each scoped to that category's diff slice (pass the slice + `test-plan.md` coverage rows + what to return).
- **Registry path** (`.claude/skills/fanout-team-agents/SKILL.md`) — read `team_registry`: `live` → by name; `inline-fallback` → `general-purpose` + `model="sonnet"` with `.claude/agents/team-pr-test-analyzer.md` inlined (Case 6 blocks an unpinned general-purpose spawn); `unknown` → try named, fall to inline on `not found`, report the path used. Inline fallback for the haiku-pinned analyzer runs a tier UP (sonnet floor) — say so in the path report so cost drift stays auditable.
- **Dedup direction (test runs before review now)** — test is the first analysis pass, so there are no review findings to fold in; run every planned category. Review instead dedups its test-coverage lens against *your* `team-pr-test-analyzer` findings, so leave them legible in `tests.md`.
- **Integrate** the returned coverage-gap findings into your test design + `tests.md`.
- **Guardrails** — helpers are read-only, never write tests/`tests.md`/`state.json`. One level of split; dispatch mechanics + stop-line: `.claude/skills/fanout-team-agents/references/dispatch-mechanism.md > Worker-side nesting contract`.

## Surface (multi-repo) variants

**Load when:** spawned on a multi-repo control-plane run as a **per-repo tester** or the **surface-coordinator** (which nests per-repo helpers and writes the unified `tests.md`). Both contracts live in `orchestrator/references/fanout-dispatch.md > QA — Execute (Test)`. A single-repo run (the common case) never needs them.
