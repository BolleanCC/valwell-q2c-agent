import { describe, expect, it } from "vitest";
import { Customer, CustomerRules, PriceBookItem } from "./customer.js";

const priceBookItem = {
  id: "PB-CUST-001-LAB-TECH-v1",
  customerId: "CUST-001",
  itemCode: "LAB-TECH",
  description: "Shop technician labour (per hour)",
  kind: "LABOUR",
  unitPrice: 9500,
  version: 1,
  effectiveFrom: "2025-01-01",
  effectiveTo: "2026-01-01",
};

describe("Customer", () => {
  it("parses a valid customer", () => {
    const c = { id: "CUST-001", name: "Prairie Basin Energy", msaRef: "MSA-2024-017" };
    expect(Customer.parse(c)).toEqual(c);
  });

  it("requires a name and MSA reference", () => {
    expect(Customer.safeParse({ id: "CUST-001", name: "", msaRef: "x" }).success).toBe(false);
    expect(Customer.safeParse({ id: "CUST-001", name: "A" }).success).toBe(false);
  });
});

describe("PriceBookItem", () => {
  it("parses closed and open-ended versions", () => {
    expect(PriceBookItem.parse(priceBookItem).version).toBe(1);
    const open = { ...priceBookItem, version: 2, effectiveFrom: "2026-01-01", effectiveTo: null };
    expect(PriceBookItem.parse(open).effectiveTo).toBeNull();
  });

  it("rejects an effectiveTo on or before effectiveFrom", () => {
    const bad = { ...priceBookItem, effectiveTo: "2025-01-01" };
    const result = PriceBookItem.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["effectiveTo"]);
  });

  it("rejects parts, negative or fractional prices and version 0", () => {
    expect(PriceBookItem.safeParse({ ...priceBookItem, kind: "PART" }).success).toBe(false);
    expect(PriceBookItem.safeParse({ ...priceBookItem, unitPrice: -1 }).success).toBe(false);
    expect(PriceBookItem.safeParse({ ...priceBookItem, unitPrice: 95.5 }).success).toBe(false);
    expect(PriceBookItem.safeParse({ ...priceBookItem, version: 0 }).success).toBe(false);
  });
});

describe("CustomerRules", () => {
  it("parses a markup cap in basis points", () => {
    const r = { id: "RULE-CUST-001", customerId: "CUST-001", markupCapBps: 1000 };
    expect(CustomerRules.parse(r)).toEqual(r);
  });

  it("rejects a negative or fractional cap", () => {
    const base = { id: "RULE-CUST-001", customerId: "CUST-001" };
    expect(CustomerRules.safeParse({ ...base, markupCapBps: -5 }).success).toBe(false);
    expect(CustomerRules.safeParse({ ...base, markupCapBps: 10.5 }).success).toBe(false);
  });
});
