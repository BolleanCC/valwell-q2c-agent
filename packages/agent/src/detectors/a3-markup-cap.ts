import { type EvidenceRef, format, fromCents, type Money, multiplyQty } from "@valwell/domain";
import { checkMarkup } from "@valwell/rules";
import type { Detector, FindingDraft } from "./types.js";

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

/**
 * A3: a part billed above cost × (1 + markup cap). The cost comes from the
 * shop's work order (source of truth); if no work-order cost exists the
 * disclosed invoice cost is used with lower confidence.
 */
export const a3MarkupCap: Detector = {
  code: "A3",
  detect(ctx, table) {
    const capBps = ctx.rules.markupCapBps;
    const findings: FindingDraft[] = [];
    for (const row of table) {
      if (row.kind !== "PART") continue;
      const woPart = row.workOrderLines.find((w) => w.kind === "PART");
      for (const line of row.invoiceLines) {
        const cost: Money | undefined = woPart?.kind === "PART" ? woPart.unitCost : line.unitCost;
        if (cost === undefined) continue;
        const check = checkMarkup(cost, line.unitPrice, capBps);
        if (check.ok) continue;

        const evidence: EvidenceRef[] = [
          { kind: "INVOICE_LINE", id: line.id },
          { kind: "RULE", id: ctx.rules.id },
          ...(woPart ? [{ kind: "WORK_ORDER_LINE" as const, id: woPart.id }] : []),
        ];
        const actual = check.actualMarkupBps === null ? "∞" : pct(check.actualMarkupBps);
        findings.push({
          jobId: ctx.job.id,
          invoiceId: ctx.invoice.id,
          frictionCode: "A3",
          invoiceLineId: line.id,
          workOrderLineId: woPart?.id ?? null,
          message: `${line.itemCode} billed at ${format(line.unitPrice)} on cost ${format(cost)}: ${actual} markup exceeds the ${pct(capBps)} cap (max ${format(check.maxUnitPrice)})`,
          evidence,
          suggestion: {
            action: "REPRICE_LINE",
            summary: `Reprice ${line.itemCode} to the cap price ${format(check.maxUnitPrice)}`,
            expectedUnitPrice: check.maxUnitPrice,
            amountDelta: fromCents(multiplyQty(check.maxUnitPrice, line.qty) - line.amount),
          },
          confidence: woPart ? 0.95 : 0.8,
        });
      }
    }
    return findings;
  },
};
