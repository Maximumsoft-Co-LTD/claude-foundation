'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type Case, type CaseFile, type Graph } from '@/lib/api';
import { NetworkChart } from '@/components/NetworkChart';
import { WeightSlider } from '@/components/WeightSlider';
import { ExportButtons } from '@/components/ExportButtons';
import { FileToggleList } from '@/components/FileToggleList';
import { NodeDetailPanel } from '@/components/NodeDetailPanel';
import { MarkdownView } from '@/components/MarkdownView';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { ErrorBanner } from '@/components/ErrorBanner';

export default function CaseDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const [c, setCase] = useState<Case | null>(null);
  const [files, setFiles] = useState<CaseFile[] | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minWeight, setMinWeight] = useState(0);
  const [openNode, setOpenNode] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [cs, fs, g] = await Promise.all([
        api.getCase(id),
        api.listFiles(id),
        api.getGraph(id).catch(() => ({ Nodes: [], Edges: [] }) as Graph),
      ]);
      setCase(cs);
      setFiles(fs || []);
      setGraph(g);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (error) return <ErrorBanner variant="error">{error}</ErrorBanner>;
  if (!c) return <LoadingSkeleton rows={4} />;

  return (
    <div className="space-y-6" data-testid="case-detail">
      <section data-testid="case-header" className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{c.title}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span
              className={
                'rounded-full px-2 py-0.5 text-xs ' +
                (c.status === 'open'
                  ? 'bg-emerald-100 text-emerald-800'
                  : c.status === 'closed'
                    ? 'bg-slate-200 text-slate-700'
                    : 'bg-amber-100 text-amber-800')
              }
            >
              {c.status}
            </span>
            {c.tags.map((t) => (
              <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                #{t}
              </span>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/cases/${id}/edit`} className="text-sm rounded-md border border-slate-300 px-3 py-1.5">
            Edit
          </Link>
          <Link
            href={`/cases/${id}/upload`}
            className="text-sm rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700"
          >
            Upload xlsx
          </Link>
        </div>
      </section>

      <section data-testid="case-notes" className="prose max-w-none">
        {c.notes ? <MarkdownView source={c.notes} /> : <p className="text-slate-500">no notes</p>}
      </section>

      <section data-testid="case-files" className="space-y-2">
        <h2 className="text-lg font-semibold">Files</h2>
        {files && files.length > 0 ? (
          <FileToggleList caseID={id} files={files} onToggle={refresh} />
        ) : (
          <EmptyState
            title="no files in this case yet"
            body="upload an xlsx to see edges in the chart."
            cta={{ href: `/cases/${id}/upload`, label: 'Upload xlsx' }}
          />
        )}
      </section>

      <section data-testid="case-chart" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Network chart</h2>
          <div className="flex items-center gap-2">
            <WeightSlider value={minWeight} onChange={setMinWeight} />
            <ExportButtons caseID={id} />
          </div>
        </div>
        {graph && graph.Edges && graph.Edges.length > 0 ? (
          <NetworkChart
            graph={graph}
            minWeight={minWeight}
            onNodeClick={(nodeID) => setOpenNode(nodeID)}
          />
        ) : (
          <EmptyState
            title="no edges above current weight threshold"
            body="upload a file or lower the weight slider to see edges."
          />
        )}
      </section>

      {openNode ? (
        <NodeDetailPanel caseID={id} nodeID={openNode} onClose={() => setOpenNode(null)} />
      ) : null}
    </div>
  );
}
