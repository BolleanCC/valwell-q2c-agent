import { describe, expect, it } from "vitest";
import { call, demoCaseState } from "../testing/demo-case.js";
import type { CaseState } from "./state.js";
import { executeCaseTool } from "./tools.js";

/** Run tool calls in order, as a model would, against a fresh demo case. */
async function after(name: string, calls: [string, Record<string, unknown>][]): Promise<CaseState> {
  const s = await demoCaseState(name);
  for (const [tool, args] of calls)
    executeCaseTool(s, call(tool, { job_id: s.ctx.job.id, ...args }));
  return s;
}
const CHECKS: [string, Record<string, unknown>][] = [
  ["validate_records", {}],
  ["reconcile_invoice", {}],
];
const dispose = (s: CaseState, d: Record<string, unknown>) =>
  executeCaseTool(
    s,
    call("submit_disposition", {
      job_id: s.ctx.job.id,
      summary: "Checked the records and reconciliation.",
      finding_ids: [],
      evidence_ids: [s.ctx.invoice.id],
      next_human_action: "None.",
      ...d,
    }),
  );

describe("submit_disposition", () => {
  it("accepts a disposition that matches the case state and records verified facts", async () => {
    const s = await after("1-normal-repair", [
      ...CHECKS,
      ["prepare_draft", { apply_finding_ids: [] }],
      ["submit_to_portal", {}],
    ]);
    expect(dispose(s, { outcome: "NO_CORRECTION_REQUIRED" })).toMatchObject({
      ok: true,
      final: true,
    });
    expect(s.disposition?.facts).toMatchObject({
      reviewStatus: "COMPLETE",
      draftStatus: "READY",
      portal: "APPROVED",
      heldLineIds: [],
    });
  });

  it("does not let a model assert checks or a portal result that did not happen", async () => {
    const unchecked = await demoCaseState("1-normal-repair");
    expect(
      dispose(unchecked, { outcome: "NO_CORRECTION_REQUIRED", evidence_ids: ["INV-D1"] }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("required check validate_records was not run"),
    });
    const noPortal = await after("1-normal-repair", [
      ...CHECKS,
      ["prepare_draft", { apply_finding_ids: [] }],
    ]);
    expect(dispose(noPortal, { outcome: "NO_CORRECTION_REQUIRED" })).toEqual({
      ok: false,
      error: "disposition rejected: the simulated portal has not approved a READY draft",
    });
  });

  it("case 2: rejects a false outcome, omitted findings, unreturned evidence, amounts and claims", async () => {
    const s = await after("2-price-entry-error", CHECKS);
    const wait = { outcome: "AWAITING_HUMAN_ACCEPTANCE", finding_ids: ["F-0001"] };
    expect(dispose(s, { ...wait, outcome: "CORRECTED_AND_VALIDATED" }).ok).toBe(false);
    expect(dispose(s, { ...wait, evidence_ids: ["F-0001", "PB-D-LAB-TECH-v2"] }).ok).toBe(true);
    const r = dispose(s, {
      outcome: "AWAITING_HUMAN_ACCEPTANCE",
      summary: "Customer approved the $570.00 labour line.",
      evidence_ids: ["PB-D-LAB-TECH-v9"],
    });
    expect(r).toEqual({
      ok: false,
      error:
        "disposition rejected: finding_ids must list exactly the case's findings: [F-0001]; evidence not returned by any tool: PB-D-LAB-TECH-v9; text contains a monetary amount; amounts come from the tools; text claims customer approval or payment",
    });
  });

  it("case 4: a partial submission needs a change-order request for the held line", async () => {
    const s = await after("4-unapproved-extra-work", [
      ...CHECKS,
      ["prepare_draft", { apply_finding_ids: ["F-0001"] }],
      ["submit_to_portal", {}],
    ]);
    expect(
      dispose(s, { outcome: "PARTIAL_SUBMISSION_WITH_HOLD", finding_ids: ["F-0001"] }),
    ).toEqual({
      ok: false,
      error: "disposition rejected: every held line needs a change-order request draft",
    });
  });
});
