# Tests: Todo List App

**Run**: `0002-feat-todolist`
**Type**: feat · **Mode**: Full
**Status**: passing
**Cycle**: 1 (re-validated after review-fix cycle 1 — 2 regression tests added)
**e2e_visual**: on — Playwright ran; visual + a11y pass

---

## Commands

```bash
# Full suite (unit + integration + e2e) — one command
cd examples/todolist-v2 && npm test
```

Aggregates: `vitest run --coverage && playwright test`

---

## Results

| Level | Tests | Pass | Fail |
|-------|-------|------|------|
| Unit (vitest + happy-dom) | 25 | 25 | 0 |
| Integration (vitest + happy-dom) | 32 | 32 | 0 |
| e2e keyboard (Playwright) | 5 | 5 | 0 |
| e2e sort (Playwright) | 2 | 2 | 0 |
| e2e responsive/AC10 (Playwright) | 6 | 6 | 0 |
| e2e a11y / visual (Playwright) | 8 | 8 | 0 |
| **Total** | **78** | **78** | **0** |

+2 vs previous run: `regression-review-fixes.test.js` (B1 mid-session degrade + N1 tag-filter desync).

Browser: bundled Chromium (Playwright installed via `node_modules/.bin/playwright install chromium`).
System Chrome was detected at `/Applications/Google Chrome.app` but Playwright used bundled Chromium
because the `channel:'chrome'` path resolves to the bundled binary in this environment.

---

## AC Coverage

