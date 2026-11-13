import { z } from "zod";
import type { DraftStatus, DraftTotals } from "../fix.js";
import { MONEY } from "../llm/draft.js";
import type { ToolExecution } from "../llm/loop.js";
import type { CaseState } from "./state.js";

export const OUTCOMES = [
  "NO_CORRECTION_REQUIRED",
  "CORRECTED_AND_VALIDATED",
  "AWAITING_HUMAN_ACCEPTANCE",
  "PARTIAL_SUBMISSION_WITH_HOLD",
  "NEEDS_HUMAN_REVIEW",
  "PORTAL_REJECTED",
] as const;

/** What the model submits to finish a case. No amounts: facts come from state. */
export const DispositionArgs = z
  .object({
    job_id: z.string(),
    outcome: z.enum(OUTCOMES),
    summary: z.string().trim().min(1).max(800),
    finding_ids: z.array(z.string()).max(20),
    evidence_ids: z.array(z.string()).min(1).max(30),
    next_human_action: z.string().trim().min(1).max(400),
  })
  .strict();
export type DispositionArgs = z.infer<typeof DispositionArgs>;

/** Facts taken from the case state by code, shown next to the model's words. */
export interface VerifiedFacts {
  reviewStatus: string | null;
  findings: { id: string; frictionCode: string; route: string | null; status: string }[];
  draftStatus: DraftStatus | null;
  totals: DraftTotals | null;
  heldLineIds: string[];
  portal: "APPROVED" | "REJECTED" | "NOT_SUBMITTED";
  changeOrderRequests: { invoiceLineId: string; status: string }[];
}

/** The accepted disposition: the model's words plus facts taken from state. */
export type CaseDisposition = DispositionArgs & { facts: VerifiedFacts };

const CUSTOMER_CLAIM = /\b(customer (?:has )?approved|paid|payment received)\b/i;

export function factsOf(state: CaseState): VerifiedFacts {
  return {
    reviewStatus: state.review?.status ?? null,
    findings: state.findings.map(({ id, frictionCode, route, status }) => ({
      id,
      frictionCode,
      route,
      status,
    })),
    draftStatus: state.draft?.status ?? null,
    totals: state.draft?.totals ?? null,
    heldLineIds: state.draft?.held.map((l) => l.id) ?? [],
    portal: state.portalDecision?.status ?? "NOT_SUBMITTED",
    changeOrderRequests: state.changeOrderRequests.map(({ invoiceLineId, status }) => ({
      invoiceLineId,
      status,
    })),
  };
}

/**
 * Check a proposed disposition against what the tools actually established.
 * A model's assertion never counts as a passed check: every outcome needs the
 * matching state, recorded by tool calls in this case.
 */
export function verifyDisposition(state: CaseState, d: DispositionArgs): string[] {
  const problems: string[] = [];
  const need = (ok: boolean, why: string) => {
    if (!ok) problems.push(why);
  };
  const draft = state.draft;
  const ready = draft?.status === "READY";
  const approved = state.portalDecision?.status === "APPROVED";
  const recordsFailed = state.recordCheck?.passed === false;

  need(state.recordCheck !== null, "required check validate_records was not run");
  if (!recordsFailed) need(state.review !== null, "required check reconcile_invoice was not run");
  const actual = state.findings.map((f) => f.id).sort();
  need(
    JSON.stringify([...d.finding_ids].sort()) === JSON.stringify(actual),
    `finding_ids must list exactly the case's findings: [${actual.join(", ")}]`,
  );
  const unknown = d.evidence_ids.filter((id) => !state.evidence.has(id));
  need(unknown.length === 0, `evidence not returned by any tool: ${unknown.join(", ")}`);
  const text = `${d.summary} ${d.next_human_action}`;
  need(!MONEY.test(text), "text contains a monetary amount; amounts come from the tools");
  need(!CUSTOMER_CLAIM.test(text), "text claims customer approval or payment");

  switch (d.outcome) {
    case "NO_CORRECTION_REQUIRED":
      need(
        state.review?.status === "COMPLETE" && state.findings.length === 0,
        "reconciliation did not come back clean",
      );
      need(
        ready && draft.changes.length === 0 && draft.held.length === 0,
        "no unchanged READY draft was prepared",
      );
      need(approved, "the simulated portal has not approved a READY draft");
      break;
    case "CORRECTED_AND_VALIDATED":
      need(
        ready && draft.changes.length > 0 && draft.held.length === 0,
        "no corrected READY draft without holds",
      );
      need(approved, "the simulated portal has not approved a READY draft");
      break;
    case "AWAITING_HUMAN_ACCEPTANCE":
      need(
        state.findings.some((f) => f.status === "OPEN" && f.route === "REVIEW"),
        "no finding is waiting for human acceptance",
      );
      need(state.portalDecision === null, "a draft was already submitted");
      break;
    case "PARTIAL_SUBMISSION_WITH_HOLD":
      need(ready && draft.held.length > 0, "no READY draft with a held line");
      need(approved, "the simulated portal has not approved a READY draft");
      need(
        (draft?.held ?? []).every((l) =>
          state.changeOrderRequests.some((r) => r.invoiceLineId === l.id),
        ),
        "every held line needs a change-order request draft",
      );
      break;
    case "NEEDS_HUMAN_REVIEW":
      need(
        recordsFailed || (state.review !== null && state.review.status !== "COMPLETE"),
        "the checks passed; the case does not need input review",
      );
      break;
    case "PORTAL_REJECTED":
      need(
        state.portalDecision?.status === "REJECTED",
        "the simulated portal did not reject a draft",
      );
      break;
  }
  return problems;
}

/** The finishing tool. A rejected disposition goes back to the model as a tool error. */
export function recordDisposition(state: CaseState, d: DispositionArgs): ToolExecution {
  const problems = verifyDisposition(state, d);
  if (problems.length > 0)
    return { ok: false, error: `disposition rejected: ${problems.join("; ")}` };
  state.disposition = { ...d, facts: factsOf(state) };
  return {
    ok: true,
    content: { accepted: true },
    summary: `disposition ${d.outcome} verified against case state`,
    final: true,
  };
}
