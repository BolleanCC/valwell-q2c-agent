import { InvoiceLine, Quote, WorkOrderLine } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import { buildContext } from "../testing/build-context.js";
import { align, isApprovedScope } from "./align.js";

describe("align", () => {
  it("builds one row per item code in first-seen order", () => {
    const table = align(buildContext()).rows;
    expect(table.map((r) => r.itemCode)).toEqual(["TDI-FEE", "LAB-TECH", "PART-SEAT", "PART-STEM"]);
  });

  it("links every document's lines to the row", () => {
    const seat = align(buildContext()).rows.find((r) => r.itemCode === "PART-SEAT");
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
    const table = align(ctx).rows;
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
    const table = align(ctx).rows;
    expect(table.find((r) => r.itemCode === "LAB-TECH")?.quoteLines.map((l) => l.id)).toEqual([
      "QL-2b",
    ]);
    const seat = table.find((r) => r.itemCode === "PART-SEAT");
    expect(seat?.quoteLines).toEqual([]);
    expect(seat && isApprovedScope(seat)).toBe(false);
  });
});

describe("align line matching", () => {
  const matchOf = (ctx: ReturnType<typeof buildContext>, lineId: string) =>
    align(ctx).matches.find((m) => m.invoiceLine.id === lineId)?.workOrderLine?.id ?? null;
  const seatPart = (id: string, unitCost: number) =>
    WorkOrderLine.parse({
      id,
      kind: "PART",
      itemCode: "PART-SEAT",
      description: "Seat",
      qty: 2,
      unitCost,
    });

  it("resolves every line of a consistent job, by reference or unique item code", () => {
    const { matches, issues } = align(buildContext());
    expect(matches.map((m) => [m.invoiceLine.id, m.workOrderLine?.id])).toEqual([
      ["IL-1", "WL-1"],
      ["IL-2", "WL-2"],
      ["IL-3", "WL-3"],
      ["IL-4", "WL-4"],
    ]);
    expect(issues).toEqual([]);
  });

  it("does not fall back to the item code when an explicit reference is invalid", () => {
    const ctx = buildContext();
    Object.assign(ctx.invoice.lines[1] ?? {}, { sourceRef: { workOrderLineId: "WL-404" } });
    expect(matchOf(ctx, "IL-2")).toBeNull();
    expect(align(ctx).issues).toEqual([
      {
        code: "INVALID_SOURCE_REF",
        invoiceLineId: "IL-2",
        message: "IL-2 (LAB-TECH): work-order line WL-404 is not on WO-T",
      },
    ]);
  });

  it("rejects a reference to a work-order line for a different item", () => {
    const ctx = buildContext();
    Object.assign(ctx.invoice.lines[1] ?? {}, { sourceRef: { workOrderLineId: "WL-1" } });
    expect(matchOf(ctx, "IL-2")).toBeNull();
    expect(align(ctx).issues[0]?.message).toContain("references WL-1, which records TDI-FEE");
  });

  it("leaves duplicate item codes with different costs unresolved", () => {
    const ctx = buildContext();
    ctx.workOrder.lines.push(seatPart("WL-3b", 15_000));
    expect(matchOf(ctx, "IL-3")).toBeNull();
    expect(align(ctx).issues).toMatchObject([{ code: "AMBIGUOUS_MATCH", invoiceLineId: "IL-3" }]);
  });

  it("flags a line with no work record, an incompatible kind and double billing", () => {
    const ctx = buildContext();
    Object.assign(ctx.workOrder.lines[0] ?? {}, { kind: "LABOUR", hours: 1 });
    ctx.invoice.lines.push(
      InvoiceLine.parse({
        id: "IL-5",
        itemCode: "PART-GATE",
        description: "Gate",
        kind: "PART",
        qty: 1,
        unitPrice: 100,
        amount: 100,
        unitCost: 90,
      }),
      InvoiceLine.parse({
        id: "IL-6",
        itemCode: "PART-SEAT",
        description: "Seat",
        kind: "PART",
        qty: 2,
        unitPrice: 22_000,
        amount: 44_000,
        unitCost: 20_000,
      }),
    );
    const issues = align(ctx).issues;
    expect(issues.map((i) => [i.code, i.invoiceLineId])).toEqual([
      ["KIND_MISMATCH", "IL-1"],
      ["NO_WORK_RECORD", "IL-5"],
      ["DUPLICATE_BILLING", "IL-3"],
      ["DUPLICATE_BILLING", "IL-6"],
    ]);
    expect(matchOf(ctx, "IL-3")).toBeNull();
  });

  it("rejects a quote-line reference from a superseded revision", () => {
    const ctx = buildContext();
    Object.assign(ctx.invoice.lines[1] ?? {}, {
      sourceRef: { workOrderLineId: "WL-2", quoteLineId: "QL-old" },
    });
    expect(align(ctx).issues[0]?.message).toContain(
      "QL-old is not in the effective quote revision",
    );
  });
});
