import type { IsoDate, PriceBookItem } from "@valwell/domain";

/** True when `date` falls in [effectiveFrom, effectiveTo); a null effectiveTo is open-ended. */
export function isPriceEffective(
  item: Pick<PriceBookItem, "effectiveFrom" | "effectiveTo">,
  date: IsoDate,
): boolean {
  return item.effectiveFrom <= date && (item.effectiveTo === null || date < item.effectiveTo);
}

/**
 * The outcome of looking up the price in force on a date. NONE and OVERLAP
 * are both data problems a human must resolve; neither is a price.
 */
export type PriceLookup =
  | { status: "FOUND"; item: PriceBookItem }
  | { status: "NONE" }
  | { status: "OVERLAP"; items: PriceBookItem[] };

/** Look up the price-book version effective for a customer's item on a date. */
export function lookupEffectivePrice(
  priceBook: readonly PriceBookItem[],
  customerId: string,
  itemCode: string,
  date: IsoDate,
): PriceLookup {
  const matches = priceBook.filter(
    (p) => p.customerId === customerId && p.itemCode === itemCode && isPriceEffective(p, date),
  );
  const [only] = matches;
  if (matches.length === 0 || !only) return { status: "NONE" };
  return matches.length === 1
    ? { status: "FOUND", item: only }
    : { status: "OVERLAP", items: matches };
}

/** The price-book item in force on a date, or undefined when none or several are effective. */
export function findEffectivePrice(
  priceBook: readonly PriceBookItem[],
  customerId: string,
  itemCode: string,
  date: IsoDate,
): PriceBookItem | undefined {
  const lookup = lookupEffectivePrice(priceBook, customerId, itemCode, date);
  return lookup.status === "FOUND" ? lookup.item : undefined;
}
