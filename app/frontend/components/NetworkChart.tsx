'use client';

import dynamic from 'next/dynamic';
import type { ComponentType, ForwardedRef } from 'react';
import { useMemo, useRef } from 'react';
import type { Graph } from '@/lib/api';

type ForceLink = { source: string; target: string; weight: number };
type ForceNode = { id: string };
type ForceGraphData = { nodes: ForceNode[]; links: ForceLink[] };
type ForceGraphProps = {
  ref?: ForwardedRef<unknown>;
  graphData: ForceGraphData;
  nodeLabel?: string;
  linkDirectionalArrowLength?: number;
  linkWidth?: (l: ForceLink) => number;
  onNodeClick?: (n: ForceNode) => void;
  height?: number;
};

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
}) as unknown as ComponentType<ForceGraphProps>;

type Props = {
  graph: Graph;
  minWeight: number;
  onNodeClick?: (nodeID: string) => void;
};

export function NetworkChart({ graph, minWeight, onNodeClick }: Props) {
  const fgRef = useRef<unknown>(null);

  const data = useMemo<ForceGraphData>(() => {
    const edges = (graph.edges || []).filter((e) => (e.weight ?? 1) >= minWeight);
    const used = new Set<string>();
    edges.forEach((e) => {
      used.add(String(e.source));
      used.add(String(e.target));
    });
    const nodes = (graph.nodes || [])
      .filter((n) => used.has(String(n.id)))
      .map((n) => ({ id: String(n.id) }));
    const links = edges.map((e) => ({
      source: String(e.source),
      target: String(e.target),
      weight: e.weight,
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
        linkWidth={(l) => Math.max(1, Math.log1p(l.weight ?? 1))}
        onNodeClick={(n) => onNodeClick?.(String(n.id))}
        height={500}
      />
    </div>
  );
}
