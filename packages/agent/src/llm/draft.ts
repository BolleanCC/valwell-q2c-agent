import { format, type InvoiceLine, type Money } from "@valwell/domain";
import { z } from "zod";

/**
 * What the model writes for a change-order request. There are deliberately no
 * financial fields: amounts come from deterministic code (see
 * AuthoritativeAmounts) and are inserted when the request is rendered.
 */
export const ChangeOrderDraftContent = z
  .object({
    /** What extra work was done, in plain words. */
    workSummary: z.string().trim().min(1).max(600),
    /** The documented business reason, or null when the records do not document one. */
    businessReason: z.string().trim().min(1).max(600).nullable(),
    /** Ids of the records the draft relies on, as returned by the tools. */
    evidenceIds: z.array(z.string().trim().min(1)).min(1).max(20),
    /** Facts a human must supply before the request can be sent. */
    missingInformation: z.array(z.string().trim().min(1).max(300)).max(10),
    /** Draft message to the customer asking for approval of the extra work. */
    customerRequestText: z.string().trim().min(1).max(1500),
  })
  .strict();
export type ChangeOrderDraftContent = z.infer<typeof ChangeOrderDraftContent>;

/** Kinds of records the tools can return; each comes with a stable id. */
export type EvidenceSource =
  | "JOB"
  | "INVOICE"
  | "WORK_ORDER"
  | "QUOTE"
  | "RULE"
  | "PRICE_BOOK_ITEM"
  | "FINDING"
  | "WORK_ORDER_LINE"
  | "TECHNICIAN_NOTE"
  | "TDI_FINDING"
  | "QUOTE_LINE"
  | "CHANGE_ORDER"
  | "INVOICE_LINE";

/** Only these record kinds can document *why* extra work was needed. */
const REASON_SOURCES: ReadonlySet<EvidenceSource> = new Set(["TECHNICIAN_NOTE", "TDI_FINDING"]);

/** Amounts for the request, taken from the held invoice line by deterministic code. */
export interface AuthoritativeAmounts {
  invoiceLineId: string;
  workOrderLineId: string;
  itemCode: string;
  description: string;
  qty: number;
  unitPrice: Money;
  amount: Money;
}

export function amountsFromHeldLine(
  line: InvoiceLine,
  workOrderLineId: string,
): AuthoritativeAmounts {
  return {
    invoiceLineId: line.id,
    workOrderLineId,
    itemCode: line.itemCode,
    description: line.description,
    qty: line.qty,
    unitPrice: line.unitPrice,
    amount: line.amount,
  };
}

export type DraftValidation =
  | { status: "DRAFTED"; content: ChangeOrderDraftContent }
  | { status: "INSUFFICIENT_EVIDENCE"; content: ChangeOrderDraftContent; problems: string[] }
  | { status: "INVALID_OUTPUT"; problems: string[] };

// Modest keyword checks. They catch obvious overreach; they cannot prove a
// draft is factually right, which is why a human still reviews every draft.
const STATUS_CLAIM = /\b(approved|paid|payment received|submitted|authori[sz]ed|released)\b/i;
export const MONEY = /\$|\b\d+[.,]\d{2}\b|\b(?:CAD|USD|dollars?)\b/i;

/**
 * Validate model output against the evidence the tools actually returned.
 *
 * - The shape must match the schema exactly (no extra fields).
 * - Every evidence id must have come from a successful tool result in this
 *   run, which is scoped to the current job; the held work-order line must
 *   be cited.
 * - The text must not claim approval, submission, payment or release, and
 *   must not contain money: amounts are inserted later from deterministic code.
 * - A business reason must cite a technician note or TDI finding. With no
 *   documented reason, the draft must say what information is missing.
 */
export function validateDraft(
  raw: unknown,
  available: ReadonlyMap<string, EvidenceSource>,
  heldWorkOrderLineId: string,
): DraftValidation {
  const parsed = ChangeOrderDraftContent.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "INVALID_OUTPUT",
      problems: parsed.error.issues.map((i) => `${i.path.join(".") || "draft"}: ${i.message}`),
    };
  }
  const content = parsed.data;
  const problems: string[] = [];
  const unknown = content.evidenceIds.filter((id) => !available.has(id));
  if (unknown.length > 0) {
    problems.push(`evidence not returned by any tool in this run: ${unknown.join(", ")}`);
  }
  if (!content.evidenceIds.includes(heldWorkOrderLineId)) {
    problems.push(`the held work-order line ${heldWorkOrderLineId} is not cited`);
  }
  const texts = [
    content.workSummary,
    content.businessReason ?? "",
    content.customerRequestText,
    ...content.missingInformation,
  ];
  if (texts.some((t) => STATUS_CLAIM.test(t))) {
    problems.push("text claims approval, submission, payment or release");
  }
  if (texts.some((t) => MONEY.test(t))) {
    problems.push("text contains a monetary amount; amounts come from deterministic code");
  }
  if (content.businessReason === null && content.missingInformation.length === 0) {
    problems.push("no business reason and no missing information reported");
  }
  const citesReason = content.evidenceIds.some((id) => {
    const source = available.get(id);
    return source !== undefined && REASON_SOURCES.has(source);
  });
  if (content.businessReason !== null && !citesReason) {
    problems.push("business reason does not cite a technician note or TDI finding");
  }
  if (problems.length > 0) return { status: "INVALID_OUTPUT", problems };

  if (content.businessReason === null) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      content,
      problems: ["the records do not document a business reason"],
    };
  }
  return { status: "DRAFTED", content };
}

/** Render the request for a human reviewer, inserting the authoritative amounts. Pure. */
export function renderChangeOrderRequest(
  content: ChangeOrderDraftContent,
  amounts: AuthoritativeAmounts,
): string[] {
  return [
    "Change-order request — DRAFT for human review (not sent, not approved by the customer)",
    `Item: ${amounts.itemCode} ${amounts.description} (work-order line ${amounts.workOrderLineId}, held invoice line ${amounts.invoiceLineId})`,
    `Amount (from the held invoice line, deterministic): ${amounts.qty} × ${format(amounts.unitPrice)} = ${format(amounts.amount)}`,
    `Work performed: ${content.workSummary}`,
    `Documented reason: ${content.businessReason ?? "not documented in the records"}`,
    `Evidence: ${content.evidenceIds.join(", ")}`,
    ...(content.missingInformation.length > 0
      ? [`Missing information: ${content.missingInformation.join("; ")}`]
      : []),
    `Message to customer (draft): ${content.customerRequestText}`,
  ];
}
