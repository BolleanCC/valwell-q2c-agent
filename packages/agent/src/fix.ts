import {
  add,
  type Finding,
  fromCents,
  Invoice,
  type InvoiceLine,
  invoiceTotal,
  type Money,
  multiplyQty,
  type Route,
  SourceRef,
} from "@valwell/domain";

/** An actual change to one submitted line (not a proposal). */
export interface LineChange {
  invoiceLineId: string;
  before: { unitPrice: Money; amount: Money };
  after: { unitPrice: Money; amount: Money };
  findingIds: string[];
}

/**
 * Totals of one draft. They always reconcile:
 * original = draft + held − corrections.
 */
export interface DraftTotals {
  /** Sum of the original invoice lines. */
  original: Money;
  /** Original amounts of held lines: not submitted, not approved, not paid. */
  held: Money;
  /** Sum of the draft lines that would be submitted. */
  draft: Money;
  /** Net actual price corrections on submitted lines: draft − (original − held). */
  corrections: Money;
}

export interface FixResult {
  /** The corrected draft, or null when every line is held. */
  invoice: Invoice | null;
  /** Held lines exactly as originally billed, until a change order is approved. */
  held: InvoiceLine[];
  /** Actual line changes in the draft. */
  changes: LineChange[];
  /** Findings that changed the draft (a hold or an effective reprice). */
  applied: Finding[];
  totals: DraftTotals;
}

const ALL_ROUTES: readonly Route[] = ["AUTO_FIX", "REVIEW", "BLOCK"];

const isHold = (f: Finding) =>
  f.suggestion.action === "REQUEST_CHANGE_ORDER" || f.suggestion.action === "REMOVE_LINE";

/**
 * Draft a corrected invoice from findings. Pure; the source invoice is not
 * changed.
 *
 * - A line with any hold finding is held as originally billed. Holding takes
 *   precedence: a reprice finding on the same line is not applied, so its
 *   amount is never counted twice.
 * - Other lines are repriced to the contract-backed unit price when every
 *   reprice finding for the line agrees on it, with sourceRef lineage to the
 *   evidence. A line already at that price is not a change.
 *
 * Rejected findings are ignored; `routes` limits which routes are applied.
 */
export function applyFindings(
  invoice: Invoice,
  findings: readonly Finding[],
  routes: readonly Route[] = ALL_ROUTES,
): FixResult {
  const relevant = findings.filter(
    (f) =>
      f.invoiceId === invoice.id &&
      f.invoiceLineId !== null &&
      f.status !== "REJECTED" &&
      f.route !== null &&
      routes.includes(f.route),
  );
  const forLine = (line: InvoiceLine) => relevant.filter((f) => f.invoiceLineId === line.id);

  const held: InvoiceLine[] = [];
  const draftLines: InvoiceLine[] = [];
  const changes: LineChange[] = [];
  const applied: Finding[] = [];
  for (const original of invoice.lines) {
    const line = structuredClone(original);
    const lineFindings = forLine(line);
    const holds = lineFindings.filter(isHold);
    if (holds.length > 0) {
      held.push(line);
      applied.push(...holds);
      continue;
    }
    const reprices = lineFindings.filter((f) => f.suggestion.expectedUnitPrice !== undefined);
    const targets = new Set(reprices.map((f) => f.suggestion.expectedUnitPrice));
    const [target] = targets;
    // No reprice, or findings disagreeing on the price: leave the line as billed.
    if (targets.size !== 1 || target === undefined) {
      draftLines.push(line);
      continue;
    }
    const amount = multiplyQty(target, line.qty);
    if (target === line.unitPrice && amount === line.amount) {
      draftLines.push(line); // already correct: nothing to change or count
      continue;
    }
    changes.push({
      invoiceLineId: line.id,
      before: { unitPrice: line.unitPrice, amount: line.amount },
      after: { unitPrice: target, amount },
      findingIds: reprices.map((f) => f.id),
    });
    line.unitPrice = target;
    line.amount = amount;
    for (const f of reprices) line.sourceRef = lineageFrom(line.sourceRef, f);
    applied.push(...reprices);
    draftLines.push(line);
  }

  const original = invoiceTotal(invoice);
  const heldTotal = add(...held.map((l) => l.amount));
  const draftTotal = add(...draftLines.map((l) => l.amount));
  return {
    invoice: draftLines.length > 0 ? Invoice.parse({ ...invoice, lines: draftLines }) : null,
    held,
    changes,
    applied,
    totals: {
      original,
      held: heldTotal,
      draft: draftTotal,
      corrections: fromCents(draftTotal - (original - heldTotal)),
    },
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
