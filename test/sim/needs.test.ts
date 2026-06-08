import { describe, it, expect } from 'vitest';
import { decayNeeds } from '../../src/sim/needs.js';
import { CONFIG } from '../../src/sim/config.js';
import type { NeedsVector } from '../../src/sim/ports.js';

describe('decayNeeds', () => {
  it('decrements hunger and energy by configured rates', () => {
    const needs: NeedsVector = { hunger: 100, energy: 100, social: 100 };
    decayNeeds(needs);
    expect(needs.hunger).toBeCloseTo(100 - CONFIG.needsDecayPerTick.hunger, 5);
    expect(needs.energy).toBeCloseTo(100 - CONFIG.needsDecayPerTick.energy, 5);
    expect(needs.social).toBeCloseTo(100 - CONFIG.needsDecayPerTick.social, 5);
  });

  it('never goes below 0', () => {
    const needs: NeedsVector = { hunger: 0, energy: 0, social: 0 };
    decayNeeds(needs);
    expect(needs.hunger).toBe(0);
    expect(needs.energy).toBe(0);
    expect(needs.social).toBe(0);
  });
});
