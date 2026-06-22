# Retro: Todo List App

**Plan**: [./plan.md](./plan.md)
**Type**: feat
**Completed**: 2026-06-21
**Total cycles**: review=1, test=0
**Run metrics**: wall-clock=2026-06-21T00:00:00Z → 2026-06-21T17:48:19Z (~18 h) · size=S · skipped=2 steps (security: clean scan, ship: no-commit user choice) · security=not-fired · fanout=all phases single-pass (greenfield S, one contiguous file set — no eligible fanout surface)
**Ship**: no-commit (user choice at gate — deliverable untracked in working tree on branch `0002-feat-todolist`; no commit SHA, no PR)

---

## What worked

- **Store/Renderer/App separation held cleanly end-to-end.** The three-object split from plan kept functions short, drove 94.7% unit coverage, and made the B1 fix surgical (one-shot `onDegrade` callback crossed the Store→App boundary without Store ever touching the DOM).
- **Test plan's two-tier strategy (unit pure logic + integration DOM boundary) produced fast, isolated failures.** The 25 unit tests running against plain JS functions found boundary bugs before jsdom stood up; the 32 integration tests then caught DOM/state mismatches without e2e overhead.
- **FR-019 no-build constraint simplified the test harness.** Because the app exposes globals on `window`, the `globalThis.Store` import path in vitest/happy-dom was trivial — no mock module system, no ESM transform required. The constraint that looked like a test burden turned out to be a test asset.
- **Plan's `Risks` section flagged the mid-session quota problem verbatim** ("the storage wrapper must catch on every `setItem` call and switch to the degraded warning path"). The lead caught it in review rather than production because it was already named — risk pre-identification paid off.
- **`happy-dom` over `jsdom` resolved the Node 22 `localStorage` global shadow** without any app-code change; a one-line environment swap unblocked the whole integration layer.

---

## What to change next time

- **Test FR-001-style degradation via mid-session failure, not only init-time.** Every FR-001 test in the original suite exercised the init-time degrade path (`_testStorage()` fails at startup). The mid-session quota-exceeded path — storage OK at init, `setItem` throws on a later write — had zero test coverage. This is a systematic blind spot: degradation specs that have two distinct trigger points (init vs runtime) need explicit tests for each. WHY: the review caught B1 only because the lead read the plan's Risks section and traced the code; a test would have caught it automatically and prevented the review cycle.
- **Audit WCAG AA contrast on palette tokens before implement, not during test.** Three colour tokens (`--accent`, `--text-muted`, `.completed` opacity) failed axe during the first qa pass and required a style.css re-run. WHY: the uxui-plan specified the palette but never checked ratios; the plan noted AC9 a11y but did not validate the specific colours. A contrast check at plan or uxui-plan time (even a mental 4.5:1 sanity pass against the proposed tokens) eliminates the qa-cycle re-spin.
- **Fanout calibration: all five phases logged `eligible: false` — accurate for this S greenfield.** No calibration change needed. Flag for L/XL brownfield runs where implement and review DO have disjoint surfaces; the single-pass bias is correct here but should not become a default assumption on larger runs.

---

## Acceptance criteria status

### US1 — Core CRUD + Persistence

- [x] AC1 — add todo, count increments
- [x] AC2 — toggle active/completed, count updates
- [x] AC3 — inline edit saves new title
- [x] AC4 — delete removes item, count decrements
- [x] AC5 — reload restores all attributes
- [x] AC6 — empty/whitespace rejected with visible feedback
- [x] AC7 — over-length (>200 chars) rejected with visible feedback
- [x] AC8 — keyboard-only operation (Tab/Enter/Space/Escape) for all controls
- [x] AC9 — ARIA labels/roles + visible focus indicator on all controls
- [x] AC10 — layout usable at ≤480 px, no overflow

### US2 — Filter, Count & Clear Completed

- [x] AC11 — Active filter shows only incomplete todos
- [x] AC12 — Completed filter shows only completed todos
- [x] AC13 — All filter shows every todo
- [x] AC14 — live "N item(s) left" count reflects active todos only
- [x] AC15 — Clear completed removes all completed from list + storage
- [x] AC16 — Clear completed hidden/disabled when no completed todos exist

### US3 — Due Dates & Priority

- [x] AC17 — due date + priority saved with todo and displayed
- [x] AC18 — sort by due date ascending, undated last
- [x] AC19 — sort by priority High→Medium→Low→none
- [x] AC20 — due date + priority restored on reload

