'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type Case, type CaseFilters } from '@/lib/api';
import { CaseCard } from '@/components/CaseCard';
import { CaseFiltersForm } from '@/components/CaseFilters';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { ErrorBanner } from '@/components/ErrorBanner';

export default function CasesPage() {
  const [cases, setCases] = useState<Case[] | null>(null);
  const [filters, setFilters] = useState<CaseFilters>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCases(null);
    api
      .listCases(filters)
      .then((data) => setCases(data || []))
      .catch((e) => setError(e.message));
  }, [filters]);

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

      <CaseFiltersForm value={filters} onChange={setFilters} />

      {error ? <ErrorBanner variant="error">{error}</ErrorBanner> : null}

      {cases === null ? (
        <LoadingSkeleton rows={3} />
      ) : cases.length === 0 ? (
        <EmptyState
          title="no cases yet"
          body="create your first case to start exploring data."
          cta={{ href: '/cases/new', label: 'Create case' }}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="case-list">
          {cases.map((c) => (
            <li key={c.id}>
              <CaseCard c={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
