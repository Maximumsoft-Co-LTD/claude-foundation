import { describe, it, expect } from 'vitest';
import { Clock } from '../../src/sim/clock.js';

describe('Clock', () => {
  it('starts at tick 0, phase day', () => {
    const clock = new Clock(100);
    expect(clock.tick).toBe(0);
    expect(clock.phase).toBe('day');
  });

  it('flips to night at ticksPerDay/2', () => {
    const clock = new Clock(100);
    for (let i = 0; i < 50; i++) clock.advance();
    expect(clock.phase).toBe('night');
  });

  it('flips back to day at ticksPerDay', () => {
    const clock = new Clock(100);
    for (let i = 0; i < 100; i++) clock.advance();
    expect(clock.phase).toBe('day');
  });

  it('tick counter increments each advance', () => {
    const clock = new Clock(240);
    clock.advance();
    clock.advance();
    expect(clock.tick).toBe(2);
  });
});
