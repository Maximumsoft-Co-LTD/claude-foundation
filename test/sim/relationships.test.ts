import { describe, it, expect } from 'vitest';
import { RelationshipGraph } from '../../src/sim/relationships.js';
import { CONFIG } from '../../src/sim/config.js';

describe('RelationshipGraph', () => {
  it('two agents co-present ≥5 ticks form an edge with strength > 0', () => {
    const graph = new RelationshipGraph();
    for (let i = 0; i < CONFIG.relationshipCoPresenceTicks; i++) {
      graph.recordCoPresence('a1', 'a2');
    }
    const edge = graph.getEdge('a1', 'a2');
    expect(edge).toBeDefined();
    expect(edge!.strength).toBeGreaterThan(0);
  });

  it('social multiplier = 1 + strength * factor after edge forms', () => {
    const graph = new RelationshipGraph();
    for (let i = 0; i < CONFIG.relationshipCoPresenceTicks; i++) {
      graph.recordCoPresence('a1', 'a2');
    }
    const multiplier = graph.socialMultiplier('a1', 'a2');
    const edge = graph.getEdge('a1', 'a2');
    const expected = 1 + edge!.strength * CONFIG.socialBonusFactor;
    expect(multiplier).toBeCloseTo(expected, 5);
  });

  it('cap blocks new edges once reached', () => {
    const graph = new RelationshipGraph();
    // Fill up a1 relationships
    for (let i = 0; i < CONFIG.relationshipMaxPerAgent; i++) {
      // Add enough co-presence to form a strong edge (won't decay easily)
      const otherId = `b${i}`;
      for (let t = 0; t < CONFIG.relationshipCoPresenceTicks + 5; t++) {
        graph.recordCoPresence('a1', otherId);
      }
    }
    const beforeCount = graph.getEdgesFor('a1').length;
    expect(beforeCount).toBeGreaterThanOrEqual(CONFIG.relationshipMaxPerAgent);

    // Try to add one more with a NEW agent that has no existing edges
    for (let t = 0; t < CONFIG.relationshipCoPresenceTicks; t++) {
      graph.recordCoPresence('a1', 'z999');
    }
    // Should not exceed cap (or evicted a weak one)
    const afterCount = graph.getEdgesFor('a1').length;
    expect(afterCount).toBeLessThanOrEqual(CONFIG.relationshipMaxPerAgent);
  });

  it('getEdgesFor returns edges for both sides', () => {
    const graph = new RelationshipGraph();
    for (let i = 0; i < CONFIG.relationshipCoPresenceTicks; i++) {
      graph.recordCoPresence('x1', 'x2');
    }
    expect(graph.getEdgesFor('x1').length).toBe(1);
    expect(graph.getEdgesFor('x2').length).toBe(1);
  });
});
