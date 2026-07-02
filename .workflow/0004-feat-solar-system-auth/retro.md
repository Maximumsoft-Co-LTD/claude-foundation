# Retro: Passcode gate for the 3D solar system

**Plan**: [./plan.md](./plan.md)
**Type**: feat
**Completed**: 2026-07-02
**Total cycles**: review=0 (i.e. 1 of max 2, no rework cycles), test=0 (1 of max 3, no rework cycles)
**Run metrics**: wall-clock=2026-07-02T08:25:06Z → 2026-07-02T10:15:35Z (~1h50m, build→ship) · size=S · skipped=1 step (`docs` — gate-confirmed, no docs surface for this app) · security=fired (auth/session trigger, predicted in plan) · fanout=none (plan.md declared single-pass; `fanout_plan`/`fanout_log` both empty in state.json — matches plan, no calibration gap)
**Ship**: commit=not committed (commit on ship = no — ready-to-run command in ship return) | PR=none (`open_pr_on_ship=false`)

## What worked *(required)*

- **Brownfield characterization-first extraction** — capturing the pre-change baseline (T001) before restructuring, then wrapping the *unmodified* scene body into `initScene()` (re-indent only, no logic rewrite), made "scene must not initialize until unlocked" literally true (no canvas/WebGL) rather than CSS-hidden, and gave review/security/QA a concrete SC-001 regression target instead of "looks the same."
- **Predicting the security trigger in `plan.md`** (`auth/session` bucket, expected verdict = documents-the-non-goal) meant Phase 7 firing was a confirmation, not a surprise — security.md's threat model and fail-closed trace matched the plan's prediction exactly, zero back-and-forth.
- **`ponytail:` comments at both accepted-shortcut sites** (client-side compare at the `PASSCODE` const; `location.reload()` logout instead of manual WebGL teardown) gave review and security a citable anchor for "deliberate, not missed" — both cleared as non-findings on first pass.
- **Fail-closed-by-construction session read** (`try/catch` around `localStorage`, strict `=== SESSION_VALUE`) turned three separate edge cases (blocked storage, tampered value, absent key) into one code path each provably gated — security's fail-closed trace found zero paths to add.
- **QA's camera-projection-math workaround** for imprecise synthetic planet clicks (computing exact screen position via the app's own `THREE.PerspectiveCamera` params, executed in-page via the page's own import map) is a reusable pattern for click-testing any Three.js/WebGL scene without brittle pixel-offset guessing.

## What to change next time *(required)*

- **Pin `channel: 'chrome'` (or a working Chromium) in `test-plan.md` before qa runs, not after** — the plan specified `channel: 'chromium'`; QA discovered mid-run that the sandbox's bundled-Chromium download was truncated (432KB vs ~330MB) and had to fall back to system Chrome. Not a blocker here (same engine, no functional gap), but a plan-time env-capability check (does this sandbox have a working browser download path?) would have caught it before execution started. WHY: saves a mid-run pivot + re-justification in tests.md.
- **Document the Full-suite command's worker concurrency, not just the command itself** — `tests.md > Commands` ships `npx playwright test` as the ship-blocking Full-suite command, but that command is flaky (15/15 failures with "page setup timeout") under this machine's default parallel workers, due to `channel:chrome` launch contention against the single `python3 -m http.server` webServer; it only went green serial (`--workers=1`, 15.2s). WHY: the documented command is what a future run (or a human) will copy-paste verbatim; leaving out `--workers=1` reproduces the same false-red. Filed as a follow-up (below) rather than fixed in-run since the git-ignored `playwright.config.js` isn't part of the shipped diff.
- **Placeholder secrets/config values need a ship-time checklist item, not just a code comment** — `PASSCODE = "solaris42"` is documented as a placeholder in three places (spec Assumptions, plan Risks, security.md low finding) but nothing forces the owner to actually change it before the "commit on ship" step. WHY: a comment is easy to miss; a follow-up + explicit ship-return reminder is not.

## Acceptance criteria status *(required)*

### US1 — Gate blocks the scene until unlocked (P1, MVP)
- [x] AC1 — gate-only fresh load, scene not initialized — shipped
- [x] AC2 (boundary — wrong passcode) — shipped
- [x] AC3 (boundary — empty passcode) — shipped
- [x] AC4 (happy path — correct passcode unlocks) — shipped

### US2 — Session persists across reloads (P2)
- [x] AC5 (happy path — persisted session skips gate) — shipped
- [x] AC6 (boundary — absent/tampered session) — shipped

### US3 — Logout returns to the gate (P3)
- [x] AC7 (happy path — logout clears session) — shipped
- [x] AC8 (boundary — logout durability) — shipped

All 8/8 ACs shipped and green (15/15 Playwright, serial run). 0 deferred, 0 wont-do.

