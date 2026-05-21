'use client';

import { useState } from 'react';
import { api, type CaseFile } from '@/lib/api';

type Props = {
  caseID: string;
  files: CaseFile[];
  onToggle: () => void;
  onError?: (message: string) => void;
};

export function FileToggleList({ caseID, files, onToggle, onError }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  return (
    <ul className="space-y-1" data-testid="file-toggle-list">
      {files.map((f) => (
        <li
          key={f.id}
          className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <span className="truncate">{f.filename}</span>
          <label className="flex items-center gap-2">
            <span className="text-xs text-slate-500">included</span>
            <input
              type="checkbox"
              data-testid={`file-toggle-${f.id}`}
              checked={f.included}
              disabled={pending === f.id}
              onChange={async (e) => {
                const next = e.target.checked;
                const checkbox = e.target;
                setPending(f.id);
                try {
                  await api.setIncluded(caseID, f.id, next);
                  onToggle();
                } catch (err: unknown) {
                  checkbox.checked = !next;
                  const msg =
                    err instanceof Error ? err.message : 'toggle failed';
                  onError?.(msg);
                } finally {
                  setPending(null);
                }
              }}
            />
          </label>
        </li>
      ))}
    </ul>
  );
}
