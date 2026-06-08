# Review: Bangkok City 2D AI Simulation

**Spec**: [./spec.md](./spec.md) · **Plan**: [./plan.md](./plan.md) · **Type**: feat · **Cycle**: 1

**Verdict**: `approve`

**Summary**: Independently verified — 56 tests pass across 14 files (`npx vitest run`), `npm run build` exits 0 (`tsc && vite build`, so strict typecheck also passes), `npx tsx scripts/bench-headless.ts --agents 50 --ticks 1000` → 962 ms wall-clock (10× under the 10 s budget), `pixi.js@8.4.0` resolves and all deps are exact-pinned. The five load-bearing invariants all hold under code review. No blocking findings. Two AC items requiring a browser/WebGL (AC8 click interaction, AC11 ≥30 fps) are tagged `manual-verify`. A small set of non-blocking observations (under-asserting tests, a grid/state rollback edge) are listed for the follow-up carry-over.

---

## Load-bearing invariant audit

| Invariant | Status | Evidence |
|-----------|--------|----------|
| Core↔render decoupling: `src/sim/**` imports zero `pixi.js` | PASS | `test/sim/no-pixi-in-sim.test.ts` recursively collects every `.ts`/`.tsx` under `src/sim` and regex-matches both `from 'pixi.js'` and `require('pixi.js')` — the guard greps what it claims; test passes (0 violations). Confirmed no `pixi.js` import in any sim file by direct read. |
| Renderer only *reads* snapshot + event log | PASS | `render/app.ts:49-57` RAF loop calls `world.tick()` then `worldView.update`/`agentSprites.update`/`panel.onSnapshot` with the returned snapshot only. `inspectPanel.ts:30-41` reads `snapshot.agents` + `getEvents`/`getRelationships` (read accessors). No writeback into sim state anywhere in `src/render/**`. |
| AC10 non-blocking reflection | PASS | `world.ts:444-467 drainReflection` fires `reflect(input).then(...).catch(...)` — never `await`ed in `tick()`. `LocalReflection` is the default binding (`world.ts:66`). LLM path opt-in via `main.ts:5-10` (bound only when `VITE_OPENAI_API_KEY` present). `llm.ts:27-62` wraps fetch in try/catch → `null`, with `AbortController` timeout. Test `reflection.test.ts` "slow reflection does not block 50-agent tick" + "reflection failure keeps local goal" pass. |
| AC5 money invariant (integer cents, never <0) | PASS | `economy.ts:15-27 spend` returns `false` and leaves `balance.value` untouched when `balance.value < amount`; all amounts are integer cents (`config.ts`). `world.ts:362` gates `buy_food` on `spend()` returning true before debiting. Tests: economy "no code path drives balance below 0" + world "no agent balance goes below 0" over 500 ticks × 50 agents — both pass. |
| AC11 hot path (no per-tick alloc / no O(n²) scan) | PASS | Snapshot reuses `_agentViewPool` (`world.ts:168-204`) — views mutated in place, no per-tick array alloc; snapshot frozen + returned. Co-presence (`world.ts:407-418`) reads per-agent spatial buckets via `grid.agentsOnTile` (O(agents × tile-occupants)), not an O(n²) global agent pairwise scan. Relationships indexed by `Map` edge-key + per-agent edge `Set`. A* uses a real binary `MinHeap`. Bench: 962 ms / 1000 ticks confirms the budget. |

---

## Plan adherence (one row per step)

