# Plan: Passcode gate for the 3D solar system

**Spec**: [./spec.md](./spec.md)
**Type**: feat
**Size**: S
**Field**: brownfield
**Status**: draft

## Summary

Wrap the existing static solar-system showcase behind a client-side passcode gate, entirely inside the single file `solar-system/index.html`. The load-bearing move: the current module script runs its whole scene setup at top level on load, so we extract that setup + animation loop into a single `initScene()` function and only invoke it once a passcode (or a persisted session) unlocks — this makes "the scene must not initialize until unlocked" literally true (no WebGL context, no canvas) rather than merely hidden with CSS, which the spec rejects. Session persistence is a single `localStorage` marker; Logout clears it and `location.reload()`s (chosen over hand-rolled WebGL teardown — cheaper and guaranteed-clean for a showcase). US1 (gate) is the shippable slice; US2 (persist) and US3 (logout) layer on top.

## Technical Context

**Language**: HTML + vanilla ES2020 (inline `<script type="module">`) · **Framework**: Three.js 0.160.0 (ESM via unpkg import-map — already loaded, unchanged)
**Storage**: `localStorage` — one string key (session marker); no DB, no schema, no migration · **Testing**: none in repo today → test-plan proposes Playwright as a dev-only functional harness (see `test-plan.md`)
**Target**: browser, served over `http(s)` (as today) · **Perf**: gate paints < 100 ms, no WebGL work when gated (SC-002) · **Scale**: single static file, single user

## Gate check

Against `.claude/rules/fundamentals.md` — layers this work crosses:

- **Trust boundary (`security-fundamentals`)**: The passcode input is compared client-side. This is **not** a real trust boundary — passcode + logic are in page source (explicit accepted non-goal, see spec). Mark the compare with `ponytail: client-side passcode — upgrade path is a backend if real auth is ever needed`. Build the gate DOM with static HTML + `textContent`/`createElement`, **never `innerHTML`/`eval`/`document.write`**, so the diff introduces no HTML-injection sink (keeps the security review clean). The `localStorage` round-trip is first-party single-user string read (not untrusted deserialization). **Predict:** this diff touches the `auth/session` bucket, so Phase 7 (security) likely fires — its expected verdict is *documents the accepted client-side-only limitation*, with no `high` findings provided no `innerHTML` sink is introduced. We predict, never suppress.
- **Ponytail**: Gate is plain HTML/CSS/vanilla JS — no framework, no crypto, no backend, no new app dependency (Three.js already present; native platform features cover everything). The minimum that gates. Logout via `location.reload()` avoids a manual teardown routine.
- **Accessibility (`programming-fundamentals`/frontend)**: The gate is a form — labeled passcode input, Enter submits, focus lands on the input on show, error announced via `role="alert"`/`aria-live` (FR-011).
- **Observability / new dependency / concurrency / database**: none for the shipped app. (Dev-only Playwright is `security-fundamentals`' call and is separate from the artifact — see test-plan.)

## Current state (brownfield — entry-point + blast-radius)

Single touched file: `solar-system/index.html`. No other file imports or references it; blast radius is this file only (verified: it is a standalone static page, no build graph).

- **Entry point** — `solar-system/index.html` `<script type="module">` (line 125). The module body runs immediately on load (script is at end of `<body>`, after `#app` at line 96 exists).
- **Scene-init region** — the top-level statements from `const container = document.getElementById("app")` (line 236) through the final `animate();` call (line 491): scene/camera/`WebGLRenderer` + `container.appendChild(renderer.domElement)` (line 253), lights, starfield, sun/planet meshes, orbit rings, `OrbitControls` (line 342), raycaster click→`focusPlanet`/`deselect` (lines 353–433), resize handler, and the `animate()` RAF loop (lines 449–491).
- **Invariant relied on** — this region only needs `#app` to exist and to run after DOM parse; it has no dependency on being at module top level. Moving lines 233–491 into `function initScene()` and calling it after unlock is **behaviour-equivalent** as long as it is invoked once, after DOM ready (already the case). The `PLANETS`/`SUN` data consts (lines 132–231) are pure data with no side effects — leave at module scope so `initScene` closes over them.
- **Baseline (characterization)** — before the change, load the current page and record: `#app` gets exactly one `<canvas>`, 8 planets orbit, sun + orbit rings + starfield render, drag/zoom + click-a-planet info panel work, zero console errors. Post-change unlocked state must match this (SC-001). See `test-plan.md > Baseline`.

## Phases for this task

feat / S matrix defaults:
- **Phase 5 Test**: run (Playwright functional harness — see test-plan).
- **Phase 6 Review**: run.
- **Phase 7 Security**: trigger-based — **predicted to fire** (`auth/session` bucket). Not suppressed; expected to document the accepted non-goal.
- **Phase 8 Docs**: `skip (deviates from matrix)` — the solar-system showcase has no user/dev doc surface (repo docs describe the workflow product, not this app); the passcode config is self-documented by an inline comment at the const (part of the implement task), so no separate docs pass is warranted.

## Fanout plan

No fanout — single-pass. Single file, contained blast radius.

## Architecture diagram

```mermaid
flowchart TD
  L[Page load] --> C{localStorage[SESSION_KEY] === SESSION_VALUE?}
  C -- yes --> S[initScene: render 3D solar system + reveal Logout]
  C -- no --> G[Show passcode gate · scene NOT initialized]
  G --> I[/User submits passcode/]
  I --> V{input === PASSCODE and non-empty?}
  V -- no / empty --> E[Show error · stay gated · no scene]
  E --> G
  V -- yes --> W[Set localStorage session marker] --> S
  S --> O[/Click Logout/]
  O --> X[Clear localStorage · location.reload]
  X --> L
```

## Risks

- **`localStorage` unavailable** (private mode / disabled): wrap access in `try/catch` so the gate still functions for the current load and persistence degrades silently (no throw). Covered by test-plan edge case + hardening note on the session read/write tasks.
- **Double-submit** re-initializing the scene twice: guard `initScene()` to run at most once.
- **Passcode value** is a placeholder default; owner must change it in the one config const before any real use (it is still not confidentiality — see non-goal).

## Rollback

Single file — `git checkout -- solar-system/index.html` restores the pre-gate showcase. No data, migration, or external state to unwind.

---
*Tasks (the executable `T###` steps) live in [./tasks.md](./tasks.md).*
