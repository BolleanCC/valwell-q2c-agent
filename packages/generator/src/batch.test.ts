import { FaultLabel, Invoice, Quote, WorkOrder } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import { generateBatch, STORE_FILES, serializeBatch } from "./batch.js";

describe("generateBatch", () => {
  const files = generateBatch({ seed: 42, jobs: 30 });

  it("writes one store per system plus labels and a manifest", () => {
    expect(Object.keys(files).sort()).toEqual(Object.values(STORE_FILES).sort());
  });

  it("produces schema-valid documents", () => {
    const quoting = files[STORE_FILES.quoting] as { quotes: unknown[] };
    const ops = files[STORE_FILES.ops] as { workOrders: unknown[] };
    const billing = files[STORE_FILES.billing] as { invoices: unknown[] };
    for (const q of quoting.quotes) Quote.parse(q);
    for (const w of ops.workOrders) WorkOrder.parse(w);
    for (const i of billing.invoices) Invoice.parse(i);
    for (const l of files[STORE_FILES.faultLabels] as unknown[]) FaultLabel.parse(l);
    expect(billing.invoices).toHaveLength(30);
  });

  it("injects every friction code at the default rates", () => {
    const manifest = files[STORE_FILES.manifest] as { faultCounts: Record<string, number> };
    expect(Object.keys(manifest.faultCounts).sort()).toEqual(["A1", "A3", "B1"]);
  });

  it("only gives the portal approved change orders", () => {
    const portal = files[STORE_FILES.portal] as { changeOrders: { status: string }[] };
    expect(portal.changeOrders.every((c) => c.status === "APPROVED")).toBe(true);
  });

  it("is byte-identical for the same seed and differs for another", () => {
    const a = serializeBatch(generateBatch({ seed: 7, jobs: 25 }));
    const b = serializeBatch(generateBatch({ seed: 7, jobs: 25 }));
    const c = serializeBatch(generateBatch({ seed: 8, jobs: 25 }));
    expect(a).toEqual(b);
    expect(a[STORE_FILES.billing]).not.toEqual(c[STORE_FILES.billing]);
  });

  it("rejects a non-positive job count", () => {
    expect(() => generateBatch({ seed: 1, jobs: 0 })).toThrow(RangeError);
  });
});
