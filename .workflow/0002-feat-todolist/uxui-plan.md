# UX/UI Plan: Todo List App

**Spec**: [./spec.md](./spec.md)
**Status**: draft (no open clarifications)

---

## Scenes


| Scene                        | Purpose                                                  | Key elements                                                                                                                                                     | States                                                                                                                                                                                                                  | Entry → Exit                                                                                           |
| ---------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| S1: App Shell                | Single-page container; always visible                    | App title, add-todo form, toolbar, todo list, footer bar                                                                                                         | `none` (static shell)                                                                                                                                                                                                   | App loads → all other scenes nest inside                                                               |
| S2: Add-Todo Form            | Capture new todo title, optional due date, priority, tag | Title input, due-date picker, priority selector, tag input, submit button                                                                                        | `idle` · `validation-error-empty` · `validation-error-length`                                                                                                                                                           | Always visible at top → on valid submit, new item enters S3 list; on error, stays with inline feedback |
| S3: Todo List                | Display, interact with, and manage the todo items        | Todo item rows (checkbox, title, due-date badge, priority chip, tag chip, edit button, delete button)                                                            | `loading` (initial read from localStorage) · `empty` (no items match current filter) · `error-storage` (localStorage unavailable — persistent non-blocking warning banner shown; app continues in-memory) · `populated` | S2 submit → item added; filter/sort toolbar → list re-renders; item actions → item updates/removes     |
| S3a: Todo Item — Default     | Show a single todo in its resting state                  | Checkbox, title text, priority chip, due-date badge, tag chip, edit icon, delete icon                                                                            | `active` · `completed` (strikethrough + muted) · `overdue` (past due date, active only)                                                                                                                                 | —                                                                                                      |
| S3b: Todo Item — Inline Edit | Replace title text with editable field in place          | Edit input pre-filled with current title, save button (or Enter), cancel button (or Escape)                                                                      | `editing` · `edit-validation-error` (empty/whitespace)                                                                                                                                                                  | Edit icon click / Enter on focused item → editing; save/cancel → returns to S3a default                |
| S4: Toolbar                  | Filter, sort, and live count                             | Filter tabs (All / Active / Completed), tag-filter dropdown, sort controls (by date / by priority), active-item count "N item(s) left", "Clear completed" button | `clear-completed-visible` · `clear-completed-hidden` (no completed todos)                                                                                                                                               | Always visible between S2 and S3; control changes re-filter/sort S3                                    |


---

## ASCII Wireframes

### S1 + S2 + S4 + S3 — Desktop (≥ 768 px)

```text
+----------------------------------------------------------+
|           [ Todo List App — playful wordmark ]           |
+----------------------------------------------------------+
|  +----------------------------------------------------+  |
|  | [Title input — "What needs doing?"]  [+ Add]      |  |  ← S2 Add form
|  | [Due date ▾]  [Priority ▾ (Low/Med/High)]         |  |
|  | [Tag input — "category…"]                         |  |
|  +----------------------------------------------------+  |
|                                                          |
|  [All] [Active] [Completed]   Tag: [▾ filter]           |  ← S4 Toolbar top
|  Sort: [By date ↑] [By priority]    3 items left        |
|  ──────────────────────────────────────────────────────  |
|                                                          |
|  +----------------------------------------------------+  |
|  | [ ] ██ HIGH  "Buy groceries"  📅 Jun 22  🏷 food   |  |  ← S3 item (active)
|  |                          [✎ edit]  [✕ delete]      |  |
|  +----------------------------------------------------+  |
|  | [✓] ░░ MED   "Read spec doc"  📅 —   🏷 work      |  |  ← completed (muted)
|  |                          [✎ edit]  [✕ delete]      |  |
|  +----------------------------------------------------+  |
|  | [ ] ░░ LOW   "Water plants"   📅 Jun 25  🏷 —      |  |
|  |                          [✎ edit]  [✕ delete]      |  |
|  +----------------------------------------------------+  |
|                                                          |
|  ──────────────────────────────────────────────────────  |
|  3 items left          [Clear completed]                 |  ← S4 footer bar
+----------------------------------------------------------+
```

