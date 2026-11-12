import { describe, expect, it } from "vitest";
import { Money } from "./money.js";
import { BasisPoints, CustomerId, IsoDate, LineKind, Quantity } from "./primitives.js";

describe("branded ids", () => {
  it("accepts non-empty strings and trims them", () => {
    expect(CustomerId.parse("  CUST-001 ")).toBe("CUST-001");
  });

  it.each(["", "   ", 42, null])("rejects %j", (bad) => {
    expect(CustomerId.safeParse(bad).success).toBe(false);
  });
});

describe("IsoDate", () => {
  it("accepts real calendar dates", () => {
    expect(IsoDate.parse("2026-02-28")).toBe("2026-02-28");
  });

  it.each(["2026-02-30", "2026/02/28", "2026-2-8", "2026-02-28T00:00:00Z"])("rejects %j", (bad) => {
    expect(IsoDate.safeParse(bad).success).toBe(false);
  });
});

describe("Money schema", () => {
  it("accepts integer cents", () => {
    expect(Money.parse(-1999)).toBe(-1999);
  });

  it.each([1.5, Number.NaN, 2 ** 53, "100"])("rejects %j", (bad) => {
    expect(Money.safeParse(bad).success).toBe(false);
  });
});

describe("BasisPoints", () => {
  it("accepts non-negative integers", () => {
    expect(BasisPoints.parse(1000)).toBe(1000);
  });

  it.each([-1, 2.5])("rejects %j", (bad) => {
    expect(BasisPoints.safeParse(bad).success).toBe(false);
  });
});

describe("Quantity", () => {
  it.each([1, 1.5, 0.125])("accepts %j", (q) => {
    expect(Quantity.parse(q)).toBe(q);
  });

  it.each([0, -1, 0.0001])("rejects %j", (bad) => {
    expect(Quantity.safeParse(bad).success).toBe(false);
  });
});

describe("LineKind", () => {
  it("accepts the three kinds and rejects others", () => {
    expect(LineKind.options).toEqual(["SERVICE", "LABOUR", "PART"]);
    expect(LineKind.safeParse("FREIGHT").success).toBe(false);
  });
});
