# Test plan: Passcode gate for the 3D solar system

**Spec**: [./spec.md](./spec.md)
**Plan**: [./plan.md](./plan.md) · **Tasks**: [./tasks.md](./tasks.md)
**Status**: draft
**Mode**: Full (feat)

> **For humans** — one row per spec promise (`AC#`): what each test checks and at which level. All checks run in a headless browser (the only way to load this inline-ESM + WebGL page), asserting DOM/state/text only — no screenshots.

## Coverage plan *(required)*

Level note: the app is a single static HTML file whose logic runs as an inline ESM module and creates a WebGL context via Three.js. There is **no non-browser level** that can even load the page (jsdom/happy-dom cannot resolve the import-map, fetch the CDN module, or provide WebGL). So every row is an **integration** check run in a headless browser used purely as a functional harness (DOM presence, `localStorage` state, text) — **no visual/screenshot diff**, consistent with `e2e_visual=off`.

| AC | Level | What the test asserts | Notes |
|----|-------|-----------------------|-------|
| AC1 | integration (browser DOM) | Fresh context (empty `localStorage`) → gate element visible; `#app` has no `<canvas>`; input is focused | Load-bearing: "scene must not initialize" = canvas absent |
| AC2 (boundary — wrong passcode) | integration | Type a wrong passcode + submit → error region has text (queried via `role="alert"`); gate still visible; `#app` still has no `<canvas>`; `localStorage[SESSION_KEY]` unset | |
| AC3 (boundary — empty passcode) | integration | Submit empty input, and separately a spaces-only input → error shown; no unlock; no `<canvas>`; session unset | Two inputs: `""` and `"   "` |
| AC4 (happy path) | integration | Type the correct passcode + submit → gate hidden; `#app` has a `<canvas>`; `localStorage[SESSION_KEY]===SESSION_VALUE`; Logout visible; clicking a planet region opens the info panel (interaction preserved) | Interaction check doubles as SC-001 spot |
| AC5 (happy path) | integration | Seed `localStorage[SESSION_KEY]=SESSION_VALUE`, then load → gate NOT shown; `#app` has a `<canvas>` directly | |
| AC6 (boundary — tampered/absent session) | integration | (a) Seed `localStorage[SESSION_KEY]="bogus"` → load → gate shown, no `<canvas>`. (b) No key set → load → gate shown, no `<canvas>` | Two cases |
| AC7 (happy path) | integration | From unlocked state, click Logout → `localStorage[SESSION_KEY]` removed; page returns to gate; `#app` has no `<canvas>` | Logout does `location.reload()` — assert post-reload gate |
| AC8 (boundary — logout durability) | integration | After logout, reload → gate shown; no `<canvas>`; session unset | |
| SC-001 (scene renders unchanged) | integration (baseline) | Unlocked scene: `#app` has exactly one `<canvas>`, zero new console errors, ≥ 1 planet click focuses + info panel shows — matched against the pre-change baseline capture | See Baseline |
| SC-002 (no WebGL when gated) | integration | On gated load, no `<canvas>` exists and no `webglcontextcreated`/renderer present | Covered alongside AC1 |

---

## Execution mechanism *(runnable types)*

**Runner: Playwright (`@playwright/test`), pinned `1.49.1`, dev-only devDependency.** Justification: it drives the **unmodified** static file in a headless browser — real DOM, real `localStorage`, real WebGL — so it verifies both the gate logic (compare, session, show/hide, error) AND the load-bearing "scene must / must not initialize" assertions (canvas presence). No non-browser runner (jsdom/happy-dom + Vitest) can load an inline-ESM + CDN import-map + WebGL page, and extracting logic into importable modules would break the single-static-file constraint. Playwright needs **zero source restructuring**. It is used functionally only (element/state/text assertions, no screenshots) so it does not turn on the `e2e_visual` visual/a11y-snapshot path. The test tooling (`package.json`, `node_modules`, `playwright.config.js`, the spec file) is **dev-only and separate from the shipped artifact** — git-ignore it; the app stays a single static HTML file (FR-010).

