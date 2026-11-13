import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDemoCase } from "./demo.js";

const CASE = (name: string) => join(import.meta.dirname, "../../../data/fixtures/demo", name);

describe("demo case 1: normal repair", async () => {
  const r = await runDemoCase(CASE("1-normal-repair"));

  it("completes the review with no findings", () => {
    expect(r.review).toEqual({
      jobId: "JOB-D1",
      invoiceId: "INV-D1",
      status: "COMPLETE",
      issues: [],
    });
    expect(r.run.findings).toEqual([]);
  });

  it("passes the original invoice through the simulated portal unchanged", () => {
    expect(r.original.portal).toEqual({ invoiceId: "INV-D1", status: "APPROVED" });
    // 840.00 + 6 × 95.00 + 2 × 220.00 + 350.00 = $2,200.00
    expect(r.unattended).toMatchObject({
      status: "READY",
      changes: [],
      held: [],
      totals: { original: 220_000, held: 0, draft: 220_000, corrections: 0 },
      portal: { status: "APPROVED" },
    });
    expect(r.unattended.invoice).toEqual(r.original.invoice);
  });
});

describe("demo case 2: price entry error", async () => {
  const r = await runDemoCase(CASE("2-price-entry-error"));
  const [finding] = r.run.findings;

  it("finds the mistyped unit price and cites the applicable price-book version", () => {
    expect(r.review.status).toBe("COMPLETE");
    expect(r.run.findings).toHaveLength(1);
    expect(finding).toMatchObject({
      frictionCode: "A1",
      invoiceLineId: "INV-D2-L2",
      workOrderLineId: "WO-D2-L2",
      route: "REVIEW",
      status: "OPEN",
      // 6 h × $95.00 = $570.00 instead of 6 h × $59.00 = $354.00
      suggestion: { action: "REPRICE_LINE", expectedUnitPrice: 9_500, amountDelta: 21_600 },
    });
    expect(finding?.evidence).toContainEqual({ kind: "PRICE_BOOK_ITEM", id: "PB-D-LAB-TECH-v2" });
    expect(r.original.portal).toMatchObject({ status: "REJECTED", reasonCode: "PRICE_MISMATCH" });
  });

  it("does not apply the correction while the finding is OPEN", () => {
    expect(r.unattended).toMatchObject({
      status: "AWAITING_REVIEW",
      changes: [],
      totals: { original: 198_400, held: 0, draft: 198_400, corrections: 0 },
      portal: null,
    });
  });

  it("applies it after a simulated human accepts it, and the draft passes the portal", () => {
    expect(r.afterAcceptance).toMatchObject({
      status: "READY",
      changes: [
        {
          invoiceLineId: "INV-D2-L2",
          before: { unitPrice: 5_900, amount: 35_400 },
          after: { unitPrice: 9_500, amount: 57_000 },
        },
      ],
      held: [],
      totals: { original: 198_400, held: 0, draft: 220_000, corrections: 21_600 },
      portal: { status: "APPROVED" },
    });
  });
});

describe("demo case 3: parts markup above the contract cap", async () => {
  const r = await runDemoCase(CASE("3-markup-over-cap"));

  it("calculates the allowed selling price from the verified cost and the cap", () => {
    expect(r.review.status).toBe("COMPLETE");
    expect(r.run.findings).toHaveLength(1);
    expect(r.run.findings[0]).toMatchObject({
      frictionCode: "A3",
      invoiceLineId: "INV-D3-L3",
      workOrderLineId: "WO-D3-L3",
      route: "AUTO_FIX",
      // cost $200.00 × (1 + 10 %) = $220.00; 2 × ($220.00 − $250.00) = −$60.00
      suggestion: { action: "REPRICE_LINE", expectedUnitPrice: 22_000, amountDelta: -6_000 },
    });
    expect(r.run.findings[0]?.evidence).toEqual(
      expect.arrayContaining([
        { kind: "RULE", id: "RULE-CUST-D" },
        { kind: "WORK_ORDER_LINE", id: "WO-D3-L3" },
      ]),
    );
    expect(r.original.portal).toMatchObject({
      status: "REJECTED",
      reasonCode: "MARKUP_CAP_EXCEEDED",
    });
  });

  it("applies the correction unattended under the declared AUTO_FIX rule and passes the portal", () => {
    expect(r.unattended).toMatchObject({
      status: "READY",
      changes: [
        {
          invoiceLineId: "INV-D3-L3",
          before: { unitPrice: 25_000, amount: 50_000 },
          after: { unitPrice: 22_000, amount: 44_000 },
        },
      ],
      held: [],
      totals: { original: 226_000, held: 0, draft: 220_000, corrections: -6_000 },
      portal: { status: "APPROVED" },
    });
  });
});
