import { Finding, fromCents } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import type { JobContext } from "../adapters/sources.js";
import { align } from "../nodes/align.js";
import { buildContext } from "../testing/build-context.js";
import { a3MarkupCap } from "./a3-markup-cap.js";

const run = (ctx: JobContext) => a3MarkupCap.detect(ctx, align(ctx));

function reprice(ctx: JobContext, lineId: string, unitPrice: number): void {
  const line = ctx.invoice.lines.find((l) => l.id === lineId);
  if (!line) throw new Error(lineId);
  line.unitPrice = fromCents(unitPrice);
  line.amount = fromCents(unitPrice * line.qty);
}

describe("A3 markup cap detector", () => {
  it("finds nothing when parts are at or below the cap", () => {
    expect(run(buildContext())).toEqual([]);
  });

  it("flags a part above cost × (1 + cap) using the work-order cost", () => {
    const ctx = buildContext();
    reprice(ctx, "IL-3", 25_000); // cost $200.00, cap 10 % → max $220.00, qty 2
    const [f] = run(ctx);
    expect(f).toMatchObject({
      frictionCode: "A3",
      invoiceLineId: "IL-3",
      workOrderLineId: "WL-3",
      confidence: 0.95,
      suggestion: { action: "REPRICE_LINE", expectedUnitPrice: 22_000, amountDelta: -6_000 },
    });
    expect(f?.evidence).toEqual(
      expect.arrayContaining([
        { kind: "RULE", id: "RULE-T" },
        { kind: "WORK_ORDER_LINE", id: "WL-3" },
      ]),
    );
    expect(f?.message).toContain("25.0% markup exceeds the 10.0% cap");
    Finding.parse({ ...f, id: "F-1", route: null, status: "OPEN" });
  });

  it("trusts the work-order cost over an inflated disclosed cost", () => {
    const ctx = buildContext();
    const line = ctx.invoice.lines.find((l) => l.id === "IL-4");
    if (!line) throw new Error("IL-4");
    line.unitCost = fromCents(50_000); // claims $500 cost; shop paid $400
    reprice(ctx, "IL-4", 55_000);
    expect(run(ctx)[0]?.suggestion.expectedUnitPrice).toBe(44_000);
  });

  it("does not reprice a part with no matched work-order cost (left to review)", () => {
    const ctx = buildContext();
    ctx.workOrder.lines = ctx.workOrder.lines.filter((l) => l.id !== "WL-4");
    reprice(ctx, "IL-4", 60_000);
    expect(run(ctx)).toEqual([]);
    expect(align(ctx).issues).toMatchObject([{ code: "NO_WORK_RECORD", invoiceLineId: "IL-4" }]);
  });

  it("ignores services and labour", () => {
    const ctx = buildContext();
    reprice(ctx, "IL-2", 99_999);
    expect(run(ctx)).toEqual([]);
  });
});