### US4 — Categories / Tags

- [x] AC21 — tag saved and displayed as label on list item
- [x] AC22 — tag filter shows only matching todos
- [x] AC23 — tag filter dropdown lists only tags on existing todos
- [x] AC24 — tag restored on reload

---

## Deviations from plan

| Task | AC/Tag | Status | Note |
|------|--------|--------|------|
| T005 | FR-001 | partial → fixed in review cycle 1 | Init-time degrade path implemented; mid-session quota path missed banner call (B1). Fixed by adding `Store.onDegrade(cb)` one-shot callback, wired to `Renderer.showStorageBanner` in `App.init`. |
| T026 | AC23 | partial → fixed in review cycle 1 | Tag dropdown reset correct (N1): `App._tagFilter` not reset when active tag's last todo deleted; fixed by resetting `_tagFilter` to `''` in `_render` before `_computeVisible`. |
| T015/T016 | AC9/AC10 | plan-missed colour audit | 3 WCAG AA contrast failures (`--accent`, `--text-muted`, `.completed` opacity) caught by axe during qa first pass; fixed inline. Not in plan's AC9 checks. |

No other deviations. T001–T034 all completed as specified; no tasks dropped or added beyond B1/N1 fixes and contrast corrections.

---

## Memory candidates (facts)

- **type**: project
  **body**: For degradation specs with two distinct trigger points (init-time vs mid-session runtime), write explicit tests for each path independently — not just the init path. The mid-session quota-exceeded path for `Store._save` had no test and escaped to review.
  **why**: B1 was a genuine coverage blind spot: every FR-001 test hit `_testStorage()` at startup; no test stubbed `setItem` to throw after a successful init. The lead only caught it by reading plan Risks and tracing code.
  **how to apply**: At test-plan time, for any feature with a degrade/fallback path, ask: "can this path be triggered at init AND at runtime?" If yes, require a test row for each trigger point.

- **type**: project
  **body**: `happy-dom` is the correct vitest test environment for this project (Node 22+). `jsdom`'s `localStorage` global is shadowed by Node 22's experimental `localStorage`, breaking integration tests silently. `happy-dom` with a `MemoryStorage` polyfill in `setup-env.js` sidesteps the collision.
  **why**: Discovered during test harness setup; would waste time on any future run that tries jsdom first.
  **how to apply**: When writing vitest config for a vanilla browser app on Node 22+, default to `happy-dom`; add the `MemoryStorage` polyfill in `setup-env.js`.

---

## Skill candidates (procedures)

- **name**: degrade-path-test-coverage
  **scope**: project
  **trigger description**: any spec containing a degradation/fallback requirement (FR-NNN) that has more than one trigger point (e.g. init-time failure vs mid-session/runtime failure)
  **action**: new
  **steps**:
    1. Read the degradation requirement and identify every trigger point (init-time, mid-session, quota-exceeded, network-error, etc.).
    2. For each distinct trigger point, write a named test row in the test plan with an explicit setup that exercises that specific path (e.g. `setItem` stub throws ONLY after init completes, not at init).
    3. Label each row with the trigger type (e.g. `[init-time degrade]`, `[mid-session degrade]`) so coverage gaps are immediately visible in the test matrix.
    4. In the integration test, assert all three legs of the spec requirement: data survival (no silent loss), UI notification shown, and UI-not-blocked (CRUD still operable).
    5. Add a one-shot / idempotent guard test if the spec says the warning fires exactly once.
  **why a skill not a memory**: multi-step test-design procedure with conditional logic (trigger enumeration → per-trigger test row → assertion checklist); not a single fact.
  **handoff prompt for skill-creator**: Create a project skill called `degrade-path-test-coverage`. Trigger: any spec FR that describes a degradation or fallback behaviour with more than one trigger point (init-time vs runtime, quota vs unavailable, etc.). The skill should walk the tester through: (1) enumerating all distinct trigger points from the spec, (2) writing a separate named test row per trigger in the test plan, (3) asserting data-survival + UI-notification + UI-not-blocked for each, and (4) adding an idempotency test when the spec says the warning fires exactly once. Include a worked example using the localStorage mid-session quota-exceeded pattern from run 0002.

---

## Follow-ups

No new follow-ups surfaced this run. No prior open items existed to consume.
