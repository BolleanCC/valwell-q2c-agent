import { describe, expect, it } from "vitest";
import { call, demoCaseState } from "../testing/demo-case.js";
import { acceptFinding, type CaseState } from "./state.js";
import { executeCaseTool } from "./tools.js";

/** Load a case and run the two required checks, as a model would first. */
async function checked(name: string): Promise<CaseState> {
  const s = await demoCaseState(name);
  executeCaseTool(s, call("validate_records", { job_id: s.ctx.job.id }));
  executeCaseTool(s, call("reconcile_invoice", { job_id: s.ctx.job.id }));
  return s;
}
const prepare = (s: CaseState, ids: string[]) =>
  executeCaseTool(s, call("prepare_draft", { job_id: s.ctx.job.id, apply_finding_ids: ids }));
const submit = (s: CaseState) =>
  executeCaseTool(s, call("submit_to_portal", { job_id: s.ctx.job.id }));

describe("prepare_draft and submit_to_portal", () => {
  it("case 1: prepares the unchanged draft and the simulated portal approves it", async () => {
    const s = await checked("1-normal-repair");
    expect(prepare(s, [])).toMatchObject({
      ok: true,
      summary: "draft READY; changes 0; held 0; total $2,200.00",
    });
    expect(submit(s)).toMatchObject({ ok: true, content: { simulated: true, status: "APPROVED" } });
  });

  it("refuses a draft before reconciliation and a submission before a draft", async () => {
    const s = await demoCaseState("1-normal-repair");
    expect(prepare(s, [])).toEqual({ ok: false, error: "call reconcile_invoice first" });
    expect(submit(s)).toEqual({ ok: false, error: "no draft: call prepare_draft first" });
  });

  it("case 2: the model cannot apply its REVIEW finding or submit until a human accepts it", async () => {
    const s = await checked("2-price-entry-error");
    expect(prepare(s, ["F-0001"])).toMatchObject({
      ok: false,
      error: expect.stringContaining("needs human acceptance"),
    });
    expect(prepare(s, [])).toMatchObject({
      ok: true,
      content: { status: "AWAITING_REVIEW", awaitingHumanAcceptance: ["F-0001"] },
    });
    expect(submit(s)).toEqual({
      ok: false,
      error: "draft is AWAITING_REVIEW; only a READY draft may be submitted",
    });
    expect(s.portalDecision).toBeNull();

    acceptFinding(s, "F-0001", "Simulated reviewer");
    expect(prepare(s, ["F-0001"])).toMatchObject({
      ok: true,
      content: {
        status: "READY",
        changes: [{ invoiceLineId: "INV-D2-L2", before: "$354.00", after: "$570.00" }],
      },
    });
    expect(submit(s)).toMatchObject({ ok: true, content: { status: "APPROVED" } });
  });

  it("case 3: applies the AUTO_FIX by id only, and repeating it changes nothing more", async () => {
    const s = await checked("3-markup-over-cap");
    const priced = executeCaseTool(
      s,
      call("prepare_draft", {
        job_id: "JOB-D3",
        apply_finding_ids: ["F-0001"],
        unit_price: 20_000,
      }),
    );
    expect(priced).toMatchObject({ ok: false, error: expect.stringContaining("Unrecognized key") });
    expect(prepare(s, ["F-0001"])).toMatchObject({
      ok: true,
      summary: "draft READY; changes 1; held 0; total $2,200.00",
    });
    expect(prepare(s, ["F-0001"])).toMatchObject({
      ok: true,
      summary: "draft READY; changes 1; held 0; total $2,200.00",
    });
    expect(s.draft?.totals).toEqual({
      original: 226_000,
      held: 0,
      draft: 220_000,
      corrections: -6_000,
    });
    expect(submit(s)).toMatchObject({ ok: true, content: { status: "APPROVED" } });
  });

  it("case 3 variant: conflicting cost evidence blocks any draft", async () => {
    const s = await demoCaseState("3-markup-over-cap");
    Object.assign(s.ctx.invoice.lines[2] ?? {}, { unitCost: 21_000 }); // disagrees with the work order
    executeCaseTool(s, call("validate_records", { job_id: "JOB-D3" }));
    expect(executeCaseTool(s, call("reconcile_invoice", { job_id: "JOB-D3" }))).toMatchObject({
      ok: true,
      summary: "review NEEDS_REVIEW; findings: none",
    });
    expect(prepare(s, [])).toMatchObject({
      ok: false,
      error: expect.stringContaining("NEEDS_REVIEW"),
    });
  });

  it("case 4: the unapproved line must be held, at its original amount", async () => {
    const s = await checked("4-unapproved-extra-work");
    expect(prepare(s, [])).toEqual({
      ok: false,
      error: "F-0001 must be held: work outside approved scope cannot be submitted",
    });
    expect(prepare(s, ["F-0001", "F-9999"])).toEqual({
      ok: false,
      error: "unknown finding ids: F-9999",
    });
    expect(prepare(s, ["F-0001"])).toMatchObject({
      ok: true,
      content: { status: "READY", held: [{ invoiceLineId: "INV-D4-L5", amount: "$440.00" }] },
    });
    expect(submit(s)).toMatchObject({ ok: true, content: { status: "APPROVED" } });
  });
});
