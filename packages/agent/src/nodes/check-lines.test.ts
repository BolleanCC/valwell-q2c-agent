import { fromCents, PriceBookItem } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import type { JobContext } from "../adapters/sources.js";
import { runPipeline } from "../pipeline.js";
import { buildContext } from "../testing/build-context.js";
import { align } from "./align.js";
import { checkLineEvidence } from "./check-lines.js";

const check = (ctx: JobContext) => checkLineEvidence(ctx, align(ctx));

describe("checkLineEvidence", () => {
  it("passes a supported, correctly extended invoice", () => {
    expect(check(buildContext())).toEqual([]);
  });

  it("flags a correct unit price with a wrong line amount", () => {
    const ctx = buildContext();
    const labour = ctx.invoice.lines[1];
    if (!labour) throw new Error("IL-2");
    labour.amount = fromCents(75_000); // 6 h × $95.00 = $570.00
    expect(check(ctx)).toEqual([
      {
        code: "EXTENSION_ERROR",
        invoiceLineId: "IL-2",
        message: "IL-2 (LAB-TECH): amount $750.00 ≠ 6 × $95.00 = $570.00",
      },
    ]);
  });

  it("flags a service with no effective price on the service date", () => {
    const ctx = buildContext();
    ctx.priceBook = ctx.priceBook.filter((p) => p.itemCode !== "TDI-FEE" || p.version === 1);
    expect(check(ctx)).toMatchObject([{ code: "NO_EFFECTIVE_PRICE", invoiceLineId: "IL-1" }]);
  });

  it("flags two overlapping effective prices", () => {
    const ctx = buildContext();
    ctx.priceBook.push(
      PriceBookItem.parse({
        id: "PB-LAB-TECH-v3",
        customerId: "CUST-T",
        itemCode: "LAB-TECH",
        description: "Tech",
        kind: "LABOUR",
        unitPrice: 9_900,
        version: 3,
        effectiveFrom: "2026-02-01",
        effectiveTo: null,
      }),
    );
    const [issue] = check(ctx);
    expect(issue).toMatchObject({ code: "OVERLAPPING_PRICES", invoiceLineId: "IL-2" });
    expect(issue?.message).toContain("PB-LAB-TECH-v2, PB-LAB-TECH-v3");
  });

  it("routes the job to review and proposes no price for an overlapping rate", () => {
    const ctx = buildContext();
    ctx.priceBook.push(
      PriceBookItem.parse({
        ...ctx.priceBook.find((p) => p.id === "PB-LAB-TECH-v2"),
        id: "PB-LAB-TECH-v3",
        unitPrice: 9_900,
        version: 3,
      }),
    );
    const { reviews, findings } = runPipeline([ctx]);
    expect(findings).toEqual([]);
    expect(reviews[0]?.status).toBe("NEEDS_REVIEW");
  });
});
