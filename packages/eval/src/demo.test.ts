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
      routeReason: expect.stringContaining("matches no version"),
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
      routeReason: expect.stringContaining("invoice and work-order costs agree"),
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

describe("demo case 4: unapproved additional work", async () => {
  const r = await runDemoCase(CASE("4-unapproved-extra-work"));

  it("finds the new part outside approved scope and blocks the line", () => {
    expect(r.review.status).toBe("COMPLETE");
    expect(r.run.findings).toHaveLength(1);
    expect(r.run.findings[0]).toMatchObject({
      frictionCode: "B1",
      invoiceLineId: "INV-D4-L5",
      workOrderLineId: "WO-D4-L5",
      route: "BLOCK",
      routeReason: expect.stringContaining("only the customer can approve it"),
      suggestion: { action: "REQUEST_CHANGE_ORDER", amountDelta: -44_000 },
    });
    expect(r.run.findings[0]?.message).toContain("no change order exists");
    expect(r.original.portal).toMatchObject({ status: "REJECTED", reasonCode: "UNAPPROVED_SCOPE" });
  });

  it("holds the line at its original amount and submits the remaining lines", () => {
    const expected = {
      status: "READY",
      changes: [],
      held: [{ id: "INV-D4-L5", itemCode: "PART-STEM", qty: 1, unitPrice: 44_000, amount: 44_000 }],
      // $2,640.00 billed = $2,200.00 submitted + $440.00 held; nothing repriced.
      totals: { original: 264_000, held: 44_000, draft: 220_000, corrections: 0 },
      portal: { status: "APPROVED" },
    };
    expect(r.unattended).toMatchObject(expected);
    expect(r.unattended.invoice?.lines.map((l) => l.id)).not.toContain("INV-D4-L5");
    // Accepting the finding accepts the hold; it is not the customer approving the stem.
    expect(r.afterAcceptance).toMatchObject(expected);
  });
});
