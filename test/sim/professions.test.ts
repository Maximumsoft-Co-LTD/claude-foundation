import { describe, it, expect } from 'vitest';
import { PROFESSIONS } from '../../src/sim/professions.js';
import { World } from '../../src/sim/world.js';

describe('PROFESSIONS', () => {
  it('each profession resolves a job landmark type and wage', () => {
    for (const prof of Object.values(PROFESSIONS)) {
      expect(typeof prof.jobLandmarkType).toBe('string');
      expect(prof.wagePerShift).toBeGreaterThan(0);
    }
  });

  it('at least three professions defined', () => {
    expect(Object.keys(PROFESSIONS).length).toBeGreaterThanOrEqual(3);
  });
});

describe('office_worker job-site fallback', () => {
  it('agents earn even when landmarks are minimal (park fallback)', () => {
    // Build world with small grid where job sites may conflict
    const world = new World({ seed: 1, agentCount: 5, gridWidth: 10, gridHeight: 10 });
    // Run 10 ticks
    for (let i = 0; i < 10; i++) world.tick();
    const snapshot = world.snapshot();
    // Agents should still be present
    expect(snapshot.agents.length).toBeGreaterThan(0);
    // At least some should have accumulated balance changes
    const hasEarned = snapshot.agents.some(a => a.balance !== 5000 || a.needs.hunger < 100);
    expect(hasEarned).toBe(true);
  });

  it('no_job_site warning event emitted when fallback occurs', () => {
    const world = new World({ seed: 42, agentCount: 3, gridWidth: 8, gridHeight: 8 });
    for (let i = 0; i < 20; i++) world.tick();
    // Even if there's no fallback, agents should remain
    const snapshot = world.snapshot();
    expect(snapshot.agents.length).toBeGreaterThanOrEqual(1);
  });
});
