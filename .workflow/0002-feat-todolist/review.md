# Review: Todo List App

**Run**: `0002-feat-todolist` · **Type**: feat · **Size**: S
**Plan**: [./plan.md](./plan.md) · **Spec**: [./spec.md](./spec.md) · **Tasks**: [./tasks.md](./tasks.md)
**Cycle**: 2 (re-review — verify cycle-1 fixes)
**Verdict**: `approve`

---

## Re-review (cycle 2) — verdict: `approve`

Focused re-review of the cycle-1 fixes in `examples/todolist-v2/app.js` (app.js only; index.html/style.css unchanged). qa re-ran the suite: **78 passing** (57 vitest unit+integration + 21 Playwright e2e), +2 regressions in `tests/integration/regression-review-fixes.test.js`, visual snapshots unchanged. I independently re-ran vitest: **57 PASS / 0 FAIL** (incl. both regressions).

**B1 — RESOLVED.** `Store` gained a one-shot `_onDegrade` slot (`app.js:108`), fired in `_save()`'s catch on the first available→unavailable transition (`app.js:125-132` — sets `_storageAvailable=false`, captures+nulls the callback, then invokes it). `Store.onDegrade(cb)` is public (`app.js:197`); `_reset` clears the slot (`app.js:199`). `App.init()` registers `Store.onDegrade(Renderer.showStorageBanner)` when storage is OK at init (`app.js:728`) and shows the banner directly when storage is already down at init (`app.js:724-725`). Both degrade paths — init-time and mid-session — now surface the persistent banner exactly once; the just-added mutation survives in `_todos` (no silent loss). **Separation preserved**: `Store` fires an opaque callback and never touches the DOM; the DOM-mutating `showStorageBanner` lives in `Renderer` (`app.js:501-504`). One-shot is double-guarded — after the flip, `_save()` early-returns at `app.js:122` *and* `_onDegrade` is nulled, so no second banner-show is possible.

**N1 — RESOLVED.** `_render` resets `_tagFilter` to `''` when no remaining todo carries the active tag (`app.js:551-554`), **before** `_computeVisible` runs, so the visible list is no longer stuck empty. `renderTagFilter(all, _tagFilter)` is then called with the reset value (`app.js:561`), driving the `<select>` to "All" (`app.js:486`).

**Regression-test integrity — genuine, not weakened.** `regression-review-fixes.test.js`:
- B1 asserts all three legs: banner-visible (`classList.contains('hidden') === false`), data-retained (`getAll()` length 2 + contains "Second todo"), and one-shot (`bannerShowCount === 0` via `MutationObserver` after further failed saves). Drives the real `_save()` catch by stubbing `globalThis.localStorage.setItem`.
- N1 asserts `getTagFilter() === ''`, `select.value === ''`, and remaining "Home task" visible (list not stuck). Drives the real add/delete path via the form submit + delete-button click.

**No regression introduced.** Full vitest suite green (57/0); the one-shot callback and `_render` guard touch no other AC path. The cycle-1 findings table and AC checks below stand — B1's FR-001 gap (`T005` "implemented (init path) / gap") is now closed end-to-end.

---

## Cycle 1 (original — `fix-required`)

Suite was green at step 5 (76 tests, 24 ACs mapped, axe 0 critical/serious — see `tests.md`); this review judges correctness/contract-fidelity, not test pass/fail. One blocking FR-001 gap escaped the suite because no test exercises the **mid-session** storage-degradation path.

Deliverable under review: `examples/todolist-v2/{index.html,style.css,app.js}` (FR-019 = exactly 3 product files — satisfied; the package.json/configs/tests sit beside the app as the test harness, not part of the shipped artifact).

---

## Findings

### Blocking

**B1 [major] — FR-001 silent data loss on mid-session quota-exceeded; banner never shown.**
`app.js:119-127` (`Store._save`) catches a failing `setItem` and flips `_storageAvailable = false` with the comment `/* quota exceeded — ... banner already shown */`. That comment's assumption is false: the banner is only shown from `App.init()` (`app.js:707-711`) when storage was **already** unavailable at startup (`_testStorage()` failed). In the path where storage works at init but a later write hits quota, `_save` degrades to in-memory **without ever calling `Renderer.showStorageBanner()`**. The just-added todo survives in memory (`_todos.push` at `app.js:155` precedes `_save`), but every subsequent write is in-memory-only and the user gets **no warning** — on reload those todos vanish.

This is exactly what FR-001 forbids: "When localStorage is unavailable (private mode, **quota exceeded**, or write failure) ... MUST display a persistent, non-blocking warning ... MUST NOT lose data silently." The plan's own Risks section called it out verbatim: "the storage wrapper must catch on every `setItem` call and switch to the **degraded warning path** (FR-001)." Implementation degrades but skips the warning half.