### S1 + S2 + S4 + S3 — Mobile (320–767 px)

```text
+--------------------------------+
|  [ Todo List App ]             |
+--------------------------------+
| [Title input "What needs   ]   |  ← S2 full-width
| [ doing?"                  ]   |
| [Due date ▾] [Priority ▾  ]   |
| [Tag input            ]        |
|             [ + Add button ]   |
+--------------------------------+
| [All] [Active] [Completed]     |  ← S4 filter tabs
| Tag [▾]   Sort [date] [pri]    |
| 3 items left                   |
+--------------------------------+
| [ ] ██ HIGH                    |  ← S3 item card
|  "Buy groceries"               |
|  📅 Jun 22  🏷 food            |
|  [✎ Edit]        [✕ Delete]   |
+--------------------------------+
| [✓] ░░ MED  (strikethrough)   |
|  "Read spec doc"               |
|  [✎ Edit]        [✕ Delete]   |
+--------------------------------+
| [ ] ░░ LOW                     |
|  "Water plants"                |
|  📅 Jun 25                     |
|  [✎ Edit]        [✕ Delete]   |
+--------------------------------+
| 3 left   [Clear completed]     |
+--------------------------------+
```

### S2 — Validation error states

```text
+----------------------------------------------------+
| [Title input — shaking / red border]               |
| ⚠ "Title can't be empty."                         |   ← empty/whitespace error
+----------------------------------------------------+

+----------------------------------------------------+
| [Title input — red border, char counter 201/200]   |
| ⚠ "Title must be 200 characters or fewer."        |   ← over-length error
+----------------------------------------------------+
```

### S3 — Empty list state

```text
+----------------------------------------------------+
|                                                    |
|           ( illustration / friendly icon )         |
|      "Nothing here yet — add your first todo!"    |  ← empty state
|                                                    |
+----------------------------------------------------+
```

### S3a → S3b — Inline edit

```text
Before edit:
| [ ] ██ HIGH  "Buy groceries"  📅 Jun 22   [✎] [✕] |

After ✎ click:
| [ ] ██ HIGH  [Buy groceries         ] [✔] [✖]      |
                  ↑ editable input, pre-filled        |

Edit validation error:
| [ ] ██ HIGH  [                      ] [✔] [✖]      |
               ⚠ "Title can't be empty."              |
```

### S3 — localStorage unavailable (error-storage state)

Banner appears at the very top of the app shell (above the Add form), full-width, persistent for the session. It does NOT block any todo interaction — the list and all CRUD controls remain fully operable beneath it.

```text
Desktop:
+----------------------------------------------------------+
| ⚠ Storage unavailable — your todos won't be saved  [✕] |  ← StorageBanner
|   this session. (Working in-memory only.)                |
+----------------------------------------------------------+
|  [Title input — "What needs doing?"]  [+ Add]           |  ← S2 (unchanged)
|  …                                                       |
+----------------------------------------------------------+

Mobile (320 px):
+--------------------------------+
| ⚠ Storage unavailable —  [✕] |  ← StorageBanner (wraps)
|  todos won't be saved this     |
|  session.                      |
+--------------------------------+
| [Title input "What needs   ]   |  ← S2 (unchanged)
```

Banner rules:

