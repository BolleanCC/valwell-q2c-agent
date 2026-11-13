import {
  ChangeOrder,
  CustomerRules,
  format,
  type Invoice,
  latestRevisions,
  multiplyQty,
  PriceBookItem,
  Quote,
} from "@valwell/domain";
import { checkMarkup, findEffectivePrice } from "@valwell/rules";
import { z } from "zod";
import { readStoreFile } from "./json-file.js";

/** The customer's side: its contract (price book + rules) and the scope it approved. */
export const PortalStoreData = z.object({
  priceBook: z.array(PriceBookItem),
  rules: z.array(CustomerRules),
  quotes: z.array(Quote),
  changeOrders: z.array(ChangeOrder),
});
export type PortalStoreData = z.infer<typeof PortalStoreData>;

export const RejectionCode = z.enum([
  "NO_CONTRACT",
  "PRICE_MISMATCH",
  "MARKUP_CAP_EXCEEDED",
  "MISSING_COST_BACKUP",
  "UNAPPROVED_SCOPE",
  "QUANTITY_EXCEEDS_APPROVED",
  "EXTENSION_ERROR",
]);
export type RejectionCode = z.infer<typeof RejectionCode>;

export interface RejectionReason {
  code: RejectionCode;
  invoiceLineId: string | null;
  message: string;
}

export type PortalDecision =
  | { invoiceId: string; status: "APPROVED" }
  | {
      invoiceId: string;
      status: "REJECTED";
      /** The first reason, as a real portal would show it. */
      reasonCode: RejectionCode;
      reasons: RejectionReason[];
    };

export interface CustomerPortal {
  submit(invoice: Invoice): PortalDecision;
}

/**
 * Simulates a customer invoice portal: it validates every line against the
 * customer's complete contract rules and approved scope, and rejects the
 * whole invoice on any violation.
 */
export function portalFrom(data: PortalStoreData): CustomerPortal {
  return {
    submit(invoice) {
      const reasons: RejectionReason[] = [];
      const reject = (code: RejectionCode, lineId: string | null, message: string) =>
        reasons.push({ code, invoiceLineId: lineId, message });

      const rules = data.rules.find((r) => r.customerId === invoice.customerId);
      if (!rules) reject("NO_CONTRACT", null, `No MSA on file for ${invoice.customerId}`);
      // Approved scope: the effective (highest) revision of each quote plus
      // approved change orders — the same rule the agent uses. Quantities are
      // in integer thousandths (at most 3 decimals).
      const approvedMilli = new Map<string, number>();
      const billedMilli = new Map<string, number>();
      const addTo = (m: Map<string, number>, code: string, qty: number) =>
        m.set(code, (m.get(code) ?? 0) + Math.round(qty * 1000));
      for (const q of latestRevisions(data.quotes.filter((q) => q.jobId === invoice.jobId))) {
        for (const l of q.lines) addTo(approvedMilli, l.itemCode, l.qty);
      }
      for (const c of data.changeOrders) {
        if (c.jobId !== invoice.jobId || c.status !== "APPROVED") continue;
        for (const l of c.lines) addTo(approvedMilli, l.itemCode, l.qty);
      }
      for (const l of invoice.lines) addTo(billedMilli, l.itemCode, l.qty);

      for (const line of invoice.lines) {
        if (line.amount !== multiplyQty(line.unitPrice, line.qty)) {
          reject("EXTENSION_ERROR", line.id, `${line.itemCode}: amount ≠ qty × unit price`);
        }
        const approved = approvedMilli.get(line.itemCode);
        if (approved === undefined) {
          reject("UNAPPROVED_SCOPE", line.id, `${line.itemCode} is not in approved scope`);
        } else if ((billedMilli.get(line.itemCode) ?? 0) > approved) {
          reject(
            "QUANTITY_EXCEEDS_APPROVED",
            line.id,
            `${line.itemCode}: billed quantity exceeds the approved ${approved / 1000}`,
          );
        }
        if (line.kind === "PART") {
          if (line.unitCost === undefined) {
            reject("MISSING_COST_BACKUP", line.id, `${line.itemCode}: no cost backup`);
          } else if (rules) {
            const check = checkMarkup(line.unitCost, line.unitPrice, rules.markupCapBps);
            if (!check.ok) {
              reject(
                "MARKUP_CAP_EXCEEDED",
                line.id,
                `${line.itemCode}: ${format(line.unitPrice)} exceeds cap price ${format(check.maxUnitPrice)}`,
              );
            }
          }
        } else {
          const contract = findEffectivePrice(
            data.priceBook,
            invoice.customerId,
            line.itemCode,
            invoice.serviceDate,
          );
          if (contract?.unitPrice !== line.unitPrice) {
            const expected = contract ? format(contract.unitPrice) : "no contracted rate";
            reject(
              "PRICE_MISMATCH",
              line.id,
              `${line.itemCode}: billed ${format(line.unitPrice)}, contract ${expected}`,
            );
          }
        }
      }

      const [first] = reasons;
      return first
        ? { invoiceId: invoice.id, status: "REJECTED", reasonCode: first.code, reasons }
        : { invoiceId: invoice.id, status: "APPROVED" };
    },
  };
}

export const openPortal = async (dir: string) =>
  portalFrom(await readStoreFile(dir, "portal.json", PortalStoreData));
