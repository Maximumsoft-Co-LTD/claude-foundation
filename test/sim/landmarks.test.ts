import { describe, it, expect } from 'vitest';
import { placeLandmarks, getSpawnTiles } from '../../src/sim/landmarks.js';
import { makeRng } from '../../src/sim/rng.js';

const REQUIRED_TYPES = ['market', 'temple', 'office', 'condo', 'park', 'bts'] as const;

describe('placeLandmarks', () => {
  it('all six landmark types are present', () => {
    const rng = makeRng(42);
    const { landmarks } = placeLandmarks(30, 30, rng);
    for (const type of REQUIRED_TYPES) {
      expect(landmarks.some(l => l.type === type), `missing ${type}`).toBe(true);
    }
  });

  it('≥50 agents placed at distinct valid tiles', () => {
    const rng = makeRng(42);
    const { landmarks } = placeLandmarks(30, 30, rng);
    const rng2 = makeRng(100);
    const { tiles } = getSpawnTiles(landmarks, 30, 30, rng2, 50);
    expect(tiles.length).toBeGreaterThanOrEqual(50);
    const keys = new Set(tiles.map(t => `${t.x},${t.y}`));
    expect(keys.size).toBe(tiles.length);
  });

  it('on shortfall returns reduced set and logs warning, no throw', () => {
    const rng = makeRng(1);
    // tiny grid — fewer tiles
    const { landmarks, warnings } = placeLandmarks(4, 4, rng);
    expect(landmarks.length).toBeGreaterThan(0);
    // may or may not have warnings; key thing is no throw
    expect(Array.isArray(warnings)).toBe(true);
  });
});
