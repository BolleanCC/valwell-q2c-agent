import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateBatch } from "./experiment.js";
import { loadFaultLabels } from "./score.js";

const FIXTURE = join(import.meta.dirname, "../../../data/fixtures/seed-42");

describe("evaluateBatch on the committed fixture", async () => {
  const { experiment, score } = await evaluateBatch(FIXTURE);
  const [baseline, unattended, reviewed] = experiment.runs;

  it("baseline acceptance equals the share of fault-free invoices", async () => {
    const faulted = new Set((await loadFaultLabels(FIXTURE)).map((l) => l.invoiceId));
    expect(baseline?.submitted).toBe(40);
    expect(baseline?.approved).toBe(40 - faulted.size);
    expect(score.missedLabels).toEqual([]);
    expect(baseline?.rejectionReasons).toEqual(
      expect.objectContaining({ PRICE_MISMATCH: expect.any(Number) }),
    );
  });

  it("raises first-pass acceptance when the agent runs", () => {
    expect(unattended?.firstPassAcceptance).toBeGreaterThan(baseline?.firstPassAcceptance ?? 1);
    expect(reviewed?.firstPassAcceptance).toBeGreaterThanOrEqual(
      unattended?.firstPassAcceptance ?? 1,
    );
    expect(reviewed?.approved).toBe(40 - (reviewed?.fullyHeld ?? 0));
  });

  it("reports amounts removed, recovered and held", () => {
    expect(experiment.amounts.overbillingRemoved).toBeGreaterThan(0);
    expect(experiment.amounts.heldPendingChangeOrder).toBeGreaterThan(0);
    expect(experiment.amounts.underbillingRecovered).toBeGreaterThanOrEqual(0);
  });
});
