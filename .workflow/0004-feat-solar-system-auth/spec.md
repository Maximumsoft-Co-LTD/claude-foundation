# Spec: Passcode gate for the 3D solar system

**ID**: `0004-feat-solar-system-auth`
**Type**: feat
**Status**: draft
**Ship as**: one-drop
**Open PR on ship**: no
**E2E + visual**: off
**Parent**: none

## Goal *(required)*

Gate the existing static 3D solar-system showcase (`solar-system/index.html`) behind a single shared passcode entered client-side. Nothing renders until the correct passcode is entered; the unlocked state persists across reloads via `localStorage`; a themed Logout button clears the session and returns to the gate. The gate matches the page's existing dark/glassy space aesthetic. The app stays a single static HTML file — no backend, build step, or server.

## User Stories *(required)*

### US1 — Gate blocks the scene until unlocked (Priority: P1) 🎯 MVP

A visitor must enter the correct passcode before the 3D scene appears; a wrong or empty passcode keeps them out with a clear error.

**Why this priority**: This is the whole point of the feature — the deterrent gate. Without it there is nothing to persist or log out of.
**Independent test**: Open the page with no prior session; confirm the gate is the only thing shown and the scene is not initialized; try wrong/empty/correct passcodes and observe the gate's response.

**Acceptance scenarios**

- [x] **AC1** — Given a visitor with no prior session, When the page loads, Then the passcode gate is shown as the first and only thing, and the 3D scene is NOT initialized (`#app` contains no `<canvas>`, no WebGL context, the animation loop is not running). Evidence: live headless-Chrome CDP check on fresh context → `AC1_canvasCount: 0`, `AC1_gateVisible: true`, `AC1_inputFocused: true` (`solar-system/index.html#gate` shown, `initScene()` not called — bootstrap at `solar-system/index.html` near the closing `</script>`).
- [x] **AC2** (boundary — wrong passcode) — Given the gate is shown, When the visitor submits an incorrect passcode, Then an error message is displayed, the gate stays visible, and the scene remains uninitialized (no `<canvas>`, no session stored). Evidence: CDP submit of `"wrongpass"` → `AC2_error: "Incorrect passcode."`, `AC2_canvasCount: 0`, `AC2_sessionUnset: null`, `AC2_inputCleared: true` (`gateForm` submit handler, `solar-system/index.html`).
- [x] **AC3** (boundary — empty passcode) — Given the gate is shown, When the visitor submits an empty or whitespace-only input, Then submission is rejected with an error, the gate stays visible, and the scene remains uninitialized (no accidental unlock on empty). Evidence: CDP submit of `"   "` → `AC3_error: "Enter a passcode."`, `AC3_canvasCount: 0`, `AC3_sessionUnset: null` (trim-then-check in `gateForm` submit handler).
- [x] **AC4** (happy path) — Given the gate is shown, When the visitor submits the correct passcode, Then the gate is dismissed, the 3D scene initializes and renders, the existing interactions (drag-rotate, scroll-zoom, click-a-planet info panel) work, and a Logout control becomes visible. Evidence: CDP submit of configured `PASSCODE` → `AC4_gateHidden: true`, `AC4_canvasCount: 1`, `AC4_session: "unlocked"`, `AC4_logoutVisible: true`; separate console-error capture during unlock + simulated pointer drag → zero errors (`unlock()`/`initScene()`, `solar-system/index.html`).

### US2 — Session persists across reloads (Priority: P2)

Once unlocked, the visitor should not be re-prompted on reload within the same browser.

**Why this priority**: Convenience layer on top of the P1 gate; the gate is fully usable without it, but re-entering the passcode every reload is poor UX.
**Independent test**: Unlock once, reload, confirm the scene appears directly with no gate; then tamper the stored value and confirm the gate returns.

**Acceptance scenarios**

- [x] **AC5** (happy path) — Given the visitor unlocked earlier in this browser, When they reload the page, Then the gate is NOT shown — the scene initializes directly from the stored session. Evidence: seeded `localStorage[SESSION_KEY]="unlocked"` before navigation, live headless-Chrome check (with software-WebGL flags) → 1 `<canvas>` present, gate has no `visible` class (bootstrap branch in `solar-system/index.html`).
- [x] **AC6** (boundary — absent/tampered session) — Given the `localStorage` session key is absent, empty, or holds any value other than the exact expected marker, When the page loads, Then the gate is shown (no false unlock from a stale or garbage value). Evidence: seeded `localStorage[SESSION_KEY]="bogus"` → gate `visible` class present, 0 canvases; absent-key case covered by AC1 (`readSession() === SESSION_VALUE` strict-equality check in bootstrap).

### US3 — Logout returns to the gate (Priority: P3)

An unlocked visitor can end their session and re-lock the app.

**Why this priority**: Completes the session lifecycle; lowest priority because a session that only ends by clearing storage is still functional.
**Independent test**: From the unlocked scene, click Logout and confirm the gate returns and the stored session is gone; reload and confirm the gate is still shown.

