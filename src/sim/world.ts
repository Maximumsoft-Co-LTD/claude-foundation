import { CONFIG } from './config.js';
import { Clock } from './clock.js';
import { Grid } from './grid.js';
import { Agent } from './agent.js';
import { decayNeeds, satisfyNeed, needsUrgency } from './needs.js';
import { earn, spend } from './economy.js';
import { selectAction } from './actions/select.js';
import { ACTIONS, getAction } from './actions/catalogue.js';
import { RelationshipGraph } from './relationships.js';
import {
  placeLandmarks,
  getLandmarksByType,
  getSpawnTiles,
  type Landmark,
} from './landmarks.js';
import { PROFESSIONS, PROFESSION_IDS } from './professions.js';
import { makeRng } from './rng.js';
import { LocalReflection } from './reflection/local.js';
import type {
  WorldSnapshot,
  AgentView,
  SimEvent,
  ReflectionPort,
  ReflectionInput,
} from './ports.js';
import type { Pos } from './grid.js';

const MAX_EVENTS = 2000;
const SNAPSHOT_REFRESH_EVERY = 1;

export interface WorldOptions {
  seed?: number;
  agentCount?: number;
  reflection?: ReflectionPort | undefined;
  gridWidth?: number;
  gridHeight?: number;
  ticksPerDay?: number;
}

export class World {
  private readonly _clock: Clock;
  private readonly _grid: Grid;
  private readonly _agents: Map<string, Agent> = new Map();
  private readonly _landmarks: Landmark[];
  private readonly _landmarkMap: Map<string, Landmark> = new Map();
  private readonly _relationships: RelationshipGraph;
  private readonly _reflection: ReflectionPort;
  private readonly _events: SimEvent[] = [];
  private readonly _rng;
  private _agentViewPool: AgentView[];
  private _snapshot: WorldSnapshot;
  private _agentCount = 0;
  private readonly _lastReflectionMs: Map<string, number> = new Map();

  constructor(options: WorldOptions = {}) {
    const seed = options.seed ?? 42;
    const agentCount = options.agentCount ?? CONFIG.agentCount;
    const gridWidth = options.gridWidth ?? CONFIG.gridWidth;
    const gridHeight = options.gridHeight ?? CONFIG.gridHeight;
    const ticksPerDay = options.ticksPerDay ?? CONFIG.ticksPerDay;

    this._rng = makeRng(seed);
    this._clock = new Clock(ticksPerDay);
    this._grid = new Grid(gridWidth, gridHeight);
    this._relationships = new RelationshipGraph();
    this._reflection = options.reflection ?? new LocalReflection();

    const { landmarks, warnings } = placeLandmarks(gridWidth, gridHeight, this._rng);
    this._landmarks = landmarks;
    for (const lm of landmarks) {
      this._landmarkMap.set(lm.id, lm);
      this._grid.setWalkable(lm.pos.x, lm.pos.y, true);
    }
    if (warnings.length > 0) {
      this.pushEvent(0, 'world', 'init_warning', warnings.join('; '));
    }

    const { tiles, warnings: spawnWarnings } = getSpawnTiles(
      landmarks, gridWidth, gridHeight, this._rng, agentCount,
    );
    if (spawnWarnings.length > 0) {
      this.pushEvent(0, 'world', 'spawn_warning', spawnWarnings.join('; '));
    }

    const profKeys = PROFESSION_IDS;
    const condos = getLandmarksByType(landmarks, 'condo');
    let condoIdx = 0;

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i]!;
      const pid = profKeys[i % profKeys.length]!;
      const agent = new Agent(`a${i}`, pid, tile);

      const profession = PROFESSIONS[pid];
      if (profession) {
        const jobLandmarks = getLandmarksByType(landmarks, profession.jobLandmarkType);
        if (jobLandmarks.length > 0) {
          agent.jobLandmarkId = (jobLandmarks[i % jobLandmarks.length] ?? jobLandmarks[0])!.id;
        }
      }

      if (condos.length > 0) {
        agent.condoId = condos[condoIdx % condos.length]!.id;
        condoIdx++;
      }

