import { Finding, fromCents, InvoiceLine, WorkOrderLine } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import { acceptAll, applyFindings } from "./fix.js";
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
  return { ctx, findings: runPipeline([ctx]).findings };
}

const COMPLETE = { status: "COMPLETE" } as const;

/** Clean context with a re-keyed TDI fee ($880 vs $840): an A1 finding routed to REVIEW. */
function typo() {
  const ctx = buildContext();
  const fee = ctx.invoice.lines[0];
  if (!fee) throw new Error("IL-1");
  fee.unitPrice = fromCents(88_000);
  fee.amount = fromCents(88_000);
  return { ctx, findings: runPipeline([ctx]).findings };
}

describe("applyFindings", () => {
  it("reprices with lineage and holds unapproved scope", () => {
    const { ctx, findings } = faulted();
    const result = applyFindings(ctx.invoice, findings, COMPLETE);
    const labour = result.invoice?.lines.find((l) => l.id === "IL-2");
    expect(labour).toMatchObject({ unitPrice: 9_500, amount: 57_000 });
    expect(labour?.sourceRef).toEqual({
      workOrderLineId: "WL-2",
      priceBookItemId: "PB-LAB-TECH-v2",
    });
    expect(result.held.map((l) => l.id)).toEqual(["IL-9"]);
    expect(result.invoice?.lines.map((l) => l.id)).not.toContain("IL-9");
    expect(result.applied).toHaveLength(2);
    expect(result.held[0]?.amount).toBe(13_600);
  });

  it("does not apply an OPEN review finding and keeps the draft from being READY", () => {
    const { ctx, findings } = typo();
    expect(findings.map((f) => [f.route, f.status])).toEqual([["REVIEW", "OPEN"]]);
    const open = applyFindings(ctx.invoice, findings, COMPLETE);
    expect(open.status).toBe("AWAITING_REVIEW");
    expect(open.changes).toEqual([]);
    expect(open.invoice?.lines[0]?.unitPrice).toBe(88_000);
  });

  it("applies a review finding once a human accepts it", () => {
    const { ctx, findings } = typo();
    const accepted = applyFindings(ctx.invoice, acceptAll(findings), COMPLETE);
    expect(accepted.status).toBe("READY");
    expect(accepted.invoice?.lines[0]).toMatchObject({ unitPrice: 84_000, amount: 84_000 });
    expect(accepted.totals.corrections).toBe(-4_000);
  });

  it("never applies a REJECTED finding", () => {
    const { ctx, findings } = typo();
    const rejected = findings.map((f) => ({ ...f, status: "REJECTED" as const }));
    const result = applyFindings(ctx.invoice, rejected, COMPLETE);
    expect(result).toMatchObject({ status: "READY", applied: [], changes: [] });

    const all = faulted();
    const none = all.findings.map((f) => ({ ...f, status: "REJECTED" as const }));
    expect(applyFindings(all.ctx.invoice, none, COMPLETE).held).toEqual([]);
  });

  it("keeps an accepted scope finding held: accepting the hold is not customer approval", () => {
    const { ctx, findings } = faulted();
    const result = applyFindings(ctx.invoice, acceptAll(findings), COMPLETE);
    expect(result.held.map((l) => l.id)).toEqual(["IL-9"]);
  });

  it("produces no draft when the job review is not complete", () => {
    const { ctx, findings } = faulted();
    for (const status of ["NEEDS_REVIEW", "INCOMPLETE"] as const) {
      const result = applyFindings(ctx.invoice, acceptAll(findings), { status });
      expect(result).toMatchObject({ status: "INPUT_NEEDS_REVIEW", invoice: null, held: [] });
      expect(result.totals).toEqual({ original: 239_600, held: 0, draft: 239_600, corrections: 0 });
    }
  });

  it("changes nothing when applied again to its own draft", () => {
    const { ctx, findings } = faulted();
    const first = applyFindings(ctx.invoice, findings, COMPLETE);
    if (!first.invoice) throw new Error("no draft");
    const again = applyFindings(first.invoice, findings, COMPLETE);
    expect(again).toMatchObject({ status: "READY", changes: [], held: [], applied: [] });
    expect(again.invoice).toEqual(first.invoice);
    expect(again.totals).toEqual({ original: 229_000, held: 0, draft: 229_000, corrections: 0 });
  });

  it("reports totals that reconcile: original = draft + held − corrections", () => {
    const { ctx, findings } = faulted();
    const { totals, changes } = applyFindings(ctx.invoice, findings, COMPLETE);
    // Original: 840 + 540 + 440 + 440 + 136 = $2,396.00; IL-2 +$30.00; IL-9 $136.00 held.
    expect(totals).toEqual({ original: 239_600, held: 13_600, draft: 229_000, corrections: 3_000 });
    expect(changes).toEqual([
      {
        invoiceLineId: "IL-2",
        before: { unitPrice: 9_000, amount: 54_000 },
        after: { unitPrice: 9_500, amount: 57_000 },
        findingIds: ["F-0001"],
      },
    ]);
  });

  it("holds a line with both markup and scope findings once, as originally billed", () => {
    const { ctx } = faulted();
    const seat = ctx.invoice.lines.find((l) => l.id === "IL-3");
    if (!seat) throw new Error("IL-3");
    const base = {
      jobId: "JOB-T",
      invoiceId: "INV-T",
      invoiceLineId: "IL-3",
      workOrderLineId: "WL-3",
      confidence: 1,
      status: "OPEN",
    };
    const markup = Finding.parse({
      ...base,
      id: "F-A3",
      frictionCode: "A3",
      message: "over cap",
      evidence: [{ kind: "RULE", id: "RULE-T" }],
      suggestion: {
        action: "REPRICE_LINE",
        summary: "cap",
        expectedUnitPrice: 20_000,
        amountDelta: -4_000,
      },
      route: "AUTO_FIX",
    });
    const scope = Finding.parse({
      ...base,
      id: "F-B1",
      frictionCode: "B1",
      message: "no CO",
      evidence: [{ kind: "WORK_ORDER_LINE", id: "WL-3" }],
      suggestion: { action: "REQUEST_CHANGE_ORDER", summary: "hold", amountDelta: -44_000 },
      route: "BLOCK",
    });
    const result = applyFindings(ctx.invoice, [markup, scope], COMPLETE);
    expect(result.held).toEqual([seat]); // original price, not the cap price
    expect(result.changes).toEqual([]);
    expect(result.applied.map((f) => f.id)).toEqual(["F-B1"]);
    expect(result.totals.held).toBe(44_000);
    expect(result.totals.corrections).toBe(0);
  });

  it("does not mutate the source invoice", () => {
    const { ctx, findings } = faulted();
    const before = structuredClone(ctx.invoice);
    applyFindings(ctx.invoice, findings, COMPLETE);
    expect(ctx.invoice).toEqual(before);
  });
});
