import { CONFIG } from './config.js';

export interface OutcomeRecord {
  actionId: string;
  contextKey: string;
  satisfactionDelta: number;
}

export class OutcomeMemory {
  private readonly _records: Map<string, OutcomeRecord[]> = new Map();
  private readonly _weights: Map<string, number> = new Map();
  private readonly _cap: number;
  private readonly _learningRate: number;

  constructor(
    cap = CONFIG.memoryCapPerContext,
    learningRate = CONFIG.memoryLearningRate,
  ) {
    this._cap = cap;
    this._learningRate = learningRate;
  }

  contextKey(actionId: string, contextFlags: string): string {
    return `${actionId}::${contextFlags}`;
  }

  record(actionId: string, contextFlags: string, satisfactionDelta: number): void {
    const key = this.contextKey(actionId, contextFlags);
    let list = this._records.get(key);
    if (!list) {
      list = [];
      this._records.set(key, list);
    }
    list.push({ actionId, contextKey: key, satisfactionDelta });
    while (list.length > this._cap) list.shift();

    const current = this._weights.get(key) ?? 1.0;
    const avg = list.reduce((s, r) => s + r.satisfactionDelta, 0) / list.length;
    this._weights.set(key, current + this._learningRate * (avg - current));
  }

  getWeight(actionId: string, contextFlags: string): number {
    const key = this.contextKey(actionId, contextFlags);
    return this._weights.get(key) ?? 1.0;
  }

  recordCount(actionId: string, contextFlags: string): number {
    const key = this.contextKey(actionId, contextFlags);
    return this._records.get(key)?.length ?? 0;
  }

  wipe(): void {
    this._records.clear();
    this._weights.clear();
  }
}
