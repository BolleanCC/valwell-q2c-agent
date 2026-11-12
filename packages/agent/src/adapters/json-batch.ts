import {
  openBillingStore,
  openMsaStore,
  openOpsStore,
  openQuotingStore,
} from "@valwell/mock-systems";
import type { Sources } from "./sources.js";

/**
 * Adapters over the mock systems' JSON stores in a batch directory. Opens only
 * the four source-system stores: never fault_labels.json (ground truth for
 * evaluation) and never portal.json (the customer's side).
 */
export async function openBatchSources(batchDir: string): Promise<Sources> {
  const [quoting, ops, billing, contract] = await Promise.all([
    openQuotingStore(batchDir),
    openOpsStore(batchDir),
    openBillingStore(batchDir),
    openMsaStore(batchDir),
  ]);
  return { quoting, ops, billing, contract };
}
