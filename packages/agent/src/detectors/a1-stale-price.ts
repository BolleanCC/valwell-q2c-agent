import { type EvidenceRef, format, fromCents, multiplyQty } from "@valwell/domain";
import { findEffectivePrice } from "@valwell/rules";
import type { Detector, FindingDraft } from "./types.js";

/**
 * A1: a service or labour invoice line whose unit price differs from the
 * customer's price-book rate effective on the service date. When the billed
 * price matches another version, the finding names it (stale rate sheet);
 * otherwise it is treated as a re-keying error.
 */
export const a1StalePrice: Detector = {
  code: "A1",
  detect(ctx, alignment) {
    const { invoice } = ctx;
    const findings: FindingDraft[] = [];
    for (const { invoiceLine: line, workOrderLine: wo } of alignment.matches) {
      if (line.kind === "PART" || wo === null) continue;
      const expected = findEffectivePrice(
        ctx.priceBook,
        invoice.customerId,
        line.itemCode,
        invoice.serviceDate,
      );
      // No or overlapping effective price is a review issue (checkLineEvidence), never a guess.
      if (!expected || expected.unitPrice === line.unitPrice) continue;

      const stale = ctx.priceBook.find(
        (p) =>
          p.itemCode === line.itemCode && p.id !== expected.id && p.unitPrice === line.unitPrice,
      );
      const correctAmount = multiplyQty(expected.unitPrice, line.qty);
      const evidence: EvidenceRef[] = [
        { kind: "INVOICE_LINE", id: line.id },
        { kind: "PRICE_BOOK_ITEM", id: expected.id },
        ...(stale ? [{ kind: "PRICE_BOOK_ITEM" as const, id: stale.id }] : []),
        { kind: "WORK_ORDER_LINE" as const, id: wo.id },
      ];
      const cause = stale
        ? `matches superseded price-book v${stale.version}`
        : "matches no price-book version (likely a re-keying error)";
      findings.push({
        jobId: ctx.job.id,
        invoiceId: invoice.id,
        frictionCode: "A1",
        invoiceLineId: line.id,
        workOrderLineId: wo.id,
        message: `${line.itemCode} billed at ${format(line.unitPrice)}; price-book v${expected.version} effective ${invoice.serviceDate} is ${format(expected.unitPrice)} — billed price ${cause}`,
        evidence,
        suggestion: {
          action: "REPRICE_LINE",
          summary: `Reprice ${line.itemCode} to ${format(expected.unitPrice)} (v${expected.version})`,
          expectedUnitPrice: expected.unitPrice,
          amountDelta: fromCents(correctAmount - line.amount),
        },
        basis: stale ? "SUPERSEDED_PRICE_VERSION" : "UNEXPLAINED_PRICE",
        confidence: stale ? 0.97 : 0.9,
      });
    }
    return findings;
  },
};
