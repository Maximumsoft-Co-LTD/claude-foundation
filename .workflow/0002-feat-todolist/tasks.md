# Tasks: Todo List App

**Plan**: [./plan.md](./plan.md) · **Spec**: [./spec.md](./spec.md)
**Status**: complete

Phased + dependency-ordered. `[P]` = parallel-safe (different files, no unmet dependency). `[AC#]` ties the task to the acceptance scenario it delivers/verifies. MVP = Phase 3 (US1) block.

Task format: `T### [P?] [AC#] <action> — path#anchor (new|edit) — verify: <command or observable>`

---

## Phase 1: Setup

- [x] **T001** Scaffold three deliverable files with structural shells — `index.html` (new), `style.css` (new), `app.js` (new) — verify: open `index.html` in browser; page loads without console errors; `<link>` and `<script>` resolve; `<main>` and `<header>` elements present in DOM.

- [x] **T002** [P] [SC-006] Confirm no package manifest, bundler output, or external network dependency — `index.html` (edit) — verify: `grep -r "node_modules\|require\|import.*from\|cdn\." index.html app.js style.css` returns no matches; files open directly via `file://` without network requests.

---

## Phase 2: Foundational (blocks all stories)

- [x] **T003** [AC5] [AC20] [AC24] Define `Todo` data model and `Store` object in `app.js` — `app.js#Store` (new) — verify: in browser console, `Store.add({title:'x'})` returns an object with `id`, `title`, `completed:false`, `createdAt`, `dueDate:null`, `priority:null`, `tag:null`; `Store.getAll()` returns the same item; reload page → `Store.getAll()` still returns it.

- [x] **T004** [AC5] Implement localStorage persistence in `Store` — `app.js#Store` (edit) — verify: `localStorage.getItem('todos_v1')` returns valid JSON after `Store.add()`; after page reload, `Store.getAll()` matches pre-reload items exactly (title, completed, dueDate, priority, tag).

- [x] **T005** [AC5] [FR-001] Implement localStorage unavailability degradation in `Store` — `app.js#Store` (edit) — verify: with localStorage blocked (DevTools → Application → Storage → clear + disable, or private mode), app loads, a persistent non-blocking warning banner appears, and `Store.add()` / `Store.getAll()` operate in-memory without throwing; no todo data is silently lost during the session; UI is not blocked.

- [x] **T006** [P] Define `Renderer` skeleton and `App` wiring skeleton in `app.js` — `app.js#Renderer`, `app.js#App` (new) — verify: `App.init()` callable from console without error; DOM container `#todo-list` exists and is empty.

---

## Phase 3: US1 — Core CRUD + Persistence (P1) — MVP

- [x] **T007** [AC1] Implement add-todo: input field, submit button, `Store.add()` call, re-render — `index.html#add-form`, `app.js#App` (edit) — verify: type "Buy milk" → press Enter → item appears in `#todo-list`; active-count increments by 1; `Store.getAll()` length is 1.

- [x] **T008** [AC6] Validate empty/whitespace input on add — `app.js#App` (edit) — verify: submit with empty input → no todo added, `Store.getAll()` unchanged; visible inline error or CSS shake animation fires; whitespace-only title ("   ") also rejected.

- [x] **T009** [AC7] Validate max-length (200 chars) on add — `app.js#App` (edit) — verify: submit title of 201 chars → blocked, no todo added; visible feedback shown; 200-char title is accepted.

- [x] **T010** [AC3] Implement inline edit: double-click/activate edit button → editable field → save on Enter or blur — `app.js#Renderer`, `app.js#App` (edit) — verify: double-click existing todo → input appears pre-filled; change text → press Enter → list item shows new text; `Store.getAll()[0].title` matches.

- [x] **T011** [FR-005] Validate inline edit: reject empty/whitespace save, preserve original — `app.js#App` (edit) — verify: open inline edit, clear text, press Enter → edit cancelled, original title retained in DOM and `Store`; whitespace-only also rejected.

- [x] **T012** [AC2] Implement toggle-complete: checkbox / toggle button flips `completed` and re-renders — `app.js#Renderer`, `app.js#App` (edit) — verify: check todo → class `completed` applied to list item; active-count decrements; uncheck → reverts; `Store.getAll()[0].completed` reflects toggle state.

