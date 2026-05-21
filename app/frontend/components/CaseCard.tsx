import Link from 'next/link';
import type { Case } from '@/lib/api';

export function CaseCard({ c }: { c: Case }) {
  const created = new Date(c.created_at);
  return (
    <Link
      href={`/cases/${c.id}`}
      className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-400"
      data-testid="case-card"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{c.title}</h3>
        <span
          className={
            'shrink-0 rounded-full px-2 py-0.5 text-xs ' +
            (c.status === 'open'
              ? 'bg-emerald-100 text-emerald-800'
              : c.status === 'closed'
                ? 'bg-slate-200 text-slate-700'
                : 'bg-amber-100 text-amber-800')
          }
        >
          {c.status}
        </span>
      </div>
      {c.tags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {c.tags.map((t) => (
            <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              #{t}
            </span>
          ))}
        </div>
      ) : null}
      <p className="mt-2 text-xs text-slate-500">{created.toLocaleString()}</p>
    </Link>
  );
}
