import { format, multiplyQty, workOrderLineQty } from "@valwell/domain";
import { lookupEffectivePrice } from "@valwell/rules";
import type { JobContext } from "../adapters/sources.js";
import type { ReviewIssue } from "../review.js";
import { type Alignment, type AlignmentRow, isApprovedScope } from "./align.js";

/** Quantities have at most 3 decimals; compare and sum them as integer thousandths. */
const milli = (qty: number) => Math.round(qty * 1000);

/** Approved quantity: effective quote revision lines plus approved change-order lines. */
const approvedMilli = (row: AlignmentRow) =>
  row.quoteLines.reduce((sum, l) => sum + milli(l.qty), 0) +
  row.approvedChangeOrderLines.reduce((sum, c) => sum + milli(c.line.qty), 0);

/**
 * Evidence and arithmetic checks that no detector can decide. Each problem is
 * a review issue: the agent will not correct a financial value when the
 * evidence for the correct one is missing or contradictory.
 *
 * - Every line: amount must equal qty × unit price (rounded by `multiplyQty`).
 * - Quantities, for an approved item matched to one work-order line: the
 *   billed quantity must equal the recorded work quantity, and the recorded
 *   quantity must not exceed the approved quantity (effective quote revision
 *   plus approved change orders). An item on several quote, work-order or
 *   invoice lines would need cumulative billing, which is not supported, so it
 *   is flagged. Unapproved items are B1 findings instead.
 * - Part lines (cost-plus): the invoice must disclose the unit cost, and it
 *   must equal the cost on the matched work-order line. A missing or
 *   conflicting cost means the markup cap cannot be applied safely.
 * - Service and labour lines: exactly one price-book version must be
 *   effective on the service date. None and several are different problems,
 *   and both are reported.
 */
export function checkLineEvidence(ctx: JobContext, alignment: Alignment): ReviewIssue[] {
  const { invoice } = ctx;
  const issues: ReviewIssue[] = [];
  for (const { invoiceLine: line, workOrderLine: wo } of alignment.matches) {
    const issue = (code: ReviewIssue["code"], message: string) =>
      issues.push({
        code,
        invoiceLineId: line.id,
        message: `${line.id} (${line.itemCode}): ${message}`,
      });

    const extended = multiplyQty(line.unitPrice, line.qty);
    if (line.amount !== extended) {
      issue(
        "EXTENSION_ERROR",
        `amount ${format(line.amount)} ≠ ${line.qty} × ${format(line.unitPrice)} = ${format(extended)}`,
      );
    }

    const row = alignment.rows.find((r) => r.itemCode === line.itemCode);
    if (wo && row && isApprovedScope(row)) {
      const worked = workOrderLineQty(wo);
      if (
        row.quoteLines.length > 1 ||
        row.workOrderLines.length > 1 ||
        row.invoiceLines.length > 1
      ) {
        issue(
          "UNSUPPORTED_DUPLICATE_LINES",
          "item appears on several quote, work-order or invoice lines; cumulative quantities are not supported",
        );
      } else if (milli(line.qty) !== milli(worked)) {
        issue("QUANTITY_MISMATCH", `billed quantity ${line.qty} ≠ ${worked} recorded on ${wo.id}`);
      } else if (milli(worked) > approvedMilli(row)) {
        issue(
          "QUANTITY_EXCEEDS_APPROVED",
          `${worked} recorded on ${wo.id} but only ${approvedMilli(row) / 1000} approved (quote + approved change orders)`,
        );
      }
    }

    if (line.kind === "PART") {
      if (line.unitCost === undefined) {
        issue("MISSING_COST_EVIDENCE", "part billed without a disclosed unit cost");
      } else if (wo?.kind === "PART" && wo.unitCost !== line.unitCost) {
        issue(
          "COST_CONFLICT",
          `invoice cost ${format(line.unitCost)} differs from ${wo.id} cost ${format(wo.unitCost)}`,
        );
      }
      continue;
    }
    const price = lookupEffectivePrice(
      ctx.priceBook,
      invoice.customerId,
      line.itemCode,
      invoice.serviceDate,
    );
    if (price.status === "NONE") {
      issue("NO_EFFECTIVE_PRICE", `no price-book version is effective on ${invoice.serviceDate}`);
    } else if (price.status === "OVERLAP") {
      const ids = price.items.map((p) => p.id).join(", ");
      issue(
        "OVERLAPPING_PRICES",
        `several price-book versions are effective on ${invoice.serviceDate} (${ids})`,
      );
    }
  }
  return issues;
}
