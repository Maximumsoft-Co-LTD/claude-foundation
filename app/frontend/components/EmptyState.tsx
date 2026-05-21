import Link from 'next/link';

export function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body?: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div
      className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center"
      data-testid="empty-state"
    >
      <h3 className="text-lg font-medium text-slate-700">{title}</h3>
      {body ? <p className="mt-1 text-sm text-slate-500">{body}</p> : null}
      {cta ? (
        <Link
          href={cta.href}
          className="mt-3 inline-block rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
