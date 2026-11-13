import { Finding, fromCents } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import type { JobContext } from "../adapters/sources.js";
import { align } from "../nodes/align.js";
import { buildContext } from "../testing/build-context.js";
import { a1StalePrice } from "./a1-stale-price.js";

const run = (ctx: JobContext) => a1StalePrice.detect(ctx, align(ctx));

/** Change an invoice line's unit price and re-extend it. */
function reprice(ctx: JobContext, lineId: string, unitPrice: number): void {
  const line = ctx.invoice.lines.find((l) => l.id === lineId);
  if (!line) throw new Error(lineId);
  line.unitPrice = fromCents(unitPrice);
  line.amount = fromCents(unitPrice * line.qty);
}

describe("A1 stale price detector", () => {
  it("finds nothing on a correctly priced invoice", () => {
    expect(run(buildContext())).toEqual([]);
  });

  it("flags a line billed at the superseded price-book version", () => {
    const ctx = buildContext();
    reprice(ctx, "IL-2", 9_000); // v1 labour rate, service date is in v2
    const [f] = run(ctx);
    expect(f).toMatchObject({
      frictionCode: "A1",
      invoiceLineId: "IL-2",
      workOrderLineId: "WL-2",
      basis: "SUPERSEDED_PRICE_VERSION",
      suggestion: { action: "REPRICE_LINE", expectedUnitPrice: 9_500, amountDelta: 3_000 },
    });
    expect(f?.evidence).toEqual(
      expect.arrayContaining([
        { kind: "PRICE_BOOK_ITEM", id: "PB-LAB-TECH-v2" },
        { kind: "PRICE_BOOK_ITEM", id: "PB-LAB-TECH-v1" },
      ]),
    );
    expect(f?.message).toContain("superseded price-book v1");
  });

  it("flags an unexplained (typo) price and a negative delta when over-billed", () => {
    const ctx = buildContext();
    reprice(ctx, "IL-1", 88_000); // $880.00 instead of $840.00; matches no version
    const [f] = run(ctx);
    expect(f?.basis).toBe("UNEXPLAINED_PRICE");
    expect(f?.suggestion.amountDelta).toBe(-4_000);
    expect(f?.message).toContain("re-keying error");
  });

  it("ignores part lines and produces schema-valid findings", () => {
    const ctx = buildContext();
    reprice(ctx, "IL-3", 99_999);
    reprice(ctx, "IL-2", 9_000);
    const findings = run(ctx);
    expect(findings.map((f) => f.invoiceLineId)).toEqual(["IL-2"]);
    for (const f of findings) Finding.parse({ ...f, id: "F-1", route: null, status: "OPEN" });
  });
});