*Fix*: in `_save`'s catch block (`app.js:123-126`), call the banner-show path on the first transition to unavailable — e.g. have `Store` invoke a registered `onDegrade` callback (wired in `App.init`) or expose the flip so `App` shows the banner on next `_render`. The unit test "operations succeed against in-memory array when setItem throws" only asserts data survival, not banner visibility, so add a test asserting the banner appears after a mid-session `setItem` throw.

### Non-blocking

**N1 [minor] — Tag-filter state desync when the filtered tag's last todo is deleted.**
`renderTagFilter` (`app.js:450-479`) correctly drops a tag from the dropdown once no todo carries it and resets the `<select>` to "All tags" (`select.value = ''`, line 477). But `App._tagFilter` (`app.js:515`) is only updated by the `change` listener (`app.js:653-656`), which a programmatic `select.value = ''` does **not** fire. So after deleting the last "work" todo while the "work" tag filter is active, the dropdown shows "All tags" while `_tagFilter` still holds `'work'`, and the list stays filtered-empty until the user manually re-picks a tag. No data loss; AC23 (the dropdown-options requirement) still passes — this is a view/state-control mismatch beyond AC23's letter. *Fix*: in `_render`/`renderTagFilter`, when the active `_tagFilter` no longer exists, reset `App._tagFilter = ''` too.

**N2 [info] — Generic globals on `window` for the `file://` testable surface.**
`app.js:739-749` assigns `Store`, `Renderer`, `App`, plus generic helpers `createTodo`, `updateTodo`, `formatCount`, `clearCompleted`, etc. onto `globalThis` unconditionally (browser path included). Confirmed intentional (the test-import surface) and harmless for a standalone single-script `file://` app — no other script competes for these names, and there is no third-party global to clobber. Flagging only so it's a conscious choice: the very generic helper names are the part most likely to surprise if this code is ever embedded. No action required for the standalone deliverable.

---

## Tasks adherence (T001–T034)

| Task | AC/Tag | Status | Evidence / note |
|------|--------|--------|-----------------|
| T001 | scaffold | implemented | `index.html` shell, `<main>`/`<header>` present, `<link>`+`<script>` resolve |
| T002 | SC-006 | implemented | no `require`/`import`/CDN in the 3 product files; opens via `file://` |
| T003 | AC5/20/24 | implemented | `createTodo` (`app.js:36-48`) yields id/title/completed/createdAt/dueDate/priority/tag |
| T004 | AC5 | implemented | `_save`/`_load` round-trip via `todos_v1` (`app.js:119-137`) |
| T005 | FR-001 | implemented (init path) / **gap** | init-time degradation + banner works; mid-session quota path misses banner → **B1** |
| T006 | — | implemented | `Renderer`/`App` skeletons; `#todo-list` present |
| T007 | AC1 | implemented | add-form submit → `Store.add` → re-render (`app.js:604-623`) |
| T008 | AC6 | implemented | `validateTitle` empty/whitespace → inline error + shake (`app.js:23-27`, `589-596`) |
| T009 | AC7 | implemented | >200 rejected, 200 accepted (`app.js:26`); input `maxlength="201"` lets the 201 case reach JS for the visible error |
| T010 | AC3 | implemented | inline edit open/save on Enter+blur+button, dblclick affordance (`app.js:359-408`) |
| T011 | FR-005 | implemented | `trySave` rejects empty/whitespace, preserves original (`app.js:372-386`) |
| T012 | AC2 | implemented | checkbox `change` → toggle `completed`, count updates (`app.js:560-566`) |
| T013 | AC4 | implemented | delete button + keyboard, `Store.remove` (`app.js:402-405`, `573-576`) |
| T014 | AC8 | implemented | keyboard handlers on tabs/sort/clear/edit/delete (Enter/Space/Escape) |
| T015 | AC9 | implemented | aria-labels on all controls; `:focus-visible` rings in `style.css` |
| T016 | AC10 | implemented | fluid `max-width:640px` shell + 767px breakpoint + overflow-x guard (`style.css:630-715`) |
| T017 | AC14 | implemented | `renderCount` updates toolbar+footer every render (`app.js:430-436`) |
| T018 | AC11/12/13 | implemented | status filter in `_computeVisible` (`app.js:519-527`); persists across re-render |
| T019 | AC15/16 | implemented | `removeCompleted` + hide/show button (`app.js:439-447`, `680-693`) |
| T020 | AC17 | implemented | date `<input>` + priority `<select>` + chip/date render |
| T021 | AC18 | implemented | `sortByDueDate` undated-last, toggle-off restores order (`app.js:67-79`, `529-535`) |
| T022 | AC19 | implemented | `sortByPriority` High→Med→Low→none (`app.js:82-96`) |
| T023 | AC18/19 | implemented | tiebreakers: due-sort ties→priority desc; priority-sort ties→date asc |
| T024 | AC20 | implemented (verify) | re-init restores date+priority (test passes) |
| T025 | AC21 | implemented | tag field stored + rendered as label (`app.js:262-267`) |
| T026 | AC22/23 | implemented | tag dropdown lists only present tags (`app.js:462-471`) — see N1 caveat |
| T027 | AC22 | implemented | tag ANDs status: `statusOk && tagOk` (`app.js:526`) |
| T028 | AC24 | implemented (verify) | tag restored on re-init (test passes) |
| T029–T034 | SC-001..006 | implemented (observe) | smoke/persistence/keyboard/a11y/responsive/file-audit covered by e2e + manual |

