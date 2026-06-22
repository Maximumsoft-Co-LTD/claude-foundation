# Spec: Todo List App

**ID**: `0002-feat-todolist`
**Type**: feat
**Status**: draft
**Ship as**: one-drop
**Open PR on ship**: no commit

 **E2E + visual**: on
**Parent**: none

---

## Problem

Engineers need a lightweight, self-contained todo list that runs directly in the browser with no server or build step. All data stays local (localStorage), making it usable immediately on any device without accounts or infrastructure.

## Users

Single user, single device, no auth. No multi-device sync or backend.

---

## User Stories

Priority-ordered; P1 alone is a viable MVP.

### US1 — Core CRUD + Persistence (Priority: P1) MVP

As a user, I can create, view, edit, complete, and delete todos that survive a page reload.

**Why this priority**: Without CRUD and persistence there is no usable product; every other story builds on this foundation.
**Independent test**: Open `index.html`, add three todos, mark one complete, edit one, delete one, reload — state is unchanged.

**Acceptance scenarios**

- [x] **AC1** — **Given** the app is open with an empty list, **When** the user types a non-empty todo title and submits (Enter or button), **Then** a new todo item appears in the list and the item count increments by 1.
- [x] **AC2** — **Given** a todo exists, **When** the user clicks/activates its checkbox or toggle, **Then** its state switches between active and completed (and back) and the item count updates accordingly.
- [x] **AC3** — **Given** a todo exists, **When** the user activates inline edit and saves a non-empty new title, **Then** the todo displays the updated text.
- [x] **AC4** — **Given** a todo exists, **When** the user activates the delete action, **Then** the todo is removed from the list and the item count decrements.
- [x] **AC5** — **Given** todos exist in various states, **When** the page is reloaded or the tab is closed and reopened, **Then** all todos, their completion state, text, and any stored attributes are restored exactly.
- [x] **AC6** — **Given** the add-todo input is empty or contains only whitespace, **When** the user submits, **Then** no todo is added and the user receives visible feedback (e.g. inline error or input shake); the input is trimmed before storage on valid submissions.
- [x] **AC7** — **Given** the add-todo input contains text exceeding the max length [inferred — confirm at gate: ~200 chars], **When** the user attempts to submit, **Then** the submission is blocked and the user receives visible feedback indicating the limit.
- [x] **AC8** — **Given** any interactive control (add button, checkbox, edit, delete), **When** the user navigates and activates it using keyboard only (Tab/Enter/Space/Escape), **Then** the same operation succeeds as with pointer input.
- [x] **AC9** — **Given** any interactive control, **When** rendered, **Then** it carries an appropriate ARIA label or role and displays a visible focus indicator when focused via keyboard.
- [x] **AC10** — **Given** the app is rendered on a mobile viewport (≤ 480 px wide), **When** the user interacts with the list, **Then** all controls are visible, tappable, and the layout does not overflow or clip content.

#### Edge Cases

- Submitting empty/whitespace input → rejected with user feedback (AC6, FR-003).
- Input exceeding max length → blocked with user feedback (AC7, FR-004).
- Editing a todo to empty/whitespace → submission blocked; original text retained (FR-005).
- localStorage unavailable (private mode, quota exceeded, write failure) → app degrades gracefully: continues operating in-memory for the session and shows a persistent, non-blocking warning that todos will not be saved (FR-001). No silent data loss; UI is not blocked.

---

### US2 — Filter, Count & Clear Completed (Priority: P2)

As a user, I can filter the list by All / Active / Completed, see a live count of active items, and remove all completed todos at once.

**Why this priority**: Filtering is a core productivity affordance but the app remains functional without it; CRUD+persistence must come first.
**Independent test**: Add 3 todos, complete 2, confirm count shows "1 item left", activate Completed filter — only 2 show; click "Clear completed" — they disappear; switch to Active — 1 remains.

**Acceptance scenarios**

- [x] **AC11** — **Given** a mixed list, **When** the user selects the Active filter, **Then** only incomplete todos are displayed.
- [x] **AC12** — **Given** a mixed list, **When** the user selects the Completed filter, **Then** only completed todos are displayed.
- [x] **AC13** — **Given** any filter is active, **When** the user selects All, **Then** every todo is displayed regardless of state.
- [x] **AC14** — **Given** any list state, **Then** a live count displays "N item(s) left" reflecting only active (incomplete) todos and updates immediately on any state change.
- [x] **AC15** — **Given** at least one completed todo exists, **When** the user activates "Clear completed", **Then** all completed todos are removed from the list and from storage.
- [x] **AC16** — **Given** no completed todos exist, **Then** the "Clear completed" control is either hidden or disabled.

