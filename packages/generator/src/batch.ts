import type { FaultLabel, FrictionCode } from "@valwell/domain";
import { DEFAULT_RATES, type InjectionRates, type Injector, injectFaults } from "./inject.js";
import { a1StalePrice } from "./injectors/a1-stale-price.js";
import { a3MarkupCap } from "./injectors/a3-markup-cap.js";
import { b1ScopeChange } from "./injectors/b1-scope-change.js";
import { generateJob } from "./job.js";
import { generateReferenceData } from "./reference.js";
import { createRng } from "./rng.js";

/** B1 runs last so its extra lines are never re-faulted by A1/A3. */
export const DEFAULT_INJECTORS: readonly Injector[] = [a1StalePrice, a3MarkupCap, b1ScopeChange];

export interface BatchOptions {
  seed: number;
  jobs: number;
  customers?: number;
  rates?: InjectionRates;
}

/**
 * File name → contents. Each mock system gets its own store; fault labels are
 * a separate file that only the evaluation harness reads.
 */
export type BatchFiles = Record<string, unknown>;

export const STORE_FILES = {
  quoting: "quoting.json",
  ops: "ops.json",
  billing: "billing.json",
  msa: "msa.json",
  portal: "portal.json",
  faultLabels: "fault_labels.json",
  manifest: "manifest.json",
} as const;

export function generateBatch(options: BatchOptions): BatchFiles {
  const { seed, jobs, customers = 4, rates = DEFAULT_RATES } = options;
  if (!Number.isInteger(jobs) || jobs < 1) throw new RangeError("jobs must be a positive integer");
  const rng = createRng(seed);
  const ref = generateReferenceData(rng, customers);
  const clean = Array.from({ length: jobs }, (_, i) => generateJob(rng, ref, i));
  const { bundles, labels } = injectFaults(rng, ref, clean, DEFAULT_INJECTORS, rates);

  const quotes = bundles.flatMap((b) => b.quotes);
  const changeOrders = bundles.flatMap((b) => b.changeOrders);
  return {
    [STORE_FILES.quoting]: { priceBook: ref.priceBook, quotes, changeOrders },
    [STORE_FILES.ops]: {
      jobs: bundles.map((b) => b.job),
      workOrders: bundles.map((b) => b.workOrder),
    },
    [STORE_FILES.billing]: { customers: ref.customers, invoices: bundles.map((b) => b.invoice) },
    [STORE_FILES.msa]: { customers: ref.customers, rules: ref.rules },
    // The customer's side: its contract (price book + rules) and the scope it approved.
    [STORE_FILES.portal]: {
      priceBook: ref.priceBook,
      rules: ref.rules,
      quotes,
      changeOrders: changeOrders.filter((c) => c.status === "APPROVED"),
    },
    [STORE_FILES.faultLabels]: labels,
    [STORE_FILES.manifest]: {
      seed,
      jobs,
      customers,
      rates,
      faultCounts: countByCode(labels),
    },
  };
}

function countByCode(labels: readonly FaultLabel[]): Partial<Record<FrictionCode, number>> {
  const counts: Partial<Record<FrictionCode, number>> = {};
  for (const l of labels) counts[l.frictionCode] = (counts[l.frictionCode] ?? 0) + 1;
  return counts;
}

/** Stable serialization: 2-space JSON with a trailing newline. */
export function serializeBatch(files: BatchFiles): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).map(([name, data]) => [name, `${JSON.stringify(data, null, 2)}\n`]),
  );
}
