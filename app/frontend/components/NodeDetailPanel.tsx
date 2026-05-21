'use client';

import { useEffect, useState } from 'react';
import { api, type NodeDetail } from '@/lib/api';

type LoadState = 'loading' | 'error' | 'empty' | 'populated';

export function NodeDetailPanel({
  caseID,
  nodeID,
  onClose,
}: {
  caseID: string;
  nodeID: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    setState('loading');
    api
      .getNodeDetail(caseID, nodeID)
      .then((d) => {
        setDetail(d);
        setState(d.edges.length === 0 ? 'empty' : 'populated');
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'load failed');
        setState('error');
      });
  }, [caseID, nodeID]);

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end bg-black/30"
      onClick={onClose}
      data-testid="node-detail-panel"
      data-state={state}
    >
      <aside
        className="h-full w-full max-w-md overflow-y-auto bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold" data-testid="node-detail-id">
            {nodeID}
          </h3>
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            close
          </button>
        </div>
        {state === 'loading' ? (
          <p className="text-sm text-slate-500" data-testid="node-detail-loading">
            loading...
          </p>
        ) : null}
        {state === 'error' ? (
          <p className="text-sm text-red-700" data-testid="node-detail-error">
            {error}
          </p>
        ) : null}
        {state === 'empty' ? (
          <p className="text-sm text-slate-500" data-testid="node-detail-empty">
            no edges for this node
          </p>
        ) : null}
        {state === 'populated' && detail ? (
          <ul
            className="space-y-2 text-sm"
            data-testid="node-detail-edges"
          >
            {detail.edges.map((e, i) => (
              <li
                key={i}
                className="rounded-md border border-slate-200 p-2"
              >
                <div>
                  <span className="font-mono">{e.source}</span> →{' '}
                  <span className="font-mono">{e.target}</span>
                </div>
                <div className="text-xs text-slate-500">
                  weight {e.weight} · {e.filename} row {e.row_index}
                </div>
              </li>
            ))}
            {detail.conflicts && detail.conflicts.length > 0 ? (
              <li
                className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs"
                data-testid="node-detail-conflicts"
              >
                <div className="font-semibold mb-1">
                  attribute conflicts ({detail.conflicts.length})
                </div>
                {detail.conflicts.map((c, i) => (
                  <div key={i}>
                    <span className="font-mono">{c.key}</span>: &quot;{c.old_value}&quot; (file{' '}
                    {c.old_file_id.slice(0, 8)}) → &quot;{c.new_value}&quot; (file{' '}
                    {c.new_file_id.slice(0, 8)})
                  </div>
                ))}
              </li>
            ) : null}
          </ul>
        ) : null}
      </aside>
    </div>
  );
}
