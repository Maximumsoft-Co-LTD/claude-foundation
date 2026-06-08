# Security review: Bangkok city AI-agent simulation — LLM reflection adapter

**Plan**: [./plan.md](./plan.md)
**Reviewed**: 2026-06-08
**Trigger**: secrets + network (outbound LLM adapter reading an API key) + html (untrusted LLM output rendered to DOM)
**Verdict**: fix-required

## Threat model (one paragraph)
This is a single-session, server-less, no-auth, no-DB browser SPA built by Vite. The new attack surface is the optional `LlmReflection` adapter (`src/sim/reflection/llm.ts`), which (1) reads an API key and (2) makes an outbound `fetch` to an OpenAI-compatible endpoint, then (3) feeds the **untrusted** model response back into the simulation where it is rendered to the DOM. The relevant trust boundaries are: developer secret → client bundle (Vite inlines `import.meta.env.VITE_*` into the shipped JS, so anyone who opens the page can read the key from DevTools/Sources); and remote LLM endpoint → DOM (the LLM is an untrusted third party — a compromised/malicious endpoint, a prompt-injected response, or even a benign model emitting markup can return arbitrary text that the app injects into `innerHTML`). An attacker who can MITM/redirect the endpoint, or who controls the endpoint a victim is pointed at, can both steal the key and run script in the victim's page. Reachability: any visitor with the page open and a configured key; the inspect panel renders agent strings on a single click.

## Checklist
- [x] **Input** — ✗ Untrusted LLM response (`data.choices[0].message.content`) flows agent `goal`/`thought` → `inspectPanel.render()` `innerHTML` with **no escaping**. String-concat of untrusted text into HTML. See HIGH-1.
- [x] **Authn / authz** — N/A: no server, no endpoints, no sessions/tokens in this app.
- [x] **Secrets / crypto** — ✗ API key sourced via `import.meta.env.VITE_OPENAI_API_KEY` (`src/main.ts:5`) → Vite **inlines `VITE_*` into the client bundle**, exposing the secret to every page visitor. No hard-coded key in the diff, and no custom crypto. See HIGH-2. Also: `.gitignore` has no `.env*` entry (LOW-3).
- [x] **Output** — ✗ Untrusted text not escaped on the way out to HTML (`src/render/inspectPanel.ts:80-98`, `:87`, `:89`, `:71-73`). Same root issue as HIGH-1. No redirects, no stack-trace leakage (errors are swallowed to `null`).
- [x] **Infra-adjacent** — ✓ outbound `fetch` has a timeout (`AbortController`, 10s, `llm.ts:30-31,49`). ✗ endpoint URL (`baseUrl`) is fully caller-configurable with **no allowlist** — see MEDIUM-1 (SSRF/redirection + key-exfil to arbitrary host). No path joins, no process exec.

## Findings

### Blocking (severity = high)

- **HIGH-1 — Stored DOM XSS: untrusted LLM (and agent) strings rendered via `innerHTML`.**
  `src/render/inspectPanel.ts:80-98` builds the panel with a template literal assigned to `content.innerHTML`. Interpolated values include `goal` (`:87`), `thought` (`:89`), and per-event `e.kind` / `e.detail` (`:71-73`), none HTML-escaped. The `goal` value is attacker-influenceable: full path is `llm.ts:55-58` (`data.choices[0].message.content` → `text.slice(0,120)`) → `world.ts:461` (`agent.pendingGoal`) → `world.ts:210/255` (`agent.goal`) → `world.ts:191` (`AgentView.goal`) → `inspectPanel.ts:38,87`. A malicious/compromised/prompt-injected LLM endpoint returning e.g. `<img src=x onerror=...>` executes script in the victim's page on inspect-click (and with the key in-bundle, can exfiltrate it). `showInactive()` at `:45` also uses `innerHTML`, though with a static string (lower risk, fix for consistency).
  → **Fix:** stop assigning untrusted data to `innerHTML`. Build the panel with `createElement` + `textContent` (the constructor at `:101-124` already does this correctly — extend that pattern), or HTML-escape every interpolated value. The 120-char slice in `llm.ts:58` is a length bound, not a sanitiser, and must not be relied on.

