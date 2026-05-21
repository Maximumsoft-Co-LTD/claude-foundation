'use client';

import dynamic from 'next/dynamic';
import { useMemo, useRef } from 'react';
import type { Graph } from '@/lib/api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph2D: any = dynamic(() => import('react-force-graph-2d'), { ssr: false });

type Props = {
  graph: Graph;
  minWeight: number;
  onNodeClick?: (nodeID: string) => void;
};

export function NetworkChart({ graph, minWeight, onNodeClick }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);

  const data = useMemo(() => {
    const edges = (graph.Edges || []).filter((e) => (e.Weight ?? 1) >= minWeight);
    const used = new Set<string>();
    edges.forEach((e) => {
      used.add(String(e.Source));
      used.add(String(e.Target));
    });
    const nodes = (graph.Nodes || [])
      .filter((n) => used.has(String(n.ID)))
      .map((n) => ({ id: String(n.ID) }));
    const links = edges.map((e) => ({
      source: String(e.Source),
      target: String(e.Target),
      weight: e.Weight,
    }));
    return { nodes, links };
  }, [graph, minWeight]);

  return (
    <div
      className="rounded-lg border border-slate-200 bg-white"
      data-testid="network-chart"
      data-node-count={data.nodes.length}
      data-edge-count={data.links.length}
      style={{ height: 500 }}
    >
      <ForceGraph2D
        ref={fgRef}
        graphData={data}
        nodeLabel="id"
        linkDirectionalArrowLength={4}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        linkWidth={(l: any) => Math.max(1, Math.log1p(l.weight ?? 1))}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onNodeClick={(n: any) => onNodeClick?.(String(n.id))}
        height={500}
      />
    </div>
  );
}
