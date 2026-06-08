# Plan: Bangkok City 2D AI Simulation

**Spec**: [./spec.md](./spec.md) · **Type**: feat · **Size**: L · **Status**: draft

## Reviewer summary

**Root cause / goal**: build a headless-testable AI-agent simulation core (needs → utility AI → economy → relationships → outcome-learning), driven by a fixed-step tick loop, with PixiJS as a read-only render adapter and LLM reflection as an optional injected port — meeting a ≥50-agent / 1000-tick / ≤10 s headless / ≥30 fps scale budget.

**Decisions needing sign-off** (all spec items tagged `[inferred — confirm at gate]`):
- **Stack = PixiJS 8 + TypeScript + Vite**, sim core authored as a framework-free TS module under `src/sim/` so it imports zero PixiJS. Rejected: putting sim logic in PixiJS `Ticker` callbacks — that couples the core to the canvas and fails headless test + AC11 bench.
- **Core ↔ render boundary = a read-only `WorldSnapshot` the renderer reads each frame** (pull model), plus a small `SimEvent` log the inspect panel reads. Rejected: per-field observer/event-emitter into Pixi sprites — too many per-tick allocations against the 50-agent budget.
- **LLM reflection = `ReflectionPort` injected into the world; default binding is `LocalReflection` (pure, no network)**. The tick loop never `await`s reflection; results land via a mailbox the agent drains on its next decision. Rejected: awaiting the LLM in the tick path — violates AC10 + AC11.
- **Tick loop is fixed-step and deterministic given a seed**; render runs on `requestAnimationFrame` decoupled from tick rate. Rejected: variable dt in the sim — breaks reproducible headless bench and learning tests.

**Top risks**:
- High: per-tick allocation / O(n²) agent-or-relationship scans blow the 10 s headless budget (AC11). Mitigated by spatial bucketing for co-presence and reused typed arrays/objects in the hot path.
- Medium: render adapter accidentally importing sim internals (or vice-versa) erodes the decoupling. Mitigated by an import-direction lint check (P1) that fails CI if `src/sim/**` imports `pixi.js`.
- Medium: float money drift / negative balances. Mitigated by integer-cent balances and a single guarded `spend()` path (AC5).

## Approach

Author the simulation as a framework-free, deterministic, fixed-step core under `src/sim/` that exposes a `World.tick()` returning a read-only `WorldSnapshot`; PixiJS lives under `src/render/` and only *reads* snapshots + the event log each animation frame, never the reverse. The hybrid AI is a `ReflectionPort` whose default adapter is a pure local goal-deriver, with an optional async OpenAI-compatible adapter that posts goal updates to a per-agent mailbox the loop drains without ever awaiting it. Phases below are build groupings (foundation-first), not ship gates — the whole thing ships in one drop per spec `Ship as: one-drop`.

## Step order

Foundation-first (L, >12 steps, single drop): P1 scaffolds the project + the core/render decoupling guard; P2 builds the deterministic core (world, tick, agents, needs); P3 adds utility AI + economy + professions; P4 adds learning + relationships + day/night; P5 builds the PixiJS render adapter + inspect UI; P6 adds the LLM reflection port; P7 hardens for scale + lands the benchmark. Each phase ends on a runnable verify so review can walk it incrementally.

## Folder structure