---

### US3 — Due Dates & Priority (Priority: P2)

As a user, I can attach an optional due date and priority level to each todo and sort the list by these attributes.

**Why this priority**: Adds planning value on top of basic filtering; independent of categories (US4) but lower priority than the filter/count UX (US2) which affects the base list immediately.
**Independent test**: Add 3 todos with varying due dates and priorities; toggle sort by due date — list reorders ascending; toggle sort by priority — list reorders by level.

**Acceptance scenarios**

- [x] **AC17** — **Given** the add/edit form, **When** the user optionally sets a due date and/or priority, **Then** those values are saved with the todo and displayed in the list item.
- [x] **AC18** — **Given** todos with and without due dates, **When** the user sorts by due date ascending, **Then** todos with dates appear first (earliest first), followed by undated todos [inferred — confirm at gate].
- [x] **AC19** — **Given** todos with varying priority levels (Low / Medium / High [inferred — confirm at gate]), **When** the user sorts by priority, **Then** todos are ordered High → Medium → Low → no-priority.
- [x] **AC20** — **Given** a todo with a due date and priority, **When** the page is reloaded, **Then** both attributes are restored.

---

### US4 — Categories / Tags (Priority: P3)

As a user, I can assign a free-text category/tag to each todo and filter the list by tag.

**Why this priority**: Extends organisation but the app delivers full core value (CRUD, filter, prioritisation) without it; lowest-priority self-contained slice.
**Independent test**: Add two todos with different tags; select tag A filter — only tag A todos show; select "All" — both show.

**Acceptance scenarios**

- [x] **AC21** — **Given** the add/edit form, **When** the user types a category/tag name, **Then** it is saved with the todo and displayed as a label on the list item.
- [x] **AC22** — **Given** todos with various tags, **When** the user selects a specific tag in the filter, **Then** only todos carrying that tag are displayed.
- [x] **AC23** — **Given** tags have been assigned, **When** the user filters by tag, **Then** the tag filter options list only tags that currently exist on at least one todo.
- [x] **AC24** — **Given** a todo with a tag, **When** the page is reloaded, **Then** the tag is restored.

---

## Requirements

### Functional Requirements

- **FR-001**: System MUST store and retrieve all todo data (title, completion state, due date, priority, category/tag) from browser localStorage so that data persists across page reloads and browser restarts. When localStorage is unavailable (private mode, quota exceeded, or write failure), the app MUST continue operating in-memory for the current session and MUST display a persistent, non-blocking warning that todos will not be saved; it MUST NOT lose data silently or block the UI.
- **FR-002**: Users MUST be able to add a new todo by submitting a non-empty, non-whitespace-only title; input MUST be trimmed before storage.
- **FR-003**: System MUST reject empty or whitespace-only todo submissions and display visible user feedback; no todo is created.
- **FR-004**: System MUST reject todo title submissions that exceed the configured max length [inferred — confirm at gate: ~200 chars] and display visible user feedback.
- **FR-005**: System MUST reject inline edit saves if the resulting title is empty or whitespace-only and preserve the original text.
- **FR-006**: Users MUST be able to toggle a todo between active and completed states.
- **FR-007**: Users MUST be able to edit the title of an existing todo inline.
- **FR-008**: Users MUST be able to delete a single todo.
- **FR-009**: System MUST display a live count of active (incomplete) todos.
- **FR-010**: Users MUST be able to filter the list to show All, Active, or Completed todos.
- **FR-011**: Users MUST be able to clear all completed todos in one action; the action MUST be unavailable/hidden when no completed todos exist.
- **FR-012**: Users MUST be able to optionally assign a due date to a todo.
- **FR-013**: Users MUST be able to optionally assign a priority level (Low / Medium / High [inferred — confirm at gate]) to a todo.
- **FR-014**: Users MUST be able to sort the visible list by due date ascending or by priority descending.
- **FR-015**: Users MUST be able to assign a free-text category/tag to a todo and filter the list by tag.
- **FR-016**: All interactive controls MUST be operable via keyboard (Tab, Enter, Space, Escape).
- **FR-017**: All interactive controls MUST carry ARIA labels or roles and display visible focus indicators.
- **FR-018**: The layout MUST be responsive and usable on viewport widths from 320 px to desktop widths without horizontal overflow.
- **FR-019**: The deliverable MUST consist of exactly `index.html`, `style.css`, and `app.js`; no framework, no build tool, no bundler. Files open directly in a browser.

### Key Entities

