import { callTools, type ScriptStep } from "@valwell/agent";

/**
 * OFFLINE MODE: fixed, scripted "model" turns for the four demo cases. They
 * are simulated LLM behaviour for a reliable, free demo, not model reasoning.
 * They go through the same loop, tools, permission checks and disposition
 * verification as a live model, so a script that broke a rule would fail.
 * Live mode never uses these.
 */

const checks = (job: string) =>
  callTools(["validate_records", { job_id: job }], ["reconcile_invoice", { job_id: job }]);
const draft = (job: string, ids: string[]) =>
  callTools(["prepare_draft", { job_id: job, apply_finding_ids: ids }]);
const portal = (job: string) => callTools(["submit_to_portal", { job_id: job }]);
const dispose = (
  job: string,
  outcome: string,
  findingIds: string[],
  evidenceIds: string[],
  summary: string,
  nextHumanAction: string,
) =>
  callTools([
    "submit_disposition",
    {
      job_id: job,
      outcome,
      summary,
      finding_ids: findingIds,
      evidence_ids: evidenceIds,
      next_human_action: nextHumanAction,
    },
  ]);

const SCRIPTS: Record<string, ScriptStep[][]> = {
  "1-normal-repair": [
    [
      checks("JOB-D1"),
      draft("JOB-D1", []),
      portal("JOB-D1"),
      dispose(
        "JOB-D1",
        "NO_CORRECTION_REQUIRED",
        [],
        ["JOB-D1", "INV-D1", "WO-D1", "RULE-CUST-D"],
        "Records are consistent and reconciliation found no supported discrepancy. The unchanged draft passed the simulated portal.",
        "None: the invoice can be released as drafted.",
      ),
    ],
  ],
  "2-price-entry-error": [
    [
      checks("JOB-D2"),
      callTools(["get_job_records", { job_id: "JOB-D2", record: "invoice" }]),
      draft("JOB-D2", []),
      dispose(
        "JOB-D2",
        "AWAITING_HUMAN_ACCEPTANCE",
        ["F-0001"],
        ["F-0001", "INV-D2-L2", "PB-D-LAB-TECH-v2", "WO-D2-L2"],
        "The labour line is billed at a price that matches no price-book version; the effective version is unambiguous. The correction is routed to REVIEW, so the draft waits and was not submitted.",
        "A reviewer must accept or reject F-0001 before the invoice can proceed.",
      ),
    ],
    [
      checks("JOB-D2"),
      draft("JOB-D2", ["F-0001"]),
      portal("JOB-D2"),
      dispose(
        "JOB-D2",
        "CORRECTED_AND_VALIDATED",
        ["F-0001"],
        ["F-0001", "INV-D2-L2", "PB-D-LAB-TECH-v2"],
        "After the reviewer accepted F-0001, the system applied the price-book rate to the labour line. The corrected draft passed the simulated portal.",
        "None: release the corrected invoice.",
      ),
    ],
  ],
  "3-markup-over-cap": [
    [
      checks("JOB-D3"),
      draft("JOB-D3", ["F-0001"]),
      portal("JOB-D3"),
      dispose(
        "JOB-D3",
        "CORRECTED_AND_VALIDATED",
        ["F-0001"],
        ["F-0001", "INV-D3-L3", "WO-D3-L3", "RULE-CUST-D"],
        "The seat ring was marked up above the contract cap. Invoice and work-order costs agree, so the AUTO_FIX was applied by id and the system computed the cap price. The corrected draft passed the simulated portal.",
        "None: release the corrected invoice.",
      ),
    ],
  ],
  "4-unapproved-extra-work": [
    [
      checks("JOB-D4"),
      draft("JOB-D4", ["F-0001"]),
      callTools(
        ["submit_to_portal", { job_id: "JOB-D4" }],
        ["get_job_records", { job_id: "JOB-D4", record: "work_order" }],
        ["get_job_records", { job_id: "JOB-D4", record: "change_orders" }],
      ),
      callTools([
        "draft_change_order_request",
        {
          job_id: "JOB-D4",
          invoice_line_id: "INV-D4-L5",
          draft: {
            workSummary:
              "The valve stem (PART-STEM) was replaced during the repair; it is not in the effective quote and no change order covers it.",
            businessReason:
              "The stem was recorded as bent at teardown, and technician note WO-D4-N1 explains why it was replaced.",
            evidenceIds: ["F-0001", "WO-D4-L5", "WO-D4-TDI-2", "WO-D4-N1"],
            missingInformation: [],
            customerRequestText:
              "During the repair of valve GV-1004 (PO PO-50004), our technician found the valve stem bent and replaced it. This work was not in the quote. Please review the attached change-order request and tell us whether you approve it.",
          },
        },
      ]),
      dispose(
        "JOB-D4",
        "PARTIAL_SUBMISSION_WITH_HOLD",
        ["F-0001"],
        ["F-0001", "WO-D4-L5", "WO-D4-N1", "INV-D4-L5"],
        "The stem is outside approved scope, so its line is held. The remaining lines passed the simulated portal, and a change-order request was drafted from the documented reason.",
        "Review and send the change-order request. The stem line stays held until the customer approves a change order.",
      ),
    ],
  ],
};

/** The scripted turns for one case and run (phase 0, or 1 after the human event). */
export function offlineScript(caseName: string, phase: number): ScriptStep[] {
  const steps = SCRIPTS[caseName]?.[phase];
  if (!steps) throw new Error(`no offline script for ${caseName} phase ${phase}`);
  return steps;
}
