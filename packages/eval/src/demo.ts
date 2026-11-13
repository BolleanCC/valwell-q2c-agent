import {
  type AgentRun,
  acceptAll,
  applyFindings,
  type FixResult,
  type JobReview,
  openBatchSources,
  runAgent,
} from "@valwell/agent";
import type { Invoice } from "@valwell/domain";
import { openPortal, type PortalDecision } from "@valwell/mock-systems";

/** A draft and, when it is READY, the simulated portal's decision on it. */
export interface DraftOutcome extends FixResult {
  /** null when the draft was not READY and therefore not submitted. */
  portal: PortalDecision | null;
}

export interface DemoCaseResult {
  run: AgentRun;
  review: JobReview;
  original: { invoice: Invoice; portal: PortalDecision };
  /** What the agent does on its own: AUTO_FIX corrections and BLOCK holds. */
  unattended: DraftOutcome;
  /** After a simulated reviewer accepts every OPEN finding. Not customer approval. */
  afterAcceptance: DraftOutcome;
}

/**
 * Run one fixed demo case: a directory with the four source-system stores and
 * the portal's store for a single job. No generator and no fault labels.
 */
export async function runDemoCase(dir: string): Promise<DemoCaseResult> {
  const sources = await openBatchSources(dir);
  const portal = await openPortal(dir);
  const run = runAgent(sources);
  const [review] = run.reviews;
  if (run.reviews.length !== 1 || !review) throw new Error(`${dir}: a demo case has one job`);
  const invoice = sources.billing.invoiceForJob(review.jobId);
  if (!invoice) throw new Error(`${dir}: no invoice for ${review.jobId}`);

  const submit = (draft: FixResult): DraftOutcome => ({
    ...draft,
    portal: draft.status === "READY" && draft.invoice ? portal.submit(draft.invoice) : null,
  });
  return {
    run,
    review,
    original: { invoice, portal: portal.submit(invoice) },
    unattended: submit(applyFindings(invoice, run.findings, review)),
    afterAcceptance: submit(applyFindings(invoice, acceptAll(run.findings), review)),
  };
}
