import { format, multiplyQty } from "@valwell/domain";
import { lookupEffectivePrice } from "@valwell/rules";
import type { JobContext } from "../adapters/sources.js";
import type { ReviewIssue } from "../review.js";
import type { Alignment } from "./align.js";

/**
 * Evidence and arithmetic checks that no detector can decide. Each problem is
 * a review issue: the agent will not correct a financial value when the
 * evidence for the correct one is missing or contradictory.
 *
 * - Every line: amount must equal qty × unit price (rounded by `multiplyQty`).
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
