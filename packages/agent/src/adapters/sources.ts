import type {
  ChangeOrder,
  CustomerRules,
  Invoice,
  Job,
  PriceBookItem,
  Quote,
  WorkOrder,
} from "@valwell/domain";
import type { PortalDecision } from "@valwell/mock-systems";
import type { JobReview } from "../review.js";

/**
 * The agent's ports. It reads the source systems only through these
 * interfaces, never through a mock system's internals, so real ERP or
 * portal integrations can replace the adapters without touching the core.
 */
export interface QuotingSource {
  priceBook(customerId: string): PriceBookItem[];
  quotesForJob(jobId: string): Quote[];
  changeOrdersForJob(jobId: string): ChangeOrder[];
}

export interface OpsSource {
  jobs(): Job[];
  workOrderForJob(jobId: string): WorkOrder | undefined;
}

export interface BillingSource {
  invoiceForJob(jobId: string): Invoice | undefined;
}

export interface ContractSource {
  rulesFor(customerId: string): CustomerRules | undefined;
}

/** The customer's invoice portal (simulated in this demo). */
export interface PortalSource {
  submit(invoice: Invoice): PortalDecision;
}

export interface Sources {
  quoting: QuotingSource;
  ops: OpsSource;
  billing: BillingSource;
  contract: ContractSource;
}

/** Everything the pipeline needs about one job, gathered from all systems. */
export interface JobContext {
  job: Job;
  quotes: Quote[];
  changeOrders: ChangeOrder[];
  workOrder: WorkOrder;
  invoice: Invoice;
  priceBook: PriceBookItem[];
  rules: CustomerRules;
}

/**
 * Gather a context per job. A job missing its work order, invoice or contract
 * rules is not guessed at: it is returned in `skipped` as an INCOMPLETE review
 * that names every missing record.
 */
export function collectJobContexts(sources: Sources): {
  contexts: JobContext[];
  skipped: JobReview[];
} {
  const contexts: JobContext[] = [];
  const skipped: JobReview[] = [];
  for (const job of sources.ops.jobs()) {
    const workOrder = sources.ops.workOrderForJob(job.id);
    const invoice = sources.billing.invoiceForJob(job.id);
    const rules = sources.contract.rulesFor(job.customerId);
    if (!workOrder || !invoice || !rules) {
      const missing = [
        !workOrder && "work order",
        !invoice && "invoice",
        !rules && `contract rules for ${job.customerId}`,
      ].filter((m): m is string => typeof m === "string");
      skipped.push({
        jobId: job.id,
        invoiceId: invoice?.id ?? null,
        status: "INCOMPLETE",
        issues: missing.map((m) => ({
          code: "MISSING_RECORD",
          invoiceLineId: null,
          message: `no ${m} on file for ${job.id}`,
        })),
      });
      continue;
    }
    contexts.push({
      job,
      quotes: sources.quoting.quotesForJob(job.id),
      changeOrders: sources.quoting.changeOrdersForJob(job.id),
      workOrder,
      invoice,
      priceBook: sources.quoting.priceBook(job.customerId),
      rules,
    });
  }
  return { contexts, skipped };
}
