'use client';

import { useEffect, useRef, useState } from 'react';
import type { CaseFilters } from '@/lib/api';

export function CaseFiltersForm({
  value,
  onChange,
}: {
  value: CaseFilters;
  onChange: (next: CaseFilters) => void;
}) {
  const [title, setTitle] = useState(value.title || '');
  const [tag, setTag] = useState(value.tag || '');
  const [status, setStatus] = useState(value.status || '');
  const [from, setFrom] = useState(value.from || '');
  const [to, setTo] = useState(value.to || '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChange({
        title: title || undefined,
        tag: tag || undefined,
        status: status || undefined,
        from: from || undefined,
        to: to || undefined,
      });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, tag, status, from, to]);

  return (
    <div
      className="grid gap-2 sm:grid-cols-5 rounded-lg border border-slate-200 bg-white p-3"
      data-testid="case-filters"
    >
      <input
        type="text"
        placeholder="Search title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
      <input
        type="text"
        placeholder="tag (comma list)"
        value={tag}
        onChange={(e) => setTag(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
      >
        <option value="">any active</option>
        <option value="open">open</option>
        <option value="closed">closed</option>
        <option value="archived">archived</option>
      </select>
      <input
        type="date"
        value={from.slice(0, 10)}
        onChange={(e) => setFrom(e.target.value ? `${e.target.value}T00:00:00Z` : '')}
        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
      <input
        type="date"
        value={to.slice(0, 10)}
        onChange={(e) => setTo(e.target.value ? `${e.target.value}T23:59:59Z` : '')}
        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
    </div>
  );
}
