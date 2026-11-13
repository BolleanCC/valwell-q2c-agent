import { z } from "zod";
import { Money } from "./money.js";
import {
  CustomerId,
  IsoDate,
  ItemCode,
  JobId,
  LineKind,
  Quantity,
  QuoteId,
  QuoteLineId,
} from "./primitives.js";

/** Remanufacturing is quoted in two stages: teardown & inspection, then the repair. */
export const QuoteStage = z.enum(["TDI", "REPAIR"]);
export type QuoteStage = z.infer<typeof QuoteStage>;

export const QuoteLine = z.object({
  id: QuoteLineId,
  itemCode: ItemCode,
  description: z.string().min(1),
  kind: LineKind,
  qty: Quantity,
  unitPrice: Money,
});
export type QuoteLine = z.infer<typeof QuoteLine>;

/**
 * One immutable revision of a quote. A revised quote keeps its `id` and gets
 * the next `revision`; the highest revision of each stage is the binding one.
 */
export const Quote = z
  .object({
    id: QuoteId,
    revision: z.int().positive(),
    jobId: JobId,
    customerId: CustomerId,
    stage: QuoteStage,
    /** Price-book version used to price services and labour on this revision. */
    priceBookVersion: z.int().positive(),
    issuedDate: IsoDate,
    lines: z.array(QuoteLine).min(1),
  })
  .refine((q) => new Set(q.lines.map((l) => l.id)).size === q.lines.length, {
    message: "quote line ids must be unique",
    path: ["lines"],
  });
export type Quote = z.infer<typeof Quote>;

/**
 * The effective revision of each quote id: the highest revision number.
 * This is the one approval rule shared by the agent and the portal. Earlier
 * revisions are history and authorise nothing, so an item or quantity
 * removed in a later revision is no longer approved scope.
 */
export function latestRevisions(quotes: readonly Quote[]): Quote[] {
  const latest = new Map<string, Quote>();
  for (const q of quotes) {
    const current = latest.get(q.id);
    if (!current || q.revision > current.revision) latest.set(q.id, q);
  }
  return [...latest.values()];
}
