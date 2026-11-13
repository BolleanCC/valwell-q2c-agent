import { describe, expect, it } from "vitest";
import { call, demoCaseState } from "../testing/demo-case.js";
import { acceptFinding } from "./state.js";
import { executeCaseTool } from "./tools.js";

const run = executeCaseTool;

describe("case tools: records and reconciliation", () => {
  it("validates records, then returns deterministic findings with authoritative amounts", async () => {
    const s = await demoCaseState("2-price-entry-error");
    expect(run(s, call("validate_records", { job_id: "JOB-D2" }))).toMatchObject({
      ok: true,
      summary: "RECORDS_CONSISTENT",
    });
    const r = run(s, call("reconcile_invoice", { job_id: "JOB-D2" }));
    expect(r).toMatchObject({
      ok: true,
      summary: "review COMPLETE; findings: F-0001 A1 REVIEW OPEN",
      content: {
        findings: [
          {
            id: "F-0001",
            invoiceLineId: "INV-D2-L2",
            proposedAction: "Reprice LAB-TECH to $95.00 (v2)",
            proposedAmountChange: "+$216.00",
          },
        ],
      },
    });
    expect(s.evidence.get("PB-D-LAB-TECH-v2")).toBe("PRICE_BOOK_ITEM");
    expect(s.evidence.get("F-0001")).toBe("FINDING");
  });

  it("refuses reconciliation before records are validated, or when they are inconsistent", async () => {
    const s = await demoCaseState("1-normal-repair");
    expect(run(s, call("reconcile_invoice", { job_id: "JOB-D1" }))).toEqual({
      ok: false,
      error: "call validate_records first",
    });
    Object.assign(s.ctx.invoice, { customerId: "CUST-OTHER" });
    expect(run(s, call("validate_records", { job_id: "JOB-D1" }))).toMatchObject({
      ok: true,
      summary: "INCOMPLETE: RECORD_MISMATCH",
    });
    expect(run(s, call("reconcile_invoice", { job_id: "JOB-D1" })).ok).toBe(false);
    expect(s.review).toBeNull();
  });

  it("keeps findings stable when reconciliation is requested again", async () => {
    const s = await demoCaseState("3-markup-over-cap");
    run(s, call("validate_records", { job_id: "JOB-D3" }));
    run(s, call("reconcile_invoice", { job_id: "JOB-D3" }));
    const first = structuredClone(s.findings);
    run(s, call("reconcile_invoice", { job_id: "JOB-D3" }));
    expect(s.findings).toEqual(first);
  });

  it("reads records for the job and refuses other jobs, bad arguments and unknown tools", async () => {
    const s = await demoCaseState("4-unapproved-extra-work");
    const before = structuredClone(s.ctx);
    expect(
      run(s, call("get_job_records", { job_id: "JOB-D4", record: "work_order" })),
    ).toMatchObject({
      ok: true,
      summary: expect.stringContaining("WO-D4-N1"),
    });
    expect(run(s, call("get_job_records", { job_id: "JOB-D4", record: "invoice" })).ok).toBe(true);
    expect(run(s, call("get_job_records", { job_id: "JOB-D1", record: "invoice" }))).toEqual({
      ok: false,
      error: "job JOB-D1 is outside this case (JOB-D4)",
    });
    expect(run(s, call("get_job_records", { job_id: "JOB-D4", record: "price_book" })).ok).toBe(
      false,
    );
    expect(run(s, call("approve_finding", { job_id: "JOB-D4" }))).toEqual({
      ok: false,
      error: "unknown tool approve_finding",
    });
    expect(s.ctx).toEqual(before);
  });
});

describe("acceptFinding (application event, not a tool)", () => {
  it("accepts only an OPEN REVIEW finding and records who did it", async () => {
    const s = await demoCaseState("2-price-entry-error");
    run(s, call("validate_records", { job_id: "JOB-D2" }));
    run(s, call("reconcile_invoice", { job_id: "JOB-D2" }));
    acceptFinding(s, "F-0001", "Simulated reviewer");
    expect(s.findings[0]?.status).toBe("ACCEPTED");
    expect(s.humanEvents).toEqual([
      "Simulated reviewer accepted F-0001 (Reprice LAB-TECH to $95.00 (v2))",
    ]);
    expect(() => acceptFinding(s, "F-0001", "again")).toThrow("not an OPEN REVIEW finding");
  });
});
