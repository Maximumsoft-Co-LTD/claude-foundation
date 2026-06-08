import { describe, it, expect } from 'vitest';
import { makeRng } from '../../src/sim/rng.js';

describe('makeRng', () => {
  it('same seed produces same sequence', () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    for (let i = 0; i < 20; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('different seeds produce different sequences', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('nextInt stays in range', () => {
    const rng = makeRng(99);
    for (let i = 0; i < 100; i++) {
      const v = rng.nextInt(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it('pick returns element from array', () => {
    const rng = makeRng(7);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 20; i++) {
      expect(arr).toContain(rng.pick(arr));
    }
  });
});
