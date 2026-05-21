import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// react-force-graph-2d depends on canvas + window APIs that jsdom only partially
// implements. The chart wrapper itself dynamic-imports it with ssr:false; for
// the unit test we stub the dynamic import to render a small probe that exposes
// the graphData it was handed via data attributes. This keeps the test focused
// on NetworkChart's own filter/projection logic (the AC9 surface) rather than
// the third-party renderer.
vi.mock('next/dynamic', () => ({
  default: () => {
    return function MockForceGraph2D(props: {
      graphData: { nodes: { id: string }[]; links: { source: string; target: string; weight: number }[] };
    }) {
      return (
        <div
          data-testid="mock-force-graph"
          data-fg-node-count={props.graphData.nodes.length}
          data-fg-edge-count={props.graphData.links.length}
        />
      );
    };
  },
}));

import { NetworkChart } from './NetworkChart';
import type { Graph } from '@/lib/api';

const graph: Graph = {
  nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
  edges: [
    { source: 'a', target: 'b', weight: 1, file_id: 'f', row_index: 1 },
    { source: 'b', target: 'c', weight: 5, file_id: 'f', row_index: 2 },
    { source: 'c', target: 'd', weight: 10, file_id: 'f', row_index: 3 },
  ],
};

describe('NetworkChart', () => {
  it('renders all edges when minWeight is 0', () => {
    render(<NetworkChart graph={graph} minWeight={0} />);
    const wrapper = screen.getByTestId('network-chart');
    expect(wrapper.getAttribute('data-edge-count')).toBe('3');
    // All 4 nodes participate in some edge.
    expect(wrapper.getAttribute('data-node-count')).toBe('4');
  });

  it('drops edges below the minWeight threshold and prunes orphan nodes', () => {
    render(<NetworkChart graph={graph} minWeight={5} />);
    const wrapper = screen.getByTestId('network-chart');
    // weight=1 edge is filtered out → 2 remaining edges
    expect(wrapper.getAttribute('data-edge-count')).toBe('2');
    // node `a` is now orphaned (its only edge was weight=1) and must be pruned;
    // b, c, d remain.
    expect(wrapper.getAttribute('data-node-count')).toBe('3');
  });

  it('hides every edge when the threshold exceeds the max weight', () => {
    render(<NetworkChart graph={graph} minWeight={11} />);
    const wrapper = screen.getByTestId('network-chart');
    expect(wrapper.getAttribute('data-edge-count')).toBe('0');
    expect(wrapper.getAttribute('data-node-count')).toBe('0');
  });
});