```
src/
  sim/                      # framework-free core — imports ZERO pixi.js (lint-enforced)
    world.ts                # World aggregate: agents, landmarks, clock, tick(), snapshot()
    clock.ts                # tick counter ↔ day-phase (day/night) mapping
    rng.ts                  # seedable PRNG (deterministic bench/tests)
    grid.ts                 # tile grid + A* / greedy pathfinding + spatial buckets
    agent.ts                # Agent entity: needs vector, balance, profession, goal, memory
    needs.ts                # per-tick needs decay + satisfaction application
    actions/                # action catalogue (go-to/work/buy/rest/sleep/socialise)
      catalogue.ts          # action definitions + preconditions + effects
      select.ts             # utility scoring + highest-score selection (uses memory)
    economy.ts              # earn/spend, integer-cent balances, never < 0
    professions.ts          # profession → job landmark + wage/reward table
    relationships.ts        # co-presence accrual, relationship graph, social multiplier
    memory.ts               # bounded outcome memory + utility-weight learning
    ports.ts                # ReflectionPort interface + SimEvent / WorldSnapshot types
    reflection/
      local.ts              # default pure local goal-deriver (no network)
      llm.ts                # optional OpenAI-compatible async adapter + mailbox
    landmarks.ts            # Bangkok landmark set + valid spawn placement
    config.ts               # tunables (tick ms, decay rates, caps, day length…)
  render/                   # PixiJS read-only adapter — reads WorldSnapshot only
    app.ts                  # bootstraps Pixi Application + RAF loop driving World.tick
    worldView.ts            # draws grid, landmarks, day/night tint from snapshot
    agentSprites.ts         # sprite pool keyed by agentId; positions from snapshot
    inspectPanel.ts         # click→agent inspect panel (needs/goal/thought/log/rels)
  main.ts                   # SPA entry: build World, default LocalReflection, start render
scripts/
  bench-headless.ts         # AC11 harness: --agents N --ticks M, prints wall-clock
test/
  sim/*.test.ts             # headless unit/integration tests (tsx, no canvas)
index.html                  # Vite entry
```

## API / event contracts

Internal port + read-model the Steps must satisfy (the render adapter and LLM adapter are forbidden from inventing alternatives):

```
// src/sim/ports.ts

interface WorldSnapshot {            // read-only pull model, rebuilt/reused per tick
  tick: number;
  phase: 'day' | 'night';
  agents: ReadonlyArray<AgentView>;  // pos, needs, balance, goal, professionId
  landmarks: ReadonlyArray<LandmarkView>;
}

interface SimEvent {                 // append-only activity log (drives inspect panel)
  tick: number; agentId: string; kind: string; detail: string;
}

interface ReflectionInput {          // bounded context sent to a reflection adapter
  agentId: string; needs: NeedsVector; balance: number;
  recentEvents: ReadonlyArray<SimEvent>; currentGoal: string;
}

interface ReflectionPort {
  // MUST NOT be awaited by the tick loop. Local impl resolves synchronously-equivalent;
  // LLM impl resolves later and the result is delivered to a per-agent mailbox.
  reflect(input: ReflectionInput): Promise<{ goal: string } | null>;  // null = keep local goal
  readonly throttleMs: number;       // min real-ms between calls per agent
}
```

The default `World` is constructed with `LocalReflection` (pure, `reflect` derives the goal from the highest-priority unmet need; never returns a network error). `main.ts` swaps in `LlmReflection` only when an API key is present in config.

## Steps

### Phase 1: Scaffold + decoupling guard

1. Init Vite + TS + Pixi project — `package.json` (new), pin `pixi.js@8.x` exact, `vite@^5`, `typescript@^5`, `tsx@^4`, `vitest@^2` — verify: `npm ls pixi.js` resolves the pinned version and `npm run build` exits 0 [AC1]
2. Add `tsconfig.json` (new) strict mode + `index.html` (new) + empty `src/main.ts` (new) Vite entry — verify: `npm run dev` serves a blank canvas page without console errors [AC1]
3. Add core/render import-direction guard — `test/no-pixi-in-sim.test.ts` (new) greps `src/sim/**` for `pixi.js` imports and fails if any exist — verify: `npx vitest run test/no-pixi-in-sim.test.ts` passes (0 violations) [AC1, AC11]

### Phase 2: Deterministic core — world, clock, grid, agents, needs

