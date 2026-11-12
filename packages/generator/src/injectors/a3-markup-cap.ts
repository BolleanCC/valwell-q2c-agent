import { applyMarkupBps, format } from "@valwell/domain";
import { type Injector, repriceLine, untouchedLines } from "../inject.js";

/**
 * A3: a part line is billed at cost × (1 + markup) with the markup above the
 * customer's cap — e.g. a default 25 % shop markup applied to a 10 % MSA.
 * The disclosed unit cost is left truthful.
 */
export const a3MarkupCap: Injector = {
  code: "A3",
  inject(ctx) {
    const { rng, ref, bundle } = ctx;
    const candidates = untouchedLines(ctx, ["PART"]).filter((l) => l.unitCost !== undefined);
    if (candidates.length === 0) return null;
    const rule = ref.rules.find((r) => r.customerId === bundle.invoice.customerId);
    if (!rule) return null;

    const line = rng.pick(candidates);
    const cost = line.unitCost as NonNullable<typeof line.unitCost>;
    const markupBps = rule.markupCapBps + rng.int(300, 2500);
    const billed = applyMarkupBps(cost, markupBps);
    const delta = repriceLine(line, billed);
    return {
      invoiceLineId: line.id,
      workOrderLineId: line.sourceRef?.workOrderLineId ?? null,
      description: `${line.itemCode} billed at ${format(billed)} on cost ${format(cost)} (${markupBps / 100}% markup, cap ${rule.markupCapBps / 100}%)`,
      amountImpact: delta,
    };
  },
};
