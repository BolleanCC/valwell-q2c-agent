import { type EvidenceRef, format, fromCents, type Money, multiplyQty } from "@valwell/domain";
import { checkMarkup } from "@valwell/rules";
import type { Detector, FindingDraft } from "./types.js";

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

/**
 * A3: a part billed above cost × (1 + markup cap). The cost comes from the
 * work-order line the invoice line is matched to (the shop's record of what
 * it paid). Unmatched part lines are review issues, not guesses.
 */
export const a3MarkupCap: Detector = {
  code: "A3",
  detect(ctx, alignment) {
    const capBps = ctx.rules.markupCapBps;
    const findings: FindingDraft[] = [];
    for (const { invoiceLine: line, workOrderLine: wo } of alignment.matches) {
      if (line.kind !== "PART" || wo?.kind !== "PART") continue;
      const cost: Money = wo.unitCost;
      const check = checkMarkup(cost, line.unitPrice, capBps);
      if (check.ok) continue;

      const evidence: EvidenceRef[] = [
        { kind: "INVOICE_LINE", id: line.id },
        { kind: "RULE", id: ctx.rules.id },
        { kind: "WORK_ORDER_LINE", id: wo.id },
      ];
      const actual = check.actualMarkupBps === null ? "∞" : pct(check.actualMarkupBps);
      findings.push({
        jobId: ctx.job.id,
        invoiceId: ctx.invoice.id,
        frictionCode: "A3",
        invoiceLineId: line.id,
        workOrderLineId: wo.id,
        message: `${line.itemCode} billed at ${format(line.unitPrice)} on cost ${format(cost)}: ${actual} markup exceeds the ${pct(capBps)} cap (max ${format(check.maxUnitPrice)})`,
        evidence,
        suggestion: {
          action: "REPRICE_LINE",
          summary: `Reprice ${line.itemCode} to the cap price ${format(check.maxUnitPrice)}`,
          expectedUnitPrice: check.maxUnitPrice,
          amountDelta: fromCents(multiplyQty(check.maxUnitPrice, line.qty) - line.amount),
        },
        confidence: 0.95,
      });
    }
    return findings;
  },
};
