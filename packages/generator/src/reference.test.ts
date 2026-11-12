import { describe, expect, it } from "vitest";
import { PRICE_BOOK_ENTRIES } from "./catalogue.js";
import { generateReferenceData, PRICE_BOOK_V1_FROM } from "./reference.js";
import { createRng } from "./rng.js";

describe("generateReferenceData", () => {
  const data = generateReferenceData(createRng(42), 3);

  it("creates customers with one markup rule each", () => {
    expect(data.customers.map((c) => c.id)).toEqual(["CUST-001", "CUST-002", "CUST-003"]);
    expect(data.rules.map((r) => r.customerId)).toEqual(["CUST-001", "CUST-002", "CUST-003"]);
    for (const r of data.rules) expect([1000, 1200, 1500]).toContain(r.markupCapBps);
  });

  it("creates two contiguous price-book versions per customer and item", () => {
    expect(data.priceBook).toHaveLength(3 * PRICE_BOOK_ENTRIES.length * 2);
    for (const customer of data.customers) {
      for (const entry of PRICE_BOOK_ENTRIES) {
        const versions = data.priceBook
          .filter((p) => p.customerId === customer.id && p.itemCode === entry.itemCode)
          .sort((a, b) => a.version - b.version);
        const [v1, v2] = versions;
        expect(versions).toHaveLength(2);
        expect(v1?.effectiveFrom).toBe(PRICE_BOOK_V1_FROM);
        expect(v1?.effectiveTo).toBe(v2?.effectiveFrom);
        expect(v2?.effectiveTo).toBeNull();
        expect(v2?.unitPrice).toBeGreaterThan(v1?.unitPrice ?? Number.POSITIVE_INFINITY);
      }
    }
  });

  it("never prices parts in the price book", () => {
    expect(new Set(data.priceBook.map((p) => p.kind))).toEqual(new Set(["SERVICE", "LABOUR"]));
  });

  it("is deterministic for a seed", () => {
    expect(generateReferenceData(createRng(42), 3)).toEqual(data);
    expect(generateReferenceData(createRng(43), 3)).not.toEqual(data);
  });

  it("rejects an out-of-range customer count", () => {
    expect(() => generateReferenceData(createRng(1), 0)).toThrow(RangeError);
    expect(() => generateReferenceData(createRng(1), 99)).toThrow(RangeError);
  });
});
