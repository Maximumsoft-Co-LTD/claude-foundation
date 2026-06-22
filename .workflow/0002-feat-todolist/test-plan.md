# Test plan: Todo List App

**Spec**: [./spec.md](./spec.md)
**Plan**: [./plan.md](./plan.md) · **Tasks**: [./tasks.md](./tasks.md)
**Status**: draft
**Mode**: Full (feat)
**Type-aware mode**: Full
**e2e_visual**: on

---

## Coverage plan

One row per AC; happy path and boundary/error scenario are separate rows. Level that owns the behaviour: pure logic → unit · DOM + localStorage boundary → integration · end-to-end user journey → e2e.

Runner: **vitest + jsdom** (unit + integration) · **Playwright `channel: 'chrome'`** (e2e + visual/a11y).

| AC | Level | What the test asserts | Notes |
|----|-------|-----------------------|-------|
| AC1 (add todo — happy path) | integration | Submitting a non-empty title appends one item to the DOM and increments the count display by 1 | jsdom + app.js wired to localStorage |
| AC1 (add todo — boundary: leading/trailing whitespace) | unit | `createTodo('  buy milk  ')` stores title `'buy milk'` (trimmed) | Pure logic |
| AC2 (toggle complete — happy path) | integration | Clicking a todo's checkbox flips its `completed` class/attribute and live count updates | |
| AC2 (toggle back to active) | integration | A second click on a completed todo's checkbox restores it to active state and increments count | |
| AC3 (edit — happy path) | integration | Activating inline edit, typing a new title, and saving updates the displayed text | |
| AC3 (edit — save non-empty new title) | unit | `updateTodo(id, 'new title')` returns todo with updated title and original `id`/`createdAt` | |
| AC4 (delete — happy path) | integration | Clicking delete removes the item from the DOM and decrements the count | |
| AC5 (persistence — round-trip) | integration | After seeding localStorage and re-initialising the module, all todos (title, completed, dueDate, priority, tag) are restored identically | jsdom localStorage; simulates reload by re-running init |
| AC6 (empty/whitespace submit — boundary) | unit | `validateTitle('')` and `validateTitle('   ')` both return a validation error; no todo created | |
| AC6 (empty submit — visible feedback) | integration | Submitting empty input renders a visible error element (or input shake class) in the DOM | |
| AC7 (max-length exceeded — boundary) | unit | `validateTitle('x'.repeat(201))` returns a max-length error; `validateTitle('x'.repeat(200))` returns no error | T009 confirms 200 accepted, 201 rejected |
| AC7 (max-length — visible feedback) | integration | Submitting a 201-char title renders a visible error element ("Title must be 200 characters or fewer."); submitting a 200-char title succeeds | |
| AC8 (keyboard — add) | e2e | Tab to input, type title, press Enter → item appears; no pointer used | Playwright keyboard API |
| AC8 (keyboard — toggle) | e2e | Tab to checkbox, press Space → todo toggles completed | |
| AC8 (keyboard — edit) | e2e | Tab to edit control, press Enter to open, type new title, Enter to save → text updated | |
| AC8 (keyboard — delete) | e2e | Tab to delete button, press Enter/Space → todo removed | |
| AC8 (keyboard — Escape cancels edit) | e2e | While in inline edit, pressing Escape restores original text and closes edit mode | |
| AC9 (ARIA labels and roles) | e2e (a11y) | axe-core / Playwright accessibility snapshot: all interactive controls have accessible names and correct roles; no a11y violations at critical impact | Visual + a11y plan row |
| AC9 (visible focus indicator) | e2e (visual) | Each focusable control shows a visible focus ring on keyboard focus — screenshot diff vs baseline | Visual + a11y plan row |
| AC10 (responsive 320 px — measured) | e2e | `measured:` Playwright viewport set to 320 px wide; assert `document.documentElement.scrollWidth <= 320` (no horizontal overflow); all control bounding boxes within viewport | SC-005 |
| AC10 (responsive 768 px) | e2e | Same overflow assertion at 768 px viewport | |
| AC10 (responsive 1280 px) | e2e | Same overflow assertion at 1280 px viewport | |
| AC11 (Active filter) | integration | After toggling 2 of 3 todos complete, selecting Active filter leaves only 1 item visible in the DOM | |
| AC12 (Completed filter) | integration | Same seed: selecting Completed filter shows only the 2 completed items | |
| AC13 (All filter) | integration | After applying Active filter, selecting All restores all 3 items | |
| AC14 (live count) | integration | Count display reads "1 item left" when 1 of 3 todos is active; updates immediately on each toggle | |
| AC14 (count — plural/singular) | unit | `formatCount(1)` → `'1 item left'`; `formatCount(0)` → `'0 items left'`; `formatCount(3)` → `'3 items left'` | T017: singular at 1 ("1 item left"), plural otherwise ("N items left") — "item(s)" phrasing is task shorthand only; copy is singular/plural variant |
| AC15 (clear completed — happy path) | integration | With 2 completed todos, clicking "Clear completed" removes both from DOM and from localStorage | |
| AC15 (clear completed — removed from storage) | unit | `clearCompleted([...todos])` returns only incomplete todos; completed items absent | |
| AC16 (clear completed hidden when none) | integration | With 0 completed todos the "Clear completed" control is absent from DOM or has `disabled`/`hidden` attribute | |
| AC17 (due date + priority saved and displayed) | integration | Adding a todo with due date `2025-12-31` (YYYY-MM-DD, `<input type="date">` native value) and priority `High` persists both (`Store.getAll()[0].dueDate === '2025-12-31'`, `.priority === 'High'`) and renders them as badge/chip in the list item | T020 uses seed value `'2025-12-31'`; date stored and asserted as YYYY-MM-DD string |
| AC18 (sort by due date ascending) | unit | `sortByDueDate([undated, late, early])` returns `[early, late, undated]` | Undated last per spec inference |
| AC18 (sort by due date — e2e) | e2e | Clicking "Sort by date" control (S4 toolbar label per uxui-plan S4 wireframe; T021 "activate sort-by-due-date") reorders the visible list earliest-first, undated last | uxui-plan SC12 step 1: "Sort by date"; T021 describes toggle; selector targets text "Sort by date" or `data-sort="date"` — engineer must expose that attribute |
| AC19 (sort by priority) | unit | `sortByPriority([low, none, high, medium])` returns `[high, medium, low, none]` | |
| AC19 (sort by priority — e2e) | e2e | Clicking "Sort by priority" control (S4 toolbar label per uxui-plan S4 wireframe; T022 "activate sort-by-priority") reorders visible list High → Medium → Low → no-priority | uxui-plan SC13 step 1: "Sort by priority"; selector targets text "Sort by priority" or `data-sort="priority"` — engineer must expose that attribute |
| AC20 (due date + priority persist on reload) | integration | Seed a todo with dueDate and priority; re-initialise module; both attributes intact in restored state | |
| AC21 (tag saved and displayed) | integration | Adding a todo with tag `'work'` persists the tag and renders it as a label in the list item | |
| AC22 (tag filter) | integration | With todos tagged `'work'` and `'home'`, selecting tag `'work'` shows only work todos | |
| AC23 (tag filter options reflect existing tags) | integration | After deleting all `'work'` todos, `'work'` no longer appears in the tag filter options | |
| AC24 (tag persists on reload) | integration | Seed a todo with tag `'home'`; re-initialise module; tag is restored | |
| AC5 / FR-001 (localStorage unavailable — in-memory fallback logic) | unit | When `Store.add` / `Store.getAll` are called after `localStorage.setItem` is replaced with a throwing stub (QuotaExceededError), operations succeed against the in-memory array without throwing; no data is silently lost | T005; covers fallback path |
| AC5 / FR-001 (localStorage unavailable — warning banner rendered) | integration | When the app is initialised with `localStorage.setItem` stubbed to throw, the DOM contains a persistent non-blocking warning element indicating todos will not be saved; the warning is visible; add/toggle/delete operations remain functional | T005; jsdom + dispatchEvent |

