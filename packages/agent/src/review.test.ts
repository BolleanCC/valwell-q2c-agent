import { describe, expect, it } from "vitest";
import { runPipeline } from "./pipeline.js";
import { checkRecordLinks } from "./review.js";
import { buildContext } from "./testing/build-context.js";

// Object.assign below sets plain strings on branded-id fields without casts.

describe("checkRecordLinks", () => {
  it("accepts a consistent job whose document dates legitimately differ", () => {
    // Quote issued 03-02/03-04, received 03-01, service 03-10, invoice 03-12.
    expect(checkRecordLinks(buildContext())).toEqual([]);
  });

  it("flags a customer id conflict between invoice and job", () => {
    const ctx = buildContext();
    Object.assign(ctx.invoice, { customerId: "CUST-OTHER" });
    expect(checkRecordLinks(ctx)).toEqual([
      {
        code: "RECORD_MISMATCH",
        invoiceLineId: null,
        message: "invoice INV-T customer is CUST-OTHER, expected CUST-T",
      },
    ]);
  });

  it("flags a wrong PO and a work order filed against another job", () => {
    const ctx = buildContext();
    Object.assign(ctx.invoice, { poNumber: "PO-999" });
    Object.assign(ctx.workOrder, { jobId: "JOB-OTHER" });
    expect(checkRecordLinks(ctx).map((i) => i.message)).toEqual([
      "work order WO-T job is JOB-OTHER, expected JOB-T",
      "invoice INV-T PO is PO-999, expected PO-1",
    ]);
  });

  it("flags a missing quote", () => {
    const ctx = buildContext();
    ctx.quotes = [];
    expect(checkRecordLinks(ctx)).toEqual([
      { code: "MISSING_RECORD", invoiceLineId: null, message: "no quote on file for JOB-T" },
    ]);
  });

  it("flags dates that contradict their meaning", () => {
    const ctx = buildContext();
    Object.assign(ctx.invoice, { serviceDate: "2026-03-11", invoiceDate: "2026-03-09" });
    const issues = checkRecordLinks(ctx);
    expect(issues.map((i) => i.code)).toEqual(["DATE_INCONSISTENT", "DATE_INCONSISTENT"]);
    expect(issues[0]?.message).toContain("selects the effective price");
    expect(issues[1]?.message).toContain("before the service date");
  });
});

describe("runPipeline with inconsistent records", () => {
  it("marks the job INCOMPLETE and runs no rule checks", () => {
    const ctx = buildContext();
    Object.assign(ctx.invoice, { customerId: "CUST-OTHER" });
    const { reviews, findings } = runPipeline([ctx]);
    expect(findings).toEqual([]);
    expect(reviews).toMatchObject([{ jobId: "JOB-T", status: "INCOMPLETE" }]);
  });
});
