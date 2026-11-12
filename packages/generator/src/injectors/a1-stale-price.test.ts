import { fromCents, multiplyQty } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import { injectFaults } from "../inject.js";
import { generateJob } from "../job.js";
import { generateReferenceData } from "../reference.js";
import { createRng } from "../rng.js";
import { a1StalePrice, typoPrice } from "./a1-stale-price.js";

const rng = createRng(11);
const ref = generateReferenceData(rng, 3);
const clean = Array.from({ length: 40 }, (_, i) => generateJob(rng, ref, i));
const { bundles, labels } = injectFaults(createRng(3), ref, clean, [a1StalePrice], { A1: 1 });

describe("typoPrice", () => {
  it.each([
    [9500, 5900],
    [10200, 12000], // never swaps a zero into the leading position
    [1111, 2111],
  ])("turns %i into %i", (input, expected) => {
    expect(typoPrice(fromCents(input))).toBe(expected);
  });
});

describe("a1StalePrice", () => {
  it("faults one service or labour line in every job", () => {
    expect(labels).toHaveLength(clean.length);
    for (const label of labels) {
      const bundle = bundles.find((b) => b.job.id === label.jobId);
      const line = bundle?.invoice.lines.find((l) => l.id === label.invoiceLineId);
      expect(["SERVICE", "LABOUR"]).toContain(line?.kind);
      expect(line?.amount).toBe(line && multiplyQty(line.unitPrice, line.qty));
    }
  });

  it("changes the price away from the correct one by exactly amountImpact", () => {
    for (const label of labels) {
      const before = clean.find((b) => b.job.id === label.jobId);
      const after = bundles.find((b) => b.job.id === label.jobId);
      const lineBefore = before?.invoice.lines.find((l) => l.id === label.invoiceLineId);
      const lineAfter = after?.invoice.lines.find((l) => l.id === label.invoiceLineId);
      expect(lineAfter?.unitPrice).not.toBe(lineBefore?.unitPrice);
      expect((lineAfter?.amount ?? 0) - (lineBefore?.amount ?? 0)).toBe(label.amountImpact);
    }
  });

  it("produces both stale-version and typo faults", () => {
    const stale = labels.filter((l) => l.description.includes("price-book v")).length;
    expect(stale).toBeGreaterThan(0);
    expect(stale).toBeLessThan(labels.length);
  });

  it("points stale lines at the stale price-book item", () => {
    for (const label of labels.filter((l) => l.description.includes("price-book v"))) {
      const line = bundles
        .find((b) => b.job.id === label.jobId)
        ?.invoice.lines.find((l) => l.id === label.invoiceLineId);
      const pb = ref.priceBook.find((p) => p.id === line?.sourceRef?.priceBookItemId);
      expect(pb?.unitPrice).toBe(line?.unitPrice);
    }
  });
});
