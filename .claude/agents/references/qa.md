# qa — extended rules

Load a section only when its trigger fires; the core `qa.md` carries everything that fires on every main-mode (test-plan / execute) invocation.

## Visual + a11y verification (when `e2e_visual == "on"` AND a rendered-output diff)

**Load when:** the run is `e2e_visual == "on"` and the diff changes rendered output (`.html`/`.css`/`.jsx`/`.tsx`/`.vue`/`.svelte`/templates/styling). Skip entirely under `off` or for a non-UI diff.

DOM assertions prove structure, not appearance (`scrollWidth ≤ width` ≠ "readable").

**Plan (Test plan mode, step 3a).** Per UI surface, plan: the **viewports** (≥ a narrow mobile ≈375px + desktop; add every CSS breakpoint) and the **visual properties only an eye can confirm** — no mid-word break / overflow / clipping / overlap / unreadable truncation, correct stacking + wrap order, legible contrast. **Flag any surface reached via an animating state change** so Execute captures it settled. Record as `test-plan.md > Visual verification` rows. **a11y rides the same pass:** plan an automated check (axe-core / equivalent) for WCAG basics (contrast, labels/alt, focus order, ARIA) in the **same** browser session, same rows. **Reuse, don't boot** — screenshots come from the e2e run's browser, never a separate one. No reusable live browser session at execute time → note `visual: deferred to orchestrator MCP backstop`.

**Execute (Execute mode, step 4b).** After the green run, **reuse the same browser session your e2e tests opened** (`page.screenshot()` — never a fresh install). Capture each viewport to a PNG **of a *settled* render**: after an animating state change, pass `animations: "disabled"` **and** wait the transition out (a mid-transition frame reads as a false contrast/readability defect). **Open each PNG with `Read`** and judge the planned properties. **Record each finding as an observation, not a source diagnosis** — grep the CSS/JS to confirm a cause before naming it; an unconfirmed cause goes up as a hypothesis with capture-timing flagged. A **real layout/readability defect** (mid-word break, overflow, overlap, clipping) is **blocking** → set `tests.md` Status = `failing`, route to engineer (never `passing` with a visual defect). A cosmetic nit the spec doesn't pin → `tests.md > Edge-case gaps`. **a11y:** run axe on the same page/session — a serious WCAG violation (contrast, or a control with no accessible name/role) is **blocking** (→ engineer); a nit → `Edge-case gaps`; axe output is deterministic, route it straight. **No reusable live browser session** → don't install/boot one to screenshot — record `visual: deferred to orchestrator MCP backstop` and return that exact note.

**Browser-cost discipline (only when `on`).** Wall-clock is dominated by *installing the browser binary*, not the tests. **First choice: drive the system browser via `channel` (`'chrome'`/`'msedge'`) — NO download** (the gate-approved `test-plan.md > Execution mechanism` names it). Else **reuse a cached bundled Chromium** (`PLAYWRIGHT_BROWSERS_PATH` / default cache; install only if genuinely absent) — never add a fresh `playwright install` when a cached browser exists. **One browser session serves both e2e assertions and visual screenshots.** Tiny visual surface, no real e2e journey → a lighter DOM runner + `visual: deferred to orchestrator MCP backstop`; never install a browser engine solely for the visual pass. **E2E tool:** Playwright for web, else the stack's e2e runner; ask before adding an e2e harness to a bare repo (unless `test-plan.md` named it — then install without re-asking); never force Playwright into a non-web repo.

## Coverage-floor split-by-hand mechanics (Execute step 4a, M/L only)

**Load when:** sizing the diff-coverage check for an M/L run (XS/S shortcut: record `deferred — size XS/S, tests executed green` + any obvious dark spot as advisory, unless the gate requested diff-coverage accounting).

Measure coverage on **changed code only**, each floor over its level's slice, against `test-plan.md > Coverage targets`:
- **Unit ≥ 80%** of unit-testable changed lines.
- **Integration ≥ 70%** of boundary-crossing changed lines (DB/network/FS/IPC seams only — NOT pure logic).
- **E2E ≥ 50%** of critical journeys (only when `e2e_visual == "on"`; journey coverage, NOT line coverage).

Tools report the whole diff, not the logic-vs-boundary split — so split unit vs integration **by hand** (label each changed line logic/boundary/neither). Keep the one-command rule (split by level via vitest projects / pytest markers; e2e runs separately). Record each in-scope level in `tests.md > Coverage (diff vs floor)`. **Below-floor is a finding, not a failure** — don't pad with trivial tests, don't set `failing` on coverage; record the gap for the orchestrator to escalate. Empty slice → no floor; note "n/a — not in scope".

## Revise variant (gate-revise — incremental, NOT a fresh plan)

**Load when:** the orchestrator re-spawns you with gate-revise notes (a wrong level, a missing edge case, a changed coverage target). **Edit only the affected rows/sections** of the existing `test-plan.md` — do not regenerate it, do not re-walk the whole codebase. Re-check that every `spec.md` AC still has a Coverage-plan row after the edit. Return the path + a 1–2 line summary of only what changed.

## Recruit help when the test surface is large (direct nesting)

**Load when:** the plan spans ≥ 2 of {unit, integration, e2e} AND a level has ≥ 3 tests worth a focused pass. You hold `Agent` — spawn analysis helpers yourself (v2.1.172+) instead of only signalling `FANOUT_REQUESTED: test` (the fallback). You still write every test and `tests.md`.

- **Split + spawn** — one `team-pr-test-analyzer` per category, **one message** (parallel), **cap 3**, each scoped to that category's diff slice (pass the slice + `test-plan.md` coverage rows + what to return).
- **Registry path** (`.claude/skills/fanout-team-agents/SKILL.md`) — read `team_registry`: `live` → by name; `inline-fallback` → `general-purpose` with `.claude/agents/team-pr-test-analyzer.md` inlined; `unknown` → try named, fall to inline on `not found`, report the path used.
- **Dedup direction (test runs before review now)** — test is the first analysis pass, so there are no review findings to fold in; run every planned category. Review (step 6) instead dedups its test-coverage lens against *your* `team-pr-test-analyzer` findings, so leave them legible in `tests.md`.
- **Integrate** the returned coverage-gap findings into your test design + `tests.md`.
- **Guardrails** — helpers are read-only, never write tests/`tests.md`/`state.json`. **One level of split:** end every helper prompt with `You are a nested helper: handle this one sub-scope directly and do NOT spawn further agents.`

## Surface (multi-repo) variants

**Load when:** spawned on a multi-repo control-plane run as a **per-repo tester** or the **surface-coordinator** (which nests per-repo helpers and writes the unified `tests.md`). Both contracts live in `orchestrator/references/surface-fanout.md > QA — Execute (Test)`. A single-repo run (the common case) never needs them.
