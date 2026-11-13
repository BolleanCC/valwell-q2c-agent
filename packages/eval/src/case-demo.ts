import { basename } from "node:path";
import {
  acceptFinding,
  anthropicProvider,
  type CaseRun,
  type CaseState,
  collectJobContexts,
  createCaseState,
  type LlmProvider,
  openBatchSources,
  runCaseWorkflow,
  scriptedProvider,
} from "@valwell/agent";
import type { Invoice } from "@valwell/domain";
import { openPortal, type PortalDecision } from "@valwell/mock-systems";
import { offlineScript } from "./offline-scripts.js";

/** offline = scripted, simulated model turns (default); live = real Anthropic API calls. */
export type LlmMode = "offline" | "live";

/** Picks the "model" for one run of one case (phase 1 = after the human event). */
export type ProviderFactory = (caseName: string, phase: number) => LlmProvider;

/** Live mode uses the same provider for every case: no case-specific solutions. */
export const providerFor = (llm: LlmMode): ProviderFactory =>
  llm === "live"
    ? () => anthropicProvider()
    : (name, phase) => scriptedProvider(offlineScript(name, phase), "offline-script").provider;

export interface CaseDemoResult {
  name: string;
  /** Baseline outside the model: the original invoice through the simulated portal. */
  original: { invoice: Invoice; portal: PortalDecision };
  /** One run, or two when the case waited for human acceptance. */
  runs: CaseRun[];
  state: CaseState;
}

/**
 * Run one fixed demo case through LLM orchestration. If the model's verified
 * disposition is AWAITING_HUMAN_ACCEPTANCE, the demo simulates a reviewer
 * accepting the pending findings (an application event, never a model tool)
 * and resumes with the same case state. A failed run is not resumed.
 */
export async function runCaseDemo(dir: string, provider: ProviderFactory): Promise<CaseDemoResult> {
  const name = basename(dir);
  const sources = await openBatchSources(dir);
  const portal = await openPortal(dir);
  const [ctx] = collectJobContexts(sources).contexts;
  if (!ctx) throw new Error(`${dir}: no complete job`);
  const state = createCaseState(ctx, portal);

  const runs = [await runCaseWorkflow(state, provider(name, 0))];
  if (runs[0]?.disposition?.outcome === "AWAITING_HUMAN_ACCEPTANCE") {
    for (const f of state.findings.filter((f) => f.status === "OPEN" && f.route === "REVIEW")) {
      acceptFinding(state, f.id, "Simulated human reviewer");
    }
    runs.push(
      await runCaseWorkflow(state, provider(name, 1), { humanEvent: state.humanEvents.join("; ") }),
    );
  }
  return {
    name,
    original: { invoice: ctx.invoice, portal: portal.submit(ctx.invoice) },
    runs,
    state,
  };
}
