/** Test-only: load one fixed demo case as a fresh case state. */
import { join } from "node:path";
import { openPortal } from "@valwell/mock-systems";
import { openBatchSources } from "../adapters/json-batch.js";
import { collectJobContexts } from "../adapters/sources.js";
import { type CaseState, createCaseState } from "../workflow/state.js";

export const DEMO_DIR = join(import.meta.dirname, "../../../../data/fixtures/demo");

export async function demoCaseState(name: string): Promise<CaseState> {
  const dir = join(DEMO_DIR, name);
  const [ctx] = collectJobContexts(await openBatchSources(dir)).contexts;
  if (!ctx) throw new Error(`${name} has no job`);
  return createCaseState(ctx, await openPortal(dir));
}

/** A tool call as the model would send it. */
export const call = (name: string, input: unknown) => ({ id: `t-${name}`, name, input });
