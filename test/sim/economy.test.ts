import { describe, it, expect } from 'vitest';
import { earn, spend } from '../../src/sim/economy.js';
import type { SimEvent } from '../../src/sim/ports.js';

describe('economy', () => {
  it('earn increases balance and appends SimEvent', () => {
    const balance = { value: 1000 };
    const events: SimEvent[] = [];
    earn('a1', balance, 300, 1, events, 'shift wage');
    expect(balance.value).toBe(1300);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('earn');
  });

  it('spend decreases balance and appends SimEvent', () => {
    const balance = { value: 1000 };
    const events: SimEvent[] = [];
    const ok = spend('a1', balance, 200, 2, events, 'buy food');
    expect(ok).toBe(true);
    expect(balance.value).toBe(800);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('spend');
  });

  it('spend returns false and does not modify balance when insufficient', () => {
    const balance = { value: 100 };
    const events: SimEvent[] = [];
    const ok = spend('a1', balance, 200, 3, events);
    expect(ok).toBe(false);
    expect(balance.value).toBe(100);
    expect(events).toHaveLength(0);
  });

  it('no code path drives balance below 0', () => {
    const balance = { value: 50 };
    const events: SimEvent[] = [];
    spend('a1', balance, 200, 4, events);
    expect(balance.value).toBeGreaterThanOrEqual(0);
  });

  it('earn then spend records two SimEvents', () => {
    const balance = { value: 0 };
    const events: SimEvent[] = [];
    earn('a1', balance, 500, 1, events);
    spend('a1', balance, 200, 1, events);
    expect(events).toHaveLength(2);
    expect(events[0]?.kind).toBe('earn');
    expect(events[1]?.kind).toBe('spend');
  });
});
