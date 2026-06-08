import type { SimEvent } from './ports.js';

export function earn(
  agentId: string,
  balance: { value: number },
  amount: number,
  tick: number,
  events: SimEvent[],
  detail = '',
): void {
  balance.value += amount;
  events.push({ tick, agentId, kind: 'earn', detail: detail || `+${amount} cents` });
}

export function spend(
  agentId: string,
  balance: { value: number },
  amount: number,
  tick: number,
  events: SimEvent[],
  detail = '',
): boolean {
  if (balance.value < amount) return false;
  balance.value -= amount;
  events.push({ tick, agentId, kind: 'spend', detail: detail || `-${amount} cents` });
  return true;
}
