import type { JobContext } from "./adapters/sources.js";

/** Why the agent could not fully check a job or line. Each one needs a human. */
export type ReviewIssueCode =
  // Job level: records missing or not belonging together (status INCOMPLETE).
  | "MISSING_RECORD"
  | "RECORD_MISMATCH"
  | "DATE_INCONSISTENT"
  // Line level: the line could not be matched or checked safely (status NEEDS_REVIEW).
  | "INVALID_SOURCE_REF"
  | "NO_WORK_RECORD"
  | "AMBIGUOUS_MATCH"
  | "KIND_MISMATCH"
  | "DUPLICATE_BILLING"
  | "EXTENSION_ERROR"
  | "MISSING_COST_EVIDENCE"
  | "COST_CONFLICT"
  | "NO_EFFECTIVE_PRICE"
  | "OVERLAPPING_PRICES";

export interface ReviewIssue {
  code: ReviewIssueCode;
  /** The invoice line concerned, or null for job-level problems. */
  invoiceLineId: string | null;
  message: string;
}

/**
 * COMPLETE: every supported check ran. The job may still have findings.
 * NEEDS_REVIEW: checks ran, but at least one line could not be decided safely.
 * INCOMPLETE: required records are missing or do not belong together, so no
 * rule checks ran. "Could not check" is never reported as "no issues".
 */
export type ReviewStatus = "COMPLETE" | "NEEDS_REVIEW" | "INCOMPLETE";

export interface JobReview {
  jobId: string;
  invoiceId: string | null;
  status: ReviewStatus;
  issues: ReviewIssue[];
}

const jobIssue = (code: ReviewIssueCode, message: string): ReviewIssue => ({
  code,
  invoiceLineId: null,
  message,
});

/**
 * Check that a job's records belong together before any rule runs.
 *
 * Identity is compared by stable ids (job, customer, PO), never by display
 * names. Dates are compared by meaning: the invoice must carry the job's
 * service date (it selects the effective price), work cannot precede receipt
 * and the invoice cannot precede the work. Quote, change-order and invoice
 * dates are otherwise expected to differ.
 */
export function checkRecordLinks(ctx: JobContext): ReviewIssue[] {
  const { job, invoice, workOrder, rules, quotes, changeOrders } = ctx;
  const issues: ReviewIssue[] = [];
  const mismatch = (what: string, actual: string, expected: string) =>
    issues.push(jobIssue("RECORD_MISMATCH", `${what} is ${actual}, expected ${expected}`));

  if (quotes.length === 0)
    issues.push(jobIssue("MISSING_RECORD", `no quote on file for ${job.id}`));
  if (invoice.jobId !== job.id) mismatch(`invoice ${invoice.id} job`, invoice.jobId, job.id);
  if (workOrder.jobId !== job.id)
    mismatch(`work order ${workOrder.id} job`, workOrder.jobId, job.id);
  for (const q of quotes) {
    if (q.jobId !== job.id) mismatch(`quote ${q.id} job`, q.jobId, job.id);
    if (q.customerId !== job.customerId)
      mismatch(`quote ${q.id} customer`, q.customerId, job.customerId);
  }
  for (const c of changeOrders) {
    if (c.jobId !== job.id) mismatch(`change order ${c.id} job`, c.jobId, job.id);
  }
  if (invoice.customerId !== job.customerId)
    mismatch(`invoice ${invoice.id} customer`, invoice.customerId, job.customerId);
  if (rules.customerId !== job.customerId)
    mismatch(`contract rules ${rules.id} customer`, rules.customerId, job.customerId);
  if (invoice.poNumber !== job.poNumber)
    mismatch(`invoice ${invoice.id} PO`, invoice.poNumber, job.poNumber);

  if (invoice.serviceDate !== job.serviceDate) {
    issues.push(
      jobIssue(
        "DATE_INCONSISTENT",
        `invoice service date ${invoice.serviceDate} differs from the job's ${job.serviceDate}; the service date selects the effective price`,
      ),
    );
  }
  if (job.serviceDate < job.receivedDate) {
    issues.push(
      jobIssue(
        "DATE_INCONSISTENT",
        `service date ${job.serviceDate} is before the valve was received (${job.receivedDate})`,
      ),
    );
  }
  if (invoice.invoiceDate < job.serviceDate) {
    issues.push(
      jobIssue(
        "DATE_INCONSISTENT",
        `invoice date ${invoice.invoiceDate} is before the service date ${job.serviceDate}`,
      ),
    );
  }
  return issues;
}