| Step | Status | Note |
|------|--------|------|
| P1.1 Vite+TS+Pixi scaffold, exact-pin deps | implemented | `package.json` pins `pixi.js@8.4.0` (exact), `vite@5.4.19`, `typescript@5.4.5`, `tsx@4.19.4`, `vitest@2.1.9`; `npm ls pixi.js` resolves; `npm run build` exits 0. |
| P1.2 tsconfig strict + index.html + main.ts | implemented | build runs `tsc` clean; `main.ts` present. |
| P1.3 import-direction guard | implemented (path deviated) | Guard lives at `test/sim/no-pixi-in-sim.test.ts`, not the planned `test/no-pixi-in-sim.test.ts`. Functionally identical, passes. Cosmetic path drift only. |
| P2.4 seedable PRNG | implemented | `rng.ts`; `rng.test.ts` (4 tests) asserts determinism. |
| P2.5 grid + pathfinding + spatial buckets | implemented | `grid.ts` A* + `agentsOnTile` buckets; `grid.test.ts` passes. |
| P2.6 landmark set + spawn (6 types) | implemented | `landmarks.ts placeLandmarks` all 6 types + extras; shortfall → warnings, no throw (`landmarks.test.ts`). |
| P2.7 clock↔phase | implemented | `clock.ts`; flips at `ticksPerDay/2`; `clock.test.ts` + world "phase flips at configured boundary". |
| P2.8 Agent entity + NeedsVector | implemented | `agent.ts`; `agent.test.ts`. |
| P2.9 per-tick needs decay | implemented | `needs.ts decayNeeds`; `needs.test.ts`. |
| P2.10 World.tick/snapshot, buffer reuse, per-agent rollback | implemented | `world.ts:139-204`; `takeSnapshot`/`restoreSnapshot` on exception; frozen pooled snapshot. See non-blocking #2 re: grid-position rollback gap. |
| P3.11 action catalogue | implemented | `actions/catalogue.ts` 6 actions w/ precondition+effects; `actions.test.ts`. |
| P3.12 utility scoring + memory-weighted selection | implemented | `actions/select.ts selectAction`; hungry→buy_food, broke→free action (`actions.test.ts`). |
| P3.13 economy earn/spend | implemented | `economy.ts`; see AC5 row. |
| P3.14 professions table (≥3) | implemented | `professions.ts` market_vendor/office_worker/temple_volunteer + wages; `professions.test.ts`. |
| P3.15 job-site fallback + no_job_site | implemented | `world.ts:346-348` emits `no_job_site`, halves wage, agent retained. See non-blocking #1 (test under-asserts the event). |
| P3.16 selection+execution in tick | implemented | `world.ts stepAgent`/`executeAction`; world economy integration test over 200 ticks. |
| P4.17 bounded outcome memory | implemented | `memory.ts OutcomeMemory` cap+eviction; `memory.test.ts`. |
| P4.18 record delta + adjust weight | implemented | `world.ts:250-252` records; `memory.ts:37-39` learning-rate update. See non-blocking #3 (no end-to-end "selects faster" test). |
| P4.19 relationships w/ spatial buckets, no O(n²) | implemented | `relationships.ts` + `world.ts updateCoPresence` via buckets; cap+decay; `relationships.test.ts`. |
| P4.20 day-phase schedule + sleep, park fallback | implemented | `select.ts applyPhaseBias` 2.5× night sleep/rest bias; `world.ts:372-379` sleep branch logs `sleep_park` when no condo. |
| P5.21 Pixi App + fixed-step RAF loop | implemented | `render/app.ts`; accumulator `while (lastTickMs >= tickIntervalMs)` decouples tick from frame rate. |
| P5.22 grid + 6 landmarks + day/night tint | implemented | `worldView.ts` tint shift on `snapshot.phase`. Visual — `manual-verify`. |
| P5.23 pooled agent sprites | implemented | `agentSprites.ts` `_sprites` Map keyed by id, reuse + despawn cleanup; constant sprite count. |
| P5.24 inspect panel (5 sections) | implemented | `inspectPanel.ts render` — needs bars, goal, thought, last-10 log, relationship list. Click interaction `manual-verify`. |
| P5.25 graceful close on missing agent | implemented | `inspectPanel.ts:33-36 onSnapshot` → `showInactive()` "Agent no longer active." |
| P6.26 ReflectionPort + LocalReflection default | implemented | `reflection/local.ts`, `ports.ts`; default binding in `world.ts:66`. |
| P6.27 mailbox + throttle drained, never awaits | implemented | `world.ts drainReflection`; throttle via `_lastReflectionMs` + `throttleMs`. |
| P6.28 optional LlmReflection, key-gated | implemented | `reflection/llm.ts`; `main.ts` binds only when key present; bounded payload `buildPrompt`. |
| P6.29 failure/timeout/absent-key → keep local goal | implemented | `llm.ts` catch→null + AbortController; `drainReflection` `.catch` no-op. |
| P7.30 bench harness | implemented | `scripts/bench-headless.ts` `--agents/--ticks`, prints wall-clock. |
| P7.31 profile/remove hot-path allocs | implemented | Pooled snapshot, bucket co-presence; bench 962 ms ≤ 10 s. |
| P7.32 sustained ≥30 fps at scale | not executed | Requires Chrome/WebGL. `manual-verify` — pooled sprites + decoupled RAF correct by review. |

