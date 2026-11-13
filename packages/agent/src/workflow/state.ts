import { Finding } from "@valwell/domain";
import type { PortalDecision } from "@valwell/mock-systems";
import type { JobContext, PortalSource } from "../adapters/sources.js";
import type { FixResult } from "../fix.js";
import type { EvidenceSource } from "../llm/draft.js";
import type { JobReview, ReviewIssue } from "../review.js";

/**
 * Everything the application knows about one case while the model works on
 * it. Only application code changes it: tools record their deterministic
 * results here, and the human-acceptance event below is the only way a
 * finding's status changes. Source records are a private copy and are never
 * modified; drafts exist only in memory.
 */
export interface CaseState {
  ctx: JobContext;
  portal: PortalSource;
  /** Result of validate_records, or null before it ran. */
  recordCheck: { passed: boolean; issues: ReviewIssue[] } | null;
  /** Result of reconcile_invoice, or null before it ran. */
  review: JobReview | null;
  findings: Finding[];
  /** The latest in-memory draft prepared by prepare_draft. */
  draft: FixResult | null;
  /** The simulated portal's decision on the latest READY draft. */
  portalDecision: PortalDecision | null;
  /** Ids returned by successful tool calls; the only ids the model may cite. */
  evidence: Map<string, EvidenceSource>;
  /** Application events outside the model, e.g. a human accepting a finding. */
  humanEvents: string[];
}

export function createCaseState(ctx: JobContext, portal: PortalSource): CaseState {
  return {
    ctx: structuredClone(ctx),
    portal,
    recordCheck: null,
    review: null,
    findings: [],
    draft: null,
    portalDecision: null,
    evidence: new Map(),
    humanEvents: [],
  };
}

/**
 * Simulated human acceptance of an OPEN REVIEW finding. This is an
 * application event, never a model tool. It invalidates any earlier draft
 * and portal result, because the permitted actions have changed.
 */
export function acceptFinding(state: CaseState, findingId: string, reviewer: string): void {
  const index = state.findings.findIndex((f) => f.id === findingId);
  const finding = state.findings[index];
  if (finding?.status !== "OPEN" || finding.route !== "REVIEW") {
    throw new Error(`${findingId} is not an OPEN REVIEW finding`);
  }
  state.findings[index] = Finding.parse({ ...finding, status: "ACCEPTED" });
  state.draft = null;
  state.portalDecision = null;
  state.humanEvents.push(`${reviewer} accepted ${findingId} (${finding.suggestion.summary})`);
}
