import { fromCents } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import { type Injector, injectFaults, repriceLine, untouchedLines } from "./inject.js";
import { generateJob } from "./job.js";
import { generateReferenceData } from "./reference.js";
import { createRng } from "./rng.js";

const rng = createRng(5);
const ref = generateReferenceData(rng, 2);
const bundles = Array.from({ length: 20 }, (_, i) => generateJob(rng, ref, i));

/** Test injector: doubles the first untouched service line. */
const doubler: Injector = {
  code: "A1",
  inject(ctx) {
    const line = untouchedLines(ctx, ["SERVICE"])[0];
    if (!line) return null;
    const delta = repriceLine(line, fromCents(line.unitPrice * 2));
    return {
      invoiceLineId: line.id,
      workOrderLineId: null,
      description: "doubled",
      amountImpact: delta,
    };
  },
};

describe("injectFaults", () => {
  it("injects at rate 1 into every job and labels each fault", () => {
    const { bundles: out, labels } = injectFaults(createRng(1), ref, bundles, [doubler], { A1: 1 });
    expect(labels).toHaveLength(bundles.length);
    labels.forEach((label, i) => {
      expect(label.id).toBe(`FL-${String(i + 1).padStart(4, "0")}`);
      expect(label.frictionCode).toBe("A1");
      expect(label.jobId).toBe(out[i]?.job.id);
      const line = out[i]?.invoice.lines.find((l) => l.id === label.invoiceLineId);
      expect(line?.amount).toBe((line?.unitPrice ?? 0) * (line?.qty ?? 0));
      expect(label.amountImpact).toBeGreaterThan(0);
    });
  });

  it("injects nothing at rate 0 and never mutates the input", () => {
    const snapshot = structuredClone(bundles);
    const { bundles: out, labels } = injectFaults(createRng(1), ref, bundles, [doubler], { A1: 0 });
    expect(labels).toEqual([]);
    expect(out).toEqual(bundles);
    injectFaults(createRng(1), ref, bundles, [doubler], { A1: 1 });
    expect(bundles).toEqual(snapshot);
  });

  it("never faults the same line twice", () => {
    const { labels } = injectFaults(createRng(1), ref, bundles, [doubler, doubler], { A1: 1 });
    const keys = labels.map((l) => l.invoiceLineId);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is deterministic for a seed", () => {
    const a = injectFaults(createRng(9), ref, bundles, [doubler], { A1: 0.5 });
    const b = injectFaults(createRng(9), ref, bundles, [doubler], { A1: 0.5 });
    expect(a).toEqual(b);
    expect(a.labels.length).toBeGreaterThan(0);
    expect(a.labels.length).toBeLessThan(bundles.length);
  });
});
