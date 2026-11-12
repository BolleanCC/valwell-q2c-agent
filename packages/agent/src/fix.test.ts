import { fromCents, InvoiceLine, WorkOrderLine } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import { applyFindings } from "./fix.js";
import { runPipeline } from "./pipeline.js";
import { buildContext } from "./testing/build-context.js";

/** Context with a stale A1 labour price and a B1 extra weld line. */
function faulted() {
  const ctx = buildContext();
  const labour = ctx.invoice.lines.find((l) => l.id === "IL-2");
  if (!labour) throw new Error("IL-2");
  labour.unitPrice = fromCents(9_000);
  labour.amount = fromCents(54_000);
  delete labour.sourceRef;
  ctx.workOrder.lines.push(
    WorkOrderLine.parse({
      id: "WL-9",
      kind: "LABOUR",
      itemCode: "LAB-WELD",
      description: "W",
      hours: 1,
    }),
  );
  ctx.invoice.lines.push(
    InvoiceLine.parse({
      id: "IL-9",
      itemCode: "LAB-WELD",
      description: "W",
      kind: "LABOUR",
      qty: 1,
      unitPrice: 13_600,
      amount: 13_600,
    }),
  );
  return { ctx, findings: runPipeline([ctx]) };
}

describe("applyFindings", () => {
  it("reprices with lineage and holds unapproved scope", () => {
    const { ctx, findings } = faulted();
    const result = applyFindings(ctx.invoice, findings);
    const labour = result.invoice?.lines.find((l) => l.id === "IL-2");
    expect(labour).toMatchObject({ unitPrice: 9_500, amount: 57_000 });
    expect(labour?.sourceRef).toEqual({
      workOrderLineId: "WL-2",
      priceBookItemId: "PB-LAB-TECH-v2",
    });
    expect(result.held.map((l) => l.id)).toEqual(["IL-9"]);
    expect(result.invoice?.lines.map((l) => l.id)).not.toContain("IL-9");
    expect(result.applied).toHaveLength(2);
  });

  it("applies only the requested routes and skips rejected findings", () => {
    const { ctx, findings } = faulted();
    const autoOnly = applyFindings(ctx.invoice, findings, ["AUTO_FIX"]);
    expect(autoOnly.held).toEqual([]);
    expect(autoOnly.applied.map((f) => f.frictionCode)).toEqual(["A1"]);

    const rejected = findings.map((f) => ({ ...f, status: "REJECTED" as const }));
    expect(applyFindings(ctx.invoice, rejected).applied).toEqual([]);
  });

  it("does not mutate the source invoice", () => {
    const { ctx, findings } = faulted();
    const before = structuredClone(ctx.invoice);
    applyFindings(ctx.invoice, findings);
    expect(ctx.invoice).toEqual(before);
  });
});