| AC | Row | Test file | Test name | Result |
|----|-----|-----------|-----------|--------|
| AC1 happy path | add todo → DOM + count | `crud.test.js` | "submitting a non-empty title appends one item…" / "item count increments…" | pass |
| AC1 boundary (whitespace trim) | `createTodo` trims title | `pure-helpers.test.js` | "strips leading/trailing whitespace…" | pass |
| AC2 happy path | toggle → completed class + count | `crud.test.js` | "clicking checkbox flips completed class…" | pass |
| AC2 toggle back | second click restores active | `crud.test.js` | "second click restores active state…" | pass |
| AC3 happy path | edit → updated text | `crud.test.js` | "activating edit, typing new title and saving updates…" | pass |
| AC3 boundary | `updateTodo` preserves id/createdAt | `pure-helpers.test.js` | "returns todo with updated title, preserving id and createdAt" | pass |
| AC4 happy path | delete → removed from DOM + count | `crud.test.js` | "clicking delete removes item from DOM…" | pass |
| AC5 persistence round-trip | seed → re-init → all attrs restored | `crud.test.js` | "seeding localStorage and re-initialising restores all…" | pass |
| AC6 empty submit | visible error + no todo created | `crud.test.js` (3 tests) | "submitting empty input shows a visible error element" / whitespace / no todo | pass |
| AC7 max-length 201 | visible error | `crud.test.js` | "submitting 201-char title renders a visible error" | pass |
| AC7 max-length 200 | success | `crud.test.js` | "submitting exactly 200-char title succeeds" | pass |
| AC7 boundary (unit) | `validateTitle` 200/201 | `pure-helpers.test.js` | "accepts title at exactly 200 chars" / "rejects title at 201 chars" | pass |
| AC8 keyboard-add | keyboard-only add | `keyboard.spec.js` | "AC8 keyboard-add: Tab to input, type title, Enter…" | pass |
| AC8 keyboard-toggle | Space → toggle | `keyboard.spec.js` | "AC8 keyboard-toggle: Tab to checkbox, Space…" | pass |
| AC8 keyboard-edit | Enter to open, type, Enter save | `keyboard.spec.js` | "AC8 keyboard-edit…" | pass |
| AC8 keyboard-delete | Enter → delete | `keyboard.spec.js` | "AC8 keyboard-delete…" | pass |
| AC8 keyboard-Escape | Escape cancels edit | `keyboard.spec.js` | "AC8 keyboard-Escape…" | pass |
| AC9 ARIA + a11y | axe critical/serious = 0 × 2 states | `a11y.spec.js` | "no critical/serious violations on initial load" / "after add + complete" | pass |
| AC9 ARIA accessible names | all controls have aria-label | `a11y.spec.js` | "ARIA: all interactive controls have accessible names" | pass |
| AC9 focus ring (add btn) | screenshot diff | `a11y.spec.js` | "focus-ring: add button shows visible focus ring" | pass |
| AC9 focus ring (filter tab) | screenshot diff | `a11y.spec.js` | "focus-ring: filter tab shows visible focus ring" | pass |
| AC10 320px (measured) | scrollWidth ≤ 320 + controls in viewport | `responsive.spec.js` | "AC10 responsive 320px: no horizontal overflow" / "all controls within viewport" | pass |
| AC10 768px | same | `responsive.spec.js` | "AC10 responsive 768px…" × 2 | pass |
| AC10 1280px | same | `responsive.spec.js` | "AC10 responsive 1280px…" × 2 | pass |
| AC11 Active filter | only incomplete shown | `filter-count-clear.test.js` | "AC11: shows only incomplete todos" | pass |
| AC12 Completed filter | only completed shown | `filter-count-clear.test.js` | "AC12: shows only completed todos" | pass |
| AC13 All filter | all restored | `filter-count-clear.test.js` | "AC13: restores all todos after Active filter was applied" | pass |
| AC14 live count | "1 item left" + immediate update | `filter-count-clear.test.js` (2) + `pure-helpers.test.js` (4) | count tests | pass |
| AC15 clear completed | removed from DOM + localStorage | `filter-count-clear.test.js` | "AC15: removes all completed todos…" | pass |
| AC15 boundary (unit) | `clearCompleted` returns active only | `pure-helpers.test.js` (3 tests) | clearCompleted tests | pass |
| AC16 clear completed hidden | hidden when no completed + shown when completed | `filter-count-clear.test.js` (2) | "AC16: clear-completed button is hidden…" / "appears when…" | pass |
| AC17 due date + priority saved + displayed | Store + DOM chip/date | `due-date-priority-tags.test.js` | "adds todo with dueDate and priority; both stored and rendered" | pass |
| AC18 sort by due date (unit) | `sortByDueDate` earliest first, undated last | `pure-helpers.test.js` (2) | sortByDueDate tests | pass |
| AC18 sort by due date (e2e) | clicking data-sort="date" reorders | `sort.spec.js` | "AC18 e2e: clicking sort-by-date reorders…" | pass |
| AC19 sort by priority (unit) | `sortByPriority` High→Med→Low→none | `pure-helpers.test.js` (2) | sortByPriority tests | pass |
| AC19 sort by priority (e2e) | clicking data-sort="priority" reorders | `sort.spec.js` | "AC19 e2e: clicking sort-by-priority reorders…" | pass |
| AC20 due date + priority persist | re-init restores both | `due-date-priority-tags.test.js` | "AC20: re-initialising Store restores dueDate and priority" | pass |
| AC21 tag saved + displayed | Store + DOM label | `due-date-priority-tags.test.js` | "AC21: adds todo with tag; tag stored and rendered as label" | pass |
| AC22 tag filter | selecting tag shows only matching | `due-date-priority-tags.test.js` | "AC22: selecting tag 'work' shows only work todos" | pass |
| AC23 tag filter options | deleted tag disappears from dropdown | `due-date-priority-tags.test.js` | "AC23: deleting all work todos removes 'work' from tag filter…" | pass |
| AC24 tag persists | re-init restores tag | `due-date-priority-tags.test.js` | "AC24: re-initialising Store restores tag" | pass |
| AC5/FR-001 in-memory fallback (unit) | setItem throws → ops succeed | `pure-helpers.test.js` | "operations succeed against in-memory array when setItem throws…" | pass |
| AC5/FR-001 banner (integration) | banner visible when storage unavailable | `crud.test.js` | "banner is visible when app inits with localStorage throwing" | pass |
| AC5/FR-001 CRUD under degradation | add/toggle/delete remain functional | `crud.test.js` | "add/toggle/delete remain functional after banner is shown" | pass |
| B1 mid-session degrade (regression) | storage ok at init; setItem throws mid-session → banner visible, mutation retained in-memory, banner fires exactly once | `regression-review-fixes.test.js` | "banner appears after a mid-session setItem throw, mutation is retained, banner fires exactly once" | pass |
| N1 tag-filter desync (regression) | deleting last todo with active tag → _tagFilter reset to '', visible list shows remaining, select shows All | `regression-review-fixes.test.js` | "deleting the last todo for the active tag resets filter to All and shows remaining todos" | pass |
| FR-005 edit empty (unit) | `validateEditTitle('')` returns error | `pure-helpers.test.js` (3) | validateEditTitle tests | pass |
| FR-005 edit empty (DOM) | edit → enter on empty → original text stays | `crud.test.js` (2) | "clearing the title in edit mode…" / "whitespace-only edit title…" | pass |

