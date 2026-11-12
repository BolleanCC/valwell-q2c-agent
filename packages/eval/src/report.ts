import { format } from "@valwell/domain";
import type { BatchEvaluation } from "./experiment.js";
import type { CodeScore } from "./score.js";

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);

/** Friction codes whose recall is below `minRecall`. Codes with no labels are not gated. */
export function recallFailures(scores: readonly CodeScore[], minRecall: number): CodeScore[] {
  return scores.filter((s) => s.recall !== null && s.recall < minRecall);
}

/** Render the evaluation as Markdown. Pure. */
export function renderEvaluation(name: string, { score, experiment }: BatchEvaluation): string {
  const out = [
    `# Evaluation: ${name}`,
    "",
    "## Detection vs fault labels",
    "",
    "| Code | Labels | Findings | TP | FP | FN | Precision | Recall |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...[...score.byCode, score.overall].map(
      (s) =>
        `| ${s.code} | ${s.labels} | ${s.findings} | ${s.truePositives} | ${s.falsePositives} | ${s.falseNegatives} | ${pct(s.precision)} | ${pct(s.recall)} |`,
    ),
    "",
    `## Portal experiment (${experiment.invoices} invoices)`,
    "",
    "| Run | Submitted | Approved | First-pass acceptance | Fully held | Rejections |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
    ...experiment.runs.map((r) => {
      const reasons = Object.entries(r.rejectionReasons)
        .map(([code, n]) => `${code} ×${n}`)
        .join(", ");
      return `| ${r.name} | ${r.submitted} | ${r.approved} | ${pct(r.firstPassAcceptance)} | ${r.fullyHeld} | ${reasons || "none"} |`;
    }),
    "",
    "## Amounts (all suggestions applied)",
    "",
    `- Over-billing removed: **${format(experiment.amounts.overbillingRemoved)}**`,
    `- Under-billing recovered: **${format(experiment.amounts.underbillingRecovered)}**`,
    `- Held pending change-order approval: **${format(experiment.amounts.heldPendingChangeOrder)}**`,
  ];
  if (score.missedLabels.length > 0 || score.unmatchedFindings.length > 0) {
    out.push("", "## Mismatches", "");
    for (const l of score.missedLabels)
      out.push(`- Missed ${l.frictionCode} ${l.id}: ${l.description}`);
    for (const f of score.unmatchedFindings)
      out.push(`- Unmatched ${f.frictionCode} ${f.id}: ${f.message}`);
  }
  return `${out.join("\n")}\n`;
}
