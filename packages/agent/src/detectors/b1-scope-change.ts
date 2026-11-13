import { type EvidenceRef, format, fromCents } from "@valwell/domain";
import { isApprovedScope } from "../nodes/align.js";
import type { Detector, FindingDraft } from "./types.js";

/**
 * B1: work performed (on the work order) for an item that is in neither the
 * binding quote nor any APPROVED change order. Pending or rejected change
 * orders are cited but do not make the work billable. If the work was
 * invoiced, the suggestion holds that line until a change order is approved.
 */
export const b1ScopeChange: Detector = {
  code: "B1",
  detect(ctx, alignment) {
    const findings: FindingDraft[] = [];
    for (const row of alignment.rows) {
      if (isApprovedScope(row)) continue;
      for (const wo of row.workOrderLines) {
        // Only the invoice line the alignment matched to this work; never "the first one".
        const invoiced = alignment.matches.find((m) => m.workOrderLine?.id === wo.id)?.invoiceLine;
        const evidence: EvidenceRef[] = [
          { kind: "WORK_ORDER_LINE", id: wo.id },
          ...(invoiced ? [{ kind: "INVOICE_LINE" as const, id: invoiced.id }] : []),
          ...row.unapprovedChangeOrders.map((c) => ({
            kind: "CHANGE_ORDER" as const,
            id: c.changeOrderId,
          })),
        ];
        const coNote =
          row.unapprovedChangeOrders.length > 0
            ? `change order ${row.unapprovedChangeOrders.map((c) => `${c.changeOrderId} is ${c.status}`).join(", ")}`
            : "no change order exists";
        const billed = invoiced ? `billed ${format(invoiced.amount)}` : "not yet invoiced";
        findings.push({
          jobId: ctx.job.id,
          invoiceId: ctx.invoice.id,
          frictionCode: "B1",
          invoiceLineId: invoiced?.id ?? null,
          workOrderLineId: wo.id,
          message: `${wo.itemCode} was performed after teardown but is not in the quote; ${coNote}; ${billed}`,
          evidence,
          suggestion: {
            action: "REQUEST_CHANGE_ORDER",
            summary: invoiced
              ? `Hold ${wo.itemCode} (${format(invoiced.amount)}) and request customer approval via a change order`
              : `Request a change order for ${wo.itemCode} before invoicing it`,
            amountDelta: fromCents(invoiced ? -invoiced.amount : 0),
          },
          basis: "NO_APPROVED_SCOPE",
          confidence: 0.92,
        });
      }
    }
    return findings;
  },
};
