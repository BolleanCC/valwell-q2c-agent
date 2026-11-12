import {
  ChangeOrder,
  Customer,
  CustomerRules,
  Invoice,
  Job,
  PriceBookItem,
  Quote,
  WorkOrder,
} from "@valwell/domain";
import { z } from "zod";
import { readStoreFile } from "./json-file.js";

// ---- Quoting system: price book, quote revisions, change orders ----

export const QuotingStoreData = z.object({
  priceBook: z.array(PriceBookItem),
  quotes: z.array(Quote),
  changeOrders: z.array(ChangeOrder),
});
export type QuotingStoreData = z.infer<typeof QuotingStoreData>;

export interface QuotingRepository {
  priceBook(customerId: string): PriceBookItem[];
  quotesForJob(jobId: string): Quote[];
  changeOrdersForJob(jobId: string): ChangeOrder[];
}

export function quotingRepositoryFrom(data: QuotingStoreData): QuotingRepository {
  return {
    priceBook: (customerId) => data.priceBook.filter((p) => p.customerId === customerId),
    quotesForJob: (jobId) => data.quotes.filter((q) => q.jobId === jobId),
    changeOrdersForJob: (jobId) => data.changeOrders.filter((c) => c.jobId === jobId),
  };
}

// ---- Operations system: jobs and shop work orders ----

export const OpsStoreData = z.object({ jobs: z.array(Job), workOrders: z.array(WorkOrder) });
export type OpsStoreData = z.infer<typeof OpsStoreData>;

export interface OpsRepository {
  jobs(): Job[];
  job(jobId: string): Job | undefined;
  workOrderForJob(jobId: string): WorkOrder | undefined;
}

export function opsRepositoryFrom(data: OpsStoreData): OpsRepository {
  return {
    jobs: () => [...data.jobs],
    job: (jobId) => data.jobs.find((j) => j.id === jobId),
    workOrderForJob: (jobId) => data.workOrders.find((w) => w.jobId === jobId),
  };
}

// ---- Billing system: customers and invoices ----

export const BillingStoreData = z.object({
  customers: z.array(Customer),
  invoices: z.array(Invoice),
});
export type BillingStoreData = z.infer<typeof BillingStoreData>;

export interface BillingRepository {
  invoices(): Invoice[];
  invoice(invoiceId: string): Invoice | undefined;
  invoiceForJob(jobId: string): Invoice | undefined;
}

export function billingRepositoryFrom(data: BillingStoreData): BillingRepository {
  return {
    invoices: () => [...data.invoices],
    invoice: (id) => data.invoices.find((i) => i.id === id),
    invoiceForJob: (jobId) => data.invoices.find((i) => i.jobId === jobId),
  };
}

// ---- Contract (MSA) system: customers and their rules ----

export const MsaStoreData = z.object({
  customers: z.array(Customer),
  rules: z.array(CustomerRules),
});
export type MsaStoreData = z.infer<typeof MsaStoreData>;

export interface MsaRepository {
  customers(): Customer[];
  rulesFor(customerId: string): CustomerRules | undefined;
}

export function msaRepositoryFrom(data: MsaStoreData): MsaRepository {
  return {
    customers: () => [...data.customers],
    rulesFor: (customerId) => data.rules.find((r) => r.customerId === customerId),
  };
}

// ---- JSON-file openers: each reads only its own system's file ----

export const openQuotingStore = async (dir: string) =>
  quotingRepositoryFrom(await readStoreFile(dir, "quoting.json", QuotingStoreData));
export const openOpsStore = async (dir: string) =>
  opsRepositoryFrom(await readStoreFile(dir, "ops.json", OpsStoreData));
export const openBillingStore = async (dir: string) =>
  billingRepositoryFrom(await readStoreFile(dir, "billing.json", BillingStoreData));
export const openMsaStore = async (dir: string) =>
  msaRepositoryFrom(await readStoreFile(dir, "msa.json", MsaStoreData));
