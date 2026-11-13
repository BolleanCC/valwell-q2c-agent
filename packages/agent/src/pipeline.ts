import { Finding } from "@valwell/domain";
import { collectJobContexts, type JobContext, type Sources } from "./adapters/sources.js";
import { a1StalePrice } from "./detectors/a1-stale-price.js";
import { a3MarkupCap } from "./detectors/a3-markup-cap.js";
import { b1ScopeChange } from "./detectors/b1-scope-change.js";
import type { Detector } from "./detectors/types.js";
import { align } from "./nodes/align.js";
import { DEFAULT_POLICY, type RoutingPolicy, routeFinding } from "./nodes/route.js";
import { checkRecordLinks, type JobReview } from "./review.js";

export const DEFAULT_DETECTORS: readonly Detector[] = [a1StalePrice, a3MarkupCap, b1ScopeChange];

export interface PipelineOptions {
  detectors?: readonly Detector[];
  policy?: RoutingPolicy;
}

export interface PipelineResult {
  /** One review per job, saying whether its checks could run to completion. */
  reviews: JobReview[];
  findings: Finding[];
}

export interface AgentRun extends PipelineResult {
  /** Jobs whose rule checks ran (status COMPLETE or NEEDS_REVIEW). */
  jobsChecked: number;
}

/**
 * validate records → align → detect → route for each job. Pure: same
 * contexts in, same result out. A job whose records do not belong together
 * is INCOMPLETE and gets no rule checks.
 */
export function runPipeline(
  contexts: readonly JobContext[],
  options: PipelineOptions = {},
): PipelineResult {
  const { detectors = DEFAULT_DETECTORS, policy = DEFAULT_POLICY } = options;
  const reviews: JobReview[] = [];
  const findings: Finding[] = [];
  for (const ctx of contexts) {
    const base = { jobId: ctx.job.id, invoiceId: ctx.invoice.id };
    const recordIssues = checkRecordLinks(ctx);
    if (recordIssues.length > 0) {
      reviews.push({ ...base, status: "INCOMPLETE", issues: recordIssues });
      continue;
    }
    const alignment = align(ctx);
    for (const detector of detectors) {
      for (const draft of detector.detect(ctx, alignment)) {
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
    // Findings on resolved lines are kept, but unresolved lines need a human.
    const issues = alignment.issues;
    reviews.push({ ...base, status: issues.length > 0 ? "NEEDS_REVIEW" : "COMPLETE", issues });
  }
  return { reviews, findings };
}

/** Gather contexts from the source systems and run the pipeline over every job. */
export function runAgent(sources: Sources, options: PipelineOptions = {}): AgentRun {
  const { contexts, skipped } = collectJobContexts(sources);
  const result = runPipeline(contexts, options);
  const order = new Map<string, number>(sources.ops.jobs().map((j, i) => [j.id, i]));
  const reviews = [...skipped, ...result.reviews].sort(
    (a, b) => (order.get(a.jobId) ?? 0) - (order.get(b.jobId) ?? 0),
  );
  return {
    jobsChecked: reviews.filter((r) => r.status !== "INCOMPLETE").length,
    reviews,
    findings: result.findings,
  };
}
