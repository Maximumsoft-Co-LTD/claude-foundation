# Bangkok City 2D AI Simulation

A browser-based 2D simulation where 50+ AI-driven NPC agents live, work, learn, and form relationships in a stylised Bangkok grid city. There is no human-controlled player — the human is a pure observer. Click any agent to inspect its needs, goal, thought, activity log, and relationships.

Full design: [`.workflow/0002-feat-bkk-city-ai-sim/plan.md`](../.workflow/0002-feat-bkk-city-ai-sim/plan.md)

---

## Run it

Requires Node 18+.

```bash
npm install
npm run dev      # Vite dev server → open http://localhost:5173
npm run build    # production bundle (tsc + vite build)
```

---

## Test it

```bash
npx vitest run   # 61 headless unit tests (14 test files)
```

Scale benchmark (AC11 — headless, no browser needed):

```bash
npx tsx scripts/bench-headless.ts --agents 50 --ticks 1000
# Expected: wall-clock ≈ 1 s; hard budget 10 s (script exits non-zero if exceeded)
```

**Manual-verify only (browser required):**

- **AC8** — click any agent sprite in Chrome/Firefox and confirm the inspect panel opens with needs bars, goal label, thought bubble, activity log, and relationship list.
- **AC11 (fps half)** — open Chrome DevTools → Performance monitor → confirm ≥ 30 fps sustained with 50 agents over 60 real-seconds.

These two checks cannot run in CI or headless because they depend on PixiJS/WebGL rendering.

---

## How agents think (Hybrid AI)

Each tick every agent runs a **needs-utility** decision loop:

1. **Needs decay** — hunger, energy, social, and money pressure each decay at a fixed per-tick rate.
2. **Action scoring** — all candidate actions (work, eat, rest, sleep, socialise) are scored against the current needs vector. Scores are weighted by the agent's **outcome memory**: repeated successful food runs raise the utility weight for buy-food in hungry+has-money contexts.
3. **Action selection** — the highest-scoring affordable action is chosen; a phase bias doubles rest/sleep scores at night.
4. **Learning** — after each action the resulting satisfaction delta is recorded in a bounded outcome memory (default cap: 20 entries per action-context pair, oldest evicted). Over time agents develop individually tuned preferences.

All of this runs **locally and deterministically** given a fixed seed — no network, no randomness beyond the seeded PRNG.

An **optional async LLM reflection layer** can overlay higher-level goal strings on top of this core (see below), but the decision loop never waits for it.

---

## LLM reflection — optional, dev-only

When `VITE_OPENAI_API_KEY` is set in a local `.env` file, each agent fires an async reflection call at most once per 60 real-seconds. The LLM returns a short goal string (≤ 15 words); it lands in the agent's mailbox and is drained on the next tick. The tick loop is never blocked.

```
# .env  (local dev only — never commit this file)
VITE_OPENAI_API_KEY=sk-...
```

**Security — read this before deploying.**

The key is gated behind `import.meta.env.DEV`. Vite inlines every `VITE_*` reference into the compiled client bundle at build time; if the guard were removed, the key would be readable by anyone who opens the page in DevTools. The guard means `apiKey` is always an empty string in a production build, `LlmReflection` never activates, and `LocalReflection` (no key, no network) is the only active path.

Consequence: **production deployments must proxy the LLM call server-side.** Do not set `VITE_OPENAI_API_KEY` in a CI/CD environment or a publicly hosted build. `LocalReflection` is the only safe deployed default.

Additional guardrails in `LlmReflection`:
- `baseUrl` is validated against an https-only allowlist: `api.openai.com` and `openrouter.ai`. Any other hostname or a non-https URL throws at construction before any auth header can be sent.
- Fetch has a 10-second `AbortController` timeout; network errors and non-200 responses return `null` silently — the agent retains its locally-derived goal.

---

## Architecture

```
src/sim/      framework-free deterministic core — imports zero pixi.js (enforced by a guard test)
  world.ts    World aggregate: tick(), snapshot(), agent state
  agent.ts    needs vector, balance, profession, goal, outcome memory
  actions/    utility scoring + action catalogue (go-to, work, buy, rest, sleep, socialise)
  economy.ts  earn/spend — integer-cent balances, balance never < 0
  memory.ts   bounded outcome memory + utility-weight learning
  relationships.ts  co-presence accrual, capped relationship graph
  reflection/ ReflectionPort — local.ts (default, pure) / llm.ts (optional async)
  ports.ts    ReflectionPort interface, WorldSnapshot, SimEvent types

src/render/   PixiJS read-only adapter — reads WorldSnapshot + event log only, never sim internals
  app.ts      bootstraps PixiJS Application; RAF render loop decoupled from fixed-step tick
  worldView.ts  grid, landmarks, day/night tint from snapshot.phase
  agentSprites.ts  pooled sprites keyed by agentId; positions from snapshot
  inspectPanel.ts  click-to-inspect panel (DOM overlay, all text via textContent — no innerHTML)
```

The boundary is enforced: `src/sim/**` must import zero `pixi.js` (a guard test fails if this is violated). `World.tick()` returns a frozen `WorldSnapshot`; the render adapter only reads that value plus the event log — the dependency arrow never reverses. The fixed-step tick loop runs independently of `requestAnimationFrame`.

---

## What is not built

No human-controlled player, no multiplayer, no server-side persistence, no real-map GIS, no mobile app, no agent combat. Observer-only, single browser session, in-memory state only.
