import { describe, it, expect } from 'vitest';
import { Agent } from '../../src/sim/agent.js';
import { CONFIG } from '../../src/sim/config.js';

describe('Agent', () => {
  it('fresh agent has all needs in range', () => {
    const agent = new Agent('a0', 'office_worker', { x: 0, y: 0 });
    expect(agent.needs.hunger).toBeGreaterThanOrEqual(CONFIG.needsMin);
    expect(agent.needs.hunger).toBeLessThanOrEqual(CONFIG.needsMax);
    expect(agent.needs.energy).toBeGreaterThanOrEqual(CONFIG.needsMin);
    expect(agent.needs.energy).toBeLessThanOrEqual(CONFIG.needsMax);
    expect(agent.needs.social).toBeGreaterThanOrEqual(CONFIG.needsMin);
    expect(agent.needs.social).toBeLessThanOrEqual(CONFIG.needsMax);
  });

  it('fresh agent has balance ≥ 0', () => {
    const agent = new Agent('a1', 'market_vendor', { x: 1, y: 1 });
    expect(agent.balance).toBeGreaterThanOrEqual(0);
  });

  it('snapshot/restore round-trip preserves state', () => {
    const agent = new Agent('a2', 'temple_volunteer', { x: 2, y: 2 });
    agent.needs.hunger = 45;
    agent.balance = 1234;
    agent.goal = 'test goal';
    const snap = agent.takeSnapshot();
    agent.needs.hunger = 99;
    agent.balance = 0;
    agent.restoreSnapshot(snap);
    expect(agent.needs.hunger).toBe(45);
    expect(agent.balance).toBe(1234);
    expect(agent.goal).toBe('test goal');
  });
});