4. Implement seedable PRNG — `src/sim/rng.ts#makeRng (new)` — verify: `npx vitest run` test asserts same seed → same sequence [AC2]
5. Implement tile grid + pathfinding + spatial buckets — `src/sim/grid.ts#Grid (new)` — verify: test finds a path between two tiles and `agentsOnTile()` returns co-located ids without scanning all agents [AC1, AC11]
6. Implement landmark set + valid spawn placement (6 types: market, temple, office, condo, park, BTS) — `src/sim/landmarks.ts#placeLandmarks (new)` — verify: test asserts all six types present and ≥50 agents placed at distinct valid tiles; on shortfall returns reduced set + logs, no throw [AC1]
7. Implement clock ↔ day-phase mapping — `src/sim/clock.ts#Clock (new)` — verify: test asserts configured ticks-per-day flips `phase` day→night at the boundary [AC2, AC4]
8. Implement `Agent` entity (needs vector, integer-cent balance, profession, goal, memory handle) + `NeedsVector` — `src/sim/agent.ts#Agent (new)` — verify: test asserts a fresh agent has all needs in range and balance ≥ 0 [AC2]
9. Implement per-tick needs decay — `src/sim/needs.ts#decay (new)` — verify: test asserts hunger/energy decrement by configured rate after one call [AC2]
10. Implement `World.tick()` + `World.snapshot()` returning read-only `WorldSnapshot`, reusing buffers (no per-tick array allocation in the hot path) — `src/sim/world.ts#World (new)` — verify: test runs 100 ticks on 50 agents; each tick advances clock, decays every agent, returns a frozen snapshot; per-agent tick exception rolls that agent back to last snapshot and loop continues [AC2, AC11]

### Phase 3: Utility AI + economy + professions

11. Define action catalogue with preconditions + effects (go-to / work / buy-food / rest / sleep / socialise) — `src/sim/actions/catalogue.ts#ACTIONS (new)` — verify: test asserts each action exposes precondition + needs-effect [AC3]
12. Implement utility scoring + highest-score selection consulting outcome memory — `src/sim/actions/select.ts#selectAction (new)` — verify: test: hungry agent (hunger<30) near market with balance>0 scores buy-food highest; broke agent never selects a paid action and falls back to a free action above threshold [AC3, AC5]
13. Implement money economy: `earn()` / `spend()` on integer-cent balances, `spend` blocked if it would go below 0 — `src/sim/economy.ts#spend (new)` — verify: test asserts no code path drives balance < 0; earn then spend updates balance and appends two `SimEvent`s [AC5]
14. Implement professions table (≥3: market_vendor, office_worker, temple_volunteer) → job landmark + wage — `src/sim/professions.ts#PROFESSIONS (new)` — verify: test asserts each profession resolves a job landmark + wage; office worker's daytime top action is work-at-office and logs `profession, action, reward` [AC6]
15. Wire job-site fallback: if a profession's job landmark is absent → park "idle earn" + `no_job_site` warning event, agent retained — `src/sim/professions.ts#resolveJobSite` — verify: test removes office landmark, asserts office agents earn via park fallback and emit `no_job_site`, none despawned [AC6]
16. Integrate selection + action execution into `World.tick()` (agent picks action, paths, executes effect, earns/spends, emits events) — `src/sim/world.ts#stepAgent` — verify: 200-tick test on mixed professions: agents earn at job sites, spend on food, hunger recovers after buy-food [AC3, AC5, AC6]

### Phase 4: Learning + relationships + day/night behaviour

17. Implement bounded outcome memory (last N per action-context, default 20, oldest evicted) — `src/sim/memory.ts#OutcomeMemory (new)` — verify: test asserts cap enforced + eviction order; wiping memory degrades scores to baseline [AC9]
18. Record need-satisfaction delta after each action + adjust utility weight toward observed value — `src/sim/memory.ts#recordOutcome` wired into `world.ts#stepAgent` — verify: test: agent after 10 successful buy-food runs selects buy-food faster than a no-history agent in the same context [AC9]
19. Implement relationships: co-presence accrual on shared landmark tile for configured ticks → relationship edge; strength raises social-need multiplier; per-agent cap with decay-gated replacement — `src/sim/relationships.ts#RelationshipGraph (new)`, using grid spatial buckets (no O(n²) agent scan) — verify: test: two agents co-present at park ≥5 ticks form an edge; subsequent social satisfaction = base × (1 + strength×factor); cap blocks new edges until one decays below threshold [AC7, AC11]
20. Implement day-phase activity schedule + sleep behaviour: night → high-sleep agents path to assigned condo and sleep; no residence → nearest park tile, never skip — `src/sim/actions/select.ts#applyPhaseBias` + `world.ts#stepAgent` — verify: test: at night boundary, agents with sleep need path to condo and enter sleep; residence-less agent sleeps in park, no error [AC4]

