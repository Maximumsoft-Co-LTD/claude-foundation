'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ColumnMappingForm } from '@/components/ColumnMappingForm';
import { ErrorBanner } from '@/components/ErrorBanner';

const MAX_BYTES = 5 * 1024 * 1024;

export default function UploadPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();
  const [step, setStep] = useState<'pick' | 'map'>('pick');
  const [fileID, setFileID] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      setError('Only .xlsx files are accepted.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setError('File exceeds 5 MiB limit.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.uploadFile(id, f);
      setFileID(res.file_id);
      setHeaders(res.headers);
      setStep('map');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Upload xlsx</h1>
      {error ? <ErrorBanner variant="error">{error}</ErrorBanner> : null}

      {step === 'pick' ? (
        <div className="space-y-2" data-testid="upload-pick">
          <p className="text-sm text-slate-600">
            ≤ 5 MiB. First row of sheet 1 = column headers.
          </p>
          <input
            type="file"
            accept=".xlsx"
            onChange={onFile}
            disabled={busy}
            className="block w-full text-sm"
          />
        </div>
      ) : fileID ? (
        <ColumnMappingForm
          headers={headers}
          onSubmit={async (m) => {
            setError(null);
            try {
              await api.setMapping(id, fileID, m);
              router.push(`/cases/${id}`);
            } catch (err: unknown) {
              setError(err instanceof Error ? err.message : 'mapping failed');
            }
          }}
        />
      ) : null}
    </div>
  );
}
