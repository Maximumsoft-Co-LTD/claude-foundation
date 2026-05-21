import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExportButtons } from './ExportButtons';

describe('ExportButtons', () => {
  beforeEach(() => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () =>
      'blob:mock';
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    (globalThis as unknown as { __restoreURL: () => void }).__restoreURL = () => {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    };
  });
  afterEach(() => {
    (globalThis as unknown as { __restoreURL: () => void }).__restoreURL?.();
    vi.restoreAllMocks();
  });

  it('renders an Export JSON link pointing at the export.json endpoint', () => {
    render(<ExportButtons caseID="abc-123" />);
    const link = screen.getByText('Export JSON') as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.href).toContain('/api/v1/cases/abc-123/graph/export.json');
  });

  it('Export PNG calls canvas.toBlob with image/png', () => {
    const canvas = document.createElement('canvas');
    canvas.toBlob = vi.fn((cb: BlobCallback) => {
      cb(new Blob(['x'], { type: 'image/png' }));
    }) as unknown as HTMLCanvasElement['toBlob'];

    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-testid', 'network-chart');
    wrapper.appendChild(canvas);
    document.body.appendChild(wrapper);

    render(<ExportButtons caseID="abc-123" />);
    const btn = screen.getByText('Export PNG');
    fireEvent.click(btn);

    expect(canvas.toBlob).toHaveBeenCalledTimes(1);
    const call = (canvas.toBlob as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0];
    expect(call[1]).toBe('image/png');

    document.body.removeChild(wrapper);
  });
});