**Acceptance scenarios**

- [x] **AC7** (happy path) — Given the visitor is unlocked with the scene showing, When they click Logout, Then the session is cleared from `localStorage` and they are returned to the gate with the scene no longer rendering. Evidence: CDP click on `#logout-btn` (which triggers `location.reload()`) → post-reload `AC7_sessionAfterLogout: null`, `AC7_gateVisibleAfterLogout: true`, `AC7_canvasCountAfterLogout: 0`.
- [x] **AC8** (boundary — logout durability) — Given the visitor has logged out, When they reload the page, Then the gate is still shown (logout durably cleared the session; no auto re-unlock). Evidence: fresh navigation after logout → `AC8_gateVisible: true`, `AC8_canvasCount: 0`, `AC8_session: null`.

### Edge Cases

- Passcode with surrounding whitespace only → treated as empty (rejected). A passcode of pure whitespace is not a valid configured passcode.
- Rapid double-submit of the correct passcode → the scene initializes exactly once (no double WebGL context).
- `localStorage` unavailable/blocked (e.g. private-mode restrictions) → the gate still works for the current load; persistence silently degrades (the gate must not throw or break).
- Determined bypass via devtools (manually setting the session key, reading the passcode from source, calling scene-init from the console) → **accepted, out of scope** — see Non-goals.

## Requirements *(required)*

### Functional Requirements

- **FR-001** — A single shared passcode gates the app, defined as a `const` in one obvious top-of-script place (configurable without hunting).
- **FR-002** — The gate is the first thing shown on an un-unlocked load; the 3D scene must not initialize until the correct passcode is entered.
- **FR-003** — An incorrect passcode shows an error and leaves the app gated.
- **FR-004** — An empty/whitespace-only submission is rejected (no unlock).
- **FR-005** — The correct passcode dismisses the gate, initializes the scene, and preserves all existing interactions.
- **FR-006** — The unlocked state is persisted in `localStorage` and survives a reload.
- **FR-007** — Only the exact expected session marker unlocks; any other/absent value shows the gate.
- **FR-008** — A Logout control is visible only when unlocked; activating it clears the session and returns to the gate.
- **FR-009** — The login screen matches the existing dark/glassy space aesthetic (mirrors the `#info-panel` glass treatment — translucent dark panel, subtle light border, rounded corners, backdrop blur, light text, same system font stack).
- **FR-010** — The app remains a single static HTML file; no backend, build step, server, or app-runtime dependency is added. Any test tooling is dev-only and separate from the shipped artifact.
- **FR-011** — The gate UI is accessible: the passcode input has a label, Enter submits, focus lands on the input, and the error message is announced (`role="alert"`/`aria-live`).

### Key Entities *(include when the feature involves data)*

- **Session marker** — a single `localStorage` string key (e.g. `solar-system-auth`) whose value equals a fixed marker string when unlocked. Not user data; no schema; single-user, first-party.

## Success Criteria *(required)*

- **SC-001** — Once unlocked, the existing 3D scene renders and behaves identically to the pre-change baseline: 8 orbiting planets, the sun, orbit rings, the starfield, OrbitControls (drag/zoom/pan), and click-a-planet → info panel, with zero new console errors. (Brownfield characterization baseline.)
- **SC-002** — On an un-unlocked load the passcode gate paints promptly (< 100 ms; it is plain DOM/CSS with no scene work) and no WebGL context is created.
- **SC-003** — Passcode and session config live in a single top-of-script block; changing the passcode requires editing exactly one line.

## Non-goals / known limitations *(load-bearing — do NOT engineer around)*

- **Not a security boundary.** A client-side passcode is **not** confidentiality: the passcode and gating logic are visible in page source, and a determined user can bypass the gate via devtools (set the `localStorage` key, read the passcode, or invoke scene-init directly). This is a **deliberate, user-accepted trade-off** for a static showcase — the gate deters casual/incidental access only.
- **No backend, hashing, or crypto.** Adding any of these to "fix" the above is explicitly declined scope (it would change the app from a static file and is a different, larger feature). The passcode is compared client-side with `===`; the upgrade path (a real backend) is recorded as a `ponytail:` comment in code, not built.
- **No user accounts / roles / multi-user.** One shared passcode, no user list, no per-user state.

## Assumptions

- The passcode value itself is a configuration choice, not a fixed requirement; the plan uses a documented default placeholder that the owner changes in one place. Not treated as a spec gap (it is neither a security nor a data-integrity dependency, given the non-goal above).
- ESM import-map + CDN-loaded Three.js means the page is served over `http(s)` (as it is today), not opened via `file://`.

---
*Type: feat · brownfield · S. Boundary/error scenarios: AC2 (wrong), AC3 (empty), AC6 (tampered session), AC8 (post-logout). Security posture is an explicit non-goal, not a gap.*
