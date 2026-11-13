import { fromCents } from "@valwell/domain";
import { describe, expect, it } from "vitest";
import { runPipeline } from "./pipeline.js";
import { renderReport } from "./report.js";
import type { JobReview } from "./review.js";
import { buildContext } from "./testing/build-context.js";

describe("renderReport", () => {
  it("summarises by friction code and lists findings with evidence", () => {
    const ctx = buildContext();
    const labour = ctx.invoice.lines.find((l) => l.id === "IL-2");
    if (!labour) throw new Error("IL-2");
    labour.unitPrice = fromCents(9_000);
    labour.amount = fromCents(54_000);
    const md = renderReport({ jobsChecked: 1, ...runPipeline([ctx]) }, "unit");

    expect(md).toContain("# Reconciliation report: unit");
    expect(md).toContain("- Findings: **1** on **1** invoices");
    expect(md).toContain("| A1 |");
    expect(md).toMatch(/\| A1 \| .* \| 1 \| 1 \| 0 \| 0 \| \+\$30\.00 \|/);
    expect(md).toContain("### INV-T (JOB-T)");
    expect(md).toContain("**F-0001 · A1 · AUTO_FIX**: LAB-TECH billed at $90.00");
    expect(md).toContain("  - Route: billed at a superseded price-book version");
    expect(md).not.toContain("confidence");
    expect(md).toContain("PRICE_BOOK_ITEM `PB-LAB-TECH-v2`");
    // 840 + 540 + 440 + 440 = $2,260.00 billed; IL-2 auto-fixed +$30.00.
    expect(md).toContain(
      "- Drafted invoices: original **$2,260.00** − held **$0.00** + corrections **(+$30.00)** = draft **$2,290.00**",
    );
    expect(md).toContain("- Unattended draft: **READY** · original $2,260.00 · held $0.00");
  });

  it("reports a clean run as complete", () => {
    const md = renderReport({ jobsChecked: 1, ...runPipeline([buildContext()]) }, "clean");
    expect(md).toContain("(review complete 1, needs human review 0, incomplete 0)");
    expect(md).toContain("_No discrepancies found._");
    expect(md).toContain(
      "Proposed adjustments (sum per finding, not yet applied, may overlap): **$0.00**",
    );
    expect(md).toContain("Unattended drafts: READY 1, AWAITING_REVIEW 0");
  });

  it("never presents an incomplete job as clean", () => {
    const incomplete: JobReview = {
      jobId: "JOB-X",
      invoiceId: null,
      status: "INCOMPLETE",
      issues: [{ code: "MISSING_RECORD", invoiceLineId: null, message: "no invoice on file" }],
    };
    const md = renderReport(
      { jobsChecked: 0, reviews: [incomplete], findings: [], drafts: [] },
      "x",
    );
    expect(md).toContain("incomplete 1");
    expect(md).toContain("- **JOB-X** (no invoice) · INCOMPLETE");
    expect(md).toContain("  - MISSING_RECORD: no invoice on file");
    expect(md).not.toContain("_No discrepancies found._");
    expect(md).toContain("1 job(s) above still need a human");
  });
});
