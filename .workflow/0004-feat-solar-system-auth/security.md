# Security review: Passcode gate for the 3D solar system

**Plan**: [./plan.md](./plan.md)
**Reviewed**: 2026-07-02
**Verdict**: pass
**Trigger**: auth/session — client-side passcode gate + `localStorage` session marker gating scene init (`solar-system/index.html`). (Also brushes `secrets`: passcode literal in source — accepted non-goal, see below.)

## Threat model

Two attacker goals given this diff. **(1) See the gated showcase without the passcode.** The "gate" is a client-side deterrent, not an authentication/confidentiality control: `PASSCODE`, `SESSION_KEY`, `SESSION_VALUE`, and the whole compare live in page source (`solar-system/index.html:245-247, 684`), so anyone with devtools can read the passcode, set `localStorage[SESSION_KEY]="unlocked"`, or call `initScene()` directly. This bypassability is an **explicit, user-accepted trade-off** for a static single-file showcase (spec Non-goals / edge case "Determined bypass via devtools → accepted, out of scope"). Therefore *bypassable gate, cleartext passcode in source, unhashed `===` compare, and no server verification are accepted-limitation notes, NOT high findings* — the gate deters casual/incidental access only, which is its stated job. **(2) Inject script or corrupt gate logic via the two real input boundaries** — the passcode `<input>` value and the `localStorage` marker (both attacker/other-script controllable). This IS in scope and defensible independent of the non-goal: it must not create an XSS sink and the gate must fail **closed** (never accidentally unlock). Reach: the page is public/first-party, single shared passcode, single user, no accounts, no cross-user data, no server, no network calls added.

## Checklist

Trigger buckets walked: auth/session, plus Input & Output (the only real boundaries) and a supply-chain note. Infra-adjacent N/A (no paths/exec/outbound calls).

- [x] **Input** — ✓ The only untrusted runtime inputs on the new path are `gateInput.value` and the stored marker. The input value flows `.trim()` → falsy check (`solar-system/index.html:675-677`) → strict `!== PASSCODE` (`:684`); it is **never** concatenated into SQL/shell/HTML/paths and never reaches an HTML/JS sink. Whole-file scan found **no** `innerHTML` / `outerHTML` / `document.write` / `insertAdjacentHTML` / `eval` / `new Function`. Error text is fixed string literals assigned via `.textContent` (`:678, :685, :691`); planet info uses `.textContent` too (`:525-528`). The stored marker is compared with strict `===` to a fixed string (`:704`) — no `JSON.parse`/deserialization of the stored value, so no injection or type-confusion via `localStorage`.
- [x] **Authn / authz** — N/A as a real control (accepted non-goal). There is no server session, endpoint, or authz layer to bypass; the "session" is a first-party `localStorage` string, not a cookie, so httpOnly/secure/SameSite do not apply. Accepted-limitation: no server-side verification by design.
- [x] **Secrets / crypto** — ✗-as-security-control, accepted by design. `PASSCODE = "solaris42"` is a hardcoded placeholder in client source (`:245`) with a `ponytail:` upgrade-path comment (`:244`). Per spec Non-goals this is explicitly **not** confidentiality and not a real secret — a shared deterrent string, not a credential. Plain `===` compare (no custom crypto) is the correct choice here: hashing client-side would add cost and a false sense of security without changing the bypass. No CSPRNG needed (no security-sensitive randomness introduced). Not a finding; the placeholder value is carried to retro as a config nudge (below).
- [x] **Output** — ✓ No untrusted text on the way out (error strings are literals). Logout performs `location.reload()` (`:698`) — reloads the current URL with **no** user-controlled target, so no open-redirect and no clickjacking navigation surface. No stack traces / paths leaked (the three storage `try/catch` blocks swallow silently).
- [x] **Supply chain** — ✓ The change adds a **dev-only** Playwright harness that is git-ignored (`.gitignore`: `solar-system/{node_modules,package.json,package-lock.json,playwright.config.js,tests/,test-results/,playwright-report/}`) and does **not** ship. The shipped artifact stays a single static HTML file (FR-010); no runtime dependency added (Three.js already present, unchanged). Not a runtime supply-chain surface.

### Fail-closed verification (the hard check)

Traced every path that decides gated-vs-unlocked; all fail **closed** (default = gated):

- `readSession()` `try/catch` returns `null` on throw (`:633-639`); bootstrap `readSession() === SESSION_VALUE` (`:704`) → throw ⇒ `null !== "unlocked"` ⇒ `else showGate()`. **Storage blocked/throwing ⇒ gated.**
- Tampered / garbage / empty stored value ⇒ strict `!==` fails ⇒ `showGate()` (AC6). Absent key ⇒ `getItem` `null` ⇒ gated (AC1).
- Empty/whitespace submission (`:677`) and wrong passcode (`:684`) both `return` before `unlock()` — no session write, no `initScene()` (AC2/AC3).
- `unlock()` (`:666`) is reached **only** after the correct-passcode branch. `writeSession()` failing (blocked storage) is caught and the current-load unlock still proceeds — this is *persistence* degrading, the intended edge-case behaviour, reached only post-correct-passcode; it is not an auth fail-open.
- Logout (`:695`) `clearSession()` + `location.reload()`; post-reload bootstrap re-gates (AC7/AC8). Durable in every realistic storage state (if storage was blocked, nothing was ever written, so still gated).

No fail-open path found.

## Findings

### Blocking (severity = high)

- None.

### Non-blocking (severity = low / accepted-limitation → retro / FOLLOWUPS)

- `solar-system/index.html:245` (low, config nudge) — default passcode `"solaris42"` is a documented placeholder; shipping unchanged reduces the deterrent to zero. Owner must change the one config line before use (SC-003 covers the one-line config; `ponytail:` records the backend upgrade path). Accepted-limitation flavored; carry a FOLLOWUP to confirm the value was changed on deploy.
- **Accepted limitations (documented + user-accepted, spec Non-goals — NOT findings, recorded for the retro trail)**: gate is bypassable via devtools; passcode is cleartext in source; compare is unhashed `===`; there is no server-side verification; and there is no attempt-rate-limiting (meaningless without a server — an attacker reads the source instead). All are the accepted design of a static-showcase deterrent, not defects.

## Sign-off

**pass** — no high (blocking) findings. The auth/session path introduces no XSS/injection sink, no open-redirect, and no runtime supply-chain surface; the gate fails closed on absent/garbage/blocked storage and on wrong/empty input; the bypassability and cleartext passcode are the explicit, user-accepted non-goal, not vulnerabilities. Counts against the review cycle budget: cycle 1, pass.