- **Todo** — a single task item; attributes: `id` (unique), `title` (string, trimmed, bounded length), `completed` (boolean), `createdAt` (timestamp), `dueDate` (optional date), `priority` (optional: Low | Medium | High [inferred — confirm at gate]), `tag` (optional free-text string [inferred — confirm at gate: single tag per todo]).
- **Filter state** — current active view: All | Active | Completed | `<tag>`.
- **Sort state** — current sort key: dueDate | priority | none (default) [inferred — confirm at gate].

---

## Success Criteria

- **SC-001**: A first-time user adds, completes, and deletes a todo within 30 seconds of opening `index.html` without instructions.
- **SC-002**: All todos, completion states, due dates, priorities, and tags are restored identically after a full page reload.
- **SC-003**: Every user-visible action (add, toggle, edit, delete, filter, sort, clear) is reachable and completable using keyboard only, with no pointer device.
- **SC-004**: All interactive controls have accessible names and roles verifiable by a browser accessibility tree inspection.
- **SC-005**: The layout renders without horizontal scrollbar or clipped content at 320 px, 768 px, and 1280 px viewport widths.
- **SC-006**: The app ships as three plain files (`index.html`, `style.css`, `app.js`) with no package manifest, no bundler output, and no external network dependency at runtime.

---

## NFR Roll-up

NFR-class acceptance scenarios (feat runtime path — all required):


| NFR class                       | AC#s     |
| ------------------------------- | -------- |
| Input validation                | AC6, AC7 |
| Accessibility (keyboard + ARIA) | AC8, AC9 |
| Responsive layout               | AC10     |


Measurable target — AC10 verify: `measured: open DevTools → Responsive mode → set width 320 px → confirm no horizontal scrollbar and all controls visible and tappable`.

---

## Constraints

- Plain HTML/CSS/JS only — `index.html`, `style.css`, `app.js`. No framework (React, Vue, Svelte, etc.), no build step, no bundler, no npm package.
- Persistence via browser localStorage only. No server, no backend API, no IndexedDB, no service worker (unless needed for offline — out of scope).
- No authentication. Single user, single device.
- No multi-device sync.
- Max todo title length: [inferred — confirm at gate: ~200 characters].
- Priority levels: [inferred — confirm at gate: Low / Medium / High].
- Tags: [inferred — confirm at gate: single free-text tag per todo; no predefined list].
- Default sort: [inferred — confirm at gate: by due date ascending, then priority descending].

---

## Scope — Out

- Backend API or server-side persistence.
- User authentication or accounts.
- Multi-device or cloud sync.
- Sub-tasks or nested todos.
- Drag-and-drop reordering.
- Recurring todos.
- Notifications or reminders.
- Collaborative/shared lists.
- Multiple tag assignment per todo (single tag per todo is in scope [inferred]).
- Dark mode / theme switching.

---

## Definition of Done

- [ ] `index.html`, `style.css`, `app.js` delivered with no external runtime dependencies.
- [ ] All AC1–AC24 pass (manual or automated verification).
- [ ] NFR scenarios AC6, AC7, AC8, AC9, AC10 verified.
- [ ] Visual e2e tests cover core user journeys (add, complete, delete, filter, sort, tag filter) and pass.
- [ ] Keyboard-only walkthrough of full CRUD + filter flow completed without a pointer device.
- [ ] Accessibility tree inspection confirms ARIA labels/roles on all interactive controls.
- [ ] Responsive spot-check at 320 px, 768 px, 1280 px confirms no layout breakage.

---

## Glossary

- **Todo** — a single trackable task item in the list; carries title, completion state, and optional due date / priority / tag.
- **Active** — a todo that has not been marked complete.
- **Completed** — a todo that has been marked complete via its toggle.
- **Priority** — an ordered rank (Low / Medium / High [inferred — confirm at gate]) indicating relative importance of a todo.
- **Tag / Category** — a free-text label assigned to a todo for grouping and filtering; used interchangeably in this spec.
- **Clear completed** — a single action that removes all completed todos from the list and from storage.

---

## Assumptions

- Priority levels are Low / Medium / High (small ordered set) [inferred — confirm at gate].
- Max todo title length is ~200 characters [inferred — confirm at gate].
- Each todo carries a single tag (not multiple) [inferred — confirm at gate].
- Default sort is by due date ascending, ties broken by priority descending [inferred — confirm at gate].
- Tags are user-defined free-text; no predefined list [inferred — confirm at gate].
- localStorage key schema is an implementation detail left to the plan phase.
- Single user, single device; no auth, no network requests.

