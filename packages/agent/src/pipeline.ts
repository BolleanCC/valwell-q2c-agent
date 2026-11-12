import { Finding } from "@valwell/domain";
import {
  collectJobContexts,
  type JobContext,
  type SkippedJob,
  type Sources,
} from "./adapters/sources.js";
import { a1StalePrice } from "./detectors/a1-stale-price.js";
import { a3MarkupCap } from "./detectors/a3-markup-cap.js";
import { b1ScopeChange } from "./detectors/b1-scope-change.js";
import type { Detector } from "./detectors/types.js";
import { align } from "./nodes/align.js";
import { DEFAULT_POLICY, type RoutingPolicy, routeFinding } from "./nodes/route.js";

export const DEFAULT_DETECTORS: readonly Detector[] = [a1StalePrice, a3MarkupCap, b1ScopeChange];

export interface PipelineOptions {
  detectors?: readonly Detector[];
  policy?: RoutingPolicy;
}

export interface AgentRun {
  jobsChecked: number;
  skipped: SkippedJob[];
  findings: Finding[];
}

/** align → detect → route for each job. Pure: same contexts in, same findings out. */
export function runPipeline(
  contexts: readonly JobContext[],
  options: PipelineOptions = {},
): Finding[] {
  const { detectors = DEFAULT_DETECTORS, policy = DEFAULT_POLICY } = options;
  const findings: Finding[] = [];
  for (const ctx of contexts) {
    const table = align(ctx);
    for (const detector of detectors) {
      for (const draft of detector.detect(ctx, table)) {
        findings.push(
          Finding.parse({
            ...draft,
            id: `F-${String(findings.length + 1).padStart(4, "0")}`,
            route: routeFinding(draft, policy),
            status: "OPEN",
          }),
        );
      }
    }
  }
  return findings;
}

/** Gather contexts from the source systems and run the pipeline over every job. */
export function runAgent(sources: Sources, options: PipelineOptions = {}): AgentRun {
  const { contexts, skipped } = collectJobContexts(sources);
  return { jobsChecked: contexts.length, skipped, findings: runPipeline(contexts, options) };
}