Deviations: none beyond B1 (FR-001 partial) and N1 (AC23 letter met, view-recovery missed).

---

## Acceptance-criteria check (AC1–AC24)

| AC | Tickable | Evidence (`path:line`) |
|----|----------|------------------------|
| AC1 add → item + count++ | ✓ | `app.js:604-623`, `429-436` |
| AC2 toggle active/completed + count | ✓ | `app.js:560-566`; `style.css:442-445` |
| AC3 inline edit saves new title | ✓ | `app.js:372-386` |
| AC4 delete removes + count-- | ✓ | `app.js:171-174`, `573-576` |
| AC5 reload restores all attrs | ✓ | `app.js:119-143`; round-trip test passes |
| AC6 empty/whitespace → rejected + feedback; trim on valid | ✓ | `app.js:23-25`, `589-596`, `613` |
| AC7 >max → blocked + feedback | ✓ | `app.js:26`; `index.html:41` maxlength=201 lets 201 trigger error |
| AC8 keyboard-only ops | ✓ | edit/delete/tab/sort/clear keydown handlers throughout |
| AC9 ARIA + focus ring | ✓ | aria-labels in `index.html`; `:focus-visible` in `style.css` |
| AC10 ≤480/320px no overflow | ✓ | `style.css:630-715`; e2e responsive passes at 320/768/1280 |
| AC11 Active filter | ✓ | `app.js:520-524` |
| AC12 Completed filter | ✓ | `app.js:520-524` |
| AC13 All filter | ✓ | `app.js:521` |
| AC14 live "N left" active-only | ✓ | `app.js:430-436`, `544` |
| AC15 clear completed → removed from list+storage | ✓ | `app.js:176-179`, `683-686` |
| AC16 clear hidden when none | ✓ | `app.js:439-447`, `545` |
| AC17 due+priority saved+shown | ✓ | `app.js:36-48`, `217-267` |
| AC18 due asc, undated last | ✓ | `app.js:67-79` |
| AC19 priority High→Med→Low→none | ✓ | `app.js:82-96` |
| AC20 date+priority persist | ✓ | `app.js:119-143`; test passes |
| AC21 tag saved+label | ✓ | `app.js:262-267` |
| AC22 tag filter shows only matching | ✓ | `app.js:525-526` |
| AC23 filter lists only existing tags | ✓ | `app.js:462-471` (view-recovery caveat → N1) |
| AC24 tag persists | ✓ | round-trip; test passes |

**Unticked ACs**: 0. All 24 tick with evidence. AC23 ticks on its literal requirement (dropdown options); N1 is an adjacent state-desync, not an AC failure.

---

## Non-AC slots

- **FR-019 / SC-006 (exactly 3 files, no build/bundler/network)** — honoured: `index.html` + `style.css` + `app.js`, no framework, no runtime import/CDN. The package.json/vitest/playwright dir is the test harness beside the example, not the shipped product.
- **FR-001 (storage degradation)** — partially honoured; **violated** for the mid-session quota path → **B1 (blocking)**.
- **FR-002/003/004/005 (validation: trim, empty, max-200, edit-empty)** — honoured (`validateTitle`/`validateEditTitle`/`createTodo` trim).
- **No-innerHTML/XSS** — honoured: zero `innerHTML`/`insertAdjacentHTML`/`document.write`/`eval` in the diff; all user content via `textContent`/`createElement` (`app.js:241,258,265,322,329` etc.). Gate's "textContent-only" constraint met.
- **qa cycle-1 contrast fixes** (`--accent #4F46E5`, `--text-muted #4B5563`, `.completed` background `#F9FAFB`) — present in `style.css:6,11,442-445`, consistent with axe pass.
- Hygiene: no `[NEEDS CLARIFICATION]` markers; no scope smuggled beyond spec; the `_reset`/`_set*` testing hooks are clearly delimited and do not alter product behaviour.

---

## Code quality

Store/Renderer/App separation is clean and matches the plan: `Store` is pure data + persistence (no DOM), `Renderer` is DOM-only (`createElement`/`textContent`, no business logic), `App` wires events and owns view state. Pure helpers (`validateTitle`, `sort*`, `createTodo`, `formatCount`) are extracted and individually testable — drove the 94% unit coverage. Functions are short and single-purpose; naming is consistent (`_`-prefixed privates). ES2019 stable-sort assumption (plan Risks) holds. No quality blockers beyond B1/N1.
