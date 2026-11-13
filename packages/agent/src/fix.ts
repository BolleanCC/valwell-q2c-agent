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
import type { JobReview } from "./review.js";

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

/**
 * READY: the draft may go to the simulated portal.
 * AWAITING_REVIEW: a REVIEW finding is still OPEN; a human must accept or reject it.
 * ALL_LINES_HELD: every line is held, so there is nothing to submit.
 * INPUT_NEEDS_REVIEW: the job's review is not COMPLETE (missing, ambiguous or
 *   contradictory input), so no draft is produced at all.
 */
export type DraftStatus = "READY" | "AWAITING_REVIEW" | "ALL_LINES_HELD" | "INPUT_NEEDS_REVIEW";

export interface FixResult {
  status: DraftStatus;
  /** The corrected draft; null when every line is held or no draft may be produced. */
  invoice: Invoice | null;
  /** Held lines exactly as originally billed, until a change order is approved. */
  held: InvoiceLine[];
  /** Actual line changes in the draft. */
  changes: LineChange[];
  /** Findings that changed the draft (a hold or an effective reprice). */
  applied: Finding[];
  totals: DraftTotals;
}

/** Routes the agent acts on without a human: price fixes it can prove, and holds. */
const UNATTENDED_ROUTES: readonly Route[] = ["AUTO_FIX", "BLOCK"];

/**
 * Whether a finding's action may change the draft. REJECTED: never. ACCEPTED
 * by a human: yes. OPEN: only on an unattended route; an OPEN REVIEW finding
 * is not treated as accepted. Accepting a B1 finding accepts holding the
 * line; it is not the customer's approval of the extra scope.
 */
export function isActionable(f: Finding): boolean {
  if (f.status === "REJECTED") return false;
  if (f.status === "ACCEPTED") return true;
  return f.route !== null && UNATTENDED_ROUTES.includes(f.route);
}

/** Simulated reviewer who accepts every OPEN finding (used by the evaluation and demo). */
export const acceptAll = (findings: readonly Finding[]): Finding[] =>
  findings.map((f) => (f.status === "OPEN" ? { ...f, status: "ACCEPTED" } : f));

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
 * Only actionable findings are applied (see isActionable). Applying the same
 * findings to the resulting draft changes nothing: corrected lines are
 * already at their price and held lines are no longer on the draft.
 */
export function applyFindings(
  invoice: Invoice,
  findings: readonly Finding[],
  review: Pick<JobReview, "status">,
): FixResult {
  const original = invoiceTotal(invoice);
  if (review.status !== "COMPLETE") {
    const unchanged = { original, held: fromCents(0), draft: original, corrections: fromCents(0) };
    return {
      status: "INPUT_NEEDS_REVIEW",
      invoice: null,
      held: [],
      changes: [],
      applied: [],
      totals: unchanged,
    };
  }
  const lineIds = new Set<string>(invoice.lines.map((l) => l.id));
  const onInvoice = findings.filter(
    (f) => f.invoiceId === invoice.id && f.invoiceLineId !== null && lineIds.has(f.invoiceLineId),
  );
  const relevant = onInvoice.filter(isActionable);
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

  const awaitingReview = onInvoice.some((f) => f.status === "OPEN" && !isActionable(f));
  const status: DraftStatus =
    draftLines.length === 0 ? "ALL_LINES_HELD" : awaitingReview ? "AWAITING_REVIEW" : "READY";
  const heldTotal = add(...held.map((l) => l.amount));
  const draftTotal = add(...draftLines.map((l) => l.amount));
  return {
    status,
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