- **Full-suite** (final gate, sets ship-blocking `passing`): `npx playwright test` — with a `playwright.config.js` `webServer` serving `solar-system/` over http (e.g. `command: "python3 -m http.server 4173 --directory solar-system"`, `url: "http://127.0.0.1:4173/index.html"`), `channel: 'chromium'`.
- **Impacted** (inner cycles): `npx playwright test -g "<title>"` (Playwright title-grep). No separate related-test mode → Impacted = the same runner filtered by test title.

**qa setup steps**: add the dev `package.json` + `npm i -D @playwright/test@1.49.1`, `npx playwright install chromium`, verify it resolves, add `playwright.config.js` + one spec file (`tests/gate.spec.js`). If the user declines any dev test infra, the fallback is the manual `verify:` observable on each `tasks.md` task (each is a concrete manual DOM check) — **surface this at the gate**.

---

## Baseline *(brownfield feat — required)*

- **What**: the current unlocked scene behaviour (the app has no existing tests).
- **Where**: `solar-system/index.html` at `HEAD` (pre-change).
- **How captured**: load the pre-change file in the Playwright harness and record: `#app` contains exactly one `<canvas>`; console has zero errors; ≥ 8 orbiting bodies render (sanity: canvas non-blank / at least one planet click opens the info panel). Since the change extracts scene code into `initScene()` with no behaviour change, the post-change **unlocked** state must reproduce this capture (the SC-001 row is the comparison). If capturing against `HEAD` is impractical, capture against a copy of the pre-change file — the assertion set is identical.
- **Ship-blocking**: a pre-existing behaviour that differs once unlocked (missing canvas, new console error, broken planet click) = a behaviour change → blocking unless the plan approved it.

## Edge cases to probe

- **Whitespace-only passcode** (`"   "`) → **Specified** (AC3/FR-004): trimmed to empty → rejected. Planned test row under AC3.
- **Rapid double-submit** of the correct passcode → **Specified** (plan Risks + T002 guard): `initScene()` runs once; assert exactly one `<canvas>`. Add a planned test.
- **`localStorage` unavailable/blocked** (private mode) → **Specified** (plan Risks): reads/writes are `try/catch`-wrapped; the gate must not throw and must still gate/unlock for the current load (persistence silently degrades). Planned test: stub `localStorage` to throw → gate still functions, no uncaught error.
- **Devtools bypass** (manually setting the session key / reading the passcode / invoking `initScene()` from the console) → **out of test scope** (accepted non-goal — see below); no test.

No `undefined → spec gap` reachable inputs. No reachable security/data-integrity hole (the security posture is an explicit accepted non-goal, not a gap) → **no BLOCKER**.

## Out of test scope

- **Bypass resistance / confidentiality.** The client-side passcode is not a security boundary (spec non-goal). Testing whether a determined user can bypass the gate via devtools would only confirm the documented limitation — explicitly out of scope.
- **Visual/pixel/a11y-snapshot verification** (`e2e_visual=off`). Theming (FR-009) is verified functionally via the presence of the themed gate element and its glass style values, not by screenshot diff. Keyboard/focus/`role=alert` (FR-011) are asserted as DOM/behaviour, not an axe-style audit.
- **Cross-browser matrix.** One browser (chromium) is sufficient for this showcase.

## Fixtures / test data / env

- **Static server**: Playwright `webServer` serving `solar-system/` over http (`python3 -m http.server` or `npx serve`); tests target `http://127.0.0.1:<port>/index.html`.
- **Fresh context per test** (Playwright default) → empty `localStorage`; helpers to seed/read/clear the session key and to type + submit the passcode.
- **Passcode value**: tests use the known configured `PASSCODE` (the default from `tasks.md` T003); if the owner changes it, update the one fixture constant. A wrong passcode fixture is any other string.
- Network: the page fetches Three.js from unpkg — tests need network (or a pinned local mirror if run offline); note this in the harness README.

## Coverage targets *(advisory)*

- Integration (browser functional): all 8 ACs + SC-001/SC-002 mapped to ≥ 1 assertion (100% of ACs). No unit level exists for this artifact. Advisory only — below-floor is a finding, never a fake-green.

---
*feat / brownfield / S. Written as an adversarial check on the plan: every AC is browser-verifiable, boundary rows (wrong/empty/tampered/post-logout) are separate, and every reachable edge (whitespace, double-submit, blocked localStorage) is Specified — none left undefined, no blocking spec gap.*
