'use client';

import { useState } from 'react';
import { ErrorBanner } from '@/components/ErrorBanner';

export function ColumnMappingForm({
  headers,
  onSubmit,
}: {
  headers: string[];
  onSubmit: (m: { source_col: string; target_col: string; weight_col: string }) => Promise<void>;
}) {
  const [src, setSrc] = useState(headers[0] || '');
  const [tgt, setTgt] = useState(headers[1] || '');
  const [w, setW] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit({ source_col: src, target_col: tgt, weight_col: w });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'mapping failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="column-mapping-form">
      {error ? <ErrorBanner variant="error">{error}</ErrorBanner> : null}
      <label className="block">
        <span className="block text-sm font-medium text-slate-700">Source column *</span>
        <select
          required
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {headers.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="block text-sm font-medium text-slate-700">Target column *</span>
        <select
          required
          value={tgt}
          onChange={(e) => setTgt(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {headers.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="block text-sm font-medium text-slate-700">Weight column (optional)</span>
        <select
          value={w}
          onChange={(e) => setW(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">(none — weight defaults to 1.0)</option>
          {headers.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-slate-300"
      >
        {busy ? 'Parsing...' : 'Parse and save'}
      </button>
    </form>
  );
}