- **HIGH-2 — API key inlined into the client bundle (secret exposed to every visitor).**
  `src/main.ts:5-6` reads `import.meta.env.VITE_OPENAI_API_KEY`. Vite statically replaces any `VITE_`-prefixed `import.meta.env` reference at build time, so the literal key string is baked into the shipped JS and readable by anyone who opens the page (DevTools → Sources, or `view-source`). There is no server in this app to proxy the call, so a browser-held provider key is fundamentally exposed — this is plaintext-secret-to-untrusted-client.
  → **Fix:** do not ship a provider key in a client-only build. Options, in order: (a) keep the LLM path **dev-only / opt-in** and document that `VITE_OPENAI_API_KEY` is a local-development convenience that must never be set in a public/production build (gate it behind `import.meta.env.DEV`); (b) front the call with a thin proxy/edge function that holds the key server-side and the client calls the proxy; (c) keep `LocalReflection` (the default, no-network, no-key binding) as the only path for any deployed build. At minimum the code/comment must stop implying this is a safe way to ship a key. Given the spec scopes this to a single-session in-browser sim with LLM as **optional**, gating to `DEV` + an explicit doc warning is the smallest correct fix; the architectural fix is a proxy.

### Non-blocking (severity = medium / low)

- **MEDIUM-1 — `baseUrl` has no allowlist (SSRF/redirection + key-exfil vector).** `src/sim/reflection/llm.ts:21` accepts an arbitrary `baseUrl` and sends the `Authorization: Bearer <key>` header to it (`:33-37`). If the endpoint is ever made user/URL/config-driven, an attacker can point it at a host they control and harvest the bearer token, or reach internal addresses. Currently the value is set in trusted code (`main.ts` passes only `apiKey`, defaulting to `api.openai.com`), so it is not externally reachable today — hence medium, not high. → **Fix / accepted risk:** validate `baseUrl` against an `https://` + host allowlist before sending the auth header; never let it become query-string/UI-driven without that check. Carry to retro.

- **LOW-2 — Untrusted LLM text also embedded into the next prompt (prompt-injection feedback loop).** `world.ts:461` stores the LLM goal as `pendingGoal` → becomes `agent.goal` → fed back as `currentGoal` into the next prompt (`world.ts:456`, `llm.ts:74`). A poisoned response can steer subsequent prompts. Impact is confined to sim flavour text (no tools, no actions are driven by raw LLM text — action selection is the deterministic needs-utility core), so blast radius is cosmetic. → Note only; once HIGH-1 is fixed the output is inert in the DOM.

- **LOW-3 — `.gitignore` does not ignore `.env*`.** The dev flow expects a local `.env` holding `VITE_OPENAI_API_KEY`, but `.gitignore` (verified) has no `.env`/`.env.local` entry, so a developer's key could be committed by accident. → **Fix:** add `.env`, `.env.*`, `!.env.example` to `.gitignore`. Carry to retro.

- **LOW-4 — Unbounded in-memory growth: checked, not a finding.** Reviewed the three long-session structures: event log is capped (`world.ts:28` `MAX_EVENTS=2000`, splice at `:121-122`), outcome memory is capped per context (`memory.ts:35` `shift()` over `_cap`), and relationships are capped per agent with weak-edge eviction (`relationships.ts:77-90`, `CONFIG.relationshipMaxPerAgent` + decay-delete). No DoS-by-design growth found. Listed for completeness; no action.

- **Dependency surface — light pass, no finding.** `package.json` pins exact versions; runtime dep is only `pixi.js@8.4.0` (dev-only: vite@5.4.19, vitest@2.1.9, tsx, typescript, eslint, prettier). Nothing obviously risky or unexpected in the direct set; full transitive audit (`npm audit`) is out of scope for this review.

## Sign-off
fix-required (counts against the review cycle budget) — 2 high-severity blocking findings (HIGH-1 DOM XSS, HIGH-2 client-bundle key exposure).
