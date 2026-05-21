'use client';

import { useEffect, useRef, useState } from 'react';

export function WeightSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const [local, setLocal] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(local), 100);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  return (
    <label className="flex items-center gap-2 text-sm" data-testid="weight-slider">
      <span>min weight</span>
      <input
        type="range"
        min={0}
        max={100000}
        step={1}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
      />
      <span className="w-12 text-right font-mono">{local}</span>
    </label>
  );
}