Total ACs mapped: 24 spec ACs → 42 planned test rows (several ACs split happy + boundary/error + e2e variant; 2 rows added for FR-001 degradation).

---

## Edge cases

Reachable inputs against spec + Files-touched. Scope: diff-reachable only (spec-only run; exact files unknown, walking spec surface).

| Input | Why reachable | Disposition |
|-------|---------------|-------------|
| Empty input submit | User types nothing | **Specified** → AC6 (planned above) |
| Whitespace-only input submit | User types spaces | **Specified** → AC6 (planned above) |
| Title at exact max length (200 chars) | Boundary of FR-004 | **Specified** → AC7 boundary row — max confirmed 200 (T009) |
| Title at max+1 (201 chars) | FR-004 rejection | **Specified** → AC7 unit row above |
| Edit save to empty string | FR-005 | **Specified** → see below |
| Edit save to whitespace-only | FR-005 | **Specified** → see below |
| localStorage unavailable (private mode, quota exceeded) | User with storage restrictions | **Specified** → FR-001 / AC5 / T005: in-memory fallback + persistent non-blocking warning; covered by the two new rows in Coverage plan above |
| Toggle completed → active when Active filter is on | Filtered view mutation | **Covered** — AC2 toggle-back + AC11 together cover; no additional row needed |
| Delete last remaining todo | Empty-list state | Not a separate AC but reachable; empty list should show no items and count "0 items left" — **Covered** by AC4 (delete) + AC14 (count); will surface in integration tests |
| Concurrent-tab storage write | Two tabs open | Out of scope per spec (single device, no sync; not reachable via the declared constraints) |

