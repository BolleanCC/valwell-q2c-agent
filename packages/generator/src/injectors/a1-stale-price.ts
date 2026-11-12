import { format, fromCents, type Money } from "@valwell/domain";
import { type Injector, repriceLine, untouchedLines } from "../inject.js";

/** Swap the first pair of adjacent, different digits: 9500 → 5900. Falls back to +$10.00. */
export function typoPrice(price: Money): Money {
  const digits = String(price).split("");
  for (let i = 0; i < digits.length - 1; i++) {
    if (digits[i] !== digits[i + 1] && !(i === 0 && digits[1] === "0")) {
      [digits[i], digits[i + 1]] = [digits[i + 1] as string, digits[i] as string];
      return fromCents(Number(digits.join("")));
    }
  }
  return fromCents(price + 1000);
}

/**
 * A1: an invoice line for a service or labour item carries a price that is
 * not the one effective on the service date — either another price-book
 * version (stale rate sheet) or a re-keying typo. Lineage to the price book
 * is changed or lost the way manual re-keying would.
 */
export const a1StalePrice: Injector = {
  code: "A1",
  inject({ rng, ref, bundle, touched }) {
    const candidates = untouchedLines({ rng, ref, bundle, touched }, ["SERVICE", "LABOUR"]);
    if (candidates.length === 0) return null;
    const line = rng.pick(candidates);
    const correct = line.unitPrice;
    const { priceBookItemId: _dropped, ...lineage } = line.sourceRef ?? {};

    const stale = ref.priceBook.find(
      (p) =>
        p.customerId === bundle.invoice.customerId &&
        p.itemCode === line.itemCode &&
        p.unitPrice !== correct,
    );
    if (stale && rng.chance(0.6)) {
      const delta = repriceLine(line, stale.unitPrice);
      line.sourceRef = { ...lineage, priceBookItemId: stale.id };
      return {
        invoiceLineId: line.id,
        workOrderLineId: line.sourceRef.workOrderLineId ?? null,
        description: `${line.itemCode} billed at price-book v${stale.version} (${format(stale.unitPrice)}) instead of the rate effective ${bundle.invoice.serviceDate} (${format(correct)})`,
        amountImpact: delta,
      };
    }

    const typo = typoPrice(correct);
    const delta = repriceLine(line, typo);
    if (Object.keys(lineage).length > 0) line.sourceRef = lineage;
    else delete line.sourceRef;
    return {
      invoiceLineId: line.id,
      workOrderLineId: lineage.workOrderLineId ?? null,
      description: `${line.itemCode} re-keyed as ${format(typo)} instead of ${format(correct)}`,
      amountImpact: delta,
    };
  },
};
