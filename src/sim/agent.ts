import { CONFIG } from './config.js';
import { OutcomeMemory } from './memory.js';
import type { NeedsVector } from './ports.js';
import type { Pos } from './grid.js';

export interface AgentSnapshot {
  pos: Pos;
  needs: NeedsVector;
  balance: number;
  goal: string;
  thought: string;
  currentActionId: string;
  actionTicks: number;
  lastReflectionMs: number;
}

export class Agent {
  readonly id: string;
  readonly professionId: string;
  pos: Pos;
  needs: NeedsVector;
  balance: number;
  goal: string;
  thought: string;
  currentActionId: string;
  actionTicks: number;
  lastReflectionMs: number;
  readonly memory: OutcomeMemory;
  pendingGoal: string | null = null;
  condoId: string | null = null;
  jobLandmarkId: string | null = null;
  path: Pos[] = [];

  constructor(id: string, professionId: string, pos: Pos) {
    this.id = id;
    this.professionId = professionId;
    this.pos = { ...pos };
    this.needs = {
      hunger: CONFIG.needsMax,
      energy: CONFIG.needsMax,
      social: CONFIG.needsMax * 0.5,
    };
    this.balance = CONFIG.startingBalance;
    this.goal = 'idle';
    this.thought = '';
    this.currentActionId = 'idle';
    this.actionTicks = 0;
    this.lastReflectionMs = 0;
    this.memory = new OutcomeMemory();
  }

  takeSnapshot(): AgentSnapshot {
    return {
      pos: { ...this.pos },
      needs: { ...this.needs },
      balance: this.balance,
      goal: this.goal,
      thought: this.thought,
      currentActionId: this.currentActionId,
      actionTicks: this.actionTicks,
      lastReflectionMs: this.lastReflectionMs,
    };
  }

  restoreSnapshot(snap: AgentSnapshot): void {
    this.pos = { ...snap.pos };
    this.needs = { ...snap.needs };
    this.balance = snap.balance;
    this.goal = snap.goal;
    this.thought = snap.thought;
    this.currentActionId = snap.currentActionId;
    this.actionTicks = snap.actionTicks;
    this.lastReflectionMs = snap.lastReflectionMs;
  }
}
