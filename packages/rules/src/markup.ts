import { applyMarkupBps, type Money } from "@valwell/domain";

export interface MarkupCheck {
  ok: boolean;
  /** Highest unit price the cap allows: cost × (1 + cap). */
  maxUnitPrice: Money;
  /** Markup actually applied, in whole basis points (floored); null when cost is zero. */
  actualMarkupBps: number | null;
  /** Unit price above the cap (0 when ok). */
  excessPerUnit: Money;
}

/** Check a cost-plus unit price against a markup cap in basis points. */
export function checkMarkup(unitCost: Money, unitPrice: Money, capBps: number): MarkupCheck {
  const maxUnitPrice = applyMarkupBps(unitCost, capBps);
  const ok = unitPrice <= maxUnitPrice;
  const actualMarkupBps =
    unitCost === 0 ? null : Number((BigInt(unitPrice - unitCost) * 10_000n) / BigInt(unitCost));
  return {
    ok,
    maxUnitPrice,
    actualMarkupBps,
    excessPerUnit: (ok ? 0 : unitPrice - maxUnitPrice) as Money,
  };
}