**Specified edge cases needing explicit test rows (not yet in Coverage plan above):**

| AC | Level | What the test asserts |
|----|-------|-----------------------|
| FR-005 (edit save empty) | unit | `validateEditTitle('')` returns error; `updateTodo` not called |
| FR-005 (edit save whitespace) | unit | `validateEditTitle('   ')` returns error; original title unchanged in state |
| FR-005 (edit empty — DOM) | integration | In edit mode, clearing the title and pressing Enter does NOT update displayed text; original text remains |

**Blocking spec gaps:** 0 blockers. localStorage-unavailable degradation is now fully specified by FR-001 / AC5 and covered by the two rows added to the Coverage plan.

---

## Visual + a11y plan

Trigger: `e2e_visual=on` + rendered-output diff (entire UI is the deliverable).

**Tool**: Playwright + `@axe-core/playwright` + `toHaveScreenshot` (pixel-diff baseline).

**Scope**:

| Check | Method | AC |
|-------|--------|----|
| No a11y violations (critical/serious) on initial load | `checkA11y()` / AxeBuilder | AC9 |
| No a11y violations after adding + completing a todo | `checkA11y()` after state mutation | AC9 |
| Visible focus indicator on each interactive control | Screenshot diff: tab through controls, capture focus ring per element | AC9 |
| ARIA labels and roles on all interactive controls | `page.accessibility.snapshot()` + assertions on accessible names | AC9 |
| Keyboard-only full flow (add → complete → edit → delete) | Playwright keyboard API, zero pointer events | AC8 |
| No horizontal overflow at 320 px | `scrollWidth <= viewportWidth` assertion | AC10 (measured) |
| No horizontal overflow at 768 px | Same | AC10 |
| No horizontal overflow at 1280 px | Same | AC10 |
| Visual regression: empty state | `toHaveScreenshot('empty-state.png')` | Journey baseline |
| Visual regression: populated list (mix of active/completed) | `toHaveScreenshot('mixed-list.png')` | Journey baseline |
| Visual regression: Completed filter active | `toHaveScreenshot('filter-completed.png')` | AC12 |

**Baseline**: Visual screenshots captured on first passing run; subsequent runs diff against them. `--update-snapshots` flag for intentional visual changes only.

---

## Out of test scope

- Backend / server-side persistence (no server exists)
- Multi-device sync
- Dark mode / theme switching
- Sub-tasks, drag-and-drop, recurring todos, notifications (all out of scope per spec)
- localStorage unavailable degradation is IN scope (FR-001 / T005) and covered in the Coverage plan above; removed from out-of-scope

---

## Fixtures / test data / env

**App-runtime vs test-tooling separation**: The shipped app is exactly `index.html`, `style.css`, `app.js` — zero runtime dependencies, no `package.json`, no bundler. The test tooling (`vitest`, `jsdom`, `@vitest/coverage-v8`, `playwright`, `@axe-core/playwright`) lives in a `package.json` with `devDependencies` only, at the repo root (or a `tests/` package.json). The shipped app files are never modified by the test harness; tests import `app.js` as a module or load it via Playwright's `page.goto('file://...')`.

**Unit tests (vitest + jsdom)**:
- `app.js` is a single vanilla file exposing three plain objects (`Store`, `Renderer`, `App`) attached to `window` (no ES-module `export` — FR-019 bans a build step). Import strategy: load the file via vitest's `jsdom` environment using a dynamic `import('./app.js')` or a `<script>` injected into the jsdom document; after load, reference `globalThis.Store`, `globalThis.Renderer`, etc. Alternatively, the engineer adds a conditional export guard (`if (typeof module !== 'undefined') module.exports = { Store, Renderer, App }`) gated on the test environment — **this surface must be confirmed with the engineer before unit tests are written**; flag to engineer at Execute time. The chosen approach becomes the test-tooling contract for the entire unit + integration layer.
- Seed state: `localStorage.setItem('todos_v1', JSON.stringify([...]))` (key is `todos_v1` per plan.md) before each test; clear with `localStorage.clear()` in `afterEach`.
- No network; no real browser. `testEnvironment: 'jsdom'` in vitest config.

