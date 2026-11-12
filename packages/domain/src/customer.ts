import { z } from "zod";
import { Money } from "./money.js";
import {
  BasisPoints,
  CustomerId,
  IsoDate,
  ItemCode,
  LineKind,
  PriceBookItemId,
  RuleId,
} from "./primitives.js";

export const Customer = z.object({
  id: CustomerId,
  name: z.string().min(1),
  /** Reference to the Master Service Agreement that holds the rate sheet and rules. */
  msaRef: z.string().min(1),
});
export type Customer = z.infer<typeof Customer>;

/**
 * One customer-specific unit price for one item, valid for a date range.
 * `effectiveTo` is exclusive; `null` means open-ended. Each new version of a
 * customer's price book creates a new item with a higher `version`.
 */
export const PriceBookItem = z
  .object({
    id: PriceBookItemId,
    customerId: CustomerId,
    itemCode: ItemCode,
    description: z.string().min(1),
    /** Price-book items cover fixed-price services and hourly labour; parts are cost-plus. */
    kind: LineKind.exclude(["PART"]),
    unitPrice: Money.refine((m) => m >= 0, "unitPrice must not be negative"),
    version: z.int().positive(),
    effectiveFrom: IsoDate,
    effectiveTo: IsoDate.nullable(),
  })
  .refine((p) => p.effectiveTo === null || p.effectiveTo > p.effectiveFrom, {
    message: "effectiveTo must be after effectiveFrom",
    path: ["effectiveTo"],
  });
export type PriceBookItem = z.infer<typeof PriceBookItem>;

/** Contract rules from a customer's MSA that invoices must satisfy. */
export const CustomerRules = z.object({
  id: RuleId,
  customerId: CustomerId,
  /** Maximum markup over cost for parts and third-party items, e.g. 1000 = 10 %. */
  markupCapBps: BasisPoints,
});
export type CustomerRules = z.infer<typeof CustomerRules>;
