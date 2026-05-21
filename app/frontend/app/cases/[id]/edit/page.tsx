'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, type Case } from '@/lib/api';
import { ErrorBanner } from '@/components/ErrorBanner';

export default function EditCasePage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();
  const [c, setC] = useState<Case | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getCase(id).then(setC).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <ErrorBanner variant="error">{error}</ErrorBanner>;
  if (!c) return <p>loading...</p>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!c) return;
    try {
      await api.patchCase(c.id, {
        title: c.title,
        notes: c.notes,
        tags: c.tags,
        status: c.status,
      } as Partial<Case>);
      router.push(`/cases/${c.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'update failed');
    }
  }

  async function archive() {
    if (!c) return;
    try {
      await api.archiveCase(c.id);
      router.push('/cases');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'archive failed');
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Edit case</h1>
      <form onSubmit={submit} className="space-y-3" data-testid="edit-case-form">
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Title</span>
          <input
            value={c.title}
            onChange={(e) => setC({ ...c, title: e.target.value })}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Notes (markdown)</span>
          <textarea
            value={c.notes}
            onChange={(e) => setC({ ...c, notes: e.target.value })}
            rows={6}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Tags (comma-separated)</span>
          <input
            value={c.tags.join(', ')}
            onChange={(e) =>
              setC({
                ...c,
                tags: e.target.value
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Status</span>
          <select
            value={c.status}
            onChange={(e) => setC({ ...c, status: e.target.value as Case['status'] })}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="open">open</option>
            <option value="closed">closed</option>
            <option value="archived">archived</option>
          </select>
        </label>
        <div className="flex justify-between">
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
          >
            Save
          </button>
          <button
            type="button"
            onClick={archive}
            className="rounded-md border border-amber-500 px-3 py-2 text-sm text-amber-700 hover:bg-amber-50"
          >
            Archive
          </button>
        </div>
      </form>
    </div>
  );
}