- Background: `--error` (#DC2626) at 10% opacity tint; left border 3 px solid `--error`; text `--error`.
- [✕] dismiss icon: removes banner from view for the current page load only; it reappears on the next reload if storage is still unavailable (non-blocking, not silenced permanently).
- Banner is `role="alert"` so screen readers announce it immediately on mount.
- All S2/S3/S4 interactions remain available; the banner does not intercept clicks or focus order (DOM position: before S2, after the wordmark; focus order: banner dismiss → form → list).
- No toast, no modal, no blocking overlay.

---

## Scenarios

### SC1: Add a new todo (happy path)

- **Actor**: User
- **Precondition**: App is open; list may be empty or populated
- **Satisfies**: AC1, AC6 (counter-case shown in SC2), AC14

1. [S2] User types a non-empty title in the title input
2. [S2] (Optional) User selects a due date, priority, and/or tag
3. [S2] User presses Enter or clicks "+ Add"
4. [S3] New todo item appears at the top/appropriate sort position in the list; active count increments by 1
5. [S2] Input fields reset to empty/default

### SC2: Submit empty or whitespace title (validation error)

- **Actor**: User
- **Precondition**: App is open
- **Satisfies**: AC6

1. [S2] User submits with empty input or only spaces
2. [S2] Input border turns red; inline error message appears ("Title can't be empty."); input shakes
3. [S3] No new item is added; list unchanged
4. [S2] User corrects the title and submits → SC1 step 4 onwards

### SC3: Submit title exceeding max length (validation error)

- **Actor**: User
- **Precondition**: App is open
- **Satisfies**: AC7

1. [S2] User types or pastes more than 200 characters into the title input
2. [S2] Character counter turns red; submission is blocked (button disabled or submit attempt shows error "Title must be 200 characters or fewer.")
3. [S3] No new item is added
4. [S2] User trims input below limit → submit succeeds

### SC4: Toggle todo completion (happy path)

- **Actor**: User
- **Precondition**: At least one todo in the list
- **Satisfies**: AC2, AC14

1. [S3a] User clicks or activates (Space) the checkbox on an active todo
2. [S3a] Todo transitions to completed state: title gains strikethrough + muted style; priority chip and due-date badge dim
3. [S4] Active count decrements by 1; "Clear completed" button becomes visible (if it wasn't)
4. [S3a] User clicks the checkbox again → todo reverts to active; count increments

### SC5: Inline edit — save new title (happy path)

- **Actor**: User
- **Precondition**: At least one todo in the list
- **Satisfies**: AC3, AC8

1. [S3a] User clicks the edit icon (or presses Enter while focused on the item's edit affordance)
2. [S3b] Item title replaces inline with pre-filled edit input; focus moves to input
3. [S3b] User changes the title text
4. [S3b] User presses Enter or clicks the save checkmark
5. [S3a] Item returns to default state displaying the new title

### SC6: Inline edit — cancel or save empty title (error)

- **Actor**: User
- **Precondition**: Inline edit is open (S3b)
- **Satisfies**: AC3 (reject empty edit), AC8 (Escape to cancel)

1. [S3b] User clears the edit input to empty / whitespace and attempts to save
2. [S3b] Inline validation error appears below the edit field; original title is retained
3. [S3b] User presses Escape → edit closes; original title unchanged
4. [S3a] Item returns to default state with original title

### SC7: Delete a todo

- **Actor**: User
- **Precondition**: At least one todo in the list
- **Satisfies**: AC4, AC14

1. [S3a] User clicks or activates (Enter/Space) the delete icon on a todo
2. [S3] Item is removed from the list; active count decrements if the item was active

### SC8: Persist and restore on reload

- **Actor**: User
- **Precondition**: Todos exist in various states
- **Satisfies**: AC5, AC20, AC24

1. [S3] User has multiple todos with varying titles, completion states, due dates, priorities, and tags
2. [S1] User reloads the page (or closes and reopens the tab)
3. [S3] App reads localStorage; list re-renders with all todos and attributes exactly as before
4. [S4] Filter and sort state reset to defaults (unless persistence of UI state is specified — not in scope)

### SC9: Filter the list

- **Actor**: User
- **Precondition**: Mixed list (active + completed todos)
- **Satisfies**: AC11, AC12, AC13, AC16

1. [S4] User clicks "Active" tab → [S3] only incomplete todos shown
2. [S4] User clicks "Completed" tab → [S3] only completed todos shown; if none, empty state shown
3. [S4] User clicks "All" tab → [S3] all todos shown regardless of state
4. [S4] When no completed todos exist, "Clear completed" is hidden

### SC10: Filter by tag

- **Actor**: User
- **Precondition**: Todos with various tags exist
- **Satisfies**: AC22, AC23

1. [S4] User opens the tag-filter dropdown
2. [S4] Only tags present on at least one current todo are listed (plus "All tags" option)
3. [S4] User selects a tag → [S3] only todos carrying that tag are displayed
4. [S4] User selects "All tags" → [S3] full unfiltered (by tag) list restores

### SC11: Clear completed todos

- **Actor**: User
- **Precondition**: At least one completed todo exists
- **Satisfies**: AC15, AC16

1. [S4] "Clear completed" button is visible
2. [S4] User clicks/activates the button
3. [S3] All completed todos are removed from list and localStorage
4. [S4] "Clear completed" button hides; active count unchanged

### SC12: Sort by due date

- **Actor**: User
- **Precondition**: Todos with and without due dates exist
- **Satisfies**: AC18

1. [S4] User activates "Sort by date" control
2. [S3] List re-orders: todos with earliest due dates first; undated todos at the end

### SC13: Sort by priority

- **Actor**: User
- **Precondition**: Todos with varying priorities exist
- **Satisfies**: AC19

1. [S4] User activates "Sort by priority" control
2. [S3] List re-orders: High → Medium → Low → no-priority

### SC14: Add todo with due date, priority, and tag (happy path)

- **Actor**: User
- **Precondition**: App is open
- **Satisfies**: AC17, AC21

1. [S2] User fills in title, selects a due date, picks a priority, types a tag
2. [S2] User submits
3. [S3a] New item appears with priority chip (color-coded), due-date badge, and tag chip visible on the item row

### SC15: Keyboard-only full CRUD + filter flow

- **Actor**: User (keyboard only, no pointer)
- **Precondition**: App is open, list may be empty
- **Satisfies**: AC8, AC9

1. [S2] User Tabs to title input, types a title, presses Enter → item added (SC1)
2. [S3a] User Tabs to the new item's checkbox, presses Space → item completes (AC2)
3. [S3a] User Tabs to edit icon, presses Enter → inline edit opens (SC5)
4. [S3b] User edits title, presses Enter → saved
5. [S3a] User Tabs to delete icon, presses Enter → item removed (SC7)
6. [S4] User Tabs to filter tabs, presses Enter on "Active" → filter applied
7. At each step, focused element has a visible focus ring; screen-reader-meaningful ARIA labels announced

### SC16: localStorage unavailable

- **Actor**: User
- **Precondition**: Browser private mode, storage quota exceeded, or write failure
- **Satisfies**: AC5 (storage failure path), FR-001 (degradation behaviour)

1. [S1] App initialises; localStorage read/write fails (detected on first read or write attempt)
2. [S1] `StorageBanner` mounts at top of shell: "⚠ Storage unavailable — your todos won't be saved this session." — persistent, non-blocking
3. [S3] App enters `error-storage` state: list renders empty (no persisted data to restore); all CRUD controls remain fully operable
4. [S2] User can still add todos, complete them, edit, delete — all operate in-memory for the session; no UI interaction is blocked
5. [S1] User clicks [✕] on banner → banner dismisses for this page load; todos continue in-memory without interruption
6. [S1] User reloads the page → banner reappears (storage still unavailable); in-memory todos from the prior session are gone (expected — no silent loss, user was warned)

---

## UX Direction & Components

### Direction / Style

Playful + colorful. Rounded corners (8–16 px radius), generous padding, bright accent palette. Friendly copywriting (empty state: "Nothing here yet — add your first todo!"; error: "Title can't be empty."). No dark mode (out of scope per spec). Justification: spec calls out "playful / colorful / bold accent colors / friendly tone."

### Palette


| Token             | Color                | Use                                                |
| ----------------- | -------------------- | -------------------------------------------------- |
| `--priority-high` | #EF4444 (red-500)    | High priority chip background / left border stripe |
| `--priority-med`  | #F59E0B (amber-500)  | Medium priority chip                               |
| `--priority-low`  | #22C55E (green-500)  | Low priority chip                                  |
| `--accent`        | #6366F1 (indigo-500) | Add button, active filter tab, focus ring          |
| `--surface`       | #FFFFFF              | Card background                                    |
| `--bg`            | #F3F4F6 (gray-100)   | Page background                                    |
| `--text-primary`  | #111827              | Titles                                             |
| `--text-muted`    | #9CA3AF              | Completed text, metadata                           |
| `--error`         | #DC2626              | Validation error text + border                     |


Priority chips: small pill badge left of the title, solid background color. Completed items: title `text-decoration: line-through`, everything at 60% opacity.

### Information Architecture / Layout

Single-page, no routing. Vertical stack: App title → Add form → Toolbar (filters + sort + count) → Todo list → Footer count + Clear. Max content width 640 px, centered with `margin: 0 auto`, full-width on mobile. This keeps the single-screen constraint from spec (no routing, no panels).

### Key Components

All net-new (greenfield; no existing design system):


| Component            | Purpose                                                             | Justification                                                                       |
| -------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `AddForm`            | S2: title + optional fields form                                    | Core entry point; groups related inputs                                             |
| `Toolbar`            | S4: filter tabs + tag dropdown + sort toggles + count               | Separates list-control affordances from list content                                |
| `TodoItem` (default) | S3a: one todo row                                                   | Encapsulates all per-item controls                                                  |
| `TodoItemEdit`       | S3b: inline-edit state of TodoItem                                  | Swaps title for input in-place; no modal needed (single-screen constraint)          |
| `PriorityChip`       | Colored pill for Low/Med/High                                       | Centralises priority color-coding; reused in form + list                            |
| `EmptyState`         | S3 empty illustration + copy                                        | Required first-class state                                                          |
| `InlineError`        | Error text below a field                                            | Reused by S2 and S3b                                                                |
| `StorageBanner`      | Persistent non-blocking top banner when localStorage is unavailable | Required by FR-001 / AC5 degradation path; net-new, no existing component covers it |


### Interaction & Feedback States

- **Loading** (S3 initial): skeleton shimmer rows (2–3) while localStorage is read; transitions to populated or empty.
- **Empty** (S3): centered illustration + friendly copy; no skeleton.
- **error-storage** (S3): persistent `StorageBanner` at top of shell (role="alert", dismissible per page load); all todo interactions remain fully operable beneath it; app runs in-memory for the session.
- **Validation error** (S2, S3b): red border on input + inline `InlineError` below; input shake animation (CSS `@keyframes shake`, ~300 ms). No toast — feedback is adjacent to the offending field.
- **Success add** (S3): new item slides/fades in from top (CSS transition, ~200 ms); no toast needed (item is immediately visible).
- **Completed** (S3a): strikethrough + opacity transition (~150 ms).
- **Focus**: 2 px `outline` in `--accent` color, 2 px offset — visible on all interactive elements, never `outline: none` without replacement.
- **Disabled**: "Clear completed" hidden (not disabled) when no completed todos — avoids explaining disabled state to users.
- **Overdue** (S3a): due-date badge turns red when date < today and item is active; no separate state, just badge color change.

### Responsive

- **320–767 px (mobile)**: single column; todo item stacks title below badges; Edit/Delete buttons at full touch-target size (min 44 × 44 px); due-date picker uses native `<input type="date">`; priority selector uses native `<select>` (avoids custom dropdown complexity on small screens).
- **768–1279 px (tablet)**: same single-column layout, wider max-content container (640 px centered).
- **1280 px+ (desktop)**: layout unchanged (single-column app; no side panels per spec). Max-width 640 px keeps line length comfortable.

No horizontal overflow from 320 px: all inputs `box-sizing: border-box; width: 100%`; item controls use `flexbox` with `flex-wrap: wrap`.

### Accessibility

- All interactive controls carry explicit ARIA labels where text is not self-describing (icon buttons: `aria-label="Edit todo"`, `aria-label="Delete todo"`, checkbox: `aria-label="Mark complete"`).
- Filter tabs use `role="tablist"` / `role="tab"` / `aria-selected`.
- Todo list: `<ul>` with `role="list"`; each item `<li>`.
- Live count region: `aria-live="polite"` so screen readers announce updates without interrupting.
- Inline errors: `role="alert"` on `InlineError` component; inputs linked via `aria-describedby`.
- Focus order follows DOM order (top → form → toolbar → list → footer).
- Visible focus ring on every interactive element (never suppressed).
- Color is not the only signal for priority: chip includes text label (Low / Med / High) alongside color — satisfies WCAG 1.4.1.
- `measured:` targets for contrast ratios are owned by QA (spec NFR, not re-specified here).

---

## AC ↔ Scene Mapping


| AC                                               | Scene(s)                       | Scenario(s)                           | Notes                                                                             |
| ------------------------------------------------ | ------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------- |
| AC1 — add new todo                               | S2, S3                         | SC1                                   |                                                                                   |
| AC1 (boundary: empty/whitespace)                 | S2 (`validation-error-empty`)  | SC2                                   | See also AC6                                                                      |
| AC2 — toggle completion                          | S3a, S4                        | SC4                                   | Count update via S4 live count                                                    |
| AC3 — inline edit save                           | S3b                            | SC5                                   |                                                                                   |
| AC3 (boundary: edit to empty)                    | S3b (`edit-validation-error`)  | SC6                                   |                                                                                   |
| AC4 — delete todo                                | S3a, S3                        | SC7                                   |                                                                                   |
| AC5 — persist + restore on reload                | S3 (`loading` → `populated`)   | SC8                                   | Visible reflection: list re-renders from localStorage                             |
| AC5 (edge: storage unavailable)                  | S1, S3 (`error-storage`)       | SC16                                  | StorageBanner shown; app continues in-memory; no silent data loss; UI not blocked |
| AC6 — reject empty/whitespace submit             | S2 (`validation-error-empty`)  | SC2                                   | Inline error + shake                                                              |
| AC7 — reject over-length submit                  | S2 (`validation-error-length`) | SC3                                   | Char counter; button disabled or blocked                                          |
| AC8 — keyboard operability                       | S2, S3a, S3b, S4               | SC15                                  | All controls Tab/Enter/Space/Escape reachable                                     |
| AC9 — ARIA labels + visible focus                | S2, S3a, S3b, S4               | SC15                                  | Focus ring in `--accent`; labels on icon buttons; `aria-live` count               |
| AC10 — responsive ≤ 480 px                       | S1, S2, S3, S4                 | SC15 (all steps at 320 px)            | Touch targets ≥ 44 × 44 px; no overflow                                           |
| AC11 — Active filter                             | S3, S4                         | SC9 step 1                            |                                                                                   |
| AC12 — Completed filter                          | S3, S4                         | SC9 step 2                            |                                                                                   |
| AC13 — All filter                                | S3, S4                         | SC9 step 3                            |                                                                                   |
| AC14 — live active count                         | S4                             | SC1 step 4, SC4 steps 3–4, SC7 step 2 | `aria-live="polite"` region                                                       |
| AC15 — Clear completed                           | S3, S4                         | SC11                                  |                                                                                   |
| AC16 — Clear completed hidden/disabled when none | S4 (`clear-completed-hidden`)  | SC9 step 4, SC11 step 4               | Button hidden, not disabled                                                       |
| AC17 — save due date + priority with todo        | S2, S3a                        | SC14                                  | Priority chip + due-date badge on item                                            |
| AC18 — sort by due date ascending                | S3, S4                         | SC12                                  | Undated todos at end [inferred — confirm at gate]                                 |
| AC19 — sort by priority High→Low                 | S3, S4                         | SC13                                  |                                                                                   |
| AC20 — restore due date + priority on reload     | S3                             | SC8                                   | Visible reflection: badges restore                                                |
| AC21 — save tag with todo                        | S2, S3a                        | SC14                                  | Tag chip on item                                                                  |
| AC22 — filter by tag                             | S3, S4                         | SC10                                  |                                                                                   |
| AC23 — tag filter lists only existing tags       | S4 (tag dropdown)              | SC10 step 2                           | Dynamic options                                                                   |
| AC24 — restore tag on reload                     | S3                             | SC8                                   | Visible reflection: tag chip restores                                             |