**Integration tests (vitest + jsdom)**:
- Load the full app module in jsdom; simulate user events via `dispatchEvent` / DOM manipulation; assert DOM mutations and localStorage state.
- `localStorage` is the real jsdom in-memory store (not mocked); cleared between tests.
- No DB, no network, no mocked localStorage — the real jsdom stub is the boundary under test.

**e2e tests (Playwright `channel: 'chrome'`)**:
- `page.goto(\`file://${process.env.TODO_APP_DIR ?? path.resolve(__dirname, '..')}/index.html\`)` — path is parameterized via `TODO_APP_DIR` env var (or resolved relative to the test package root). The deliverable directory (`index.html` / `style.css` / `app.js`) location finalizes once the gate confirms root vs. subdirectory; the env-var approach keeps the e2e config correct without a code change.
- System Chrome via `channel: 'chrome'`; fall back to bundled Chromium only if system Chrome absent (`executablePath` check in `playwright.config.ts`).
- localStorage cleared via `page.evaluate(() => localStorage.clear())` in `beforeEach`.
- Visual screenshots stored in `tests/snapshots/`; committed on first run, diffed on CI.

**vitest config skeleton**:
```js
// vitest.config.js
export default { test: { environment: 'jsdom', globals: true } }
```

---

## Regression contract

Type is `feat` (greenfield) — no regression contract required. No pre-existing behaviour to regress against.

---

## Baseline

Greenfield feat — no baseline required. Characterization is for brownfield / refactor only.

---

## Coverage targets (advisory)

| Level | Floor | Journeys in scope |
|-------|-------|-------------------|
| Unit | ≥ 80% of diff lines | `validateTitle`, `createTodo`, `updateTodo`, `deleteTodo`, `clearCompleted`, `sortByDueDate`, `sortByPriority`, `formatCount`, `validateEditTitle`, persistence read/write |
| Integration | ≥ 70% of diff lines | All DOM-touching paths: add, toggle, edit, delete, filter, count, clear, tag display |
| e2e | ≥ 50% of journeys | Journeys: (1) add→complete→delete, (2) edit title, (3) filter walk (All/Active/Completed), (4) sort by due date, (5) sort by priority, (6) tag filter, (7) keyboard-only CRUD, (8) persistence reload, (9) clear completed |

Floors are advisory; below-floor is an escalated FINDING in Execute, never a pad-with-trivial-tests response.

---

## Pending plan backfill

`pending_plan_backfill: resolved`

All 6 open questions resolved by `plan.md` + `tasks.md` + `uxui-plan.md`:

1. **AC7 max title length** — **resolved**: 200 chars (T009 confirms 201 rejected, 200 accepted). Coverage plan rows updated; no `[pending plan]` tags remain.
2. **AC14 count copy** — **resolved**: `'1 item left'` (singular at exactly 1); `'N items left'` (plural, including 0). `formatCount` unit row updated. Source: T017 narrative + uxui-plan S4 wireframe `"N item(s) left"` decoded as natural-language singular/plural.
3. **AC18 / AC19 sort labels** — **resolved**: uxui-plan SC12/SC13 names them "Sort by date" and "Sort by priority"; S4 wireframe shows `[By date ↑] [By priority]`. e2e selector strategy: text match "Sort by date" / "Sort by priority" or `data-sort` attribute — **flagged to engineer**: expose `data-sort="date"` / `data-sort="priority"` attributes on the sort controls so e2e selectors are stable.
4. **Unit import strategy** — **resolved (conditionally)**: `app.js` exposes `Store` / `Renderer` / `App` on `window` (vanilla, no ES-module export per FR-019). Test approach: dynamic import under jsdom + reference `globalThis.Store` etc., OR a conditional `module.exports` guard. **Flagged to engineer** to confirm and implement the testable surface before Execute. localStorage key is `todos_v1` (plan.md).
5. **e2e `file://` path** — **resolved (parameterized)**: `file://${TODO_APP_DIR}/index.html` where `TODO_APP_DIR` is an env var resolved relative to the test package root. Finalizes once the gate confirms deliverable directory; no hard-coded path in config.
6. **AC17 date format** — **resolved**: `YYYY-MM-DD` string (native `<input type="date">` value). Seed value `'2025-12-31'` (from T020). Coverage plan row and fixture both updated.

Remaining parameterized items (not blocking — implementation detail for Execute):
- **Sort control DOM attributes** (`data-sort`): engineer must expose; flagged above.
- **`app.js` testable surface**: engineer confirms export strategy; flagged above.
- **`TODO_APP_DIR` value**: resolved at gate when deliverable directory is fixed.

Total `[pending plan]` rows filled: **6 / 6**. No open `[pending plan]` tags remain in the document.
