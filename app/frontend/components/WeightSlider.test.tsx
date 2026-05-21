import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WeightSlider } from './WeightSlider';

describe('WeightSlider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders with the initial value', () => {
    render(<WeightSlider value={42} onChange={() => {}} />);
    const slider = screen.getByTestId('weight-slider');
    expect(slider).toBeInTheDocument();
    const input = slider.querySelector('input[type="range"]') as HTMLInputElement;
    expect(input.value).toBe('42');
  });

  it('debounces onChange and fires after the timeout', () => {
    const onChange = vi.fn();
    render(<WeightSlider value={0} onChange={onChange} />);
    const input = screen.getByTestId('weight-slider').querySelector(
      'input[type="range"]',
    ) as HTMLInputElement;

    onChange.mockClear();

    fireEvent.change(input, { target: { value: '50' } });
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onChange).toHaveBeenCalledWith(50);
  });
});
