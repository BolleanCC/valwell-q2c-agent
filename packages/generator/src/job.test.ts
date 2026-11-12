import { applyMarkupBps, multiplyQty, workOrderLineQty } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import { generateJob } from "./job.js";
import { generateReferenceData } from "./reference.js";
import { createRng } from "./rng.js";

const rng = createRng(2026);
const ref = generateReferenceData(rng, 4);
const bundles = Array.from({ length: 60 }, (_, i) => generateJob(rng, ref, i));

describe("generateJob (ground truth)", () => {
  it("issues a TDI quote and a repair quote", () => {
    for (const { quotes } of bundles) {
      expect(quotes.map((q) => q.stage)).toEqual(["TDI", "REPAIR"]);
      expect(quotes[0]?.lines.map((l) => l.itemCode)).toEqual(["TDI-FEE"]);
    }
  });

  it("only performs work that is quoted or covered by an approved change order", () => {
    for (const { quotes, changeOrders, workOrder } of bundles) {
      const approved = new Set([
        ...quotes.flatMap((q) => q.lines.map((l) => l.itemCode)),
        ...changeOrders
          .filter((c) => c.status === "APPROVED")
          .flatMap((c) => c.lines.map((l) => l.itemCode)),
      ]);
      for (const line of workOrder.lines) expect(approved).toContain(line.itemCode);
    }
  });

  it("invoices exactly the work order, with correct extensions and lineage", () => {
    for (const { workOrder, invoice } of bundles) {
      expect(invoice.lines).toHaveLength(workOrder.lines.length);
      invoice.lines.forEach((line, i) => {
        const wo = workOrder.lines[i];
        expect(line.itemCode).toBe(wo?.itemCode);
        expect(line.qty).toBe(wo && workOrderLineQty(wo));
        expect(line.amount).toBe(multiplyQty(line.unitPrice, line.qty));
        expect(line.sourceRef?.workOrderLineId).toBe(wo?.id);
      });
    }
  });

  it("prices services and labour from the price book effective on the service date", () => {
    for (const { invoice } of bundles) {
      for (const line of invoice.lines.filter((l) => l.kind !== "PART")) {
        const pb = ref.priceBook.find((p) => p.id === line.sourceRef?.priceBookItemId);
        expect(pb?.unitPrice).toBe(line.unitPrice);
        expect(pb && pb.effectiveFrom <= invoice.serviceDate).toBe(true);
        expect(pb?.effectiveTo === null || invoice.serviceDate < (pb?.effectiveTo ?? "")).toBe(
          true,
        );
      }
    }
  });

  it("bills parts at cost-plus within the customer's markup cap", () => {
    for (const { invoice, workOrder } of bundles) {
      const cap = ref.rules.find((r) => r.customerId === invoice.customerId)?.markupCapBps ?? 0;
      for (const line of invoice.lines.filter((l) => l.kind === "PART")) {
        const wo = workOrder.lines.find((w) => w.id === line.sourceRef?.workOrderLineId);
        expect(wo?.kind).toBe("PART");
        if (wo?.kind !== "PART") continue;
        expect(line.unitCost).toBe(wo.unitCost);
        expect(line.unitPrice).toBeLessThanOrEqual(applyMarkupBps(wo.unitCost, cap));
      }
    }
  });

  it("matches the repair quote's part prices and covers some jobs with a change order", () => {
    for (const { quotes, invoice } of bundles) {
      for (const ql of quotes[1]?.lines ?? []) {
        const il = invoice.lines.find((l) => l.sourceRef?.quoteLineId === ql.id);
        expect(il?.unitPrice).toBe(ql.unitPrice);
      }
    }
    const withCo = bundles.filter((b) => b.changeOrders.length > 0).length;
    expect(withCo).toBeGreaterThan(0);
    expect(withCo).toBeLessThan(bundles.length);
  });

  it("uses both price-book versions across a batch", () => {
    const versions = new Set(bundles.map((b) => b.quotes[0]?.priceBookVersion));
    expect(versions).toEqual(new Set([1, 2]));
  });

  it("is deterministic for a seed", () => {
    const again = createRng(2026);
    const ref2 = generateReferenceData(again, 4);
    expect(generateJob(again, ref2, 0)).toEqual(bundles[0]);
  });
});