- [x] **T013** [AC4] Implement delete: delete button removes todo from `Store` and DOM — `app.js#Renderer`, `app.js#App` (edit) — verify: click delete → item removed from `#todo-list`; `Store.getAll()` length decrements; active-count updates.

- [x] **T014** [AC8] Wire keyboard paths: Tab/Enter/Space/Escape for all controls in US1 — `app.js#App`, `index.html` (edit) — verify: keyboard-only walk — Tab to add input → type title → Enter adds; Tab to checkbox → Space toggles; Tab to edit button → Enter opens edit → Escape cancels; Tab to delete → Enter deletes; no pointer device used.

- [x] **T015** [AC9] Add ARIA labels/roles and visible focus indicators to all US1 controls — `index.html`, `style.css` (edit) — verify: browser Accessibility tree (DevTools → Accessibility) shows descriptive accessible name for add-button, checkbox, edit-button, delete-button; `:focus-visible` ring visible on each when tabbed to.

- [x] **T016** [AC10] Apply responsive layout: fluid container, no overflow at 320 px — `style.css` (edit) — verify: `measured: open DevTools → Responsive mode → set width 320 px → confirm no horizontal scrollbar and all controls (add form, todo items, checkboxes, edit+delete buttons) visible and tappable`; repeat at 768 px and 1280 px.

**Checkpoint** — US1 testable on its own. Shippable MVP (AC1–AC10 covered).

---

## Phase 4: US2 — Filter, Count & Clear Completed (P2)

- [x] **T017** [AC14] Render live active-item count "N item(s) left" — `index.html#footer`, `app.js#Renderer` (edit) — verify: 0 todos → "0 items left"; add 2 → "2 items left"; complete 1 → "1 item left"; delete the active one → "0 items left"; count updates without page reload.

- [x] **T018** [AC11] [AC12] [AC13] Implement All/Active/Completed filter tabs — `index.html#filters`, `app.js#App` (edit) — verify: add 3 todos, complete 2; click Active → 1 visible; click Completed → 2 visible; click All → 3 visible; filter state persists re-render (adding a new todo while Active filter is set does not show it).

- [x] **T019** [AC15] [AC16] Implement "Clear completed" button — hidden/disabled when none exist — `index.html#footer`, `app.js#Renderer`, `app.js#App` (edit) — verify: with 0 completed → button hidden or `disabled`; complete 1 → button appears/enabled; click → completed todos removed from DOM and `Store.getAll()`; active todos unaffected.

---

## Phase 5: US3 — Due Dates & Priority (P2)

- [x] **T020** [AC17] Add due-date (`<input type="date">`) and priority (`<select>` Low/Medium/High) fields to add form and edit form — `index.html`, `app.js#Renderer`, `app.js#App` (edit) — verify: add todo with due date "2025-12-31" and priority "High" → list item displays date and "High" badge; `Store.getAll()[0].dueDate === '2025-12-31'` and `.priority === 'High'`.

- [x] **T021** [AC18] Implement sort by due date ascending (undated last) — `app.js#App` (edit) — verify: add 3 todos — dated 2025-06-01, undated, dated 2025-01-01; activate sort-by-due-date → order: 2025-01-01, 2025-06-01, undated; toggle off → original order restored.

- [x] **T022** [AC19] Implement sort by priority descending (High→Medium→Low→none) — `app.js#App` (edit) — verify: add todos with priorities High, none, Low, Medium; activate sort-by-priority → order: High, Medium, Low, none; toggle off → original order.

- [x] **T023** [AC18] [AC19] Default tiebreaker: due-date sort ties broken by priority desc; priority sort ties broken by due-date asc — `app.js#App` (edit) — verify: two todos with same due date, different priorities → priority-desc tiebreaker applied in due-date sort; two todos with same priority, different dates → date-asc tiebreaker applied in priority sort.

- [x] **T024** [AC20] Verify due date and priority persist across reload — `app.js#Store` (verify task) — verify: add todo with dueDate + priority; reload page; `Store.getAll()[0].dueDate` and `.priority` match pre-reload values; list item displays both.

---

## Phase 6: US4 — Categories / Tags (P3)

