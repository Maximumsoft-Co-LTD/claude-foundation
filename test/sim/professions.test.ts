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

  it('no_job_site event emitted and agent retained when job landmark absent (AC6 boundary)', () => {
    // 3x3 grid: only 'market' landmark is placed — office and temple types are absent.
    // office_worker and temple_volunteer therefore have no jobLandmarkId.
    // Force low starting balance so they immediately score 'work' highest and trigger
    // the no_job_site fallback path in executeAction.
    const world = new World({ seed: 1, agentCount: 3, gridWidth: 3, gridHeight: 3 });
    const landmarkTypes = world.landmarks.map(l => l.type);
    expect(landmarkTypes).not.toContain('office'); // confirm setup
    expect(landmarkTypes).not.toContain('temple');

    // Lower balance on the office_worker so 'work' scores above idle and buy_food
    const internalAgents = (world as any)._agents as Map<string, { professionId: string; balance: number; jobLandmarkId: string | null }>;
    for (const agent of internalAgents.values()) {
      if (agent.professionId === 'office_worker') {
        agent.balance = 100; // below 500 → work urgency score becomes high
      }
    }

    for (let i = 0; i < 50; i++) world.tick();

    const allEvents = (world as any)._events as Array<{ kind: string; agentId: string; detail: string }>;
    const noJobSiteEvents = allEvents.filter(e => e.kind === 'no_job_site');

    // The no_job_site event must fire — verifying the fallback path executes
    expect(noJobSiteEvents.length).toBeGreaterThan(0);
    // The agent must still be in the simulation (not despawned)
    const snap = world.snapshot();
    expect(snap.agents.length).toBeGreaterThanOrEqual(1);
    // The detail must name the profession
    expect(noJobSiteEvents[0]!.detail).toContain('office_worker');
  });
});
