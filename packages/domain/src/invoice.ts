import { z } from "zod";
import { add, Money } from "./money.js";
import {
  ChangeOrderId,
  CustomerId,
  InvoiceId,
  InvoiceLineId,
  IsoDate,
  ItemCode,
  JobId,
  LineKind,
  PriceBookItemId,
  Quantity,
  QuoteLineId,
  WorkOrderLineId,
} from "./primitives.js";

/** Where an invoice line's item, quantity and price came from. At least one reference is required. */
export const SourceRef = z
  .object({
    quoteLineId: QuoteLineId.optional(),
    workOrderLineId: WorkOrderLineId.optional(),
    priceBookItemId: PriceBookItemId.optional(),
    changeOrderId: ChangeOrderId.optional(),
  })
  .refine((s) => Object.values(s).some((v) => v !== undefined), {
    message: "sourceRef needs at least one reference",
  });
export type SourceRef = z.infer<typeof SourceRef>;

export const InvoiceLine = z.object({
  id: InvoiceLineId,
  itemCode: ItemCode,
  description: z.string().min(1),
  kind: LineKind,
  qty: Quantity,
  unitPrice: Money,
  /** qty × unitPrice as billed (not validated here: a mismatch is itself a finding). */
  amount: Money,
  /** Unit cost backing a cost-plus part line, as shown to the customer. */
  unitCost: Money.optional(),
  /**
   * Lineage to source documents. Optional because the billing system's lines
   * are re-keyed by hand; every line the agent drafts must set it.
   */
  sourceRef: SourceRef.optional(),
});
export type InvoiceLine = z.infer<typeof InvoiceLine>;

export const Invoice = z
  .object({
    id: InvoiceId,
    jobId: JobId,
    customerId: CustomerId,
    poNumber: z.string().min(1),
    invoiceDate: IsoDate,
    serviceDate: IsoDate,
    lines: z.array(InvoiceLine).min(1),
  })
  .refine((i) => new Set(i.lines.map((l) => l.id)).size === i.lines.length, {
    message: "invoice line ids must be unique",
    path: ["lines"],
  });
export type Invoice = z.infer<typeof Invoice>;

/** Sum of the billed line amounts. */
export function invoiceTotal(invoice: Invoice): Money {
  return add(...invoice.lines.map((l) => l.amount));
}
