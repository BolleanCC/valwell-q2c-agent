import { fromCents, PriceBookItem } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import { checkMarkup } from "./markup.js";
import { findEffectivePrice, isPriceEffective } from "./price.js";

const item = (version: number, from: string, to: string | null, price: number) =>
  PriceBookItem.parse({
    id: `PB-CUST-001-LAB-TECH-v${version}`,
    customerId: "CUST-001",
    itemCode: "LAB-TECH",
    description: "Technician",
    kind: "LABOUR",
    unitPrice: price,
    version,
    effectiveFrom: from,
    effectiveTo: to,
  });
const v1 = item(1, "2025-01-01", "2026-01-01", 9000);
const v2 = item(2, "2026-01-01", null, 9500);

describe("isPriceEffective", () => {
  it("includes effectiveFrom and excludes effectiveTo", () => {
    expect(isPriceEffective(v1, "2025-01-01")).toBe(true);
    expect(isPriceEffective(v1, "2025-12-31")).toBe(true);
    expect(isPriceEffective(v1, "2026-01-01")).toBe(false);
    expect(isPriceEffective(v1, "2024-12-31")).toBe(false);
  });

  it("treats a null effectiveTo as open-ended", () => {
    expect(isPriceEffective(v2, "2030-06-01")).toBe(true);
  });
});

describe("findEffectivePrice", () => {
  const book = [v1, v2];

  it("picks the version in force on the date", () => {
    expect(findEffectivePrice(book, "CUST-001", "LAB-TECH", "2025-06-01")?.version).toBe(1);
    expect(findEffectivePrice(book, "CUST-001", "LAB-TECH", "2026-01-01")?.version).toBe(2);
  });

  it("returns undefined for another customer, item, a gap or an overlap", () => {
    expect(findEffectivePrice(book, "CUST-002", "LAB-TECH", "2025-06-01")).toBeUndefined();
    expect(findEffectivePrice(book, "CUST-001", "LAB-MACH", "2025-06-01")).toBeUndefined();
    expect(findEffectivePrice(book, "CUST-001", "LAB-TECH", "2024-06-01")).toBeUndefined();
    const overlap = item(3, "2025-06-01", null, 9900);
    expect(findEffectivePrice([...book, overlap], "CUST-001", "LAB-TECH", "2025-07-01")).toBe(
      undefined,
    );
  });
});

describe("checkMarkup", () => {
  const cost = fromCents(20_000);

  it("passes at or below the cap", () => {
    expect(checkMarkup(cost, fromCents(22_000), 1000)).toEqual({
      ok: true,
      maxUnitPrice: 22_000,
      actualMarkupBps: 1000,
      excessPerUnit: 0,
    });
    expect(checkMarkup(cost, fromCents(21_000), 1000).ok).toBe(true);
  });

  it("fails above the cap and reports the excess", () => {
    const r = checkMarkup(cost, fromCents(25_000), 1000);
    expect(r.ok).toBe(false);
    expect(r.actualMarkupBps).toBe(2500);
    expect(r.excessPerUnit).toBe(3000);
  });

  it("handles a zero cost", () => {
    const r = checkMarkup(fromCents(0), fromCents(100), 1000);
    expect(r).toMatchObject({ ok: false, actualMarkupBps: null, excessPerUnit: 100 });
  });
});
