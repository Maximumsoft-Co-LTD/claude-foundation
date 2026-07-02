# Tests: Passcode gate for the 3D solar system

**Test plan**: [./test-plan.md](./test-plan.md)
**Plan**: [./plan.md](./plan.md)
**Status**: passing
**Cycle**: 1 of max 3

The execution record: qa runs the strategy from [./test-plan.md](./test-plan.md) and records what actually happened.

## Type-aware mode

- [x] **Full** (feat)

---

## Harness setup

Dev-only Playwright `1.49.1` harness, scoped under `solar-system/` and fully git-ignored (FR-010 — the shipped app stays a single static HTML file):
- `solar-system/package.json` (devDependency `@playwright/test@1.49.1`)
- `solar-system/playwright.config.js`
- `solar-system/tests/gate.spec.js`
- `.gitignore` updated: `solar-system/node_modules/`, `package.json`, `package-lock.json`, `playwright.config.js`, `tests/`, `test-results/`, `playwright-report/`

Verified via `git status --porcelain`: only `.gitignore`, `.workflow/INDEX.md`, `solar-system/index.html` show as tracked changes — no harness file is staged or trackable.

**Browser note (deviation from test-plan's `channel: 'chromium'`):** Playwright's bundled Chromium download was corrupted/truncated by this sandbox's network on every attempt (downloaded bundle was 432KB instead of ~330MB — verified by re-downloading 3×, always missing `Contents/Frameworks`). Switched the config to `channel: 'chrome'` (system-installed Google Chrome, already present at `/Applications/Google Chrome.app` — the same engine the engineer used for live CDP verification). No functional difference for this suite (DOM/state assertions only, no bundled-Chromium-specific feature used). Headless launch uses `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` for a real software-GL WebGL context (confirmed: `getContext('webgl')` returns non-null).

## Acceptance-criteria coverage

| AC | Test(s) | Result |
|---|---|---|
| AC1 | `AC1 — fresh load shows only the gate, scene not initialized` | ✅ pass |
| AC2 | `AC2 — wrong passcode: error shown, gate stays, no canvas, no session` | ✅ pass |
| AC3 | `AC3 — rejects "" with no unlock`, `AC3 — rejects "   " with no unlock` | ✅ pass (2/2) |
| AC4 | `AC4 — correct passcode unlocks, scene renders, planet click opens info panel` | ✅ pass |
| AC4 edge (rapid double-submit, test-plan Edge cases) | `AC4 edge — rapid double-submit initializes the scene exactly once` | ✅ pass |
| AC5 | `AC5 — seeded valid session: scene loads directly, no gate` | ✅ pass |
| AC6 | `AC6 — absent session shows the gate`, `AC6 — empty-string session shows the gate`, `AC6 — tampered (non-marker) session shows the gate` | ✅ pass (3/3) |
| AC7 | `AC7 — logout clears session, gate returns, canvas removed` | ✅ pass |
| AC8 | `AC8 — reload after logout stays gated, and re-unlock works` | ✅ pass |
| SC-001 (scene renders unchanged, zero new console errors) | Folded into AC4 test (interaction + zero-error assertion) + dedicated `SC-001 — baseline: near/mid/far planets render at expected positions, zero console errors` | ✅ pass |
| SC-002 (no WebGL context while gated) | `SC-002 — gated load creates no WebGL context` | ✅ pass |
| Edge case: `localStorage` unavailable/blocked (test-plan Edge cases) | `Edge case — gate still works when localStorage throws (blocked/private mode)` | ✅ pass |

**15/15 tests passing. 0 unmapped ACs. 0 `[plan-contradiction]` findings. 0 `[plan-missed]` tags** (both edge-case tests — double-submit, localStorage-throws — were already planned rows in `test-plan.md > Edge cases to probe`, not execute-time discoveries).

**Click-a-planet precision (AC4 / SC-001):** the engineer's synthetic click didn't land on a mesh. Fixed by computing each planet's exact screen position via the same camera projection math the app uses (`camera.position=(0,60,130)`, `lookAt(0,0,0)`, same `THREE.PerspectiveCamera(55, aspect, 0.1, 2000)`), executed inside the page via `import('three')` (resolved through the page's own import map — same module instance, bit-exact math). Animation is frozen after its one synchronous first frame (`window.requestAnimationFrame = () => 0` via `addInitScript`, installed before navigation) so `mesh.position` stays deterministically at `(orbitalRadius, 0, 0)` (elapsed ≈ 0), eliminating any click/render timing race. Verified against Mercury (near), Jupiter (mid), Neptune (far) — all three raycast-hit and show correct name + diameter.

## Baseline *(brownfield feat — required)*

- **What**: pre-change unlocked-scene behaviour (no gate; scene ran at module top level).
- **Where**: `solar-system/index.html` at commit `2ee4302` (the only commit touching this file; current working tree holds the uncommitted gate diff on top of it).
- **How captured**: checked out `2ee4302:solar-system/index.html` into an isolated temp dir, served it with the same `python3 -m http.server` method, loaded it with the same Playwright/Chrome harness.
- **Result**: `canvasCount: 1`, `consoleErrors: ["Failed to load resource: the server responded with a status of 404 (File not found)"]` (the `/favicon.ico` probe — Chrome's automatic favicon request against a bare `http.server` directory with no `favicon.ico`; reproduces identically regardless of app code).
- **Comparison**: post-change unlocked state matches — 1 canvas, and after filtering the identical pre-existing favicon-404 noise, **zero new console errors**. No behaviour change. Not blocking.

## Edge-case gaps

None found beyond what `test-plan.md` already planned (whitespace passcode, rapid double-submit, `localStorage` throwing — all covered above). No reachable security/data-integrity hole (client-side-only posture is the spec's explicit non-goal, not a gap).

## Results

- **Full-suite run 1**: 15 passed / 0 failed (46.4s — includes browser install probing overhead from resolving the channel switch)
- **Full-suite run 2** (after favicon-noise fix, re-run clean): **15 passed / 0 failed (9.5s)**
- No flakiness observed across 2 consecutive full runs.

## Coverage *(advisory)*

Per `test-plan.md > Coverage targets`: 100% of ACs (8/8) + SC-001/SC-002 mapped to ≥1 passing assertion. No unit level exists for this artifact (single static HTML file, inline ESM, no build step — no line/diff-coverage tool applies; the test-plan's own Level note establishes browser-integration as the only reachable level). Floor met.

## Commands

- **Full-suite** (final gate, sets ship-blocking `passing`):
  ```
  cd solar-system && npx playwright test
  ```
- **Impacted** (inner cycles, title-grep):
  ```
  cd solar-system && npx playwright test -g "<title>"
  ```
- **Setup** (one-time, dev-only):
  ```
  cd solar-system && npm i -D @playwright/test@1.49.1 && npx playwright install chromium
  ```
  (Chromium install failed in this sandbox — see Harness setup deviation. `playwright.config.js` now uses `channel: 'chrome'`, which needs no browser download; the `npx playwright install chromium` step can be skipped if system Chrome is present, or kept as a fallback for environments where the bundled download succeeds.)
