import { CONFIG } from './config.js';

export type DayPhase = 'day' | 'night';

export class Clock {
  private _tick = 0;
  private readonly _ticksPerDay: number;

  constructor(ticksPerDay = CONFIG.ticksPerDay) {
    this._ticksPerDay = ticksPerDay;
  }

  get tick(): number { return this._tick; }
  get ticksPerDay(): number { return this._ticksPerDay; }

  get phase(): DayPhase {
    const posInDay = this._tick % this._ticksPerDay;
    return posInDay < this._ticksPerDay / 2 ? 'day' : 'night';
  }

  get hour(): number {
    const posInDay = this._tick % this._ticksPerDay;
    return Math.floor((posInDay / this._ticksPerDay) * 24);
  }

  advance(): void {
    this._tick++;
  }
}
