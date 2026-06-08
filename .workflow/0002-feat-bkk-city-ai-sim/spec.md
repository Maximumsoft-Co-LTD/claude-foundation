# Spec: Bangkok City 2D AI Simulation

**ID**: 0002-feat-bkk-city-ai-sim · **Type**: feat · **Status**: draft · **Ship as**: one-drop · **Open PR on ship**: yes · **Parent**: none

## Goal

Build a browser-based 2D Bangkok-city simulation where all agents are AI-driven NPCs — not human-controlled — that live, work, and learn over time while the human observes emergent behaviour.

## Problem

There is no tool to watch dozens of AI agents co-inhabit a stylised Bangkok environment, pursue careers and needs, form relationships, and adapt their behaviour through outcome-based learning. The value proposition is pure observation: "what will these agents do and what emerges when you leave them to it?"

## Users

- **Observer (human)** — watches the simulation from a top-down view, clicks individual agents to inspect their state, goals, and relationships. Does not control any agent. This is the only human actor.
- **AI Agent (NPC)** — the simulation's "player". Multiple agents co-exist in the city, each driven by a needs-utility brain with optional LLM goal-reflection.

## User journey

1. Observer opens the app in a browser → the Bangkok grid city loads with landmarks visible and several AI agents spawned at start positions. `[→ AC1]`
2. The simulation tick loop starts automatically; agents begin moving toward actions scored by their needs. `[→ AC2, AC3]`
3. Day/night cycle advances visually; agents adjust activity patterns accordingly (e.g. sleeping at condo at night). `[→ AC4]`
4. Observer watches agents earn money at their job landmark, spend at the market, rest at the condo or park. `[→ AC5, AC6]`
5. Over many ticks, relationships form between agents that share space; social need satisfaction influences future action scores. `[→ AC7]`
6. Observer clicks an agent → inspect panel opens showing that agent's current needs, active goal, thought bubble, recent activity log, and relationships. `[→ AC8]`
7. Observer sees an agent's learning effect: an agent that has repeatedly succeeded at a food run raises the utility score for that action, visibly preferring it in future ticks. `[→ AC9]`
8. (Optional, requires API key) LLM reflection fires asynchronously for a bounded subset of agents each interval, updating their high-level goals; all other agents and the tick loop continue uninterrupted. `[→ AC10]`

## Acceptance criteria

- [ ] AC1: World initialisation — a PixiJS canvas renders a stylised top-down Bangkok grid with at least six landmark types (market, temple, office tower, condo/residence, park, BTS/transit stop) and ≥ 50 agents placed at valid starting positions.
  - e.g.: on page load with default config → canvas is visible, all six landmark types are present on the grid, 50 agent sprites are rendered at distinct tile positions.
  - on error / at boundary: if a landmark or agent count is below the configured minimum (e.g. asset fails to load) → the app logs the error, falls back to a reduced set, and does not crash the tick loop.

- [ ] AC2: Tick/day loop — the simulation advances a discrete world-tick on a fixed interval; each tick updates every agent's needs, position, and action state. A full in-simulation day is composed of a configured number of ticks.
  - e.g.: after 1 tick → each agent's hunger/energy values have decremented by their per-tick decay rate; any agent whose current action completed transitions to the "idle, choose next action" state.
  - on error / at boundary: if a tick computation throws an unhandled exception for one agent → that agent's state is rolled back to its last valid snapshot and the tick loop continues for all other agents without halting.

- [ ] AC3: Needs-utility action selection — each agent scores all candidate actions against its current needs vector (hunger, energy, money, social) and selects the highest-scoring action; the scoring weights are informed by the agent's outcome memory.
  - e.g.: a hungry agent (hunger < 30%) near a market landmark with money > 0 → scores "go to market and buy food" highest, walks to the market tile, executes the purchase, and hunger rises by the food's satisfaction value.
  - on error / at boundary: if no reachable action scores above a minimum threshold (e.g. agent is broke and all food actions cost money) → agent selects the highest-scoring free/affordable action (e.g. "rest in park") and does not attempt an action it cannot afford.

- [ ] AC4: Day/night cycle — the canvas renders visually distinct day and night states; agents follow a day-phase activity schedule (work/social during day, rest/sleep at night).
  - e.g.: at the night-phase tick boundary → the canvas tint shifts to a night palette, agents with "sleep" need above threshold path-find to their designated condo/residence and enter a sleep action.
  - on error / at boundary: if an agent has no assigned residence → it sleeps in the nearest park tile; it does not error or skip the sleep action entirely.

- [ ] AC5: Money economy — agents earn money by completing work actions at their job landmark; agents spend money on need-satisfying purchases; an agent's balance never goes below zero.
  - e.g.: agent with `profession = market_vendor` completes a work shift at the market landmark → balance increases by the shift wage; agent then buys food → balance decreases by the food cost; both transactions are recorded in the activity log.
  - on error / at boundary: agent with balance = 0 attempting a paid action → action is blocked at the selection stage (see AC3 boundary); balance is never decremented below 0 by any code path.

- [ ] AC6: Multiple professions — the simulation includes at least three distinct profession types (e.g. market vendor, office worker, temple monk/volunteer); profession determines which landmark is the agent's job site and the wage/reward structure.
  - e.g.: an office-worker agent's highest-scoring daytime action is "go to office tower and work" → it paths there, earns the office wage, and the activity log records `profession: office_worker, action: work, reward: <amount>`.
  - on error / at boundary: if a profession's job landmark is removed from the map → agents of that profession fall back to the park "idle earn" action and log a `no_job_site` warning; they are not removed from the simulation.

