import { describe, expect, it } from "vitest";
import { call, demoCaseState } from "../testing/demo-case.js";
import type { CaseState } from "./state.js";
import { executeCaseTool } from "./tools.js";

const DRAFT = {
  workSummary: "The valve stem was replaced during the repair.",
  businessReason:
    "The technician recorded the stem as bent beyond tolerance; the gate would not seat.",
  evidenceIds: ["F-0001", "WO-D4-L5", "WO-D4-N1"],
  missingInformation: [],
  customerRequestText:
    "We found the valve stem bent during the repair and replaced it. Please review this change order.",
};
const request = (s: CaseState, draft: unknown, line = "INV-D4-L5") =>
  executeCaseTool(
    s,
    call("draft_change_order_request", { job_id: "JOB-D4", invoice_line_id: line, draft }),
  );

/** Case 4 checked and held, optionally with the work order read. */
async function held(readWorkOrder = true): Promise<CaseState> {
  const s = await demoCaseState("4-unapproved-extra-work");
  for (const [name, input] of [
    ["validate_records", { job_id: "JOB-D4" }],
    ["reconcile_invoice", { job_id: "JOB-D4" }],
    ["prepare_draft", { job_id: "JOB-D4", apply_finding_ids: ["F-0001"] }],
    ...(readWorkOrder ? [["get_job_records", { job_id: "JOB-D4", record: "work_order" }]] : []),
  ] as [string, unknown][]) {
    executeCaseTool(s, call(name, input));
  }
  return s;
}

describe("draft_change_order_request", () => {
  it("records a validated request with deterministic amounts; the line stays held", async () => {
    const s = await held();
    expect(request(s, DRAFT)).toMatchObject({
      ok: true,
      content: { status: "DRAFTED", lineStillHeld: true },
    });
    expect(s.changeOrderRequests[0]?.request).toContain(
      "Amount (from the held invoice line, deterministic): 1 × $440.00 = $440.00",
    );
    expect(s.draft?.held.map((l) => l.id)).toEqual(["INV-D4-L5"]);
    expect(request(s, DRAFT).ok).toBe(true); // repeating replaces, never duplicates
    expect(s.changeOrderRequests).toHaveLength(1);
  });

  it("refuses a request for a line that is not held, or before any hold", async () => {
    expect(request(await demoCaseState("4-unapproved-extra-work"), DRAFT)).toEqual({
      ok: false,
      error: "INV-D4-L5 is not held in the current draft",
    });
    expect(request(await held(), DRAFT, "INV-D4-L1").ok).toBe(false);
  });

  it("rejects evidence the model never retrieved and text with amounts", async () => {
    expect(request(await held(false), DRAFT)).toEqual({
      ok: false,
      error:
        "change-order request rejected: evidence not returned by any tool in this run: WO-D4-N1; business reason does not cite a technician note or TDI finding",
    });
    const priced = { ...DRAFT, customerRequestText: "The stem costs $440.00." };
    expect(request(await held(), priced)).toMatchObject({
      ok: false,
      error: expect.stringContaining("text contains a monetary amount"),
    });
  });
});
