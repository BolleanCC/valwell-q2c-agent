import { fromCents } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import { runPipeline } from "./pipeline.js";
import { renderReport } from "./report.js";
import { buildContext } from "./testing/build-context.js";

describe("renderReport", () => {
  it("summarises by friction code and lists findings with evidence", () => {
    const ctx = buildContext();
    const labour = ctx.invoice.lines.find((l) => l.id === "IL-2");
    if (!labour) throw new Error("IL-2");
    labour.unitPrice = fromCents(9_000);
    labour.amount = fromCents(54_000);
    const findings = runPipeline([ctx]);
    const md = renderReport({ jobsChecked: 1, skipped: [], findings }, "unit");

    expect(md).toContain("# Reconciliation report: unit");
    expect(md).toContain("- Findings: **1** on **1** invoices");
    expect(md).toContain("| A1 |");
    expect(md).toMatch(/\| A1 \| .* \| 1 \| 1 \| 0 \| 0 \| \+\$30\.00 \|/);
    expect(md).toContain("### INV-T (JOB-T)");
    expect(md).toContain("**F-0001 · A1 · AUTO_FIX** (confidence 97%)");
    expect(md).toContain("PRICE_BOOK_ITEM `PB-LAB-TECH-v2`");
  });

  it("reports a clean run and skipped jobs", () => {
    const md = renderReport(
      { jobsChecked: 1, skipped: [{ jobId: "JOB-X", reason: "missing invoice" }], findings: [] },
      "clean",
    );
    expect(md).toContain("_No discrepancies found._");
    expect(md).toContain("- JOB-X: missing invoice");
    expect(md).toContain("Net invoice change if all suggestions are applied: **$0.00**");
  });
});