- [ ] AC7: Relationships — agents that share a landmark tile for a configurable number of ticks form a relationship; relationship strength increases the social-need satisfaction multiplier for future shared-space actions between those two agents.
  - e.g.: two agents co-present at the park for ≥ 5 ticks → a relationship edge is created between them; on subsequent co-presence the social satisfaction value each receives is multiplied by `1 + (relationship_strength * social_bonus_factor)`.
  - on error / at boundary: maximum relationship count per agent is capped at a configured limit; once the cap is reached, no new relationships form until an existing one decays below the minimum-strength threshold.

- [ ] AC8: Observation UI — clicking an agent sprite opens an inspect panel showing: current needs bar chart, active goal label, thought bubble (latest decision rationale string), recent activity log (last 10 entries), and relationship list with strength values.
  - e.g.: observer clicks agent #7 → inspect panel renders with hunger = 45%, energy = 80%, goal = "earn money at office", thought bubble = "Low funds, heading to work", activity log showing last 10 timestamped entries.
  - on error / at boundary: if the inspect panel is open and the inspected agent is removed (e.g. future despawn mechanic) → panel closes gracefully with a "agent no longer active" message; no stale data is displayed.

- [ ] AC9: Outcome-based learning — after each action completes, the agent records the resulting need-satisfaction delta in its outcome memory; over repeated identical-context executions, the utility weight for that action is adjusted toward the historically observed satisfaction value.
  - e.g.: agent has completed 10 successful "buy food at market" actions → the utility score for that action in a hungry+has-money context is higher than its initial default, causing the agent to select it faster than a naive agent with no history.
  - on error / at boundary: outcome memory is bounded to the last N entries per action-context pair (configurable, default 20); oldest entries are evicted when the cap is hit; learning effect degrades gracefully to baseline if memory is wiped.

- [ ] AC10: LLM reflection (optional) — when an OpenAI-compatible API key is configured, a reflection worker fires at most once per agent per configurable interval (default: every 60 real-seconds), sends a bounded context payload, and updates the agent's high-level goal string; the tick loop is never blocked and never awaits this call.
  - e.g.: agent #3 hasn't earned enough money for 30 ticks → reflection returns goal = "prioritise earning: take overtime shift" → agent's goal label updates on the next inspect panel open; in the meantime the tick loop has continued for all 50+ agents.
  - on error / at boundary: API key absent, network error, or response timeout → the agent silently retains its locally-derived goal (highest-priority unmet need as goal string); no error surfaces to the observer UI; the simulation continues uninterrupted.

- [ ] AC11: Scale — the simulation sustains ≥ 50 active agents running the full needs-utility-learning loop for ≥ 1 000 consecutive ticks without the canvas dropping below 30 fps (observed in Chrome on a modern laptop) and without the headless simulation exceeding 10 seconds wall-clock for 1 000 ticks. — measured: `npx tsx scripts/bench-headless.ts --agents 50 --ticks 1000` (wall-clock ≤ 10 s); Chrome DevTools fps monitor at 50 agents for 60 real-seconds (fps ≥ 30 sustained).

## Scope — Out

- **Human-controlled player** — no player character; the human is observer-only. A "play as agent" mode is out of scope.
- **Multiplayer / networked simulation** — all agents and state live in a single browser session.
- **Persistent save / load beyond a session** — state is held in memory; no server-side persistence, no save file (unless trivial `localStorage` snapshot is a later follow-up).
- **Real-map GIS / accurate Bangkok geography** — the city is a stylised grid with Bangkok-themed landmark names and sprites; it is not geographically accurate.
- **LLM fine-tuning or model training** — learning is outcome-memory utility scoring, not gradient-based model training.
- **Mobile or native app** — browser (desktop) only for first drop.
- **Agent-vs-agent conflict / combat mechanics** — agents co-exist without adversarial interaction in v1.

## Non-functional requirements

Scale and performance target: AC11. All other sections (plan, qa, review) thread through AC11 directly.

## Constraints

- **Stack**: PixiJS (WebGL 2D) + TypeScript browser SPA [inferred — confirm at gate]
- **Build tooling**: Vite [inferred — confirm at gate]
- **Architecture**: simulation core (agents, needs engine, utility-AI, economy, learning, world/tick loop) is decoupled from the PixiJS rendering layer (ports-and-adapters split); the core runs and is unit-tested headlessly without a browser or canvas; the renderer is a read-only subscriber to sim-state events [inferred — confirm at gate]
- **LLM reflection reconciliation**: the sim MUST run fully and correctly on the local utility-AI alone — no API key required, no network calls at runtime by default. LLM reflection is an optional, throttled, asynchronous enhancement layer: it never blocks the real-time tick loop, runs for at most a bounded number of agents per interval, and on any failure or absent key the agent silently falls back to a locally-derived goal. This constraint is what makes the Hybrid AI model compatible with ≥ 50 agents in real time. [inferred — confirm at gate]
- **Bangkok landmark set**: market (ตลาด), temple (วัด), office tower, condo/residence, park, BTS/transit stop — stylised sprites, not photorealistic assets [inferred — confirm at gate]
- **"Learning" definition**: outcome memory adjusting utility scores over time (lightweight reinforcement of what satisfied needs in context) — NOT neural-network or gradient-based model training [inferred — confirm at gate]

## Discovery notes

Fanout research was not dispatched for this run. The architecture constraint (decoupled sim core / PixiJS adapter) is an inference from the Hybrid AI + 50-agent scale requirement: a blocking renderer in the hot tick path would prevent the scale target (AC11) from being met. The `hexagonal-backend` skill should be consulted by the implementer at the design phase for the core/adapter boundary. The LLM-reflection reconciliation constraint is similarly inferred: without it, 50 simultaneous LLM calls per reflection interval would be both unaffordable and latency-incompatible with real-time rendering.