All 32 plan steps accounted for. One cosmetic path deviation (P1.3); no skipped steps.

---

## Acceptance-criteria check (one row per AC + boundary clause)

| AC | Happy path | Boundary clause | Status |
|----|-----------|-----------------|--------|
| AC1 world init: 6 landmark types, ≥50 agents | `landmarks.ts placeLandmarks` (all 6 + extras), `getSpawnTiles` ≥50 distinct; `app.ts` bootstraps canvas; build exits 0 | shortfall → warning event + reduced set, no throw (`world.ts:74-83`, `landmarks.test.ts` tiny-grid) | PASS (canvas render `manual-verify`) |
| AC2 tick/day loop, per-agent updates | `world.ts tick` advances clock + decays + steps every agent; `world.test.ts` 100/1000-tick | per-agent exception → `restoreSnapshot` + loop continues (`world.ts:146-152`, "agent exception does not halt the loop") | PASS |
| AC3 needs-utility selection | `select.ts selectAction` highest score, memory-weighted; "hungry agent scores buy_food highest" | no affordable action → free fallback; "broke agent never selects a paid action" | PASS |
| AC4 day/night cycle | `clock.phase` flip; `select.ts applyPhaseBias` night sleep bias; `worldView.ts` tint | no residence → sleep in park (`world.ts:372-379` `sleep_park`) | PASS (tint visual `manual-verify`) |
| AC5 money economy | earn at work, spend on food, both logged (`world.ts:342-369`) | balance never <0 — `spend` guard; 500×50 tick test | PASS |
| AC6 ≥3 professions | `professions.ts` 3 types + wages; office daytime work bias | job landmark removed → park fallback + `no_job_site`, agent retained (`world.ts:346-348`) | PASS (see NB#1: behaviour present, test under-asserts) |
| AC7 relationships | co-presence ≥5 ticks → edge; `socialMultiplier = 1 + strength×factor` | per-agent cap; no new edge until one decays below threshold (`relationships.ts:36-37,52-56`) | PASS |
| AC8 observation UI | `inspectPanel.ts render` 5 sections (needs bars, goal, thought, last-10 log, rels) | agent gone → `showInactive()` "agent no longer active", no stale data | PASS (render logic verified; click interaction `manual-verify`) |
| AC9 outcome learning | `memory.ts record` + weight adjust toward observed; positive raises weight >1 | bounded last-N (default 20) per context, oldest evicted; wipe→baseline 1.0 | PASS (see NB#3: mechanism tested, end-to-end "selects faster" not) |
| AC10 LLM reflection (optional) | ≤1/agent/interval (60 s default), bounded payload, goal update via mailbox; loop never awaits | absent key / network err / timeout → keep local goal, no UI error, sim uninterrupted | PASS |
| AC11 scale | headless 1000 ticks ≤10 s — **measured 962 ms**; pooled snapshot, bucket co-presence, no per-tick alloc | — | PASS (headless half); ≥30 fps half `manual-verify` |

All 11 ACs and their boundary clauses have real behaviour behind them. No unticked criterion. The two `manual-verify` items (AC8 click, AC11 fps) are render-only and require a browser/WebGL — per orchestrator instruction they are not blocking.

**Unticked acceptance criteria: 0.**

---

## Non-AC slot check

**Definition of Done / NFR**: spec `Non-functional requirements` declares AC11 the sole NFR and states all sections thread through it — covered above (headless half measured, fps half `manual-verify`). No separate DoD artifact list in spec.

**Constraints** (all `[inferred — confirm at gate]`):
- Stack = PixiJS + TS browser SPA — honoured (`package.json`, `vite.config.ts`, `app.ts`).
- Build tooling = Vite — honoured (`vite build`).
- Architecture: sim core decoupled from renderer, headless-testable, renderer read-only — **honoured and lint-enforced** (guard test + 14 headless test files run with no canvas).
- LLM reconciliation: runs fully on local AI, no key/network by default, throttled/async/non-blocking, silent fallback — honoured (`LocalReflection` default, opt-in LLM, `drainReflection` non-blocking).
- Bangkok landmark set (6 named types) — honoured (`landmarks.ts` Thai-named market/temple/office/condo/park/bts).
- "Learning" = outcome-memory utility scoring, not model training — honoured (`memory.ts`).

No constraint violated. No banned dependency. No crossed boundary.

---

## Files-touched verification

Every changed path matches its plan `Files touched` Why column: scaffold (`package.json`/`tsconfig.json`/`index.html`/`vite.config.ts`/`eslint.config.js`), sim core (`src/sim/**`), reflection (`src/sim/reflection/**`), render adapter (`src/render/**`), `src/main.ts`, `scripts/bench-headless.ts`, `test/**`. `eslint.config.js` is an unlisted-but-expected scaffold file (tooling) — not a mismatch. No file changed outside the declared surface.

---

## Findings

### Blocking (0)

None.

### Non-blocking (carry to retro)

1. **AC6 `no_job_site` test under-asserts** — `test/sim/professions.test.ts` "no_job_site warning event emitted when fallback occurs" only asserts agents remain; it never inspects the event log for a `no_job_site` entry. The behaviour IS implemented (`world.ts:346-348`) and code-reviewed, but the named test does not actually pin it. Recommend asserting the event is present (expose/read via `world.recentEvents` / `allRecentEvents`).
2. **Per-agent rollback does not restore grid bucket position** — `world.ts:146-152` calls `agent.restoreSnapshot` on exception, restoring `agent.pos`, but the agent's `Grid` bucket entry (`removeAgent`/`placeAgent`) is mutated only in the path-step branch which returns before any throwable work. So today no reachable throw path desyncs bucket vs `pos`. It is a latent fragility: if future action logic throws *after* a grid move within `stepAgent`, the spatial bucket would point at the post-move tile while `pos` rolls back. Consider snapshotting/restoring grid position too, or asserting the invariant.
3. **AC9 lacks an end-to-end "selects faster" test** — `memory.test.ts` proves the weight mechanism (positive outcomes raise weight >1, wipe→baseline) and `select.ts` multiplies score by the weight, so the spec `e.g.` holds by construction. There is no integration test that a 10-history agent picks buy_food before a naive agent in the same context. Mechanism verified; behavioural assertion is a gap.
4. **`drainReflection` throttle keyed on `Date.now()`** — correct per AC10 ("every 60 real-seconds") and matches the spec. Worth noting for the retro: in the headless bench (1000 ticks in ~1 s real time) reflection fires once per agent on tick 1 then is throttled for 60 s, so the bench does not exercise repeated reflection drain. Acceptable for AC11 (default `LocalReflection` is synchronous-equivalent and cheap), but the repeated-drain path is only covered by the unit test, not the bench.

### Manual-verify (browser/WebGL — not executable in this container, not blocking)

- **AC8 click interaction** — `agentSprites.ts onAgentClick` hit-test + `panel.open` are correct by review; requires a pointer event on a rendered canvas.
- **AC11 ≥30 fps sustained** — pooled sprites + RAF accumulator decoupled from tick rate are correct by review; requires Chrome DevTools fps monitor at 50 agents.

---

## Verdict

`approve` — **0 blocking findings, 0 unticked acceptance criteria.** Headless surface (build, 56 tests, bench) independently re-run and green. Four non-blocking items carry to `retro.md`; two render-only AC items tagged `manual-verify` for a browser pass before/at ship.
