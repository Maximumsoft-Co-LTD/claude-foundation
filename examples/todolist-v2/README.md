# Todolist v2 — zero-install example

A reference example produced by the `/dev` workflow run `0002-feat-todolist`. Vanilla HTML + CSS + JS, persisted to `localStorage`. No framework, no build step, no runtime dependencies — open `index.html` directly in a browser.

## Run it

```bash
# macOS
open examples/todolist-v2/index.html

# Linux
xdg-open examples/todolist-v2/index.html
```

Or double-click `index.html` in Finder / Explorer. If `localStorage` is unavailable (private-browsing quirks, quota exceeded mid-session), the app degrades to in-memory storage automatically and shows a persistent warning banner — no data is lost during that session.

## Features

- **CRUD + persistence** — add, inline-edit (double-click or ✎), delete, toggle complete; state survives page reload via `localStorage`.
- **Validation** — empty/whitespace and >200-character titles are rejected with inline error messages.
- **Filter tabs** — All / Active / Completed.
- **Live count** — "N item(s) left" updates on every change.
- **Clear completed** — bulk-removes all done items.
- **Due date + priority** — optional date picker and High/Medium/Low priority per item; sortable by either (click sort button to toggle, click again to reset).
- **Tag filter** — single free-text tag per item; dropdown filters the list to a selected tag.
- **Accessibility** — full keyboard navigation, ARIA labels/roles, `aria-selected` on filter tabs, `aria-pressed` on sort buttons, responsive layout.
- **localStorage degradation** — if storage is unavailable at load or fails mid-session (quota), a banner appears and the app continues in-memory for the rest of the session.

## Run the tests

```bash
cd examples/todolist-v2
npm install
npm test
```

78 tests: vitest + jsdom unit/integration tests for `Store`, `Renderer`, `App`, and helpers; Playwright e2e + visual + a11y tests in `tests/`. The shipped app itself has **zero runtime dependencies** — `package.json` carries only `devDependencies` (test tooling).

## Structure

```
examples/todolist-v2/
├── index.html           # markup + entry point
├── style.css            # styling (no framework)
├── app.js               # Store (data + localStorage) / Renderer (DOM) / App (wiring)
└── tests/
    ├── unit/            # vitest+jsdom unit + integration tests
    └── e2e/             # Playwright e2e, visual, and a11y tests
```

## Workflow artifacts

The full spec, plan, review, tests, and retro for this example live under [`.workflow/0002-feat-todolist/`](../../.workflow/0002-feat-todolist/).
