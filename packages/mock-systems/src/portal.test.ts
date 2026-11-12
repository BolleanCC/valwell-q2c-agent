import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FaultLabel, fromCents, type Invoice } from "@valwell/domain";
import { beforeAll, describe, expect, it } from "vitest";
import { type CustomerPortal, openPortal } from "./portal.js";
import { openBillingStore } from "./stores.js";

const FIXTURE = join(import.meta.dirname, "../../../data/fixtures/seed-42");

let portal: CustomerPortal;
let invoices: Invoice[];
let labels: FaultLabel[];

beforeAll(async () => {
  portal = await openPortal(FIXTURE);
  invoices = (await openBillingStore(FIXTURE)).invoices();
  const raw: unknown[] = JSON.parse(await readFile(join(FIXTURE, "fault_labels.json"), "utf8"));
  labels = raw.map((l) => FaultLabel.parse(l));
});

const decision = (invoiceId: string) => {
  const inv = invoices.find((i) => i.id === invoiceId);
  if (!inv) throw new Error(`no invoice ${invoiceId}`);
  return portal.submit(inv);
};

describe("customer portal simulator", () => {
  it("approves every invoice that has no injected fault", () => {
    const faulted = new Set(labels.map((l) => l.invoiceId));
    const clean = invoices.filter((i) => !faulted.has(i.id));
    expect(clean.length).toBeGreaterThan(0);
    for (const inv of clean)
      expect(portal.submit(inv)).toEqual({ invoiceId: inv.id, status: "APPROVED" });
  });

  it("rejects every faulted invoice with a reason on the faulted line", () => {
    const expectedCode = {
      A1: "PRICE_MISMATCH",
      A3: "MARKUP_CAP_EXCEEDED",
      B1: "UNAPPROVED_SCOPE",
    };
    for (const label of labels) {
      const d = decision(label.invoiceId);
      expect(d.status).toBe("REJECTED");
      if (d.status !== "REJECTED") continue;
      expect(d.reasons).toContainEqual(
        expect.objectContaining({
          code: expectedCode[label.frictionCode],
          invoiceLineId: label.invoiceLineId,
        }),
      );
    }
  });

  it("flags extension errors and missing cost backup", () => {
    const inv = structuredClone(invoices[0] as Invoice);
    const part = inv.lines.find((l) => l.kind === "PART");
    const first = inv.lines[0];
    if (!part || !first) throw new Error("fixture invoice lacks lines");
    delete part.unitCost;
    first.amount = fromCents(first.amount + 1);
    const d = portal.submit(inv);
    expect(d.status === "REJECTED" && d.reasons.map((r) => r.code)).toEqual(
      expect.arrayContaining(["MISSING_COST_BACKUP", "EXTENSION_ERROR"]),
    );
  });

  it("rejects a customer with no contract", () => {
    const inv = { ...(invoices[0] as Invoice), customerId: "CUST-999" } as Invoice;
    const d = portal.submit(inv);
    expect(d.status === "REJECTED" && d.reasonCode).toBe("NO_CONTRACT");
  });
});