### Phase 5: PixiJS render adapter + observation UI

21. Bootstrap Pixi `Application` + RAF loop that calls `World.tick()` at fixed sim-step and renders latest snapshot (render decoupled from tick rate) — `src/render/app.ts#startRender (new)` + `src/main.ts` — verify: `npm run dev` shows the grid + day/night tint shifting; tick loop runs independent of frame rate [AC1, AC2, AC4]
22. Draw grid, six landmark types, and day/night palette tint from snapshot `phase` — `src/render/worldView.ts#WorldView (new)` — verify: dev page shows all six landmark sprites; tint visibly shifts day↔night [AC1, AC4]
23. Pooled agent sprites keyed by `agentId`, positioned from snapshot each frame (sprite reuse, no per-frame sprite alloc) — `src/render/agentSprites.ts#AgentSprites (new)` — verify: dev page shows 50 agents moving; sprite count stays constant across ticks [AC1, AC11]
24. Inspect panel: click agent sprite → panel with needs bar chart, goal label, thought bubble (latest decision rationale), last-10 activity log, relationship list w/ strengths; reads snapshot + event log only — `src/render/inspectPanel.ts#InspectPanel (new)` — verify: dev page click on an agent opens panel with all five sections populated [AC8]
25. Inspect panel graceful-close when inspected agent no longer in snapshot → "agent no longer active", no stale data — `src/render/inspectPanel.ts#onSnapshot` — verify: test/manual: remove agent from snapshot while panel open → panel shows the message and clears fields [AC8]

### Phase 6: LLM reflection port (optional, async, non-blocking)

26. Define `ReflectionPort` + `LocalReflection` default (pure: goal = highest-priority unmet need string, never errors) — `src/sim/reflection/local.ts#LocalReflection (new)`, types in `src/sim/ports.ts#ReflectionPort (new)` — verify: test asserts local reflect returns a goal for any input and never throws/awaits network [AC10]
27. Per-agent reflection mailbox + throttle drained in `World.tick()` (loop never awaits; result applied on next decision) — `src/sim/world.ts#drainReflection` — verify: test: a slow/pending reflection promise does not block a 50-agent tick; goal updates apply once resolved [AC10, AC11]
28. Optional `LlmReflection` OpenAI-compatible adapter sending bounded `ReflectionInput`, ≤1 call/agent/interval (default 60 s); `main.ts` binds it only when API key present — `src/sim/reflection/llm.ts#LlmReflection (new)` + `src/main.ts` — verify: test with mock transport asserts throttle (≤1/interval) and bounded payload; with no key `main.ts` uses `LocalReflection` [AC10]
29. Failure/timeout/absent-key path: agent silently keeps locally-derived goal, no UI error, sim uninterrupted — `src/sim/reflection/llm.ts#reflect` (catch→null) — verify: test: transport rejects/times out → mailbox gets nothing, agent retains local goal, no thrown error [AC10]

### Phase 7: Scale hardening + benchmark

30. Build headless benchmark harness — `scripts/bench-headless.ts (new)` — accepts `--agents N --ticks M`, builds a World with `LocalReflection`, runs M ticks, prints wall-clock ms — verify: `npx tsx scripts/bench-headless.ts --agents 50 --ticks 1000` prints a wall-clock figure [AC11]
31. Profile + remove hot-path allocations / O(n²) scans flagged by the bench (snapshot buffer reuse, spatial-bucket co-presence, memory map reuse) — `src/sim/world.ts#tick`, `src/sim/relationships.ts` — verify: `npx tsx scripts/bench-headless.ts --agents 50 --ticks 1000` completes in ≤ 10 s wall-clock [AC11]
32. Verify sustained render fps at scale — `src/render/app.ts` (no code change expected; cap render work, reuse sprites) — verify: Chrome DevTools fps monitor at 50 agents for 60 real-seconds reads ≥ 30 fps sustained [AC11]

