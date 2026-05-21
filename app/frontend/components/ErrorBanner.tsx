'use client';

import { useState } from 'react';

export function ErrorBanner({
  variant = 'error',
  children,
}: {
  variant?: 'error' | 'info';
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const cls =
    variant === 'error'
      ? 'border-red-300 bg-red-50 text-red-800'
      : 'border-blue-300 bg-blue-50 text-blue-800';
  return (
    <div
      role="alert"
      className={`flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm ${cls}`}
      data-testid="error-banner"
    >
      <div>{children}</div>
      <button
        onClick={() => setOpen(false)}
        className="text-xs underline hover:no-underline"
        aria-label="dismiss"
      >
        dismiss
      </button>
    </div>
  );
}
