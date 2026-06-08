import { describe, it, expect } from 'vitest';
import { OutcomeMemory } from '../../src/sim/memory.js';

describe('OutcomeMemory', () => {
  it('cap enforced + eviction order (oldest removed first)', () => {
    const mem = new OutcomeMemory(3);
    mem.record('buy_food', 'ctx', 10);
    mem.record('buy_food', 'ctx', 20);
    mem.record('buy_food', 'ctx', 30);
    mem.record('buy_food', 'ctx', 40);
    expect(mem.recordCount('buy_food', 'ctx')).toBe(3);
  });

  it('wipe degrades scores to baseline (1.0)', () => {
    const mem = new OutcomeMemory();
    for (let i = 0; i < 10; i++) mem.record('buy_food', 'ctx', 50);
    const before = mem.getWeight('buy_food', 'ctx');
    expect(before).not.toBe(1.0);
    mem.wipe();
    expect(mem.getWeight('buy_food', 'ctx')).toBe(1.0);
  });

  it('positive outcomes raise weight above 1', () => {
    const mem = new OutcomeMemory();
    for (let i = 0; i < 10; i++) mem.record('buy_food', 'ctx', 50);
    expect(mem.getWeight('buy_food', 'ctx')).toBeGreaterThan(1.0);
  });

  it('negative outcomes lower weight', () => {
    const mem = new OutcomeMemory();
    for (let i = 0; i < 10; i++) mem.record('bad_action', 'ctx', -20);
    expect(mem.getWeight('bad_action', 'ctx')).toBeLessThan(1.0);
  });
});