## Alternatives considered

- **PixiJS `Ticker` drives sim logic directly** (no separate core). Rejected: couples sim to canvas, makes headless unit tests + the AC11 bench impossible, and ties tick rate to frame rate (breaks deterministic learning tests).
- **Event-emitter / observer per agent field into sprites** (push model). Rejected: 50 agents × multiple needs × 1000 ticks = heavy per-tick allocation and listener churn against the 10 s budget; a reused pull snapshot is cheaper and simpler.
- **Await LLM reflection inside the tick loop** (simplest to write). Rejected outright: violates AC10 (never blocks) and AC11 (real-time at 50 agents) — 50 network calls per interval would stall the loop.
- **Float dollar balances.** Rejected: float drift risks balance < 0 and breaks AC5's hard invariant; integer cents make the guard exact.

## Files touched

| Path | Change | Why |
|------|--------|-----|
| `package.json`, `tsconfig.json`, `index.html`, `vite.config.ts` | new | project scaffold + strict TS [AC1] |
| `src/sim/{world,clock,rng,grid,agent,needs,economy,professions,relationships,memory,landmarks,config,ports}.ts` | new | framework-free deterministic core [AC1–AC9] |
| `src/sim/actions/{catalogue,select}.ts` | new | utility-AI action selection [AC3, AC4, AC5, AC6, AC9] |
| `src/sim/reflection/{local,llm}.ts` | new | reflection port + default + optional LLM adapter [AC10] |
| `src/render/{app,worldView,agentSprites,inspectPanel}.ts` | new | read-only PixiJS adapter + inspect UI [AC1, AC4, AC8] |
| `src/main.ts` | new | SPA entry; binds default LocalReflection [AC1, AC10] |
| `scripts/bench-headless.ts` | new | AC11 headless scale harness [AC11] |
| `test/**` | new | headless sim tests + import-direction guard [AC2–AC11] |

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Per-tick allocation / O(n²) co-presence or relationship scan blows the 10 s headless budget (AC11) | High | P2.10 reuses snapshot buffers; P4.19 uses grid spatial buckets for co-presence; P7.31 profiles + removes hot-path allocs against the bench |
| Render adapter imports sim internals (or sim imports pixi) eroding the decoupling | Medium | P1.3 import-direction test fails CI on any `pixi.js` import under `src/sim/**` |
| Float money drift → negative balance violates AC5 invariant | Medium | Integer-cent balances + single guarded `spend()` (P3.13) |
| LLM adapter accidentally awaited in the loop, stalling at scale | Medium | Mailbox/throttle design (P6.27); P6.27 test asserts a pending promise never blocks a 50-agent tick |
| Pathfinding cost dominates the tick at 50 agents | Medium | Greedy/A* on a small grid with cached paths; flagged as a profile target in P7.31 |

## Observability

- Sim emits structured `SimEvent` entries (tick, agentId, kind, detail) for every earn/spend/action/relationship/fallback — these double as the activity log (AC8) and the failure-mode surface (`no_job_site`, snapshot rollback, reflection-failure-keeps-local-goal). The bench (P7.30) prints wall-clock as the AC11 metric; the dev page exposes fps via DevTools (P7.32).

## Dependencies

- `pixi.js@8.x` (render only), `vite`, `typescript`, `tsx` (headless bench + tests), `vitest` (test runner). All pinned at P1.1; no runtime network dependency by default (LLM adapter is opt-in and only loads when an API key is configured).

## Rollback

- Greenfield single drop on branch `claude/bkk-city-ai-game-dqi19p` — rollback = revert the feature commit / abandon the branch. No migrations, no shared state, no destructive operations. Data loss: none (all state is in-memory per session).

## Out of scope

Per spec `Scope — Out`: no human-controlled/play-as-agent mode, no multiplayer/networking, no cross-session persistence, no GIS-accurate geography, no model training/fine-tuning, no mobile/native, no agent-vs-agent conflict. `localStorage` snapshot is explicitly a later follow-up, not this drop.
