/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * All randomness in the generator flows through an `Rng` passed in
 * explicitly, so the same seed always yields byte-identical output.
 * Never call `Math.random()` in this package.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** `count` distinct elements, in random order. */
  sample<T>(items: readonly T[], count: number): T[];
}

export function createRng(seed: number): Rng {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError(`Seed must be a safe integer, got ${seed}`);
  }
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`Invalid integer range [${min}, ${max}]`);
    }
    return min + Math.floor(next() * (max - min + 1));
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new RangeError("Cannot pick from an empty array");
    return items[int(0, items.length - 1)] as T;
  };

  const sample = <T>(items: readonly T[], count: number): T[] => {
    if (count > items.length) throw new RangeError("Sample larger than population");
    const pool = [...items];
    // Partial Fisher–Yates shuffle.
    for (let i = 0; i < count; i++) {
      const j = int(i, pool.length - 1);
      [pool[i], pool[j]] = [pool[j] as T, pool[i] as T];
    }
    return pool.slice(0, count);
  };

  return { next, int, chance: (p) => next() < p, pick, sample };
}