- [x] **T025** [AC21] Add free-text tag field to add form and edit form; store and display tag label on list item — `index.html`, `app.js#Renderer`, `app.js#App` (edit) — verify: add todo with tag "work" → list item shows "work" badge; `Store.getAll()[0].tag === 'work'`.

- [x] **T026** [AC22] [AC23] Implement tag-filter dropdown/list showing only tags present on ≥1 todo — `index.html#tag-filter`, `app.js#Renderer`, `app.js#App` (edit) — verify: add todos with tags "work", "home", untagged; tag-filter shows "work" and "home" only; select "work" → only "work" todos visible; select "All" → all visible; delete all "home" todos → "home" disappears from filter options.

- [x] **T027** [AC22] Tag filter ANDs with status filter — `app.js#App` (edit) — verify: with Active filter + "work" tag selected → only active todos tagged "work" appear; switch to Completed → only completed "work" todos appear.

- [x] **T028** [AC24] Verify tag persists across reload — `app.js#Store` (verify task) — verify: add todo with tag "personal"; reload; `Store.getAll()[0].tag === 'personal'`; list item shows "personal" badge.

---

## Phase 7: Polish

- [x] **T029** [P] [SC-001] First-use usability smoke-test — observe — verify: open `index.html` cold (no existing data); add a todo → complete it → delete it in under 30 seconds without reading any instructions; all three actions succeed.

- [x] **T030** [P] [SC-002] Full-reload persistence verification — observe — verify: add todos with varied states, due dates, priorities, tags; close tab; reopen `index.html`; all todos, states, dates, priorities, and tags identical to pre-close state.

- [x] **T031** [P] [SC-003] Keyboard-only full-flow walkthrough — observe — verify: complete the journey — add → complete → edit → delete → filter All/Active/Completed → sort by date → sort by priority → filter by tag → clear completed — using Tab/Enter/Space/Escape only; no pointer device; no step fails or traps focus.

- [x] **T032** [P] [SC-004] Accessibility tree inspection — observe — verify: open DevTools → Accessibility; all interactive controls (add button, checkboxes, edit buttons, delete buttons, filter tabs, sort controls, tag-filter, clear-completed) carry descriptive accessible names and correct roles; no unlabelled interactive element.

- [x] **T033** [P] [SC-005] Responsive spot-check at 320 px / 768 px / 1280 px — observe — verify: `measured: DevTools Responsive mode at 320 px → no horizontal scrollbar, all controls reachable; at 768 px → layout clean; at 1280 px → max-width container centred, no overflow`.

- [x] **T034** [P] [SC-006] Deliverable file audit — observe — verify: `ls index.html style.css app.js` returns exactly 3 files; `ls package.json node_modules dist 2>/dev/null` returns nothing; `grep -r "http" index.html` returns no CDN or external URLs.

---

## AC → Task coverage

| AC | Delivering task(s) | Verifying task(s) |
|----|--------------------|-------------------|
| AC1 | T007 | T007, T029 |
| AC2 | T012 | T012 |
| AC3 | T010 | T010 |
| AC4 | T013 | T013 |
| AC5 | T003, T004 | T003, T004, T030 |
| AC6 | T008 | T008 |
| AC7 | T009 | T009 |
| AC8 | T014 | T014, T031 |
| AC9 | T015 | T015, T032 |
| AC10 | T016 | T016, T033 |
| AC11 | T018 | T018 |
| AC12 | T018 | T018 |
| AC13 | T018 | T018 |
| AC14 | T017 | T017 |
| AC15 | T019 | T019 |
| AC16 | T019 | T019 |
| AC17 | T020 | T020 |
| AC18 | T021, T023 | T021, T023 |
| AC19 | T022, T023 | T022, T023 |
| AC20 | T020 | T024 |
| AC21 | T025 | T025 |
| AC22 | T026, T027 | T026, T027 |
| AC23 | T026 | T026 |
| AC24 | T025 | T028 |
| FR-001 | T005 | T005 |
| FR-005 | T011 | T011 |
| SC-001 | T007 | T029 |
| SC-002 | T004 | T030 |
| SC-003 | T014 | T031 |
| SC-004 | T015 | T032 |
| SC-005 | T016 | T033 |
| SC-006 | T002 | T034 |
