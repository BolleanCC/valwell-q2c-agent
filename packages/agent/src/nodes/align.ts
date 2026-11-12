import {
  type ChangeOrderLine,
  type ChangeOrderStatus,
  type InvoiceLine,
  type LineKind,
  latestRevisions,
  type QuoteLine,
  type WorkOrderLine,
} from "@valwell/domain";
import type { JobContext } from "../adapters/sources.js";

/** One item code across every document of a job. */
export interface AlignmentRow {
  itemCode: string;
  kind: LineKind;
  /** Lines from the binding (latest) revision of each quote. */
  quoteLines: QuoteLine[];
  /** Lines from APPROVED change orders only. */
  approvedChangeOrderLines: { changeOrderId: string; line: ChangeOrderLine }[];
  /** Change orders for this item that are not approved (pending or rejected). */
  unapprovedChangeOrders: { changeOrderId: string; status: ChangeOrderStatus }[];
  workOrderLines: WorkOrderLine[];
  invoiceLines: InvoiceLine[];
}

export type AlignmentTable = AlignmentRow[];

/** True when the item is covered by a quote or an approved change order. */
export const isApprovedScope = (row: AlignmentRow): boolean =>
  row.quoteLines.length > 0 || row.approvedChangeOrderLines.length > 0;

/**
 * Exact item-code alignment of quote ↔ change orders ↔ work order ↔ invoice.
 * Rows appear in first-seen order: quotes, change orders, work order, invoice.
 */
export function align(ctx: JobContext): AlignmentTable {
  const rows = new Map<string, AlignmentRow>();
  const row = (itemCode: string, kind: LineKind): AlignmentRow => {
    let r = rows.get(itemCode);
    if (!r) {
      r = {
        itemCode,
        kind,
        quoteLines: [],
        approvedChangeOrderLines: [],
        unapprovedChangeOrders: [],
        workOrderLines: [],
        invoiceLines: [],
      };
      rows.set(itemCode, r);
    }
    return r;
  };

  for (const quote of latestRevisions(ctx.quotes)) {
    for (const l of quote.lines) row(l.itemCode, l.kind).quoteLines.push(l);
  }
  for (const co of ctx.changeOrders) {
    for (const l of co.lines) {
      const r = row(l.itemCode, l.kind);
      if (co.status === "APPROVED")
        r.approvedChangeOrderLines.push({ changeOrderId: co.id, line: l });
      else r.unapprovedChangeOrders.push({ changeOrderId: co.id, status: co.status });
    }
  }
  for (const l of ctx.workOrder.lines) row(l.itemCode, l.kind).workOrderLines.push(l);
  for (const l of ctx.invoice.lines) row(l.itemCode, l.kind).invoiceLines.push(l);
  return [...rows.values()];
}
