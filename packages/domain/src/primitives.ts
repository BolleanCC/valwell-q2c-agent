import { z } from "zod";

/** A non-empty string ID branded so IDs of different entities cannot be mixed up. */
function id<B extends string>(brand: B) {
  return z.string().trim().min(1).describe(brand).brand<B>();
}

export const CustomerId = id("CustomerId");
export type CustomerId = z.infer<typeof CustomerId>;

/** Catalogue code shared by every system, e.g. `PART-GATE-3IN` or `LAB-TECH`. */
export const ItemCode = id("ItemCode");
export type ItemCode = z.infer<typeof ItemCode>;

export const PriceBookItemId = id("PriceBookItemId");
export type PriceBookItemId = z.infer<typeof PriceBookItemId>;

export const RuleId = id("RuleId");
export type RuleId = z.infer<typeof RuleId>;

export const QuoteId = id("QuoteId");
export type QuoteId = z.infer<typeof QuoteId>;

export const QuoteLineId = id("QuoteLineId");
export type QuoteLineId = z.infer<typeof QuoteLineId>;

export const JobId = id("JobId");
export type JobId = z.infer<typeof JobId>;

export const WorkOrderId = id("WorkOrderId");
export type WorkOrderId = z.infer<typeof WorkOrderId>;

export const WorkOrderLineId = id("WorkOrderLineId");
export type WorkOrderLineId = z.infer<typeof WorkOrderLineId>;

export const ChangeOrderId = id("ChangeOrderId");
export type ChangeOrderId = z.infer<typeof ChangeOrderId>;

export const InvoiceId = id("InvoiceId");
export type InvoiceId = z.infer<typeof InvoiceId>;

export const InvoiceLineId = id("InvoiceLineId");
export type InvoiceLineId = z.infer<typeof InvoiceLineId>;

export const FindingId = id("FindingId");
export type FindingId = z.infer<typeof FindingId>;

export const FaultLabelId = id("FaultLabelId");
export type FaultLabelId = z.infer<typeof FaultLabelId>;

/** Calendar date `YYYY-MM-DD`. Lexicographic order equals chronological order. */
export const IsoDate = z.iso.date();
export type IsoDate = z.infer<typeof IsoDate>;

/** Basis points: 1 bps = 0.01 %, so 1000 bps = 10 %. */
export const BasisPoints = z.int().nonnegative();
export type BasisPoints = z.infer<typeof BasisPoints>;

/** Positive quantity (units or hours) with at most three decimals, matching `multiplyQty`. */
export const Quantity = z
  .number()
  .positive()
  .refine((n) => /^\d+(\.\d{1,3})?$/.test(String(n)), "Quantity allows at most 3 decimals");
export type Quantity = z.infer<typeof Quantity>;

/** What kind of thing a line bills for. Parts are cost-plus; services and labour use the price book. */
export const LineKind = z.enum(["SERVICE", "LABOUR", "PART"]);
export type LineKind = z.infer<typeof LineKind>;
