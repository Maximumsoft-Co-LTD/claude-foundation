# Review: Passcode gate for the 3D solar system

**Plan**: [./plan.md](./plan.md) · **Tasks**: [./tasks.md](./tasks.md)
**Spec**: [./spec.md](./spec.md)
**Reviewed**: 2026-07-02
**Verdict**: pass
**Cycle**: 1 of max 2

Diff: `solar-system/index.html` (+436/-218), `.gitignore` (+11/-1), `.workflow/INDEX.md` (+1). Playwright harness under `solar-system/` is git-ignored dev tooling (FR-010) — correctly absent from the shipped diff. Suite GREEN (15/15, `tests.md`) folded into the coverage lens below.

## Tasks adherence *(required)*

One row per `tasks.md` task — no skips.

- [x] T001 [SC-001] — baseline captured: `tests.md > Baseline` records commit `2ee4302` reference (1 canvas, only pre-existing favicon-404). Implemented as planned.
- [x] T002 [AC4][SC-001] — scene setup + loop extracted into `initScene()` (`index.html:359`) with once-guard `if (sceneInitialized) return` (`:360-361`); `animate()` called inside (`:621`), fn closes `:622`; `PLANETS`/`SUN` left at module scope (`:252+`). As planned.
- [x] T003 [FR-001][SC-003] — single config block `index.html:241-247`: `PASSCODE`/`SESSION_KEY`/`SESSION_VALUE` + ponytail comment `:244`. As planned.
- [x] T004 [AC1][FR-002][FR-009][FR-011] — gate overlay static markup `:209-224`; themed CSS `#gate-panel` `:90+` (rgba(10,12,24,.82), 1px rgba(255,255,255,.15) border, radius 12px, blur(6px), #eef2ff, system font); error region `role="alert" aria-live` `:222`; gated load calls `showGate()` not `initScene()`. As planned.
- [x] T005 [AC4][FR-005][FR-008] — `unlock()` `:666-671` writes session, hides gate, `initScene()`, reveals logout; wired from submit `:691-692`. As planned.
- [x] T006 [AC2][FR-003] — wrong passcode `:684-688` sets error via `textContent`, no `writeSession`, no `initScene`, clears+refocuses input. As planned.
- [x] T007 [AC3][FR-004] — `.trim()` `:675` then empty-reject `:677-682` **before** the `!== PASSCODE` compare. As planned.
- [x] T008 [AC5][FR-006] — bootstrap `:704-706` reads session in try/catch (`readSession` `:633-639`), `=== SESSION_VALUE` → `initScene()` + logout visible, no gate. As planned.
- [x] T009 [AC6][FR-007] — strict `readSession() === SESSION_VALUE` `:704`; any other/absent/empty falls to `showGate()` `:708`. As planned.
- [x] T010 [AC7][FR-008] — logout hidden by default, `.visible` only when unlocked (CSS `#logout-btn`); click `:695-698` → `clearSession()` (try/catch `:649-655`) + `location.reload()`; ponytail comment `:697`. As planned.
- [x] T011 [AC8] — post-logout the removed key means reload hits `showGate()` (`:708`); no auto re-unlock. As planned.
- [x] T012 [P][SC-001] — regression confirmed by `tests.md` (SC-001 baseline test + AC4 interaction): 8 planets, sun/rings/starfield, drag/zoom, info panel, zero new console errors. As planned.
- [x] T013 [P][FR-010][FR-011][DoD] — `.gitignore:6-16` excludes all harness (node_modules/package.json/config/tests/results); app stays one static file; a11y (label `:213`, Enter via form submit, focus `:659`, role=alert `:222`). As planned.

## Acceptance-criteria check *(required)*

One row per scenario, re-verified against running code.

- [x] AC1 — fresh load shows gate only, scene NOT initialized: bootstrap else-branch `index.html:707-708` → `showGate()` (focuses input `:659`); `initScene()` unreachable on gated path so no `<canvas>`/WebGL. Confirmed by SC-002 + AC1 tests.
- [x] AC2 (boundary — wrong passcode): `index.html:684-688` — error "Incorrect passcode.", gate stays, no `initScene`, no session write, input cleared. Matches spec evidence.
- [x] AC3 (boundary — empty/whitespace): `index.html:675,677-682` — trim then reject with "Enter a passcode." before comparison; no unlock, no session.
- [x] AC4 (happy path): `index.html:691-692` → `unlock()` `:666-671` hides gate, `initScene()` renders, reveals logout, writes `SESSION_VALUE`. Interactions + zero-error confirmed by AC4/SC-001 tests.
- [x] AC5 (happy path — persist): bootstrap `index.html:704-706` initScene directly from stored session, no gate.
- [x] AC6 (boundary — absent/tampered): strict `=== SESSION_VALUE` `index.html:704`; "bogus"/""/absent → `showGate()` `:708`. No false unlock. 3/3 AC6 tests pass.
- [x] AC7 (happy path — logout): `index.html:695-698` clears key then reloads; post-reload gate returns, scene gone.
- [x] AC8 (boundary — logout durability): removed key → reload lands on `showGate()`; no re-unlock.

0 unticked ACs. No invented requirement.

## Non-AC slot check *(required when spec has DoD/Constraints)*

- [x] SC-001 — unlocked scene matches pre-change baseline, zero new console errors: `tests.md > Baseline` (post-change 1 canvas, favicon-404 filtered) + scene body moved verbatim (re-indent only) into `initScene()`. Present.
- [x] SC-002 — no WebGL context while gated: `initScene()` gated behind unlock; SC-002 test confirms zero WebGL context on gated load. Present. (Note the "<100 ms paint" half is structural — plain DOM/CSS, no scene work on the gated path — not independently timed; see Non-blocking.)
- [x] SC-003 — config in one top-of-script block, one-line passcode change: `index.html:245-247`. Honoured.
- [x] Constraint FR-010 — single static file, dev tooling separate: `.gitignore:6-16` excludes the whole harness; no app dependency/build added. Honoured.
- [x] Constraint FR-011 — a11y: label `:213`, Enter submits (form), focus on show `:659`, `role="alert" aria-live="assertive"` `:222`. Honoured.
- [x] Constraint — no HTML-injection sink: grep confirms zero `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval`/`new Function`; gate DOM is static markup, all dynamic text via `textContent` (`:678,685,691` + info panel `:525-528`). Honoured.
- [x] Non-goal — client-side passcode is NOT a security boundary: correctly declined scope; ponytail upgrade path marked at the compare (`:244`) and the reload choice (`:697`). Not raised as a finding (belongs to Phase 7 security).
- [x] Hygiene — no `[NEEDS CLARIFICATION]`; diff adds no scope beyond the 3 stories.

## Findings *(required)*

### Blocking

None.

### Non-blocking

- `index.html:704-708` — logout re-locks via full `location.reload()` (documented ponytail choice) rather than WebGL teardown; correct and clean for a showcase, but means the tab briefly reloads. Fine as designed — carried to retro only as a note.
- SC-002 "< 100 ms paint" — the no-WebGL half is tested; the timing half is structurally guaranteed (no scene work when gated) but not independently measured. No action needed; noted for completeness.
- `.workflow/INDEX.md:+1` — registry row for run 0004; tracked-file bookkeeping, not app code. Expected.

## Sign-off *(required)*

pass → proceed to Phase 2 step 7 (security). The diff trips the `auth/session` bucket; security is expected to fire and document the accepted client-side-only non-goal (no `innerHTML` sink introduced, per the constraint check above).
