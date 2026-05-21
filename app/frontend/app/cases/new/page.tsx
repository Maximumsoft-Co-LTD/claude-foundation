'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ErrorBanner } from '@/components/ErrorBanner';

export default function NewCasePage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      const c = await api.createCase({ title, notes, tags });
      router.push(`/cases/${c.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'create failed');
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">New case</h1>
      {error ? <ErrorBanner variant="error">{error}</ErrorBanner> : null}
      <form onSubmit={submit} className="space-y-3" data-testid="new-case-form">
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Title *</span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Notes (markdown)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={6}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Tags (comma-separated)</span>
          <input
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="fraud, cyber"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-slate-300"
        >
          {submitting ? 'Creating...' : 'Create case'}
        </button>
      </form>
    </div>
  );
}
