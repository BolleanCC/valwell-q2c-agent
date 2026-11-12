import { describe, expect, it } from "vitest";
import { add, applyMarkupBps, format, fromCents, fromDollars, multiplyQty } from "./money.js";

describe("fromCents", () => {
  it("accepts safe integers", () => {
    expect(fromCents(12_345)).toBe(12_345);
    expect(fromCents(-5)).toBe(-5);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])("rejects %s", (bad) => {
    expect(() => fromCents(bad)).toThrow(RangeError);
  });
});

describe("fromDollars", () => {
  it.each([
    ["19.99", 1999],
    ["1234.5", 123_450],
    ["7", 700],
    ["-0.05", -5],
    [" 10.10 ", 1010],
    [0.1, 10],
    [19.99, 1999],
  ])("parses %j as %i cents", (input, cents) => {
    expect(fromDollars(input)).toBe(cents);
  });

  it("avoids floating-point drift (0.29 * 100 = 28.999999999999996)", () => {
    expect(fromDollars(0.29)).toBe(29);
  });

  it.each(["", "abc", "1.234", "$5", "1,000.00", ".5", "1e3"])("rejects %j", (bad) => {
    expect(() => fromDollars(bad)).toThrow(RangeError);
  });
});

describe("add", () => {
  it("sums amounts and returns zero for no arguments", () => {
    expect(add(fromCents(150), fromCents(275), fromCents(-25))).toBe(400);
    expect(add()).toBe(0);
  });
});

describe("multiplyQty", () => {
  it("multiplies by whole quantities exactly", () => {
    expect(multiplyQty(fromDollars("125.00"), 4)).toBe(50_000);
  });

  it("handles fractional labour hours", () => {
    expect(multiplyQty(fromDollars("95.00"), 1.5)).toBe(14_250);
  });

  it("rounds half away from zero", () => {
    // 3 cents × 0.5 = 1.5 cents → 2; -3 × 0.5 = -1.5 → -2
    expect(multiplyQty(fromCents(3), 0.5)).toBe(2);
    expect(multiplyQty(fromCents(-3), 0.5)).toBe(-2);
    // 1 cent × 0.333 = 0.333 → 0
    expect(multiplyQty(fromCents(1), 0.333)).toBe(0);
  });

  it.each([-1, 0.0001, Number.NaN])("rejects quantity %s", (bad) => {
    expect(() => multiplyQty(fromCents(100), bad)).toThrow(RangeError);
  });
});

describe("applyMarkupBps", () => {
  it("applies a 10% markup", () => {
    expect(applyMarkupBps(fromDollars("200.00"), 1000)).toBe(22_000);
  });

  it("leaves cost unchanged at 0 bps", () => {
    expect(applyMarkupBps(fromCents(999), 0)).toBe(999);
  });

  it("rounds half away from zero", () => {
    // 5 cents × 1.10 = 5.5 → 6; 1 cent × 1.25 = 1.25 → 1
    expect(applyMarkupBps(fromCents(5), 1000)).toBe(6);
    expect(applyMarkupBps(fromCents(1), 2500)).toBe(1);
  });

  it.each([-1, 12.5])("rejects %s bps", (bad) => {
    expect(() => applyMarkupBps(fromCents(100), bad)).toThrow(RangeError);
  });
});

describe("format", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [123_456, "$1,234.56"],
    [100_000_000, "$1,000,000.00"],
    [-1999, "-$19.99"],
  ])("formats %i as %s", (cents, text) => {
    expect(format(fromCents(cents))).toBe(text);
  });
});
