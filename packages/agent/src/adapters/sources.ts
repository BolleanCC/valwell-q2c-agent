import type {
  ChangeOrder,
  CustomerRules,
  Invoice,
  Job,
  PriceBookItem,
  Quote,
  WorkOrder,
} from "@valwell/domain";

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

export interface SkippedJob {
  jobId: string;
  reason: string;
}

/** Gather a context per job. Jobs missing a work order, invoice or rules are skipped, not guessed. */
export function collectJobContexts(sources: Sources): {
  contexts: JobContext[];
  skipped: SkippedJob[];
} {
  const contexts: JobContext[] = [];
  const skipped: SkippedJob[] = [];
  for (const job of sources.ops.jobs()) {
    const workOrder = sources.ops.workOrderForJob(job.id);
    const invoice = sources.billing.invoiceForJob(job.id);
    const rules = sources.contract.rulesFor(job.customerId);
    if (!workOrder || !invoice || !rules) {
      const missing = [!workOrder && "work order", !invoice && "invoice", !rules && "rules"];
      skipped.push({ jobId: job.id, reason: `missing ${missing.filter(Boolean).join(", ")}` });
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
