import {
  type Finding,
  Invoice,
  type InvoiceLine,
  multiplyQty,
  type Route,
  SourceRef,
} from "@valwell/domain";

export interface FixResult {
  /** The corrected draft, or null when every line is held. */
  invoice: Invoice | null;
  /** Lines removed until a change order is approved. */
  held: InvoiceLine[];
  /** Findings that were applied. */
  applied: Finding[];
}

const ALL_ROUTES: readonly Route[] = ["AUTO_FIX", "REVIEW", "BLOCK"];

/**
 * Draft a corrected invoice from findings: reprice lines to the
 * contract-backed price and hold lines that need a change order. Every
 * repriced line carries sourceRef lineage to the evidence it was fixed from.
 * Rejected findings are ignored; `routes` limits which routes are applied
 * (default: all, i.e. a reviewer accepted every suggestion).
 */
export function applyFindings(
  invoice: Invoice,
  findings: readonly Finding[],
  routes: readonly Route[] = ALL_ROUTES,
): FixResult {
  const draft = structuredClone(invoice);
  const held: InvoiceLine[] = [];
  const applied: Finding[] = [];
  const relevant = findings.filter(
    (f) =>
      f.invoiceId === invoice.id &&
      f.invoiceLineId !== null &&
      f.status !== "REJECTED" &&
      f.route !== null &&
      routes.includes(f.route),
  );

  for (const f of relevant) {
    const index = draft.lines.findIndex((l) => l.id === f.invoiceLineId);
    const line = draft.lines[index];
    if (!line) continue;
    if (f.suggestion.action === "REQUEST_CHANGE_ORDER" || f.suggestion.action === "REMOVE_LINE") {
      held.push(line);
      draft.lines.splice(index, 1);
      applied.push(f);
    } else if (f.suggestion.expectedUnitPrice !== undefined) {
      line.unitPrice = f.suggestion.expectedUnitPrice;
      line.amount = multiplyQty(line.unitPrice, line.qty);
      line.sourceRef = lineageFrom(line.sourceRef, f);
      applied.push(f);
    }
  }

  return {
    invoice: draft.lines.length > 0 ? Invoice.parse(draft) : null,
    held,
    applied,
  };
}

/** Merge existing lineage with the source documents cited by the finding. */
function lineageFrom(existing: SourceRef | undefined, f: Finding): SourceRef {
  const ref: Record<string, string | undefined> = { ...existing };
  if (f.workOrderLineId) ref.workOrderLineId = f.workOrderLineId;
  // The first price-book item cited is the effective one the price came from.
  const pb = f.evidence.find((e) => e.kind === "PRICE_BOOK_ITEM");
  if (pb) ref.priceBookItemId = pb.id;
  else delete ref.priceBookItemId;
  return SourceRef.parse(Object.fromEntries(Object.entries(ref).filter(([, v]) => v)));
}
