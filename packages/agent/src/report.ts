import {
  add,
  type Finding,
  FRICTION_DESCRIPTIONS,
  FrictionCode,
  format,
  type Money,
  type Route,
} from "@valwell/domain";
import type { AgentRun } from "./pipeline.js";

const ROUTES: readonly Route[] = ["AUTO_FIX", "REVIEW", "BLOCK"];
const signed = (amount: Money) => (amount > 0 ? `+${format(amount)}` : format(amount));
const delta = (fs: readonly Finding[]) => add(...fs.map((f) => f.suggestion.amountDelta));

/** Render a human-readable Markdown report of an agent run. Pure. */
export function renderReport(run: AgentRun, batchName: string): string {
  const { findings } = run;
  const invoices = new Set(findings.map((f) => f.invoiceId));
  const out: string[] = [
    `# Reconciliation report: ${batchName}`,
    "",
    `- Jobs checked: **${run.jobsChecked}**${run.skipped.length ? ` (skipped ${run.skipped.length})` : ""}`,
    `- Findings: **${findings.length}** on **${invoices.size}** invoices`,
    `- Net invoice change if all suggestions are applied: **${signed(delta(findings))}**`,
    "",
    "## Summary by friction code",
    "",
    "| Code | Friction | Findings | Auto-fix | Review | Block | Amount Δ |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const code of FrictionCode.options) {
    const fs = findings.filter((f) => f.frictionCode === code);
    const byRoute = ROUTES.map((r) => fs.filter((f) => f.route === r).length);
    out.push(
      `| ${code} | ${FRICTION_DESCRIPTIONS[code]} | ${fs.length} | ${byRoute.join(" | ")} | ${signed(delta(fs))} |`,
    );
  }

  if (run.skipped.length > 0) {
    out.push("", "## Skipped jobs", "");
    for (const s of run.skipped) out.push(`- ${s.jobId}: ${s.reason}`);
  }

  out.push("", "## Findings by invoice");
  const byInvoice = Map.groupBy(findings, (f) => f.invoiceId);
  for (const [invoiceId, fs] of byInvoice) {
    out.push("", `### ${invoiceId} (${fs[0]?.jobId})`, "");
    for (const f of fs) {
      out.push(
        `- **${f.id} · ${f.frictionCode} · ${f.route}** (confidence ${Math.round(f.confidence * 100)}%): ${f.message}`,
        `  - Suggested: ${f.suggestion.summary} (Δ ${signed(f.suggestion.amountDelta)})`,
        `  - Evidence: ${f.evidence.map((e) => `${e.kind} \`${e.id}\``).join(", ")}`,
      );
    }
  }
  if (findings.length === 0) out.push("", "_No discrepancies found._");
  return `${out.join("\n")}\n`;
}
