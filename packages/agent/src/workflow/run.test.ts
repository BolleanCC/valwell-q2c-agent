import { describe, expect, it } from "vitest";
import type { ModelTurn } from "../llm/loop.js";
import { callTools, scriptedProvider } from "../llm/scripted.js";
import { demoCaseState } from "../testing/demo-case.js";
import { CASE_LIMITS, runCaseWorkflow } from "./run.js";
import { acceptFinding } from "./state.js";

const checks = (job: string) =>
  callTools(["validate_records", { job_id: job }], ["reconcile_invoice", { job_id: job }]);
const dispose = (job: string, outcome: string, findingIds: string[], evidence: string[]) =>
  callTools([
    "submit_disposition",
    {
      job_id: job,
      outcome,
      summary: "Outcome established by the reconciliation tools.",
      finding_ids: findingIds,
      evidence_ids: evidence,
      next_human_action: "See the disposition.",
    },
  ]);
const stop: ModelTurn = { stopReason: "end_turn", text: "Done.", toolCalls: [] };

describe("runCaseWorkflow", () => {
  it("case 1: the model checks, drafts, submits and finishes with a verified disposition", async () => {
    const s = await demoCaseState("1-normal-repair");
    const { provider, tasks } = scriptedProvider([
      checks("JOB-D1"),
      callTools(["prepare_draft", { job_id: "JOB-D1", apply_finding_ids: [] }]),
      callTools(["submit_to_portal", { job_id: "JOB-D1" }]),
      dispose("JOB-D1", "NO_CORRECTION_REQUIRED", [], ["INV-D1", "WO-D1"]),
    ]);
    const run = await runCaseWorkflow(s, provider);
    expect(run).toMatchObject({ status: "DISPOSITION_ACCEPTED", mode: "offline", problems: [] });
    expect(run.disposition).toMatchObject({
      outcome: "NO_CORRECTION_REQUIRED",
      facts: { portal: "APPROVED" },
    });
    expect(run.trace.map((t) => t.tool)).toEqual([
      "validate_records",
      "reconcile_invoice",
      "prepare_draft",
      "submit_to_portal",
      "submit_disposition",
    ]);
    // The prompt carries ids only; records come from tools.
    expect(tasks[0]?.prompt).toBe(
      "Case: reconcile invoice INV-D1 for job JOB-D1 before it is sent.",
    );
  });

  it("refuses a disposition that skips the required checks; without one the run is incomplete", async () => {
    const s = await demoCaseState("1-normal-repair");
    const run = await runCaseWorkflow(
      s,
      scriptedProvider([dispose("JOB-D1", "NO_CORRECTION_REQUIRED", [], ["INV-D1"]), stop])
        .provider,
    );
    expect(run.trace[0]).toMatchObject({
      ok: false,
      summary: expect.stringContaining("validate_records was not run"),
    });
    expect(run).toMatchObject({ status: "INVALID_OUTPUT", disposition: null });
  });

  it("case 2: cannot self-approve or submit; waits; resumes after a human event", async () => {
    const s = await demoCaseState("2-price-entry-error");
    const first = await runCaseWorkflow(
      s,
      scriptedProvider([
        checks("JOB-D2"),
        callTools(
          ["accept_finding", { job_id: "JOB-D2", finding_id: "F-0001" }],
          ["prepare_draft", { job_id: "JOB-D2", apply_finding_ids: ["F-0001"] }],
          ["submit_to_portal", { job_id: "JOB-D2" }],
        ),
        dispose("JOB-D2", "AWAITING_HUMAN_ACCEPTANCE", ["F-0001"], ["F-0001", "PB-D-LAB-TECH-v2"]),
      ]).provider,
    );
    expect(first.trace.slice(2).map((t) => [t.tool, t.ok])).toEqual([
      ["accept_finding", false],
      ["prepare_draft", false],
      ["submit_to_portal", false],
      ["submit_disposition", true],
    ]);
    expect(s.findings[0]?.status).toBe("OPEN");
    expect(s.portalDecision).toBeNull();

    acceptFinding(s, "F-0001", "Simulated reviewer");
    const { provider, tasks } = scriptedProvider([
      callTools(["prepare_draft", { job_id: "JOB-D2", apply_finding_ids: ["F-0001"] }]),
      callTools(["submit_to_portal", { job_id: "JOB-D2" }]),
      dispose("JOB-D2", "CORRECTED_AND_VALIDATED", ["F-0001"], ["F-0001", "INV-D2-L2"]),
    ]);
    const resumed = await runCaseWorkflow(s, provider, { humanEvent: s.humanEvents[0] ?? "" });
    expect(tasks[0]?.prompt).toContain("Simulated reviewer accepted F-0001");
    expect(resumed.disposition).toMatchObject({
      outcome: "CORRECTED_AND_VALIDATED",
      facts: { portal: "APPROVED", totals: { draft: 220_000, corrections: 21_600 } },
    });
  });

  it("refuses another job's ids through the loop", async () => {
    const s = await demoCaseState("3-markup-over-cap");
    const run = await runCaseWorkflow(
      s,
      scriptedProvider([
        callTools(["get_job_records", { job_id: "JOB-D4", record: "work_order" }]),
        stop,
      ]).provider,
    );
    expect(run.trace[0]).toMatchObject({
      ok: false,
      summary: "job JOB-D4 is outside this case (JOB-D3)",
    });
  });

  it("stops at the turn limit with no disposition", async () => {
    const s = await demoCaseState("1-normal-repair");
    const loop = Array.from({ length: 12 }, () =>
      callTools(["validate_records", { job_id: "JOB-D1" }]),
    );
    const run = await runCaseWorkflow(s, scriptedProvider(loop).provider);
    expect(run).toMatchObject({ status: "LIMIT_REACHED", disposition: null });
    expect(run.trace).toHaveLength(CASE_LIMITS.maxTurns);
  });

  it("case 4: a provider failure after the hold keeps the held amount and produces no disposition", async () => {
    const s = await demoCaseState("4-unapproved-extra-work");
    const run = await runCaseWorkflow(
      s,
      scriptedProvider([
        checks("JOB-D4"),
        callTools(["prepare_draft", { job_id: "JOB-D4", apply_finding_ids: ["F-0001"] }]),
        new Error("529 overloaded"),
      ]).provider,
    );
    expect(run).toMatchObject({
      status: "PROVIDER_FAILURE",
      problems: ["529 overloaded"],
      disposition: null,
    });
    expect(s.draft?.held.map((l) => [l.id, l.amount])).toEqual([["INV-D4-L5", 44_000]]);
    expect(s.portalDecision).toBeNull(); // nothing continued downstream
  });
});
