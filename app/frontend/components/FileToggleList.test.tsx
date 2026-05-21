import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/api', () => ({
  api: {
    setIncluded: vi.fn(),
  },
}));

import { FileToggleList } from './FileToggleList';
import { api } from '@/lib/api';

const files = [
  {
    id: 'f1',
    filename: 'one.xlsx',
    included: true,
    headers: ['a', 'b'],
  },
];

describe('FileToggleList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls api.setIncluded when the checkbox is toggled', async () => {
    (api.setIncluded as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );
    const onToggle = vi.fn();
    render(
      <FileToggleList caseID="c1" files={files} onToggle={onToggle} />,
    );
    const cb = screen.getByTestId('file-toggle-f1') as HTMLInputElement;
    fireEvent.click(cb);
    await waitFor(() => {
      expect(api.setIncluded).toHaveBeenCalledWith('c1', 'f1', false);
    });
    await waitFor(() => {
      expect(onToggle).toHaveBeenCalledTimes(1);
    });
  });

  it('reverts the checkbox and calls onError when api.setIncluded rejects', async () => {
    (api.setIncluded as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('boom'),
    );
    const onError = vi.fn();
    const onToggle = vi.fn();
    render(
      <FileToggleList
        caseID="c1"
        files={files}
        onToggle={onToggle}
        onError={onError}
      />,
    );
    const cb = screen.getByTestId('file-toggle-f1') as HTMLInputElement;
    expect(cb.checked).toBe(true);
    fireEvent.click(cb);
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('boom');
    });
    expect(cb.checked).toBe(true);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
