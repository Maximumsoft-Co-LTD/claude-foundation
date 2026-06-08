import { ACTIONS, type ActionDef } from './catalogue.js';
import type { NeedsVector } from '../ports.js';
import type { OutcomeMemory } from '../memory.js';
import type { DayPhase } from '../clock.js';

export interface SelectionContext {
  balance: number;
  needs: NeedsVector;
  phase: DayPhase;
  availableActionIds: Set<string>;
  memory: OutcomeMemory;
}

function buildContextFlags(needs: NeedsVector, balance: number, phase: DayPhase): string {
  const hunger = needs.hunger < 30 ? 'H' : needs.hunger < 60 ? 'M' : 'F';
  const energy = needs.energy < 30 ? 'L' : needs.energy < 60 ? 'M' : 'H';
  const social = needs.social < 30 ? 'L' : 'H';
  const money = balance < 500 ? 'B' : 'R';
  return `${hunger}${energy}${social}${money}${phase[0]}`;
}

export function applyPhaseBias(
  score: number,
  actionId: string,
  phase: DayPhase,
  needs: NeedsVector,
): number {
  if (phase === 'night') {
    if (actionId === 'sleep' || actionId === 'rest') return score * 2.5;
    if (actionId === 'work') return score * 0.2;
    if (actionId === 'socialise') return score * 0.5;
  } else {
    if (actionId === 'work') return score * 1.5;
    if (actionId === 'sleep' && needs.energy > 40) return score * 0.1;
  }
  return score;
}

export function selectAction(ctx: SelectionContext): ActionDef {
  const contextFlags = buildContextFlags(ctx.needs, ctx.balance, ctx.phase);
  let best: ActionDef | null = null;
  let bestScore = -Infinity;

  for (const action of ACTIONS) {
    if (!ctx.availableActionIds.has(action.id)) continue;
    if (!action.precondition(ctx.balance, ctx.needs)) continue;

    let score = action.baseScore(ctx.needs, ctx.balance);
    score = applyPhaseBias(score, action.id, ctx.phase, ctx.needs);
    const memWeight = ctx.memory.getWeight(action.id, contextFlags);
    score *= memWeight;

    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }

  if (!best) {
    const idle = ACTIONS.find(a => a.id === 'idle');
    if (idle) return idle;
    return ACTIONS[ACTIONS.length - 1]!;
  }
  return best;
}
