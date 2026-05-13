# Todolist — zero-install example

A reference example produced by the `/dev` workflow run `0002-feat-todolist-app`. Vanilla HTML + CSS + ES modules, persisted to `localStorage`. No build step, no dependencies, no server.

## Run it

```bash
# macOS
open examples/todolist/index.html

# Linux
xdg-open examples/todolist/index.html
```

If your browser blocks ES module loads over `file://` (rare — current Chrome / Safari / Firefox allow it), serve the folder over any static server:

```bash
python3 -m http.server --directory examples/todolist 8000
# then visit http://localhost:8000/
```

## What's inside

```
examples/todolist/
├── index.html           # markup + module entry
├── styles.css           # styling (no framework)
├── tests.html           # in-browser smoke harness for the pure store
└── src/
    ├── store.js         # pure state module — actions, selectors, subscribe. No DOM.
    ├── render.js        # DOM rendering + event wiring against the store
    └── main.js          # bootstrap: load localStorage, create store, wire events
```

The split is intentional: `store.js` is a pure module (state in → state out) so it can be exercised by `tests.html` without rendering. `render.js` and `main.js` are the impure shell — they touch the DOM and `localStorage`. This is the same `pure-core, side-effects at the edge` pattern the foundation's `programming-fundamentals` skill recommends, applied at example scale.

## Run the smoke tests

```bash
open examples/todolist/tests.html
```

The page reports `15 / 15 passed` (or red if anything regresses). The same assertions are runnable headlessly via `node --input-type=module` — see `.workflow/0002-feat-todolist-app/tests.md > Commands`.

## Storage

State lives under the `localStorage` key `examples-todolist:v1`. Clearing site data, or running:

```js
localStorage.removeItem('examples-todolist:v1')
```

…in the browser console will reset the app to an empty list.

## Workflow artifacts

The full spec, plan, review, tests, and retro for this example live under [`.workflow/0002-feat-todolist-app/`](../../.workflow/0002-feat-todolist-app/).
