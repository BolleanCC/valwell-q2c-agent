import {
  add,
  type Finding,
  FRICTION_DESCRIPTIONS,
  FrictionCode,
  format,
  type Money,
  type Route,
} from "@valwell/domain";
import type { DraftStatus } from "./fix.js";
import type { AgentRun } from "./pipeline.js";
import type { ReviewStatus } from "./review.js";

const ROUTES: readonly Route[] = ["AUTO_FIX", "REVIEW", "BLOCK"];
const DRAFT_STATUSES: readonly DraftStatus[] = [
  "READY",
  "AWAITING_REVIEW",
  "ALL_LINES_HELD",
  "INPUT_NEEDS_REVIEW",
];
const signed = (amount: Money) => (amount > 0 ? `+${format(amount)}` : format(amount));
const proposed = (fs: readonly Finding[]) => add(...fs.map((f) => f.suggestion.amountDelta));

/**
 * Render a human-readable Markdown report of an agent run. Pure.
 *
 * Proposed adjustments (per finding) are kept apart from actual draft
 * results: two findings may explain the same line, so proposals can overlap,
 * while draft totals count every line once:
 * original − held + corrections = draft. Drafts are what the agent can do
 * unattended; held amounts are neither submitted nor approved.
 */
export function renderReport(run: AgentRun, batchName: string): string {
  const { findings, drafts } = run;
  const invoices = new Set(findings.map((f) => f.invoiceId));
  const count = (status: ReviewStatus) => run.reviews.filter((r) => r.status === status).length;
  const drafted = drafts.filter((d) => d.status !== "INPUT_NEEDS_REVIEW");
  const total = (pick: (d: (typeof drafts)[number]) => Money) => add(...drafted.map(pick));
  const out: string[] = [
    `# Reconciliation report: ${batchName}`,
    "",
    `- Jobs: **${run.reviews.length}** (review complete ${count("COMPLETE")}, needs human review ${count("NEEDS_REVIEW")}, incomplete ${count("INCOMPLETE")})`,
    `- Findings: **${findings.length}** on **${invoices.size}** invoices`,
    `- Proposed adjustments (sum per finding, not yet applied, may overlap): **${signed(proposed(findings))}**`,
    `- Unattended drafts: ${DRAFT_STATUSES.map((s) => `${s} ${drafts.filter((d) => d.status === s).length}`).join(", ")}`,
    `- Drafted invoices: original **${format(total((d) => d.totals.original))}** − held **${format(total((d) => d.totals.held))}** + corrections **(${signed(total((d) => d.totals.corrections))})** = draft **${format(total((d) => d.totals.draft))}**`,
    "",
    "## Summary by friction code",
    "",
    "| Code | Friction | Findings | Auto-fix | Review | Block | Proposed Δ |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const code of FrictionCode.options) {
    const fs = findings.filter((f) => f.frictionCode === code);
    const byRoute = ROUTES.map((r) => fs.filter((f) => f.route === r).length);
    out.push(
      `| ${code} | ${FRICTION_DESCRIPTIONS[code]} | ${fs.length} | ${byRoute.join(" | ")} | ${signed(proposed(fs))} |`,
    );
  }

  const unresolved = run.reviews.filter((r) => r.status !== "COMPLETE");
  if (unresolved.length > 0) {
    out.push("", "## Jobs that need a human before invoicing", "");
    for (const r of unresolved) {
      out.push(`- **${r.jobId}** (${r.invoiceId ?? "no invoice"}) · ${r.status}`);
      for (const i of r.issues) {
        out.push(`  - ${i.code}${i.invoiceLineId ? ` \`${i.invoiceLineId}\`` : ""}: ${i.message}`);
      }
    }
  }

  out.push("", "## Findings by invoice");
  const byInvoice = Map.groupBy(findings, (f) => f.invoiceId);
  for (const [invoiceId, fs] of byInvoice) {
    out.push("", `### ${invoiceId} (${fs[0]?.jobId})`, "");
    for (const f of fs) {
      out.push(
        `- **${f.id} · ${f.frictionCode} · ${f.route}**: ${f.message}`,
        `  - Route: ${f.routeReason ?? "not routed"}`,
        `  - Proposed: ${f.suggestion.summary} (Δ ${signed(f.suggestion.amountDelta)})`,
        `  - Evidence: ${f.evidence.map((e) => `${e.kind} \`${e.id}\``).join(", ")}`,
      );
    }
    const draft = drafts.find((d) => d.jobId === fs[0]?.jobId);
    if (draft) {
      const t = draft.totals;
      out.push(
        `- Unattended draft: **${draft.status}** · original ${format(t.original)} · held ${format(t.held)} · draft ${format(t.draft)} · corrections ${signed(t.corrections)}`,
      );
    }
  }
  if (findings.length === 0) {
    // Never present "could not check" as "checked, nothing wrong".
    out.push(
      "",
      unresolved.length === 0
        ? "_No discrepancies found._"
        : `_No discrepancies found in the jobs that could be checked; ${unresolved.length} job(s) above still need a human._`,
    );
  }
  return `${out.join("\n")}\n`;
}
