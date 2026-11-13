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
import type { ReviewIssue } from "../review.js";

/** One item code across every document of a job. */
export interface AlignmentRow {
  itemCode: string;
  kind: LineKind;
  /** Lines from the effective (highest) revision of each quote. */
  quoteLines: QuoteLine[];
  /** Lines from APPROVED change orders only. */
  approvedChangeOrderLines: { changeOrderId: string; line: ChangeOrderLine }[];
  /** Change orders for this item that are not approved (pending or rejected). */
  unapprovedChangeOrders: { changeOrderId: string; status: ChangeOrderStatus }[];
  workOrderLines: WorkOrderLine[];
  invoiceLines: InvoiceLine[];
}

/** The work-order line an invoice line bills, or null when it could not be resolved safely. */
export interface LineMatch {
  invoiceLine: InvoiceLine;
  workOrderLine: WorkOrderLine | null;
}

export interface Alignment {
  rows: AlignmentRow[];
  /** One entry per invoice line, in invoice order. */
  matches: LineMatch[];
  /** Why a line could not be matched; any issue sends the invoice to human review. */
  issues: ReviewIssue[];
}

/** True when the item is covered by an effective quote revision or an approved change order. */
export const isApprovedScope = (row: AlignmentRow): boolean =>
  row.quoteLines.length > 0 || row.approvedChangeOrderLines.length > 0;

/** Rows per item code, in first-seen order: quotes, change orders, work order, invoice. */
function buildRows(ctx: JobContext): AlignmentRow[] {
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

/**
 * Match each invoice line to the work-order line it bills.
 *
 * 1. An explicit `sourceRef.workOrderLineId` wins. If it points to a missing
 *    line or a different item, the line is unresolved: no silent fallback.
 * 2. Without a reference, the item code is used only when exactly one
 *    work-order line has that code. Zero or several candidates are unresolved.
 * 3. The matched lines must be the same kind (service, labour or part), and a
 *    work-order line may be billed by only one invoice line.
 *
 * The other sourceRef ids must exist too; a quote line must belong to the
 * effective quote revision. No fuzzy matching: unresolved means human review.
 */
export function align(ctx: JobContext): Alignment {
  const issues: ReviewIssue[] = [];
  const issue = (code: ReviewIssue["code"], line: InvoiceLine, message: string) =>
    issues.push({
      code,
      invoiceLineId: line.id,
      message: `${line.id} (${line.itemCode}): ${message}`,
    });

  const woById = new Map<string, WorkOrderLine>(ctx.workOrder.lines.map((w) => [w.id, w]));
  const effectiveQuoteLines = new Set<string>(
    latestRevisions(ctx.quotes).flatMap((q) => q.lines.map((l) => l.id)),
  );
  const changeOrderIds = new Set<string>(ctx.changeOrders.map((c) => c.id));
  const priceBookIds = new Set<string>(ctx.priceBook.map((p) => p.id));

  const matches: LineMatch[] = ctx.invoice.lines.map((line) => {
    const ref = line.sourceRef;
    if (ref?.quoteLineId && !effectiveQuoteLines.has(ref.quoteLineId))
      issue(
        "INVALID_SOURCE_REF",
        line,
        `quote line ${ref.quoteLineId} is not in the effective quote revision`,
      );
    if (ref?.changeOrderId && !changeOrderIds.has(ref.changeOrderId))
      issue(
        "INVALID_SOURCE_REF",
        line,
        `change order ${ref.changeOrderId} does not exist for this job`,
      );
    if (ref?.priceBookItemId && !priceBookIds.has(ref.priceBookItemId))
      issue("INVALID_SOURCE_REF", line, `price-book item ${ref.priceBookItemId} does not exist`);

    let wo: WorkOrderLine | undefined;
    if (ref?.workOrderLineId) {
      wo = woById.get(ref.workOrderLineId);
      if (!wo) {
        issue(
          "INVALID_SOURCE_REF",
          line,
          `work-order line ${ref.workOrderLineId} is not on ${ctx.workOrder.id}`,
        );
        return { invoiceLine: line, workOrderLine: null };
      }
      if (wo.itemCode !== line.itemCode) {
        issue("INVALID_SOURCE_REF", line, `references ${wo.id}, which records ${wo.itemCode}`);
        return { invoiceLine: line, workOrderLine: null };
      }
    } else {
      const candidates = ctx.workOrder.lines.filter((w) => w.itemCode === line.itemCode);
      if (candidates.length === 0) {
        issue("NO_WORK_RECORD", line, "no work-order line records this item");
        return { invoiceLine: line, workOrderLine: null };
      }
      if (candidates.length > 1) {
        const ids = candidates.map((w) => w.id).join(", ");
        issue(
          "AMBIGUOUS_MATCH",
          line,
          `several work-order lines record this item (${ids}) and no source reference says which is billed`,
        );
        return { invoiceLine: line, workOrderLine: null };
      }
      wo = candidates[0];
    }
    if (!wo) return { invoiceLine: line, workOrderLine: null };
    if (wo.kind !== line.kind) {
      issue("KIND_MISMATCH", line, `billed as ${line.kind} but ${wo.id} records ${wo.kind}`);
      return { invoiceLine: line, workOrderLine: null };
    }
    return { invoiceLine: line, workOrderLine: wo };
  });

  // A work-order line billed twice is duplicate or cumulative billing: not supported, so unresolved.
  const byWorkLine = Map.groupBy(
    matches.filter((m) => m.workOrderLine !== null),
    (m) => m.workOrderLine?.id,
  );
  for (const [woId, group] of byWorkLine) {
    if (group.length < 2) continue;
    const lineIds = group.map((m) => m.invoiceLine.id).join(", ");
    for (const m of group) {
      issue(
        "DUPLICATE_BILLING",
        m.invoiceLine,
        `${woId} is billed by several invoice lines (${lineIds})`,
      );
      m.workOrderLine = null;
    }
  }
  return { rows: buildRows(ctx), matches, issues };
}
