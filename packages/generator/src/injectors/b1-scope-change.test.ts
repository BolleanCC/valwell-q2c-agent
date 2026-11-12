import { describe, expect, it } from "vitest";
import { injectFaults } from "../inject.js";
import { generateJob } from "../job.js";
import { generateReferenceData } from "../reference.js";
import { createRng } from "../rng.js";
import { b1ScopeChange } from "./b1-scope-change.js";

const rng = createRng(31);
const ref = generateReferenceData(rng, 3);
const clean = Array.from({ length: 60 }, (_, i) => generateJob(rng, ref, i));
const { bundles, labels } = injectFaults(createRng(6), ref, clean, [b1ScopeChange], { B1: 1 });

describe("b1ScopeChange", () => {
  it("adds one work-order line and one invoice line per job", () => {
    expect(labels).toHaveLength(clean.length);
    bundles.forEach((b, i) => {
      expect(b.workOrder.lines).toHaveLength((clean[i]?.workOrder.lines.length ?? 0) + 1);
      expect(b.invoice.lines).toHaveLength((clean[i]?.invoice.lines.length ?? 0) + 1);
    });
  });

  it("adds scope covered by no quote and no approved change order", () => {
    for (const label of labels) {
      const b = bundles.find((x) => x.job.id === label.jobId);
      const wo = b?.workOrder.lines.find((l) => l.id === label.workOrderLineId);
      const approved = new Set([
        ...(b?.quotes ?? []).flatMap((q) => q.lines.map((l) => l.itemCode)),
        ...(b?.changeOrders ?? [])
          .filter((c) => c.status === "APPROVED")
          .flatMap((c) => c.lines.map((l) => l.itemCode)),
      ]);
      expect(wo).toBeDefined();
      expect(approved.has(wo?.itemCode as never)).toBe(false);
    }
  });

  it("labels the full billed amount of the extra line", () => {
    for (const label of labels) {
      const line = bundles
        .find((b) => b.job.id === label.jobId)
        ?.invoice.lines.find((l) => l.id === label.invoiceLineId);
      expect(line?.sourceRef?.workOrderLineId).toBe(label.workOrderLineId);
      expect(label.amountImpact).toBe(line?.amount);
      expect(label.amountImpact).toBeGreaterThan(0);
    }
  });

  it("adds both parts and labour, and some non-approved change orders as distractors", () => {
    const kinds = new Set(
      labels.map(
        (l) =>
          bundles
            .find((b) => b.job.id === l.jobId)
            ?.invoice.lines.find((x) => x.id === l.invoiceLineId)?.kind,
      ),
    );
    expect(kinds).toEqual(new Set(["PART", "LABOUR"]));
    const distractors = bundles
      .flatMap((b) => b.changeOrders)
      .filter((c) => c.status !== "APPROVED");
    expect(distractors.length).toBeGreaterThan(0);
  });
});
