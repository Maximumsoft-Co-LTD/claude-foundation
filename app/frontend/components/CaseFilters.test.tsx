import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { CaseFiltersForm } from './CaseFilters';

describe('CaseFiltersForm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pushMock.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pushes a URL with the title query after the debounce window elapses', () => {
    render(<CaseFiltersForm initial={{}} />);
    const search = screen.getByPlaceholderText('Search title') as HTMLInputElement;

    fireEvent.change(search, { target: { value: 'fraud' } });
    expect(pushMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/cases?title=fraud');
  });

  it('serialises the `from` date input as an ISO timestamp at start-of-day UTC', () => {
    render(<CaseFiltersForm initial={{}} />);
    // The date-range "from" input is the 4th input — first three are search, tag, status.
    const inputs = screen
      .getByTestId('case-filters')
      .querySelectorAll('input, select');
    // index 3 is the first date input (from), index 4 is the second (to).
    const fromInput = inputs[3] as HTMLInputElement;
    expect(fromInput.type).toBe('date');

    fireEvent.change(fromInput, { target: { value: '2026-05-21' } });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(pushMock).toHaveBeenCalledTimes(1);
    const pushedURL = pushMock.mock.calls[0][0] as string;
    // The component must encode `from=2026-05-21T00:00:00Z` (start-of-day UTC).
    expect(pushedURL).toContain('from=2026-05-21T00%3A00%3A00Z');
  });

  it('serialises the `to` date input as an ISO timestamp at end-of-day UTC', () => {
    render(<CaseFiltersForm initial={{}} />);
    const inputs = screen
      .getByTestId('case-filters')
      .querySelectorAll('input, select');
    const toInput = inputs[4] as HTMLInputElement;
    expect(toInput.type).toBe('date');

    fireEvent.change(toInput, { target: { value: '2026-05-21' } });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(pushMock).toHaveBeenCalledTimes(1);
    const pushedURL = pushMock.mock.calls[0][0] as string;
    expect(pushedURL).toContain('to=2026-05-21T23%3A59%3A59Z');
  });
});
