'use client';

import { useEffect, useState } from 'react';
import { api, type NodeDetail } from '@/lib/api';

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

  useEffect(() => {
    api
      .getNodeDetail(caseID, nodeID)
      .then(setDetail)
      .catch((e) => setError(e.message));
  }, [caseID, nodeID]);

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end bg-black/30"
      onClick={onClose}
      data-testid="node-detail-panel"
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
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {detail ? (
          <ul className="space-y-2 text-sm">
            {detail.edges.map((e, i) => (
              <li key={i} className="rounded-md border border-slate-200 p-2">
                <div>
                  <span className="font-mono">{e.source}</span> →{' '}
                  <span className="font-mono">{e.target}</span>
                </div>
                <div className="text-xs text-slate-500">
                  weight {e.weight} · {e.filename} row {e.row_index}
                </div>
              </li>
            ))}
            {detail.edges.length === 0 ? (
              <li className="text-slate-500">no edges</li>
            ) : null}
          </ul>
        ) : !error ? (
          <p className="text-sm text-slate-500">loading...</p>
        ) : null}
      </aside>
    </div>
  );
}
