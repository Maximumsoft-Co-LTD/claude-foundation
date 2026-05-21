'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CaseFilters } from '@/lib/api';

export function CaseFiltersForm({ initial }: { initial: CaseFilters }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title || '');
  const [tag, setTag] = useState(initial.tag || '');
  const [status, setStatus] = useState(initial.status || '');
  const [from, setFrom] = useState(initial.from || '');
  const [to, setTo] = useState(initial.to || '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams();
      if (title) params.set('title', title);
      if (tag) params.set('tag', tag);
      if (status) params.set('status', status);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      router.push(qs ? `/cases?${qs}` : '/cases');
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
        onChange={(e) =>
          setFrom(e.target.value ? `${e.target.value}T00:00:00Z` : '')
        }
        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
      <input
        type="date"
        value={to.slice(0, 10)}
        onChange={(e) =>
          setTo(e.target.value ? `${e.target.value}T23:59:59Z` : '')
        }
        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
      />
    </div>
  );
}
