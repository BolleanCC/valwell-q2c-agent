import { describe, expect, it } from "vitest";
import { Invoice, InvoiceLine, invoiceTotal, SourceRef } from "./invoice.js";

const line = {
  id: "INV-0001-L1",
  itemCode: "PART-SEAT-3IN",
  description: "Seat ring",
  kind: "PART",
  qty: 2,
  unitPrice: 23100,
  amount: 46200,
  unitCost: 21000,
  sourceRef: { quoteLineId: "Q-0002-R1-L3", workOrderLineId: "WO-0001-L2" },
};

const invoice = {
  id: "INV-0001",
  jobId: "JOB-0001",
  customerId: "CUST-001",
  poNumber: "PO-55120",
  invoiceDate: "2026-03-12",
  serviceDate: "2026-03-09",
  lines: [line, { ...line, id: "INV-0001-L2", amount: 100, sourceRef: undefined }],
};

describe("SourceRef", () => {
  it("accepts any non-empty combination of references", () => {
    expect(SourceRef.parse({ changeOrderId: "CO-0001" })).toEqual({ changeOrderId: "CO-0001" });
  });

  it("rejects an empty reference", () => {
    expect(SourceRef.safeParse({}).success).toBe(false);
  });
});

describe("InvoiceLine", () => {
  it("parses a line with and without lineage", () => {
    expect(InvoiceLine.parse(line).sourceRef?.quoteLineId).toBe("Q-0002-R1-L3");
    const { sourceRef: _ref, unitCost: _cost, ...rekeyed } = line;
    expect(InvoiceLine.parse(rekeyed).sourceRef).toBeUndefined();
  });

  it("rejects fractional cents and an unknown kind", () => {
    expect(InvoiceLine.safeParse({ ...line, amount: 462.5 }).success).toBe(false);
    expect(InvoiceLine.safeParse({ ...line, kind: "TAX" }).success).toBe(false);
  });
});

describe("Invoice", () => {
  it("parses a valid invoice and totals its lines", () => {
    expect(invoiceTotal(Invoice.parse(invoice))).toBe(46300);
  });

  it("rejects duplicate line ids and a missing PO", () => {
    expect(Invoice.safeParse({ ...invoice, lines: [line, line] }).success).toBe(false);
    expect(Invoice.safeParse({ ...invoice, poNumber: "" }).success).toBe(false);
  });
});