## Memory candidates (facts) *(required)*

- **type**: project
  **body**: `solar-system/index.html` is a single static HTML file with no build step, no backend, and no test infra of its own — any dev tooling added for it (Playwright, etc.) must be git-ignored and scoped under `solar-system/` so the shipped artifact stays one file.
  **why**: this constraint (FR-010-equivalent) will recur on any future `solar-system/` change and isn't obvious from a diff alone — it's a repo-level intent, not a code convention visible on read.
  **how to apply**: any future `/dev` run touching `solar-system/index.html` — check for it before proposing a build step, framework, or committed test harness.

- **type**: reference
  **body**: this sandbox's Playwright bundled-Chromium download is unreliable (truncated ~432KB installs); `channel: 'chrome'` against system Google Chrome is the working fallback and was already validated end-to-end (engineer's CDP checks + QA's full suite) on this machine.
  **why**: saves re-discovering the same failure mode and re-deriving the same fallback on the next Playwright-based `/dev` run in this environment.
  **how to apply**: when a `test-plan.md` proposes a Playwright harness in this sandbox, default to `channel: 'chrome'` (skip attempting `channel: 'chromium'`/bundled-browser install) unless the environment is known to have changed.

## Skill candidates (procedures) *(required)*

none this run — this was a clean, well-scoped S run that followed existing skills (`security-fundamentals`'s trust-boundary routing, `testing-fundamentals`'s browser-only-level reasoning, `coding-discipline`'s ponytail-comment discipline) without friction. Not proposing a skill for either "brownfield characterization-then-extract" or "Three.js click-testing via camera-projection math" — both are single-run techniques captured above as memory/notes, not yet recurring (< 3 observed uses) or carrying enough branching to justify a dedicated procedure file; revisit if either resurfaces on the next `solar-system/` or Three.js run.

---

## Deviations from plan

- **Docs phase skipped** (plan matrix said `skip (deviates from matrix)` up front, confirmed at the gate) — no docs surface for this app; not an unplanned deviation, the plan already called it.
- **Test harness browser**: plan/test-plan specified `channel: 'chromium'` (bundled download); execution used `channel: 'chrome'` (system Chrome) after the bundled download proved corrupted in this sandbox on 3 retries. Same rendering engine, no functional gap (tests.md > Harness setup). Reason: environment limitation, not a plan error.
- **Full-suite command flakiness**: not a deviation in delivered behavior — the shipped app is unaffected — but the documented Full-suite command (`npx playwright test`) needed a manual `--workers=1` at execution time to go green; the git-ignored `playwright.config.js` doesn't yet encode this. Reason + fix filed as follow-up F-0004-feat-solar-system-auth-02.

## Follow-ups

Appended to `FOLLOWUPS.md > Open`:

- **F-0004-feat-solar-system-auth-01** — Change the default placeholder passcode (`"solaris42"`, `solar-system/index.html:245`) before any real use of the gate. · **type hint**: feat · **priority**: med
- **F-0004-feat-solar-system-auth-02** — Full-suite command (`npx playwright test`, the documented command in `tests.md > Commands`) is flaky under default parallel workers on this machine ("page setup timeout", `channel:chrome` launch contention vs. the single `python3 -m http.server` webServer); passes 15/15 serially (`--workers=1`, 15.2s). Pin `workers: 1` (or a low cap) in the git-ignored `solar-system/playwright.config.js`, or document `--workers=1` alongside the Full-suite command. · **type hint**: chore · **priority**: low
- **F-0004-feat-solar-system-auth-03** — Non-blocking review notes worth revisiting if the app grows: (a) logout re-locks via full `location.reload()` rather than WebGL teardown — correct/deliberate for a showcase today (`index.html:697` ponytail), revisit only if the app ever needs to preserve in-memory state across logout; (b) SC-002's "<100ms paint" timing half is structurally guaranteed (no scene work while gated) but not independently measured — add a timed assertion only if the gate ever grows heavier DOM/CSS. · **type hint**: chore · **priority**: low

No `Carried-over` items existed in `spec.md` for this run (greenfield within its own scope; `FOLLOWUPS.md > Open` was empty going in) — nothing to close.

## Security findings (carry-over)

`security.md` verdict: pass, 0 high, 0 medium, 1 low. Mirrored to `FOLLOWUPS.md` above (F-0004-feat-solar-system-auth-01 = the low finding: default placeholder passcode). No open `high` findings — no process-bug flag needed under What to change.

Accepted-limitation notes from security.md (documented non-goals, not findings, not follow-ups): gate is devtools-bypassable, passcode is cleartext in source, compare is unhashed `===`, no server-side verification, no rate-limiting — all explicit spec Non-goals for a static single-file showcase.
