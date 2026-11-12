import { z } from "zod";
import { Money } from "./money.js";
import {
  FaultLabelId,
  FindingId,
  InvoiceId,
  InvoiceLineId,
  JobId,
  WorkOrderLineId,
} from "./primitives.js";

/**
 * Friction codes in scope. Adding a friction means adding its code here plus
 * one injector, one detector and their tests.
 */
export const FrictionCode = z.enum(["A1", "A3", "B1"]);
export type FrictionCode = z.infer<typeof FrictionCode>;

export const FRICTION_DESCRIPTIONS: Record<FrictionCode, string> = {
  A1: "Stale or mistyped price: invoice price differs from the price book effective on the service date",
  A3: "Markup cap violation: part billed above cost × (1 + customer markup cap)",
  B1: "Scope change without an approved change order",
};

export const EvidenceKind = z.enum([
  "QUOTE_LINE",
  "WORK_ORDER_LINE",
  "PRICE_BOOK_ITEM",
  "CHANGE_ORDER",
  "RULE",
  "INVOICE_LINE",
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const EvidenceRef = z.object({ kind: EvidenceKind, id: z.string().min(1) });
export type EvidenceRef = z.infer<typeof EvidenceRef>;

export const SuggestedAction = z.enum(["REPRICE_LINE", "REMOVE_LINE", "REQUEST_CHANGE_ORDER"]);
export type SuggestedAction = z.infer<typeof SuggestedAction>;

export const Suggestion = z.object({
  action: SuggestedAction,
  summary: z.string().min(1),
  /** For REPRICE_LINE: the unit price the line should carry. */
  expectedUnitPrice: Money.optional(),
  /** Change to the invoice total if the suggestion is applied (negative = reduce). */
  amountDelta: Money,
});
export type Suggestion = z.infer<typeof Suggestion>;

export const Route = z.enum(["AUTO_FIX", "REVIEW", "BLOCK"]);
export type Route = z.infer<typeof Route>;

export const FindingStatus = z.enum(["OPEN", "ACCEPTED", "REJECTED"]);
export type FindingStatus = z.infer<typeof FindingStatus>;

/** A discrepancy the agent detected, always backed by source evidence. */
export const Finding = z.object({
  id: FindingId,
  jobId: JobId,
  invoiceId: InvoiceId,
  frictionCode: FrictionCode,
  invoiceLineId: InvoiceLineId.nullable(),
  workOrderLineId: WorkOrderLineId.nullable(),
  message: z.string().min(1),
  /** Must cite at least one source document, not only the invoice line itself. */
  evidence: z.array(EvidenceRef).refine((refs) => refs.some((r) => r.kind !== "INVOICE_LINE"), {
    message: "evidence must cite at least one source (quote, work order, price book, CO or rule)",
  }),
  suggestion: Suggestion,
  confidence: z.number().min(0).max(1),
  /** Set by the route node; null until routed. */
  route: Route.nullable(),
  /** Human review outcome. */
  status: FindingStatus,
});
export type Finding = z.infer<typeof Finding>;

/** Ground truth for one injected fault. Only the evaluation harness may read these. */
export const FaultLabel = z.object({
  id: FaultLabelId,
  jobId: JobId,
  invoiceId: InvoiceId,
  frictionCode: FrictionCode,
  invoiceLineId: InvoiceLineId.nullable(),
  workOrderLineId: WorkOrderLineId.nullable(),
  description: z.string().min(1),
  /** Amount over-billed because of the fault (billed − correct). */
  amountImpact: Money,
});
export type FaultLabel = z.infer<typeof FaultLabel>;
