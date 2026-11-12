import {
  applyMarkupBps,
  ChangeOrder,
  format,
  fromDollars,
  InvoiceLine,
  type Money,
  multiplyQty,
  WorkOrderLine,
} from "@valwell/domain";
import { LABOUR, PARTS } from "../catalogue.js";
import { addDays } from "../dates.js";
import type { Injector } from "../inject.js";
import { priceOn } from "../job.js";

/**
 * B1: after teardown the shop does extra work — a part or a labour item that
 * is in neither the quote nor any approved change order — and bills it. In
 * some jobs a change order exists but is still PENDING or was REJECTED.
 * The extra line is priced correctly, so B1 is the only fault it carries.
 */
export const b1ScopeChange: Injector = {
  code: "B1",
  inject({ rng, ref, bundle }) {
    const { job, quotes, workOrder, invoice, changeOrders } = bundle;
    const covered = new Set([
      ...quotes.flatMap((q) => q.lines.map((l) => l.itemCode as string)),
      ...changeOrders.flatMap((c) => c.lines.map((l) => l.itemCode as string)),
    ]);
    const options = [...PARTS, ...LABOUR].filter((e) => !covered.has(e.itemCode));
    if (options.length === 0) return null;
    const extra = rng.pick(options);

    const woLineId = `${workOrder.id}-L${workOrder.lines.length + 1}`;
    const base = { id: woLineId, itemCode: extra.itemCode, description: extra.description };
    let qty: number;
    let unitPrice: Money;
    let woLine: WorkOrderLine;
    let pricing: { unitCost?: Money; priceBookItemId?: string } = {};
    if (extra.kind === "PART") {
      qty = 1;
      const unitCost = fromDollars(rng.int(extra.dollarRange[0], extra.dollarRange[1]));
      const cap = ref.rules.find((r) => r.customerId === job.customerId)?.markupCapBps ?? 0;
      unitPrice = applyMarkupBps(unitCost, cap);
      woLine = WorkOrderLine.parse({ ...base, kind: "PART", qty, unitCost });
      pricing = { unitCost };
    } else {
      qty = rng.int(2, 8) / 2;
      const pb = priceOn(ref.priceBook, job.customerId, extra.itemCode, job.serviceDate);
      unitPrice = pb.unitPrice;
      woLine = WorkOrderLine.parse({ ...base, kind: "LABOUR", hours: qty });
      pricing = { priceBookItemId: pb.id };
    }
    workOrder.lines.push(woLine);

    const { priceBookItemId, ...rest } = pricing;
    const invLine = InvoiceLine.parse({
      id: `${invoice.id}-L${invoice.lines.length + 1}`,
      itemCode: extra.itemCode,
      description: extra.description,
      kind: extra.kind,
      qty,
      unitPrice,
      amount: multiplyQty(unitPrice, qty),
      ...rest,
      sourceRef: { workOrderLineId: woLineId, ...(priceBookItemId ? { priceBookItemId } : {}) },
    });
    invoice.lines.push(invLine);

    let coNote = "no change order";
    if (rng.chance(0.3)) {
      const status = rng.pick(["PENDING", "REJECTED"] as const);
      changeOrders.push(
        ChangeOrder.parse({
          id: `CO-${job.id.slice(4)}-${changeOrders.length + 1}`,
          jobId: job.id,
          status,
          approver: null,
          approvedDate: null,
          reason: `${extra.description} requested after teardown (${addDays(job.serviceDate, -1)})`,
          lines: [
            { itemCode: extra.itemCode, description: extra.description, kind: extra.kind, qty },
          ],
        }),
      );
      coNote = `change order ${status.toLowerCase()}`;
    }

    return {
      invoiceLineId: invLine.id,
      workOrderLineId: woLineId,
      description: `${extra.itemCode} (${format(invLine.amount)}) performed and billed outside quoted scope; ${coNote}`,
      amountImpact: invLine.amount,
    };
  },
};
