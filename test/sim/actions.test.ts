import { describe, it, expect } from 'vitest';
import { ACTIONS } from '../../src/sim/actions/catalogue.js';
import { selectAction } from '../../src/sim/actions/select.js';
import { OutcomeMemory } from '../../src/sim/memory.js';
import type { NeedsVector } from '../../src/sim/ports.js';

describe('action catalogue', () => {
  it('each action exposes precondition and needs-effect', () => {
    for (const action of ACTIONS) {
      expect(typeof action.precondition).toBe('function');
      expect(typeof action.effects).toBe('object');
      expect(typeof action.id).toBe('string');
    }
  });
});

describe('selectAction', () => {
  const allActions = new Set(ACTIONS.map(a => a.id));
  const memory = new OutcomeMemory();

  it('hungry agent near market with balance scores buy_food highest', () => {
    const needs: NeedsVector = { hunger: 10, energy: 80, social: 80 };
    const result = selectAction({
      balance: 1000,
      needs,
      phase: 'day',
      availableActionIds: allActions,
      memory,
    });
    expect(result.id).toBe('buy_food');
  });

  it('broke agent never selects a paid action', () => {
    const needs: NeedsVector = { hunger: 10, energy: 80, social: 80 };
    const result = selectAction({
      balance: 0,
      needs,
      phase: 'day',
      availableActionIds: allActions,
      memory,
    });
    expect(result.isFree).toBe(true);
    expect(result.cost).toBe(0);
  });

  it('night phase biases toward sleep', () => {
    const needs: NeedsVector = { hunger: 80, energy: 10, social: 80 };
    const result = selectAction({
      balance: 1000,
      needs,
      phase: 'night',
      availableActionIds: allActions,
      memory,
    });
    expect(['sleep', 'rest']).toContain(result.id);
  });
});