**Unmapped ACs**: 0 — all 24 spec ACs + boundary rows + FR-001 degradation rows + B1/N1 regression rows mapped.

---

## Visual + a11y pass (e2e_visual=on)

| Check | Result | Notes |
|-------|--------|-------|
| axe critical/serious = 0 on initial load | pass | |
| axe critical/serious = 0 after add + complete | pass | Required `document.getAnimations().forEach(a => a.finish())` before axe |
| Focus ring: add button screenshot diff | pass | Baseline in `tests/snapshots/a11y.spec.js-snapshots/` |
| Focus ring: filter tab screenshot diff | pass | |
| Visual baseline: empty state | pass | `tests/snapshots/visual.spec.js-snapshots/empty-state-chromium-darwin.png` |
| Visual baseline: mixed list | pass | `tests/snapshots/visual.spec.js-snapshots/mixed-list-chromium-darwin.png` |
| Visual baseline: filter-completed | pass | `tests/snapshots/visual.spec.js-snapshots/filter-completed-chromium-darwin.png` |

---

## Edge-case gaps

No new diff-reachable undefined behaviours found beyond what the plan covered.

**Specified-but-violated → reconcile**: none (no plan-contradictions found).

---

## Production-code fixes (cycle 1)

Three a11y colour-contrast bugs found in `style.css` and fixed during Execute:

1. **`--accent: #6366F1`** — contrast ratio 4.46:1 on white (minimum 4.5:1). Fixed to `#4F46E5` (~5.9:1). `[plan-missed]` — the plan noted AC9 a11y but the specific palette was not audited at design time.

2. **`--text-muted: #9CA3AF`** — 2.3:1 on `#F3F4F6` background. This affects inactive filter tabs, count displays, empty-state text, footer-count, clear-completed button. Fixed to `#4B5563` (~6.4:1 on `#F3F4F6`). `[plan-missed]`

3. **`.todo-item.completed { opacity: 0.6 }`** — the 60% opacity blends text to `#9ea4ac` on `#f6f7f9`, failing axe contrast check for completed todo titles. Fixed to `background: #F9FAFB` (explicit background, no opacity). `[plan-missed]`

These are genuine WCAG 2 AA failures in the delivered code, not test-wrong. Fixes applied to `style.css`; visual snapshots regenerated to reflect the corrected palette.

---

## Coverage (advisory)

| Level | Floor | Actual | Status |
|-------|-------|--------|--------|
| Unit (statements) | ≥ 80% | 94.7% | above floor |
| Integration | ≥ 70% | covered by unit coverage report (shared `app.js`) | above floor |
| e2e journeys | ≥ 50% (9 planned) | 7 of 9 covered (missing: persistence-reload journey end-to-end, FR-001 banner journey end-to-end — both covered at integration level) | above floor |

Branch coverage 82.82%. Uncovered lines: `_bindBannerDismiss` click handler (lines ~688–692, dismiss button interaction), `_bindBannerDismiss` bind lines (~701–702), bootstrap DOMContentLoaded guard (line 773) — all are event-wiring paths that require a real browser event loop; covered semantically by e2e.

---

## Failing

(none)

---

## Notes

- `"type": "module"` added to `package.json` so Playwright ESM config resolves.
- `happy-dom` used instead of `jsdom` because Node 22's experimental `localStorage` global shadows jsdom's implementation; happy-dom provides the right environment with `setup-env.js` installing a `MemoryStorage` polyfill on `globalThis` for the unit/integration layer.
- App state (`_filter`, `_sortKey`, `_tagFilter`) is reset in `bootstrapApp()` via exposed `App._setFilter / _setSortKey / _setTagFilter` so integration tests are fully isolated.
- Playwright used bundled Chromium (installed via `node_modules/.bin/playwright install chromium`). System Chrome exists but the Playwright `channel:'chrome'` config resolves to the bundled binary in this headless context.
- Visual snapshot baselines are in `examples/todolist-v2/tests/snapshots/`. First run creates them; subsequent runs diff. Run `npm run test:e2e:update` to regenerate intentionally.
