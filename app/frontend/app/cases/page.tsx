import Link from 'next/link';
import { api, type Case, type CaseFilters } from '@/lib/api';
import { CaseCard } from '@/components/CaseCard';
import { CaseFiltersForm } from '@/components/CaseFilters';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';

export const dynamic = 'force-dynamic';

type SearchParams = {
  title?: string;
  tag?: string;
  status?: string;
  from?: string;
  to?: string;
};

function toFilters(sp: SearchParams): CaseFilters {
  return {
    title: sp.title || undefined,
    tag: sp.tag || undefined,
    status: sp.status || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
  };
}

export default async function CasesPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const filters = toFilters(searchParams || {});
  let cases: Case[] = [];
  let error: string | null = null;
  try {
    cases = (await api.listCases(filters)) || [];
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : 'failed to load cases';
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Cases</h1>
        <Link
          href="/cases/new"
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          New case
        </Link>
      </div>

      <CaseFiltersForm initial={filters} />

      {error ? <ErrorBanner variant="error">{error}</ErrorBanner> : null}

      {!error && cases.length === 0 ? (
        <EmptyState
          title="no cases yet"
          body="create your first case to start exploring data."
          cta={{ href: '/cases/new', label: 'Create case' }}
        />
      ) : null}

      {!error && cases.length > 0 ? (
        <ul
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="case-list"
        >
          {cases.map((c) => (
            <li key={c.id}>
              <CaseCard c={c} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
