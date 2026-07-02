# Tasks: Passcode gate for the 3D solar system

**Plan**: [./plan.md](./plan.md) · **Spec**: [./spec.md](./spec.md)
**Status**: draft

> **For humans** — each `- [ ]` is one build step, in order; read the action + its `verify:`. The `T001`/`[P]`/`[AC1]`/`path#anchor` codes are for the build agents. `🎯` = smallest shippable slice.

All edits are in the single file `solar-system/index.html`. `[P]` = parallel-safe (observe-only, no file edit). `[AC#]`/`[FR-###]`/`[SC-###]`/`[DoD]` tie each task to what it delivers.

## Phase 1: Baseline (brownfield — blocks all feature work)

- [x] **T001** [SC-001] Capture the characterization baseline of the current scene — `solar-system/index.html#script` (observe, no edit) — verify: load the current file over a static server → `#app` contains exactly one `<canvas>`, 8 planets orbit, sun + orbit rings + starfield render, drag/zoom works, clicking a planet opens the info panel with facts, zero console errors. Record this as the "unlocked scene must match" reference (see `test-plan.md > Baseline`).

## Phase 2: Foundational (blocks all stories)

- [x] **T002** [AC4] [SC-001] Extract the scene setup + animation loop (current lines ~233–491, from `const container` through the final `animate()` call) into `function initScene() { … }`; keep `PLANETS`/`SUN` data at module scope; guard so `initScene()` runs at most once — `solar-system/index.html#script` (edit) — verify: temporarily call `initScene()` on load → scene renders identically to the T001 baseline (canvas present, 8 planets, no console errors); calling it twice does not create a second `<canvas>`.
- [x] **T003** [FR-001] [SC-003] Add a single top-of-script config block: `const PASSCODE = "…"` (documented default placeholder), `const SESSION_KEY = "solar-system-auth"`, `const SESSION_VALUE = "unlocked"`, with a `ponytail: client-side passcode — upgrade path is a backend if real auth is ever needed` comment — `solar-system/index.html#script` (edit) — verify: the three consts exist at the top of the module in one place; `grep -c` shows a single definition site for each.

## Phase 3: US1 — Gate blocks the scene until unlocked (P1) 🎯 MVP

- [x] **T004** [AC1] [FR-002] [FR-009] [FR-011] Add the gate overlay: markup for a labeled passcode `<input>`, a submit button, and an error region (`role="alert"`/`aria-live`), styled to mirror the `#info-panel` glass aesthetic (translucent dark `rgba(10,12,24,.82)` panel, `1px solid rgba(255,255,255,.15)` border, `border-radius:12px`, `backdrop-filter:blur(6px)`, `#eef2ff` text, same system font stack); build all dynamic text via `textContent`/`createElement`, never `innerHTML`. On an un-unlocked load, show the gate and do NOT call `initScene()` — `solar-system/index.html` (edit) — verify: load page with empty `localStorage` → gate visible + themed, focus on the input, and `#app` has NO `<canvas>`.
- [x] **T005** [AC4] [FR-005] [FR-008] Wire submit for the correct passcode: on `input === PASSCODE` → write `localStorage[SESSION_KEY]=SESSION_VALUE` (wrapped in `try/catch`), hide the gate, call `initScene()`, reveal the Logout control — `solar-system/index.html#script` (edit) — verify: enter the correct passcode → gate hidden, `#app` gains a `<canvas>`, scene renders, dragging + clicking a planet works, Logout visible, `localStorage[SESSION_KEY]==="unlocked"`.
- [x] **T006** [AC2] [FR-003] On an incorrect passcode → set the error region text via `textContent`, keep the gate visible, do NOT call `initScene()`, do NOT write `localStorage`, clear + refocus the input — `solar-system/index.html#script` (edit) — verify: enter a wrong passcode → error text announced, gate still visible, `#app` still has no `<canvas>`, no session key written.
- [x] **T007** [AC3] [FR-004] Reject empty/whitespace-only submit before comparing (trim; empty → show error, no unlock) — `solar-system/index.html#script` (edit) — verify: submit an empty (and a spaces-only) input → error shown, gate visible, no `<canvas>`, no session key.

**Checkpoint** — US1 testable on its own. Shippable MVP: the gate deters access and correct passcode reveals the scene.

## Phase 4: US2 — Session persists across reloads (P2)

- [x] **T008** [AC5] [FR-006] On load, before showing the gate, read `localStorage[SESSION_KEY]` (wrapped in `try/catch`); if it `=== SESSION_VALUE` → skip the gate, call `initScene()`, reveal Logout — `solar-system/index.html#script` (edit) — verify: unlock, then reload → gate NOT shown, `#app` has a `<canvas>` directly, Logout visible.
- [x] **T009** [AC6] [FR-007] Treat only the exact `SESSION_VALUE` as unlocked — absent, empty, or any other value shows the gate — `solar-system/index.html#script` (edit) — verify: set `localStorage[SESSION_KEY]="bogus"` and reload → gate shown, no `<canvas>`; remove the key and reload → gate shown, no `<canvas>`.

## Phase 5: US3 — Logout returns to the gate (P3)

- [x] **T010** [AC7] [FR-008] Add the Logout control (visible only when unlocked, themed to match); on click → remove `localStorage[SESSION_KEY]` (wrapped in `try/catch`) then `location.reload()`, with a `ponytail: full reload chosen over manual WebGL teardown for a showcase` comment — `solar-system/index.html` (edit) — verify: from the unlocked scene, click Logout → session key gone, page returns to the gate, `#app` has no `<canvas>`.
- [x] **T011** [AC8] After logout the gate stays on reload (no auto re-unlock) — `solar-system/index.html#script` (edit) — verify: log out, then reload → gate shown, no `<canvas>`, no session key present.

## Phase 6: Polish

- [x] **T012** [P] [SC-001] Regression: confirm the unlocked scene matches the T001 baseline — `solar-system/index.html` (observe) — verify: unlock → 8 planets orbit, sun + orbit rings + starfield present, drag/zoom/pan works, click-a-planet info panel + close/deselect work, zero new console errors — identical to baseline.
- [x] **T013** [P] [FR-010] [FR-011] [DoD] Confirm the app is still a single static file and the gate is accessible — `solar-system/index.html` (observe) — verify: no backend/build/server/`package.json` added to the app; the file works standalone over a static server; keyboard-only unlock works (tab to input, type, Enter), focus lands on the input when the gate shows, and the error carries `role="alert"`/`aria-live`.

---

### AC → task coverage

- **AC1** (gate shown, scene not initialized) → T004 (deliver + verify)
- **AC2** (wrong passcode → error, stay gated) → T006
- **AC3** (empty passcode → rejected) → T007
- **AC4** (correct passcode → unlock + scene) → T002 (extract), T005 (deliver + verify)
- **AC5** (persist across reload) → T008
- **AC6** (absent/tampered session → gate) → T009
- **AC7** (logout → gate + session cleared) → T010
- **AC8** (post-logout reload stays gated) → T011
- **SC-001** (scene unchanged / baseline) → T001, T002, T012
- **FR-001/SC-003** (config const, one place) → T003
- **FR-009** (themed gate) → T004
- **FR-010** (single static file) → T013
- **FR-011** (a11y) → T004, T013

*Dependencies: T001 → T002 → T003 gate all stories. Within US1: T004 (gate shell) → T005/T006/T007 (submit branches). US2/US3 depend on T005's session write + gate/init helpers. `[P]` tasks (T012/T013) are observe-only, no file conflict. Every AC has a delivering + verifying task.*
