import { ChangeOrder, Finding, InvoiceLine, WorkOrderLine } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import type { JobContext } from "../adapters/sources.js";
import { align } from "../nodes/align.js";
import { buildContext } from "../testing/build-context.js";
import { b1ScopeChange } from "./b1-scope-change.js";

const run = (ctx: JobContext) => b1ScopeChange.detect(ctx, align(ctx));

/** Add unquoted weld labour to the work order and, optionally, the invoice. */
function addExtraWork(ctx: JobContext, invoiced = true): void {
  ctx.workOrder.lines.push(
    WorkOrderLine.parse({
      id: "WL-9",
      kind: "LABOUR",
      itemCode: "LAB-WELD",
      description: "Weld",
      hours: 2,
    }),
  );
  if (invoiced) {
    ctx.invoice.lines.push(
      InvoiceLine.parse({
        id: "IL-9",
        itemCode: "LAB-WELD",
        description: "Weld",
        kind: "LABOUR",
        qty: 2,
        unitPrice: 13_600,
        amount: 27_200,
        sourceRef: { workOrderLineId: "WL-9" },
      }),
    );
  }
}

describe("B1 scope change detector", () => {
  it("finds nothing when all work is quoted or covered by an approved change order", () => {
    // PART-STEM is outside the quote but covered by approved CO-T-1.
    expect(run(buildContext())).toEqual([]);
  });

  it("flags invoiced work outside approved scope and suggests holding it", () => {
    const ctx = buildContext();
    addExtraWork(ctx);
    const [f] = run(ctx);
    expect(f).toMatchObject({
      frictionCode: "B1",
      invoiceLineId: "IL-9",
      workOrderLineId: "WL-9",
      suggestion: { action: "REQUEST_CHANGE_ORDER", amountDelta: -27_200 },
    });
    expect(f?.message).toContain("no change order exists");
    Finding.parse({ ...f, id: "F-1", route: null, status: "OPEN" });
  });

  it("does not accept a pending change order as approval, but cites it", () => {
    const ctx = buildContext();
    addExtraWork(ctx);
    ctx.changeOrders.push(
      ChangeOrder.parse({
        id: "CO-T-2",
        jobId: "JOB-T",
        status: "PENDING",
        approver: null,
        approvedDate: null,
        reason: "Weld overlay",
        lines: [{ itemCode: "LAB-WELD", description: "Weld", kind: "LABOUR", qty: 2 }],
      }),
    );
    const [f] = run(ctx);
    expect(f?.evidence).toContainEqual({ kind: "CHANGE_ORDER", id: "CO-T-2" });
    expect(f?.message).toContain("CO-T-2 is PENDING");
  });

  it("flags uninvoiced extra work with no amount to hold", () => {
    const ctx = buildContext();
    addExtraWork(ctx, false);
    const [f] = run(ctx);
    expect(f?.invoiceLineId).toBeNull();
    expect(f?.suggestion.amountDelta).toBe(0);
  });

  it("flags a part whose change order was revoked (no longer approved)", () => {
    const ctx = buildContext();
    ctx.changeOrders = [];
    expect(run(ctx).map((f) => f.workOrderLineId)).toEqual(["WL-4"]);
  });
});