      this._grid.placeAgent(agent.id, tile.x, tile.y);
      this._agents.set(agent.id, agent);
    }
    this._agentCount = this._agents.size;
    this._agentViewPool = new Array(this._agentCount);
    this._snapshot = this.buildSnapshot();
  }

  get agentCount(): number { return this._agentCount; }
  get landmarks(): readonly Landmark[] { return this._landmarks; }
  get clock(): Clock { return this._clock; }

  private pushEvent(tick: number, agentId: string, kind: string, detail: string): void {
    this._events.push({ tick, agentId, kind, detail });
    if (this._events.length > MAX_EVENTS) {
      this._events.splice(0, MAX_EVENTS / 4);
    }
  }

  recentEvents(agentId: string, count = 10): SimEvent[] {
    const result: SimEvent[] = [];
    for (let i = this._events.length - 1; i >= 0 && result.length < count; i--) {
      const ev = this._events[i]!;
      if (ev.agentId === agentId || ev.agentId === 'world') result.push(ev);
    }
    return result.reverse();
  }

  allRecentEvents(count = 10): SimEvent[] {
    return this._events.slice(-count);
  }

  tick(): WorldSnapshot {
    this._clock.advance();
    const currentTick = this._clock.tick;
    const nowMs = Date.now();

    for (const agent of this._agents.values()) {
      const snapshot = agent.takeSnapshot();
      try {
        this.stepAgent(agent, currentTick, nowMs);
      } catch (err) {
        agent.restoreSnapshot(snapshot);
        this.pushEvent(currentTick, agent.id, 'error', `tick error: ${String(err)}`);
      }
    }

    this.updateCoPresence(currentTick);
    this._relationships.decayAll();
    this.drainReflection(currentTick, nowMs);

    if (currentTick % SNAPSHOT_REFRESH_EVERY === 0) {
      this._snapshot = this.buildSnapshot();
    }
    return this._snapshot;
  }

  snapshot(): WorldSnapshot {
    return this._snapshot;
  }

  private buildSnapshot(): WorldSnapshot {
    let idx = 0;
    for (const agent of this._agents.values()) {
      let view = this._agentViewPool[idx];
      if (!view) {
        view = {
          id: agent.id,
          pos: { x: agent.pos.x, y: agent.pos.y },
          needs: { hunger: 0, energy: 0, social: 0 },
          balance: 0,
          goal: '',
          professionId: '',
          thought: '',
        };
        this._agentViewPool[idx] = view;
      }
      view.id = agent.id;
      view.pos.x = agent.pos.x;
      view.pos.y = agent.pos.y;
      view.needs.hunger = agent.needs.hunger;
      view.needs.energy = agent.needs.energy;
      view.needs.social = agent.needs.social;
      view.balance = agent.balance;
      view.goal = agent.goal;
      view.professionId = agent.professionId;
      view.thought = agent.thought;
      idx++;
    }
    this._agentViewPool.length = idx;

    return Object.freeze({
      tick: this._clock.tick,
      phase: this._clock.phase,
      agents: this._agentViewPool as ReadonlyArray<AgentView>,
      landmarks: this._landmarks,
    });
  }

  private stepAgent(agent: Agent, tick: number, _nowMs: number): void {
    decayNeeds(agent.needs);

    if (agent.pendingGoal !== null) {
      agent.goal = agent.pendingGoal;
      agent.pendingGoal = null;
    }

    const availableActions = this.computeAvailableActions(agent);

    if (agent.path.length > 0) {
      const next = agent.path.shift()!;
      this._grid.removeAgent(agent.id, agent.pos.x, agent.pos.y);
      agent.pos = next;
      this._grid.placeAgent(agent.id, agent.pos.x, agent.pos.y);
      return;
    }

    const action = selectAction({
      balance: agent.balance,
      needs: agent.needs,
      phase: this._clock.phase,
      availableActionIds: availableActions,
      memory: agent.memory,
    });

    const prevNeeds = { ...agent.needs };
    agent.currentActionId = action.id;
    agent.actionTicks++;

    const targetLandmark = this.resolveActionTarget(agent, action.id);
    if (targetLandmark) {
      const dest = targetLandmark.pos;
      if (agent.pos.x !== dest.x || agent.pos.y !== dest.y) {
        agent.path = this._grid.findPath(agent.pos, dest).slice(1);
        if (agent.path.length > 0) {
          agent.thought = `Heading to ${targetLandmark.name} to ${action.label}`;
          return;
        }
      }
    }

    this.executeAction(agent, action.id, targetLandmark, tick);

    const satisfactionDelta = this.computeSatisfactionDelta(prevNeeds, agent.needs);
    const contextFlags = this.buildContextFlags(agent, prevNeeds);
    agent.memory.record(action.id, contextFlags, satisfactionDelta);

    agent.thought = `${action.label} (score context: ${contextFlags})`;
    agent.goal = agent.pendingGoal ?? this.deriveGoalString(agent);
  }

  private computeAvailableActions(agent: Agent): Set<string> {
    const available = new Set<string>();
    available.add('idle');

    const landmarkTypes = new Set(this._landmarks.map(l => l.type));

    for (const action of ACTIONS) {
      if (!action.requiresLandmark) {
        available.add(action.id);
        continue;
      }
      if (landmarkTypes.has(action.requiresLandmark)) {
        available.add(action.id);
      }
    }

    if (agent.jobLandmarkId || PROFESSIONS[agent.professionId]) {
      available.add('work');
    }

    return available;
  }

  private resolveActionTarget(agent: Agent, actionId: string): Landmark | null {
    if (actionId === 'work') {
      if (agent.jobLandmarkId) {
        return this._landmarkMap.get(agent.jobLandmarkId) ?? null;
      }
      const profession = PROFESSIONS[agent.professionId];
      if (profession) {
        const jobLandmarks = getLandmarksByType(this._landmarks, profession.jobLandmarkType);
        if (jobLandmarks.length > 0) return jobLandmarks[0]!;
      }
      const park = getLandmarksByType(this._landmarks, 'park')[0];
      return park ?? null;
    }
    if (actionId === 'sleep' || actionId === 'rest') {
      if (actionId === 'sleep' && agent.condoId) {
        return this._landmarkMap.get(agent.condoId) ?? null;
      }
      const park = getLandmarksByType(this._landmarks, 'park')[0];
      return park ?? null;
    }
    if (actionId === 'buy_food') {
      const markets = getLandmarksByType(this._landmarks, 'market');
      return this.nearestLandmark(agent.pos, markets);
    }
    if (actionId === 'socialise') {
      const parks = getLandmarksByType(this._landmarks, 'park');
      return this.nearestLandmark(agent.pos, parks);
    }
    if (actionId === 'idle') {
      const parks = getLandmarksByType(this._landmarks, 'park');
      return this.nearestLandmark(agent.pos, parks);
    }
    return null;
  }

  private nearestLandmark(pos: Pos, candidates: Landmark[]): Landmark | null {
    if (candidates.length === 0) return null;
    let best = candidates[0]!;
    let bestDist = this.dist(pos, best.pos);
    for (let i = 1; i < candidates.length; i++) {
      const d = this.dist(pos, candidates[i]!.pos);
      if (d < bestDist) { bestDist = d; best = candidates[i]!; }
    }
    return best;
  }

  private dist(a: Pos, b: Pos): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  private executeAction(
    agent: Agent,
    actionId: string,
    target: Landmark | null,
    tick: number,
  ): void {
    const action = getAction(actionId);
    if (!action) return;

    const balanceObj = { value: agent.balance };

    if (actionId === 'work') {
      const profession = PROFESSIONS[agent.professionId];
      let wage = profession?.wagePerShift ?? CONFIG.workWageBase;

      if (!agent.jobLandmarkId && !getLandmarksByType(this._landmarks, profession?.jobLandmarkType ?? 'park').length) {
        this.pushEvent(tick, agent.id, 'no_job_site', `profession=${agent.professionId} fallback to park`);
        wage = Math.floor(wage * 0.5);
      }

      earn(agent.id, balanceObj, wage, tick, this._events,
        `profession=${agent.professionId} action=work reward=${wage}`);
      satisfyNeed(agent.needs, 'energy', action.effects.energy ?? -10);
      agent.balance = balanceObj.value;

      this.pushEvent(tick, agent.id, 'work',
        `profession=${agent.professionId}, action=work, reward=${wage}, landmark=${target?.name ?? 'park'}`);
      return;
    }

    if (actionId === 'buy_food') {
      if (!spend(agent.id, balanceObj, CONFIG.foodCost, tick, this._events, 'buy food')) {
        agent.thought = 'Cannot afford food';
        return;
      }
      agent.balance = balanceObj.value;
      satisfyNeed(agent.needs, 'hunger', CONFIG.foodSatisfaction);
      this.pushEvent(tick, agent.id, 'buy_food', `hunger+${CONFIG.foodSatisfaction}, cost=${CONFIG.foodCost}`);
      return;
    }

    if (actionId === 'sleep') {
      if (!agent.condoId) {
        this.pushEvent(tick, agent.id, 'sleep_park', 'no residence, sleeping in park');
      }
      satisfyNeed(agent.needs, 'energy', CONFIG.sleepSatisfaction);
      this.pushEvent(tick, agent.id, 'sleep', `energy+${CONFIG.sleepSatisfaction}`);
      return;
    }

    if (actionId === 'rest') {
      satisfyNeed(agent.needs, 'energy', CONFIG.restEnergySatisfaction);
      this.pushEvent(tick, agent.id, 'rest', `energy+${CONFIG.restEnergySatisfaction}`);
      return;
    }

    if (actionId === 'socialise') {
      let socialGain = action.effects.social ?? 20;
      const occupants = [...this._grid.agentsOnTile(agent.pos.x, agent.pos.y)];
      for (const otherId of occupants) {
        if (otherId === agent.id) continue;
        const multiplier = this._relationships.socialMultiplier(agent.id, otherId);
        socialGain *= multiplier;
        break;
      }
      satisfyNeed(agent.needs, 'social', socialGain);
      this.pushEvent(tick, agent.id, 'socialise', `social+${socialGain.toFixed(1)}`);
      return;
    }

    if (actionId === 'idle') {
      satisfyNeed(agent.needs, 'energy', action.effects.energy ?? 5);
      return;
    }
  }

  private updateCoPresence(tick: number): void {
    for (const agent of this._agents.values()) {
      const occupants = this._grid.agentsOnTile(agent.pos.x, agent.pos.y);
      for (const otherId of occupants) {
        if (otherId <= agent.id) continue;
        this._relationships.recordCoPresence(agent.id, otherId);
        if (this._relationships.getEdge(agent.id, otherId)?.coPresenceTicks === CONFIG.relationshipCoPresenceTicks) {
          this.pushEvent(tick, agent.id, 'relationship_formed', `with=${otherId}`);
        }
      }
    }
  }

  private buildContextFlags(agent: Agent, needs: typeof agent.needs): string {
    const h = needs.hunger < 30 ? 'H' : needs.hunger < 60 ? 'M' : 'F';
    const e = needs.energy < 30 ? 'L' : needs.energy < 60 ? 'M' : 'H';
    const s = needs.social < 30 ? 'L' : 'H';
    const m = agent.balance < 500 ? 'B' : 'R';
    const p = this._clock.phase[0];
    return `${h}${e}${s}${m}${p}`;
  }

  private computeSatisfactionDelta(before: typeof ACTIONS[0]['effects'], after: typeof ACTIONS[0]['effects']): number {
    const b = before as { hunger: number; energy: number; social: number };
    const a = after as { hunger: number; energy: number; social: number };
    return ((a.hunger - b.hunger) + (a.energy - b.energy) + (a.social - b.social)) / 3;
  }

  private deriveGoalString(agent: Agent): string {
    const urgentNeed = needsUrgency(agent.needs);
    if (agent.balance < 500) return 'earn money at work';
    if (urgentNeed === 'hunger' && agent.needs.hunger < 30) return 'buy food at market';
    if (urgentNeed === 'energy' && agent.needs.energy < 30) return 'rest and recover';
    if (urgentNeed === 'social' && agent.needs.social < 30) return 'socialise at park';
    return `maintain ${urgentNeed}`;
  }

  private drainReflection(tick: number, nowMs: number): void {
    for (const agent of this._agents.values()) {
      const lastMs = this._lastReflectionMs.get(agent.id) ?? 0;
      if (nowMs - lastMs < this._reflection.throttleMs) continue;

      this._lastReflectionMs.set(agent.id, nowMs);

      const input: ReflectionInput = {
        agentId: agent.id,
        needs: { ...agent.needs },
        balance: agent.balance,
        recentEvents: this.recentEvents(agent.id, 5),
        currentGoal: agent.goal,
      };

      this._reflection.reflect(input).then(result => {
        if (result?.goal) {
          agent.pendingGoal = result.goal;
        }
      }).catch(() => {
        // silent: agent keeps local goal
      });
    }
  }

  getAgentView(agentId: string): AgentView | undefined {
    return this._snapshot.agents.find(a => a.id === agentId);
  }

  getRelationships(agentId: string) {
    return this._relationships.getEdgesFor(agentId);
  }

  getRelationshipGraph(): RelationshipGraph {
    return this._relationships;
  }
}
