import {
  applyMarkupBps,
  Customer,
  CustomerRules,
  fromDollars,
  PriceBookItem,
} from "@valwell/domain";
import { CUSTOMER_NAMES, PRICE_BOOK_ENTRIES } from "./catalogue.js";
import type { Rng } from "./rng.js";

export interface ReferenceData {
  customers: Customer[];
  priceBook: PriceBookItem[];
  rules: CustomerRules[];
}

/** Version 1 of every price book starts here; version 2 starts on a per-customer cutover date. */
export const PRICE_BOOK_V1_FROM = "2025-01-01";
const CUTOVER_DATES = ["2025-11-01", "2026-01-01", "2026-02-01"] as const;
const MARKUP_CAPS_BPS = [1000, 1200, 1500] as const;

export function generateReferenceData(rng: Rng, customerCount: number): ReferenceData {
  if (customerCount < 1 || customerCount > CUSTOMER_NAMES.length) {
    throw new RangeError(`customerCount must be 1..${CUSTOMER_NAMES.length}`);
  }
  const customers: Customer[] = [];
  const priceBook: PriceBookItem[] = [];
  const rules: CustomerRules[] = [];

  for (let i = 0; i < customerCount; i++) {
    const n = String(i + 1).padStart(3, "0");
    const customer = Customer.parse({
      id: `CUST-${n}`,
      name: CUSTOMER_NAMES[i],
      msaRef: `MSA-2024-${n}`,
    });
    customers.push(customer);

    const cutover = rng.pick(CUTOVER_DATES);
    for (const entry of PRICE_BOOK_ENTRIES) {
      const v1Price = fromDollars(rng.int(...entry.dollarRange));
      // Annual increase of 3–8 %, applied through the Money helper (single rounding point).
      const v2Price = applyMarkupBps(v1Price, rng.int(300, 800));
      const base = {
        customerId: customer.id,
        itemCode: entry.itemCode,
        description: entry.description,
        kind: entry.kind,
      };
      priceBook.push(
        PriceBookItem.parse({
          ...base,
          id: `PB-${customer.id}-${entry.itemCode}-v1`,
          unitPrice: v1Price,
          version: 1,
          effectiveFrom: PRICE_BOOK_V1_FROM,
          effectiveTo: cutover,
        }),
        PriceBookItem.parse({
          ...base,
          id: `PB-${customer.id}-${entry.itemCode}-v2`,
          unitPrice: v2Price,
          version: 2,
          effectiveFrom: cutover,
          effectiveTo: null,
        }),
      );
    }

    rules.push(
      CustomerRules.parse({
        id: `RULE-${customer.id}-MARKUP`,
        customerId: customer.id,
        markupCapBps: rng.pick(MARKUP_CAPS_BPS),
      }),
    );
  }
  return { customers, priceBook, rules };
}
