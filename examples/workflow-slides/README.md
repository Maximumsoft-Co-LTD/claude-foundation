# Workflow slides

An interactive, visual deck explaining the `/dev` workflow — the two-phase, type-aware, resumable loop documented in `../../WORKFLOW.md`.

Single-file static site. No build step, no dependencies. Open `index.html` in any browser.

## What's in it

12 slides, each with its own little interactive piece:

1. **Title** — animated typed-intent showing different `/dev <intent>` examples.
2. **The shape** — the two phases and the ten numbered steps.
3. **Type-aware** — tabbed matrix; pick `feat | fix | refactor | chore | docs | spike` and see which phases run, skip, or run light.
4. **Six agents** — click a tile to see what each agent owns (reads, writes, phases).
5. **Artifacts** — clickable file tree of `.workflow/<id>/`; each artifact card explains its owner + purpose.
6. **The gate** — mock approval card with `approve | revise | swap` buttons.
7. **Live flow** — press play and watch a `feat` run animate through the strip, including a review cycle bump.
8. **Security trigger** — click changed paths to see which ones fire phase 7 and why.
9. **State + resume** — tick to advance one step; `state.json` updates live like a real run.
10. **Cycle limits** — review at 2, test at 3, escalation rule.
11. **Examples** — three end-to-end runs (feat / fix / spike) side by side.
12. **Outro** — one-sentence summary + stats.

## Keyboard

- `→` / `Space` next slide
- `←` previous slide
- `Home` / `End` first / last
- `?` toggle help overlay

## Files

```
workflow-slides/
├── index.html
├── styles.css
├── README.md
└── src/
    ├── main.js
    ├── deck.js
    └── slides/
        ├── title.js
        ├── types.js
        ├── agents.js
        ├── artifacts.js
        ├── gate.js
        ├── flow.js
        ├── security.js
        └── resume.js
```

## Running

```
open index.html
```

Or any static server:

```
python3 -m http.server 8000 --directory .
# then http://localhost:8000/
```
