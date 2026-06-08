import { describe, it, expect } from 'vitest';
import { Grid } from '../../src/sim/grid.js';

describe('Grid', () => {
  it('finds a path between two tiles', () => {
    const grid = new Grid(10, 10);
    const path = grid.findPath({ x: 0, y: 0 }, { x: 5, y: 5 });
    expect(path.length).toBeGreaterThan(0);
    const last = path[path.length - 1]!;
    expect(last.x).toBe(5);
    expect(last.y).toBe(5);
  });

  it('returns empty path when destination unreachable', () => {
    const grid = new Grid(5, 5);
    // wall off destination completely
    for (let x = 0; x < 5; x++) grid.setWalkable(x, 2, false);
    const path = grid.findPath({ x: 0, y: 0 }, { x: 0, y: 4 });
    expect(path).toHaveLength(0);
  });

  it('agentsOnTile returns co-located ids without scanning all agents', () => {
    const grid = new Grid(10, 10);
    grid.placeAgent('a1', 3, 3);
    grid.placeAgent('a2', 3, 3);
    grid.placeAgent('a3', 5, 5);

    const on33 = grid.agentsOnTile(3, 3);
    expect(on33.has('a1')).toBe(true);
    expect(on33.has('a2')).toBe(true);
    expect(on33.has('a3')).toBe(false);
  });

  it('removeAgent removes from bucket', () => {
    const grid = new Grid(10, 10);
    grid.placeAgent('a1', 2, 2);
    grid.removeAgent('a1', 2, 2);
    expect(grid.agentsOnTile(2, 2).has('a1')).toBe(false);
  });
});
