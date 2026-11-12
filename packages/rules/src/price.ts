import type { IsoDate, PriceBookItem } from "@valwell/domain";

/** True when `date` falls in [effectiveFrom, effectiveTo); a null effectiveTo is open-ended. */
export function isPriceEffective(
  item: Pick<PriceBookItem, "effectiveFrom" | "effectiveTo">,
  date: IsoDate,
): boolean {
  return item.effectiveFrom <= date && (item.effectiveTo === null || date < item.effectiveTo);
}

/**
 * The price-book item in force for a customer's item on a date, or undefined
 * when none (or, defensively, more than one) is effective.
 */
export function findEffectivePrice(
  priceBook: readonly PriceBookItem[],
  customerId: string,
  itemCode: string,
  date: IsoDate,
): PriceBookItem | undefined {
  const matches = priceBook.filter(
    (p) => p.customerId === customerId && p.itemCode === itemCode && isPriceEffective(p, date),
  );
  return matches.length === 1 ? matches[0] : undefined;
}
