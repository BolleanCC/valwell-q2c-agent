import { Quote } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import { buildContext } from "../testing/build-context.js";
import { align, isApprovedScope } from "./align.js";

describe("align", () => {
  it("builds one row per item code in first-seen order", () => {
    const table = align(buildContext());
    expect(table.map((r) => r.itemCode)).toEqual(["TDI-FEE", "LAB-TECH", "PART-SEAT", "PART-STEM"]);
  });

  it("links every document's lines to the row", () => {
    const seat = align(buildContext()).find((r) => r.itemCode === "PART-SEAT");
    expect(seat?.quoteLines.map((l) => l.id)).toEqual(["QL-3"]);
    expect(seat?.workOrderLines.map((l) => l.id)).toEqual(["WL-3"]);
    expect(seat?.invoiceLines.map((l) => l.id)).toEqual(["IL-3"]);
  });

  it("counts approved change orders as scope but tracks unapproved ones separately", () => {
    const ctx = buildContext();
    ctx.changeOrders.push({
      ...structuredClone(ctx.changeOrders[0] as (typeof ctx.changeOrders)[number]),
      id: "CO-T-2" as never,
      status: "PENDING",
      approver: null,
      approvedDate: null,
      lines: [{ itemCode: "LAB-WELD" as never, description: "Weld", kind: "LABOUR", qty: 2 }],
    });
    const table = align(ctx);
    const stem = table.find((r) => r.itemCode === "PART-STEM");
    const weld = table.find((r) => r.itemCode === "LAB-WELD");
    expect(stem && isApprovedScope(stem)).toBe(true);
    expect(weld && isApprovedScope(weld)).toBe(false);
    expect(weld?.unapprovedChangeOrders).toEqual([{ changeOrderId: "CO-T-2", status: "PENDING" }]);
  });

  it("uses only the latest revision of each quote", () => {
    const ctx = buildContext();
    const rep = ctx.quotes[1];
    if (!rep) throw new Error("missing repair quote");
    ctx.quotes.push(
      Quote.parse({
        ...rep,
        revision: 2,
        lines: [{ ...rep.lines[0], id: "QL-2b", qty: 8 }],
      }),
    );
    const table = align(ctx);
    expect(table.find((r) => r.itemCode === "LAB-TECH")?.quoteLines.map((l) => l.id)).toEqual([
      "QL-2b",
    ]);
    const seat = table.find((r) => r.itemCode === "PART-SEAT");
    expect(seat?.quoteLines).toEqual([]);
    expect(seat && isApprovedScope(seat)).toBe(false);
  });
});
