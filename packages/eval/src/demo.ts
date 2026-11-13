import {
  type AgentRun,
  acceptAll,
  applyFindings,
  type FixResult,
  type JobReview,
  openBatchSources,
  runAgent,
} from "@valwell/agent";
import { type Finding, format, type Invoice, type Money } from "@valwell/domain";
import { openPortal, type PortalDecision } from "@valwell/mock-systems";

/** A draft and, when it is READY, the simulated portal's decision on it. */
export interface DraftOutcome extends FixResult {
  /** null when the draft was not READY and therefore not submitted. */
  portal: PortalDecision | null;
}

export interface DemoCaseResult {
  run: AgentRun;
  review: JobReview;
  original: { invoice: Invoice; portal: PortalDecision };
  /** What the agent does on its own: AUTO_FIX corrections and BLOCK holds. */
  unattended: DraftOutcome;
  /** After a simulated reviewer accepts every OPEN finding. Not customer approval. */
  afterAcceptance: DraftOutcome;
}

/**
 * Run one fixed demo case: a directory with the four source-system stores and
 * the portal's store for a single job. No generator and no fault labels.
 */
export async function runDemoCase(dir: string): Promise<DemoCaseResult> {
  const sources = await openBatchSources(dir);
  const portal = await openPortal(dir);
  const run = runAgent(sources);
  const [review] = run.reviews;
  if (run.reviews.length !== 1 || !review) throw new Error(`${dir}: a demo case has one job`);
  const invoice = sources.billing.invoiceForJob(review.jobId);
  if (!invoice) throw new Error(`${dir}: no invoice for ${review.jobId}`);

  const submit = (draft: FixResult): DraftOutcome => ({
    ...draft,
    portal: draft.status === "READY" && draft.invoice ? portal.submit(draft.invoice) : null,
  });
  return {
    run,
    review,
    original: { invoice, portal: portal.submit(invoice) },
    unattended: submit(applyFindings(invoice, run.findings, review)),
    afterAcceptance: submit(applyFindings(invoice, acceptAll(run.findings), review)),
  };
}

/** The four fixed demo cases, in presentation order. */
export const DEMO_CASES = [
  { dir: "1-normal-repair", title: "Normal repair" },
  { dir: "2-price-entry-error", title: "Price entry error" },
  { dir: "3-markup-over-cap", title: "Parts markup exceeds the contract cap" },
  { dir: "4-unapproved-extra-work", title: "Unapproved additional work" },
] as const;

const signed = (m: Money) => (m > 0 ? `+${format(m)}` : format(m));

function portalText(d: PortalDecision | null): string {
  if (!d) return "not submitted";
  if (d.status === "APPROVED") return "APPROVED (simulated)";
  return `REJECTED (simulated): ${d.reasons.map((r) => `${r.code} — ${r.message}`).join("; ")}`;
}

/** Why the route needs (or does not need) a person, in demo terms. */
function approvalNote(f: Finding): string {
  if (f.route === "AUTO_FIX") return "applied without a human under the declared AUTO_FIX rule";
  if (f.route === "REVIEW") return "needs a human to accept the correction before it is applied";
  return "held automatically; only an approved customer change order can release it";
}

function draftLines(label: string, d: DraftOutcome): string[] {
  const t = d.totals;
  const out = [`- ${label}: **${d.status}**`];
  if (d.status === "INPUT_NEEDS_REVIEW") return [...out, "  - No draft is produced."];
  for (const c of d.changes) {
    out.push(
      `  - Draft action: ${c.invoiceLineId} ${format(c.before.amount)} → ${format(c.after.amount)}`,
    );
  }
  for (const h of d.held) {
    out.push(
      `  - Held (not submitted, not approved, not paid): ${h.id} ${h.itemCode} ${format(h.amount)}`,
    );
  }
  if (d.changes.length === 0 && d.held.length === 0) out.push("  - No change to the invoice.");
  out.push(
    `  - Totals: original ${format(t.original)} − held ${format(t.held)} + corrections ${signed(t.corrections)} = draft ${format(t.draft)}`,
    `  - Simulated portal: ${portalText(d.portal)}`,
  );
  if (d.held.length > 0 && d.portal) {
    out.push(
      `  - Partial submission: only the remaining lines were simulated; the held ${format(t.held)} is still unresolved.`,
    );
  }
  return out;
}

/** Render one case for the terminal and demo.md. Pure. */
export function renderDemoCase(index: number, title: string, r: DemoCaseResult): string {
  const out = [
    `## Case ${index} · ${title}`,
    "",
    `- Input: ${r.review.jobId}, invoice ${r.original.invoice.id}, ${r.original.invoice.lines.length} lines`,
    `- Review: **${r.review.status}**`,
    ...r.review.issues.map((i) => `  - ${i.code}: ${i.message}`),
    `- Original invoice ${format(r.unattended.totals.original)} → simulated portal: ${portalText(r.original.portal)}`,
  ];
  if (r.run.findings.length === 0 && r.review.status === "COMPLETE") {
    out.push("- Findings: none under the supported rules (A1, A3, B1)");
  }
  for (const f of r.run.findings) {
    out.push(
      `- Finding ${f.id} · ${f.frictionCode} on ${f.invoiceLineId ?? f.workOrderLineId}: ${f.message}`,
      `  - Evidence: ${f.evidence.map((e) => `${e.kind} ${e.id}`).join(", ")}`,
      `  - Proposed action: ${f.suggestion.summary} (Δ ${signed(f.suggestion.amountDelta)})`,
      `  - Route: ${f.route} — ${f.routeReason ?? "not routed"}`,
      `  - Approval: ${approvalNote(f)}`,
    );
  }
  if (r.run.findings.some((f) => f.route === "REVIEW")) {
    out.push(
      ...draftLines("Before acceptance (finding OPEN)", r.unattended),
      ...draftLines(
        "After a simulated reviewer accepts it (a draft correction, not customer approval)",
        r.afterAcceptance,
      ),
    );
  } else {
    out.push(...draftLines("Agent draft (no human step needed)", r.unattended));
  }
  return `${out.join("\n")}\n`;
}

export const DEMO_HEADER = [
  "# Quote-to-invoice reconciliation demo",
  "",
  "Offline and deterministic: simulated source systems, no generator, no answer labels, no LLM.",
  "A finding is a proposed action, not an approved correction. Held charges stay visible and are",
  "not approved or paid. Portal results come from a simulator, not a real submission.",
  "",
].join("\n");
