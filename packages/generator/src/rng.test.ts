import { describe, expect, it } from "vitest";
import { createRng } from "./rng.js";

const draw = (seed: number, n: number) => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe("createRng", () => {
  it("gives the same sequence for the same seed", () => {
    expect(draw(42, 100)).toEqual(draw(42, 100));
  });

  it("gives different sequences for different seeds", () => {
    expect(draw(42, 10)).not.toEqual(draw(43, 10));
  });

  it("is pinned to a known sequence so the algorithm cannot drift silently", () => {
    expect(draw(42, 3).map((x) => x.toFixed(8))).toMatchInlineSnapshot(`
      [
        "0.60110375",
        "0.44829056",
        "0.85246579",
      ]
    `);
  });

  it("keeps next() in [0, 1) and int() within bounds", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const n = rng.int(3, 5);
      expect([3, 4, 5]).toContain(n);
    }
  });

  it("samples distinct elements and picks members", () => {
    const rng = createRng(1);
    const items = ["a", "b", "c", "d", "e"];
    const s = rng.sample(items, 3);
    expect(new Set(s).size).toBe(3);
    expect(items).toContain(rng.pick(items));
  });

  it("rejects bad seeds and ranges", () => {
    expect(() => createRng(1.5)).toThrow(RangeError);
    expect(() => createRng(1).int(5, 3)).toThrow(RangeError);
    expect(() => createRng(1).pick([])).toThrow(RangeError);
    expect(() => createRng(1).sample([1], 2)).toThrow(RangeError);
  });
});
