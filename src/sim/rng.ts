export interface Rng {
  next(): number;
  nextInt(min: number, max: number): number;
  nextFloat(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: T[]): T[];
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;

  function next(): number {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  }

  function nextInt(min: number, max: number): number {
    return Math.floor(next() * (max - min + 1)) + min;
  }

  function nextFloat(min: number, max: number): number {
    return next() * (max - min) + min;
  }

  function pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('pick on empty array');
    const idx = Math.floor(next() * arr.length);
    return arr[idx] as T;
  }

  function shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const tmp = arr[i] as T;
      arr[i] = arr[j] as T;
      arr[j] = tmp;
    }
    return arr;
  }

  return { next, nextInt, nextFloat, pick, shuffle };
}
