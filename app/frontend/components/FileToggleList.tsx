'use client';

import { api, type CaseFile } from '@/lib/api';

export function FileToggleList({
  caseID,
  files,
  onToggle,
}: {
  caseID: string;
  files: CaseFile[];
  onToggle: () => void;
}) {
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
              checked={f.included}
              onChange={async (e) => {
                await api.setIncluded(caseID, f.id, e.target.checked);
                onToggle();
              }}
            />
          </label>
        </li>
      ))}
    </ul>
  );
}
