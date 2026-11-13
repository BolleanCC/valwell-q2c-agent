import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDemoCase } from "./demo.js";

const CASE = (name: string) => join(import.meta.dirname, "../../../data/fixtures/demo", name);

describe("demo case 1: normal repair", async () => {
  const r = await runDemoCase(CASE("1-normal-repair"));

  it("completes the review with no findings", () => {
    expect(r.review).toEqual({
      jobId: "JOB-D1",
      invoiceId: "INV-D1",
      status: "COMPLETE",
      issues: [],
    });
    expect(r.run.findings).toEqual([]);
  });

  it("passes the original invoice through the simulated portal unchanged", () => {
    expect(r.original.portal).toEqual({ invoiceId: "INV-D1", status: "APPROVED" });
    // 840.00 + 6 × 95.00 + 2 × 220.00 + 350.00 = $2,200.00
    expect(r.unattended).toMatchObject({
      status: "READY",
      changes: [],
      held: [],
      totals: { original: 220_000, held: 0, draft: 220_000, corrections: 0 },
      portal: { status: "APPROVED" },
    });
    expect(r.unattended.invoice).toEqual(r.original.invoice);
  });
});
