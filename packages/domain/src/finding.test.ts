import { describe, expect, it } from "vitest";
import { FaultLabel, Finding, FRICTION_DESCRIPTIONS, FrictionCode } from "./finding.js";

const finding = {
  id: "F-0001",
  jobId: "JOB-0001",
  invoiceId: "INV-0001",
  frictionCode: "A1",
  invoiceLineId: "INV-0001-L2",
  workOrderLineId: null,
  message: "LAB-TECH billed at $90.00/h; price book v2 effective 2026-03-09 says $95.00/h",
  evidence: [
    { kind: "INVOICE_LINE", id: "INV-0001-L2" },
    { kind: "PRICE_BOOK_ITEM", id: "PB-CUST-001-LAB-TECH-v2" },
  ],
  suggestion: {
    action: "REPRICE_LINE",
    summary: "Reprice to $95.00/h",
    expectedUnitPrice: 9500,
    amountDelta: 3000,
  },
  confidence: 0.95,
  route: null,
  status: "OPEN",
};

describe("FrictionCode", () => {
  it("covers A1, A3 and B1 with a description each", () => {
    expect(FrictionCode.options).toEqual(["A1", "A3", "B1"]);
    for (const code of FrictionCode.options) expect(FRICTION_DESCRIPTIONS[code]).toBeTruthy();
  });

  it("rejects codes not yet in scope", () => {
    expect(FrictionCode.safeParse("C1").success).toBe(false);
  });
});

describe("Finding", () => {
  it("parses a valid finding", () => {
    expect(Finding.parse(finding)).toEqual(finding);
  });

  it("requires evidence beyond the invoice line itself", () => {
    const onlyInvoice = { ...finding, evidence: [{ kind: "INVOICE_LINE", id: "INV-0001-L2" }] };
    expect(Finding.safeParse(onlyInvoice).success).toBe(false);
    expect(Finding.safeParse({ ...finding, evidence: [] }).success).toBe(false);
  });

  it("rejects out-of-range confidence and an unknown route", () => {
    expect(Finding.safeParse({ ...finding, confidence: 1.2 }).success).toBe(false);
    expect(Finding.safeParse({ ...finding, route: "IGNORE" }).success).toBe(false);
  });
});

describe("FaultLabel", () => {
  const label = {
    id: "FL-0001",
    jobId: "JOB-0001",
    invoiceId: "INV-0001",
    frictionCode: "B1",
    invoiceLineId: "INV-0001-L5",
    workOrderLineId: "WO-0001-L5",
    description: "Added PART-STEM-3IN without an approved change order",
    amountImpact: 41800,
  };

  it("parses a valid label", () => {
    expect(FaultLabel.parse(label)).toEqual(label);
  });

  it("rejects fractional amounts and missing description", () => {
    expect(FaultLabel.safeParse({ ...label, amountImpact: 0.5 }).success).toBe(false);
    expect(FaultLabel.safeParse({ ...label, description: "" }).success).toBe(false);
  });
});
