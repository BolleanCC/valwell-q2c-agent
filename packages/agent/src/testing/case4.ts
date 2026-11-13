/** Test-only: demo case 4 (unapproved extra work) as one drafting scope. */
import { join } from "node:path";
import { openBatchSources } from "../adapters/json-batch.js";
import { collectJobContexts } from "../adapters/sources.js";
import type { DraftingScope } from "../llm/tools.js";
import { runPipeline } from "../pipeline.js";

const CASE_4 = join(import.meta.dirname, "../../../../data/fixtures/demo/4-unapproved-extra-work");

export async function case4Scope(): Promise<DraftingScope> {
  const [ctx] = collectJobContexts(await openBatchSources(CASE_4)).contexts;
  if (!ctx) throw new Error("case 4 has no job");
  const [finding] = runPipeline([ctx]).findings;
  if (!finding) throw new Error("case 4 has no finding");
  return { ctx, finding };
}
