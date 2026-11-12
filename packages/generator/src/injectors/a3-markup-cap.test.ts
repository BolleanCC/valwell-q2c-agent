import { applyMarkupBps, multiplyQty } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import { injectFaults } from "../inject.js";
import { generateJob } from "../job.js";
import { generateReferenceData } from "../reference.js";
import { createRng } from "../rng.js";
import { a1StalePrice } from "./a1-stale-price.js";
import { a3MarkupCap } from "./a3-markup-cap.js";

const rng = createRng(21);
const ref = generateReferenceData(rng, 3);
const clean = Array.from({ length: 40 }, (_, i) => generateJob(rng, ref, i));
const { bundles, labels } = injectFaults(createRng(4), ref, clean, [a3MarkupCap], { A3: 1 });

const lineFor = (label: (typeof labels)[number]) =>
  bundles
    .find((b) => b.job.id === label.jobId)
    ?.invoice.lines.find((l) => l.id === label.invoiceLineId);

describe("a3MarkupCap", () => {
  it("faults one part line in every job (every job has parts)", () => {
    expect(labels).toHaveLength(clean.length);
    for (const label of labels) expect(lineFor(label)?.kind).toBe("PART");
  });

  it("bills above cost × (1 + cap) and keeps the disclosed cost truthful", () => {
    for (const label of labels) {
      const line = lineFor(label);
      const customerId = bundles.find((b) => b.job.id === label.jobId)?.job.customerId;
      const rule = ref.rules.find((r) => r.customerId === customerId);
      if (!line?.unitCost || !rule) throw new Error("missing line or rule");
      expect(line.unitPrice).toBeGreaterThan(applyMarkupBps(line.unitCost, rule.markupCapBps));
      expect(line.amount).toBe(multiplyQty(line.unitPrice, line.qty));
      const wo = bundles
        .find((b) => b.job.id === label.jobId)
        ?.workOrder.lines.find((w) => w.id === label.workOrderLineId);
      expect(wo?.kind === "PART" && wo.unitCost).toBe(line.unitCost);
    }
  });

  it("reports a positive over-billing amount", () => {
    for (const label of labels) expect(label.amountImpact).toBeGreaterThan(0);
  });

  it("never faults a line A1 already faulted", () => {
    const both = injectFaults(createRng(4), ref, clean, [a1StalePrice, a3MarkupCap], {
      A1: 1,
      A3: 1,
    });
    const ids = both.labels.map((l) => l.invoiceLineId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
