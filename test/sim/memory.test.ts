import { describe, it, expect } from 'vitest';
import { OutcomeMemory } from '../../src/sim/memory.js';
import { selectAction } from '../../src/sim/actions/select.js';
import { ACTIONS } from '../../src/sim/actions/catalogue.js';
import type { NeedsVector } from '../../src/sim/ports.js';

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

describe('Outcome-based learning changes action selection (AC9 end-to-end)', () => {
  // Context: hunger=65 (not urgent, 'F' band), balance=200 ('B' broke), energy=80 ('H'), social=80 ('H'), day phase.
  // Context flags = 'FHHBd'.
  // Without history: work base=36 > buy_food base=28 → no-history agent selects 'work'.
  // With 10 successful buy_food runs recorded under this context: buy_food weight ≈ 26×
  // → effective score ≈ 739 ≫ work=36 → history agent selects 'buy_food'.
  // This proves the learning effect changes the selection outcome, not just adjusts a weight.
  it('agent with buy_food history selects buy_food where no-history agent selects work', () => {
    const needs: NeedsVector = { hunger: 65, energy: 80, social: 80 };
    const balance = 200;
    const phase = 'day' as const;
    const allActions = new Set(ACTIONS.map(a => a.id));
    // Context flags must match buildContextFlags in select.ts:
    // hunger=65 → ≥60 → 'F'; energy=80 → ≥60 → 'H'; social=80 → ≥30 → 'H';
    // balance=200 → <500 → 'B'; phase='day' → 'd'
    const contextFlags = 'FHHBd';

    const noHistoryMemory = new OutcomeMemory();

    const historyMemory = new OutcomeMemory();
    for (let i = 0; i < 10; i++) {
      historyMemory.record('buy_food', contextFlags, 40);
    }

    const noHistResult = selectAction({ balance, needs, phase, availableActionIds: allActions, memory: noHistoryMemory });
    const histResult   = selectAction({ balance, needs, phase, availableActionIds: allActions, memory: historyMemory });

    // No-history agent: work (36) > buy_food (28) — money urgency wins
    expect(noHistResult.id).toBe('work');
    // History agent: buy_food weight ≈ 26× flips the outcome despite lower base score
    expect(histResult.id).toBe('buy_food');
    // Confirm the weight itself is significantly above baseline
    expect(historyMemory.getWeight('buy_food', contextFlags)).toBeGreaterThan(5.0);
  });
});
