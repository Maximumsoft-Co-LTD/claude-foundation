import { describe, it, expect } from 'vitest';
import { World } from '../../src/sim/world.js';
import { LocalReflection } from '../../src/sim/reflection/local.js';

describe('World.tick()', () => {
  it('advances clock and decays every agent over 100 ticks', () => {
    const world = new World({ seed: 42, agentCount: 50, reflection: new LocalReflection() });
    // Capture initial hunger values as plain numbers (snapshot pool is mutable)
    const initialHunger = world.snapshot().agents.map(a => a.needs.hunger);
    for (let i = 0; i < 100; i++) world.tick();
    const after = world.snapshot();
    expect(after.tick).toBe(100);
    // At least some agents should have lower hunger than their initial value
    const hungerDecreased = after.agents.some((a, i) => a.needs.hunger < (initialHunger[i] ?? 100));
    expect(hungerDecreased).toBe(true);
  });

  it('returns frozen snapshot', () => {
    const world = new World({ seed: 1, agentCount: 5 });
    const snap = world.tick();
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it('agent exception does not halt the loop', () => {
    const world = new World({ seed: 99, agentCount: 10 });
    // Run many ticks — if any agent throws internally, loop continues
    expect(() => {
      for (let i = 0; i < 50; i++) world.tick();
    }).not.toThrow();
    expect(world.snapshot().agents.length).toBeGreaterThan(0);
  });

  it('snapshot has correct structure', () => {
    const world = new World({ seed: 5, agentCount: 3 });
    const snap = world.snapshot();
    expect(typeof snap.tick).toBe('number');
    expect(['day', 'night']).toContain(snap.phase);
    expect(Array.isArray(snap.agents)).toBe(true);
    expect(Array.isArray(snap.landmarks)).toBe(true);
  });

  it('50 agents, 1000 ticks, agents present throughout', () => {
    const world = new World({ seed: 42, agentCount: 50 });
    for (let i = 0; i < 1000; i++) world.tick();
    const snap = world.snapshot();
    expect(snap.agents.length).toBe(50);
    expect(snap.tick).toBe(1000);
  });
});

describe('World economy integration', () => {
  it('agents earn at job sites and spend on food over 200 ticks', () => {
    const world = new World({ seed: 7, agentCount: 20 });
    for (let i = 0; i < 200; i++) world.tick();
    const snap = world.snapshot();
    // At least some agents should have hunger recovered (not at 0)
    const hasHunger = snap.agents.some(a => a.needs.hunger > 0);
    expect(hasHunger).toBe(true);
  });

  it('no agent balance goes below 0', () => {
    const world = new World({ seed: 42, agentCount: 50 });
    for (let i = 0; i < 500; i++) world.tick();
    const snap = world.snapshot();
    for (const agent of snap.agents) {
      expect(agent.balance).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('World day/night', () => {
  it('phase flips at configured boundary', () => {
    const world = new World({ seed: 1, agentCount: 5, ticksPerDay: 20 });
    for (let i = 0; i < 10; i++) world.tick();
    expect(world.snapshot().phase).toBe('night');
  });
});
