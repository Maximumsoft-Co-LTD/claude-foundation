'use client';

import { api } from '@/lib/api';

export function ExportButtons({ caseID }: { caseID: string }) {
  function exportPng() {
    const el = document.querySelector('[data-testid="network-chart"] canvas') as HTMLCanvasElement | null;
    if (!el) return;
    el.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `case-${caseID}-graph.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  return (
    <div className="flex gap-2" data-testid="export-buttons">
      <button
        onClick={exportPng}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
      >
        Export PNG
      </button>
      <a
        href={api.exportGraphURL(caseID)}
        download
        className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
      >
        Export JSON
      </a>
    </div>
  );
}
